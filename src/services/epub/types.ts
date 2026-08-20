export interface EpubBook {
	id: string;
	filePath: string;
	sourceId?: string;
	sourceFingerprint?: string;
	sourceMtime?: number;
	sourceSize?: number;
	metadata: BookMetadata;
	currentPosition: ReadingPosition;
	readingStats: ReadingStats;
}

export interface BookMetadata {
	title: string;
	author: string;
	publisher?: string;
	language?: string;
	identifier?: string;
	isbn?: string;
	translator?: string;
	description?: string;
	publishDate?: string;
	subjects?: string[];
	series?: string;
	rights?: string;
	price?: string;
	coverImage?: string;
	wordCount?: number;
	chapterCount: number;
}

export type EpubHighlightStyle = "underline" | "strikethrough" | "wavy" | "reading-note";

export type EpubStrikethroughDisplayMode = "strikethrough" | "conceal";

export interface ReadingPosition {
	chapterIndex: number;
	cfi: string;
	percent: number;
}

export interface ReadingStats {
	totalReadTime: number;
	lastReadTime: number;
	createdTime: number;
	completedTime?: number;
	/** Robust per-book WPM derived from recent page intervals. */
	bookWpm?: number;
	/** Count of accepted page-interval samples for this book. */
	paceSampleCount?: number;
	/** Words covered by accepted page-interval samples. */
	paceSampleWords?: number;
	/** Recent interval WPM samples (newest last, capped on persist). */
	recentIntervalWpms?: number[];
}

export interface EpubLastOpenBookmark extends ReadingPosition {
	title: string;
	preview: string;
	savedAt: number;
}

export interface EpubReadingReferencePoint extends ReadingPosition {
	title: string;
	savedAt: number;
}

export interface EpubParagraphModeReadingPosition extends ReadingPosition {
	bookId: string;
	filePath: string;
	bookTitle: string;
	chapterTitle: string;
	chapterHref?: string;
	paragraphId: string;
	paragraphIndex: number;
	paragraphTextPreview?: string;
	savedAt: number;
}

export interface DirectHighlight {
	id?: string;
	cfiRange: string;
	color: string;
	style?: EpubHighlightStyle;
	text: string;
	chapterIndex?: number;
	chapterTitle?: string;
	createdTime?: number;
}

export interface Highlight {
	id: string;
	text: string;
	color: HighlightColor;
	style?: EpubHighlightStyle;
	chapterIndex: number;
	cfiRange: string;
	createdTime: number;
	linkedNotePath?: string;
}

export type HighlightColor = "yellow" | "green" | "blue" | "red" | "purple";

export type ConcealedTextMode = "mask";

export interface ConcealedText {
	id: string;
	text: string;
	mode: ConcealedTextMode;
	chapterIndex: number;
	cfiRange: string;
	createdTime: number;
}

export interface Note {
	id: string;
	content: string;
	quotedText?: string;
	chapterIndex: number;
	cfi?: string;
	createdTime: number;
	modifiedTime: number;
}

export interface TocItem {
	id: string;
	label: string;
	href: string;
	level: number;
	pageNumber?: number;
	subitems?: TocItem[];
}

export interface PaginationInfo {
	currentPage: number;
	totalPages: number;
}

export type EpubWidthMode = "standard" | "full" | "fit" | "edge";
export type EpubLayoutMode = "paginated" | "double";
export type EpubFlowMode = "paginated" | "scrolled";
export type EpubTheme = "default";
export type EpubFootnoteClickAction = "preview" | "navigate";
export type EpubTopStickerLayout = "auto" | "inline" | "sidebar";
export type EpubParagraphModeFontSize = "small" | "medium" | "large";
export type EpubParagraphModeSurfaceStyle = "spotlight" | "blend" | "dashed";
export type EpubParagraphModeTransitionStyle =
	| "steady"
	| "fade"
	| "settle"
	| "slide"
	| "glide"
	| "lift"
	| "float"
	| "compress"
	| "expand"
	| "curtain"
	| "pulse";

export interface EpubReaderSettings {
	lineHeight: number;
	letterSpacing: number;
	pageMargin: number;
	viewportSidePadding: number;
	theme?: EpubTheme;
	widthMode: EpubWidthMode;
	layoutMode: EpubLayoutMode;
	flowMode: EpubFlowMode;
	showScrolledSideNav: boolean;
	footnoteClickAction: EpubFootnoteClickAction;
	showTopSticker: boolean;
	topStickerLayout: EpubTopStickerLayout;
	paragraphModeEnabled: boolean;
	paragraphModeFontSize: EpubParagraphModeFontSize;
	paragraphModeFontScale: number;
	paragraphModeSurfaceStyle: EpubParagraphModeSurfaceStyle;
	paragraphModeTransitionStyle: EpubParagraphModeTransitionStyle;
}
