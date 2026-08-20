import { normalizePath } from "obsidian";
import { normalizeChapterLocationFormat } from "../../utils/epub-chapter-location-label";
import { unknownPlainText } from "../../utils/unknown-plain-text";
import { normalizeCanvasExcerptAnchorsMap } from "./canvas-excerpt-anchor";
import {
	DEFAULT_EPUB_EXCERPT_SETTINGS,
	type EpubExcerptSettings,
} from "./epub-excerpt-settings";
import {
	normalizeBookNotesExportExcerptFields,
} from "./epub-book-notes-export-store";
import {
	normalizeBookshelfMembershipEntries,
} from "./epub-bookshelf-membership-store";
import {
	normalizeBookshelfPlaylists,
} from "./epub-bookshelf-playlist-store";
import { createEmptyEpubLocalReaderData } from "./epub-local-data-clone";
import type {
	EpubBookshelfIndexEntry,
	EpubPluginUiMemory,
	EpubReaderLocalBookRecord,
	EpubReaderLocalDataFile,
	EpubScanIndexEntry,
	EpubSourceRegistryEntry,
	EpubStoredBookDescriptor,
} from "./epub-local-data-types";
import { normalizeTocChapterMarkMap } from "./epub-toc-chapter-mark";
import { normalizeTocChapterMarkSettings } from "./epub-toc-chapter-mark-settings";
import {
	DEFAULT_READER_SETTINGS,
	getDefaultEpubReaderSettings,
	normalizeEpubReaderSettingsForDevice,
	type EpubReaderSettingsDeviceKind,
} from "./reader-settings";
import { normalizeReadingPaceStats } from "./reading-pace";
import type {
	BookMetadata,
	ConcealedText,
	DirectHighlight,
	EpubBook,
	EpubLastOpenBookmark,
	EpubReadingReferencePoint,
	EpubReaderSettings,
	ReadingPosition,
	ReadingStats,
} from "./types";

const LEGACY_DESKTOP_READER_SETTINGS: EpubReaderSettings = {
	lineHeight: 1.9,
	letterSpacing: 0,
	pageMargin: 48,
	viewportSidePadding: 24,
	widthMode: "full",
	layoutMode: "paginated",
	flowMode: "paginated",
	showScrolledSideNav: true,
	footnoteClickAction: "preview",
	showTopSticker: true,
	topStickerLayout: "auto",
	paragraphModeEnabled: false,
	paragraphModeFontSize: "medium",
	paragraphModeFontScale: 100,
	paragraphModeSurfaceStyle: "spotlight",
	paragraphModeTransitionStyle: "settle",
};

function normalizeRememberedFolderPath(folderPath?: string | null): string {
	const raw = String(folderPath || "").trim();
	if (!raw) {
		return "";
	}
	if (raw === "/" || raw === ".") {
		return "/";
	}
	return normalizePath(raw);
}

export function normalizePluginUiMemory(value: unknown): EpubPluginUiMemory {
	const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	return {
		lastSelectedIRDeckId: unknownPlainText(record.lastSelectedIRDeckId).trim(),
		selectionQuickCreateLastFolder: normalizeRememberedFolderPath(
			typeof record.selectionQuickCreateLastFolder === "string"
				? record.selectionQuickCreateLastFolder
				: ""
		),
		epubMarkdownExportLastFolder: normalizeRememberedFolderPath(
			typeof record.epubMarkdownExportLastFolder === "string"
				? record.epubMarkdownExportLastFolder
				: ""
		),
		bookshelfSearchQuery:
			typeof record.bookshelfSearchQuery === "string" ? record.bookshelfSearchQuery : "",
		readerTutorialDismissed: record.readerTutorialDismissed === true,
	};
}

export function normalizeReadingPosition(value: unknown): ReadingPosition | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const position = value as Partial<ReadingPosition>;
	return {
		chapterIndex: typeof position.chapterIndex === "number" ? position.chapterIndex : 0,
		cfi: typeof position.cfi === "string" ? position.cfi : "",
		percent: typeof position.percent === "number" ? position.percent : 0,
	};
}

export function normalizeReadingStats(value: unknown): ReadingStats | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	return normalizeReadingPaceStats(value as Partial<ReadingStats>);
}

export function normalizeBookState(
	value: unknown
): Pick<EpubBook, "currentPosition" | "readingStats"> | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const record = value as Record<string, unknown>;
	const currentPosition = normalizeReadingPosition(record.currentPosition);
	const readingStats = normalizeReadingStats(record.readingStats);
	if (!currentPosition && !readingStats) {
		return null;
	}

	return {
		currentPosition: currentPosition ?? { chapterIndex: 0, cfi: "", percent: 0 },
		readingStats: readingStats ?? { totalReadTime: 0, lastReadTime: 0, createdTime: 0 },
	};
}

export function normalizeLastOpenBookmark(value: unknown): EpubLastOpenBookmark | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const bookmark = value as Partial<EpubLastOpenBookmark>;
	return {
		chapterIndex: typeof bookmark.chapterIndex === "number" ? bookmark.chapterIndex : 0,
		cfi: typeof bookmark.cfi === "string" ? bookmark.cfi : "",
		percent: typeof bookmark.percent === "number" ? bookmark.percent : 0,
		title: typeof bookmark.title === "string" ? bookmark.title : "",
		preview: typeof bookmark.preview === "string" ? bookmark.preview : "",
		savedAt: typeof bookmark.savedAt === "number" ? bookmark.savedAt : 0,
	};
}

export function normalizeReadingReferencePoint(value: unknown): EpubReadingReferencePoint | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const point = value as Partial<EpubReadingReferencePoint>;
	return {
		chapterIndex: typeof point.chapterIndex === "number" ? point.chapterIndex : 0,
		cfi: typeof point.cfi === "string" ? point.cfi : "",
		percent: typeof point.percent === "number" ? point.percent : 0,
		title: typeof point.title === "string" ? point.title : "",
		savedAt: typeof point.savedAt === "number" ? point.savedAt : 0,
	};
}

export function normalizeScanIndexEntries(value: unknown): EpubScanIndexEntry[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((entry): entry is Partial<EpubScanIndexEntry> =>
			Boolean(entry && typeof entry === "object")
		)
		.map((entry) => ({
			path: normalizePath(String(entry.path || "").trim()),
			name: String(entry.name || "").trim(),
			folder: String(entry.folder || "/").trim() || "/",
			size: typeof entry.size === "number" ? entry.size : 0,
			mtime: typeof entry.mtime === "number" ? entry.mtime : 0,
			coverImage:
				typeof entry.coverImage === "string" && entry.coverImage.trim()
					? entry.coverImage.trim()
					: undefined,
		}))
		.filter((entry) => Boolean(entry.path));
}

export function normalizeBookshelfIndexEntries(value: unknown): EpubBookshelfIndexEntry[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((entry): entry is Partial<EpubBookshelfIndexEntry> =>
			Boolean(entry && typeof entry === "object")
		)
		.map((entry) => ({
			path: normalizePath(String(entry.path || "").trim()),
			name: String(entry.name || "").trim(),
			folder: String(entry.folder || "/").trim() || "/",
			size: typeof entry.size === "number" ? entry.size : 0,
			addedAt: typeof entry.addedAt === "number" ? entry.addedAt : 0,
		}))
		.filter((entry) => Boolean(entry.path));
}

export { normalizeBookshelfMembershipEntries };

export function normalizeLegacySourceIds(value: unknown, canonicalSourceId?: string): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const normalized = Array.from(
		new Set(
			value
				.filter((entry): entry is string => typeof entry === "string")
				.map((entry) => String(entry || "").trim())
				.filter((entry) => Boolean(entry) && entry !== canonicalSourceId)
		)
	).sort((left, right) => left.localeCompare(right, "zh-CN"));
	return normalized.length > 0 ? normalized : undefined;
}

export function normalizeSourceRegistryEntries(value: unknown): EpubSourceRegistryEntry[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((entry): entry is Partial<EpubSourceRegistryEntry> =>
			Boolean(entry && typeof entry === "object")
		)
		.map((entry) => ({
			sourceId: String(entry.sourceId || "").trim(),
			filePath: normalizePath(String(entry.filePath || "").trim()),
			sourceFingerprint:
				typeof entry.sourceFingerprint === "string" ? entry.sourceFingerprint : undefined,
			legacySourceIds: normalizeLegacySourceIds(
				entry.legacySourceIds,
				String(entry.sourceId || "").trim()
			),
			sourceSize: typeof entry.sourceSize === "number" ? entry.sourceSize : undefined,
			sourceMtime: typeof entry.sourceMtime === "number" ? entry.sourceMtime : undefined,
			lastSeenAt: typeof entry.lastSeenAt === "number" ? entry.lastSeenAt : 0,
			lastKnownPath:
				typeof entry.lastKnownPath === "string"
					? normalizePath(String(entry.lastKnownPath).trim())
					: undefined,
		}))
		.filter((entry) => Boolean(entry.sourceId));
}

export function normalizeBookMetadata(value: unknown): BookMetadata | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const metadata = value as Partial<BookMetadata>;
	const subjects = Array.isArray(metadata.subjects)
		? metadata.subjects.filter(
				(entry): entry is string => typeof entry === "string" && entry.trim().length > 0
			)
		: undefined;
	return {
		title: typeof metadata.title === "string" ? metadata.title : "",
		author: typeof metadata.author === "string" ? metadata.author : "",
		publisher: typeof metadata.publisher === "string" ? metadata.publisher : undefined,
		language: typeof metadata.language === "string" ? metadata.language : undefined,
		identifier: typeof metadata.identifier === "string" ? metadata.identifier : undefined,
		isbn: typeof metadata.isbn === "string" ? metadata.isbn : undefined,
		translator: typeof metadata.translator === "string" ? metadata.translator : undefined,
		description: typeof metadata.description === "string" ? metadata.description : undefined,
		publishDate: typeof metadata.publishDate === "string" ? metadata.publishDate : undefined,
		subjects: subjects && subjects.length > 0 ? subjects : undefined,
		series: typeof metadata.series === "string" ? metadata.series : undefined,
		rights: typeof metadata.rights === "string" ? metadata.rights : undefined,
		price: typeof metadata.price === "string" ? metadata.price : undefined,
		coverImage: typeof metadata.coverImage === "string" ? metadata.coverImage : undefined,
		wordCount: typeof metadata.wordCount === "number" ? metadata.wordCount : undefined,
		chapterCount: typeof metadata.chapterCount === "number" ? metadata.chapterCount : 0,
	};
}

export function normalizeStoredBookDescriptor(value: unknown): EpubStoredBookDescriptor | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const record = value as Record<string, unknown>;
	const id = typeof record.id === "string" ? record.id.trim() : "";
	const filePath = typeof record.filePath === "string" ? normalizePath(record.filePath || "") : "";
	const metadata = normalizeBookMetadata(record.metadata);
	if (!id || !filePath || !metadata) {
		return null;
	}

	return {
		id,
		filePath,
		sourceId: typeof record.sourceId === "string" ? record.sourceId : undefined,
		sourceFingerprint:
			typeof record.sourceFingerprint === "string" ? record.sourceFingerprint : undefined,
		sourceMtime: typeof record.sourceMtime === "number" ? record.sourceMtime : undefined,
		sourceSize: typeof record.sourceSize === "number" ? record.sourceSize : undefined,
		metadata,
	};
}

export function normalizeConcealedTextMode(mode?: string): ConcealedText["mode"] {
	switch (mode) {
		default:
			return "mask";
	}
}

export function normalizeConcealedTexts(concealedTexts: unknown): ConcealedText[] {
	if (!Array.isArray(concealedTexts)) {
		return [];
	}

	return concealedTexts
		.filter((item): item is ConcealedText => Boolean(item && typeof item === "object"))
		.map((item) => ({
			...item,
			mode: normalizeConcealedTextMode(item.mode),
		}));
}

export function normalizeDirectHighlights(value: unknown): DirectHighlight[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.filter((item): item is DirectHighlight => Boolean(item && typeof item === "object" && item.cfiRange))
		.map((item) => ({
			id: typeof item.id === "string" ? item.id : undefined,
			cfiRange: String(item.cfiRange || "").trim(),
			color: String(item.color || "yellow").trim(),
			style: item.style === "underline" || item.style === "strikethrough" || item.style === "wavy" ? item.style : undefined,
			text: String(item.text || ""),
			chapterIndex: typeof item.chapterIndex === "number" ? item.chapterIndex : undefined,
			chapterTitle: typeof item.chapterTitle === "string" ? item.chapterTitle : undefined,
			createdTime: typeof item.createdTime === "number" ? item.createdTime : Date.now(),
		}))
		.filter((item) => Boolean(item.cfiRange));
}

export function normalizeLocalBookRecord(value: unknown): EpubReaderLocalBookRecord {
	if (!value || typeof value !== "object") {
		return {};
	}

	const record = value as Record<string, unknown>;
	const normalized: EpubReaderLocalBookRecord = {};
	if (Object.prototype.hasOwnProperty.call(record, "descriptor")) {
		normalized.descriptor = normalizeStoredBookDescriptor(record.descriptor) ?? undefined;
	}
	if (Object.prototype.hasOwnProperty.call(record, "state")) {
		normalized.state = normalizeBookState(record.state) ?? undefined;
	}
	if (Object.prototype.hasOwnProperty.call(record, "lastOpenBookmark")) {
		normalized.lastOpenBookmark = normalizeLastOpenBookmark(record.lastOpenBookmark);
	}
	if (Object.prototype.hasOwnProperty.call(record, "readingReferencePoint")) {
		normalized.readingReferencePoint = normalizeReadingReferencePoint(
			record.readingReferencePoint
		);
	}
	if (Object.prototype.hasOwnProperty.call(record, "concealedTexts")) {
		normalized.concealedTexts = normalizeConcealedTexts(record.concealedTexts);
	}
	if (Object.prototype.hasOwnProperty.call(record, "tocChapterMarks")) {
		normalized.tocChapterMarks = normalizeTocChapterMarkMap(record.tocChapterMarks);
	}
	if (Object.prototype.hasOwnProperty.call(record, "directHighlights")) {
		normalized.directHighlights = normalizeDirectHighlights(record.directHighlights);
	}
	return normalized;
}

function matchesLegacyDesktopReaderSettings(settings: EpubReaderSettings): boolean {
	return (
		settings.lineHeight === LEGACY_DESKTOP_READER_SETTINGS.lineHeight &&
		settings.viewportSidePadding === LEGACY_DESKTOP_READER_SETTINGS.viewportSidePadding &&
		settings.widthMode === LEGACY_DESKTOP_READER_SETTINGS.widthMode &&
		settings.layoutMode === LEGACY_DESKTOP_READER_SETTINGS.layoutMode &&
		settings.flowMode === LEGACY_DESKTOP_READER_SETTINGS.flowMode &&
		settings.showScrolledSideNav === LEGACY_DESKTOP_READER_SETTINGS.showScrolledSideNav
	);
}

export function normalizeExcerptSettings(value: unknown): EpubExcerptSettings {
	if (!value || typeof value !== "object") {
		return { ...DEFAULT_EPUB_EXCERPT_SETTINGS };
	}

	const settings = value as Partial<EpubExcerptSettings> & {
		bookNotesExportTemplate?: "template1" | "template2";
	};
	return {
		addCreationTime:
			typeof settings.addCreationTime === "boolean"
				? settings.addCreationTime
				: DEFAULT_EPUB_EXCERPT_SETTINGS.addCreationTime,
		chapterLocationFormat: normalizeChapterLocationFormat(settings.chapterLocationFormat),
		strikethroughDisplayMode:
			settings.strikethroughDisplayMode === "conceal"
				? "conceal"
				: DEFAULT_EPUB_EXCERPT_SETTINGS.strikethroughDisplayMode,
		showStrikethroughInSidebar:
			typeof settings.showStrikethroughInSidebar === "boolean"
				? settings.showStrikethroughInSidebar
				: DEFAULT_EPUB_EXCERPT_SETTINGS.showStrikethroughInSidebar,
		...normalizeBookNotesExportExcerptFields(settings),
	};
}

export function normalizeReaderSettingsForDevice(
	deviceKind: EpubReaderSettingsDeviceKind,
	settings: Partial<EpubReaderSettings>
): EpubReaderSettings {
	const mergedSettings: EpubReaderSettings = {
		...getDefaultEpubReaderSettings(deviceKind),
		...settings,
	};

	if (deviceKind === "desktop" && matchesLegacyDesktopReaderSettings(mergedSettings)) {
		return { ...DEFAULT_READER_SETTINGS };
	}

	return normalizeEpubReaderSettingsForDevice(deviceKind, settings);
}

export function normalizeLocalReaderData(value: unknown): EpubReaderLocalDataFile {
	const empty = createEmptyEpubLocalReaderData() as EpubReaderLocalDataFile;
	if (!value || typeof value !== "object") {
		return empty;
	}

	const record = value as Record<string, unknown>;
	const books: Record<string, EpubReaderLocalBookRecord> = {};
	if (record.books && typeof record.books === "object" && !Array.isArray(record.books)) {
		for (const [bookId, bookData] of Object.entries(record.books as Record<string, unknown>)) {
			if (!bookId) {
				continue;
			}
			books[bookId] = normalizeLocalBookRecord(bookData);
		}
	}

	const readerSettingsRecord =
		record.readerSettings &&
		typeof record.readerSettings === "object" &&
		!Array.isArray(record.readerSettings)
			? (record.readerSettings as Record<string, unknown>)
			: {};

	const normalized: EpubReaderLocalDataFile = {
		version: 1,
		updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
		bookCatalogStoredLocally: record.bookCatalogStoredLocally === true,
		readerSettings: {},
		books,
	};

	if (Object.prototype.hasOwnProperty.call(record, "uiMemory")) {
		normalized.uiMemory = normalizePluginUiMemory(record.uiMemory);
	}

	if (Object.prototype.hasOwnProperty.call(readerSettingsRecord, "desktop")) {
		normalized.readerSettings = normalized.readerSettings || {};
		normalized.readerSettings.desktop = normalizeReaderSettingsForDevice(
			"desktop",
			readerSettingsRecord.desktop as Partial<EpubReaderSettings>
		);
	}
	if (Object.prototype.hasOwnProperty.call(readerSettingsRecord, "mobile")) {
		normalized.readerSettings = normalized.readerSettings || {};
		normalized.readerSettings.mobile = normalizeReaderSettingsForDevice(
			"mobile",
			readerSettingsRecord.mobile as Partial<EpubReaderSettings>
		);
	}
	if (Object.prototype.hasOwnProperty.call(record, "excerptSettings")) {
		normalized.excerptSettings = normalizeExcerptSettings(record.excerptSettings);
	}
	if (Object.prototype.hasOwnProperty.call(record, "scanIndex")) {
		normalized.scanIndex = normalizeScanIndexEntries(record.scanIndex);
	}
	if (Object.prototype.hasOwnProperty.call(record, "bookshelfMembership")) {
		normalized.bookshelfMembership = normalizeBookshelfMembershipEntries(
			record.bookshelfMembership
		);
	}
	if (Object.prototype.hasOwnProperty.call(record, "bookshelfPlaylists")) {
		normalized.bookshelfPlaylists = normalizeBookshelfPlaylists(record.bookshelfPlaylists);
	}
	if (Object.prototype.hasOwnProperty.call(record, "sourceRegistry")) {
		normalized.sourceRegistry = normalizeSourceRegistryEntries(record.sourceRegistry);
	}
	if (
		record.canvasBindings &&
		typeof record.canvasBindings === "object" &&
		!Array.isArray(record.canvasBindings)
	) {
		normalized.canvasBindings = Object.fromEntries(
			Object.entries(record.canvasBindings as Record<string, unknown>)
				.map(
					([bookId, canvasPath]) =>
						[String(bookId || "").trim(), normalizePath(unknownPlainText(canvasPath).trim())] as const
				)
				.filter(([bookId, canvasPath]) => Boolean(bookId) && Boolean(canvasPath))
		);
	}
	if (Object.prototype.hasOwnProperty.call(record, "canvasExcerptAnchors")) {
		normalized.canvasExcerptAnchors = normalizeCanvasExcerptAnchorsMap(record.canvasExcerptAnchors);
	}
	if (Object.prototype.hasOwnProperty.call(record, "tocChapterMarkSettings")) {
		normalized.tocChapterMarkSettings = normalizeTocChapterMarkSettings(record.tocChapterMarkSettings);
	}

	return normalized;
}

export function hasRetainedLocalBookData(record: EpubReaderLocalBookRecord): boolean {
	return Boolean(
		record.state ||
			Object.prototype.hasOwnProperty.call(record, "lastOpenBookmark") ||
			Object.prototype.hasOwnProperty.call(record, "readingReferencePoint") ||
			Object.prototype.hasOwnProperty.call(record, "concealedTexts") ||
			(record.tocChapterMarks && Object.keys(record.tocChapterMarks).length > 0) ||
			(record.directHighlights && record.directHighlights.length > 0)
	);
}

export function toStoredBookDescriptor(book: EpubBook): EpubStoredBookDescriptor {
	return {
		id: String(book.id || "").trim(),
		filePath: normalizePath(book.filePath || ""),
		sourceId: typeof book.sourceId === "string" ? book.sourceId : undefined,
		sourceFingerprint:
			typeof book.sourceFingerprint === "string" ? book.sourceFingerprint : undefined,
		sourceMtime: typeof book.sourceMtime === "number" ? book.sourceMtime : undefined,
		sourceSize: typeof book.sourceSize === "number" ? book.sourceSize : undefined,
		metadata: normalizeBookMetadata(book.metadata) ?? {
			title: "",
			author: "",
			chapterCount: 0,
		},
	};
}

export function toBookFromDescriptor(
	descriptor: EpubStoredBookDescriptor,
	state?: Pick<EpubBook, "currentPosition" | "readingStats"> | null
): EpubBook {
	return {
		id: descriptor.id,
		filePath: descriptor.filePath,
		sourceId: descriptor.sourceId,
		sourceFingerprint: descriptor.sourceFingerprint,
		sourceMtime: descriptor.sourceMtime,
		sourceSize: descriptor.sourceSize,
		metadata: descriptor.metadata,
		currentPosition: state?.currentPosition ?? { chapterIndex: 0, cfi: "", percent: 0 },
		readingStats: state?.readingStats ?? { totalReadTime: 0, lastReadTime: 0, createdTime: 0 },
	};
}

export function normalizeLegacyBook(value: unknown, fallbackId: string): EpubBook | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const record = value as Record<string, unknown>;
	const descriptor = normalizeStoredBookDescriptor({
		...record,
		id: typeof record.id === "string" && record.id.trim().length > 0 ? record.id : fallbackId,
	});
	if (!descriptor) {
		return null;
	}

	const state = normalizeBookState(record) ?? {
		currentPosition: { chapterIndex: 0, cfi: "", percent: 0 },
		readingStats: { totalReadTime: 0, lastReadTime: 0, createdTime: 0 },
	};
	return toBookFromDescriptor(descriptor, state);
}
