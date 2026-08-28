from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# 1) Make mobile sentence snapping useful rather than so conservative that it
# almost never triggers. A substantial partial sentence may snap even when one
# edge is farther away, while small/low-coverage selections stay untouched.
sentence_path = "src/components/epub/sentence-selection.ts"
old_snap = '''export function snapRangeToSentenceIfClose(
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
}'''
new_snap = '''export function snapRangeToSentenceIfClose(
\trange: Range,
\tdoc: Document,
\toptions?: {
\t\tmaxEdgeChars?: number;
\t\tmaxTotalChars?: number;
\t\tminCoverage?: number;
\t\tmaxExpansionChars?: number;
\t}
): { range: Range; text: string } | null {
\tif (!range || !doc || range.collapsed) {
\t\treturn null;
\t}
\tconst originalText = range.toString().trim();
\t// A tap/word selection must remain a word. Sentence snapping is only for a
\t// deliberate multi-word drag selection.
\tif (originalText.length < 8 || !/\\s/u.test(originalText)) {
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
\t\tconst selectedChars = compactLength(originalText);
\t\tconst sentenceChars = Math.max(1, compactLength(expanded.text));
\t\tconst addedChars = leadingChars + trailingChars;
\t\tconst coverage = selectedChars / sentenceChars;
\t\tconst maxEdgeChars = Math.max(1, options?.maxEdgeChars ?? 28);
\t\tconst maxTotalChars = Math.max(maxEdgeChars, options?.maxTotalChars ?? 48);
\t\tconst minCoverage = Math.max(0.2, Math.min(0.95, options?.minCoverage ?? 0.45));
\t\tconst maxExpansionChars = Math.max(maxTotalChars, options?.maxExpansionChars ?? 96);
\t\tconst closeEnough =
\t\t\tleadingChars <= maxEdgeChars &&
\t\t\ttrailingChars <= maxEdgeChars &&
\t\t\taddedChars <= maxTotalChars;
\t\tconst coversEnoughOfSentence = coverage >= minCoverage && addedChars <= maxExpansionChars;
\t\tif (!closeEnough && !coversEnoughOfSentence) {
\t\t\treturn null;
\t\t}
\t\treturn expanded;
\t} catch {
\t\treturn null;
\t}
}'''
replace_once(sentence_path, old_snap, new_snap)


# 2) The actual phone selection path is MobileDirectSelectionController, not
# SelectionToolbar's native window Selection path. Snap the final drag Range here
# before generating CFI, geometry, overlay and external selection state.
mobile_path = "src/components/epub/mobile-direct-selection.ts"
replace_once(
    mobile_path,
    "import type { ReaderFrame } from '../../services/epub/reader-engine-types';\nimport { logMobileEvent } from '../../utils/zora-mobile-logger';",
    "import type { ReaderFrame } from '../../services/epub/reader-engine-types';\nimport { logMobileEvent } from '../../utils/zora-mobile-logger';\nimport { snapRangeToSentenceIfClose } from './sentence-selection';",
)
replace_once(
    mobile_path,
    '''\t\t\t\tif (this.isDragging && this.currentRange && !this.currentRange.collapsed) {
\t\t\t\t\tconst text = this.currentRange.toString();
\t\t\t\t\tconst cfiRange = frame.cfiFromRange ? frame.cfiFromRange(this.currentRange) : null;
\t\t\t\t\tif (cfiRange && text.trim().length > 0) {''',
    '''\t\t\t\tif (this.isDragging && this.currentRange && !this.currentRange.collapsed) {
\t\t\t\t\tconst snapped = snapRangeToSentenceIfClose(this.currentRange, doc);
\t\t\t\t\tconst finalRange = snapped?.range ?? this.currentRange;
\t\t\t\t\tconst text = (snapped?.text ?? finalRange.toString()).trim();
\t\t\t\t\tconst cfiRange = frame.cfiFromRange ? frame.cfiFromRange(finalRange) : null;
\t\t\t\t\tif (cfiRange && text.length > 0) {
\t\t\t\t\t\tif (snapped) {
\t\t\t\t\t\t\toverlay.render(finalRange);
\t\t\t\t\t\t}''',
)
replace_once(
    mobile_path,
    '''\t\t\t\t\t\tconst bRect = typeof this.currentRange.getBoundingClientRect === 'function'
\t\t\t\t\t\t\t? this.currentRange.getBoundingClientRect()
\t\t\t\t\t\t\t: new DOMRect(0, 0, 0, 0);''',
    '''\t\t\t\t\t\tconst bRect = typeof finalRange.getBoundingClientRect === 'function'
\t\t\t\t\t\t\t? finalRange.getBoundingClientRect()
\t\t\t\t\t\t\t: new DOMRect(0, 0, 0, 0);''',
)
replace_once(
    mobile_path,
    '''\t\t\t\t\t\tconst rawRects = typeof this.currentRange.getClientRects === 'function'
\t\t\t\t\t\t\t? Array.from(this.currentRange.getClientRects())
\t\t\t\t\t\t\t: [adjustedRect];''',
    '''\t\t\t\t\t\tconst rawRects = typeof finalRange.getClientRects === 'function'
\t\t\t\t\t\t\t? Array.from(finalRange.getClientRects())
\t\t\t\t\t\t\t: [adjustedRect];''',
)
replace_once(
    mobile_path,
    '''\t\t\t\t\t\tthis.activeSelection = {
\t\t\t\t\t\t\tsource: 'mobile-direct',
\t\t\t\t\t\t\trange: this.currentRange,''',
    '''\t\t\t\t\t\tthis.activeSelection = {
\t\t\t\t\t\t\tsource: 'mobile-direct',
\t\t\t\t\t\t\trange: finalRange,''',
)


# 3) Hard-stop stale native selection events around mobile direct-selection
# replacement/dismissal. This prevents a just-cleared toolbar from being briefly
# resurrected at its default top-left geometry.
toolbar_path = "src/components/epub/SelectionToolbar.svelte"
replace_once(
    toolbar_path,
    "\tlet mobileSelectionDismissTimer: ReturnType<typeof setTimeout> | null = null;",
    "\tlet mobileSelectionDismissTimer: ReturnType<typeof setTimeout> | null = null;\n\tlet mobileExternalSelectionCooldownUntil = 0;",
)
replace_once(
    toolbar_path,
    '''\tfunction beginMobileSelectionDismiss() {
\t\tif (!isMobileToolbar) return;
\t\tmobileSelectionDismissBlocked = true;''',
    '''\tfunction beginMobileSelectionDismiss() {
\t\tif (!isMobileToolbar) return;
\t\tmobileSelectionDismissBlocked = true;
\t\tmobileExternalSelectionCooldownUntil = Date.now() + 420;''',
)
replace_once(
    toolbar_path,
    '''\t\tmobileSelectionDismissTimer = setTimeout(() => {
\t\t\tmobileSelectionDismissTimer = null;
\t\t\tmobileSelectionDismissBlocked = false;
\t\t}, 180);''',
    '''\t\tmobileSelectionDismissTimer = setTimeout(() => {
\t\t\tmobileSelectionDismissTimer = null;
\t\t\tmobileSelectionDismissBlocked = false;
\t\t}, 420);''',
)
replace_once(
    toolbar_path,
    '''\t\t\tiframeDoc = iframeWindow.document;
\t\t\tif (isMobileToolbar && mobileSelectionDismissBlocked) {
\t\t\t\treturn;
\t\t\t}''',
    '''\t\t\tiframeDoc = iframeWindow.document;
\t\t\tif (
\t\t\t\tisMobileToolbar &&
\t\t\t\t(mobileSelectionDismissBlocked || Date.now() < mobileExternalSelectionCooldownUntil)
\t\t\t) {
\t\t\t\treturn;
\t\t\t}''',
)
replace_once(
    toolbar_path,
    '''\t\tconst offSelection = currentReaderService.onSelectionChange(({ cfiRange, frame }) => {
\t\t\tvoid syncSelection(frame, cfiRange);
\t\t});''',
    '''\t\tconst offSelection = currentReaderService.onSelectionChange(({ cfiRange, frame }) => {
\t\t\tif (
\t\t\t\tisMobileToolbar &&
\t\t\t\t(externalSelection || mobileSelectionDismissBlocked || Date.now() < mobileExternalSelectionCooldownUntil)
\t\t\t) {
\t\t\t\treturn;
\t\t\t}
\t\t\tvoid syncSelection(frame, cfiRange);
\t\t});''',
)
replace_once(
    toolbar_path,
    '''\t$effect(() => {
\t\tconst selection = externalSelection;
\t\tif (isMobileToolbar && mobileSelectionDismissBlocked) {''',
    '''\t$effect(() => {
\t\tconst selection = externalSelection;
\t\tif (isMobileToolbar) {
\t\t\tmobileExternalSelectionCooldownUntil = Date.now() + 420;
\t\t}
\t\tif (isMobileToolbar && mobileSelectionDismissBlocked) {''',
)
replace_once(
    toolbar_path,
    '''\t\t\tmobileSelectionDismissBlocked = false;
\t\t};
\t});''',
    '''\t\t\tmobileSelectionDismissBlocked = false;
\t\t\tmobileExternalSelectionCooldownUntil = 0;
\t\t};
\t});''',
)


# 4) Reading-note actions on mobile: stop forcing center-screen placement. Use
# the actual note marker rect/anchor that FoliateReaderService already supplies,
# prefer just above the marker, fall back below, and clamp to visual/workspace
# safe bounds plus the reader's bottom navigation clearance.
highlight_toolbar = "src/components/epub/EpubHighlightToolbar.svelte"
replace_once(
    highlight_toolbar,
    '''\t\tcomputeToolbarPosition,
\t\tcomputeMobilePopoverCenterPosition,
\t\tcreateEventBinder,''',
    '''\t\tcomputeToolbarPosition,
\t\tgetMobileSafeBounds,
\t\tcreateEventBinder,''',
)
replace_once(
    highlight_toolbar,
    "\tlet teardownViewportTracking: (() => void) | null = null;",
    "\tlet teardownViewportTracking: (() => void) | null = null;\n\tlet positionReady = $state(false);",
)
replace_once(
    highlight_toolbar,
    '''\tfunction icon(node: HTMLElement, name: string) {
\t\tsetIcon(node, name);''',
    '''\tfunction clampNumber(value: number, min: number, max: number): number {
\t\tif (max < min) return min;
\t\treturn Math.min(Math.max(value, min), max);
\t}

\tfunction icon(node: HTMLElement, name: string) {
\t\tsetIcon(node, name);''',
)
replace_once(
    highlight_toolbar,
    '''\t\tif (!currentInfo) {
\t\t\tstopOutsidePointerTracking();
\t\t\tstopViewportTracking();
\t\t\ttoolbarMode = 'floating';
\t\t\tarrowOffset = 0;
\t\t\treturn;
\t\t}

\t\tawait tick();''',
    '''\t\tif (!currentInfo) {
\t\t\tstopOutsidePointerTracking();
\t\t\tstopViewportTracking();
\t\t\ttoolbarMode = 'floating';
\t\t\tarrowOffset = 0;
\t\t\tpositionReady = false;
\t\t\treturn;
\t\t}

\t\tpositionReady = false;
\t\tawait tick();''',
)
old_center = '''\t\tconst shouldCenterNoteActions = isMobileToolbar && Boolean(
\t\t\tcurrentInfo.style === 'reading-note' || currentInfo.sourceLocators?.length
\t\t);
\t\tif (shouldCenterNoteActions) {
\t\t\ttoolbarMode = 'centered';
\t\t\tawait tick();
\t\t\tif (!toolbarEl || info !== currentInfo) return;
\t\t\tconst centered = computeMobilePopoverCenterPosition(
\t\t\t\ttoolbarEl.offsetWidth || 296,
\t\t\t\ttoolbarEl.offsetHeight || 78,
\t\t\t\tviewportEl
\t\t\t);
\t\t\tposTop = centered.top;
\t\t\tposLeft = centered.left;
\t\t\tisBelowTarget = false;
\t\t\tarrowOffset = 0;
\t\t\treturn;
\t\t}'''
new_center = '''\t\tconst shouldAnchorNoteActions = isMobileToolbar && Boolean(
\t\t\tcurrentInfo.style === 'reading-note' || currentInfo.sourceLocators?.length
\t\t);
\t\tif (shouldAnchorNoteActions) {
\t\t\ttoolbarMode = 'floating';
\t\t\tawait tick();
\t\t\tif (!toolbarEl || info !== currentInfo) return;

\t\t\tconst containerRect = viewportEl.getBoundingClientRect();
\t\t\tconst safeBounds = getMobileSafeBounds(viewportEl);
\t\t\tconst width = toolbarEl.offsetWidth || 296;
\t\t\tconst height = toolbarEl.offsetHeight || 78;
\t\t\tconst gap = 10;
\t\t\tconst edgeMargin = 12;
\t\t\tconst bottomClearance = resolveMobileFloatingInsetBottom(mobileDockBottomOffset);
\t\t\tconst safeLeft = Math.max(edgeMargin, safeBounds.minLeft - containerRect.left);
\t\t\tconst safeRight = Math.min(
\t\t\t\tviewportEl.clientWidth - edgeMargin,
\t\t\t\tsafeBounds.maxRight - containerRect.left
\t\t\t);
\t\t\tconst safeTop = Math.max(edgeMargin, safeBounds.minTop - containerRect.top);
\t\t\tconst safeBottom = Math.min(
\t\t\t\tviewportEl.clientHeight - edgeMargin - bottomClearance,
\t\t\t\tsafeBounds.maxBottom - containerRect.top - bottomClearance
\t\t\t);
\t\t\tconst markerRect = {
\t\t\t\ttop: currentInfo.rect.top - containerRect.top,
\t\t\t\tleft: currentInfo.rect.left - containerRect.left,
\t\t\t\tbottom: currentInfo.rect.bottom - containerRect.top,
\t\t\t\tright: currentInfo.rect.right - containerRect.left,
\t\t\t\twidth: currentInfo.rect.width,
\t\t\t\theight: currentInfo.rect.height,
\t\t\t};
\t\t\tconst anchorX = currentInfo.anchorPoint
\t\t\t\t? currentInfo.anchorPoint.x - containerRect.left
\t\t\t\t: markerRect.left + markerRect.width / 2;
\t\t\tconst spaceAbove = markerRect.top - safeTop - gap;
\t\t\tconst spaceBelow = safeBottom - markerRect.bottom - gap;
\t\t\tconst placeBelow = spaceAbove >= height
\t\t\t\t? false
\t\t\t\t: spaceBelow >= height
\t\t\t\t\t? true
\t\t\t\t\t: spaceBelow > spaceAbove;
\t\t\tconst desiredTop = placeBelow
\t\t\t\t? markerRect.bottom + gap
\t\t\t\t: markerRect.top - height - gap;
\t\t\tconst maxLeft = Math.max(safeLeft, safeRight - width);
\t\t\tconst maxTop = Math.max(safeTop, safeBottom - height);
\t\t\tposLeft = Math.round(clampNumber(anchorX - width / 2, safeLeft, maxLeft));
\t\t\tposTop = Math.round(clampNumber(desiredTop, safeTop, maxTop));
\t\t\tisBelowTarget = placeBelow;
\t\t\tconst arrowLimit = Math.max(0, width / 2 - 18);
\t\t\tarrowOffset = clampNumber(anchorX - (posLeft + width / 2), -arrowLimit, arrowLimit);
\t\t\tpositionReady = true;
\t\t\treturn;
\t\t}'''
replace_once(highlight_toolbar, old_center, new_center)
replace_once(
    highlight_toolbar,
    '''\t\ttoolbarMode = position.mode;
\t\tposTop = position.top;
\t\tposLeft = position.left;
\t\tisBelowTarget = position.isBelowAnchor;
\t\tarrowOffset = position.arrowOffset;
\t}''',
    '''\t\ttoolbarMode = position.mode;
\t\tposTop = position.top;
\t\tposLeft = position.left;
\t\tisBelowTarget = position.isBelowAnchor;
\t\tarrowOffset = position.arrowOffset;
\t\tpositionReady = true;
\t}''',
)
replace_once(
    highlight_toolbar,
    '''\t\tif (currentInfo) {
\t\t\tvoid positionToolbar();
\t\t} else {
\t\t\tuntrack(() => {
\t\t\t\tstopViewportTracking();
\t\t\t\ttoolbarMode = 'floating';
\t\t\t\tarrowOffset = 0;
\t\t\t});
\t\t}''',
    '''\t\tif (currentInfo) {
\t\t\tuntrack(() => {
\t\t\t\tpositionReady = false;
\t\t\t});
\t\t\tvoid positionToolbar();
\t\t} else {
\t\t\tuntrack(() => {
\t\t\t\tstopViewportTracking();
\t\t\t\ttoolbarMode = 'floating';
\t\t\t\tarrowOffset = 0;
\t\t\t\tpositionReady = false;
\t\t\t});
\t\t}''',
)
replace_once(
    highlight_toolbar,
    "\tclass:visible={info !== null}",
    "\tclass:visible={info !== null && positionReady}",
)


# 5) Plugin manifest version. npm version updates package.json/package-lock.json.
manifest = Path("manifest.json")
manifest_text = manifest.read_text(encoding="utf-8")
if '"version": "0.2.17"' not in manifest_text:
    raise SystemExit("manifest.json: expected 0.2.17")
manifest.write_text(
    manifest_text.replace('"version": "0.2.17"', '"version": "0.2.18"', 1),
    encoding="utf-8",
)
