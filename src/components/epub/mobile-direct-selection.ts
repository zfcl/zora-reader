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

export interface MobileDirectSelectionState {
	mode: MobileDirectSelectionMode;
	selection: MobileDirectSelectionContext | null;
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
	private startPoint: { x: number; y: number } | null = null;
	private anchorPos: { node: Node; offset: number } | null = null;
	private currentRange: Range | null = null;
	private isDragging = false;
	private pendingRafId: number | null = null;

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

		const onTouchStart = (e: TouchEvent) => {
			if (e.touches.length !== 1) {
				return;
			}
			const touch = e.touches[0];
			this.activeDoc = doc;
			this.activeTracking = this.trackedFrames.get(doc) || null;
			this.startPoint = { x: touch.clientX, y: touch.clientY };
			this.anchorPos = getCaretPositionFromPoint(doc, touch.clientX, touch.clientY);
			this.isDragging = false;
			this.currentRange = null;
			this.mode = 'selecting';

			// If previous selection existed, clear visual overlay for new gesture
			if (this.activeSelection) {
				overlay.clear();
			}
		};

		const onTouchMove = (e: TouchEvent) => {
			if (!this.anchorPos || !this.startPoint || e.touches.length !== 1) {
				return;
			}
			const touch = e.touches[0];
			const dist = Math.hypot(touch.clientX - this.startPoint.x, touch.clientY - this.startPoint.y);

			if (!this.isDragging) {
				if (dist < 5) {
					return;
				}
				this.isDragging = true;
			}

			if (e.cancelable) {
				e.preventDefault();
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
		};

		const onTouchEnd = (e: TouchEvent) => {
			this.cancelPendingRaf();

			if (this.isDragging && this.currentRange && !this.currentRange.collapsed) {
				if (e.cancelable) {
					e.preventDefault();
				}
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

			// Empty selection or cancelled tap
			this.clearSelection();
		};

		const onTouchCancel = () => {
			this.cancelPendingRaf();
			this.clearSelection();
		};

		const onContextMenu = (e: MouseEvent) => {
			e.preventDefault();
		};

		const eventOptions: AddEventListenerOptions = { passive: false, capture: true };
		doc.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
		doc.addEventListener('touchmove', onTouchMove, eventOptions);
		doc.addEventListener('touchend', onTouchEnd, eventOptions);
		doc.addEventListener('touchcancel', onTouchCancel, { passive: true, capture: true });
		doc.addEventListener('contextmenu', onContextMenu, { capture: true });

		cleanups.push(() => {
			doc.removeEventListener('touchstart', onTouchStart, true);
			doc.removeEventListener('touchmove', onTouchMove, true);
			doc.removeEventListener('touchend', onTouchEnd, true);
			doc.removeEventListener('touchcancel', onTouchCancel, true);
			doc.removeEventListener('contextmenu', onContextMenu, true);
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
		this.startPoint = null;
		this.anchorPos = null;
		this.currentRange = null;
		this.isDragging = false;
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
