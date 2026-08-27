import type { ReaderFrame } from '../../services/epub/reader-engine-types';
import { logMobileEvent } from '../../utils/zora-mobile-logger';

/**
 * Realm-safe Text node check (avoids `node instanceof window.Text` failing across iframe boundaries).
 */
export function isTextNode(node: unknown, doc?: Document | null): node is Text {
	if (!node || typeof node !== 'object') {
		return false;
	}
	const nodeType = (node as Node).nodeType;
	if (nodeType !== 3 && nodeType !== (typeof Node !== 'undefined' ? Node.TEXT_NODE : 3)) {
		return false;
	}
	if (doc && (node as Node).ownerDocument && (node as Node).ownerDocument !== doc) {
		return false;
	}
	return true;
}

/**
 * Realm-safe Element node check (avoids `node instanceof window.Element` failing across iframe boundaries).
 */
export function isElementNode(node: unknown): node is Element {
	if (!node || typeof node !== 'object') {
		return false;
	}
	const nodeType = (node as Node).nodeType;
	return nodeType === 1 || nodeType === (typeof Node !== 'undefined' ? Node.ELEMENT_NODE : 1);
}

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

export type CaretSourceKind = 'native-position' | 'native-range' | 'geometry' | 'none';

export interface CaretPositionResult {
	node: Node;
	offset: number;
	source?: CaretSourceKind;
}

export interface SelectableTextCaretResult {
	caret: { node: Node; offset: number };
	textNode: Text;
	caretSource: CaretSourceKind;
	hitElementTag?: string;
}

/**
 * Resolves character position from touch coordinates in a document viewport.
 * Prefers standard caretPositionFromPoint with fallback to WebKit caretRangeFromPoint.
 */
export function getCaretPositionFromPoint(
	doc: Document,
	x: number,
	y: number
): CaretPositionResult | null {
	if (!doc) {
		return null;
	}

	// 1. Standard API: document.caretPositionFromPoint
	if (typeof (doc as any).caretPositionFromPoint === 'function') {
		try {
			const pos = (doc as any).caretPositionFromPoint(x, y);
			if (pos && pos.offsetNode) {
				const normalized = normalizeCaretNodeOffset(pos.offsetNode, pos.offset);
				return {
					node: normalized.node,
					offset: normalized.offset,
					source: 'native-position',
				};
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
				const normalized = normalizeCaretNodeOffset(range.startContainer, range.startOffset);
				return {
					node: normalized.node,
					offset: normalized.offset,
					source: 'native-range',
				};
			}
		} catch {
			/* fallback */
		}
	}

	return null;
}

export function normalizeCaretNodeOffset(node: Node, offset: number): { node: Node; offset: number } {
	if (isTextNode(node)) {
		return {
			node,
			offset: Math.max(0, Math.min(offset, node.length)),
		};
	}

	if (isElementNode(node)) {
		const childNodes = Array.from(node.childNodes);
		if (childNodes.length === 0) {
			return { node, offset: 0 };
		}
		if (offset < childNodes.length) {
			const child = childNodes[offset];
			if (isTextNode(child)) {
				return { node: child, offset: 0 };
			}
			const walker = node.ownerDocument?.createTreeWalker(child, NodeFilter.SHOW_TEXT, null);
			const firstText = walker?.nextNode();
			if (firstText && isTextNode(firstText)) {
				return { node: firstText, offset: 0 };
			}
		} else {
			const lastChild = childNodes[childNodes.length - 1];
			if (isTextNode(lastChild)) {
				return { node: lastChild, offset: lastChild.length };
			}
			const walker = node.ownerDocument?.createTreeWalker(lastChild, NodeFilter.SHOW_TEXT, null);
			let lastText: Node | null = null;
			let current = walker?.nextNode();
			while (current) {
				lastText = current;
				current = walker?.nextNode();
			}
			if (lastText && isTextNode(lastText)) {
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
	if (isElementNode(target)) {
		el = target as Element;
	} else if ((target as any)?.parentElement) {
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
	if (isElementNode(target)) {
		el = target as Element;
	} else if ((target as any)?.parentElement) {
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
	if (isElementNode(target)) {
		el = target as Element;
	} else if ((target as any)?.parentElement) {
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
 * Accurately finds character offset within a TextNode using character/range geometry.
 * Uses binary search across character positions to avoid full linear scans.
 */
export function findAccurateTextOffset(
	doc: Document,
	textNode: Text,
	x: number,
	y: number
): number {
	const len = textNode.length;
	if (len <= 0) return 0;

	// Binary search to find character offset
	let low = 0;
	let high = len;
	let iterations = 0;
	const maxIterations = 32;

	while (low < high && iterations++ < maxIterations) {
		if (high - low === 1) {
			try {
				const r = doc.createRange();
				r.setStart(textNode, low);
				r.setEnd(textNode, high);
				const rect = typeof r.getBoundingClientRect === 'function' ? r.getBoundingClientRect() : null;
				if (rect && rect.width > 0) {
					return x > rect.left + rect.width / 2 ? high : low;
				}
			} catch {
				/* fallback */
			}
			return low;
		}

		const mid = Math.floor((low + high) / 2);
		try {
			const r = doc.createRange();
			r.setStart(textNode, low);
			r.setEnd(textNode, mid);
			const rects = typeof r.getClientRects === 'function' ? Array.from(r.getClientRects()) : [];
			const lastRect = rects.length > 0
				? rects[rects.length - 1]
				: (typeof r.getBoundingClientRect === 'function' ? r.getBoundingClientRect() : null);

			if (!lastRect || (lastRect.width <= 0 && lastRect.height <= 0)) {
				return mid;
			}

			const lineToleranceY = 4;
			if (y < lastRect.top - lineToleranceY) {
				// Touch is vertically above the last measured line rect
				high = mid;
			} else if (y > lastRect.bottom + lineToleranceY) {
				// Touch is vertically below the last measured line rect
				low = mid;
			} else {
				// Touch is on the same line as lastRect
				if (x <= lastRect.right) {
					high = mid;
				} else {
					low = mid;
				}
			}
		} catch {
			return mid;
		}
	}

	return Math.max(0, Math.min(low, len));
}

/**
 * Reliable geometry fallback to resolve TextNode and accurate character offset when
 * native caretPositionFromPoint / caretRangeFromPoint fail on iOS / Safari.
 */
export function resolveTextCaretByGeometry(
	doc: Document,
	target: EventTarget | null,
	x: number,
	y: number,
	logFailure = false
): SelectableTextCaretResult | null {
	if (!doc) {
		return null;
	}

	// 1. Identify elements under point & hit element tag
	const elementsUnderPoint: Element[] = [];
	if (typeof doc.elementsFromPoint === 'function') {
		try {
			const els = doc.elementsFromPoint(x, y);
			if (els && els.length > 0) {
				elementsUnderPoint.push(...els);
			}
		} catch {
			/* ignore */
		}
	}

	if (elementsUnderPoint.length === 0 && typeof doc.elementFromPoint === 'function') {
		try {
			const el = doc.elementFromPoint(x, y);
			if (el) {
				elementsUnderPoint.push(el);
			}
		} catch {
			/* ignore */
		}
	}

	let targetEl: Element | null = null;
	if (isElementNode(target)) {
		targetEl = target as Element;
	} else if ((target as any)?.parentElement) {
		targetEl = (target as any).parentElement as Element;
	}

	if (targetEl && !elementsUnderPoint.includes(targetEl)) {
		elementsUnderPoint.push(targetEl);
	}

	const directHitEl = elementsUnderPoint[0] || targetEl || null;
	const hitElementTag = directHitEl?.tagName?.toLowerCase() || 'unknown';

	// 2. Filter out non-content containers (overlays, styles, scripts)
	const isExcludedContainer = (el: Element) => {
		if (!el) return true;
		const tag = el.tagName?.toLowerCase();
		if (
			tag === 'script' ||
			tag === 'style' ||
			tag === 'noscript' ||
			tag === 'head' ||
			tag === 'meta' ||
			tag === 'link'
		) {
			return true;
		}
		if (
			el.classList?.contains('zora-mobile-selection-overlay') ||
			el.classList?.contains('zora-custom-selection-overlay-layer')
		) {
			return true;
		}
		return false;
	};

	const candidateElements: Element[] = elementsUnderPoint.filter((el) => !isExcludedContainer(el));

	// 3. Gather candidate text nodes
	const candidateTextNodes: Text[] = [];
	const seenTextNodes = new Set<Text>();

	const addTextNodesFromElement = (el: Element) => {
		if (isExcludedContainer(el)) return;

		// Check direct child nodes first for direct text
		for (let i = 0; i < el.childNodes.length; i++) {
			const child = el.childNodes[i];
			if (isTextNode(child, doc) && child.textContent && child.textContent.trim().length > 0) {
				if (!seenTextNodes.has(child)) {
					seenTextNodes.add(child);
					candidateTextNodes.push(child);
				}
			}
		}

		// Traverse descendants
		try {
			const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
			let curr = walker.nextNode();
			while (curr) {
				if (isTextNode(curr, doc) && curr.textContent && curr.textContent.trim().length > 0) {
					if (!seenTextNodes.has(curr)) {
						seenTextNodes.add(curr);
						candidateTextNodes.push(curr);
					}
				}
				curr = walker.nextNode();
			}
		} catch {
			/* fallback */
		}
	};

	// Add text nodes from elements under point (most specific elements first)
	for (const el of candidateElements) {
		if (el !== doc.body && el !== doc.documentElement) {
			addTextNodesFromElement(el);
		}
	}

	// If no text nodes found from specific elements under point (e.g. target is BODY or elementsFromPoint only had BODY/HTML):
	if (candidateTextNodes.length === 0) {
		const root = doc.body || doc.documentElement;
		if (root) {
			const children = Array.from(root.children);
			for (const child of children) {
				if (isExcludedContainer(child)) continue;
				if (typeof child.getBoundingClientRect === 'function') {
					const b = child.getBoundingClientRect();
					if (b && (b.width > 0 || b.height > 0)) {
						// Only consider elements within 20px vertically of the touch point
						if (y >= b.top - 20 && y <= b.bottom + 20) {
							addTextNodesFromElement(child);
						}
					} else {
						addTextNodesFromElement(child);
					}
				} else {
					addTextNodesFromElement(child);
				}
			}
			// Also add direct text nodes of body/root
			addTextNodesFromElement(root);
		}
	}

	if (candidateTextNodes.length === 0) {
		if (logFailure) {
			const targetNode = target as Node | null;
			const targetNodeType = targetNode?.nodeType ?? null;
			const targetOwnerDocumentMatched = targetNode?.ownerDocument ? targetNode.ownerDocument === doc : true;
			logMobileEvent('DirectSelection', 'GeometryFallbackFailed', {
				targetTag: hitElementTag,
				elementsUnderPointCount: elementsUnderPoint.length,
				candidateElementCount: candidateElements.length,
				candidateTextNodeCount: candidateTextNodes.length,
				targetNodeType,
				targetOwnerDocumentMatched,
			});
		}
		return null;
	}

	// 4. Line geometry matching: find candidate text node whose line rect contains or is closest to (x, y)
	interface MatchedCandidate {
		textNode: Text;
		matchedLineRect: DOMRect | ClientRect;
		dist: number;
		isExactInside: boolean;
	}

	let bestMatch: MatchedCandidate | null = null;
	const maxAllowedDist = 25; // Maximum distance to consider text hit (prevents blank margins from matching)

	for (const textNode of candidateTextNodes) {
		try {
			const range = doc.createRange();
			range.setStart(textNode, 0);
			range.setEnd(textNode, textNode.length);

			let rects: Array<DOMRect | ClientRect> =
				typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : [];
			if (rects.length === 0 && typeof range.getBoundingClientRect === 'function') {
				const b = range.getBoundingClientRect();
				if (b && (b.width > 0 || b.height > 0)) {
					rects.push(b);
				}
			}

			if (rects.length === 0) {
				continue;
			}

			for (const rect of rects) {
				if (rect.width <= 0 && rect.height <= 0) continue;

				const dx = Math.max(0, rect.left - x, x - rect.right);
				const dy = Math.max(0, rect.top - y, y - rect.bottom);
				const dist = Math.hypot(dx, dy);

				const isExactInside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

				if (dist <= maxAllowedDist) {
					if (!bestMatch || (isExactInside && !bestMatch.isExactInside) || dist < bestMatch.dist) {
						bestMatch = {
							textNode,
							matchedLineRect: rect,
							dist,
							isExactInside,
						};
					}
				}
			}
		} catch {
			/* continue */
		}
	}

	if (!bestMatch) {
		if (logFailure) {
			const targetNode = target as Node | null;
			const targetNodeType = targetNode?.nodeType ?? null;
			const targetOwnerDocumentMatched = targetNode?.ownerDocument ? targetNode.ownerDocument === doc : true;
			logMobileEvent('DirectSelection', 'GeometryFallbackFailed', {
				targetTag: hitElementTag,
				elementsUnderPointCount: elementsUnderPoint.length,
				candidateElementCount: candidateElements.length,
				candidateTextNodeCount: candidateTextNodes.length,
				targetNodeType,
				targetOwnerDocumentMatched,
			});
		}
		return null;
	}

	// 5. Compute accurate offset within the matched text node
	const offset = findAccurateTextOffset(doc, bestMatch.textNode, x, y);

	return {
		caret: {
			node: bestMatch.textNode,
			offset: Math.max(0, Math.min(offset, bestMatch.textNode.length)),
		},
		textNode: bestMatch.textNode,
		caretSource: 'geometry',
		hitElementTag,
	};
}

/**
 * Resolves a selectable Text node and caret position from coordinates and touch target.
 * Order: native caretPositionFromPoint -> native caretRangeFromPoint -> geometry fallback.
 * Returns null if the touch is on empty background/margins or no valid non-empty Text node is found.
 */
export function resolveSelectableTextCaret(
	doc: Document,
	target: EventTarget | null,
	x: number,
	y: number,
	logFailure = false
): SelectableTextCaretResult | null {
	if (!doc) {
		return null;
	}

	// 1. Resolve caret from document coordinates via native APIs
	const caret = getCaretPositionFromPoint(doc, x, y);
	if (caret && caret.node) {
		let textNode: Text | null = null;
		let offset = caret.offset;

		if (isTextNode(caret.node, doc)) {
			textNode = caret.node;
		} else if (isElementNode(caret.node)) {
			const normalized = normalizeCaretNodeOffset(caret.node, offset);
			if (isTextNode(normalized.node, doc)) {
				textNode = normalized.node;
				offset = normalized.offset;
			}
		}

		if (textNode && textNode.textContent && textNode.textContent.trim().length > 0) {
			let targetEl: Element | null = null;
			if (isElementNode(target)) {
				targetEl = target as Element;
			} else if ((target as any)?.parentElement) {
				targetEl = (target as any).parentElement as Element;
			}
			return {
				caret: {
					node: textNode,
					offset: Math.max(0, Math.min(offset, textNode.length)),
				},
				textNode,
				caretSource: caret.source || 'native-range',
				hitElementTag: targetEl?.tagName?.toLowerCase() || textNode.parentElement?.tagName?.toLowerCase() || 'unknown',
			};
		}
	}

	// 2. Geometry fallback when native APIs fail or return non-text
	return resolveTextCaretByGeometry(doc, target, x, y, logFailure);
}

/**
 * Diagnostic logger for Mobile Direct Selection gesture arbitration.
 */
function logDirectSelectionClassification(
	target: Element | null,
	x: number,
	y: number,
	selectable: SelectableTextCaretResult | null,
	glyphHit: boolean,
	gestureKind: MobileGestureKind,
	caretSourceOverride?: CaretSourceKind,
	hitElementTagOverride?: string
): void {
	const targetEl = isElementNode(target) ? target : (target as any)?.parentElement || null;
	const targetTag = targetEl?.tagName?.toLowerCase() || 'unknown';
	const targetClass = typeof targetEl?.className === 'string' ? targetEl.className.slice(0, 50) : '';
	const caretFound = Boolean(selectable?.caret?.node);
	const caretNodeType = selectable?.caret?.node?.nodeType ?? null;
	const fullText = selectable?.textNode?.textContent || '';
	const caretOffset = selectable?.caret?.offset ?? null;
	const offset = caretOffset ?? 0;
	const start = Math.max(0, offset - 10);
	const caretTextSample = fullText.slice(start, start + 20).trim();
	const caretSource: CaretSourceKind = caretSourceOverride || selectable?.caretSource || (caretFound ? 'geometry' : 'none');
	const hitElementTag = hitElementTagOverride || selectable?.hitElementTag || targetTag;

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
		caretSource,
		hitElementTag,
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

	if (isTextNode(caretPos.node, doc)) {
		textNode = caretPos.node;
	} else if (isElementNode(caretPos.node)) {
		const normalized = normalizeCaretNodeOffset(caretPos.node, offset);
		if (isTextNode(normalized.node, doc)) {
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

	/**
	 * Clears the visual selection overlay without notifying an intermediate 'idle' state.
	 * Used when starting a new gesture to prevent UI flash before the new selection completes.
	 */
	private clearVisualSelectionForReplacement(): void {
		this.clearOverlays();
		this.currentRange = null;
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

			// Clear visual overlay and range without notifying premature idle state
			if (this.activeSelection) {
				this.clearVisualSelectionForReplacement();
			}

			const touch = e.touches[0];
			const target = (e.target as Element) || (e.composedPath ? (e.composedPath()[0] as Element) : null);

			// 1. Native controls (input, textarea, select, contenteditable, media)
			if (isNativeControlTarget(target)) {
				if (this.activeSelection) {
					this.clearSelection();
				}
				this.activeGestureKind = 'native-control';
				this.activeDoc = doc;
				logDirectSelectionClassification(target, touch.clientX, touch.clientY, null, false, 'native-control');
				return;
			}

			// 2. Interactive elements (links, buttons, Note Markers, etc.)
			if (isInteractiveTarget(target)) {
				if (this.activeSelection) {
					this.clearSelection();
				}
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
			const selectable = resolveSelectableTextCaret(doc, target, touch.clientX, touch.clientY, true);
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
				// Text selection active: stop propagation to prevent Foliate turn / scroll
				if (e.cancelable) {
					e.preventDefault();
				}
				e.stopPropagation();
				e.stopImmediatePropagation?.();

				if (!this.startPoint) {
					return;
				}

				const moveDist = Math.hypot(
					touch.clientX - this.startPoint.x,
					touch.clientY - this.startPoint.y
				);

				if (moveDist >= 5) {
					this.isDragging = true;
				}

				const clientX = touch.clientX;
				const clientY = touch.clientY;

				// Throttle overlay update with RAF to prevent any main-thread lag
				this.scheduleRaf(() => {
					const focusResult = resolveSelectableTextCaret(doc, null, clientX, clientY);
					const focusPos = focusResult ? focusResult.caret : null;
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
			this.cancelPendingRaf();

			if (!this.activeGestureKind) {
				return;
			}

			if (this.activeGestureKind === 'native-control') {
				this.clearActiveGesture();
				return;
			}

			if (this.activeGestureKind === 'interactive') {
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

			if (this.activeGestureKind === 'blocked') {
				if (e.cancelable) {
					e.preventDefault();
				}
				e.stopPropagation();
				e.stopImmediatePropagation?.();
				this.clearSelection();
				return;
			}

			if (this.activeGestureKind === 'text-selection') {
				if (e.cancelable) {
					e.preventDefault();
				}
				e.stopPropagation();
				e.stopImmediatePropagation?.();

				// Drag selection completion
				if (this.isDragging && this.currentRange && !this.currentRange.collapsed) {
					const text = this.currentRange.toString();
					const cfiRange = frame.cfiFromRange ? frame.cfiFromRange(this.currentRange) : null;
					if (cfiRange && text.trim().length > 0) {
						const iframe = (doc.defaultView?.frameElement as HTMLElement) || null;
						const iframeRect = iframe?.getBoundingClientRect() || { left: 0, top: 0 };
						const bRect = typeof this.currentRange.getBoundingClientRect === 'function'
							? this.currentRange.getBoundingClientRect()
							: new DOMRect(0, 0, 0, 0);
						const adjustedRect = new DOMRect(
							bRect.left + iframeRect.left,
							bRect.top + iframeRect.top,
							bRect.width,
							bRect.height
						);

						const rawRects = typeof this.currentRange.getClientRects === 'function'
							? Array.from(this.currentRange.getClientRects())
							: [adjustedRect];
						const adjustedRects = rawRects.map(
							(r) =>
								new DOMRect(
									r.left + iframeRect.left,
									r.top + iframeRect.top,
									r.width,
									r.height
								)
						);

						this.activeSelection = {
							source: 'mobile-direct',
							range: this.currentRange,
							text,
							cfiRange,
							rect: adjustedRect,
							rects: adjustedRects,
							frame,
							frameDocument: doc,
							clear: () => {
								this.clearSelection();
							},
						};
						this.mode = 'selected';

						this.onSelectionComplete?.(this.activeSelection);
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

					if (isTextNode(this.anchorPos.node, doc)) {
						textNode = this.anchorPos.node;
					} else if (isElementNode(this.anchorPos.node)) {
						const normalized = normalizeCaretNodeOffset(this.anchorPos.node, offset);
						if (isTextNode(normalized.node, doc)) {
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
