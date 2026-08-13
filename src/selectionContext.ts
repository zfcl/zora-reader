export function surroundingContext(range: Range, maximum = 700): string {
  const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentElement
    : range.commonAncestorContainer as Element;
  const block = container?.closest('p, li, blockquote, td, div, section, article') ?? container;
  const text = normalize(block?.textContent ?? range.toString());
  if (text.length <= maximum) return text;
  const selected = normalize(range.toString());
  const at = text.indexOf(selected);
  if (at < 0) return text.slice(0, maximum);
  const start = Math.max(0, at - Math.floor((maximum - selected.length) / 2));
  return text.slice(start, start + maximum);
}

export function normalizeSelection(text: string): string {
  return normalize(text).slice(0, 4000);
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
