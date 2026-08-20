import type { App } from "obsidian";
import { EPUB_RUNTIME } from "../../epub/epub-runtime";
import { DirectoryUtils } from "../../../utils/directory-utils";

export interface StudyNoteVocabularyInput {
  word: string;
  partOfSpeech?: string;
  contextMeaning?: string;
  senses?: Array<{ label?: string; meaning: string }>;
  sentence?: string;
  bookPath: string;
  bookTitle: string;
  cfiRange: string;
  chapterIndex?: number;
}

export interface StudyNoteGrammarInput {
  sentence: string;
  explanation: string;
  bookPath: string;
  bookTitle: string;
  cfiRange: string;
  chapterIndex?: number;
}

export interface StudyNoteUserInput {
  note: string;
  selectedText: string;
  bookPath: string;
  bookTitle: string;
  cfiRange: string;
  chapterIndex?: number;
}

export interface BookReadingNoteInput {
  note: string;
  selectedText: string;
  bookPath: string;
  bookTitle: string;
  cfiRange: string;
  chapterIndex?: number;
}

export function buildEpubDeepLink(
  filePath: string,
  cfi: string,
  chapterIndex?: number
): string {
  const params = new URLSearchParams();
  params.set("file", filePath);
  if (cfi) {
    params.set("cfi", cfi);
  }
  if (chapterIndex !== undefined && Number.isFinite(chapterIndex)) {
    params.set("chapter", String(chapterIndex));
  }
  return `obsidian://${EPUB_RUNTIME.protocol.primaryName}?${params.toString()}`;
}

export function sanitizeBookFileName(title: string): string {
  const cleaned = String(title || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim();
  return cleaned || "未知书籍";
}

export function getStudyNoteFilePath(bookTitle: string): string {
  return `Notes/外文笔记/${sanitizeBookFileName(bookTitle)}.md`;
}

export function getBookNoteFilePath(bookTitle: string): string {
  return `Notes/读书笔记/${sanitizeBookFileName(bookTitle)}.md`;
}

export async function appendStudyNoteEntry(
  app: App,
  bookTitle: string,
  category: "词义" | "语法" | "随手笔记",
  calloutMarkdown: string
): Promise<string> {
  const filePath = getStudyNoteFilePath(bookTitle);
  const adapter = app.vault.adapter;
  await DirectoryUtils.ensureDirForFile(adapter, filePath);

  let content = "";
  const exists = await adapter.exists(filePath);
  if (exists) {
    content = await adapter.read(filePath);
  } else {
    content = `# ${bookTitle} · 外文笔记\n\n`;
  }

  const categoryHeader = `## ${category}`;
  const headerIndex = content.indexOf(categoryHeader);

  if (headerIndex >= 0) {
    const afterHeaderIndex = headerIndex + categoryHeader.length;
    const nextHeaderMatch = content.slice(afterHeaderIndex).match(/\n## [^\n]+/);
    if (nextHeaderMatch && nextHeaderMatch.index !== undefined) {
      const splitPoint = afterHeaderIndex + nextHeaderMatch.index;
      const before = content.slice(0, splitPoint).trimEnd();
      const after = content.slice(splitPoint);
      content = `${before}\n\n${calloutMarkdown}\n${after}`;
    } else {
      content = `${content.trimEnd()}\n\n${calloutMarkdown}\n`;
    }
  } else {
    content = `${content.trimEnd()}\n\n${categoryHeader}\n\n${calloutMarkdown}\n`;
  }

  await adapter.write(filePath, content);
  return filePath;
}

export async function appendVocabularyStudyNote(
  app: App,
  input: StudyNoteVocabularyInput
): Promise<string> {
  const deepLink = buildEpubDeepLink(input.bookPath, input.cfiRange, input.chapterIndex);
  const sensesList =
    input.senses && input.senses.length > 0
      ? input.senses
          .slice(0, 5)
          .map((s) => `> - ${s.label ? `${s.label} ` : ""}${s.meaning}`)
          .join("\n")
      : "";

  const lines = [
    `> [!abstract]- 📖 ${input.word}${input.partOfSpeech ? ` · ${input.partOfSpeech}` : ""}`,
  ];
  if (input.contextMeaning) {
    lines.push(`> **语境义**：${input.contextMeaning}`);
  }
  if (sensesList) {
    lines.push(`>`);
    lines.push(`> **其他释义**：`);
    lines.push(sensesList);
  }
  if (input.sentence) {
    lines.push(`>`);
    lines.push(`> **例句**：${input.sentence.trim()}`);
  }
  lines.push(`>`);
  lines.push(`> [↗ 回到原文](${deepLink})`);

  return appendStudyNoteEntry(app, input.bookTitle, "词义", lines.join("\n"));
}

export async function appendGrammarStudyNote(
  app: App,
  input: StudyNoteGrammarInput
): Promise<string> {
  const deepLink = buildEpubDeepLink(input.bookPath, input.cfiRange, input.chapterIndex);
  const lines = [
    `> [!example]- 🧩 语法分析`,
    `> **原句**：${input.sentence.trim()}`,
    `>`,
    `> ${input.explanation.trim()}`,
    `>`,
    `> [↗ 回到原文](${deepLink})`,
  ];

  return appendStudyNoteEntry(app, input.bookTitle, "语法", lines.join("\n"));
}

export async function appendUserStudyNote(
  app: App,
  input: StudyNoteUserInput
): Promise<string> {
  const deepLink = buildEpubDeepLink(input.bookPath, input.cfiRange, input.chapterIndex);
  const lines = [
    `> [!note]- ✍ 笔记`,
    `> ${input.note.trim()}`,
    `>`,
    `> **原文**：${input.selectedText.trim()}`,
    `>`,
    `> [↗ 回到原文](${deepLink})`,
  ];

  return appendStudyNoteEntry(app, input.bookTitle, "随手笔记", lines.join("\n"));
}

export async function appendBookReadingNote(
  app: App,
  input: BookReadingNoteInput
): Promise<string> {
  const filePath = getBookNoteFilePath(input.bookTitle);
  const adapter = app.vault.adapter;
  await DirectoryUtils.ensureDirForFile(adapter, filePath);

  const deepLink = buildEpubDeepLink(input.bookPath, input.cfiRange, input.chapterIndex);
  const quotedNote = input.note
    ? input.note
        .trim()
        .split("\n")
        .map((l) => (l.trim() ? `> ${l}` : `>`))
        .join("\n")
    : "";
  const quotedText = input.selectedText
    .trim()
    .split("\n")
    .map((l) => (l.trim() ? `> ${l}` : `>`))
    .join("\n");

  const blockId = Math.random().toString(36).substring(2, 8);
  const calloutLines = [
    `> [!EPUB]- ✍ 读书笔记`,
    quotedText,
    `>`,
    `> [↗ 回到原文](${deepLink})`,
    `> ---div---`,
  ];
  if (quotedNote) {
    calloutLines.push(quotedNote);
  }
  calloutLines.push(`^${blockId}`);

  const calloutMarkdown = calloutLines.join("\n");

  let content = "";
  const exists = await adapter.exists(filePath);
  if (exists) {
    content = await adapter.read(filePath);
  } else {
    content = `# ${input.bookTitle} · 读书笔记\n\n`;
  }

  const sectionHeaders = ["## 读书笔记", "## 随手笔记", "## 笔记"];
  let foundHeader = "";
  let headerIndex = -1;

  for (const h of sectionHeaders) {
    const idx = content.indexOf(h);
    if (idx >= 0) {
      foundHeader = h;
      headerIndex = idx;
      break;
    }
  }

  if (headerIndex >= 0 && foundHeader) {
    const afterHeaderIndex = headerIndex + foundHeader.length;
    const nextHeaderMatch = content.slice(afterHeaderIndex).match(/\n## [^\n]+/);
    if (nextHeaderMatch && nextHeaderMatch.index !== undefined) {
      const splitPoint = afterHeaderIndex + nextHeaderMatch.index;
      const before = content.slice(0, splitPoint).trimEnd();
      const after = content.slice(splitPoint);
      content = `${before}\n\n${calloutMarkdown}\n${after}`;
    } else {
      content = `${content.trimEnd()}\n\n${calloutMarkdown}\n`;
    }
  } else {
    content = `${content.trimEnd()}\n\n## 读书笔记\n\n${calloutMarkdown}\n`;
  }

  await adapter.write(filePath, content);
  return filePath;
}