import { describe, expect, it, vi } from "vitest";
import {
  appendBookReadingNote,
  appendComprehensionStudyNote,
  appendGrammarStudyNote,
  appendVocabularyStudyNote,
  buildEpubDeepLink,
  getBookNoteFilePath,
  getStudyNoteFilePath,
  sanitizeBookFileName,
} from "../../ai/zora/zora-study-note-service";

function createMockApp() {
  const store = new Map<string, string>();
  return {
    vault: {
      adapter: {
        exists: vi.fn(async (path: string) => store.has(path)),
        read: vi.fn(async (path: string) => store.get(path) || ""),
        write: vi.fn(async (path: string, data: string) => {
          store.set(path, data);
        }),
        mkdir: vi.fn(async () => undefined),
      },
    },
    _store: store,
  } as any;
}

describe("zora-study-note-service", () => {
  it("sanitizes book title for file name", () => {
    expect(sanitizeBookFileName("Flowers: For / Algernon?")).toBe(
      "Flowers_ For _ Algernon_"
    );
    expect(getStudyNoteFilePath("Flowers for Algernon")).toBe(
      "Notes/外文笔记/Flowers for Algernon.md"
    );
    expect(getBookNoteFilePath("Flowers for Algernon")).toBe(
      "Notes/读书笔记/Flowers for Algernon.md"
    );
  });

  it("builds clean EPUB deep link", () => {
    const link = buildEpubDeepLink("Books/test.epub", "readium:abc", 2);
    expect(link).toContain("obsidian://");
    expect(link).toContain("file=Books%2Ftest.epub");
    expect(link).toContain("cfi=readium%3Aabc");
    expect(link).toContain("chapter=2");
  });

  it("appends vocabulary, comprehension and grammar to Notes/外文笔记/<book>.md, and reading notes to Notes/<book>.md", async () => {
    const mockApp = createMockApp();
    const bookTitle = "Flowers for Algernon";

    // 1. Add vocabulary to 外文笔记
    await appendVocabularyStudyNote(mockApp, {
      word: "old",
      partOfSpeech: "形容词",
      contextMeaning: "最古老的；历史最悠久的",
      senses: [{ label: "形容词", meaning: "年老的；年迈的" }],
      sentence: "In the last years...",
      bookPath: "Books/Flowers.epub",
      bookTitle,
      cfiRange: "epubcfi(/6/2!/4/1:0)",
    });

    const foreignNotePath = getStudyNoteFilePath(bookTitle);
    let foreignContent = mockApp._store.get(foreignNotePath);
    expect(foreignContent).toContain("# Flowers for Algernon · 外文笔记");
    expect(foreignContent).toContain("## 词义");
    expect(foreignContent).toContain("> [!abstract]- 📖 old · 形容词");
    expect(foreignContent).toContain("[↗ 回到原文]");

    // 2. Add comprehension (简易理解) to 外文笔记
    await appendComprehensionStudyNote(mockApp, {
      sentence: "I didn't know what he was gonna do and I was holding on tight.",
      translation: "我不知道他准备做什么，而我正紧紧抓住。",
      howToRead: [
        { chunk: "I didn't know", translation: "我不知道" },
        { chunk: "what he was gonna do", translation: "他准备做什么" },
      ],
      keyPatterns: [
        { pattern: "didn't know what...", meaning: "不知道……" },
      ],
      bookPath: "Books/Flowers.epub",
      bookTitle,
      cfiRange: "epubcfi(/6/2!/4/15:0)",
    });

    foreignContent = mockApp._store.get(foreignNotePath);
    expect(foreignContent).toContain("## 简易理解");
    expect(foreignContent).toContain("> [!example]- 💡 理解");
    expect(foreignContent).toContain("> **原文**：I didn't know what he was gonna do and I was holding on tight.");
    expect(foreignContent).toContain("> **中文译文**：我不知道他准备做什么，而我正紧紧抓住。");
    expect(foreignContent).toContain("> **怎么读**：");
    expect(foreignContent).toContain("> - I didn't know → 我不知道");
    expect(foreignContent).toContain("> **值得记住**：");
    expect(foreignContent).toContain("> - **didn't know what...**：不知道……");
    expect(foreignContent).toContain("[↗ 回到原文]");

    // 3. Add grammar to 外文笔记
    await appendGrammarStudyNote(mockApp, {
      sentence: "He would have gone...",
      structure: "主句 + 条件从句",
      points: [{ label: "虚拟语气", target: "would have gone", explanation: "对过去的虚拟" }],
      paraphrase: "如果他当时知道的话，他早就去了。",
      bookPath: "Books/Flowers.epub",
      bookTitle,
      cfiRange: "epubcfi(/6/2!/4/2:0)",
    });

    foreignContent = mockApp._store.get(foreignNotePath);
    expect(foreignContent).toContain("## 语法");
    expect(foreignContent).toContain("> [!example]- 🧩 语法 · 主句 + 条件从句");
    expect(foreignContent).toContain("**核心结构**：主句 + 条件从句");
    expect(foreignContent).toContain("- **虚拟语气**（`would have gone`）：对过去的虚拟");

    // 4. Add reading note to Book Note (Notes/读书笔记/<book>.md)
    const result = await appendBookReadingNote(mockApp, {
      note: "这里作者使用了极具深意的对比。",
      selectedText: "The shadows lengthened...",
      bookPath: "Books/Flowers.epub",
      bookTitle,
      cfiRange: "epubcfi(/6/2!/4/3:0)",
    });

    expect(result.blockId).toBeTruthy();
    const bookNotePath = getBookNoteFilePath(bookTitle);
    const bookNoteContent = mockApp._store.get(bookNotePath);
    expect(bookNoteContent).toContain("> [!EPUB|purple+reading-note]");
    expect(bookNoteContent).toContain("> <!-- div -->");
    expect(bookNoteContent).not.toContain("---div---");
    expect(bookNoteContent).toContain(`^${result.blockId}`);
    expect(bookNoteContent).toContain("> 这里作者使用了极具深意的对比。");

    // Verify 外文笔记 does NOT contain 读书笔记/随手笔记
    expect(mockApp._store.get(foreignNotePath)).not.toContain("## 随手笔记");
  });

  it("appends block-level and item-level comprehension notes with distinct types", async () => {
    const mockApp = createMockApp();
    const bookTitle = "Flowers for Algernon";
    const bookPath = "Books/Flowers.epub";
    const cfiRange = "epubcfi(/6/2!/4/10:0)";
    const sentence = "I didn't know what he was gonna do.";

    // 1. Module level 怎么读
    await (await import("../../ai/zora/zora-study-note-service")).appendComprehensionHowToReadNote(mockApp, {
      sentence,
      items: [
        { chunk: "I didn't know", translation: "我不知道" },
        { chunk: "what he was gonna do", translation: "他打算做什么" },
      ],
      bookPath,
      bookTitle,
      cfiRange,
    });

    // 2. Single item 怎么读
    await (await import("../../ai/zora/zora-study-note-service")).appendComprehensionSingleChunkNote(mockApp, {
      sentence,
      chunk: "what he was gonna do",
      translation: "他打算做什么",
      bookPath,
      bookTitle,
      cfiRange,
    });

    // 3. Module level 值得记住
    await (await import("../../ai/zora/zora-study-note-service")).appendComprehensionKeyPatternsNote(mockApp, {
      sentence,
      items: [{ pattern: "keep telling sb to do sth", meaning: "一直叫某人做某事" }],
      bookPath,
      bookTitle,
      cfiRange,
    });

    // 4. Single item 值得记住
    await (await import("../../ai/zora/zora-study-note-service")).appendComprehensionSinglePatternNote(mockApp, {
      sentence,
      pattern: "get sb + adjective",
      meaning: "使某人变得……",
      bookPath,
      bookTitle,
      cfiRange,
    });

    // 5. Transfer example 顺手记一下 (迁移例句)
    await (await import("../../ai/zora/zora-study-note-service")).appendComprehensionTransferNote(mockApp, {
      sentence,
      exampleSentence: "She kept asking me the same question.",
      exampleTranslation: "她一直问我同一个问题。",
      pattern: "keep doing sth",
      bookPath,
      bookTitle,
      cfiRange,
    });

    const filePath = getStudyNoteFilePath(bookTitle);
    const content = mockApp._store.get(filePath);

    expect(content).toContain("> [!example]- 💡 怎么读");
    expect(content).toContain("> - I didn't know → 我不知道");
    expect(content).toContain("> **意群**：what he was gonna do → 他打算做什么");
    expect(content).toContain("> [!example]- 💡 值得记住");
    expect(content).toContain("> - **keep telling sb to do sth**：一直叫某人做某事");
    expect(content).toContain("> **表达**：**get sb + adjective** → 使某人变得……");
    expect(content).not.toContain("为什么这样说");
    expect(content).toContain("> [!example]- 💡 迁移例句");
    expect(content).toContain("> **例句**：She kept asking me the same question.");
    expect(content).toContain("> **理解**：她一直问我同一个问题。");
    expect(content).toContain("> **搭配**：keep doing sth");
  });
});
