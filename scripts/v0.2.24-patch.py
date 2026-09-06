from __future__ import annotations

from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one match in {path}, found {count}: {old[:120]!r}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


def write_new(path: str, content: str) -> None:
    file_path = Path(path)
    if file_path.exists():
        raise RuntimeError(f"Refusing to overwrite existing file: {path}")
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content, encoding="utf-8")


# ---------------------------------------------------------------------------
# Version metadata
# ---------------------------------------------------------------------------
replace_once("manifest.json", '"version": "0.2.23"', '"version": "0.2.24"')
replace_once("package.json", '"version": "0.2.23"', '"version": "0.2.24"')
replace_once(
    "package-lock.json",
    '"version": "0.2.23",\n  "lockfileVersion"',
    '"version": "0.2.24",\n  "lockfileVersion"',
)
replace_once(
    "package-lock.json",
    '"name": "zora-reader",\n      "version": "0.2.23"',
    '"name": "zora-reader",\n      "version": "0.2.24"',
)
replace_once(
    "versions.json",
    '  "0.2.23": "1.11.4"\n}',
    '  "0.2.23": "1.11.4",\n  "0.2.24": "1.11.4"\n}',
)


# ---------------------------------------------------------------------------
# Pure latest-progress resolver used by the reader and covered by tests.
# Latest means latest write timestamp, not furthest percentage.
# ---------------------------------------------------------------------------
write_new(
    "src/services/sync/reading-progress-merge.ts",
    '''import type { ReadingPosition } from "../epub/types";
import type { SyncProgress } from "./ZoraSyncTypes";

export type ReadingProgressSource = "local" | "sync" | "none";

export interface ReadingProgressResolution {
\tposition: ReadingPosition | null;
\tsource: ReadingProgressSource;
}

function finiteNumber(value: unknown, fallback = 0): number {
\treturn typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function syncedProgressTimestamp(progress: SyncProgress | null | undefined): number {
\tif (!progress?.updatedAt) return 0;
\tconst timestamp = Date.parse(progress.updatedAt);
\treturn Number.isFinite(timestamp) ? timestamp : 0;
}

export function syncedProgressToReadingPosition(
\tprogress: SyncProgress | null | undefined
): ReadingPosition | null {
\tconst cfi = String(progress?.cfi || "").trim();
\tif (!cfi) return null;
\treturn {
\t\tchapterIndex: Math.max(0, Math.trunc(finiteNumber(progress?.chapterIndex, 0))),
\t\tcfi,
\t\tpercent: Math.min(1, Math.max(0, finiteNumber(progress?.percentage, 0))),
\t};
}

export function resolveLatestReadingPosition(
\tlocalPosition: ReadingPosition | null | undefined,
\tlocalUpdatedAt: number | null | undefined,
\tsyncedProgress: SyncProgress | null | undefined
): ReadingProgressResolution {
\tconst normalizedLocal = localPosition?.cfi
\t\t? {
\t\t\tchapterIndex: Math.max(0, Math.trunc(finiteNumber(localPosition.chapterIndex, 0))),
\t\t\tcfi: String(localPosition.cfi).trim(),
\t\t\tpercent: Math.min(1, Math.max(0, finiteNumber(localPosition.percent, 0))),
\t\t}
\t\t: null;
\tconst normalizedSync = syncedProgressToReadingPosition(syncedProgress);
\tconst localTime = finiteNumber(localUpdatedAt, 0);
\tconst syncTime = syncedProgressTimestamp(syncedProgress);

\tif (normalizedSync && (!normalizedLocal || (syncTime > 0 && syncTime >= localTime))) {
\t\treturn { position: normalizedSync, source: "sync" };
\t}
\tif (normalizedLocal) {
\t\treturn { position: normalizedLocal, source: "local" };
\t}
\tif (normalizedSync) {
\t\treturn { position: normalizedSync, source: "sync" };
\t}
\treturn { position: null, source: "none" };
}
''',
)

write_new(
    "src/services/sync/__tests__/reading-progress-merge.test.ts",
    '''import { describe, expect, it } from "vitest";
import {
\tresolveLatestReadingPosition,
\tsyncedProgressTimestamp,
} from "../reading-progress-merge";
import type { SyncProgress } from "../ZoraSyncTypes";

function remote(updatedAt: string, cfi = "epubcfi(/6/4!/4/2/1:0)"): SyncProgress {
\treturn {
\t\tbookId: "book",
\t\tdeviceId: "ios-device",
\t\tcfi,
\t\tpercentage: 0.72,
\t\tchapterIndex: 4,
\t\tupdatedAt,
\t};
}

describe("reading-progress-merge", () => {
\tit("restores a newer synced device position over stale local progress", () => {
\t\tconst localTime = Date.parse("2026-09-06T08:00:00.000Z");
\t\tconst result = resolveLatestReadingPosition(
\t\t\t{ chapterIndex: 2, cfi: "epubcfi(/6/2!/4/2/1:0)", percent: 0.31 },
\t\t\tlocalTime,
\t\t\tremote("2026-09-06T09:00:00.000Z")
\t\t);
\t\texpect(result.source).toBe("sync");
\t\texpect(result.position).toEqual({
\t\t\tchapterIndex: 4,
\t\t\tcfi: "epubcfi(/6/4!/4/2/1:0)",
\t\t\tpercent: 0.72,
\t\t});
\t});

\tit("keeps newer local progress so it can be published to the other devices", () => {
\t\tconst localTime = Date.parse("2026-09-06T10:00:00.000Z");
\t\tconst result = resolveLatestReadingPosition(
\t\t\t{ chapterIndex: 7, cfi: "epubcfi(/6/8!/4/2/1:0)", percent: 0.81 },
\t\t\tlocalTime,
\t\t\tremote("2026-09-06T09:00:00.000Z")
\t\t);
\t\texpect(result.source).toBe("local");
\t\texpect(result.position?.percent).toBe(0.81);
\t});

\tit("uses synced progress when a new device has no local reading state", () => {
\t\tconst result = resolveLatestReadingPosition(
\t\t\tnull,
\t\t\t0,
\t\t\tremote("2026-09-06T09:00:00.000Z")
\t\t);
\t\texpect(result.source).toBe("sync");
\t\texpect(result.position?.chapterIndex).toBe(4);
\t});

\tit("does not let an invalid sync timestamp overwrite valid local state", () => {
\t\tconst result = resolveLatestReadingPosition(
\t\t\t{ chapterIndex: 3, cfi: "local-cfi", percent: 0.5 },
\t\t\t1000,
\t\t\tremote("not-a-date", "remote-cfi")
\t\t);
\t\texpect(syncedProgressTimestamp(remote("not-a-date"))).toBe(0);
\t\texpect(result.source).toBe("local");
\t\texpect(result.position?.cfi).toBe("local-cfi");
\t});
});
''',
)


# ---------------------------------------------------------------------------
# Tablet toolbar: Android tablets float near the selected text instead of using
# the phone-only bottom dock. iOS and Android phone behavior stays unchanged.
# ---------------------------------------------------------------------------
replace_once(
    "src/components/epub/toolbar-positioning.ts",
    'export const MOBILE_FLOATING_BOTTOM_BASE_INSET = 16;\n',
    '''export const MOBILE_FLOATING_BOTTOM_BASE_INSET = 16;\n\nexport function shouldDockSelectionToolbar(\n\tmobile: boolean,\n\tandroid: boolean,\n\ttablet: boolean\n): boolean {\n\treturn mobile && !(android && tablet);\n}\n''',
)
replace_once(
    "src/components/epub/toolbar-positioning.test.ts",
    '\tresolveMobileFloatingInsetBottom,\n\tshouldDismissToolbarOnPointerDown,',
    '\tresolveMobileFloatingInsetBottom,\n\tshouldDismissToolbarOnPointerDown,\n\tshouldDockSelectionToolbar,',
)
replace_once(
    "src/components/epub/toolbar-positioning.test.ts",
    "describe('toolbar-positioning', () => {\n",
    '''describe('toolbar-positioning', () => {\n\tit('keeps Android tablets floating while phones and iOS keep the existing dock behavior', () => {\n\t\texpect(shouldDockSelectionToolbar(true, true, true)).toBe(false);\n\t\texpect(shouldDockSelectionToolbar(true, true, false)).toBe(true);\n\t\texpect(shouldDockSelectionToolbar(true, false, true)).toBe(true);\n\t\texpect(shouldDockSelectionToolbar(false, false, false)).toBe(false);\n\t});\n\n''',
)
replace_once(
    "src/components/epub/SelectionToolbar.svelte",
    '\t\tresolveMobileFloatingInsetBottom,\n\t} from \'./toolbar-positioning\';',
    '\t\tresolveMobileFloatingInsetBottom,\n\t\tshouldDockSelectionToolbar,\n\t} from \'./toolbar-positioning\';',
)
replace_once(
    "src/components/epub/SelectionToolbar.svelte",
    '\t\tupdateMobileBottomClearance();\n\t\tif (isMobileToolbar) {',
    '\t\tupdateMobileBottomClearance();\n\t\tif (shouldDockSelectionToolbar(isMobileToolbar, Platform.isAndroidApp, Platform.isTablet)) {',
)

# Android WebView can collapse the EPUB selection between pointerdown and the
# synthesized click. Dispatch the button click synchronously on pointerdown so
# selectedText/currentCfiRange are still intact. Trusted compatibility clicks
# are suppressed briefly to avoid double activation. This is Android-only.
replace_once(
    "src/components/epub/SelectionToolbar.svelte",
    '\tlet activeToolbarMenu: Menu | null = null;\n',
    '\tlet activeToolbarMenu: Menu | null = null;\n\tlet suppressTrustedAndroidToolbarClickUntil = 0;\n',
)
replace_once(
    "src/components/epub/SelectionToolbar.svelte",
    '\tfunction handlePointerDownOutside(event: Event) {',
    '''\tfunction handleToolbarPointerDown(event: PointerEvent) {\n\t\tevent.stopPropagation();\n\t\tif (\n\t\t\t!Platform.isAndroidApp ||\n\t\t\t(event.pointerType !== 'touch' && event.pointerType !== 'pen')\n\t\t) {\n\t\t\treturn;\n\t\t}\n\n\t\tconst targetEl = getEventTargetElement(event.target);\n\t\tconst button = targetEl?.closest('button') as HTMLButtonElement | null;\n\t\tif (!button || !toolbarEl?.contains(button) || button.disabled) {\n\t\t\treturn;\n\t\t}\n\n\t\tsuppressTrustedAndroidToolbarClickUntil = Date.now() + 700;\n\t\tif (event.cancelable) {\n\t\t\tevent.preventDefault();\n\t\t}\n\t\tbutton.dispatchEvent(new MouseEvent('click', {\n\t\t\tbubbles: true,\n\t\t\tcancelable: true,\n\t\t\tview: window,\n\t\t\tclientX: event.clientX,\n\t\t\tclientY: event.clientY,\n\t\t\tscreenX: event.screenX,\n\t\t\tscreenY: event.screenY,\n\t\t}));\n\t}\n\n\tfunction handleToolbarRootClick(event: MouseEvent) {\n\t\tif (\n\t\t\tPlatform.isAndroidApp &&\n\t\t\tevent.isTrusted &&\n\t\t\tDate.now() < suppressTrustedAndroidToolbarClickUntil\n\t\t) {\n\t\t\tevent.preventDefault();\n\t\t\tevent.stopImmediatePropagation();\n\t\t\treturn;\n\t\t}\n\t\tevent.stopPropagation();\n\t}\n\n\tfunction handlePointerDownOutside(event: Event) {''',
)
replace_once(
    "src/components/epub/SelectionToolbar.svelte",
    '\tontouchend={(e) => e.stopPropagation()}\n\tonpointerdown={(e) => e.stopPropagation()}\n\tbind:this={toolbarEl}',
    '\tontouchend={(e) => e.stopPropagation()}\n\tonpointerdown={handleToolbarPointerDown}\n\tonpointerup={(e) => e.stopPropagation()}\n\tonpointercancel={(e) => e.stopPropagation()}\n\tonclick={handleToolbarRootClick}\n\tbind:this={toolbarEl}',
)


# ---------------------------------------------------------------------------
# Reader progress: wire the already-existing per-device SyncProgress storage
# into normal reader load/save. The stable activeSyncBookId is shared with the
# bookmark sync introduced by v0.2.23.
# ---------------------------------------------------------------------------
replace_once(
    "src/components/epub/EpubReaderApp.svelte",
    "\timport { getZoraSyncService } from '../../services/sync/ZoraSyncService';\n",
    "\timport { getZoraSyncService } from '../../services/sync/ZoraSyncService';\n\timport { resolveLatestReadingPosition, syncedProgressTimestamp } from '../../services/sync/reading-progress-merge';\n",
)
replace_once(
    "src/components/epub/EpubReaderApp.svelte",
    "\tlet activeSyncBookId = '';\n\tlet bookmarkReloadTimer: ReturnType<typeof setTimeout> | null = null;",
    '''\tlet activeSyncBookId = '';\n\tlet bookmarkReloadTimer: ReturnType<typeof setTimeout> | null = null;\n\n\tasync function saveSyncedReadingProgress(\n\t\ttargetBook: EpubBook | null,\n\t\tposition: ReadingPosition | null | undefined,\n\t\tsyncBookId: string = activeSyncBookId,\n\t\tupdatedAtMs: number = Date.now()\n\t): Promise<void> {\n\t\tif (!hasReadingProgressCapability() || !targetBook?.id || !syncBookId || !position?.cfi) {\n\t\t\treturn;\n\t\t}\n\t\tconst safeUpdatedAt = Number.isFinite(updatedAtMs) && updatedAtMs > 0\n\t\t\t? updatedAtMs\n\t\t\t: Date.now();\n\t\ttry {\n\t\t\tawait syncService.saveProgress(syncBookId, {\n\t\t\t\tcfi: position.cfi,\n\t\t\t\tpercentage: position.percent,\n\t\t\t\tchapterIndex: position.chapterIndex,\n\t\t\t\tupdatedAt: new Date(safeUpdatedAt).toISOString(),\n\t\t\t});\n\t\t} catch (error) {\n\t\t\tlogger.warn('[EpubReaderApp] Failed to persist cross-device reading progress:', error);\n\t\t}\n\t}\n\n\tasync function resolveCrossDeviceReadingPosition(\n\t\ttargetBook: EpubBook,\n\t\tlocalPosition: ReadingPosition | null\n\t): Promise<ReadingPosition | null> {\n\t\tconst syncBookId = activeSyncBookId;\n\t\tif (!hasReadingProgressCapability() || !syncBookId) {\n\t\t\treturn localPosition;\n\t\t}\n\n\t\ttry {\n\t\t\tconst latestSyncedProgress = await syncService.loadLatestProgress(syncBookId);\n\t\t\tconst localUpdatedAt = typeof targetBook.readingStats?.lastReadTime === 'number'\n\t\t\t\t&& Number.isFinite(targetBook.readingStats.lastReadTime)\n\t\t\t\t? targetBook.readingStats.lastReadTime\n\t\t\t\t: 0;\n\t\t\tconst resolution = resolveLatestReadingPosition(\n\t\t\t\tlocalPosition,\n\t\t\t\tlocalUpdatedAt,\n\t\t\t\tlatestSyncedProgress\n\t\t\t);\n\n\t\t\tif (resolution.source === 'sync' && resolution.position) {\n\t\t\t\tconst remoteUpdatedAt = syncedProgressTimestamp(latestSyncedProgress);\n\t\t\t\tif (remoteUpdatedAt > 0) {\n\t\t\t\t\ttargetBook.readingStats.lastReadTime = Math.max(localUpdatedAt, remoteUpdatedAt);\n\t\t\t\t}\n\t\t\t\tlogMobileEvent('Sync', 'ProgressRestoredFromLatestDevice', {\n\t\t\t\t\tbookId: syncBookId,\n\t\t\t\t\tdeviceId: latestSyncedProgress?.deviceId || '',\n\t\t\t\t\tpercentage: resolution.position.percent,\n\t\t\t\t});\n\t\t\t} else if (resolution.source === 'local' && resolution.position) {\n\t\t\t\tconst remoteUpdatedAt = syncedProgressTimestamp(latestSyncedProgress);\n\t\t\t\tif (\n\t\t\t\t\t!latestSyncedProgress ||\n\t\t\t\t\tlatestSyncedProgress.cfi !== resolution.position.cfi ||\n\t\t\t\t\tremoteUpdatedAt < localUpdatedAt\n\t\t\t\t) {\n\t\t\t\t\tawait saveSyncedReadingProgress(\n\t\t\t\t\t\ttargetBook,\n\t\t\t\t\t\tresolution.position,\n\t\t\t\t\t\tsyncBookId,\n\t\t\t\t\t\tlocalUpdatedAt || Date.now()\n\t\t\t\t\t);\n\t\t\t\t}\n\t\t\t}\n\n\t\t\treturn resolution.position;\n\t\t} catch (error) {\n\t\t\tlogger.warn('[EpubReaderApp] Failed to resolve latest cross-device reading progress:', error);\n\t\t\treturn localPosition;\n\t\t}\n\t}\n''',
)

replace_once(
    "src/components/epub/EpubReaderApp.svelte",
    '''\t\tconst loadToken = ++activeBookLoadToken;\n\t\tactiveSyncBookId = '';\n\t\tsyncService.setActiveBook(null);\n\t\tconst targetFilePath = filePath;\n\t\tconst previousBook = book;\n\t\tif (previousBook?.id) {\n\t\t\tvoid persistCurrentReadingProgress(previousBook);\n\t\t}''',
    '''\t\tconst loadToken = ++activeBookLoadToken;\n\t\tconst previousBook = book;\n\t\tif (previousBook?.id) {\n\t\t\tawait persistCurrentReadingProgress(previousBook);\n\t\t}\n\t\tactiveSyncBookId = '';\n\t\tsyncService.setActiveBook(null);\n\t\tconst targetFilePath = filePath;''',
)
replace_once(
    "src/components/epub/EpubReaderApp.svelte",
    '''\t\t\tconst restoredPosition = await resolveBookLoadRestoredPosition({\n\t\t\t\thasProgressCapability: hasReadingProgressCapability(),\n\t\t\t\treusableBook,\n\t\t\t\tloadedBook,\n\t\t\t\tloadProgress: (bookId, book) => storageService.loadProgress(bookId, book),\n\t\t\t});''',
    '''\t\t\tlet restoredPosition = await resolveBookLoadRestoredPosition({\n\t\t\t\thasProgressCapability: hasReadingProgressCapability(),\n\t\t\t\treusableBook,\n\t\t\t\tloadedBook,\n\t\t\t\tloadProgress: (bookId, book) => storageService.loadProgress(bookId, book),\n\t\t\t});\n\t\t\trestoredPosition = await resolveCrossDeviceReadingPosition(loadedBook, restoredPosition);''',
)

# Paragraph mode's explicit progress flush.
replace_once(
    "src/components/epub/EpubReaderApp.svelte",
    '''\t\tcurrentBook.currentPosition = currentPosition;\n\t\tawait storageService.saveProgress(currentBook.id, currentPosition, readingStats);\n\t\tawait flushEpubPendingProgress(storageService);\n\t\tawait syncReadingReferencePointFromAutoSave(currentPosition);''',
    '''\t\tcurrentBook.currentPosition = currentPosition;\n\t\tawait storageService.saveProgress(currentBook.id, currentPosition, readingStats);\n\t\tawait flushEpubPendingProgress(storageService);\n\t\tawait saveSyncedReadingProgress(currentBook, currentPosition);\n\t\tawait syncReadingReferencePointFromAutoSave(currentPosition);''',
)

# General persist path: capture the stable sync ID before any awaited local I/O.
replace_once(
    "src/components/epub/EpubReaderApp.svelte",
    '''\tasync function persistCurrentReadingProgress(\n\t\ttargetBook: EpubBook | null = book\n\t): Promise<boolean> {\n\t\tif (!hasReadingProgressCapability()) {''',
    '''\tasync function persistCurrentReadingProgress(\n\t\ttargetBook: EpubBook | null = book\n\t): Promise<boolean> {\n\t\tconst syncBookIdForSave = activeSyncBookId;\n\t\tif (!hasReadingProgressCapability()) {''',
)
replace_once(
    "src/components/epub/EpubReaderApp.svelte",
    '''\t\ttargetBook.currentPosition = position;\n\t\tawait storageService.saveProgress(targetBook.id, position, readingStats);\n\t\tawait flushEpubPendingProgress(storageService);\n\t\tnotifyBookshelfProgressChanged(targetBook.filePath);''',
    '''\t\ttargetBook.currentPosition = position;\n\t\tawait storageService.saveProgress(targetBook.id, position, readingStats);\n\t\tawait flushEpubPendingProgress(storageService);\n\t\tawait saveSyncedReadingProgress(targetBook, position, syncBookIdForSave);\n\t\tnotifyBookshelfProgressChanged(targetBook.filePath);''',
)

# Reader engine auto-save callback also publishes the newest page to the vault.
replace_once(
    "src/components/epub/EpubReaderApp.svelte",
    '''\tasync function handleAutoReadingPositionSaved(position: ReadingPosition): Promise<void> {\n\t\tawait syncReadingReferencePointFromAutoSave(position);\n\t\tawait flushEpubPendingProgress(storageService);\n\t\tnotifyBookshelfProgressChanged(book?.filePath);\n\t}''',
    '''\tasync function handleAutoReadingPositionSaved(position: ReadingPosition): Promise<void> {\n\t\tawait syncReadingReferencePointFromAutoSave(position);\n\t\tawait flushEpubPendingProgress(storageService);\n\t\tawait saveSyncedReadingProgress(book, position);\n\t\tnotifyBookshelfProgressChanged(book?.filePath);\n\t}''',
)

print("v0.2.24 patch applied successfully")
