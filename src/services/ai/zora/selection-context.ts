const ABBREVIATIONS = /(?:Mr|Mrs|Ms|Dr|Prof|St|Sr|Jr|vs|etc|e\.g|i\.e|Inc|Ltd|No|Fig|Eq|vol|ch|pp|al)\.$/i;
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    const cleaned = normalize(paragraph);
    if (!cleaned) continue;
    const parts = cleaned.split(/(?<=[.!?。！？]["'”’）)]?)\s*(?=[A-Z\u4e00-\u9fff])/).map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
      const prev = sentences[sentences.length - 1];
      if (prev && ABBREVIATIONS.test(prev) && prev.length < 12) sentences[sentences.length - 1] = `${prev} ${part}`;
      else sentences.push(part);
    }
  }
  return sentences;
}
export const MAX_TARGET_SENTENCE_LENGTH = 220;
export interface SentenceBundle { previous: string; target: string; next: string; truncated: boolean; targetStart: number; targetEnd: number; }
function sliceAround(text: string, centerStart: number, centerEnd: number, maxLength: number): { text: string; start: number } {
  const budget = Math.max(24, maxLength - (centerEnd - centerStart));
  const half = Math.floor(budget / 2);
  let start = Math.max(0, centerStart - half);
  let end = Math.min(text.length, centerEnd + half);
  const leftBoundary = findBoundary(text, Math.max(0, start - 32), start, -1);
  const rightBoundary = findBoundary(text, end, Math.min(text.length, end + 32), 1);
  if (leftBoundary >= 0 && rightBoundary >= 0 && rightBoundary - leftBoundary <= maxLength) { start = leftBoundary; end = rightBoundary; }
  else if (leftBoundary >= 0 && end - leftBoundary <= maxLength) start = leftBoundary;
  else if (rightBoundary >= 0 && rightBoundary - start <= maxLength) end = rightBoundary;
  const sliced = text.slice(start, end);
  const trimmed = sliced.trim();
  const leading = sliced.length - sliced.trimStart().length;
  return { text: trimmed, start: centerStart - start - leading };
}
function findBoundary(text: string, from: number, to: number, direction: 1 | -1): number {
  const marks = ',;:—–()[]""\u2018\u2019\u201c\u201d';
  if (direction === 1) { for (let index = from; index < to; index += 1) if (marks.includes(text[index])) return index + 1; return -1; }
  for (let index = to - 1; index >= from; index -= 1) if (marks.includes(text[index])) return index + 1;
  return -1;
}
export function extractSentences(range: Range, selected = range.toString()): SentenceBundle {
  const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer as Element;
  const block = container?.closest('p, li, blockquote, td, div, section, article') ?? container;
  const text = (block?.textContent ?? range.toString()).trim();
  const empty: SentenceBundle = { previous: '', target: '', next: '', truncated: false, targetStart: 0, targetEnd: 0 };
  if (!text) return empty;
  const normalizedSelected = normalize(selected);
  const sentences = splitSentences(text);
  const at = sentences.findIndex((sentence) => normalizedSelected && sentence.includes(normalizedSelected));
  if (at < 0) { const target = normalize(text).slice(0, 400); return { previous: '', target, next: '', truncated: true, targetStart: 0, targetEnd: 0 }; }
  let target = sentences[at];
  let targetStart = target.indexOf(normalizedSelected);
  let truncated = false;
  if (target.length > MAX_TARGET_SENTENCE_LENGTH && targetStart >= 0) {
    const windowed = sliceAround(target, targetStart, targetStart + normalizedSelected.length, MAX_TARGET_SENTENCE_LENGTH);
    target = windowed.text; targetStart = windowed.start; truncated = true;
  }
  if (targetStart < 0) targetStart = 0;
  return { previous: at > 0 ? sentences[at - 1] : '', target, next: at < sentences.length - 1 ? sentences[at + 1] : '', truncated, targetStart, targetEnd: targetStart + normalizedSelected.length };
}
export function sentenceContext(range: Range): string { return extractSentences(range).target; }
export function normalizeSelection(text: string): string { return normalize(text).slice(0, 4000); }
const EDGE_PUNCT = '，。、；：！？…—–‐‑‘’“”"\'(),.;:!?-_*~（）「」『』《》〈〉【】 \t\n\r\u00A0';
const EDGE_PUNCT_SET = new Set(EDGE_PUNCT.split(''));
export function normalizeSelectionForClassification(text: string): string { let start=0,end=text.length; while(start<end&&EDGE_PUNCT_SET.has(text[start]))start++; while(end>start&&EDGE_PUNCT_SET.has(text[end-1]))end--; return text.slice(start,end); }
const SINGLE_WORD_RE = /^[A-Za-z0-9\u3400-\u4DBF\u4E00-\u9FFF'’\-‐‑‒–—]+$/;
const HAS_LETTER_RE = /[A-Za-z\u3400-\u4DBF\u4E00-\u9FFF]/;
export function isSingleWordSelection(text: string): boolean { const value=normalizeSelectionForClassification(text); return !!value && !/\s/.test(value) && SINGLE_WORD_RE.test(value) && HAS_LETTER_RE.test(value); }
function normalize(text: string): string { return text.replace(/\s+/g, ' ').trim(); }
