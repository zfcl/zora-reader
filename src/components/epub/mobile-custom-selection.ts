import type { ReaderFrame } from '../../services/epub/reader-engine-types';
import { domInstanceOf } from '../../utils/dom-instance-of';
import { logMobileEvent } from '../../utils/zora-mobile-logger';

export type MobileSelectionMode = 'idle' | 'armed' | 'selecting' | 'selected';

export interface MobileCustomSelectionContext {
	source: 'mobile-custom';
	range: Range;
	text: string;
	cfiRange: string;
	rect: DOMRect;
	rects: DOMRect[];
	frame: ReaderFrame;
	frameDocument: Document;
	clear: () => void;
}

export interface MobileSelectionState {
	mode: MobileSelectionMode;
	selection: MobileCustomSelectionContext | null;
}

/**
 * Resolves character position from touch/pointer coordinates in a document viewport.
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
 * Injects/removes CSS to disable native iOS text selection and callout menu during selection mode.
 */
function applySelectionDisablingStyles(doc: Document, enable: boolean): void {
	const styleId = 'zora-custom-selection-style';
	let styleEl = doc.getElementById(styleId) as HTMLStyleElement | null;
	if (enable) {
		if (!styleEl) {
			styleEl = doc.createElement('style');
			styleEl.id = styleId;
			styleEl.textContent = `
				.zora-custom-selection-enabled,
				.zora-custom-selection-enabled body,
				.zora-custom-selection-enabled * {
					-webkit-user-select: none !important;
					user-select: none !important;
					-webkit-touch-callout: none !important;
				}
			`;
			doc.head?.appendChild(styleEl);
		}
		doc.documentElement?.classList.add('zora-custom-selection-enabled');
		doc.body?.classList.add('zora-custom-selection-enabled');
	} else {
		doc.documentElement?.classList.remove('zora-custom-selection-enabled');
		doc.body?.classList.remove('zora-custom-selection-enabled');
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

export interface MobileCustomSelectionControllerOptions {
	onStateChange?: (state: MobileSelectionState) => void;
	onSelectionComplete?: (selection: MobileCustomSelectionContext) => void;
}

export class MobileCustomSelectionController {
	private mode: MobileSelectionMode = 'idle';
	private activeSelection: MobileCustomSelectionContext | null = null;
	private trackedFrames = new Map<Document, FrameTracking>();
	private onStateChange?: (state: MobileSelectionState) => void;
	private onSelectionComplete?: (selection: MobileCustomSelectionContext) => void;

	// Gesture tracking state
	private activeDoc: Document | null = null;
	private activeTracking: FrameTracking | null = null;
	private startPoint: { x: number; y: number } | null = null;
	private anchorPos: { node: Node; offset: number } | null = null;
	private currentRange: Range | null = null;
	private isDragging = false;

	constructor(options?: MobileCustomSelectionControllerOptions) {
		this.onStateChange = options?.onStateChange;
		this.onSelectionComplete = options?.onSelectionComplete;
	}

	getMode(): MobileSelectionMode {
		return this.mode;
	}

	getSelection(): MobileCustomSelectionContext | null {
		return this.activeSelection;
	}

	isArmed(): boolean {
		return this.mode === 'armed' || this.mode === 'selecting';
	}

	/**
	 * Enters armed selection mode. Next touch drag selects text.
	 */
	arm(): void {
		this.mode = 'armed';
		this.clearActiveGesture();
		for (const doc of this.trackedFrames.keys()) {
			applySelectionDisablingStyles(doc, true);
		}
		this.notifyStateChange();
		logMobileEvent('CustomSelection', 'Armed');
	}

	/**
	 * Cancels armed selection mode or clears active selection.
	 */
	cancel(): void {
		this.mode = 'idle';
		this.clearActiveGesture();
		this.clearOverlays();
		this.activeSelection = null;
		for (const doc of this.trackedFrames.keys()) {
			applySelectionDisablingStyles(doc, false);
		}
		this.notifyStateChange();
		logMobileEvent('CustomSelection', 'Cancelled');
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
			applySelectionDisablingStyles(doc, false);
		}
		this.notifyStateChange();
	}

	/**
	 * Updates the current custom selection when expanding to sentence.
	 */
	updateExpandedSentence(newRange: Range, newText: string, newCfiRange: string): void {
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
		const overlay = new MobileSelectionOverlay(doc);
		const cleanups: Array<() => void> = [];

		if (this.isArmed()) {
			applySelectionDisablingStyles(doc, true);
		}

		const onTouchStart = (e: TouchEvent) => {
			if (this.mode !== 'armed') {
				return;
			}
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
		};

		const onTouchMove = (e: TouchEvent) => {
			if (this.mode !== 'armed' && this.mode !== 'selecting') {
				return;
			}
			if (!this.anchorPos || !this.startPoint || e.touches.length !== 1) {
				return;
			}
			const touch = e.touches[0];
			const dist = Math.hypot(touch.clientX - this.startPoint.x, touch.clientY - this.startPoint.y);

			if (!this.isDragging) {
				if (dist < 6) {
					return;
				}
				this.isDragging = true;
				this.mode = 'selecting';
				this.notifyStateChange();
			}

			if (this.isDragging) {
				if (e.cancelable) {
					e.preventDefault();
				}
				const focusPos = getCaretPositionFromPoint(doc, touch.clientX, touch.clientY);
				if (focusPos) {
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
			}
		};

		const onTouchEnd = (e: TouchEvent) => {
			if (this.mode === 'selecting' && this.isDragging && this.currentRange && !this.currentRange.collapsed) {
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

					const selectionContext: MobileCustomSelectionContext = {
						source: 'mobile-custom',
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

					// Disarm and restore EPUB scrolling
					for (const d of this.trackedFrames.keys()) {
						applySelectionDisablingStyles(d, false);
					}

					this.onSelectionComplete?.(selectionContext);
					this.notifyStateChange();

					logMobileEvent('CustomSelection', 'SelectionCompleted', {
						length: text.length,
						cfiRange,
					});

					this.clearActiveGesture();
					return;
				}
			}

			// Tapped without dragging or empty selection: disarm back to idle
			if (this.mode === 'armed' || this.mode === 'selecting') {
				this.cancel();
			}
		};

		const onTouchCancel = () => {
			if (this.mode === 'armed' || this.mode === 'selecting') {
				this.cancel();
			}
		};

		const onContextMenu = (e: MouseEvent) => {
			if (this.isArmed()) {
				e.preventDefault();
			}
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
		applySelectionDisablingStyles(doc, false);
		this.trackedFrames.delete(doc);
	}

	private clearActiveGesture(): void {
		this.activeDoc = null;
		this.activeTracking = null;
		this.startPoint = null;
		this.anchorPos = null;
		this.currentRange = null;
		this.isDragging = false;
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
		this.clearActiveGesture();
		this.activeSelection = null;
		this.mode = 'idle';
	}
}
