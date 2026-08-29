const ABBREV_SET = new Set([
	"mr",
	"mrs",
	"ms",
	"dr",
	"prof",
	"sr",
	"jr",
	"vs",
	"etc",
	"eg",
	"ie",
	"st",
	"mt",
	"gen",
	"col",
	"capt",
	"lt",
	"jan",
	"feb",
	"mar",
	"apr",
	"aug",
	"sept",
	"sep",
	"oct",
	"nov",
	"dec",
	"inc",
	"ltd",
	"co",
	"corp",
	"no",
	"fig",
	"al",
	"approx",
	"dept",
	"est",
	"govt",
	"intl",
	"univ",
	"vol",
	"vols",
	"ed",
	"eds",
	"pp",
	"ch",
]);

interface TextNodeSpan {
	node: Text;
	text: string;
	startIdx: number;
	endIdx: number;
}

const BLOCK_TAGS = new Set([
	"p",
	"li",
	"blockquote",
	"div",
	"section",
	"article",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"td",
	"th",
	"dd",
	"dt",
]);

// Sentence selection must not stop at generic layout wrappers. EPUB content
// frequently uses nested divs for columns, visual pages, or line groups, so
// treating every block-level element as a sentence boundary clips the result.
// These are the semantic containers that can safely bound a sentence; broader
// section/article/body containers are only used when no semantic container
// exists around the touched text.
const SENTENCE_CONTAINER_TAGS = new Set([
	"p",
	"li",
	"blockquote",
	"pre",
	"figcaption",
	"caption",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"td",
	"th",
	"dd",
	"dt",
]);

const SENTENCE_SCOPE_TAGS = new Set(["main", "article", "section", "aside"]);

function getBlockContainer(node: Node): Element | null {
	let el: Element | null =
		node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
	while (el) {
		const tag = el.tagName.toLowerCase();
		if (BLOCK_TAGS.has(tag)) {
			return el;
		}
		if (el.ownerDocument?.defaultView) {
			try {
				const display = el.ownerDocument.defaultView.getComputedStyle(el).display;
				if (display === "block" || display === "list-item" || display === "flex" || display === "grid") {
					return el;
				}
			} catch {
				/* ignore */
			}
		}
		if (!el.parentElement || tag === "body" || tag === "html") {
			break;
		}
		el = el.parentElement;
	}
	return el || (node.ownerDocument?.body ?? null);
}

function getSentenceContainer(node: Node): Element | null {
	let el: Element | null =
		node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
	let broadScope: Element | null = null;

	while (el) {
		const tag = el.tagName.toLowerCase();
		if (SENTENCE_CONTAINER_TAGS.has(tag)) {
			return el;
		}
		if (!broadScope && SENTENCE_SCOPE_TAGS.has(tag)) {
			broadScope = el;
		}
		if (tag === "body") {
			return broadScope || el;
		}
		if (tag === "html") {
			break;
		}
		el = el.parentElement;
	}

	return broadScope || node.ownerDocument?.body || getBlockContainer(node);
}

function collectTextNodeSpans(container: Element): { spans: TextNodeSpan[]; fullText: string } {
	const doc = container.ownerDocument || document;
	const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
	const spans: TextNodeSpan[] = [];
	let fullText = "";

	let currentNode = walker.nextNode();
	while (currentNode) {
		// nodeType is intentionally used instead of instanceof Text. EPUB chapter
		// nodes belong to the iframe realm and fail a host-window instanceof check.
		if (currentNode.nodeType === 3) {
			const textNode = currentNode as Text;
			const text = textNode.textContent || "";
			const startIdx = fullText.length;
			const endIdx = startIdx + text.length;
			spans.push({
				node: textNode,
				text,
				startIdx,
				endIdx,
			});
			fullText += text;
		}
		currentNode = walker.nextNode();
	}

	return { spans, fullText };
}

function mapNodeOffsetToTextIndex(
	node: Node,
	offset: number,
	spans: TextNodeSpan[],
	isEnd: boolean
): number {
	if (node.nodeType === 3) {
		const span = spans.find((s) => s.node === node);
		if (span) {
			return Math.min(span.endIdx, Math.max(span.startIdx, span.startIdx + offset));
		}
	}

	// Element node container: offset is child index
	if (node.nodeType === 1) {
		const childNodes = Array.from(node.childNodes);
		if (offset >= childNodes.length) {
			// At the end of element
			const lastSpan = [...spans].reverse().find((s) => node.contains(s.node));
			if (lastSpan) {
				return lastSpan.endIdx;
			}
		} else {
			const targetChild = childNodes[offset];
			if (targetChild) {
				const span = spans.find((s) => targetChild.contains(s.node) || s.node === targetChild);
				if (span) {
					return span.startIdx;
				}
			}
		}
	}

	if (isEnd && spans.length > 0) {
		return spans[spans.length - 1].endIdx;
	}
	return 0;
}

export function isSentenceTerminator(
	text: string,
	index: number
): { isTerminator: boolean; endOffset: number } {
	if (index < 0 || index >= text.length) {
		return { isTerminator: false, endOffset: index };
	}

	const char = text[index];
	if (char !== "." && char !== "?" && char !== "!" && char !== "。" && char !== "？" && char !== "！") {
		return { isTerminator: false, endOffset: index };
	}

	if (char === ".") {
		// 1. Decimal number check: digit before and digit after (e.g. 3.14, $19.99)
		if (
			index > 0 &&
			/\d/.test(text[index - 1]) &&
			index < text.length - 1 &&
			/\d/.test(text[index + 1])
		) {
			return { isTerminator: false, endOffset: index };
		}

		// 2. Abbreviation check: e.g. Mr., Mrs., Dr., etc., e.g., i.e.
		const prefix = text.slice(0, index);
		const wordMatch = prefix.match(/\b([A-Za-z]+)$/);
		if (wordMatch) {
			const word = wordMatch[1];
			if (ABBREV_SET.has(word.toLowerCase())) {
				return { isTerminator: false, endOffset: index };
			}
			// Single uppercase initial check (e.g. "J. K. Rowling" or "A. Smith")
			if (word.length === 1 && /^[A-Z]$/.test(word)) {
				if (index < text.length - 2 && text[index + 1] === " " && /^[A-Za-z]/.test(text[index + 2])) {
					return { isTerminator: false, endOffset: index };
				}
			}
		}

		// 3. Multi-dot abbreviations check (e.g. "e.g.", "i.e.", "U.S.", "U.K.", "E.U.")
		if (/(?:e\.g|i\.e|u\.s|u\.k|e\.u)\.$/i.test(text.slice(0, index + 1))) {
			return { isTerminator: false, endOffset: index };
		}
	}

	// Valid sentence terminator confirmed: collect consecutive punctuation group (.?!... etc)
	let end = index + 1;
	while (end < text.length && /[.!?。！？]/.test(text[end])) {
		end++;
	}

	// Include trailing closing quotes/brackets/parentheses
	while (end < text.length && /['"”’\)\]\}\u300D\u300F\uFF09\u3011]/.test(text[end])) {
		end++;
	}

	return { isTerminator: true, endOffset: end };
}

export function findSentenceBoundariesInText(
	text: string,
	selStart: number,
	selEnd: number
): { start: number; end: number } {
	if (!text) {
		return { start: 0, end: 0 };
	}

	const clampedStart = Math.max(0, Math.min(selStart, text.length));
	const clampedEnd = Math.max(clampedStart, Math.min(selEnd, text.length));

	// Search backward for previous sentence boundary
	let sentenceStart = 0;
	for (let i = clampedStart - 1; i >= 0; i--) {
		const term = isSentenceTerminator(text, i);
		if (term.isTerminator && term.endOffset <= clampedStart) {
			sentenceStart = term.endOffset;
			break;
		}
	}

	// Advance past leading whitespace/newlines
	while (sentenceStart < text.length && /\s/.test(text[sentenceStart])) {
		sentenceStart++;
	}

	// Search forward for next sentence boundary
	let sentenceEnd = text.length;
	const searchFrom = Math.max(sentenceStart, clampedEnd > clampedStart ? clampedEnd - 1 : clampedStart);
	for (let i = searchFrom; i < text.length; i++) {
		const term = isSentenceTerminator(text, i);
		if (term.isTerminator) {
			sentenceEnd = term.endOffset;
			break;
		}
	}

	// Trim trailing whitespace from sentenceEnd
	while (sentenceEnd > sentenceStart && /\s/.test(text[sentenceEnd - 1])) {
		sentenceEnd--;
	}

	if (sentenceStart >= sentenceEnd) {
		return { start: clampedStart, end: clampedEnd };
	}

	return { start: sentenceStart, end: sentenceEnd };
}

export function expandRangeToSentence(
	range: Range,
	doc: Document
): { range: Range; text: string } | null {
	if (!range || !doc) {
		return null;
	}

	const blockContainer = getSentenceContainer(range.commonAncestorContainer);
	if (!blockContainer) {
		return null;
	}

	const { spans, fullText } = collectTextNodeSpans(blockContainer);
	if (spans.length === 0 || !fullText.trim()) {
		return null;
	}

	const selStart = mapNodeOffsetToTextIndex(range.startContainer, range.startOffset, spans, false);
	const selEnd = mapNodeOffsetToTextIndex(range.endContainer, range.endOffset, spans, true);

	const boundaries = findSentenceBoundariesInText(fullText, selStart, selEnd);
	const sentenceStart = boundaries.start;
	const sentenceEnd = boundaries.end;

	if (sentenceStart >= sentenceEnd) {
		return null;
	}

	const startSpan = spans.find((s) => sentenceStart >= s.startIdx && sentenceStart <= s.endIdx);
	const endSpan = spans.find((s) => sentenceEnd >= s.startIdx && sentenceEnd <= s.endIdx);

	if (!startSpan || !endSpan) {
		return null;
	}

	const startOffset = Math.max(0, Math.min(sentenceStart - startSpan.startIdx, startSpan.node.length));
	const endOffset = Math.max(0, Math.min(sentenceEnd - endSpan.startIdx, endSpan.node.length));

	try {
		const newRange = doc.createRange();
		newRange.setStart(startSpan.node, startOffset);
		newRange.setEnd(endSpan.node, endOffset);
		const extractedText = newRange.toString().trim();
		return {
			range: newRange,
			text: extractedText,
		};
	} catch {
		return null;
	}
}

export function snapRangeToSentenceIfClose(
	range: Range,
	doc: Document,
	options?: {
		maxEdgeChars?: number;
		maxTotalChars?: number;
		minCoverage?: number;
		maxExpansionChars?: number;
	}
): { range: Range; text: string } | null {
	if (!range || !doc || range.collapsed) {
		return null;
	}
	const originalText = range.toString().trim();
	// A tap/word selection must remain a word. Sentence snapping is only for a
	// deliberate multi-word drag selection.
	if (originalText.length < 8 || !/\s/u.test(originalText)) {
		return null;
	}
	const expanded = expandRangeToSentence(range, doc);
	if (!expanded || !expanded.text || expanded.text === originalText) {
		return null;
	}
	try {
		const leading = doc.createRange();
		leading.setStart(expanded.range.startContainer, expanded.range.startOffset);
		leading.setEnd(range.startContainer, range.startOffset);
		const trailing = doc.createRange();
		trailing.setStart(range.endContainer, range.endOffset);
		trailing.setEnd(expanded.range.endContainer, expanded.range.endOffset);
		const compactLength = (value: string) => value.replace(/\s+/gu, " ").trim().length;
		const leadingChars = compactLength(leading.toString());
		const trailingChars = compactLength(trailing.toString());
		const selectedChars = compactLength(originalText);
		const sentenceChars = Math.max(1, compactLength(expanded.text));
		const addedChars = leadingChars + trailingChars;
		const coverage = selectedChars / sentenceChars;
		const maxEdgeChars = Math.max(1, options?.maxEdgeChars ?? 28);
		const maxTotalChars = Math.max(maxEdgeChars, options?.maxTotalChars ?? 48);
		const minCoverage = Math.max(0.2, Math.min(0.95, options?.minCoverage ?? 0.45));
		const maxExpansionChars = Math.max(maxTotalChars, options?.maxExpansionChars ?? 96);
		const closeEnough =
			leadingChars <= maxEdgeChars &&
			trailingChars <= maxEdgeChars &&
			addedChars <= maxTotalChars;
		const coversEnoughOfSentence = coverage >= minCoverage && addedChars <= maxExpansionChars;
		if (!closeEnough && !coversEnoughOfSentence) {
			return null;
		}
		return expanded;
	} catch {
		return null;
	}
}

/**
 * Mobile direct selection is gesture based, so a drag always represents a
 * sentence selection request. Expanding the DOM Range also reaches text in a
 * later visual column/page when the sentence continues beyond the viewport.
 */
export function snapRangeToSentenceForMobileDrag(
	range: Range,
	doc: Document
): { range: Range; text: string } | null {
	if (!range || !doc || range.collapsed || !range.toString().trim()) {
		return null;
	}
	return expandRangeToSentence(range, doc);
}

export function expandRangeToParagraph(
	range: Range,
	doc: Document
): { range: Range; text: string } | null {
	if (!range || !doc) {
		return null;
	}

	const blockContainer = getBlockContainer(range.commonAncestorContainer);
	if (!blockContainer) {
		return null;
	}

	const { spans, fullText } = collectTextNodeSpans(blockContainer);
	if (spans.length === 0 || !fullText.trim()) {
		return null;
	}

	let startSpanIdx = 0;
	let startOffset = 0;
	while (startSpanIdx < spans.length) {
		const s = spans[startSpanIdx];
		const trimmedIdx = s.text.search(/\S/);
		if (trimmedIdx !== -1) {
			startOffset = trimmedIdx;
			break;
		}
		startSpanIdx++;
	}

	let endSpanIdx = spans.length - 1;
	let endOffset = spans[endSpanIdx]?.node.length || 0;
	while (endSpanIdx >= 0) {
		const s = spans[endSpanIdx];
		const match = s.text.match(/\S\s*$/);
		if (match && typeof match.index === "number") {
			endOffset = match.index + 1;
			break;
		}
		endSpanIdx--;
	}

	if (startSpanIdx > endSpanIdx || (startSpanIdx === endSpanIdx && startOffset >= endOffset) || !spans[startSpanIdx] || !spans[endSpanIdx]) {
		try {
			const newRange = doc.createRange();
			newRange.selectNodeContents(blockContainer);
			const text = newRange.toString().trim();
			return text ? { range: newRange, text } : null;
		} catch {
			return null;
		}
	}

	try {
		const newRange = doc.createRange();
		newRange.setStart(spans[startSpanIdx].node, startOffset);
		newRange.setEnd(spans[endSpanIdx].node, endOffset);
		const text = newRange.toString().trim();
		return text ? { range: newRange, text } : null;
	} catch {
		return null;
	}
}
