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

describe("targeted reader regressions", () => {
  it("refreshes persisted Markdown highlights after a reading note is saved", () => {
    const handler = toolbarSource.slice(
      toolbarSource.indexOf("async function handleNoteSaved"),
      toolbarSource.indexOf("function closePopover")
    );

    expect(handler).toContain("await onReadingNoteSaved?.(info.filePath)");
    expect(handler).not.toContain("addHighlight");
    expect(notePopoverSource).toContain("await onSaved?.({");
    expect(readerAppSource).toContain("onReadingNoteSaved={reloadHighlightsAfterExcerptMutation}");
    expect(readerAppSource).toContain("return reloadHighlights({ incremental: true })");
  });

  it("refreshes the same persisted Marker pipeline after a translation study note is saved", () => {
    expect(dictionaryPopoverSource).toContain("await onStudyNoteSaved?.(sourcePath)");
    expect(toolbarSource).toContain("onStudyNoteSaved={handleStudyNoteSaved}");
    expect(toolbarSource).toContain("await onReadingNoteSaved?.(sourcePath)");
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
