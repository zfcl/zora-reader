import { describe, expect, it, vi } from "vitest";
import {
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

  it("appends vocabulary, grammar and user notes under separate sections in single file", async () => {
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

    // 2. Add grammar
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

    // 3. Add user note
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

    // 4. Add another vocabulary and verify it inserts under ## 词义 before ## 语法
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
    const grammarIndex = content.indexOf("## 语法");
    const mazeIndex = content.indexOf("📖 maze");
    expect(mazeIndex).toBeGreaterThan(vocabIndex);
    expect(mazeIndex).toBeLessThan(grammarIndex);
  });
});
