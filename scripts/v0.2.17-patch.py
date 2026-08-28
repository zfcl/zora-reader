from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Mobile selection: conservative sentence-boundary snapping helper.
sentence_path = "src/components/epub/sentence-selection.ts"
replace_once(
    sentence_path,
    """export function expandRangeToParagraph(
\trange: Range,
\tdoc: Document
): { range: Range; text: string } | null {""",
    """export function snapRangeToSentenceIfClose(
\trange: Range,
\tdoc: Document,
\toptions?: { maxEdgeChars?: number; maxTotalChars?: number }
): { range: Range; text: string } | null {
\tif (!range || !doc || range.collapsed) {
\t\treturn null;
\t}
\tconst originalText = range.toString().trim();
\tif (originalText.length < 12 || !/\\s/u.test(originalText)) {
\t\treturn null;
\t}
\tconst expanded = expandRangeToSentence(range, doc);
\tif (!expanded || !expanded.text || expanded.text === originalText) {
\t\treturn null;
\t}
\ttry {
\t\tconst leading = doc.createRange();
\t\tleading.setStart(expanded.range.startContainer, expanded.range.startOffset);
\t\tleading.setEnd(range.startContainer, range.startOffset);
\t\tconst trailing = doc.createRange();
\t\ttrailing.setStart(range.endContainer, range.endOffset);
\t\ttrailing.setEnd(expanded.range.endContainer, expanded.range.endOffset);
\t\tconst compactLength = (value: string) => value.replace(/\\s+/gu, " ").trim().length;
\t\tconst leadingChars = compactLength(leading.toString());
\t\tconst trailingChars = compactLength(trailing.toString());
\t\tconst maxEdgeChars = Math.max(1, options?.maxEdgeChars ?? 12);
\t\tconst maxTotalChars = Math.max(maxEdgeChars, options?.maxTotalChars ?? 18);
\t\tif (
\t\t\tleadingChars > maxEdgeChars ||
\t\t\ttrailingChars > maxEdgeChars ||
\t\t\tleadingChars + trailingChars > maxTotalChars
\t\t) {
\t\t\treturn null;
\t\t}
\t\treturn expanded;
\t} catch {
\t\treturn null;
\t}
}

export function expandRangeToParagraph(
\trange: Range,
\tdoc: Document
): { range: Range; text: string } | null {""",
)

# Selection toolbar: mobile dismissal race + sentence snapping + excerpt-id forwarding.
toolbar = "src/components/epub/SelectionToolbar.svelte"
replace_once(
    toolbar,
    "\timport { expandRangeToSentence, expandRangeToParagraph } from './sentence-selection';",
    "\timport { expandRangeToSentence, expandRangeToParagraph, snapRangeToSentenceIfClose } from './sentence-selection';",
)
replace_once(
    toolbar,
    "\tlet pendingCollapsedHideTimer: ReturnType<typeof setTimeout> | null = null;",
    "\tlet pendingCollapsedHideTimer: ReturnType<typeof setTimeout> | null = null;\n\tlet mobileSelectionDismissBlocked = false;\n\tlet mobileSelectionDismissTimer: ReturnType<typeof setTimeout> | null = null;",
)
replace_once(
    toolbar,
    """\tfunction clearPendingCollapsedHide() {
\t\tif (pendingCollapsedHideTimer !== null) {
\t\t\tclearTimeout(pendingCollapsedHideTimer);
\t\t\tpendingCollapsedHideTimer = null;
\t\t}
\t}""",
    """\tfunction clearPendingCollapsedHide() {
\t\tif (pendingCollapsedHideTimer !== null) {
\t\t\tclearTimeout(pendingCollapsedHideTimer);
\t\t\tpendingCollapsedHideTimer = null;
\t\t}
\t}

\tfunction beginMobileSelectionDismiss() {
\t\tif (!isMobileToolbar) return;
\t\tmobileSelectionDismissBlocked = true;
\t\tclearPendingSync();
\t\tclearPendingExternalSelectionHide();
\t\tclearPendingCollapsedHide();
\t\tif (mobileSelectionDismissTimer !== null) {
\t\t\tclearTimeout(mobileSelectionDismissTimer);
\t\t}
\t\tmobileSelectionDismissTimer = setTimeout(() => {
\t\t\tmobileSelectionDismissTimer = null;
\t\t\tmobileSelectionDismissBlocked = false;
\t\t}, 180);
\t}""",
)
replace_once(
    toolbar,
    """\tfunction clearAndHide() {
\t\tclearPendingCollapsedHide();""",
    """\tfunction clearAndHide() {
\t\tbeginMobileSelectionDismiss();
\t\tclearPendingCollapsedHide();""",
)
replace_once(
    toolbar,
    """\tasync function handleStudyNoteSaved(sourcePath: string) {
\t\tawait onReadingNoteSaved?.(sourcePath);
\t}""",
    """\tasync function handleStudyNoteSaved(sourcePath: string, excerptId?: string) {
\t\tawait onReadingNoteSaved?.(sourcePath, excerptId);
\t}""",
)
replace_once(
    toolbar,
    """\t\tupdateMobileBottomClearance();
\t\tisVisible = true;
\t\tawait tick();

\t\tif (isMobileToolbar) {
\t\t\ttoolbarMode = 'docked';
\t\t\tposTop = 0;
\t\t\tposLeft = 0;
\t\t\tisBelowSelection = false;
\t\t\tarrowOffset = 0;
\t\t\treturn;
\t\t}""",
    """\t\tupdateMobileBottomClearance();
\t\tif (isMobileToolbar) {
\t\t\ttoolbarMode = 'docked';
\t\t\tposTop = 0;
\t\t\tposLeft = 0;
\t\t\tisBelowSelection = false;
\t\t\tarrowOffset = 0;
\t\t\tisVisible = true;
\t\t\tawait tick();
\t\t\treturn;
\t\t}

\t\tisVisible = true;
\t\tawait tick();""",
)
replace_once(
    toolbar,
    """\t\t\tiframeDoc = iframeWindow.document;
\t\t\tconst selection = iframeWindow.getSelection();""",
    """\t\t\tiframeDoc = iframeWindow.document;
\t\t\tif (isMobileToolbar && mobileSelectionDismissBlocked) {
\t\t\t\treturn;
\t\t\t}
\t\t\tconst selection = iframeWindow.getSelection();""",
)
replace_once(toolbar, "\t\t\tconst text = selection.toString().trim();", "\t\t\tlet text = selection.toString().trim();")
replace_once(
    toolbar,
    """\t\t\tconst range = selection.getRangeAt(0);
\t\t\tconst resolvedCfiRange = cfiRange || frame.cfiFromRange(range);""",
    """\t\t\tlet range = selection.getRangeAt(0);
\t\t\tlet snappedToSentence = false;
\t\t\tif (isMobileToolbar) {
\t\t\t\tconst snapped = snapRangeToSentenceIfClose(range, iframeDoc);
\t\t\t\tif (snapped) {
\t\t\t\t\tselection.removeAllRanges();
\t\t\t\t\tselection.addRange(snapped.range);
\t\t\t\t\trange = snapped.range;
\t\t\t\t\ttext = snapped.text;
\t\t\t\t\tsnappedToSentence = true;
\t\t\t\t}
\t\t\t}
\t\t\tconst resolvedCfiRange = snappedToSentence
\t\t\t\t? frame.cfiFromRange(range)
\t\t\t\t: (cfiRange || frame.cfiFromRange(range));""",
)
replace_once(
    toolbar,
    """\t$effect(() => {
\t\tconst selection = externalSelection;""",
    """\t$effect(() => {
\t\tconst selection = externalSelection;
\t\tif (isMobileToolbar && mobileSelectionDismissBlocked) {
\t\t\tuntrack(() => hideToolbar());
\t\t\treturn;
\t\t}""",
)
replace_once(
    toolbar,
    """\t\t\tclearPendingExternalSelectionHide();
\t\t\tclearPendingCollapsedHide();
\t\t};
\t});""",
    """\t\t\tclearPendingExternalSelectionHide();
\t\t\tclearPendingCollapsedHide();
\t\t\tif (mobileSelectionDismissTimer !== null) {
\t\t\t\tclearTimeout(mobileSelectionDismissTimer);
\t\t\t\tmobileSelectionDismissTimer = null;
\t\t\t}
\t\t\tmobileSelectionDismissBlocked = false;
\t\t};
\t});""",
)

# Translation note locator and blue reading-note appearance.
study = "src/services/ai/zora/zora-study-note-service.ts"
replace_once(
    study,
    """export async function appendVocabularyStudyNote(
  app: App,
  input: StudyNoteVocabularyInput
): Promise<string> {""",
    """export async function appendVocabularyStudyNoteWithLocator(
  app: App,
  input: StudyNoteVocabularyInput
): Promise<{ path: string; filePath: string; blockId: string }> {""",
)
replace_once(
    study,
    '`> [!EPUB|purple+reading-note]- [[${input.bookPath}#weave-cfi=${encodedCfi}&eid=${blockId}|${title}]]`,',
    '`> [!EPUB|blue+reading-note]- [[${input.bookPath}#weave-cfi=${encodedCfi}&eid=${blockId}|${title}]]`,',
)
replace_once(
    study,
    """  return appendStudyNoteEntry(app, input.bookTitle, "词义", lines.join("\\n"));
}

export async function appendGrammarStudyNote(""",
    """  const filePath = await appendStudyNoteEntry(app, input.bookTitle, "词义", lines.join("\\n"));
  return { path: filePath, filePath, blockId };
}

export async function appendVocabularyStudyNote(
  app: App,
  input: StudyNoteVocabularyInput
): Promise<string> {
  return (await appendVocabularyStudyNoteWithLocator(app, input)).filePath;
}

export async function appendGrammarStudyNote(""",
)

dictionary = "src/components/epub/SelectionDictionaryPopover.svelte"
replace_once(
    dictionary,
    "import { appendVocabularyStudyNote } from '../../services/ai/zora/zora-study-note-service';",
    "import { appendVocabularyStudyNoteWithLocator } from '../../services/ai/zora/zora-study-note-service';",
)
replace_once(
    dictionary,
    "onStudyNoteSaved?: (sourcePath: string) => void | Promise<void>;",
    "onStudyNoteSaved?: (sourcePath: string, excerptId?: string) => void | Promise<void>;",
)
replace_once(dictionary, "const sourcePath = await appendVocabularyStudyNote(app, {", "const saved = await appendVocabularyStudyNoteWithLocator(app, {")
replace_once(dictionary, "await onStudyNoteSaved?.(sourcePath);", "await onStudyNoteSaved?.(saved.filePath, saved.blockId);")

# Reading-note render: preserve purple for ordinary reading notes, use stored color for translation note markers.
# Enlarge and clamp the full iOS touch target inside the viewport.
overlay = "src/services/epub/reader-annotation-overlayer.ts"
replace_once(overlay, "group.appendChild(this.createReadingNoteHintOverlay(rects));", "group.appendChild(this.createReadingNoteHintOverlay(rects, annotation.color));")
replace_once(
    overlay,
    """\tcreateReadingNoteHintOverlay(rects: unknown[]): SVGElement {
\t\tconst group = activeDocument.createElementNS(SVG_NS, "g");
\t\tgroup.setAttribute("data-zora-reading-note-hint", "group");
\t\tconst purpleColor = "#8b5cf6";""",
    """\tcreateReadingNoteHintOverlay(rects: unknown[], color?: string): SVGElement {
\t\tconst group = activeDocument.createElementNS(SVG_NS, "g");
\t\tgroup.setAttribute("data-zora-reading-note-hint", "group");
\t\tconst noteColor = color && color !== "purple"
\t\t\t? this.ports.resolveHighlightTint(color)
\t\t\t: "#8b5cf6";""",
)
replace_once(overlay, 'bg.setAttribute("fill", purpleColor);', 'bg.setAttribute("fill", noteColor);')
replace_once(overlay, "const hitSize = 18;", "const hitSize = 26;")
replace_once(
    overlay,
    """\t\tconst purpleColor = "#8b5cf6";
\t\tconst purpleBorder = "#7c3aed";
\t\tconst fillColor = "#ffffff";""",
    """\t\tconst markerColor = annotation.color && annotation.color !== "purple"
\t\t\t? this.ports.resolveHighlightTint(annotation.color)
\t\t\t: "#8b5cf6";
\t\tconst markerBorder = annotation.color && annotation.color !== "purple"
\t\t\t? markerColor
\t\t\t: "#7c3aed";
\t\tconst fillColor = "#ffffff";""",
)
replace_once(overlay, 'badge.setAttribute("fill", purpleColor);', 'badge.setAttribute("fill", markerColor);')
replace_once(overlay, 'badge.setAttribute("stroke", purpleBorder);', 'badge.setAttribute("stroke", markerBorder);')
replace_once(
    overlay,
    """\t\tconst hitOffset = (hitSize - size) / 2;
\t\tconst hitArea = activeDocument.createElementNS(SVG_NS, "rect");
\t\thitArea.setAttribute("data-zora-note-marker", "hit-area");
\t\thitArea.setAttribute("x", String(markerX - hitOffset));
\t\thitArea.setAttribute("y", String(markerY - hitOffset));
\t\thitArea.setAttribute("width", String(hitSize));
\t\thitArea.setAttribute("height", String(hitSize));""",
    """\t\tconst hitOffset = (hitSize - size) / 2;
\t\tconst viewportWidth = Math.max(0, options?.viewportBounds?.width ?? activeDocument.documentElement?.clientWidth ?? 0);
\t\tconst viewportHeight = Math.max(0, options?.viewportBounds?.height ?? activeDocument.documentElement?.clientHeight ?? 0);
\t\tconst hitWidth = viewportWidth > 0 ? Math.min(hitSize, viewportWidth) : hitSize;
\t\tconst hitHeight = viewportHeight > 0 ? Math.min(hitSize, viewportHeight) : hitSize;
\t\tconst desiredHitX = markerX - hitOffset;
\t\tconst desiredHitY = markerY - hitOffset;
\t\tconst hitX = viewportWidth > 0
\t\t\t? Math.max(0, Math.min(desiredHitX, Math.max(0, viewportWidth - hitWidth)))
\t\t\t: desiredHitX;
\t\tconst hitY = viewportHeight > 0
\t\t\t? Math.max(0, Math.min(desiredHitY, Math.max(0, viewportHeight - hitHeight)))
\t\t\t: desiredHitY;
\t\tconst hitArea = activeDocument.createElementNS(SVG_NS, "rect");
\t\thitArea.setAttribute("data-zora-note-marker", "hit-area");
\t\thitArea.setAttribute("x", String(hitX));
\t\thitArea.setAttribute("y", String(hitY));
\t\thitArea.setAttribute("width", String(hitWidth));
\t\thitArea.setAttribute("height", String(hitHeight));""",
)
replace_once(
    overlay,
    'setSvgInteractionAttributes(hitArea, { cursor: "pointer", pointerEvents: "auto" });',
    'setSvgInteractionAttributes(hitArea, { cursor: "pointer", pointerEvents: "auto" });\n\t\thitArea.setAttribute("style", "touch-action: manipulation;");',
)

manifest = Path("manifest.json")
manifest_text = manifest.read_text(encoding="utf-8")
if '"version": "0.2.16"' not in manifest_text:
    raise SystemExit("manifest.json: expected 0.2.16")
manifest.write_text(manifest_text.replace('"version": "0.2.16"', '"version": "0.2.17"', 1), encoding="utf-8")
