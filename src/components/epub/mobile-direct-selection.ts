import type { ReaderFrame } from '../../services/epub/reader-engine-types';
import { domInstanceOf } from '../../utils/dom-instance-of';
import { logMobileEvent } from '../../utils/zora-mobile-logger';

export type MobileDirectSelectionMode = 'idle' | 'selecting' | 'selected';

export interface MobileDirectSelectionContext {
	source: 'mobile-direct';
	range: Range;
	text: string;
	cfiRange: string;
	rect: DOMRect;
	rects: DOMRect[];
	frame: ReaderFrame;
	frameDocument: Document;
	initialWordRange?: Range;
	initialWordText?: string;
	clear: () => void;
}

export type MobileGestureKind =
	| 'text-selection'
	| 'interactive'
	| 'native-control'
	| 'blocked';

export interface MobileDirectSelectionState {
	mode: MobileDirectSelectionMode;
	selection: MobileDirectSelectionContext | null;
	gestureKind?: MobileGestureKind | null;
}

/**
 * Resolves character position from touch coordinates in a document viewport.
 * Prefers standard caretPositionFromPoint with fallback to WebKit caretRangeFromPoint.
 */
export function getCaretPositionFromPoint(
	doc: Document,
	x: number,
	y: number
): { node: Node; offset: number } | null {
	if (!doc) {
		return null;
	}

	// 1. Standard API: document.caretPositionFromPoint
	if (typeof (doc as any).caretPositionFromPoint === 'function') {
		try {
			const pos = (doc as any).caretPositionFromPoint(x, y);
			if (pos && pos.offsetNode) {
				return normalizeCaretNodeOffset(pos.offsetNode, pos.offset);
			}
		} catch {
			/* fallback */
		}
	}

	// 2. WebKit / iOS Safari standard: document.caretRangeFromPoint
	if (typeof doc.caretRangeFromPoint === 'function') {
		try {
			const range = doc.caretRangeFromPoint(x, y);
			if (range && range.startContainer) {
				return normalizeCaretNodeOffset(range.startContainer, range.startOffset);
			}
		} catch {
			/* fallback */
		}
	}

	return null;
}

export function normalizeCaretNodeOffset(node: Node, offset: number): { node: Node; offset: number } {
	if (domInstanceOf(node, Text)) {
		return {
			node,
			offset: Math.max(0, Math.min(offset, node.length)),
		};
	}

	if (domInstanceOf(node, Element)) {
		const childNodes = Array.from(node.childNodes);
		if (childNodes.length === 0) {
			return { node, offset: 0 };
		}
		if (offset < childNodes.length) {
			const child = childNodes[offset];
			if (domInstanceOf(child, Text)) {
				return { node: child, offset: 0 };
			}
			const walker = node.ownerDocument?.createTreeWalker(child, NodeFilter.SHOW_TEXT, null);
			const firstText = walker?.nextNode();
			if (firstText && domInstanceOf(firstText, Text)) {
				return { node: firstText, offset: 0 };
			}
		} else {
			const lastChild = childNodes[childNodes.length - 1];
			if (domInstanceOf(lastChild, Text)) {
				return { node: lastChild, offset: lastChild.length };
			}
			const walker = node.ownerDocument?.createTreeWalker(lastChild, NodeFilter.SHOW_TEXT, null);
			let lastText: Node | null = null;
			let current = walker?.nextNode();
			while (current) {
				lastText = current;
				current = walker?.nextNode();
			}
			if (lastText && domInstanceOf(lastText, Text)) {
				return { node: lastText, offset: lastText.length };
			}
		}
	}

	return { node, offset };
}

/**
 * Builds a valid, normalized DOM Range between two arbitrary positions.
 * Correctly handles forward, backward, multi-line, multi-node, and inline elements.
 */
export function buildNormalizedRange(
	doc: Document,
	nodeA: Node,
	offsetA: number,
	nodeB: Node,
	offsetB: number
): Range | null {
	if (!doc || !nodeA || !nodeB) {
		return null;
	}

	// 1. Same node
	if (nodeA === nodeB) {
		const start = Math.min(offsetA, offsetB);
		const end = Math.max(offsetA, offsetB);
		if (start === end) {
			return null;
		}
		try {
			const range = doc.createRange();
			range.setStart(nodeA, start);
			range.setEnd(nodeA, end);
			return range.collapsed ? null : range;
		} catch {
			return null;
		}
	}

	// 2. Different nodes: check relative document position
	try {
		const comparison = nodeA.compareDocumentPosition(nodeB);
		const range = doc.createRange();

		if (comparison & Node.DOCUMENT_POSITION_FOLLOWING) {
			// nodeB is after nodeA (forward selection)
			range.setStart(nodeA, offsetA);
			range.setEnd(nodeB, offsetB);
			if (!range.collapsed) return range;
		} else if (comparison & Node.DOCUMENT_POSITION_PRECEDING) {
			// nodeB is before nodeA (backward selection)
			range.setStart(nodeB, offsetB);
			range.setEnd(nodeA, offsetA);
			if (!range.collapsed) return range;
		} else {
			// Contained or complex hierarchy: test forward then backward
			try {
				range.setStart(nodeA, offsetA);
				range.setEnd(nodeB, offsetB);
				if (!range.collapsed) return range;
			} catch {
				const reverseRange = doc.createRange();
				reverseRange.setStart(nodeB, offsetB);
				reverseRange.setEnd(nodeA, offsetA);
				if (!reverseRange.collapsed) return reverseRange;
			}
		}
	} catch {
		/* fallback trial */
	}

	// Direct trial fallback
	try {
		const rangeAB = doc.createRange();
		rangeAB.setStart(nodeA, offsetA);
		rangeAB.setEnd(nodeB, offsetB);
		if (!rangeAB.collapsed) return rangeAB;
	} catch {
		try {
			const rangeBA = doc.createRange();
			rangeBA.setStart(nodeB, offsetB);
			rangeBA.setEnd(nodeA, offsetA);
			if (!rangeBA.collapsed) return rangeBA;
		} catch {
			return null;
		}
	}

	return null;
}

/**
 * Extracts a complete English word (including contractions and hyphens like don't, I'm, teacher's, twenty-first)
 * at the given text node offset.
 */
export function extractWordRangeFromTextNode(
	doc: Document,
	textNode: Text,
	offset: number
): { range: Range; text: string } | null {
	const content = textNode.textContent || '';
	if (!content.trim()) {
		return null;
	}

	const len = content.length;
	let caret = Math.max(0, Math.min(offset, len));

	// If caret is on trailing edge or whitespace/punct, check if adjacent char is a word char
	if (caret >= len || /[\s\p{P}]/u.test(content[caret])) {
		if (caret > 0 && /[A-Za-z0-9]/.test(content[caret - 1])) {
			caret = caret - 1;
		} else if (caret + 1 < len && /[A-Za-z0-9]/.test(content[caret + 1])) {
			caret = caret + 1;
		}
	}

	const isWordChar = (ch: string) => /[A-Za-z0-9]/.test(ch);
	const isConnector = (ch: string) => ch === "'" || ch === "’" || ch === "-";

	// Search backward for word start
	let start = caret;
	while (start > 0) {
		const prev = content[start - 1];
		if (isWordChar(prev)) {
			start--;
		} else if (isConnector(prev) && start > 1 && isWordChar(content[start - 2])) {
			// Intra-word apostrophe or hyphen (e.g. don't, twenty-first)
			start--;
		} else {
			break;
		}
	}

	// Search forward for word end
	let end = caret;
	while (end < len) {
		const curr = content[end];
		if (isWordChar(curr)) {
			end++;
		} else if (isConnector(curr) && end + 1 < len && isWordChar(content[end + 1])) {
			// Intra-word apostrophe or hyphen
			end++;
		} else {
			break;
		}
	}

	// Trim leading/trailing connector or punctuation if any
	while (start < end && isConnector(content[start])) {
		start++;
	}
	while (end > start && isConnector(content[end - 1])) {
		end--;
	}

	if (start >= end) {
		return null;
	}

	try {
		const range = doc.createRange();
		range.setStart(textNode, start);
		range.setEnd(textNode, end);
		const wordText = range.toString().trim();
		if (!wordText) {
			return null;
		}
		return { range, text: wordText };
	} catch {
		return null;
	}
}

/**
 * Visual selection overlay that paints semi-transparent rectangles inside an EPUB chapter iframe.
 * Never uses native window.getSelection().addRange() and does not alter chapter DOM nodes.
 */
export class MobileDirectSelectionOverlay {
	private container: HTMLDivElement | null = null;
	private doc: Document;

	constructor(doc: Document) {
		this.doc = doc;
	}

	private ensureContainer(): HTMLDivElement | null {
		if (this.container && this.container.isConnected) {
			return this.container;
		}
		const root = this.doc.body || this.doc.documentElement;
		if (!root) {
			return null;
		}

		let existing = (root.querySelector('.zora-mobile-selection-overlay') ||
			root.querySelector('.zora-custom-selection-overlay-layer')) as HTMLDivElement | null;
		if (!existing) {
			existing = this.doc.createElement('div');
			existing.className = 'zora-mobile-selection-overlay zora-custom-selection-overlay-layer';
			existing.style.cssText =
				'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 99999; overflow: visible;';
			root.appendChild(existing);
		}
		this.container = existing;
		return this.container;
	}

	render(range: Range | null): void {
		const container = this.ensureContainer();
		if (!container) return;

		while (container.firstChild) {
			container.removeChild(container.firstChild);
		}

		if (!range || range.collapsed) {
			return;
		}

		const rects: DOMRect[] = typeof range.getClientRects === 'function'
			? Array.from(range.getClientRects())
			: [];
		if (!rects.length && typeof range.getBoundingClientRect === 'function') {
			const bRect = range.getBoundingClientRect();
			if (bRect && bRect.width > 0 && bRect.height > 0) {
				rects.push(bRect);
			}
		}

		const win = this.doc.defaultView || window;
		const scrollX = win.scrollX || win.pageXOffset || 0;
		const scrollY = win.scrollY || win.pageYOffset || 0;

		for (const rect of rects) {
			if (rect.width <= 0 || rect.height <= 0) continue;
			const box = this.doc.createElement('div');
			box.className = 'zora-mobile-selection-box zora-custom-selection-box';
			const top = rect.top + scrollY;
			const left = rect.left + scrollX;
			// Translucent light blue matching native selection
			box.style.cssText = `position: absolute; top: ${top}px; left: ${left}px; width: ${rect.width}px; height: ${rect.height}px; background-color: rgba(64, 150, 255, 0.32); border-radius: 2px; pointer-events: none; mix-blend-mode: multiply;`;
			container.appendChild(box);
		}
	}

	clear(): void {
		if (this.container) {
			while (this.container.firstChild) {
				this.container.removeChild(this.container.firstChild);
			}
			if (this.container.parentNode) {
				this.container.parentNode.removeChild(this.container);
			}
			this.container = null;
		}
	}
}

/**
 * Determines whether a touch target is a known interactive EPUB element.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
	if (!target) {
		return false;
	}
	let el: Element | null = null;
	if (target instanceof Element || (target as any).nodeType === Node.ELEMENT_NODE) {
		el = target as Element;
	} else if ((target as any).parentElement) {
		el = (target as any).parentElement as Element;
	}
	if (!el || typeof el.closest !== 'function') {
		return false;
	}

	const interactiveSelector = [
		'a[href]',
		'a[data-href]',
		'button',
		'summary',
		'label',
		'input',
		'textarea',
		'select',
		'option',
		'[role="button"]',
		'[role="link"]',
		'[role="checkbox"]',
		'[role="switch"]',
		'[role="menuitem"]',
		'[role="tab"]',
		'[data-zora-interactive="true"]',
		'[data-zora-note-marker]',
		'[data-weave-comment-marker]',
		'[data-weave-reference-badge]',
		'audio',
		'video',
	].join(', ');

	if (el.closest(interactiveSelector)) {
		return true;
	}

	const tabindexEl = el.closest('[tabindex]');
	if (tabindexEl) {
		const tabIndex = parseInt(tabindexEl.getAttribute('tabindex') || '-1', 10);
		if (tabIndex >= 0) {
			return true;
		}
	}

	return false;
}

/**
 * Determines whether a target is a native form/media control that should retain native touch mechanics.
 */
export function isNativeControlTarget(target: EventTarget | null): boolean {
	if (!target) {
		return false;
	}
	let el: Element | null = null;
	if (target instanceof Element || (target as any).nodeType === Node.ELEMENT_NODE) {
		el = target as Element;
	} else if ((target as any).parentElement) {
		el = (target as any).parentElement as Element;
	}
	if (!el || typeof el.closest !== 'function') {
		return false;
	}
	const nativeControlSelector = [
		'input',
		'textarea',
		'select',
		'option',
		'[contenteditable="true"]',
		'[contenteditable=""]',
		'audio[controls]',
		'video[controls]',
	].join(', ');

	return Boolean(el.closest(nativeControlSelector));
}

/**
 * Determines whether a target is a standalone media element (not enclosed in a link or interactive widget).
 */
export function isBlockedStandaloneMedia(target: EventTarget | null): boolean {
	if (!target) {
		return false;
	}
	let el: Element | null = null;
	if (target instanceof Element || (target as any).nodeType === Node.ELEMENT_NODE) {
		el = target as Element;
	} else if ((target as any).parentElement) {
		el = (target as any).parentElement as Element;
	}
	if (!el || typeof el.closest !== 'function') {
		return false;
	}
	if (el.closest('a') || el.closest('[data-zora-interactive="true"]')) {
		return false;
	}
	const tagName = el.tagName?.toLowerCase();
	return tagName === 'img' || tagName === 'svg' || tagName === 'canvas' || tagName === 'image';
}

/**
 * Resolves a selectable Text node and caret position from coordinates and touch target.
 * Returns null if the touch is on empty background or no valid non-empty Text node is found.
 */
export function resolveSelectableTextCaret(
	doc: Document,
	target: EventTarget | null,
	x: number,
	y: number
): { caret: { node: Node; offset: number }; textNode: Text } | null {
	if (!doc) {
		return null;
	}

	// 1. Resolve caret from document coordinates
	const caret = getCaretPositionFromPoint(doc, x, y);
	if (caret && caret.node) {
		let textNode: Text | null = null;
		let offset = caret.offset;

		if (domInstanceOf(caret.node, Text)) {
			textNode = caret.node;
		} else if (domInstanceOf(caret.node, Element)) {
			const normalized = normalizeCaretNodeOffset(caret.node, offset);
			if (domInstanceOf(normalized.node, Text)) {
				textNode = normalized.node;
				offset = normalized.offset;
			}
		}

		if (textNode && textNode.textContent && textNode.textContent.trim().length > 0) {
			return {
				caret: {
					node: textNode,
					offset: Math.max(0, Math.min(offset, textNode.length)),
				},
				textNode,
			};
		}
	}

	// 2. Fallback: if caret is null or landed on an element container, search within target
	let el: Element | null = null;
	if (target instanceof Element || (target as any)?.nodeType === Node.ELEMENT_NODE) {
		el = target as Element;
	} else if ((target as any)?.parentElement) {
		el = (target as any).parentElement as Element;
	}

	if (!el || el === doc.body || el === doc.documentElement) {
		return null;
	}

	const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
	let curr = walker.nextNode();
	while (curr) {
		if (domInstanceOf(curr, Text) && curr.textContent && curr.textContent.trim().length > 0) {
			return {
				caret: {
					node: curr,
					offset: 0,
				},
				textNode: curr,
			};
		}
		curr = walker.nextNode();
	}

	return null;
}

/**
 * Diagnostic logger for Mobile Direct Selection gesture arbitration.
 */
function logDirectSelectionClassification(
	target: Element | null,
	x: number,
	y: number,
	selectable: { caret: { node: Node; offset: number }; textNode: Text } | null,
	glyphHit: boolean,
	gestureKind: MobileGestureKind
): void {
	const targetEl = target instanceof Element ? target : (target as any)?.parentElement || null;
	const targetTag = targetEl?.tagName?.toLowerCase() || 'unknown';
	const targetClass = typeof targetEl?.className === 'string' ? targetEl.className.slice(0, 50) : '';
	const caretFound = Boolean(selectable?.caret?.node);
	const caretNodeType = selectable?.caret?.node?.nodeType ?? null;
	const fullText = selectable?.textNode?.textContent || '';
	const caretOffset = selectable?.caret?.offset ?? null;
	const offset = caretOffset ?? 0;
	const start = Math.max(0, offset - 10);
	const caretTextSample = fullText.slice(start, start + 20).trim();

	logMobileEvent('DirectSelection', 'GestureClassified', {
		targetTag,
		targetClass,
		x: Math.round(x),
		y: Math.round(y),
		caretFound,
		caretNodeType,
		caretTextSample,
		caretOffset,
		glyphHit,
		gestureKind,
	});
}

/**
 * Performs a localized glyph bounding-box hit test around the resolved caret position.
 */
export function isPointOnTextGlyph(
	doc: Document,
	caretPos: { node: Node; offset: number } | null,
	x: number,
	y: number,
	tolerance = 5
): boolean {
	if (!doc || !caretPos || !caretPos.node) {
		return false;
	}

	let textNode: Text | null = null;
	let offset = caretPos.offset;

	if (domInstanceOf(caretPos.node, Text)) {
		textNode = caretPos.node;
	} else if (domInstanceOf(caretPos.node, Element)) {
		const normalized = normalizeCaretNodeOffset(caretPos.node, offset);
		if (domInstanceOf(normalized.node, Text)) {
			textNode = normalized.node;
			offset = normalized.offset;
		}
	}

	if (!textNode || !textNode.textContent) {
		return false;
	}

	const content = textNode.textContent;
	const len = content.length;
	if (len === 0) {
		return false;
	}

	const offsetsToTest: Array<[number, number]> = [];
	if (offset > 0) {
		offsetsToTest.push([offset - 1, offset]);
	}
	if (offset < len) {
		offsetsToTest.push([offset, offset + 1]);
	}
	if (offset + 1 < len) {
		offsetsToTest.push([offset + 1, offset + 2]);
	}

	if (offsetsToTest.length === 0) {
		return false;
	}

	const pointInExpandedRect = (rect: DOMRect | ClientRect, tol: number): boolean => {
		return (
			x >= rect.left - tol &&
			x <= rect.right + tol &&
			y >= rect.top - tol &&
			y <= rect.bottom + tol
		);
	};

	let hasMeasuredRect = false;

	try {
		for (const [start, end] of offsetsToTest) {
			const char = content.slice(start, end);
			const range = doc.createRange();
			range.setStart(textNode, start);
			range.setEnd(textNode, end);

			const rects: Array<DOMRect | ClientRect> =
				typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : [];
			if (rects.length === 0 && typeof range.getBoundingClientRect === 'function') {
				const bRect = range.getBoundingClientRect();
				if (bRect && (bRect.width > 0 || bRect.height > 0)) {
					rects.push(bRect);
				}
			}

			for (const r of rects) {
				if (r.width > 0 || r.height > 0) {
					hasMeasuredRect = true;
					const tol = /^\s+$/.test(char) ? 1 : tolerance;
					if (pointInExpandedRect(r, tol)) {
						return true;
					}
				}
			}
		}
	} catch {
		return false;
	}

	if (hasMeasuredRect) {
		return false;
	}

	return true;
}

/**
 * Injects CSS to permanently disable native iOS WebKit text selection and callout menu on Mobile.
 */
function applyDirectSelectionDisablingStyles(doc: Document): void {
	const styleId = 'zora-direct-selection-style';
	let styleEl = doc.getElementById(styleId) as HTMLStyleElement | null;
	if (!styleEl) {
		styleEl = doc.createElement('style');
		styleEl.id = styleId;
		styleEl.textContent = `
			html,
			body,
			body * {
				-webkit-user-select: none !important;
				user-select: none !important;
				-webkit-touch-callout: none !important;
			}
			input,
			textarea,
			select,
			[contenteditable="true"] {
				-webkit-user-select: auto !important;
				user-select: auto !important;
				-webkit-touch-callout: default !important;
			}
		`;
		doc.head?.appendChild(styleEl);
	}
	doc.documentElement?.classList.add('zora-direct-selection-enabled');
	doc.body?.classList.add('zora-direct-selection-enabled');
}

interface FrameTracking {
	frame: ReaderFrame;
	overlay: MobileDirectSelectionOverlay;
	cleanups: Array<() => void>;
}

export interface MobileDirectSelectionControllerOptions {
	onStateChange?: (state: MobileDirectSelectionState) => void;
	onSelectionComplete?: (selection: MobileDirectSelectionContext) => void;
}

export class MobileDirectSelectionController {
	private mode: MobileDirectSelectionMode = 'idle';
	private activeSelection: MobileDirectSelectionContext | null = null;
	private trackedFrames = new Map<Document, FrameTracking>();
	private onStateChange?: (state: MobileDirectSelectionState) => void;
	private onSelectionComplete?: (selection: MobileDirectSelectionContext) => void;

	// Gesture tracking state
	private activeDoc: Document | null = null;
	private activeTracking: FrameTracking | null = null;
	private activeGestureKind: MobileGestureKind | null = null;
	private startPoint: { x: number; y: number } | null = null;
	private anchorPos: { node: Node; offset: number } | null = null;
	private currentRange: Range | null = null;
	private isDragging = false;
	private pendingRafId: number | null = null;

	// Interactive gesture state
	private interactiveStartPoint: { x: number; y: number } | null = null;
	private interactiveCancelled = false;

	constructor(options?: MobileDirectSelectionControllerOptions) {
		this.onStateChange = options?.onStateChange;
		this.onSelectionComplete = options?.onSelectionComplete;
	}

	getMode(): MobileDirectSelectionMode {
		return this.mode;
	}

	getSelection(): MobileDirectSelectionContext | null {
		return this.activeSelection;
	}

	getActiveGestureKind(): MobileGestureKind | null {
		return this.activeGestureKind;
	}

	/**
	 * Clears visual overlay and selection context.
	 */
	clearSelection(): void {
		this.cancelPendingRaf();
		this.clearOverlays();
		this.activeSelection = null;
		this.mode = 'idle';
		this.clearActiveGesture();
		this.notifyStateChange();
	}

	cancel(): void {
		this.clearSelection();
	}

	/**
	 * Updates the current custom selection when expanding granularity (word, sentence, paragraph).
	 */
	updateExpandedSelection(newRange: Range, newText: string, newCfiRange: string): void {
		if (!this.activeSelection || !newRange || !newText || !newCfiRange) {
			return;
		}

		const doc = this.activeSelection.frameDocument;
		const tracking = this.trackedFrames.get(doc);
		if (tracking) {
			tracking.overlay.render(newRange);
		}

		const iframe = (doc.defaultView?.frameElement as HTMLElement) || null;
		const iframeRect = iframe?.getBoundingClientRect() || { left: 0, top: 0 };
		const bRect = typeof newRange.getBoundingClientRect === 'function'
			? newRange.getBoundingClientRect()
			: new DOMRect(0, 0, 0, 0);
		const adjustedRect = new DOMRect(
			bRect.left + iframeRect.left,
			bRect.top + iframeRect.top,
			bRect.width,
			bRect.height
		);
		const rawRects = typeof newRange.getClientRects === 'function'
			? Array.from(newRange.getClientRects())
			: [];
		const adjustedRects = rawRects.map(
			(r) => new DOMRect(r.left + iframeRect.left, r.top + iframeRect.top, r.width, r.height)
		);

		this.activeSelection = {
			...this.activeSelection,
			range: newRange,
			text: newText,
			cfiRange: newCfiRange,
			rect: adjustedRect,
			rects: adjustedRects.length ? adjustedRects : [adjustedRect],
		};

		this.notifyStateChange();
	}

	/**
	 * Alias for backward compatibility with sentence expansion callers.
	 */
	updateExpandedSentence(newRange: Range, newText: string, newCfiRange: string): void {
		this.updateExpandedSelection(newRange, newText, newCfiRange);
	}

	/**
	 * Synchronizes the list of active reader frames.
	 */
	syncFrames(frames: ReaderFrame[]): void {
		const currentDocs = new Set(frames.map((f) => f.frameDocument).filter(Boolean));

		// Detach removed frames
		for (const [doc, tracking] of this.trackedFrames.entries()) {
			if (!currentDocs.has(doc)) {
				this.detachFrame(doc, tracking);
			}
		}

		// Attach new frames
		for (const frame of frames) {
			if (frame?.frameDocument && !this.trackedFrames.has(frame.frameDocument)) {
				this.attachFrame(frame);
			}
		}
	}

	private attachFrame(frame: ReaderFrame): void {
		const doc = frame.frameDocument;
		const overlay = new MobileDirectSelectionOverlay(doc);
		const cleanups: Array<() => void> = [];

		applyDirectSelectionDisablingStyles(doc);

		const onTouchStartCapture = (e: TouchEvent) => {
			if (e.touches.length !== 1) {
				this.clearActiveGesture();
				return;
			}

			// Clear previous selection overlay if one was active
			if (this.activeSelection) {
				overlay.clear();
				this.activeSelection = null;
				this.mode = 'idle';
			}

			const touch = e.touches[0];
			const target = (e.target as Element) || (e.composedPath ? (e.composedPath()[0] as Element) : null);

			// 1. Native controls (input, textarea, select, contenteditable, media)
			if (isNativeControlTarget(target)) {
				this.activeGestureKind = 'native-control';
				this.activeDoc = doc;
				logDirectSelectionClassification(target, touch.clientX, touch.clientY, null, false, 'native-control');
				return;
			}

			// 2. Interactive elements (links, buttons, Note Markers, etc.)
			if (isInteractiveTarget(target)) {
				this.activeGestureKind = 'interactive';
				this.activeDoc = doc;
				this.interactiveStartPoint = { x: touch.clientX, y: touch.clientY };
				this.interactiveCancelled = false;
				logDirectSelectionClassification(target, touch.clientX, touch.clientY, null, false, 'interactive');
				return;
			}

			// 3. Standalone media (img, svg, canvas not in <a>)
			if (isBlockedStandaloneMedia(target)) {
				this.activeGestureKind = 'blocked';
				this.activeDoc = doc;
				if (e.cancelable) {
					e.preventDefault();
				}
				e.stopPropagation();
				e.stopImmediatePropagation?.();
				logDirectSelectionClassification(target, touch.clientX, touch.clientY, null, false, 'blocked');
				return;
			}

			// 4. Resolve selectable text caret
			const selectable = resolveSelectableTextCaret(doc, target, touch.clientX, touch.clientY);
			const glyphHit = selectable ? isPointOnTextGlyph(doc, selectable.caret, touch.clientX, touch.clientY) : false;

			if (!selectable) {
				// Blank area, empty container, background with no non-empty text node
				this.activeGestureKind = 'blocked';
				this.activeDoc = doc;
				if (e.cancelable) {
					e.preventDefault();
				}
				e.stopPropagation();
				e.stopImmediatePropagation?.();
				logDirectSelectionClassification(target, touch.clientX, touch.clientY, null, false, 'blocked');
				return;
			}

			// 5. Valid text selection
			this.activeGestureKind = 'text-selection';
			if (e.cancelable) {
				e.preventDefault();
			}
			e.stopPropagation();
			e.stopImmediatePropagation?.();

			this.activeDoc = doc;
			this.activeTracking = this.trackedFrames.get(doc) || null;
			this.startPoint = { x: touch.clientX, y: touch.clientY };
			this.anchorPos = selectable.caret;
			this.isDragging = false;
			this.currentRange = null;
			this.mode = 'selecting';

			logDirectSelectionClassification(target, touch.clientX, touch.clientY, selectable, glyphHit, 'text-selection');
		};

		const onTouchMoveCapture = (e: TouchEvent) => {
			if (e.touches.length !== 1 || !this.activeGestureKind) {
				return;
			}

			const touch = e.touches[0];

			if (this.activeGestureKind === 'native-control') {
				// Let native control handle its own scrolling/touch, but body bubble stops Foliate
				return;
			}

			if (this.activeGestureKind === 'interactive') {
				if (this.interactiveStartPoint) {
					const dist = Math.hypot(
						touch.clientX - this.interactiveStartPoint.x,
						touch.clientY - this.interactiveStartPoint.y
					);
					if (dist >= 8) {
						this.interactiveCancelled = true;
						if (e.cancelable) {
							e.preventDefault();
						}
						e.stopPropagation();
						e.stopImmediatePropagation?.();
					}
				}
				return;
			}

			if (this.activeGestureKind === 'blocked') {
				if (e.cancelable) {
					e.preventDefault();
				}
				e.stopPropagation();
				e.stopImmediatePropagation?.();
				return;
			}

			if (this.activeGestureKind === 'text-selection') {
				if (!this.startPoint) {
					return;
				}
				if (e.cancelable) {
					e.preventDefault();
				}
				e.stopPropagation();
				e.stopImmediatePropagation?.();

				if (!this.anchorPos) {
					return;
				}

				const dist = Math.hypot(touch.clientX - this.startPoint.x, touch.clientY - this.startPoint.y);

				if (!this.isDragging) {
					if (dist < 5) {
						return;
					}
					this.isDragging = true;
				}

				const clientX = touch.clientX;
				const clientY = touch.clientY;

				// Throttle overlay update with RAF to prevent any main-thread lag
				this.scheduleRaf(() => {
					const focusPos = getCaretPositionFromPoint(doc, clientX, clientY);
					if (focusPos && this.anchorPos) {
						const range = buildNormalizedRange(
							doc,
							this.anchorPos.node,
							this.anchorPos.offset,
							focusPos.node,
							focusPos.offset
						);
						if (range && !range.collapsed) {
							this.currentRange = range;
							overlay.render(range);
						}
					}
				});
			}
		};

		const onTouchEndCapture = (e: TouchEvent) => {
			const kind = this.activeGestureKind;

			if (kind === 'native-control') {
				this.clearActiveGesture();
				return;
			}

			if (kind === 'interactive') {
				if (this.interactiveCancelled) {
					// Accidental drag movement >= 8px on interactive element: cancel click, prevent page flip
					if (e.cancelable) {
						e.preventDefault();
					}
					e.stopPropagation();
					e.stopImmediatePropagation?.();
				}
				// If not cancelled (< 8px), do not preventDefault so native click / Foliate link navigation fires
				this.clearActiveGesture();
				return;
			}

			if (kind === 'blocked') {
				if (e.cancelable) {
					e.preventDefault();
				}
				e.stopPropagation();
				e.stopImmediatePropagation?.();
				this.clearActiveGesture();
				return;
			}

			if (kind === 'text-selection') {
				if (this.startPoint) {
					if (e.cancelable) {
						e.preventDefault();
					}
					e.stopPropagation();
					e.stopImmediatePropagation?.();
				}

				this.cancelPendingRaf();

				if (this.isDragging && this.currentRange && !this.currentRange.collapsed) {
					const range = this.currentRange;
					const text = range.toString().trim();
					const cfiRange = frame.cfiFromRange ? frame.cfiFromRange(range) : null;

					if (text && cfiRange) {
						const iframe = (doc.defaultView?.frameElement as HTMLElement) || null;
						const iframeRect = iframe?.getBoundingClientRect() || { left: 0, top: 0 };
						const bRect = typeof range.getBoundingClientRect === 'function'
							? range.getBoundingClientRect()
							: new DOMRect(0, 0, 0, 0);
						const adjustedRect = new DOMRect(
							bRect.left + iframeRect.left,
							bRect.top + iframeRect.top,
							bRect.width,
							bRect.height
						);
						const rawRects = typeof range.getClientRects === 'function'
							? Array.from(range.getClientRects())
							: [];
						const adjustedRects = rawRects.map(
							(r) => new DOMRect(r.left + iframeRect.left, r.top + iframeRect.top, r.width, r.height)
						);

						const selectionContext: MobileDirectSelectionContext = {
							source: 'mobile-direct',
							range,
							text,
							cfiRange,
							rect: adjustedRect,
							rects: adjustedRects.length ? adjustedRects : [adjustedRect],
							frame,
							frameDocument: doc,
							clear: () => this.clearSelection(),
						};

						this.activeSelection = selectionContext;
						this.mode = 'selected';

						this.onSelectionComplete?.(selectionContext);
						this.notifyStateChange();

						logMobileEvent('DirectSelection', 'DragSelected', {
							length: text.length,
							cfiRange,
						});

						this.clearActiveGesture();
						return;
					}
				}

				// TAP behavior: if distance < 5px and not dragging, auto-select whole word at tap point
				if (!this.isDragging && this.anchorPos) {
					let textNode: Text | null = null;
					let offset = this.anchorPos.offset;

					if (domInstanceOf(this.anchorPos.node, Text)) {
						textNode = this.anchorPos.node;
					} else if (domInstanceOf(this.anchorPos.node, Element)) {
						const normalized = normalizeCaretNodeOffset(this.anchorPos.node, offset);
						if (domInstanceOf(normalized.node, Text)) {
							textNode = normalized.node;
							offset = normalized.offset;
						}
					}

					if (textNode) {
						const wordResult = extractWordRangeFromTextNode(doc, textNode, offset);
						if (wordResult && wordResult.text && !wordResult.range.collapsed) {
							const wordRange = wordResult.range;
							const wordText = wordResult.text;
							const cfiRange = frame.cfiFromRange ? frame.cfiFromRange(wordRange) : null;

							if (cfiRange) {
								overlay.render(wordRange);

								const iframe = (doc.defaultView?.frameElement as HTMLElement) || null;
								const iframeRect = iframe?.getBoundingClientRect() || { left: 0, top: 0 };
								const bRect = typeof wordRange.getBoundingClientRect === 'function'
									? wordRange.getBoundingClientRect()
									: new DOMRect(0, 0, 0, 0);
								const adjustedRect = new DOMRect(
									bRect.left + iframeRect.left,
									bRect.top + iframeRect.top,
									bRect.width,
									bRect.height
								);
								const rawRects = typeof wordRange.getClientRects === 'function'
									? Array.from(wordRange.getClientRects())
									: [];
								const adjustedRects = rawRects.map(
									(r) => new DOMRect(r.left + iframeRect.left, r.top + iframeRect.top, r.width, r.height)
								);

								const selectionContext: MobileDirectSelectionContext = {
									source: 'mobile-direct',
									range: wordRange,
									text: wordText,
									cfiRange,
									rect: adjustedRect,
									rects: adjustedRects.length ? adjustedRects : [adjustedRect],
									frame,
									frameDocument: doc,
									initialWordRange: wordRange.cloneRange(),
									initialWordText: wordText,
									clear: () => this.clearSelection(),
								};

								this.activeSelection = selectionContext;
								this.mode = 'selected';

								this.onSelectionComplete?.(selectionContext);
								this.notifyStateChange();

								logMobileEvent('DirectSelection', 'TapWordSelected', {
									word: wordText,
									cfiRange,
								});

								this.clearActiveGesture();
								return;
							}
						}
					}
				}

				this.clearSelection();
				return;
			}

			// Empty selection or cancelled tap
			this.clearSelection();
		};

		const onTouchCancelCapture = (e?: TouchEvent) => {
			if (this.activeGestureKind === 'text-selection' || this.activeGestureKind === 'blocked') {
				if (e?.cancelable) {
					e.preventDefault();
				}
				e?.stopPropagation();
				e?.stopImmediatePropagation?.();
			}
			this.cancelPendingRaf();
			this.clearSelection();
		};

		const onContextMenu = (e: MouseEvent) => {
			e.preventDefault();
		};

		// Body bubble guard: prevents interactive & native-control touches from bubbling to document (Foliate paginator)
		const onBodyTouchBubble = (e: TouchEvent) => {
			e.stopPropagation();
		};

		const eventOptions: AddEventListenerOptions = { passive: false, capture: true };
		doc.addEventListener('touchstart', onTouchStartCapture, eventOptions);
		doc.addEventListener('touchmove', onTouchMoveCapture, eventOptions);
		doc.addEventListener('touchend', onTouchEndCapture, eventOptions);
		doc.addEventListener('touchcancel', onTouchCancelCapture, eventOptions);
		doc.addEventListener('contextmenu', onContextMenu, { capture: true });

		const body = doc.body;
		if (body) {
			body.addEventListener('touchstart', onBodyTouchBubble, false);
			body.addEventListener('touchmove', onBodyTouchBubble, false);
			body.addEventListener('touchend', onBodyTouchBubble, false);
			body.addEventListener('touchcancel', onBodyTouchBubble, false);
		}

		cleanups.push(() => {
			doc.removeEventListener('touchstart', onTouchStartCapture, true);
			doc.removeEventListener('touchmove', onTouchMoveCapture, true);
			doc.removeEventListener('touchend', onTouchEndCapture, true);
			doc.removeEventListener('touchcancel', onTouchCancelCapture, true);
			doc.removeEventListener('contextmenu', onContextMenu, true);
			if (body) {
				body.removeEventListener('touchstart', onBodyTouchBubble, false);
				body.removeEventListener('touchmove', onBodyTouchBubble, false);
				body.removeEventListener('touchend', onBodyTouchBubble, false);
				body.removeEventListener('touchcancel', onBodyTouchBubble, false);
			}
		});

		this.trackedFrames.set(doc, { frame, overlay, cleanups });
	}

	private detachFrame(doc: Document, tracking: FrameTracking): void {
		tracking.overlay.clear();
		for (const cleanup of tracking.cleanups) {
			cleanup();
		}
		this.trackedFrames.delete(doc);
	}

	private scheduleRaf(callback: () => void): void {
		if (this.pendingRafId !== null) {
			return;
		}
		const win = this.activeDoc?.defaultView || window;
		this.pendingRafId = win.requestAnimationFrame(() => {
			this.pendingRafId = null;
			callback();
		});
	}

	private cancelPendingRaf(): void {
		if (this.pendingRafId !== null) {
			const win = this.activeDoc?.defaultView || window;
			win.cancelAnimationFrame(this.pendingRafId);
			this.pendingRafId = null;
		}
	}

	private clearActiveGesture(): void {
		this.activeDoc = null;
		this.activeTracking = null;
		this.activeGestureKind = null;
		this.startPoint = null;
		this.anchorPos = null;
		this.currentRange = null;
		this.isDragging = false;
		this.interactiveStartPoint = null;
		this.interactiveCancelled = false;
		this.cancelPendingRaf();
	}

	private clearOverlays(): void {
		for (const tracking of this.trackedFrames.values()) {
			tracking.overlay.clear();
		}
	}

	private notifyStateChange(): void {
		this.onStateChange?.({
			mode: this.mode,
			selection: this.activeSelection,
			gestureKind: this.activeGestureKind,
		});
	}

	dispose(): void {
		this.cancelPendingRaf();
		for (const [doc, tracking] of this.trackedFrames.entries()) {
			this.detachFrame(doc, tracking);
		}
		this.trackedFrames.clear();
		this.clearActiveGesture();
		this.activeSelection = null;
		this.mode = 'idle';
	}
}
