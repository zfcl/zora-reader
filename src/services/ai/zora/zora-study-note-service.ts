import { TFile, type App } from "obsidian";
import { EPUB_RUNTIME } from "../../epub/epub-runtime";
import { DirectoryUtils } from "../../../utils/directory-utils";
import { EpubLinkService } from "../../epub/EpubLinkService";
import { getZoraSyncService } from "../../sync/ZoraSyncService";
import { logMobileEvent, logMobileError } from "../../../utils/zora-mobile-logger";

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
  explanation?: string;
  structure?: string;
  points?: Array<{ label: string; target?: string; explanation: string }>;
  paraphrase?: string;
  bookPath: string;
  bookTitle: string;
  cfiRange: string;
  chapterIndex?: number;
}

export interface StudyNoteComprehensionInput {
  sentence: string;
  translation?: string;
  howToRead?: Array<{ chunk: string; translation: string }>;
  keyPatterns?: Array<{ pattern: string; meaning: string }>;
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

async function writeVaultFile(app: App, filePath: string, content: string): Promise<void> {
  const adapter = app?.vault?.adapter;
  if (adapter) {
    await DirectoryUtils.ensureDirForFile(adapter, filePath);
  }
  const abstractFile = app?.vault?.getAbstractFileByPath?.(filePath);
  if (abstractFile && (abstractFile instanceof TFile || (abstractFile as TFile).extension === "md")) {
    if (typeof app.vault?.modify === "function") {
      await app.vault.modify(abstractFile as TFile, content);
      return;
    }
  }
  if (typeof app?.vault?.create === "function") {
    try {
      await app.vault.create(filePath, content);
      return;
    } catch {
      // Fallback to adapter.write if file already exists or create failed
    }
  }
  if (adapter?.write) {
    await adapter.write(filePath, content);
  }
}

export async function appendStudyNoteEntry(
  app: App,
  bookTitle: string,
  category: "词义" | "语法" | "简易理解" | "随手笔记" | string,
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

  await writeVaultFile(app, filePath, content);
  logMobileEvent("Notes", "StudyNoteAppended", { bookTitle, category, filePath });
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
  const titlePart = input.structure ? ` · ${input.structure}` : "";
  const lines = [
    `> [!example]- 🧩 语法${titlePart}`,
    `> **原句**：${input.sentence.trim()}`,
  ];
  if (input.structure) {
    lines.push(`>`);
    lines.push(`> **核心结构**：${input.structure.trim()}`);
  }
  if (input.points && input.points.length > 0) {
    lines.push(`>`);
    lines.push(`> **语法点**：`);
    for (const pt of input.points) {
      const targetStr = pt.target ? `（\`${pt.target}\`）` : "";
      lines.push(`> - **${pt.label}**${targetStr}：${pt.explanation}`);
    }
  }
  if (input.paraphrase) {
    lines.push(`>`);
    lines.push(`> **意译**：${input.paraphrase.trim()}`);
  }
  if (input.explanation) {
    lines.push(`>`);
    lines.push(`> ${input.explanation.trim()}`);
  }
  lines.push(`>`);
  lines.push(`> [↗ 回到原文](${deepLink})`);

  return appendStudyNoteEntry(app, input.bookTitle, "语法", lines.join("\n"));
}

export async function appendComprehensionHowToReadNote(
  app: App,
  input: {
    sentence: string;
    items: Array<{ chunk: string; translation: string }>;
    bookPath: string;
    bookTitle: string;
    cfiRange: string;
    chapterIndex?: number;
  }
): Promise<string> {
  const deepLink = buildEpubDeepLink(input.bookPath, input.cfiRange, input.chapterIndex);
  const lines = [
    `> [!example]- 💡 怎么读`,
    `> **原句**：${input.sentence.trim()}`,
  ];
  if (input.items && input.items.length > 0) {
    lines.push(`>`);
    for (const item of input.items) {
      lines.push(`> - ${item.chunk} → ${item.translation}`);
    }
  }
  lines.push(`>`);
  lines.push(`> [↗ 回到原文](${deepLink})`);
  return appendStudyNoteEntry(app, input.bookTitle, "简易理解", lines.join("\n"));
}

export async function appendComprehensionSingleChunkNote(
  app: App,
  input: {
    sentence: string;
    chunk: string;
    translation: string;
    bookPath: string;
    bookTitle: string;
    cfiRange: string;
    chapterIndex?: number;
  }
): Promise<string> {
  const deepLink = buildEpubDeepLink(input.bookPath, input.cfiRange, input.chapterIndex);
  const lines = [
    `> [!example]- 💡 怎么读`,
    `> **意群**：${input.chunk.trim()} → ${input.translation.trim()}`,
    `>`,
    `> **原句**：${input.sentence.trim()}`,
    `>`,
    `> [↗ 回到原文](${deepLink})`,
  ];
  return appendStudyNoteEntry(app, input.bookTitle, "简易理解", lines.join("\n"));
}

export async function appendComprehensionKeyPatternsNote(
  app: App,
  input: {
    sentence: string;
    items: Array<{ pattern: string; meaning: string }>;
    bookPath: string;
    bookTitle: string;
    cfiRange: string;
    chapterIndex?: number;
  }
): Promise<string> {
  const deepLink = buildEpubDeepLink(input.bookPath, input.cfiRange, input.chapterIndex);
  const lines = [
    `> [!example]- 💡 值得记住`,
    `> **原句**：${input.sentence.trim()}`,
  ];
  if (input.items && input.items.length > 0) {
    lines.push(`>`);
    for (const pat of input.items) {
      lines.push(`> - **${pat.pattern}**：${pat.meaning}`);
    }
  }
  lines.push(`>`);
  lines.push(`> [↗ 回到原文](${deepLink})`);
  return appendStudyNoteEntry(app, input.bookTitle, "简易理解", lines.join("\n"));
}

export async function appendComprehensionSinglePatternNote(
  app: App,
  input: {
    sentence: string;
    pattern: string;
    meaning: string;
    bookPath: string;
    bookTitle: string;
    cfiRange: string;
    chapterIndex?: number;
  }
): Promise<string> {
  const deepLink = buildEpubDeepLink(input.bookPath, input.cfiRange, input.chapterIndex);
  const lines = [
    `> [!example]- 💡 值得记住`,
    `> **表达**：**${input.pattern.trim()}** → ${input.meaning.trim()}`,
    `>`,
    `> **原句**：${input.sentence.trim()}`,
    `>`,
    `> [↗ 回到原文](${deepLink})`,
  ];
  return appendStudyNoteEntry(app, input.bookTitle, "简易理解", lines.join("\n"));
}

export async function appendComprehensionTransferNote(
  app: App,
  input: {
    sentence: string;
    exampleSentence: string;
    exampleTranslation: string;
    pattern?: string;
    bookPath: string;
    bookTitle: string;
    cfiRange: string;
    chapterIndex?: number;
  }
): Promise<string> {
  const deepLink = buildEpubDeepLink(input.bookPath, input.cfiRange, input.chapterIndex);
  const lines = [
    `> [!example]- 💡 迁移例句`,
    `> **例句**：${input.exampleSentence.trim()}`,
    `> **理解**：${input.exampleTranslation.trim()}`,
  ];
  if (input.pattern) {
    lines.push(`> **搭配**：${input.pattern.trim()}`);
  }
  lines.push(`>`);
  lines.push(`> **原句**：${input.sentence.trim()}`);
  lines.push(`>`);
  lines.push(`> [↗ 回到原文](${deepLink})`);
  return appendStudyNoteEntry(app, input.bookTitle, "简易理解", lines.join("\n"));
}

export async function appendComprehensionStudyNote(
  app: App,
  input: StudyNoteComprehensionInput
): Promise<string> {
  const deepLink = buildEpubDeepLink(input.bookPath, input.cfiRange, input.chapterIndex);
  const lines = [
    `> [!example]- 💡 理解`,
    `> **原文**：${input.sentence.trim()}`,
  ];
  if (input.translation) {
    lines.push(`>`);
    lines.push(`> **中文译文**：${input.translation.trim()}`);
  }
  if (input.howToRead && input.howToRead.length > 0) {
    lines.push(`>`);
    lines.push(`> **怎么读**：`);
    for (const chunk of input.howToRead) {
      lines.push(`> - ${chunk.chunk} → ${chunk.translation}`);
    }
  }
  if (input.keyPatterns && input.keyPatterns.length > 0) {
    lines.push(`>`);
    lines.push(`> **值得记住**：`);
    for (const pat of input.keyPatterns) {
      lines.push(`> - **${pat.pattern}**：${pat.meaning}`);
    }
  }
  lines.push(`>`);
  lines.push(`> [↗ 回到原文](${deepLink})`);

  return appendStudyNoteEntry(app, input.bookTitle, "简易理解", lines.join("\n"));
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
): Promise<{ path: string; blockId: string; filePath: string }> {
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
  const encodedCfi = EpubLinkService.encodeCfiForWikilink(input.cfiRange);
  const calloutLines = [
    `> [!EPUB|purple+reading-note] [[${input.bookPath}#weave-cfi=${encodedCfi}&eid=${blockId}|${input.bookTitle}]]`,
    quotedText,
    `> <!-- div -->`,
    `> [↗ 回到原文](${deepLink})`,
  ];
  if (quotedNote) {
    calloutLines.push(`>`);
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

  await writeVaultFile(app, filePath, content);

  try {
    const syncService = getZoraSyncService(app);
    const bookId = await syncService.computeBookIdFromFile(input.bookPath);
    if (bookId) {
      const noteId = blockId;
      const annotationId = `ann-${blockId}`;
      await syncService.saveNote({
        id: noteId,
        bookId,
        annotationId,
        cfiRange: input.cfiRange,
        type: "reading-note",
        content: input.note || "",
        selectedText: input.selectedText,
        chapterIndex: input.chapterIndex,
      });
      await syncService.saveAnnotation({
        id: annotationId,
        bookId,
        cfiRange: input.cfiRange,
        type: "reading-note",
        color: "purple",
        style: "reading-note",
        text: input.selectedText,
        chapterIndex: input.chapterIndex,
      });
    }
  } catch (syncErr) {
    logMobileError("Notes", "SyncBookReadingNoteFailed", syncErr);
  }

  logMobileEvent("Notes", "BookReadingNoteAppended", { bookTitle: input.bookTitle, blockId, filePath });
  return { path: filePath, blockId, filePath };
}
