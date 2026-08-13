import type { App, TFile } from 'obsidian';
import type { EpubPluginSettings } from './EpubPluginSettings';
import type { SelectionCapture, TranslationResult } from './translation';

export interface CaptureDraft {
  thoughts: string;
  example: string;
  tags: string;
  addToReview: boolean;
}

export interface SavedCapture {
  file: TFile;
  created: boolean;
}

export async function saveCapture(
  app: App,
  settings: EpubPluginSettings,
  book: TFile,
  capture: SelectionCapture,
  result: TranslationResult,
  draft: CaptureDraft,
): Promise<SavedCapture> {
  const bookFolder = vaultPath(`${settings.captureFolder}/${safeSegment(book.basename)}`);
  const kindFolder = result.kind === 'word' ? 'Words' : result.kind === 'phrase' ? 'Phrases' : 'Passages';
  const folder = vaultPath(`${bookFolder}/${kindFolder}`);
  await ensureFolder(app, folder);

  const identity = result.kind === 'word'
    ? safeSegment(normalizeWord(result.lemma || result.source))
    : `${new Date().toISOString().replace(/[:.]/g, '-')}-${shortHash(`${capture.cfi}\n${capture.text}`)}`;
  const path = vaultPath(`${folder}/${identity}.md`);
  const existing = app.vault.getFileByPath(path);
  let file: TFile;
  let created = false;

  if (existing != null && result.kind === 'word') {
    file = existing;
    await app.vault.process(file, (content) => mergeWordCapture(content, book.path, capture, result, draft));
  } else {
    file = await app.vault.create(path, renderCapture(book, capture, result, draft));
    created = true;
  }

  const note = await ensureBookNote(app, settings, book);
  await app.vault.process(note, (content) => addEmbed(content, file, result.kind));
  return { file, created };
}

export function normalizeWord(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase().replace(/[’`]/g, "'");
}

function renderCapture(book: TFile, capture: SelectionCapture, result: TranslationResult, draft: CaptureDraft): string {
  const now = new Date().toISOString();
  const review = result.kind === 'word' || draft.addToReview;
  const frontmatter = [
    '---',
    'zora_reader: true',
    `kind: ${result.kind}`,
    `book: ${yaml(book.basename)}`,
    `book_file: ${yaml(book.path)}`,
    `source: ${yaml(result.source)}`,
    result.lemma ? `lemma: ${yaml(result.lemma)}` : '',
    `review: ${review}`,
    `status: ${review ? 'new' : 'reference'}`,
    `due: ${review ? localDate(new Date()) : ''}`,
    'interval: 0',
    'ease: 2.5',
    'lapses: 0',
    `created: ${now}`,
    `updated: ${now}`,
    '---',
  ].filter(Boolean).join('\n');

  const title = result.lemma || result.source;
  return `${frontmatter}\n\n# ${title}\n\n${renderTranslation(result)}\n\n${renderContext(book, capture, result)}\n\n## 我的笔记\n\n${draft.thoughts.trim() || ''}${draft.example.trim() ? `\n\n**自造句**\n\n${draft.example.trim()}` : ''}${draft.tags.trim() ? `\n\n**标签** ${draft.tags.trim()}` : ''}\n`;
}

function mergeWordCapture(content: string, bookPath: string, capture: SelectionCapture, result: TranslationResult, draft: CaptureDraft): string {
  if (content.includes(`<!-- zora-cfi:${capture.cfi} -->`)) return content;
  const block = renderContext(bookPath || stringFromFrontmatter(content, 'book_file'), capture, result);
  const insertion = `${block}\n\n${draft.thoughts.trim() ? `**本次想法** ${draft.thoughts.trim()}\n\n` : ''}`;
  const marker = '\n## 我的笔记';
  const at = content.indexOf(marker);
  const updated = at >= 0 ? `${content.slice(0, at)}\n${insertion}${content.slice(at)}` : `${content.trimEnd()}\n\n${insertion}`;
  return mergeSenses(updated, result).replace(/^updated:.*$/m, `updated: ${new Date().toISOString()}`);
}

function renderTranslation(result: TranslationResult): string {
  if (result.kind !== 'word') return `## 翻译\n\n${result.translation}`;
  const senses = result.senses.map((sense) => `- **${sense.label}**：${sense.meaning}${sense.usage ? ` — ${sense.usage}` : ''}`).join('\n');
  return `## 当前语境\n\n- **词性**：${result.partOfSpeech || '—'}\n- **语境义**：${result.currentMeaning || result.translation}\n${result.sentenceTranslation ? `- **本句翻译**：${result.sentenceTranslation}\n` : ''}\n## 全部可靠释义\n\n${senses || `- ${result.translation}`}`;
}

function renderContext(book: TFile | string, capture: SelectionCapture, result: TranslationResult): string {
  const filePath = typeof book === 'string' ? book : book.path;
  const target = `obsidian://zora-reader?book=${encodeURIComponent(filePath)}&cfi=${encodeURIComponent(capture.cfi)}`;
  return `## 语境 · ${capture.chapter || '当前位置'}\n\n<!-- zora-cfi:${capture.cfi} -->\n> ${capture.context || result.source}\n\n- **选中**：${result.source}\n- **语境义**：${result.currentMeaning || result.translation}\n- **位置**：[回到原文](${target})\n- **进度**：${Math.round(capture.progress * 1000) / 10}%`;
}

function mergeSenses(content: string, result: TranslationResult): string {
  if (result.kind !== 'word' || result.senses.length === 0) return content;
  const heading = '## 全部可靠释义';
  const start = content.indexOf(heading);
  if (start < 0) return content;
  const next = content.indexOf('\n## ', start + heading.length);
  const end = next < 0 ? content.length : next;
  const section = content.slice(start, end);
  const additions = result.senses.map((sense) => `- **${sense.label}**：${sense.meaning}${sense.usage ? ` — ${sense.usage}` : ''}`).filter((line) => !section.includes(line));
  return additions.length ? `${content.slice(0, end).trimEnd()}\n${additions.join('\n')}\n${content.slice(end)}` : content;
}

async function ensureBookNote(app: App, settings: EpubPluginSettings, book: TFile): Promise<TFile> {
  await ensureFolder(app, settings.bookNoteFolder);
  const path = vaultPath(`${settings.bookNoteFolder}/${safeSegment(book.basename)}.md`);
  const existing = app.vault.getFileByPath(path);
  if (existing) return existing;
  return app.vault.create(path, `---\ntitle: ${yaml(book.basename)}\nbook_file: ${yaml(book.path)}\nformat: EPUB\nstatus: reading\n---\n\n# ${book.basename}\n\n## Why I am reading this\n\n## Vocabulary\n\n## Phrases\n\n## Reading captures\n\n## My thoughts\n\n## After finishing\n`);
}

function addEmbed(content: string, captureFile: TFile, kind: TranslationResult['kind']): string {
  const embed = `![[${captureFile.path}]]`;
  if (content.includes(embed)) return content;
  const headings = kind === 'word' ? ['## Vocabulary', '## Vocabulary worth remembering'] : kind === 'phrase' ? ['## Phrases'] : ['## Reading captures'];
  const heading = headings[0];
  const matched = headings.map((candidate) => ({ candidate, at: content.search(new RegExp(`^${escapeRegExp(candidate)}\\s*$`, 'm')) })).find(({ at }) => at >= 0);
  if (!matched) return `${content.trimEnd()}\n\n${heading}\n\n${embed}\n`;
  const insertAt = content.indexOf('\n', matched.at + matched.candidate.length);
  return `${content.slice(0, insertAt + 1)}\n${embed}\n${content.slice(insertAt + 1)}`;
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const normalized = vaultPath(path);
  let current = '';
  for (const segment of normalized.split('/').filter(Boolean)) {
    current = current ? `${current}/${segment}` : segment;
    if (app.vault.getAbstractFileByPath(current) == null) await app.vault.createFolder(current);
  }
}

function safeSegment(value: string): string {
  const safe = value.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return (safe || 'Untitled').slice(0, 96);
}

function yaml(value: string): string { return JSON.stringify(value); }
function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}
function stringFromFrontmatter(content: string, key: string): string {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!match) return '';
  try { return JSON.parse(match[1]) as string; } catch { return match[1].trim(); }
}
function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function vaultPath(path: string): string { return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/|\/$/g, ''); }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
