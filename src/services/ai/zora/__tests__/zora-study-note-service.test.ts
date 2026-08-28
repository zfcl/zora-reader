import { describe, expect, it, vi } from "vitest";
import {
  appendComprehensionStudyNote,
  appendGrammarStudyNote,
  appendStudyNoteEntry,
  appendUserStudyNote,
  appendVocabularyStudyNote,
  buildEpubDeepLink,
  getStudyNoteFilePath,
  sanitizeBookFileName,
} from "../zora-study-note-service";

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
  });

  it("builds clean EPUB deep link", () => {
    const link = buildEpubDeepLink("Books/test.epub", "readium:abc", 2);
    expect(link).toContain("obsidian://");
    expect(link).toContain("file=Books%2Ftest.epub");
    expect(link).toContain("cfi=readium%3Aabc");
    expect(link).toContain("chapter=2");
  });

  it("appends vocabulary, comprehension, grammar and user notes under separate sections in single file", async () => {
    const mockApp = createMockApp();
    const bookTitle = "Flowers for Algernon";

    // 1. Add vocabulary
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

    const filePath = getStudyNoteFilePath(bookTitle);
    let content = mockApp._store.get(filePath);
    expect(content).toContain("# Flowers for Algernon · 外文笔记");
    expect(content).toContain("## 词义");
    expect(content).toContain("> [!abstract]- 📖 old · 形容词");
    expect(content).toContain("> **语境义**：最古老的；历史最悠久的");
    expect(content).toContain("[↗ 回到原文]");

    // 2. Add comprehension (简易理解)
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

    content = mockApp._store.get(filePath);
    expect(content).toContain("## 简易理解");
    expect(content).toContain("> [!example]- 💡 理解");
    expect(content).toContain("> **原文**：I didn't know what he was gonna do and I was holding on tight.");
    expect(content).toContain("> **中文译文**：我不知道他准备做什么，而我正紧紧抓住。");
    expect(content).toContain("> **怎么读**：");
    expect(content).toContain("> - I didn't know → 我不知道");
    expect(content).toContain("> **值得记住**：");
    expect(content).toContain("> - **didn't know what...**：不知道……");
    expect(content).toContain("[↗ 回到原文]");

    // 3. Add grammar
    await appendGrammarStudyNote(mockApp, {
      sentence: "He would have gone...",
      explanation: "【核心语法】：虚拟语气，表示对过去的虚拟。",
      bookPath: "Books/Flowers.epub",
      bookTitle,
      cfiRange: "epubcfi(/6/2!/4/2:0)",
    });

    content = mockApp._store.get(filePath);
    expect(content).toContain("## 语法");
    expect(content).toContain("> [!example]- 🧩 语法");
    expect(content).toContain("> 【核心语法】：虚拟语气");

    // 4. Add user note
    await appendUserStudyNote(mockApp, {
      note: "这里用了非常精妙的隐喻",
      selectedText: "The shadows lengthened...",
      bookPath: "Books/Flowers.epub",
      bookTitle,
      cfiRange: "epubcfi(/6/2!/4/3:0)",
    });

    content = mockApp._store.get(filePath);
    expect(content).toContain("## 随手笔记");
    expect(content).toContain("> [!note]- ✍ 笔记");
    expect(content).toContain("> 这里用了非常精妙的隐喻");

    // 5. Add another vocabulary and verify it inserts under ## 词义 before ## 简易理解
    await appendVocabularyStudyNote(mockApp, {
      word: "maze",
      partOfSpeech: "名词",
      contextMeaning: "迷宫",
      bookPath: "Books/Flowers.epub",
      bookTitle,
      cfiRange: "epubcfi(/6/2!/4/4:0)",
    });

    content = mockApp._store.get(filePath);
    const vocabIndex = content.indexOf("## 词义");
    const compIndex = content.indexOf("## 简易理解");
    const grammarIndex = content.indexOf("## 语法");
    const mazeIndex = content.indexOf("📖 maze");
    expect(mazeIndex).toBeGreaterThan(vocabIndex);
    expect(mazeIndex).toBeLessThan(compIndex);
    expect(compIndex).toBeLessThan(grammarIndex);
  });

  it("appends block-level and item-level comprehension notes with distinct types", async () => {
    const mockApp = createMockApp();
    const bookTitle = "Flowers for Algernon";
    const bookPath = "Books/Flowers.epub";
    const cfiRange = "epubcfi(/6/2!/4/10:0)";
    const sentence = "I didn't know what he was gonna do.";

    // 1. Module level 怎么读
    await (await import("../zora-study-note-service")).appendComprehensionHowToReadNote(mockApp, {
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
    await (await import("../zora-study-note-service")).appendComprehensionSingleChunkNote(mockApp, {
      sentence,
      chunk: "what he was gonna do",
      translation: "他打算做什么",
      bookPath,
      bookTitle,
      cfiRange,
    });

    // 3. Module level 值得记住
    await (await import("../zora-study-note-service")).appendComprehensionKeyPatternsNote(mockApp, {
      sentence,
      items: [{ pattern: "keep telling sb to do sth", meaning: "一直叫某人做某事" }],
      bookPath,
      bookTitle,
      cfiRange,
    });

    // 4. Single item 值得记住
    await (await import("../zora-study-note-service")).appendComprehensionSinglePatternNote(mockApp, {
      sentence,
      pattern: "get sb + adjective",
      meaning: "使某人变得……",
      bookPath,
      bookTitle,
      cfiRange,
    });

    // 5. Transfer example 顺手记一下 (迁移例句)
    await (await import("../zora-study-note-service")).appendComprehensionTransferNote(mockApp, {
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
