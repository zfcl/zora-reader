import { isBookCompleted } from "./book-progress";
import { buildEpubBookmarkLinkAlias } from "./epub-bookmark-display-title";
import type { EpubLinkService } from "./EpubLinkService";
import type {
	EpubBookmarkAnalytics,
	EpubBookmarkFlatProperties,
	EpubBookmarkPersistedAnalytics,
	EpubBookmarkReadingStatePayload,
	EpubBookmarkReadingStatusCode,
	EpubBookmarkUserMetadata,
} from "./epub-bookmark-page-types";
import {
	EPUB_BOOKMARK_FILE_FORMAT_V3,
} from "./epub-bookmark-page-types";
import type { ReadingStats } from "./types";
import { unknownPlainText } from "../../utils/unknown-plain-text";

export const EPUB_BOOKMARK_PAGE_MAINTENANCE_NOTE =
	"> 📎 本页由 Zora Reader 自动维护。YAML 中 `readingState`、`bookmarks` 请勿手改；`user` 与「我的标注」可自由编辑。";

/** @deprecated Use EPUB_BOOKMARK_PAGE_MAINTENANCE_NOTE */
export const EPUB_BOOKMARK_PAGE_CALLOUT = EPUB_BOOKMARK_PAGE_MAINTENANCE_NOTE;

export interface EpubBookmarkPageBookmark {
	id?: string;
	cfi: string;
	chapterIndex: number;
	percent: number;
	chapterTitle: string;
	pageNumber?: number;
	totalPages?: number;
	createdAt: number;
	preview?: string;
}

export interface EpubBookmarkPageRenderInput {
	stableKey: string;
	bookId: string;
	sourceId?: string;
	sourceFingerprint?: string;
	bookPath: string;
	displayTitle: string;
	bookTitle: string;
	bookAuthor?: string;
	bookLanguage?: string;
	publisher?: string;
	isbn?: string;
	publishDate?: string;
	subjects?: string[];
	description?: string;
	translator?: string;
	coverPath?: string;
	wordCount?: number;
	chapterCount?: number;
	updatedAt: number;
	bookmarks: EpubBookmarkPageBookmark[];
	readingState?: EpubBookmarkReadingStatePayload;
	analytics?: EpubBookmarkAnalytics;
	user?: EpubBookmarkUserMetadata;
}

export function resolveEpubBookmarkReadingStatus(
	readingState?: EpubBookmarkReadingStatePayload
): EpubBookmarkReadingStatusCode {
	const stats = readingState?.readingStats;
	if (isBookCompleted(stats)) {
		return "finished";
	}
	const percent = readingState?.currentPosition?.percent ?? 0;
	const lastReadTime = stats?.lastReadTime ?? 0;
	const totalReadTime = stats?.totalReadTime ?? 0;
	if (percent > 0 || lastReadTime > 0 || totalReadTime > 0) {
		return "reading";
	}
	return "unstarted";
}

export function buildEpubBookmarkFlatProperties(
	input: Pick<EpubBookmarkPageRenderInput, "readingState" | "analytics" | "bookmarks">
): EpubBookmarkFlatProperties {
	const stats = input.readingState?.readingStats;
	const percent = input.readingState?.currentPosition?.percent ?? 0;
	const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
	const totalMs = stats?.totalReadTime ?? 0;
	const totalMinutes = Number.isFinite(totalMs) ? Math.max(0, Math.round(totalMs / 60_000)) : 0;
	const bookWpm = stats?.bookWpm ?? 0;

	return {
		"reading-progress": isBookCompleted(stats) ? 100 : safePercent,
		"reading-status": resolveEpubBookmarkReadingStatus(input.readingState),
		"reading-total-minutes": totalMinutes,
		"reading-wpm": Number.isFinite(bookWpm) && bookWpm > 0 ? Math.round(bookWpm) : 0,
		"highlight-count": input.analytics?.highlightCount ?? 0,
		"excerpt-note-count": input.analytics?.excerptNoteCount ?? 0,
		"bookmark-count": input.bookmarks.length,
		"last-read-at": stats?.lastReadTime ?? 0,
	};
}

export function toEpubBookmarkPersistedAnalytics(
	analytics?: EpubBookmarkAnalytics
): EpubBookmarkPersistedAnalytics | undefined {
	if (!analytics) {
		return undefined;
	}
	return {
		updatedAt: analytics.updatedAt,
		highlightsByColor: analytics.highlightsByColor,
		commentCount: analytics.commentCount,
		concealedCount: analytics.concealedCount,
		referenceHeatMax: analytics.referenceHeatMax,
		topChaptersByHighlights: analytics.topChaptersByHighlights,
	};
}

export function sanitizeReadingStatsForBookmark(stats: ReadingStats): ReadingStats {
	return {
		totalReadTime: stats.totalReadTime,
		lastReadTime: stats.lastReadTime,
		createdTime: stats.createdTime,
		completedTime: stats.completedTime,
		bookWpm: stats.bookWpm,
		paceSampleCount: stats.paceSampleCount,
		paceSampleWords: stats.paceSampleWords,
	};
}

export function renderEpubBookmarkFileContent(
	input: EpubBookmarkPageRenderInput,
	linkService: EpubLinkService
): string {
	const flat = buildEpubBookmarkFlatProperties(input);
	const yamlPayload = buildEpubBookmarkYamlPayload(input, flat);
	const yamlText = stringifyYamlObject(yamlPayload);
	return `---\n${yamlText}\n---\n\n${renderEpubBookmarkBody(input, linkService, flat)}`;
}

function buildEpubBookmarkYamlPayload(
	input: EpubBookmarkPageRenderInput,
	flat: EpubBookmarkFlatProperties
): Record<string, unknown> {
	const yamlPayload: Record<string, unknown> = {
		format: EPUB_BOOKMARK_FILE_FORMAT_V3,
		weave_epub_bookmark_file: true,
		stableKey: input.stableKey,
		bookId: input.bookId,
		sourceId: input.sourceId,
		sourceFingerprint: input.sourceFingerprint,
		bookPath: input.bookPath,
		displayTitle: input.displayTitle,
		bookTitle: input.bookTitle,
		bookAuthor: input.bookAuthor,
		bookLanguage: input.bookLanguage,
		publisher: input.publisher,
		isbn: input.isbn,
		publishDate: input.publishDate,
		subjects: input.subjects?.length ? input.subjects : undefined,
		description: input.description,
		translator: input.translator,
		coverPath: input.coverPath,
		wordCount: input.wordCount,
		chapterCount: input.chapterCount,
		...flat,
	};

	if (input.readingState) {
		yamlPayload.readingState = {
			currentPosition: input.readingState.currentPosition,
			readingStats: sanitizeReadingStatsForBookmark(input.readingState.readingStats),
		};
	}

	yamlPayload.bookmarks = input.bookmarks.map(({ preview: _preview, ...bookmark }) => bookmark);

	const persistedAnalytics = toEpubBookmarkPersistedAnalytics(input.analytics);
	if (persistedAnalytics) {
		yamlPayload.analytics = persistedAnalytics;
	}

	yamlPayload.user = input.user ?? {
		tags: [],
		rating: null,
		priority: "",
		notes: "",
	};

	yamlPayload.updatedAt = input.updatedAt;
	return yamlPayload;
}

function renderEpubBookmarkBody(
	input: EpubBookmarkPageRenderInput,
	linkService: EpubLinkService,
	flat: EpubBookmarkFlatProperties
): string {
	const lines: string[] = [
		EPUB_BOOKMARK_PAGE_MAINTENANCE_NOTE,
		"",
		`# 📚 ${input.displayTitle || input.bookTitle || "EPUB 书籍"}`,
		"",
		"---",
		"",
	];
	lines.push(...renderBookInfoSection(input));
	lines.push("", "---", "");
	lines.push(...renderReadingProgressSection(input, flat));
	lines.push("", "---", "");
	lines.push(...renderAnnotationStatsSection(input.analytics, flat));
	lines.push("", "---", "");
	lines.push(...renderBookmarksSection(input, linkService));
	lines.push("", "---", "");

	const excerptRows = input.analytics?.recentExcerpts || [];
	lines.push(...renderRecentExcerptsSection(excerptRows));
	lines.push("", "---", "");

	if (input.analytics && input.analytics.highlightCount > 0) {
		lines.push(...renderReadingAnalysisSection(input.analytics));
		lines.push("", "---", "");
	} else {
		lines.push("## 📈 阅读分析", "", "暂无高亮数据", "", "---", "");
	}

	const linkedNotePaths = input.analytics?.linkedNotePaths || [];
	lines.push(...renderLinkedNotesSection(linkedNotePaths));
	lines.push("", "---", "");
	lines.push(...renderUserNotesSection(input.user));
	lines.push("", "---", "", `*${EPUB_BOOKMARK_FILE_FORMAT_V3} · Zora Reader 自动维护*`);
	return lines.join("\n").trimEnd();
}

function renderBookInfoSection(input: EpubBookmarkPageRenderInput): string[] {
	const lines = ["## 📖 书籍信息", "", "| | |", "| :-- | :-- |"];
	const coverCell = input.coverPath
		? `![[${input.coverPath}|200]]`
		: "（暂无封面）";

	lines.push(`| 封面 | ${coverCell} |`);
	lines.push(`| 书名 | ${input.displayTitle || input.bookTitle} |`);

	if (input.bookAuthor) {
		lines.push(`| 作者 | ${input.bookAuthor} |`);
	}
	if (input.translator) {
		lines.push(`| 译者 | ${input.translator} |`);
	}
	if (input.publisher) {
		lines.push(`| 出版社 | ${input.publisher} |`);
	}
	if (input.publishDate) {
		lines.push(`| 出版时间 | ${formatPublishDate(input.publishDate)} |`);
	}
	if (input.isbn) {
		lines.push(`| ISBN | ${input.isbn} |`);
	}
	if (input.subjects?.length) {
		lines.push(`| 分类 | ${input.subjects.join(" · ")} |`);
	}
	if (typeof input.wordCount === "number" && input.wordCount > 0) {
		lines.push(`| 字数 | ${formatWordCount(input.wordCount)} |`);
	}
	if (typeof input.chapterCount === "number" && input.chapterCount > 0) {
		lines.push(`| 章节 | ${input.chapterCount} 章 |`);
	}
	if (input.bookLanguage) {
		lines.push(`| 语言 | ${input.bookLanguage} |`);
	}
	lines.push(
		`| 书籍文件 | [[${input.bookPath}|📂 ${buildEpubBookmarkLinkAlias({
			displayTitle: input.displayTitle,
			bookPath: input.bookPath,
		})}]] |`
	);

	const description = String(input.description || "").trim();
	if (description) {
		lines.push("", "**📄 简介**", "", truncateDescription(description));
	}

	return lines;
}

function renderReadingProgressSection(
	input: EpubBookmarkPageRenderInput,
	flat: EpubBookmarkFlatProperties
): string[] {
	const stats = input.readingState?.readingStats;
	const chapterIndex = input.readingState?.currentPosition?.chapterIndex ?? -1;
	const chapterLabel =
		chapterIndex >= 0 ? `第 ${chapterIndex + 1} 章` : "—";
	const statusLabel = formatReadingStatusLabel(flat["reading-status"]);
	const speedLabel =
		flat["reading-wpm"] > 0 ? `${flat["reading-wpm"]} 字/分钟` : "—";
	const lastRead = formatTimestamp(flat["last-read-at"]) || "—";

	const lines = [
		"## 📊 阅读进度",
		"",
		"| 项目 | 值 |",
		"| :-- | :-- |",
		`| 状态 | ${statusLabel} |`,
		`| 进度 | ${flat["reading-progress"]}% |`,
		`| 当前章节 | ${chapterLabel} |`,
		`| 累计阅读 | ${formatDurationMinutes(flat["reading-total-minutes"])} |`,
		`| 阅读速度 | ${speedLabel} |`,
		`| 最近阅读 | ${lastRead} |`,
	];

	if (input.readingState && flat["reading-status"] !== "unstarted") {
		const percent = formatPercent(input.readingState.currentPosition.percent);
		lines.push(
			"",
			"> [!tip] 📍 继续阅读",
			`> 当前停在 **${chapterLabel}**（约 ${percent}）。在阅读器中打开本书即可续读。`
		);
	}

	if (stats && flat["reading-status"] === "unstarted") {
		lines.push(
			"",
			"> [!tip] 📍 继续阅读",
			"> 尚未开始阅读。打开书籍即可记录进度。"
		);
	}

	return lines;
}

function renderAnnotationStatsSection(
	analytics: EpubBookmarkAnalytics | undefined,
	flat: EpubBookmarkFlatProperties
): string[] {
	return [
		"## ✨ 标注统计",
		"",
		"| 项目 | 数量 |",
		"| :-- | --: |",
		`| 🖍️ 高亮 | ${flat["highlight-count"]} |`,
		`| 📝 关联笔记 | ${flat["excerpt-note-count"]} |`,
		`| 🔖 书签 | ${flat["bookmark-count"]} |`,
		`| 💬 批注 | ${analytics?.commentCount ?? 0} |`,
	];
}

function renderBookmarksSection(
	input: EpubBookmarkPageRenderInput,
	linkService: EpubLinkService
): string[] {
	const lines = ["## 🔖 书签", ""];

	if (input.bookmarks.length === 0) {
		lines.push("暂无书签");
		return lines;
	}

	for (const bookmark of input.bookmarks) {
		const chapterTitle = bookmark.chapterTitle || `第 ${bookmark.chapterIndex + 1} 章`;
		const pageLabel = buildPageLabel(bookmark);
		const createdLabel = formatTimestamp(bookmark.createdAt);
		const link = linkService.buildEpubLink(
			input.bookPath,
			bookmark.cfi,
			bookmark.chapterTitle,
			bookmark.chapterIndex,
			bookmark.chapterTitle,
			undefined,
			input.sourceId
		);
		const jumpLink = link.replace(/\|[^\]|]+\]\]$/, "|↗️ 跳转]]");

		lines.push(`> [!note]- ${chapterTitle}`);
		lines.push(`> 📄 ${pageLabel} · 🕐 ${createdLabel}`);
		lines.push(`> ${jumpLink}`);
		lines.push("");
	}

	if (lines[lines.length - 1] === "") {
		lines.pop();
	}

	return lines;
}

function renderRecentExcerptsSection(
	rows: Array<{
		chapterTitle: string;
		preview: string;
		notePath?: string;
		createdTime: number;
	}>
): string[] {
	const lines = ["## 💡 最近摘录", ""];

	if (rows.length === 0) {
		lines.push("暂无摘录");
		return lines;
	}

	let currentChapter = "";
	for (const row of rows) {
		if (row.chapterTitle !== currentChapter) {
			currentChapter = row.chapterTitle;
			if (lines[lines.length - 1] !== "") {
				lines.push("");
			}
			lines.push(`### ${currentChapter}`, "");
		}

		const noteLink = row.notePath ? `[[${row.notePath}]]` : "—";
		lines.push(`> 📌 ${normalizeInlineText(row.preview)}`);
		lines.push(`> ⏱ ${formatExcerptTimestamp(row.createdTime)} · ${noteLink}`);
		lines.push("");
	}

	if (lines[lines.length - 1] === "") {
		lines.pop();
	}

	return lines;
}

function renderReadingAnalysisSection(analytics: EpubBookmarkAnalytics): string[] {
	const lines = [
		"## 📈 阅读分析",
		"",
		"| 颜色 | 数量 |",
		"| :-- | --: |",
	];

	const colorLabels: Record<string, string> = {
		yellow: "🟡 黄",
		green: "🟢 绿",
		blue: "🔵 蓝",
		red: "🔴 红",
		purple: "🟣 紫",
	};

	for (const [color, count] of Object.entries(analytics.highlightsByColor)) {
		if (!count) {
			continue;
		}
		lines.push(`| ${colorLabels[color] || color} | ${count} |`);
	}

	if (analytics.topChaptersByHighlights.length > 0) {
		lines.push("", "**🏆 高亮最多的章节**", "");
		analytics.topChaptersByHighlights.forEach((entry, index) => {
			lines.push(`${index + 1}. ${entry.title} — ${entry.count} 处`);
		});
	}

	return lines;
}

function renderLinkedNotesSection(linkedNotePaths: string[]): string[] {
	const lines = ["## 🔗 关联笔记", ""];

	if (linkedNotePaths.length === 0) {
		lines.push("暂无关联笔记");
		return lines;
	}

	for (const notePath of linkedNotePaths) {
		lines.push(`- [[${notePath}]]`);
	}

	return lines;
}

function renderUserNotesSection(user?: EpubBookmarkUserMetadata): string[] {
	const lines = [
		"## ✏️ 我的标注",
		"",
		"| 项目 | 内容 |",
		"| :-- | :-- |",
	];

	const tags = Array.isArray(user?.tags)
		? user.tags.map((tag) => `#${String(tag || "").trim().replace(/^#+/, "")}`).filter(Boolean)
		: [];
	const rating =
		typeof user?.rating === "number" && user.rating > 0
			? `${"★".repeat(Math.max(1, Math.min(5, Math.round(user.rating))))}${"☆".repeat(
					5 - Math.max(1, Math.min(5, Math.round(user.rating)))
				)}（${Math.round(user.rating)} / 5）`
			: "";
	const priority = user?.priority ? formatPriorityLabel(user.priority) : "";
	const notes = String(user?.notes || "").trim();

	lines.push(`| 🏷️ 标签 | ${tags.join(" ") || ""} |`);
	lines.push(`| ⭐ 评分 | ${rating} |`);
	lines.push(`| 🚩 优先级 | ${priority} |`);
	lines.push(`| 📋 备注 | ${notes.replace(/\n/g, " ") || ""} |`);
	lines.push(
		"",
		"> [!quote] ✏️ 可编辑区",
		"> 在上方表格或此处自由书写；插件不会覆盖本节。"
	);

	return lines;
}

function formatReadingStatusLabel(status: EpubBookmarkReadingStatusCode): string {
	switch (status) {
		case "finished":
			return "✅ 已读完";
		case "reading":
			return "🟢 阅读中";
		default:
			return "⚪ 未开始";
	}
}

function formatPriorityLabel(priority: string): string {
	switch (priority) {
		case "high":
			return "高";
		case "low":
			return "低";
		default:
			return priority || "中";
	}
}

function formatDurationMinutes(totalMinutes: number): string {
	const safeMinutes = Number.isFinite(totalMinutes) ? Math.max(0, totalMinutes) : 0;
	if (safeMinutes < 60) {
		return `${safeMinutes} 分钟`;
	}
	const hours = Math.floor(safeMinutes / 60);
	const minutes = safeMinutes % 60;
	return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}

function formatWordCount(wordCount: number): string {
	if (wordCount >= 10_000) {
		return `${(wordCount / 10_000).toFixed(1).replace(/\.0$/, "")} 万`;
	}
	return `${wordCount}`;
}

function formatPublishDate(value: string): string {
	const normalized = String(value || "").trim();
	if (!normalized) {
		return "—";
	}
	return normalized.replace(/T.+$/, "").replace(/\s00:00:00$/, "");
}

function truncateDescription(value: string, maxLength = 240): string {
	const normalized = String(value || "")
		.replace(/\s+/g, " ")
		.trim();
	if (normalized.length <= maxLength) {
		return normalized;
	}
	return `${normalized.slice(0, maxLength)}…`;
}

function buildPageLabel(bookmark: EpubBookmarkPageBookmark): string {
	if (typeof bookmark.pageNumber === "number" && bookmark.pageNumber > 0) {
		if (typeof bookmark.totalPages === "number" && bookmark.totalPages >= bookmark.pageNumber) {
			return `第 ${bookmark.pageNumber} / ${bookmark.totalPages} 页`;
		}
		return `第 ${bookmark.pageNumber} 页`;
	}
	return `进度 ${formatPercent(bookmark.percent)}`;
}

function formatPercent(percent: number): string {
	const safe = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
	return `${Math.round(safe)}%`;
}

function formatTimestamp(timestamp: number): string {
	if (!timestamp) {
		return "";
	}
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatExcerptTimestamp(timestamp: number): string {
	if (!timestamp) {
		return "—";
	}
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function normalizeInlineText(value: string): string {
	return String(value || "")
		.replace(/\s+/g, " ")
		.trim();
}

function stringifyYamlObject(value: Record<string, unknown>, indent = ""): string {
	const lines: string[] = [];
	for (const [key, entry] of Object.entries(value)) {
		if (entry === undefined) {
			continue;
		}
		appendYamlProperty(lines, key, entry, indent);
	}
	return lines.join("\n");
}

function appendYamlProperty(lines: string[], key: string, value: unknown, indent: string): void {
	if (Array.isArray(value)) {
		if (value.length === 0) {
			lines.push(`${indent}${key}: []`);
			return;
		}
		lines.push(`${indent}${key}:`);
		for (const item of value) {
			appendYamlArrayItem(lines, item, `${indent}  `);
		}
		return;
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).filter(
			([, entry]) => entry !== undefined
		);
		if (entries.length === 0) {
			lines.push(`${indent}${key}: {}`);
			return;
		}
		lines.push(`${indent}${key}:`);
		for (const [childKey, childValue] of entries) {
			appendYamlProperty(lines, childKey, childValue, `${indent}  `);
		}
		return;
	}
	lines.push(`${indent}${key}: ${formatYamlScalar(value)}`);
}

function appendYamlArrayItem(lines: string[], value: unknown, indent: string): void {
	if (Array.isArray(value)) {
		if (value.length === 0) {
			lines.push(`${indent}- []`);
			return;
		}
		lines.push(`${indent}-`);
		for (const item of value) {
			appendYamlArrayItem(lines, item, `${indent}  `);
		}
		return;
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).filter(
			([, entry]) => entry !== undefined
		);
		if (entries.length === 0) {
			lines.push(`${indent}- {}`);
			return;
		}
		const [firstKey, firstValue] = entries[0];
		if (Array.isArray(firstValue) || (firstValue && typeof firstValue === "object")) {
			lines.push(`${indent}- ${firstKey}:`);
			appendComplexYamlValue(lines, firstValue, `${indent}    `);
		} else {
			lines.push(`${indent}- ${firstKey}: ${formatYamlScalar(firstValue)}`);
		}
		for (const [key, entry] of entries.slice(1)) {
			appendYamlProperty(lines, key, entry, `${indent}  `);
		}
		return;
	}
	lines.push(`${indent}- ${formatYamlScalar(value)}`);
}

function appendComplexYamlValue(lines: string[], value: unknown, indent: string): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			appendYamlArrayItem(lines, item, indent);
		}
		return;
	}
	if (value && typeof value === "object") {
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			if (entry === undefined) {
				continue;
			}
			appendYamlProperty(lines, key, entry, indent);
		}
	}
}

function formatYamlScalar(value: unknown): string {
	if (typeof value === "number") {
		return Number.isFinite(value) ? String(value) : "0";
	}
	if (typeof value === "boolean") {
		return value ? "true" : "false";
	}
	if (value == null) {
		return "null";
	}
	return JSON.stringify(unknownPlainText(value));
}
