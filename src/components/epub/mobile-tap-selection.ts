import type { ReaderFrame } from '../../services/epub/reader-engine-types';
import { domInstanceOf } from '../../utils/dom-instance-of';
import { logMobileEvent } from '../../utils/zora-mobile-logger';

export type MobileTapSelectionMode = 'idle' | 'armed' | 'selected';

export interface MobileTapSelectionContext {
	source: 'mobile-tap';
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

export interface MobileTapSelectionState {
	mode: MobileTapSelectionMode;
	selection: MobileTapSelectionContext | null;
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

function normalizeCaretNodeOffset(node: Node, offset: number): { node: Node; offset: number } {
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
export class MobileSelectionOverlay {
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

		let existing = root.querySelector('.zora-custom-selection-overlay-layer') as HTMLDivElement | null;
		if (!existing) {
			existing = this.doc.createElement('div');
			existing.className = 'zora-custom-selection-overlay-layer';
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
			box.className = 'zora-custom-selection-box';
			const top = rect.top + scrollY;
			const left = rect.left + scrollX;
			box.style.cssText = `position: absolute; top: ${top}px; left: ${left}px; width: ${rect.width}px; height: ${rect.height}px; background-color: rgba(138, 92, 246, 0.32); border-radius: 2px; pointer-events: none; mix-blend-mode: multiply;`;
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
 * Injects/removes CSS to temporarily disable native iOS callout menu during armed state.
 */
function applyTouchCalloutDisablingStyles(doc: Document, enable: boolean): void {
	const styleId = 'zora-touch-callout-disabled-style';
	let styleEl = doc.getElementById(styleId) as HTMLStyleElement | null;
	if (enable) {
		if (!styleEl) {
			styleEl = doc.createElement('style');
			styleEl.id = styleId;
			styleEl.textContent = `
				.zora-tap-select-armed,
				.zora-tap-select-armed * {
					-webkit-touch-callout: none !important;
				}
			`;
			doc.head?.appendChild(styleEl);
		}
		doc.documentElement?.classList.add('zora-tap-select-armed');
		doc.body?.classList.add('zora-tap-select-armed');
	} else {
		doc.documentElement?.classList.remove('zora-tap-select-armed');
		doc.body?.classList.remove('zora-tap-select-armed');
		if (styleEl?.parentNode) {
			styleEl.parentNode.removeChild(styleEl);
		}
	}
}

interface FrameTracking {
	frame: ReaderFrame;
	overlay: MobileSelectionOverlay;
	cleanups: Array<() => void>;
}

export interface MobileTapSelectionControllerOptions {
	onStateChange?: (state: MobileTapSelectionState) => void;
	onSelectionComplete?: (selection: MobileTapSelectionContext) => void;
}

export class MobileTapSelectionController {
	private mode: MobileTapSelectionMode = 'idle';
	private activeSelection: MobileTapSelectionContext | null = null;
	private trackedFrames = new Map<Document, FrameTracking>();
	private onStateChange?: (state: MobileTapSelectionState) => void;
	private onSelectionComplete?: (selection: MobileTapSelectionContext) => void;

	// Tap detection state
	private startTouch: { x: number; y: number; time: number } | null = null;

	constructor(options?: MobileTapSelectionControllerOptions) {
		this.onStateChange = options?.onStateChange;
		this.onSelectionComplete = options?.onSelectionComplete;
	}

	getMode(): MobileTapSelectionMode {
		return this.mode;
	}

	getSelection(): MobileTapSelectionContext | null {
		return this.activeSelection;
	}

	isArmed(): boolean {
		return this.mode === 'armed';
	}

	/**
	 * Enters armed selection mode. Next tap selects word.
	 */
	arm(): void {
		this.mode = 'armed';
		this.startTouch = null;
		for (const doc of this.trackedFrames.keys()) {
			applyTouchCalloutDisablingStyles(doc, true);
		}
		this.notifyStateChange();
		logMobileEvent('TapSelection', 'Armed');
	}

	/**
	 * Cancels armed selection mode.
	 */
	cancel(): void {
		this.mode = 'idle';
		this.startTouch = null;
		this.clearOverlays();
		this.activeSelection = null;
		for (const doc of this.trackedFrames.keys()) {
			applyTouchCalloutDisablingStyles(doc, false);
		}
		this.notifyStateChange();
		logMobileEvent('TapSelection', 'Cancelled');
	}

	/**
	 * Clears visual overlay and selection context.
	 */
	clearSelection(): void {
		this.clearOverlays();
		this.activeSelection = null;
		if (this.mode !== 'idle' && this.mode !== 'armed') {
			this.mode = 'idle';
		}
		for (const doc of this.trackedFrames.keys()) {
			applyTouchCalloutDisablingStyles(doc, false);
		}
		this.notifyStateChange();
	}

	/**
	 * Updates the current tap selection when switching granularity (词 | 句 | 段).
	 */
	updateSelectionRange(newRange: Range, newText: string, newCfiRange: string): void {
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
	 * Synchronizes active reader frames.
	 */
	syncFrames(frames: ReaderFrame[]): void {
		const currentDocs = new Set(frames.map((f) => f.frameDocument).filter(Boolean));

		for (const [doc, tracking] of this.trackedFrames.entries()) {
			if (!currentDocs.has(doc)) {
				this.detachFrame(doc, tracking);
			}
		}

		for (const frame of frames) {
			if (frame?.frameDocument && !this.trackedFrames.has(frame.frameDocument)) {
				this.attachFrame(frame);
			}
		}
	}

	private attachFrame(frame: ReaderFrame): void {
		const doc = frame.frameDocument;
		const overlay = new MobileSelectionOverlay(doc);
		const cleanups: Array<() => void> = [];

		if (this.isArmed()) {
			applyTouchCalloutDisablingStyles(doc, true);
		}

		const onTouchStart = (e: TouchEvent) => {
			if (this.mode !== 'armed' || e.touches.length !== 1) {
				return;
			}
			const touch = e.touches[0];
			this.startTouch = {
				x: touch.clientX,
				y: touch.clientY,
				time: Date.now(),
			};
		};

		const onTouchMove = (e: TouchEvent) => {
			if (this.mode !== 'armed' || !this.startTouch || e.touches.length !== 1) {
				return;
			}
			const touch = e.touches[0];
			const dist = Math.hypot(touch.clientX - this.startTouch.x, touch.clientY - this.startTouch.y);

			// If finger moved > 10px, user is scrolling! Disarm immediately and let native scroll proceed.
			if (dist > 10) {
				this.cancel();
			}
		};

		const onTouchEnd = (e: TouchEvent) => {
			if (this.mode !== 'armed' || !this.startTouch) {
				return;
			}

			const touch = e.changedTouches[0];
			if (!touch) {
				this.cancel();
				return;
			}

			const dist = Math.hypot(touch.clientX - this.startTouch.x, touch.clientY - this.startTouch.y);
			const duration = Date.now() - this.startTouch.time;
			this.startTouch = null;

			// If dragged or held for too long (> 600ms), cancel selection and let default interaction happen
			if (dist > 10 || duration > 600) {
				this.cancel();
				return;
			}

			// Valid TAP detected!
			const caretPos = getCaretPositionFromPoint(doc, touch.clientX, touch.clientY);
			if (!caretPos || !domInstanceOf(caretPos.node, Text)) {
				this.cancel();
				return;
			}

			const wordResult = extractWordRangeFromTextNode(doc, caretPos.node, caretPos.offset);
			if (!wordResult || !wordResult.text) {
				this.cancel();
				return;
			}

			const { range, text } = wordResult;
			const cfiRange = frame.cfiFromRange ? frame.cfiFromRange(range) : null;
			if (!cfiRange) {
				this.cancel();
				return;
			}

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

			// Render semi-transparent Zora overlay box
			overlay.render(range);

			const selectionContext: MobileTapSelectionContext = {
				source: 'mobile-tap',
				range,
				text,
				cfiRange,
				rect: adjustedRect,
				rects: adjustedRects.length ? adjustedRects : [adjustedRect],
				frame,
				frameDocument: doc,
				initialWordRange: range.cloneRange(),
				initialWordText: text,
				clear: () => this.clearSelection(),
			};

			this.activeSelection = selectionContext;
			this.mode = 'selected';

			// Remove temporary touch-callout disabling styles
			for (const d of this.trackedFrames.keys()) {
				applyTouchCalloutDisablingStyles(d, false);
			}

			this.onSelectionComplete?.(selectionContext);
			this.notifyStateChange();

			logMobileEvent('TapSelection', 'WordSelected', {
				text,
				cfiRange,
			});
		};

		const onTouchCancel = () => {
			if (this.mode === 'armed') {
				this.cancel();
			}
		};

		const onContextMenu = (e: MouseEvent) => {
			if (this.isArmed()) {
				e.preventDefault();
			}
		};

		doc.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
		doc.addEventListener('touchmove', onTouchMove, { passive: true, capture: true });
		doc.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
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
		applyTouchCalloutDisablingStyles(doc, false);
		this.trackedFrames.delete(doc);
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
		for (const [doc, tracking] of this.trackedFrames.entries()) {
			this.detachFrame(doc, tracking);
		}
		this.trackedFrames.clear();
		this.startTouch = null;
		this.activeSelection = null;
		this.mode = 'idle';
	}
}
