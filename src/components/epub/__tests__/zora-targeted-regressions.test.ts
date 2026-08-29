import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const toolbarSource = readFileSync("src/components/epub/SelectionToolbar.svelte", "utf8");
const notePopoverSource = readFileSync("src/components/epub/SelectionNotePopover.svelte", "utf8");
const dictionaryPopoverSource = readFileSync("src/components/epub/SelectionDictionaryPopover.svelte", "utf8");
const readerAppSource = readFileSync("src/components/epub/EpubReaderApp.svelte", "utf8");
const welcomeSource = readFileSync("src/components/epub/EpubWelcome.svelte", "utf8");
const comprehensionSource = readFileSync(
  "src/services/ai/zora/zora-comprehension-service.ts",
  "utf8"
);
const highlightToolbarSource = readFileSync("src/components/epub/EpubHighlightToolbar.svelte", "utf8");
const studyNoteSource = readFileSync("src/services/ai/zora/zora-study-note-service.ts", "utf8");
const readerCssSource = readFileSync("src/styles/epub/epub-nav-sidebar.css", "utf8");

describe("targeted reader regressions", () => {
  it("refreshes persisted Markdown highlights after a reading note is saved", () => {
    const handler = toolbarSource.slice(
      toolbarSource.indexOf("async function handleNoteSaved"),
      toolbarSource.indexOf("function closePopover")
    );

    expect(handler).toContain("await onReadingNoteSaved?.(info.filePath, info.blockId)");
    expect(handler).not.toContain("addHighlight");
    expect(notePopoverSource).toContain("await onSaved?.({");
    expect(readerAppSource).toContain("onReadingNoteSaved={refreshPersistedReadingNoteMarkersAfterSave}");
    expect(readerAppSource).toContain("return reloadHighlights({ incremental: true })");
		expect(readerAppSource).toContain("refreshPersistedReadingNoteMarkersAfterSave");
		expect(readerAppSource).toContain("await reloadHighlights({ incremental: true, invalidateCache: true })");
  });

  it("refreshes the same persisted Marker pipeline after a translation study note is saved", () => {
		expect(dictionaryPopoverSource).toContain("await onStudyNoteSaved?.(saved.filePath, saved.blockId)");
    expect(toolbarSource).toContain("onStudyNoteSaved={handleStudyNoteSaved}");
		expect(toolbarSource).toContain("await onReadingNoteSaved?.(sourcePath, excerptId)");
  });

  it("never attaches the iOS direct-selection controller to desktop EPUB frames", () => {
    const syncHelper = readerAppSource.slice(
      readerAppSource.indexOf("function syncMobileSelectionFrames"),
      readerAppSource.indexOf("let paragraphModeLocation")
    );
    expect(syncHelper).toContain("if (!isMobileReader())");
    expect(syncHelper).toContain("mobileSelectionController.syncFrames([])");
    expect(syncHelper).toContain("mobileSelectionController.syncFrames(readerService.getVisibleFrames())");
    expect(readerAppSource.match(/syncMobileSelectionFrames\(\)/g)?.length).toBe(4);
  });

	it("opens a persisted reading note through NavigationHub and blocks page-turn bubbling", () => {
		const backlinkHandler = readerAppSource.slice(
			readerAppSource.indexOf("async function handleHighlightBacklink"),
			readerAppSource.indexOf("function handleHighlightEditComment")
		);
		expect(backlinkHandler).toContain("navigateToPersistedReadingNote");
		expect(backlinkHandler).not.toContain("workspace.openLinkText");
		expect(readerAppSource).toContain("kind: 'markdown'");
		expect(readerAppSource).toContain("excerptId: input.excerptId");
		expect(highlightToolbarSource).toContain("event.stopPropagation()");
		expect(highlightToolbarSource).toContain("class:mobile-centered={toolbarMode === 'centered'}");
	});

	it("dismisses note deletion immediately and removes the marker optimistically", () => {
		expect(highlightToolbarSource).toContain("use:deleteAction={info}");
		expect(highlightToolbarSource).toContain("onDismiss();");
		expect(highlightToolbarSource).toContain("await onDelete(targetInfo)");
		expect(readerAppSource).toContain("optimisticReadingNoteRemoval");
		expect(readerAppSource).toContain("purgeOrphanHighlightFromReader(info)");
		expect(readerAppSource).toContain("await reloadHighlights({ invalidateCache: true })");
	});

	it("keeps the selection toolbar hidden until its current position is committed", () => {
		expect(toolbarSource).toContain("let positionReady = $state(false)");
		expect(toolbarSource).toContain("const generation = ++positionGeneration");
		expect(toolbarSource).toContain("class:visible={isVisible && positionReady}");
	});

	it("dismisses the mobile selection toolbar without moving a fading copy to the top", () => {
		const hideToolbar = toolbarSource.slice(
			toolbarSource.indexOf("function hideToolbar"),
			toolbarSource.indexOf("function clearAndHide")
		);
		const readerSelectionListener = toolbarSource.slice(
			toolbarSource.indexOf("const offSelection"),
			toolbarSource.indexOf("const offHighlightClick")
		);
		expect(hideToolbar).toContain("if (!isMobileToolbar)");
		expect(readerSelectionListener).toContain("if (isMobileToolbar)");
		expect(readerCssSource).toMatch(/\.epub-selection-toolbar\s*\{\s*visibility: hidden;/);
		expect(readerCssSource).toMatch(/\.epub-selection-toolbar\.visible\s*\{\s*visibility: visible;/);
	});

	it("uses Git-synced Vault Markdown as the sole reading-note persistence source", () => {
		expect(studyNoteSource).toContain("Notes/读书笔记/");
		expect(studyNoteSource).toContain("[!EPUB|purple+reading-note]");
		expect(studyNoteSource).not.toContain("getZoraSyncService");
		expect(studyNoteSource).not.toContain("syncService.saveNote");
		expect(readerAppSource).toContain("normalizedPath.startsWith('Notes/读书笔记/')");
		expect(readerAppSource).toContain("normalizedPath.startsWith('Notes/外文笔记/')");
		expect(readerAppSource).toContain("app.vault.on('create'");
		expect(readerAppSource).toContain("app.vault.on('modify'");
	});

  it("uses a compact first-open Zora Reader welcome instead of opening the tutorial", () => {
    const firstOpen = readerAppSource.slice(
      readerAppSource.indexOf("async function maybeShowTutorialOnBookOpen"),
      readerAppSource.indexOf("async function addBookmark")
    );

    expect(firstOpen).toContain("welcomeVisible = true");
    expect(firstOpen).not.toContain("tutorialVisible = true");
    expect(welcomeSource).toContain("欢迎使用 Zora Reader");
    expect(welcomeSource).toContain("翻译、理解、语法和笔记");
    expect(welcomeSource).toContain("手机端还可以拖动选词");
    expect(welcomeSource).toContain("知道了");
  });

  it("does not ask AI to generate the removed comprehension section", () => {
    const prompt = comprehensionSource.slice(
      comprehensionSource.indexOf("const COMPREHENSION_SYSTEM_PROMPT"),
      comprehensionSource.indexOf("function normalizeChatCompletionsEndpoint")
    );

    expect(prompt).not.toContain("specialNotes");
    expect(prompt).not.toContain("这里为什么这样说");
  });
});
