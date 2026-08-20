import { describe, expect, it, vi } from "vitest";
import {
  appendBookReadingNote,
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
      "Notes/Flowers for Algernon.md"
    );
  });

  it("builds clean EPUB deep link", () => {
    const link = buildEpubDeepLink("Books/test.epub", "readium:abc", 2);
    expect(link).toContain("obsidian://");
    expect(link).toContain("file=Books%2Ftest.epub");
    expect(link).toContain("cfi=readium%3Aabc");
    expect(link).toContain("chapter=2");
  });

  it("appends vocabulary and grammar to Notes/外文笔记/<book>.md, and reading notes to Notes/<book>.md", async () => {
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

    // 2. Add grammar to 外文笔记
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

    // 3. Add reading note to Book Note (Notes/<book>.md)
    await appendBookReadingNote(mockApp, {
      note: "这里作者使用了极具深意的对比。",
      selectedText: "The shadows lengthened...",
      bookPath: "Books/Flowers.epub",
      bookTitle,
      cfiRange: "epubcfi(/6/2!/4/3:0)",
    });

    const bookNotePath = getBookNoteFilePath(bookTitle);
    const bookNoteContent = mockApp._store.get(bookNotePath);
    expect(bookNoteContent).toContain("# Flowers for Algernon · 读书笔记");
    expect(bookNoteContent).toContain("## 读书笔记");
    expect(bookNoteContent).toContain("> [!note]- ✍ 读书笔记");
    expect(bookNoteContent).toContain("> 这里作者使用了极具深意的对比。");

    // Verify 外文笔记 does NOT contain 读书笔记/随手笔记
    expect(mockApp._store.get(foreignNotePath)).not.toContain("## 随手笔记");
  });
});
