import type {
	EpubBook,
	EpubFootnoteClickAction,
	EpubFlowMode,
	EpubHighlightStyle,
	EpubLayoutMode,
	EpubStrikethroughDisplayMode,
	EpubWidthMode,
	PaginationInfo,
	ReadingPosition,
	ReadingStats,
	TocItem,
} from "./types";
import type { EpubChapterLocationFormat } from "./epub-excerpt-settings";
import type { FlatTocExportItem } from "./epub-toc-export-scope";

export type EpubReaderEngineType = "foliate";

export type FlashStyle = "pulse" | "highlight" | "none";
export type ReaderHighlightPresentation = "highlight" | "conceal";

export interface HighlightSourceLocator {
	sourceFile: string;
	sourceRef?: string;
	excerptId?: string;
}

export interface NavigateAndHighlightOptions {
	cfi?: string;
	href?: string;
	text?: string;
	flashStyle?: FlashStyle;
	flashColor?: string;
	dismiss?: "click" | "auto";
	sourceFile?: string;
	sourceRef?: string;
	createdTime?: number;
}

export interface ReaderNavigateOptions {
	cfi?: string;
	href?: string;
	text?: string;
}

export interface ReaderNavigationRectOptions extends ReaderNavigateOptions {
	allowFallback?: boolean;
}

export interface ReaderViewportRect {
	top: number;
	left: number;
	bottom: number;
	right: number;
	width: number;
	height: number;
}

export interface ReaderAnchorPoint {
	x: number;
	y: number;
}

export interface ReaderViewportGeometry {
	rect: ReaderViewportRect;
	rects?: ReaderViewportRect[];
	anchorPoint?: ReaderAnchorPoint;
}

export interface HighlightClickInfo {
	cfiRange: string;
	color: string;
	style?: EpubHighlightStyle;
	text: string;
	commentText?: string;
	hasCommentDivider?: boolean;
	sourceFile: string;
	sourceRef?: string;
	excerptId?: string;
	sourceLocators?: HighlightSourceLocator[];
	createdTime?: number;
	temporary?: boolean;
	presentation?: ReaderHighlightPresentation;
	interactionTarget?: "highlight" | "comment-marker" | "reference-badge";
	rect: ReaderViewportRect;
	rects?: ReaderViewportRect[];
	anchorPoint?: ReaderAnchorPoint;
}

export interface ReaderHighlightInput {
	cfiRange: string;
	color: string;
	style?: EpubHighlightStyle;
	text?: string;
	commentText?: string;
	hasCommentDivider?: boolean;
	chapterIndex?: number;
	chapterTitle?: string;
	sourceFile?: string;
	sourceRef?: string;
	excerptId?: string;
	sourceLocators?: HighlightSourceLocator[];
	createdTime?: number;
	presentation?: ReaderHighlightPresentation;
	pageLabel?: string;
	pageNumber?: number;
	baseHighlightColor?: string;
	baseStyle?: EpubHighlightStyle;
	// 引用统计
	referenceCount?: number;
	referenceHeat?: number;
}

export interface ReaderHighlight extends ReaderHighlightInput {
	temporary?: boolean;
}

export interface ReaderRenderOptions {
	width?: number;
	height?: number;
	flow?: string;
	spread?: string;
	manager?: "default" | "continuous";
	minSpreadWidth?: number;
	lineHeight?: number;
	letterSpacing?: number;
	pageMargin?: number;
	widthMode?: EpubWidthMode;
	strikethroughPresentation?: EpubStrikethroughDisplayMode;
}

export interface ReaderAppearanceOptions {
	lineHeight?: number;
	letterSpacing?: number;
	pageMargin?: number;
	widthMode?: EpubWidthMode;
	strikethroughPresentation?: EpubStrikethroughDisplayMode;
}

export interface ReaderRemainingTimeEstimate {
	bookMs?: number;
	chapterMs?: number;
	chapterProgressPercent?: number;
	wordsPerMinute?: number;
}

export interface ReaderFrame {
	frameDocument: Document;
	window: Window;
	cfiFromRange: (range: Range) => string | null;
}

export interface ReaderSelectionChange {
	cfiRange: string;
	frame: ReaderFrame;
}

export interface ReaderParagraph {
	id: string;
	chapterIndex: number;
	chapterTitle: string;
	chapterHref: string;
	text: string;
	html?: string;
	htmlRevision?: number;
	cfiRange: string;
}

export interface ReaderParagraphLocation {
	paragraphs: ReaderParagraph[];
	currentIndex: number;
}

export interface ReaderRandomParagraphPick {
	paragraph: ReaderParagraph;
	chapterIndex: number;
	chapterParagraphs: ReaderParagraph[];
	paragraphIndex: number;
}

export interface ReaderParagraphSelectionResolution {
	cfiRange: string;
	text: string;
}

export interface ReaderFootnotePreviewInfo {
	href: string;
	label: string;
	text: string;
	rect: { top: number; left: number; bottom: number; right: number; width: number; height: number };
}

export interface EpubChapterExportAsset {
	placeholder: string;
	suggestedName: string;
	data: Uint8Array;
	mimeType: string;
	originalHref?: string;
}

export interface EpubChapterReadingPointDraft {
	title: string;
	text: string;
	cfi: string;
	chapterIndex: number;
	chapterHref: string;
	markdown?: string;
	assets?: EpubChapterExportAsset[];
}

export interface EpubBookFootnoteEntry {
	label: string;
	text: string;
	href: string;
	sectionHref: string;
	sectionTitle: string;
	chapterIndex: number;
}

export interface EpubBookFootnotesDraft {
	title: string;
	markdown: string;
	footnotes: EpubBookFootnoteEntry[];
}

export interface EpubReaderEngine {
	readonly engineType: EpubReaderEngineType;
	loadEpub(filePath: string, existingBookId?: string): Promise<EpubBook>;
	renderTo(container: HTMLElement, options?: ReaderRenderOptions): Promise<void>;
	setRestoredPosition?(position: ReadingPosition): Promise<void> | void;
	setFootnoteClickAction?(action: EpubFootnoteClickAction): void;
	goToLocation(cfi: string): Promise<void>;
	/** Paragraph-mode anchor sync; suppresses duplicate reading-progress persistence while in flight. */
	syncParagraphAnchor?(cfi: string): Promise<void>;
	isParagraphAnchorSyncInFlight?(): boolean;
	canonicalizeLocation?(cfi: string, textHint?: string): Promise<string | null>;
	getReadingProgress(): number;
	getPaginationInfo(): Promise<PaginationInfo>;
	getRemainingReadingTimeEstimate?(): Promise<ReaderRemainingTimeEstimate>;
	getReadingStats?(): ReadingStats | null;
	flushReadingPace?(): void;
	isLayoutChanging(): boolean;
	resize(width: number, height: number): void;
	applyReaderAppearance(appearance: ReaderAppearanceOptions, redisplay?: boolean): Promise<void>;
	onRelocated(callback: (position: ReadingPosition) => void): () => void;
	setLayoutMode(
		mode: EpubLayoutMode,
		flowMode: EpubFlowMode,
		appearance?: ReaderAppearanceOptions
	): Promise<void>;
	searchText(query: string): Promise<Array<{ cfi: string; excerpt: string; chapterTitle: string }>>;
	getTableOfContents(): Promise<TocItem[]>;
	navigateTo(options: ReaderNavigateOptions): Promise<void>;
	navigateAndHighlight(options: NavigateAndHighlightOptions): Promise<void>;
	getNavigationTargetRect(options: ReaderNavigationRectOptions): DOMRect | null;
	getSourceLocateOverlayRect(options: ReaderNavigationRectOptions): DOMRect | null;
	getCurrentPosition(): ReadingPosition;
	getCurrentChapterTitle(): string;
	getChapterLocationLabel?(format?: EpubChapterLocationFormat): string;
	getCurrentChapterIndex(): number;
	getCurrentChapterHref?(): string;
	getParagraphsForChapter?(
		chapterIndex: number,
		options?: { includeHtml?: boolean }
	): Promise<ReaderParagraph[]>;
	getCurrentParagraphLocation?(options?: {
		preferredParagraphId?: string;
		preferredIndex?: number;
	}): Promise<ReaderParagraphLocation | null>;
	pickRandomParagraph?(options?: {
		excludeParagraphId?: string;
	}): Promise<ReaderRandomParagraphPick | null>;
	hydrateReaderParagraph?(paragraphId: string): Promise<ReaderParagraph | null>;
	resolveParagraphSelection?(
		paragraphId: string,
		startOffset: number,
		endOffset: number
	): Promise<ReaderParagraphSelectionResolution | null>;
	openParagraphFootnotePreview?(
		paragraphId: string,
		href: string,
		label?: string,
		options?: {
			pinned?: boolean;
			rect?: ReaderFootnotePreviewInfo["rect"];
		}
	): Promise<void>;
	dismissParagraphFootnotePreview?(options?: { unpin?: boolean }): void;
	getChapterReadingPointDraft?(
		href: string,
		titleHint?: string
	): Promise<EpubChapterReadingPointDraft | null>;
	getTocChapterReadingPointDraft?(
		href: string,
		titleHint: string | undefined,
		flatTocItems: FlatTocExportItem[],
		itemIndex: number
	): Promise<EpubChapterReadingPointDraft | null>;
	getBookFootnotesDraft?(): Promise<EpubBookFootnotesDraft | null>;
	getSectionHrefForCfi?(cfi: string): string | null;
	getSectionHrefByChapterIndex?(chapterIndex: number): string | null;
	getSectionIndexForCfi?(cfi: string): number | null;
	resolveChapterHighlightRangeText?(
		highlight: ReaderHighlight,
		sectionHref: string,
		sectionIndex: number
	): Promise<string | null>;
	getCurrentCFI(): string;
	prevPage(): Promise<void>;
	nextPage(): Promise<void>;
	nextChapter?(): Promise<boolean>;
	prevChapter?(): Promise<boolean>;
	isAtCurrentChapterEnd?(): boolean;
	isAtBookEnd?(): boolean;
	onScrolledChapterEndChange?(callback: (atEnd: boolean) => void): () => void;
	setBookEndAdvanceHandler?(
		handler: (() => boolean | Promise<boolean>) | null
	): void;
	goToPage(pageNumber: number): Promise<void>;
	getPageNumberFromCfi(cfi: string): Promise<number | undefined>;
	getVisibleFrames(): ReaderFrame[];
	getHighlightClickInfo?(
		cfiRange: string,
		interactionTarget?: HighlightClickInfo["interactionTarget"],
		geometryOverride?: {
			rect: HighlightClickInfo["rect"];
			rects?: HighlightClickInfo["rects"];
			anchorPoint?: HighlightClickInfo["anchorPoint"];
		}
	): HighlightClickInfo | null;
	getSelectionViewportGeometry?(cfiRange: string): ReaderViewportGeometry | null;
	onFootnotePreview(callback: (info: ReaderFootnotePreviewInfo | null) => void): () => void;
	onSelectionChange(callback: (event: ReaderSelectionChange) => void): () => void;
	onHighlightClick(callback: (info: HighlightClickInfo) => void): () => void;
	onReferenceBadgeClick?(callback: (info: HighlightClickInfo) => void): () => void;
	applyHighlights(highlights: ReaderHighlight[]): Promise<void>;
	refreshHighlights?(): Promise<void>;
	addHighlight(highlight: ReaderHighlight): void;
	addTemporaryHighlight(highlight: ReaderHighlightInput, durationMs?: number): void;
	temporarilyRevealConcealedText?(cfiRange: string, durationMs?: number): void;
	removeHighlight(cfiRange: string): void;
	removeHighlightByIdentityKey(identityKey: string): void;
	destroy(): void;
}
