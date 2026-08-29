import type { App } from "obsidian";
import type {
	EpubBookFootnotesDraft,
	EpubChapterReadingPointDraft,
	EpubReaderEngine,
	HighlightSourceLocator,
	HighlightClickInfo,
	NavigateAndHighlightOptions,
	ReaderAppearanceOptions,
	ReaderFootnotePreviewInfo,
	ReaderFrame,
	ReaderHighlight,
	ReaderHighlightInput,
	ReaderNavigationRectOptions,
	ReaderNavigateOptions,
	ReaderParagraph,
	ReaderParagraphLocation,
	ReaderParagraphSelectionResolution,
	ReaderRandomParagraphPick,
	ReaderRemainingTimeEstimate,
	ReaderRenderOptions,
	ReaderSelectionChange,
	ReaderViewportGeometry,
} from "./reader-engine-types";
import type { EpubChapterLocationFormat } from "./epub-excerpt-settings";
import type { FlatTocExportItem } from "./epub-toc-export-scope";
import { buildReaderChapterStyles } from "./reader-chapter-styles";
import { resolveReaderHighlightTint } from "./reader-highlight-tints";
import {
	buildReaderNavigationRectTargets,
	resolveReaderSourceNavigationViewTargets,
} from "./reader-navigation-targets";
import {
	mapHighlightViewportRectToDomRect,
	resolveReaderSourceLocateOverlayRect,
} from "./reader-source-locate-overlay-rect";
import { applyReaderThemeHostSurfaces } from "./reader-theme-host";
import { buildReaderHostSurfaceCss } from "./reader-host-surface-css";
import {
	readConcealmentPalette,
	readObsidianColorScheme,
	readObsidianCssVar,
} from "./reader-theme-tokens";
import {
	applyRendererLayoutAttributes,
	computePaginatorLayoutMetrics,
	isFoliatePaginatorRenderer,
} from "./reader-renderer-layout";
import {
	ReaderPaginatedLayoutRecoveryScheduler,
	shouldRecoverPaginatedLayout,
} from "./reader-paginated-layout-recovery";
import {
	buildAnnotationRenderSignature,
	createReaderFoliateAnnotation,
	createRenderedFoliateAnnotation,
	isSameFoliateAnnotation,
	shouldRenderAnnotationAsConceal,
	type ReaderFoliateAnnotation,
	type RenderedReaderFoliateAnnotation,
} from "./reader-annotation-model";
import { READER_SOURCE_LOCATE_FOCUS_DURATION_MS } from "../ui/source-locate-overlay-timing";
import {
	buildHighlightClickInfo,
	createAnchorPointFromRect,
	createElementViewportRect,
	createViewportRectFromRawRect,
	extractRangeBoundingRect,
	extractRangeClientRects,
	hasUsableOverlayRects,
} from "./reader-highlight-geometry";
import { resolveHighlightOverlayRects } from "./reader-highlight-overlay-rects";
import { resolveHighlightSectionIndexForView, orderVisibleHighlightFrames } from "./reader-highlight-section-resolver";
import { resolveHighlightViewportGeometry } from "./reader-highlight-viewport-geometry";
import { mapRawRectToViewport } from "./reader-viewport-rect-map";
import {
	type FoliateOverlayerModule,
	ReaderAnnotationOverlayRenderer,
} from "./reader-annotation-overlayer";
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
import {
	buildRemainingReadingEstimate,
	createPaceAnchor,
	estimateConsumedBookWords,
	normalizeReadingPaceStats,
	PACE_HEARTBEAT_MS,
	PACE_IDLE_CUTOFF_MS,
	PACE_MAX_INTERVAL_MS,
	PACE_MIN_INTERVAL_WORDS,
	recordReadingInterval,
	shouldRecordPaceInterval,
	type PaceAnchorSnapshot,
	type SectionReadingSlice,
} from "./reading-pace";
import {
	isAtChapterEndByPositionMetrics,
	isScrolledRendererAtSectionBottom,
	resolveScrolledChapterEndState,
} from "./scrolled-chapter-end";
import { logger } from "../../utils/logger";
import { domInstanceOf } from "../../utils/dom-instance-of";
import { createSpanInOwnerDocument } from "../../utils/obsidian-document-dom";
import {
	sanitizeLegacyAuthorColorAttributes,
	stripInlineAuthorColorStyles,
} from "../../utils/epub-author-color-sanitizer";
import { UnifiedThemeManager } from "../../utils/theme-detection";
import { installFoliateCustomElementGuard } from "../../utils/foliate-custom-element-guard";
import { usesFoliateGenericBookLoader } from "./book-format";
import {
	FoliateVaultPublicationParser,
	type FoliateResolvedTarget,
} from "./FoliateVaultPublicationParser";
import {
	installDesktopFoliateIframeSandboxPatch,
	installFoliateBlobIframePatch,
} from "./foliate-runtime-patches";
import { FootnotePreviewController, FootnotePreviewResolver } from "./footnote-preview";
import { FoliateSessionGuard } from "./FoliateSessionGuard";
import {
	getReaderHighlightIdentityKey,
	normalizeHighlightQuoteText,
	resolvedRangeCoversHighlightText,
} from "./highlight/highlight-identity";
import { EpubLinkService } from "./EpubLinkService";

function logFootnoteDiag(message: string): void {
	logger.debugWithTag("FootnoteDiag", message);
}

type FoliateAnnotation = ReaderFoliateAnnotation;
type RenderedFoliateAnnotation = RenderedReaderFoliateAnnotation;

type VisibleFrameWithIndex = {
	index: number;
	href: string;
	frameDocument: Document;
	frameElement: HTMLElement | null;
	frame: ReaderFrame;
};

type FoliateRenderer = HTMLElement & {
	setStyles?: (styles: string | [string, string]) => void;
	render?: () => void;
	getContents?: () => Array<{ index?: number; doc?: Document | null }>;
	flow?: string;
	viewSize?: number;
	end?: number;
};

type FoliateViewElement = HTMLElement & {
	open: (...args: unknown[]) => unknown;
	close: () => void;
	addAnnotation: (...args: unknown[]) => unknown;
	deleteAnnotation: (...args: unknown[]) => unknown;
	goLeft?: () => unknown;
	goRight?: () => unknown;
	prev?: () => unknown;
	next?: () => unknown;
	addEventListener: HTMLElement["addEventListener"];
	removeEventListener: HTMLElement["removeEventListener"];
	[key: string]: unknown;
};

type BridgedHostSelectionPayload = {
	text: string;
	sourceSelection: Selection;
	sourceRange: Range;
	primaryRect: HighlightClickInfo["rect"];
	rects: HighlightClickInfo["rect"][];
};

type ReaderParagraphTextSegment = {
	path: number[];
	relativePath: number[];
	text: string;
};

type ReaderParagraphCharPointer = {
	segmentIndex: number;
	nodeOffset: number;
};

type ReaderParagraphRecord = ReaderParagraph & {
	elementPath: number[];
	segments: ReaderParagraphTextSegment[];
	charMap: ReaderParagraphCharPointer[];
	htmlRevision?: number;
};

type ParagraphExtractionSource = {
	doc: Document;
	chapterIndex: number;
	chapterHref: string;
};

type ParagraphExtractionCandidateSource = "visible" | "processed" | "raw" | "embedded";

const PARAGRAPH_EXTRACTION_SOURCE_PRIORITY: Record<ParagraphExtractionCandidateSource, number> = {
	raw: 3,
	processed: 2,
	embedded: 1,
	visible: 0,
};

const PARAGRAPH_TAG_NAMES = new Set([
	"P",
	"LI",
	"BLOCKQUOTE",
	"PRE",
	"FIGCAPTION",
	"DD",
	"DT",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
]);

const PARAGRAPH_CHILD_BLOCK_SELECTOR = [
	"p",
	"li",
	"blockquote",
	"pre",
	"figcaption",
	"dd",
	"dt",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"table",
	"ul",
	"ol",
	"section",
	"article",
].join(", ");

const PARAGRAPH_EXPLICIT_SELECTOR = [
	"p",
	"li",
	"blockquote",
	"pre",
	"figcaption",
	"dd",
	"dt",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
].join(", ");

const LEAF_PARAGRAPH_CONTAINER_SELECTOR = ["div", "section", "article"].join(", ");
const BLOCK_PARAGRAPH_FALLBACK_SELECTOR = [
	"p",
	"li",
	"blockquote",
	"pre",
	"figcaption",
	"dd",
	"dt",
	"div",
	"section",
	"article",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
].join(", ");

const PARAGRAPH_READING_EXCLUDED_SELECTOR =
	"nav, header, footer, aside, [hidden], [aria-hidden='true']";
const PARAGRAPH_CONTAINER_MAX_LENGTH = 3200;
const PARAGRAPH_EXPLICIT_MAX_LENGTH = 12000;
const PARAGRAPH_EXPLICIT_SPLIT_CHUNK = 1800;
const PARAGRAPH_MIN_MEANINGFUL_LENGTH = 12;
const PARAGRAPH_BODY_COVERAGE_THRESHOLD = 0.3;
const PARAGRAPH_BOILERPLATE_PATTERNS = [
	/未经授权禁止转载/u,
	/禁止转载/u,
	/获取更多电子书/u,
	/\bt\.me\//iu,
	/\bEPUB_\d{10,}\b/u,
];

export class FoliateReaderService implements EpubReaderEngine {
	readonly engineType = "foliate" as const;

	private static readonly FOOTNOTE_PREVIEW_RESOLVE_TIMEOUT_MS = 2200;
	private static readonly FOOTNOTE_PREVIEW_CANDIDATE_TIMEOUT_MS = 480;
	private static readonly NAVIGATION_TIMEOUT_MS = 5000;

	private readonly app: App;
	private readonly parser: FoliateVaultPublicationParser;
	private readonly footnotePreviewResolver: FootnotePreviewResolver;
	private readonly footnotePreviewController: FootnotePreviewController;
	private readonly annotationOverlayRenderer: ReaderAnnotationOverlayRenderer;

	private currentBook: EpubBook | null = null;
	private currentPosition: ReadingPosition = {
		chapterIndex: 0,
		cfi: "",
		percent: 0,
	};
	private currentPaginationInfo: PaginationInfo = { currentPage: 0, totalPages: 0 };
	private renderContainer: HTMLElement | null = null;
	private foliateView: FoliateViewElement | null = null;
	private layoutChangeInFlight = false;
	private currentLineHeight = 1.72;
	private currentLetterSpacing = 0;
	private currentPageMargin = 48;
	private currentWidthMode: EpubWidthMode = "standard";
	private currentStrikethroughPresentation: EpubStrikethroughDisplayMode = "strikethrough";
	private currentLayoutMode: EpubLayoutMode = "paginated";
	private currentFlowMode: EpubFlowMode = "paginated";
	private currentFootnoteClickAction: EpubFootnoteClickAction = "preview";
	private currentChapterTitle = "";
	private currentChapterHref = "";
	private paragraphFootnotePreviewSession = 0;
	private paragraphAnchorSyncDepth = 0;
	private relocatedCallbacks = new Set<(position: ReadingPosition) => void>();
	private scrolledChapterEndCallbacks = new Set<(atEnd: boolean) => void>();
	private scrolledChapterEndMonitorCleanup: (() => void) | null = null;
	private scrolledChapterEndSyncFrame = 0;
	private atCurrentChapterEndCached = false;
	private footnotePreviewCallbacks = new Set<(info: ReaderFootnotePreviewInfo | null) => void>();
	private selectionChangeCallbacks = new Set<(event: ReaderSelectionChange) => void>();
	private highlightClickCallbacks = new Set<(info: HighlightClickInfo) => void>();
	private referenceBadgeClickCallbacks = new Set<(info: HighlightClickInfo) => void>();
	private highlightDataMap = new Map<string, ReaderHighlight>();
	private temporaryHighlightDataMap = new Map<string, ReaderHighlight>();
	private highlightAnchorResolutionByKey = new Map<string, Promise<string>>();
	private savedHighlights: ReaderHighlight[] = [];
	private renderedAnnotations = new Map<string, RenderedFoliateAnnotation>();
	private temporaryHighlightTimers = new Map<string, ReturnType<typeof window.setTimeout>>();
	private sourceLocateFocusByCfiKey = new Map<string, { color: string; cfiRange: string }>();
	private sourceLocateFocusTimers = new Map<string, ReturnType<typeof window.setTimeout>>();
	private temporarilyRevealedConcealmentTimers = new Map<string, ReturnType<typeof window.setTimeout>>();
	private documentFootnoteCleanups = new Map<Document, () => void>();
	private documentSelectionCleanups = new Map<Document, () => void>();
	private documentHighlightClickCleanups = new Map<Document, () => void>();
	private documentWheelCleanups = new Map<Document, () => void>();
	private documentStyleElements = new WeakMap<Document, HTMLStyleElement>();
	private loadedDocumentSectionIndexes = new WeakMap<Document, number>();
	private lastSelectionByDocument = new WeakMap<Document, string>();
	private overlayerModulePromise: Promise<FoliateOverlayerModule> | null = null;
	private renderContainerWheelCleanup: (() => void) | null = null;
	private themeChangeCleanup: (() => void) | null = null;
	private pendingThemeRefreshFrame: number | null = null;
	private themeRefreshToken = 0;
	private readonly paginatedLayoutRecovery = new ReaderPaginatedLayoutRecoveryScheduler();
	private readonly sessionGuard = new FoliateSessionGuard<FoliateViewElement>();
	private wheelTurnInFlight = false;
	private wheelDeltaAccumulator = 0;
	private lastWheelEventAt = 0;
	private bookEndAdvanceHandler: (() => boolean | Promise<boolean>) | null = null;
	private navigationTask: Promise<void> = Promise.resolve();
	private paragraphCache = new Map<number, ReaderParagraphRecord[]>();
	private paragraphRecordById = new Map<string, ReaderParagraphRecord>();
	private paragraphPresentationRevision = 0;
	private paragraphRangeCache = new WeakMap<Document, Map<string, Range | null>>();
	private readingPaceAnchor: PaceAnchorSnapshot | null = null;
	private pendingActiveReadMs = 0;
	private lastReaderActivityAt = 0;
	private currentSectionProgression = 0;
	private paceHeartbeatTimer: ReturnType<typeof window.setInterval> | null = null;
	private paceVisibilityCleanup: (() => void) | null = null;
	private lastSyncedVisibleSectionKey = "";
	private annotationSyncInFlight: Promise<void> | null = null;
	private annotationSyncQueued = false;
	private annotationSyncForceNext = false;
	private static readonly PACE_HEARTBEAT_MS = PACE_HEARTBEAT_MS;
	private static readonly PACE_IDLE_CUTOFF_MS = PACE_IDLE_CUTOFF_MS;

	constructor(app: App) {
		this.app = app;
		this.parser = new FoliateVaultPublicationParser(app);
		this.footnotePreviewResolver = new FootnotePreviewResolver({
			parser: this.parser,
			getCurrentChapterHref: () => this.currentChapterHref,
			getSectionHrefForDocument: (doc: Document) => {
				const currentSectionIndex = this.loadedDocumentSectionIndexes.get(doc);
				return typeof currentSectionIndex === "number"
					? this.parser.getSectionHrefByIndex(currentSectionIndex)
					: this.currentChapterHref;
			},
			getVisibleFrames: () => this.getVisibleFramesWithIndex(),
			createViewportRectFromElement: (doc: Document, element: Element) =>
				this.createViewportRectFromElement(doc, element),
			candidateTimeoutMs: FoliateReaderService.FOOTNOTE_PREVIEW_CANDIDATE_TIMEOUT_MS,
		});
		this.footnotePreviewController = new FootnotePreviewController({
			buildPendingPreviewInfo: (doc: Document, anchor: HTMLAnchorElement) =>
				this.buildPendingFootnotePreviewInfo(doc, anchor),
			buildStatusPreviewInfo: (doc: Document, anchor: HTMLAnchorElement, text: string) =>
				this.buildStatusFootnotePreviewInfo(doc, anchor, text),
			resolvePreviewInfo: (doc: Document, anchor: HTMLAnchorElement) =>
				this.buildFootnotePreviewInfo(doc, anchor),
			notifyPreview: (info: ReaderFootnotePreviewInfo | null) => this.notifyFootnotePreview(info),
			resolveTimeoutMs: FoliateReaderService.FOOTNOTE_PREVIEW_RESOLVE_TIMEOUT_MS,
		});
		this.annotationOverlayRenderer = new ReaderAnnotationOverlayRenderer({
			resolveHighlightTint: (color) => this.resolveHighlightTint(color),
			getColorScheme: () => this.getCurrentColorScheme(),
			getObsidianCSSVar: (varName, fallback) => this.getObsidianCSSVar(varName, fallback),
			getConcealmentPalette: () => this.getConcealmentPalette(),
			onCommentMarkerClick: (cfiRange, markerElement, anchorRect) =>
				this.notifyCommentMarkerClick(cfiRange, markerElement, anchorRect),
			onNoteMarkerClick: (annotation, markerElement, anchorRect) =>
				this.notifyNoteMarkerClick(annotation, markerElement, anchorRect),
			onReferenceBadgeClick: (cfiRange, geometry) =>
				this.notifyReferenceBadgeClick(cfiRange, geometry),
		});
	}

	private async ensureFoliateViewRegistered(): Promise<void> {
		installFoliateCustomElementGuard();
		installDesktopFoliateIframeSandboxPatch();
		installFoliateBlobIframePatch((error) => {
			logger.warn("[FoliateReaderService] Failed to resolve foliate blob iframe source:", error);
		});
		if (customElements.get("foliate-view")) {
			return;
		}
		const viewModule = (await import("foliate-js/view.js")) as {
			View?: CustomElementConstructor;
		};
		const viewConstructor = viewModule.View;
		if (viewConstructor && !customElements.get("foliate-view")) {
			customElements.define("foliate-view", viewConstructor);
		}
	}

	async loadEpub(filePath: string, existingBookId?: string): Promise<EpubBook> {
		await this.destroyViewOnly();
		this.resetHighlightState();
		this.resetParagraphState();
		this.resetReaderState();

		try {
			const loaded = await this.parser.load(filePath);
			const initialCfi =
				(await this.parser.canonicalizeLocation(this.parser.getSectionHrefByIndex(0))) || "";
			this.currentBook = {
				id: existingBookId || this.buildFallbackBookId(filePath),
				filePath,
				metadata: {
					title: loaded.metadata.title,
					author: loaded.metadata.author,
					publisher: loaded.metadata.publisher,
					language: loaded.metadata.language,
					identifier: loaded.metadata.identifier,
					isbn: loaded.metadata.isbn,
					translator: loaded.metadata.translator,
					description: loaded.metadata.description,
					publishDate: loaded.metadata.publishDate,
					subjects: loaded.metadata.subjects,
					series: loaded.metadata.series,
					rights: loaded.metadata.rights,
					price: loaded.metadata.price,
					coverImage: loaded.coverImage,
					wordCount: loaded.metadata.wordCount,
					chapterCount: loaded.metadata.chapterCount,
				},
				currentPosition: {
					chapterIndex: 0,
					cfi: initialCfi,
					percent: 0,
				},
				readingStats: {
					totalReadTime: 0,
					lastReadTime: Date.now(),
					createdTime: Date.now(),
				},
			};
			this.currentPosition = { ...this.currentBook.currentPosition };
			this.currentPaginationInfo = {
				currentPage: initialCfi ? (await this.parser.resolvePageNumber(initialCfi)) || 1 : 0,
				totalPages: loaded.totalPositions,
			};
			this.currentChapterTitle = this.parser.getSectionTitleByIndex(0);
			this.currentChapterHref = this.parser.getSectionHrefByIndex(0);
			return this.currentBook;
		} catch (error) {
			this.resetReaderState();
			throw error;
		}
	}

	private buildFallbackBookId(filePath: string): string {
		return `epub-${this.hashString(String(filePath || "").trim() || "book")}`;
	}

	private hashString(input: string): string {
		let hash = 2166136261;
		for (let index = 0; index < input.length; index += 1) {
			hash ^= input.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		return (hash >>> 0).toString(36);
	}

	async renderTo(container: HTMLElement, options?: ReaderRenderOptions): Promise<void> {
		if (!this.currentBook) {
			throw this.createNotReadyError("renderTo");
		}

		await this.destroyViewOnly();
		await this.ensureFoliateViewRegistered();
		const viewSessionToken = this.sessionGuard.startViewSession();

		this.renderContainer = container;
		this.layoutChangeInFlight = true;
		this.applyRenderOptions(options);
		container.replaceChildren();
		container.dataset.foliate = "true";

		const view = activeWindow.createEl("foliate-view") as FoliateViewElement;
		view.classList.add("weave-epub-reader-host");
		view.addEventListener("relocate", this.handleRelocateEvent as EventListener);
		view.addEventListener("load", this.handleLoadEvent as EventListener);
		view.addEventListener("link", this.handleLinkEvent as EventListener);
		view.addEventListener("draw-annotation", this.handleDrawAnnotationEvent as EventListener);
		view.addEventListener("show-annotation", this.handleShowAnnotationEvent as EventListener);
		this.foliateView = view;
		container.appendChild(view);
		this.attachRenderContainerWheelListener(container, view as unknown as HTMLElement);

		try {
			await view.open(this.parser.getBook());
			if (!this.sessionGuard.isActiveViewSession(viewSessionToken, this.foliateView, view)) {
				return;
			}
			this.attachThemeChangeListener();
			// Setting Foliate's `flow` attribute invokes render synchronously. During the
			// first scrolled render the chapter iframe has not been loaded yet, so Foliate
			// can try to lay out a document without documentElement/body and abort opening
			// the book. Keep its default paginated layout for the bootstrap navigation and
			// apply the requested scrolled flow once the first chapter is mounted.
			const deferInitialScrolledLayout = this.currentFlowMode === "scrolled";
			if (!deferInitialScrolledLayout) {
				this.applyRendererLayout();
			}
			this.applyRendererAppearance();
			this.renderedAnnotations.clear();
			const positionOperationToken = this.sessionGuard.startPositionOperation();
			const initialTarget = this.currentPosition.cfi || this.currentBook.currentPosition.cfi;
			if (initialTarget) {
				const safeInitialTarget = this.isSectionBaseCfiTarget(initialTarget)
					? this.getSectionHrefFallbackTarget(initialTarget)
					: initialTarget;
				await this.navigateViewWithFallback(
					safeInitialTarget,
					this.getSectionHrefFallbackTarget(initialTarget),
					positionOperationToken,
					viewSessionToken
				);
			} else {
				await view.goToTextStart();
				await this.stabilizeViewAfterNavigation(
					undefined,
					positionOperationToken,
					viewSessionToken
				);
			}
			if (deferInitialScrolledLayout) {
				this.applyRendererLayout();
				await this.waitForAnimationFrame();
				if (!this.sessionGuard.isActiveViewSession(viewSessionToken, this.foliateView, view)) {
					return;
				}
			}
			await this.syncCurrentPositionFromTarget(
				initialTarget || this.parser.getSectionHrefByIndex(0),
				undefined,
				positionOperationToken
			);
			await this.refreshHighlights();
			this.attachReadingPaceListeners();
			this.syncScrolledChapterEndMonitor();
		} catch (error) {
			if (this.sessionGuard.isActiveViewSession(viewSessionToken, this.foliateView, view)) {
				await this.destroyViewOnly();
			}
			throw error;
		} finally {
			if (this.sessionGuard.isActiveViewSession(viewSessionToken, this.foliateView, view)) {
				this.layoutChangeInFlight = false;
			}
		}
	}

	setFootnoteClickAction(action: EpubFootnoteClickAction): void {
		this.currentFootnoteClickAction = action === "navigate" ? "navigate" : "preview";
	}

	async setRestoredPosition(position: ReadingPosition): Promise<void> {
		if (!this.currentBook || !position?.cfi) {
			return;
		}

		const canonical = await this.parser.canonicalizeLocation(position.cfi);
		if (!canonical) {
			return;
		}

		const currentPage = (await this.parser.resolvePageNumber(canonical)) || 0;
		const totalPages = this.parser.getTotalPositions();
		const percent =
			totalPages > 1 && currentPage > 0
				? this.clamp(((currentPage - 1) / (totalPages - 1)) * 100, 0, 100)
				: Number.isFinite(position.percent)
				? this.clamp(position.percent, 0, 100)
				: 0;

		this.currentPosition = {
			chapterIndex:
				typeof position.chapterIndex === "number" && Number.isFinite(position.chapterIndex)
					? position.chapterIndex
					: this.currentPosition.chapterIndex,
			cfi: canonical,
			percent,
		};
		this.currentBook.currentPosition = { ...this.currentPosition };
		this.currentPaginationInfo = {
			currentPage,
			totalPages,
		};
	}

	async goToLocation(cfi: string): Promise<void> {
		await this.enqueueNavigation(async (positionOperationToken) => {
			const canonical = await this.parser.canonicalizeLocation(cfi);
			if (!canonical) {
				return;
			}
			this.clearSelections();
			if (
				await this.tryApplyLightweightLocationUpdate(canonical, positionOperationToken)
			) {
				return;
			}
			await this.navigateViewWithFallback(
				canonical,
				this.getSectionHrefFallbackTarget(canonical, cfi),
				positionOperationToken
			);
			await this.syncCurrentPositionFromTarget(canonical, undefined, positionOperationToken);
		}, "goToLocation");
	}

	async syncParagraphAnchor(cfi: string): Promise<void> {
		this.paragraphAnchorSyncDepth += 1;
		try {
			await this.goToLocation(cfi);
		} finally {
			this.paragraphAnchorSyncDepth = Math.max(0, this.paragraphAnchorSyncDepth - 1);
		}
	}

	isParagraphAnchorSyncInFlight(): boolean {
		return this.paragraphAnchorSyncDepth > 0;
	}

	canonicalizeLocation(cfi: string, textHint?: string): Promise<string | null> {
		return this.parser.canonicalizeLocation(cfi, textHint);
	}

	getReadingProgress(): number {
		return this.currentPosition.percent;
	}

	async getPaginationInfo(): Promise<PaginationInfo> {
		return this.currentPaginationInfo;
	}

	getReadingStats(): ReadingStats | null {
		if (!this.currentBook) {
			return null;
		}
		return normalizeReadingPaceStats(this.currentBook.readingStats);
	}

	flushReadingPace(): void {
		if (!this.currentBook) {
			return;
		}
		const totalPositions = this.parser.getTotalPositions();
		const currentPage = this.normalizeCurrentPage(totalPositions);
		const consumedBookWords = this.getConsumedBookWordsForPace(currentPage);
		const now = Date.now();

		if (this.readingPaceAnchor) {
			const activeMs = Math.min(
				PACE_MAX_INTERVAL_MS,
				now - this.readingPaceAnchor.at + this.pendingActiveReadMs
			);
			this.pendingActiveReadMs = 0;
			if (activeMs > 0 && this.isDocumentVisibleForPace()) {
				const normalized = normalizeReadingPaceStats(this.currentBook.readingStats);
				this.currentBook.readingStats = {
					...normalized,
					totalReadTime: normalized.totalReadTime + activeMs,
					lastReadTime: now,
				};
			}
		}

		this.readingPaceAnchor = createPaceAnchor(consumedBookWords, currentPage, now);
	}

	async getRemainingReadingTimeEstimate(): Promise<ReaderRemainingTimeEstimate> {
		if (!this.currentBook) {
			return {};
		}
		const totalWordCount = this.parser.getTotalWordCount();
		const totalPositions = this.parser.getTotalPositions();
		const currentPage = this.normalizeCurrentPage(totalPositions);

		return buildRemainingReadingEstimate({
			totalWordCount,
			sections: this.collectSectionSlices(),
			currentChapterIndex: this.currentPosition.chapterIndex,
			currentPage,
			totalPositions,
			percentFallback: this.currentPosition.percent,
			sectionProgression: this.currentSectionProgression,
			stats: this.currentBook.readingStats,
			language: this.currentBook.metadata.language,
		});
	}

	isLayoutChanging(): boolean {
		return this.layoutChangeInFlight;
	}

	resize(_width: number, _height: number): void {
		this.applyRendererLayout();
		(this.foliateView?.renderer as FoliateRenderer | undefined)?.render?.();
		this.schedulePaginatedLayoutRecovery();
	}

	async applyReaderAppearance(
		appearance: ReaderAppearanceOptions,
		_redisplay?: boolean
	): Promise<void> {
		if (typeof appearance.lineHeight === "number" && appearance.lineHeight > 0) {
			this.currentLineHeight = appearance.lineHeight;
		}
		if (typeof appearance.letterSpacing === "number" && Number.isFinite(appearance.letterSpacing)) {
			this.currentLetterSpacing = appearance.letterSpacing;
		}
		if (typeof appearance.pageMargin === "number" && Number.isFinite(appearance.pageMargin)) {
			this.currentPageMargin = appearance.pageMargin;
		}
		if (appearance.widthMode) {
			this.currentWidthMode = appearance.widthMode;
		}
		if (appearance.strikethroughPresentation) {
			this.currentStrikethroughPresentation = appearance.strikethroughPresentation;
		}
		this.applyRendererLayout();
		this.applyRendererAppearance();
		await this.refreshHighlights();
	}

	onRelocated(callback: (position: ReadingPosition) => void): () => void {
		this.relocatedCallbacks.add(callback);
		return () => {
			this.relocatedCallbacks.delete(callback);
		};
	}

	onScrolledChapterEndChange(callback: (atEnd: boolean) => void): () => void {
		this.scrolledChapterEndCallbacks.add(callback);
		callback(this.resolveScrolledChapterEndState());
		return () => {
			this.scrolledChapterEndCallbacks.delete(callback);
		};
	}

	async setLayoutMode(
		mode: EpubLayoutMode,
		flowMode: EpubFlowMode,
		appearance?: ReaderAppearanceOptions
	): Promise<void> {
		this.currentLayoutMode = mode;
		this.currentFlowMode = flowMode;
		if (typeof appearance?.lineHeight === "number" && appearance.lineHeight > 0) {
			this.currentLineHeight = appearance.lineHeight;
		}
		if (
			typeof appearance?.letterSpacing === "number" &&
			Number.isFinite(appearance.letterSpacing)
		) {
			this.currentLetterSpacing = appearance.letterSpacing;
		}
		if (typeof appearance?.pageMargin === "number" && Number.isFinite(appearance.pageMargin)) {
			this.currentPageMargin = appearance.pageMargin;
		}
		if (appearance?.widthMode) {
			this.currentWidthMode = appearance.widthMode;
		} else if (mode === "double") {
			this.currentWidthMode = "full";
		}
		if (appearance?.strikethroughPresentation) {
			this.currentStrikethroughPresentation = appearance.strikethroughPresentation;
		}
		if (!this.foliateView) {
			return;
		}
		const currentCfi = this.getCurrentCFI();
		this.layoutChangeInFlight = true;
		try {
			this.applyRendererLayout();
			this.applyRendererAppearance();
			this.renderedAnnotations.clear();
			if (currentCfi) {
				const positionOperationToken = this.sessionGuard.startPositionOperation();
				const safeCurrentTarget = this.isSectionBaseCfiTarget(currentCfi)
					? this.getSectionHrefFallbackTarget(currentCfi, this.currentChapterHref)
					: currentCfi;
				await this.navigateViewWithFallback(
					safeCurrentTarget,
					this.getSectionHrefFallbackTarget(currentCfi, this.currentChapterHref),
					positionOperationToken
				);
				await this.syncCurrentPositionFromTarget(currentCfi, undefined, positionOperationToken);
			}
			await this.refreshHighlights();
		} finally {
			this.layoutChangeInFlight = false;
			this.syncScrolledChapterEndMonitor();
		}
	}

	searchText(
		query: string
	): Promise<Array<{ cfi: string; excerpt: string; chapterTitle: string }>> {
		return this.parser.search(query);
	}

	getTableOfContents(): Promise<TocItem[]> {
		return Promise.resolve(this.parser.getTocItems());
	}

	async navigateTo(options: ReaderNavigateOptions): Promise<void> {
		await this.enqueueNavigation(
			(positionOperationToken) => this.resolveNavigationRequest(options, positionOperationToken),
			"navigateTo"
		);
	}

	async navigateAndHighlight(options: NavigateAndHighlightOptions): Promise<void> {
		await this.enqueueNavigation(async (positionOperationToken) => {
			const { canonical } = await this.resolveNavigationRequest(options, positionOperationToken);
			if (canonical && options.flashStyle !== "none") {
				await this.clearActiveTemporaryHighlights();
				this.clearSourceLocateFocus();
				const flashColor = options.flashColor || "yellow";
				if (this.hasPersistentHighlightAtCfi(canonical)) {
					this.setSourceLocateFocus(canonical, flashColor);
					await this.refreshHighlights();
					return;
				}
				await this.addResolvedHighlight(
					{
						cfiRange: canonical,
						color: flashColor,
						text: options.text,
						sourceFile: options.sourceFile,
						sourceRef: options.sourceRef,
						createdTime: options.createdTime,
						temporary: true,
					},
					READER_SOURCE_LOCATE_FOCUS_DURATION_MS
				);
			}
		}, "navigateAndHighlight");
	}

	getNavigationTargetRect(options: ReaderNavigationRectOptions): DOMRect | null {
		const preciseRect = this.findPreciseNavigationTargetRect(options);
		if (preciseRect) {
			return preciseRect;
		}
		if (options.allowFallback === false) {
			return null;
		}
		return this.getRenderContainerRect();
	}

	getSourceLocateOverlayRect(options: ReaderNavigationRectOptions): DOMRect | null {
		return resolveReaderSourceLocateOverlayRect({
			cfi: options.cfi,
			href: options.href,
			text: options.text,
			currentCfi: this.currentPosition.cfi,
			temporaryHighlightCfis: this.collectSourceLocateOverlayAnchorCfis(),
			resolveNavigationRect: (resolveOptions) =>
				this.findPreciseNavigationTargetRect({
					cfi: resolveOptions.cfi,
					href: resolveOptions.href,
					text: resolveOptions.text,
				}),
			resolveHighlightRect: (cfiRange, textHint) =>
				mapHighlightViewportRectToDomRect(
					this.getCurrentHighlightViewportGeometry(cfiRange, textHint)?.rect
				),
		});
	}

	getCurrentPosition(): ReadingPosition {
		return { ...this.currentPosition };
	}

	private findPreciseNavigationTargetRect(options: ReaderNavigationRectOptions): DOMRect | null {
		for (const target of this.buildNavigationRectTargets(options)) {
			for (const frame of this.getVisibleFramesWithIndex()) {
				const range = this.parser.resolveRangeInLoadedSection(
					target,
					frame.frameDocument,
					frame.index,
					options.text?.trim() || undefined
				);
				if (!range) {
					continue;
				}
				const rect = this.createViewportRect(frame, range);
				if (rect) {
					return new DOMRect(rect.left, rect.top, rect.width, rect.height);
				}
			}
		}

		return null;
	}

	private buildNavigationRectTargets(options: ReaderNavigationRectOptions): string[] {
		return buildReaderNavigationRectTargets({
			cfi: options.cfi,
			href: options.href,
			currentCfi: this.currentPosition.cfi,
			currentHref: this.currentChapterHref,
		});
	}

	private getRenderContainerRect(): DOMRect | null {
		const rect = this.renderContainer?.getBoundingClientRect() || null;
		if (!rect || (!rect.width && !rect.height)) {
			return null;
		}
		return new DOMRect(rect.left, rect.top, rect.width, rect.height);
	}

	getCurrentChapterTitle(): string {
		return this.currentChapterTitle;
	}

	getChapterLocationLabel(format: EpubChapterLocationFormat = "leaf"): string {
		const chapterIndex = this.getCurrentChapterIndex();
		if (chapterIndex < 0) {
			return "";
		}
		return this.parser.getSectionLocationLabelByIndex(chapterIndex, format) || this.currentChapterTitle;
	}

	getCurrentChapterIndex(): number {
		return this.currentPosition.chapterIndex;
	}

	getCurrentChapterHref(): string {
		return this.currentChapterHref;
	}

	async getParagraphsForChapter(
		chapterIndex: number,
		options?: { includeHtml?: boolean }
	): Promise<ReaderParagraph[]> {
		const includeHtml = options?.includeHtml !== false;
		return Promise.all(
			(await this.getParagraphRecordsForChapter(chapterIndex)).map((paragraph) =>
				this.toReaderParagraph(paragraph, { includeHtml })
			)
		);
	}

	async hydrateReaderParagraph(paragraphId: string): Promise<ReaderParagraph | null> {
		const paragraph = this.paragraphRecordById.get(String(paragraphId || "").trim());
		if (!paragraph) {
			return null;
		}
		return this.toReaderParagraph(paragraph, { includeHtml: true });
	}

	async getCurrentParagraphLocation(options?: {
		preferredParagraphId?: string;
		preferredIndex?: number;
	}): Promise<ReaderParagraphLocation | null> {
		const chapterIndex = this.getCurrentChapterIndex();
		if (chapterIndex < 0) {
			return null;
		}
		const paragraphs = await this.getMergedParagraphRecordsForReadingContext(chapterIndex);
		if (paragraphs.length === 0) {
			return null;
		}
		const preferredParagraphId = String(options?.preferredParagraphId || "").trim();
		const preferredIndex = Number.isInteger(options?.preferredIndex)
			? Math.max(0, Math.min(Number(options?.preferredIndex), paragraphs.length - 1))
			: null;
		const preferredParagraphMatchIndex = preferredParagraphId
			? paragraphs.findIndex((paragraph) => paragraph.id === preferredParagraphId)
			: -1;
		const hasPreferredAnchor = preferredParagraphMatchIndex >= 0 || preferredIndex !== null;
		const currentIndex = hasPreferredAnchor
			? 0
			: await this.resolveCurrentParagraphIndex(chapterIndex, paragraphs);
		const activeIndex =
			preferredParagraphMatchIndex >= 0
				? preferredParagraphMatchIndex
				: preferredIndex ?? currentIndex;
		const paragraphSnapshots = await Promise.all(
			paragraphs.map((paragraph, index) =>
				this.toReaderParagraph(paragraph, { includeHtml: index === activeIndex })
			)
		);
		return {
			paragraphs: paragraphSnapshots,
			currentIndex: activeIndex,
		};
	}

	async pickRandomParagraph(options?: {
		excludeParagraphId?: string;
	}): Promise<ReaderRandomParagraphPick | null> {
		const chapterCount = Math.max(this.parser.getMetadata().chapterCount, 0);
		if (chapterCount <= 0) {
			return null;
		}

		const excludeParagraphId = String(options?.excludeParagraphId || "").trim();
		const triedChapters = new Set<number>();
		const maxAttempts = Math.min(chapterCount, 16);

		for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
			let chapterIndex = Math.floor(Math.random() * chapterCount);
			if (triedChapters.size < chapterCount) {
				while (triedChapters.has(chapterIndex)) {
					chapterIndex = Math.floor(Math.random() * chapterCount);
				}
			}
			triedChapters.add(chapterIndex);

			const chapterParagraphs = await this.getParagraphsForChapter(chapterIndex, {
				includeHtml: false,
			});
			const eligible = chapterParagraphs.filter(
				(paragraph) =>
					String(paragraph.cfiRange || "").trim()
					&& (!excludeParagraphId || paragraph.id !== excludeParagraphId)
			);
			const pool =
				eligible.length > 0
					? eligible
					: chapterParagraphs.filter((paragraph) => String(paragraph.cfiRange || "").trim());
			if (pool.length === 0) {
				continue;
			}

			const paragraph = pool[Math.floor(Math.random() * pool.length)];
			const paragraphIndex = chapterParagraphs.findIndex((item) => item.id === paragraph.id);
			if (paragraphIndex < 0) {
				continue;
			}

			return {
				paragraph,
				chapterIndex,
				chapterParagraphs,
				paragraphIndex,
			};
		}

		return null;
	}

	async resolveParagraphSelection(
		paragraphId: string,
		startOffset: number,
		endOffset: number
	): Promise<ReaderParagraphSelectionResolution | null> {
		const paragraph = this.paragraphRecordById.get(paragraphId);
		if (!paragraph) {
			return null;
		}
		const totalLength = paragraph.text.length;
		const normalizedStart = this.clamp(Math.floor(startOffset), 0, totalLength);
		const normalizedEnd = this.clamp(Math.ceil(endOffset), 0, totalLength);
		if (normalizedEnd <= normalizedStart) {
			return null;
		}

		const resolvedRange = await this.createParagraphSelectionRange(
			paragraph,
			normalizedStart,
			normalizedEnd
		);
		if (!resolvedRange) {
			return null;
		}

		const { range, chapterIndex } = resolvedRange;
		let cfiRange: string | null = null;
		const visibleFrame = this.getVisibleFramesWithIndex().find(
			(item) => item.index === chapterIndex
		);
		if (visibleFrame) {
			const liveRange = this.resolveParagraphRangeInDocument(
				paragraph,
				visibleFrame.frameDocument,
				normalizedStart,
				normalizedEnd
			);
			cfiRange = liveRange ? visibleFrame.frame.cfiFromRange(liveRange) : null;
		}
		if (!cfiRange) {
			try {
				cfiRange = this.parser.createCfiFromRange(chapterIndex, range);
			} catch (error) {
				logger.warn("[FoliateReaderService] Failed to resolve paragraph selection CFI:", {
					paragraphId,
					chapterIndex,
					error,
				});
			}
		}
		if (!cfiRange) {
			return null;
		}

		return {
			cfiRange,
			text: paragraph.text.slice(normalizedStart, normalizedEnd).trim(),
		};
	}

	async openParagraphFootnotePreview(
		paragraphId: string,
		href: string,
		label?: string,
		options?: {
			pinned?: boolean;
			rect?: ReaderFootnotePreviewInfo["rect"];
		}
	): Promise<void> {
		const paragraph = this.paragraphRecordById.get(paragraphId);
		if (!paragraph) {
			this.dismissParagraphFootnotePreview({ unpin: true });
			return;
		}
		const doc = await this.parser.getRawDocumentByIndex(paragraph.chapterIndex);
		if (!doc) {
			this.dismissParagraphFootnotePreview({ unpin: true });
			return;
		}
		const paragraphElement = this.resolveElementPath(
			doc.body || doc.documentElement,
			paragraph.elementPath
		);
		if (!domInstanceOf(paragraphElement, HTMLElement)) {
			this.dismissParagraphFootnotePreview({ unpin: true });
			return;
		}
		const targetHref = String(href || "").trim();
		const targetLabel = String(label || "")
			.replace(/\s+/g, " ")
			.trim();
		const matchingAnchor = Array.from(paragraphElement.querySelectorAll("a")).find(
			(anchor): anchor is HTMLAnchorElement => {
				if (!domInstanceOf(anchor, HTMLAnchorElement) || !this.isFootnoteReference(anchor)) {
					return false;
				}
				const anchorHref = String(anchor.getAttribute("href") || "").trim();
				const anchorLabel = String(anchor.textContent || "")
					.replace(/\s+/g, " ")
					.trim();
				return anchorHref === targetHref || (targetLabel.length > 0 && anchorLabel === targetLabel);
			}
		);
		if (!matchingAnchor) {
			this.dismissParagraphFootnotePreview({ unpin: true });
			return;
		}
		const rectOverride = options?.rect;
		const pinned = options?.pinned === true;
		if (!rectOverride || pinned) {
			this.emitFootnotePreviewForAnchor(doc, matchingAnchor, {
				pinned,
				suppressRelocateMs: 0,
				rectOverride,
			});
			return;
		}

		const session = ++this.paragraphFootnotePreviewSession;
		this.footnotePreviewPinned = false;
		const pendingInfo = this.buildPendingFootnotePreviewInfo(doc, matchingAnchor, rectOverride);
		if (
			pendingInfo &&
			session === this.paragraphFootnotePreviewSession &&
			!this.footnotePreviewPinned
		) {
			this.notifyFootnotePreview(pendingInfo);
		}
		try {
			const previewInfo = await this.buildFootnotePreviewInfo(doc, matchingAnchor, rectOverride);
			if (session !== this.paragraphFootnotePreviewSession || this.footnotePreviewPinned) {
				return;
			}
			this.notifyFootnotePreview(
				previewInfo ||
					this.buildStatusFootnotePreviewInfo(
						doc,
						matchingAnchor,
						"脚注内容暂时无法显示",
						rectOverride
					)
			);
		} catch (error) {
			if (session !== this.paragraphFootnotePreviewSession || this.footnotePreviewPinned) {
				return;
			}
			logger.warn("[FoliateReaderService] Failed to resolve paragraph footnote preview:", error);
			this.notifyFootnotePreview(
				this.buildStatusFootnotePreviewInfo(
					doc,
					matchingAnchor,
					"脚注内容暂时无法显示",
					rectOverride
				)
			);
		}
	}

	getChapterReadingPointDraft(
		href: string,
		titleHint?: string
	): Promise<EpubChapterReadingPointDraft | null> {
		return this.parser.getSectionReadingPointDraft(href, titleHint);
	}

	getTocChapterReadingPointDraft(
		href: string,
		titleHint: string | undefined,
		flatTocItems: FlatTocExportItem[],
		itemIndex: number
	): Promise<EpubChapterReadingPointDraft | null> {
		return this.parser.getTocReadingPointDraft(href, titleHint, flatTocItems, itemIndex);
	}

	getBookFootnotesDraft(): Promise<EpubBookFootnotesDraft | null> {
		return this.parser.getBookFootnotesDraft();
	}

	getSectionHrefForCfi(cfi: string): string | null {
		return this.parser.getSectionHrefForCfi(cfi);
	}

	getSectionIndexForCfi(cfi: string): number | null {
		return this.parser.getSectionIndexForCfi(cfi);
	}

	async resolveChapterHighlightRangeText(
		highlight: ReaderHighlight,
		sectionHref: string,
		sectionIndex: number
	): Promise<string | null> {
		const doc = await this.parser.getRawDocumentByHref(sectionHref);
		if (!doc) {
			return null;
		}
		const root = doc.body || doc.documentElement;
		if (!root) {
			return null;
		}
		const range = this.parser.resolveRangeInLoadedSection(
			highlight.cfiRange,
			doc,
			sectionIndex,
			highlight.text
		);
		if (!range) {
			return null;
		}
		return String(range.toString() || "")
			.replace(/\s+/g, " ")
			.trim();
	}

	getSectionHrefByChapterIndex(chapterIndex: number): string | null {
		if (!Number.isFinite(chapterIndex) || chapterIndex < 0) {
			return null;
		}
		return this.parser.getSectionHrefByIndex(Math.floor(chapterIndex)) || null;
	}

	getCurrentCFI(): string {
		return this.currentPosition.cfi;
	}

	async nextChapter(): Promise<boolean> {
		return this.enqueueNavigation(async (positionOperationToken) => {
			const chapterCount = this.parser.getMetadata().chapterCount;
			const currentChapterIndex = this.currentPosition.chapterIndex ?? 0;
			if (chapterCount <= 1 || currentChapterIndex < 0 || currentChapterIndex >= chapterCount - 1) {
				return false;
			}

			const nextHref = this.parser.getSectionHrefByIndex(currentChapterIndex + 1);
			if (!nextHref) {
				return false;
			}

			this.clearSelections();
			await this.navigateViewWithFallback(nextHref, nextHref, positionOperationToken);
			await this.syncCurrentPositionFromTarget(nextHref, undefined, positionOperationToken);
			return true;
		}, "nextChapter");
	}

	async prevChapter(): Promise<boolean> {
		return this.enqueueNavigation(async (positionOperationToken) => {
			const currentChapterIndex = this.currentPosition.chapterIndex ?? 0;
			if (currentChapterIndex <= 0) {
				return false;
			}

			const prevHref = this.parser.getSectionHrefByIndex(currentChapterIndex - 1);
			if (!prevHref) {
				return false;
			}

			this.clearSelections();
			await this.navigateViewWithFallback(prevHref, prevHref, positionOperationToken);
			await this.syncCurrentPositionFromTarget(prevHref, undefined, positionOperationToken);
			return true;
		}, "prevChapter");
	}

	isAtCurrentChapterEnd(): boolean {
		if (this.currentFlowMode !== "scrolled") {
			return false;
		}
		return this.resolveScrolledChapterEndState();
	}

	private resolveScrolledChapterEndState(): boolean {
		return resolveScrolledChapterEndState({
			atSectionBottom: this.isScrolledRendererAtSectionBottom(),
			atChapterEndByMetrics: this.isAtCurrentChapterEndByPositionMetrics(),
		});
	}

	private isScrolledRendererAtSectionBottom(): boolean {
		const renderer = this.foliateView?.renderer as FoliateRenderer | undefined;
		if (!renderer || renderer.getAttribute("flow") !== "scrolled") {
			return false;
		}

		const viewSize = renderer.viewSize;
		const scrollEnd = renderer.end;
		if (typeof viewSize !== "number" || typeof scrollEnd !== "number") {
			return false;
		}

		return isScrolledRendererAtSectionBottom(viewSize, scrollEnd);
	}

	private isAtCurrentChapterEndByPositionMetrics(): boolean {
		const sectionIndex = this.currentPosition.chapterIndex ?? 0;
		const section = this.parser.getSectionReadingMetrics(sectionIndex);
		if (!section) {
			return false;
		}

		const totalPositions = this.parser.getTotalPositions();
		const currentPage = this.normalizeCurrentPage(totalPositions);
		return isAtChapterEndByPositionMetrics({
			currentPage,
			positionStart: section.positionStart,
			positionCount: section.positionCount,
			sectionProgression: this.currentSectionProgression,
		});
	}

	private syncScrolledChapterEndMonitor(): void {
		this.detachScrolledChapterEndMonitor();
		if (this.currentFlowMode === "scrolled" && this.foliateView?.renderer) {
			this.attachScrolledChapterEndMonitor();
			this.publishScrolledChapterEndStateIfChanged();
			return;
		}
		this.publishScrolledChapterEndState(false);
	}

	private attachScrolledChapterEndMonitor(): void {
		const renderer = this.foliateView?.renderer as FoliateRenderer | undefined;
		if (!renderer || renderer.getAttribute("flow") !== "scrolled") {
			return;
		}

		const schedulePublish = () => {
			if (this.scrolledChapterEndSyncFrame) {
				return;
			}
			this.scrolledChapterEndSyncFrame = window.requestAnimationFrame(() => {
				this.scrolledChapterEndSyncFrame = 0;
				this.publishScrolledChapterEndStateIfChanged();
			});
		};
		const onScroll = () => schedulePublish();
		const onRelocate = () => schedulePublish();

		renderer.addEventListener("scroll", onScroll, { passive: true });
		this.foliateView?.addEventListener("relocate", onRelocate as EventListener);
		this.scrolledChapterEndMonitorCleanup = () => {
			if (this.scrolledChapterEndSyncFrame) {
				window.cancelAnimationFrame(this.scrolledChapterEndSyncFrame);
				this.scrolledChapterEndSyncFrame = 0;
			}
			renderer.removeEventListener("scroll", onScroll);
			this.foliateView?.removeEventListener("relocate", onRelocate as EventListener);
		};
	}

	private detachScrolledChapterEndMonitor(): void {
		if (this.scrolledChapterEndMonitorCleanup) {
			this.scrolledChapterEndMonitorCleanup();
			this.scrolledChapterEndMonitorCleanup = null;
		}
		if (this.scrolledChapterEndSyncFrame) {
			window.cancelAnimationFrame(this.scrolledChapterEndSyncFrame);
			this.scrolledChapterEndSyncFrame = 0;
		}
	}

	private publishScrolledChapterEndStateIfChanged(): void {
		this.publishScrolledChapterEndState(this.resolveScrolledChapterEndState());
	}

	private publishScrolledChapterEndState(atEnd: boolean): void {
		if (atEnd === this.atCurrentChapterEndCached) {
			return;
		}
		this.atCurrentChapterEndCached = atEnd;
		for (const callback of this.scrolledChapterEndCallbacks) {
			try {
				callback(atEnd);
			} catch (error) {
				logger.warn("[FoliateReaderService] Scrolled chapter end listener failed:", error);
			}
		}
	}

	isAtBookEnd(): boolean {
		const totalPages = this.parser.getTotalPositions();
		if (totalPages <= 0) {
			return false;
		}

		const chapterCount = Math.max(this.parser.getMetadata().chapterCount, 1);
		const sectionIndex = this.currentPosition.chapterIndex ?? 0;
		const isLastChapter = sectionIndex >= chapterCount - 1;
		if (!isLastChapter) {
			return false;
		}

		const currentPage = this.normalizeCurrentPage(totalPages);
		if (this.currentFlowMode === "scrolled") {
			return this.isAtCurrentChapterEnd();
		}

		return currentPage >= totalPages;
	}

	setBookEndAdvanceHandler(handler: (() => boolean | Promise<boolean>) | null): void {
		this.bookEndAdvanceHandler = handler;
	}

	private async shouldBlockBookEndAdvance(): Promise<boolean> {
		if (!this.isAtBookEnd() || !this.bookEndAdvanceHandler) {
			return false;
		}
		try {
			return (await this.bookEndAdvanceHandler()) === true;
		} catch (error) {
			logger.warn("[FoliateReaderService] book end advance handler failed:", error);
			return false;
		}
	}

	async prevPage(): Promise<void> {
		await this.enqueueNavigation(async () => {
			this.clearSelections();
			if (!this.foliateView) {
				return;
			}
			if (typeof this.foliateView.goLeft === "function") {
				await this.foliateView.goLeft();
				return;
			}
			await this.foliateView.prev();
		}, "prevPage");
	}

	async nextPage(): Promise<void> {
		if (await this.shouldBlockBookEndAdvance()) {
			return;
		}
		await this.enqueueNavigation(async () => {
			this.clearSelections();
			if (!this.foliateView) {
				return;
			}
			if (typeof this.foliateView.goRight === "function") {
				await this.foliateView.goRight();
				return;
			}
			await this.foliateView.next();
		}, "nextPage");
	}

	async goToPage(pageNumber: number): Promise<void> {
		await this.enqueueNavigation(async (positionOperationToken) => {
			this.clearSelections();
			const canonical = await this.parser.resolveCfiForPage(pageNumber);
			if (!canonical) {
				return;
			}
			await this.navigateViewWithFallback(
				canonical,
				this.getSectionHrefFallbackTarget(canonical),
				positionOperationToken
			);
			await this.syncCurrentPositionFromTarget(canonical, undefined, positionOperationToken);
		}, "goToPage");
	}

	getPageNumberFromCfi(cfi: string): Promise<number | undefined> {
		return this.parser.resolvePageNumber(cfi);
	}

	getVisibleFrames(): ReaderFrame[] {
		return this.getVisibleFramesWithIndex().map((item) => item.frame);
	}

	onFootnotePreview(callback: (info: ReaderFootnotePreviewInfo | null) => void): () => void {
		this.footnotePreviewCallbacks.add(callback);
		return () => {
			this.footnotePreviewCallbacks.delete(callback);
		};
	}

	onSelectionChange(callback: (event: ReaderSelectionChange) => void): () => void {
		this.selectionChangeCallbacks.add(callback);
		return () => {
			this.selectionChangeCallbacks.delete(callback);
		};
	}

	onHighlightClick(callback: (info: HighlightClickInfo) => void): () => void {
		this.highlightClickCallbacks.add(callback);
		return () => {
			this.highlightClickCallbacks.delete(callback);
		};
	}

	onReferenceBadgeClick(callback: (info: HighlightClickInfo) => void): () => void {
		this.referenceBadgeClickCallbacks.add(callback);
		return () => {
			this.referenceBadgeClickCallbacks.delete(callback);
		};
	}

	getHighlightClickInfo(
		cfiRange: string,
		interactionTarget: HighlightClickInfo["interactionTarget"] = "highlight",
		geometryOverride?: {
			rect: HighlightClickInfo["rect"];
			rects?: HighlightClickInfo["rects"];
			anchorPoint?: HighlightClickInfo["anchorPoint"];
		}
	): HighlightClickInfo | null {
		const highlight = this.getCurrentHighlightByCfi(cfiRange);
		if (!highlight) {
			return null;
		}
		const geometry = geometryOverride || this.getCurrentHighlightViewportGeometry(cfiRange);
		if (!geometry?.rect) {
			return null;
		}
		return buildHighlightClickInfo(highlight, geometry, interactionTarget);
	}

	getSelectionViewportGeometry(cfiRange: string): ReaderViewportGeometry | null {
		const geometry = this.getCurrentHighlightViewportGeometry(cfiRange);
		if (!geometry?.rect) {
			return null;
		}
		return {
			rect: geometry.rect,
			rects: geometry.rects,
			anchorPoint: createAnchorPointFromRect(geometry.rect),
		};
	}

	async refreshHighlights(): Promise<void> {
		this.invalidateParagraphPresentation();
		await this.queueAnnotationSync(true);
	}

	async applyHighlights(highlights: ReaderHighlight[]): Promise<void> {
		const deduped = new Map<string, ReaderHighlight>();
		this.highlightDataMap.clear();
		this.highlightAnchorResolutionByKey.clear();
		for (const highlight of highlights) {
			const normalizedHighlight = this.normalizeHighlightSources(highlight);
			const key = getReaderHighlightIdentityKey(normalizedHighlight);
			const existing = deduped.get(key);
			deduped.set(
				key,
				existing ? this.mergeHighlights(existing, normalizedHighlight) : normalizedHighlight
			);
		}
		this.savedHighlights = Array.from(deduped.values());
		for (const highlight of this.savedHighlights) {
			this.highlightDataMap.set(getReaderHighlightIdentityKey(highlight), highlight);
		}
		await this.refreshHighlights();
	}

	addHighlight(highlight: ReaderHighlight): void {
		void this.addResolvedHighlight(highlight);
	}

	addTemporaryHighlight(highlight: ReaderHighlightInput, durationMs = 2000): void {
		void this.addResolvedHighlight({ ...highlight, temporary: true }, durationMs);
	}

	temporarilyRevealConcealedText(cfiRange: string, durationMs = 3000): void {
		const highlight = this.findStoredHighlightByCfi(cfiRange, "conceal");
		if (!highlight) {
			return;
		}
		const key = getReaderHighlightIdentityKey(highlight);
		const existingTimer = this.temporarilyRevealedConcealmentTimers.get(key);
		if (existingTimer) {
			window.clearTimeout(existingTimer);
		}
		this.temporarilyRevealedConcealmentTimers.set(
			key,
			window.setTimeout(() => {
				this.temporarilyRevealedConcealmentTimers.delete(key);
				void this.refreshHighlights();
			}, Math.max(200, durationMs))
		);
		void this.refreshHighlights();
	}

	removeHighlight(cfiRange: string): void {
		const cfiKey = this.normalizeLocationKey(cfiRange);
		const keysToRemove = new Set<string>();
		for (const [key, highlight] of this.highlightDataMap.entries()) {
			if (this.normalizeLocationKey(highlight.cfiRange) === cfiKey) {
				keysToRemove.add(key);
			}
		}
		for (const [key, highlight] of this.temporaryHighlightDataMap.entries()) {
			if (this.normalizeLocationKey(highlight.cfiRange) === cfiKey) {
				keysToRemove.add(key);
			}
		}
		for (const key of keysToRemove) {
			this.removeStoredHighlightByKey(key);
		}
		this.savedHighlights = this.savedHighlights.filter(
			(item) => this.normalizeLocationKey(item.cfiRange) !== cfiKey
		);
		this.invalidateParagraphPresentation();
		void this.queueAnnotationSync(true);
	}

	removeHighlightByIdentityKey(identityKey: string): void {
		const key = String(identityKey || "").trim();
		if (!key) {
			return;
		}
		this.removeStoredHighlightByKey(key);
		this.savedHighlights = this.savedHighlights.filter(
			(item) => getReaderHighlightIdentityKey(item) !== key
		);
		this.invalidateParagraphPresentation();
		void this.queueAnnotationSync(true);
	}

	private removeStoredHighlightByKey(key: string): void {
		this.highlightDataMap.delete(key);
		this.temporaryHighlightDataMap.delete(key);
		this.highlightAnchorResolutionByKey.delete(key);
		const timer = this.temporaryHighlightTimers.get(key);
		if (timer) {
			window.clearTimeout(timer);
			this.temporaryHighlightTimers.delete(key);
		}
		const revealedTimer = this.temporarilyRevealedConcealmentTimers.get(key);
		if (revealedTimer) {
			window.clearTimeout(revealedTimer);
			this.temporarilyRevealedConcealmentTimers.delete(key);
		}
	}

	destroy(): void {
		void this.destroyAll();
	}

	private handleRelocateEvent = (event: Event): void => {
		if (event.currentTarget && event.currentTarget !== this.foliateView) {
			return;
		}
		const detail = (event as CustomEvent<{ cfi?: string; index?: number }>).detail;
		if (!detail) {
			return;
		}

		const shouldPreserveFootnotePreview = this.footnotePreviewController.shouldPreserveOnRelocate();
		if (!shouldPreserveFootnotePreview) {
			this.dismissFootnotePreview({ unpin: true });
		}

		const target =
			detail.cfi ||
			(typeof detail.index === "number" ? this.parser.getSectionHrefByIndex(detail.index) : "") ||
			this.currentPosition.cfi;
		if (!target) {
			return;
		}

		this.schedulePaginatedLayoutRecovery();
		const positionOperationToken = this.sessionGuard.startPositionOperation();
		void this.syncCurrentPositionFromTarget(target, undefined, positionOperationToken).finally(() => {
			this.scheduleAnnotationSyncAfterRelocate();
		});
	};

	private handleLoadEvent = (event: Event): void => {
		if (event.currentTarget && event.currentTarget !== this.foliateView) {
			return;
		}
		const detail = (event as CustomEvent<{ doc?: Document; index?: number }>).detail;
		const doc = detail?.doc;
		if (!doc) {
			return;
		}

		const index =
			typeof detail.index === "number" ? detail.index : this.currentPosition.chapterIndex || 0;
		this.loadedDocumentSectionIndexes.set(doc, index);
		this.maybeInvalidateParagraphCacheForSection(index, doc);
		this.normalizeDocument(doc);
		this.attachSelectionListeners(doc);
		this.attachHighlightClickListeners(doc);
		this.attachWheelListeners(doc);
		this.renderedAnnotations.clear();
		this.lastSyncedVisibleSectionKey = "";
		this.schedulePaginatedLayoutRecovery();
		void this.queueAnnotationSync(true);
	};

	private handleLinkEvent = (event: Event): void => {
		if (event.currentTarget && event.currentTarget !== this.foliateView) {
			return;
		}
		const detail = (event as CustomEvent<{ a?: HTMLAnchorElement; href?: string }>).detail;
		const anchor = detail?.a;
		if (!anchor) {
			return;
		}
		if (!this.isFootnoteReference(anchor)) {
			return;
		}
		if (this.currentFootnoteClickAction === "navigate") {
			this.dismissFootnotePreview({ unpin: true });
			return;
		}
		event.preventDefault();
		const href = anchor.getAttribute("href") || detail?.href || "";
		const text = String(anchor.textContent || "").trim();
		logFootnoteDiag(`Click reference intercepted href=${href} text=${text}`);
		this.emitFootnotePreviewForAnchor(anchor.ownerDocument, anchor, {
			pinned: true,
			suppressRelocateMs: 1800,
		});
	};

	private handleDrawAnnotationEvent = (event: Event): void => {
		if (event.currentTarget && event.currentTarget !== this.foliateView) {
			return;
		}
		const detail = (
			event as CustomEvent<{
				draw?: (
					draw: (rects: unknown[], options?: unknown) => SVGElement,
					options?: unknown
				) => void;
				annotation?: FoliateAnnotation;
			}>
		).detail;
		if (!detail?.annotation || typeof detail.draw !== "function") {
			return;
		}
		void this.drawAnnotation(detail.annotation, detail.draw);
	};

	private handleShowAnnotationEvent = (event: Event): void => {
		if (event.currentTarget && event.currentTarget !== this.foliateView) {
			return;
		}
		const detail = (
			event as CustomEvent<{
				value?: string;
				index?: number;
				range?: Range;
			}>
		).detail;
		const value = detail?.value;
		if (!value) {
			return;
		}

		const highlight = this.findHighlightForAnnotationValue(
			value,
			detail?.range || null,
			detail?.index
		);
		if (!highlight) {
			return;
		}

		const frame =
			this.getVisibleFramesWithIndex().find((item) => item.index === detail.index) ||
			this.getVisibleFramesWithIndex()[0];

		// Foliate may hit-test annotation overlays on the same pointer gesture that selects
		// text (common for TXT and cross-line ranges over excerpts). Prefer the selection
		// toolbar while a non-collapsed reader selection is active.
		if (this.hasActiveReaderSelection(frame?.frameDocument)) {
			return;
		}

		const containerRect = this.renderContainer?.getBoundingClientRect();
		let rect =
			frame && detail.range ? this.createViewportRect(frame, detail.range) : null;
		let rects =
			frame && detail.range
				? this.createViewportRectList(frame, detail.range) || undefined
				: undefined;

		if (!rect && frame?.frameDocument) {
			const geometry = this.getCurrentHighlightViewportGeometry(
				highlight.cfiRange,
				highlight.text
			);
			rect = geometry?.rect || null;
			rects = geometry?.rects;
		}

		if (!rect && frame?.frameDocument) {
			const resolvedRange = this.parser.resolveRangeInLoadedSection(
				highlight.cfiRange,
				frame.frameDocument,
				frame.index,
				highlight.text
			);
			if (resolvedRange) {
				rect = this.createViewportRect(frame, resolvedRange);
				rects = this.createViewportRectList(frame, resolvedRange) || undefined;
			}
		}

		if (!rect) {
			rect = {
				top: 0,
				left: 0,
				bottom: containerRect?.height || 0,
				right: containerRect?.width || 0,
				width: containerRect?.width || 0,
				height: containerRect?.height || 0,
			};
		}

		const info = buildHighlightClickInfo(
			highlight,
			{
				rect,
				rects,
			},
			"highlight"
		);
		this.notifyHighlightClick(info);
	};

	private async resolveNavigationRequest(
		options: ReaderNavigateOptions,
		positionOperationToken?: number
	): Promise<{ canonical: string | null }> {
		const rawCfi = String(options.cfi || "").trim();
		const rawHref = String(options.href || "").trim();
		const rawTarget = rawCfi || rawHref;
		if (!rawTarget) {
			return { canonical: null };
		}

		const resolved = await this.parser.resolveNavigationTarget(rawTarget, options.text);
		let canonical = resolved?.cfi || null;
		if (!resolved && !rawHref) {
			return { canonical: null };
		}

		const { viewTarget, fallbackTarget } = this.resolveSourceNavigationViewTargets(
			resolved,
			rawCfi,
			rawHref,
			canonical,
			rawTarget,
			options.text
		);
		this.clearSelections();
		await this.navigateViewWithFallback(viewTarget, fallbackTarget, positionOperationToken);
		if (resolved) {
			await this.waitForVisibleSectionIndex(resolved.index, positionOperationToken);
			if (
				this.sessionGuard.canApplyPositionOperation(this.foliateView, positionOperationToken)
			) {
				await this.scrollResolvedTargetIntoView(resolved, positionOperationToken);
				const rebuiltCanonical = await this.rebuildCanonicalFromResolvedTarget(
					resolved,
					options.text
				);
				if (rebuiltCanonical) {
					canonical = rebuiltCanonical;
				}
			}
		}
		await this.syncCurrentPositionFromTarget(
			canonical || rawTarget,
			options.text,
			positionOperationToken
		);
		return { canonical };
	}

	private usesGenericBookLoader(): boolean {
		return usesFoliateGenericBookLoader(this.parser.getLoadedFilePath());
	}

	private resolveSourceNavigationViewTargets(
		resolved: FoliateResolvedTarget | null,
		rawCfi: string,
		rawHref: string,
		canonical: string | null,
		rawTarget: string,
		text?: string
	): { viewTarget: string; fallbackTarget: string } {
		return resolveReaderSourceNavigationViewTargets({
			resolved,
			rawCfi,
			rawHref,
			canonical,
			rawTarget,
			text,
			usesGenericBookLoader: this.usesGenericBookLoader(),
			sectionEntryCfi: resolved ? this.parser.getSectionEntryCfi(resolved.index) : null,
			sectionHref: resolved
				? resolved.href || this.parser.getSectionHrefByIndex(resolved.index) || ""
				: null,
			fallbackTarget:
				rawHref
				|| resolved?.href
				|| this.getSectionHrefFallbackTarget(canonical || rawCfi || rawTarget),
		});
	}

	private async waitForVisibleSectionIndex(
		sectionIndex: number,
		positionOperationToken?: number,
		timeoutMs = 5000
	): Promise<boolean> {
		const startedAt = Date.now();
		while (Date.now() - startedAt < timeoutMs) {
			if (
				!this.sessionGuard.canApplyPositionOperation(this.foliateView, positionOperationToken)
			) {
				return false;
			}
			const visible = this.getVisibleFramesWithIndex().some((frame) => frame.index === sectionIndex);
			if (visible) {
				return true;
			}
			await this.waitForAnimationFrame();
		}
		return false;
	}

	private async rebuildCanonicalFromResolvedTarget(
		resolved: FoliateResolvedTarget,
		textHint?: string
	): Promise<string | null> {
		const frame = this.getVisibleFramesWithIndex().find((item) => item.index === resolved.index);
		if (!frame) {
			return null;
		}
		const liveRange = this.parser.resolveRangeInLoadedSection(
			resolved.cfi || "",
			frame.frameDocument,
			frame.index,
			textHint || resolved.textHint
		);
		if (!liveRange) {
			return null;
		}
		try {
			return this.parser.createCfiFromRange(frame.index, liveRange);
		} catch (error) {
			logger.debug("[FoliateReaderService] Failed to rebuild canonical CFI from live range:", error);
			return null;
		}
	}

	private enqueueNavigation<T>(
		operation: (positionOperationToken: number) => Promise<T>,
		label: string
	): Promise<T> {
		const positionOperationToken = this.sessionGuard.startPositionOperation();
		const run = () => operation(positionOperationToken);
		const underlyingTask = this.navigationTask.catch(() => undefined).then(run, run);
		this.navigationTask = underlyingTask.then(
			() => undefined,
			() => undefined
		);
		return this.withNavigationTimeout(underlyingTask, label);
	}

	private withNavigationTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			let settled = false;
			const timer = window.setTimeout(() => {
				if (settled) {
					return;
				}
				settled = true;
				this.sessionGuard.startPositionOperation();
				reject(new Error(`FoliateReaderService navigation timed out: ${label}`));
			}, FoliateReaderService.NAVIGATION_TIMEOUT_MS);

			operation.then(
				(value) => {
					if (settled) {
						return;
					}
					settled = true;
					window.clearTimeout(timer);
					resolve(value);
				},
				(error) => {
					if (settled) {
						return;
					}
					settled = true;
					window.clearTimeout(timer);
					reject(error instanceof Error ? error : new Error(String(error)));
				}
			);
		});
	}

	private async stabilizeViewAfterNavigation(
		target?: string,
		positionOperationToken?: number,
		viewSessionToken?: number,
		options?: { retarget?: boolean }
	): Promise<void> {
		const renderer = this.foliateView?.renderer as FoliateRenderer | undefined;
		if (!renderer) {
			return;
		}

		if (typeof renderer.render === "function") {
			renderer.render();
		}
		await this.waitForAnimationFrame();
		if (
			!this.sessionGuard.canApplyPositionOperation(
				this.foliateView,
				positionOperationToken,
				viewSessionToken
			)
		) {
			return;
		}

		const normalizedTarget = String(target || "").trim();
		const shouldRetarget =
			options?.retarget ??
			(Boolean(normalizedTarget) &&
				this.currentFlowMode === "paginated" &&
				(!this.isCfiLikeTarget(normalizedTarget) ||
					this.isSectionBaseCfiTarget(normalizedTarget)));
		if (shouldRetarget && normalizedTarget && this.foliateView) {
			await this.foliateView.goTo(normalizedTarget);
			await this.waitForAnimationFrame();
			if (
				!this.sessionGuard.canApplyPositionOperation(
					this.foliateView,
					positionOperationToken,
					viewSessionToken
				)
			) {
				return;
			}
		}

		if (typeof renderer.render === "function") {
			renderer.render();
		}
		this.schedulePaginatedLayoutRecovery();
	}

	private async waitForAnimationFrame(): Promise<void> {
		await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
	}

	private clearSelections(): void {
		const docs = new Set<Document>([activeDocument]);
		for (const frame of this.getVisibleFramesWithIndex()) {
			docs.add(frame.frameDocument);
		}
		for (const doc of docs) {
			try {
				doc.getSelection?.()?.removeAllRanges();
			} catch {
				/* ignore */
			}
			try {
				doc.defaultView?.getSelection?.()?.removeAllRanges();
			} catch {
				/* ignore */
			}
		}
	}

	private getElementFromEventTarget(target: EventTarget | null): Element | null {
		const node = target as Node | null;
		if (!node || typeof node.nodeType !== "number") {
			return null;
		}
		if (domInstanceOf(node, Element)) {
			return node;
		}
		if (domInstanceOf(node, Text)) {
			return node.parentElement;
		}
		return null;
	}

	private bridgeHostSelectionMouseUp(doc: Document, event: MouseEvent): void {
		const payload = this.createBridgedHostSelectionPayload(doc);
		const dispatchHostMouseUp = () => {
			activeDocument.dispatchEvent(
				new MouseEvent("mouseup", {
					bubbles: event.bubbles,
					cancelable: event.cancelable,
					composed: true,
					button: event.button,
					buttons: event.buttons,
					clientX: event.clientX,
					clientY: event.clientY,
					ctrlKey: event.ctrlKey,
					shiftKey: event.shiftKey,
					altKey: event.altKey,
					metaKey: event.metaKey,
				})
			);
		};
		if (!payload) {
			dispatchHostMouseUp();
			return;
		}
		const bridgedSelection = this.createBridgedHostSelection(payload);
		const windowSelectionDescriptor = Object.getOwnPropertyDescriptor(window, "getSelection");
		const documentSelectionDescriptor = Object.getOwnPropertyDescriptor(activeDocument, "getSelection");
		Object.defineProperty(window, "getSelection", {
			configurable: true,
			value: () => bridgedSelection,
		});
		Object.defineProperty(activeDocument, "getSelection", {
			configurable: true,
			value: () => bridgedSelection,
		});
		try {
			dispatchHostMouseUp();
		} finally {
			if (windowSelectionDescriptor) {
				Object.defineProperty(window, "getSelection", windowSelectionDescriptor);
			} else {
				Reflect.deleteProperty(window as unknown as Record<string, unknown>, "getSelection");
			}
			if (documentSelectionDescriptor) {
				Object.defineProperty(activeDocument, "getSelection", documentSelectionDescriptor);
			} else {
				Reflect.deleteProperty(activeDocument as unknown as Record<string, unknown>, "getSelection");
			}
		}
	}

	private createBridgedHostSelectionPayload(doc: Document): BridgedHostSelectionPayload | null {
		const sourceSelection = doc.defaultView?.getSelection?.();
		if (!sourceSelection || sourceSelection.isCollapsed || sourceSelection.rangeCount === 0) {
			return null;
		}
		const text = sourceSelection.toString().trim();
		if (!text) {
			return null;
		}
		const sourceRange = sourceSelection.getRangeAt(0);
		const frame = this.getVisibleFramesWithIndex().find((item) => item.frameDocument === doc);
		const primaryRect = frame
			? this.createViewportRect(frame, sourceRange)
			: this.createViewportRectFromRange(doc, sourceRange);
		if (!primaryRect) {
			return null;
		}
		const rects = frame
			? this.createViewportRectList(frame, sourceRange) || [primaryRect]
			: [primaryRect];
		return {
			text,
			sourceSelection,
			sourceRange,
			primaryRect,
			rects,
		};
	}

	private createBridgedHostSelection(payload: BridgedHostSelectionPayload): Selection {
		const bridgedRange = {
			...payload.sourceRange,
			getBoundingClientRect: () =>
				new DOMRect(
					payload.primaryRect.left,
					payload.primaryRect.top,
					payload.primaryRect.width,
					payload.primaryRect.height
				),
			getClientRects: () => {
				const rects = (payload.rects.length ? payload.rects : [payload.primaryRect]).map(
					(rect) => new DOMRect(rect.left, rect.top, rect.width, rect.height)
				);
				return {
					length: rects.length,
					item: (index: number) => rects[index] || null,
					[Symbol.iterator]: function* iterator() {
						yield* rects;
					},
				} as unknown as DOMRectList;
			},
		} as Range;
		return {
			...payload.sourceSelection,
			rangeCount: 1,
			isCollapsed: false,
			toString: () => payload.text,
			getRangeAt: () => bridgedRange,
		} as Selection;
	}

	private createViewportRect(
		frame: { frameElement?: HTMLElement | null },
		range: Range
	): HighlightClickInfo["rect"] | null {
		const rawRect = extractRangeBoundingRect(range);
		if (!rawRect) {
			return null;
		}
		return this.mapRawRectToViewport(frame.frameElement, rawRect);
	}

	private createViewportRectList(
		frame: { frameElement?: HTMLElement | null },
		range: Range
	): HighlightClickInfo["rect"][] | null {
		const rects = extractRangeClientRects(range)
			.map((rect) => this.mapRawRectToViewport(frame.frameElement, rect))
			.filter((rect): rect is HighlightClickInfo["rect"] => Boolean(rect));
		return rects.length ? rects : null;
	}

	private createViewportRectFromRange(
		doc: Document,
		range: Range
	): ReaderFootnotePreviewInfo["rect"] | null {
		const frame = this.getVisibleFramesWithIndex().find((item) => item.frameDocument === doc);
		if (frame) {
			return this.createViewportRect(frame, range);
		}
		const rawRect = extractRangeBoundingRect(range);
		return rawRect ? createViewportRectFromRawRect(rawRect) : null;
	}

	private createViewportRectFromElement(
		doc: Document,
		element: Element
	): ReaderFootnotePreviewInfo["rect"] | null {
		try {
			const range = doc.createRange();
			range.selectNodeContents(element);
			const rect = this.createViewportRectFromRange(doc, range);
			if (rect) {
				return rect;
			}
		} catch {
			/* ignore */
		}

		const fallbackRect = createElementViewportRect(element);
		if (!fallbackRect) {
			return null;
		}
		const frame = this.getVisibleFramesWithIndex().find((item) => item.frameDocument === doc);
		if (!frame?.frameElement) {
			return fallbackRect;
		}
		return this.mapRawRectToViewport(frame.frameElement, {
			left: fallbackRect.left,
			top: fallbackRect.top,
			width: fallbackRect.width,
			height: fallbackRect.height,
		});
	}

	private mapRawRectToViewport(
		frameElement: HTMLElement | null | undefined,
		rawRect: {
			left: number;
			top: number;
			width: number;
			height: number;
		}
	): HighlightClickInfo["rect"] | null {
		return mapRawRectToViewport(frameElement, rawRect);
	}

	private isFootnoteReference(anchor: HTMLAnchorElement): boolean {
		return this.footnotePreviewResolver.isFootnoteReference(anchor);
	}

	private findFootnoteReference(target: EventTarget | null): HTMLAnchorElement | null {
		const originElement = this.getElementFromEventTarget(target);
		const anchor =
			domInstanceOf(originElement, HTMLAnchorElement)
				? originElement
				: (originElement?.closest?.("a[href]") as HTMLAnchorElement | null);
		if (!anchor) {
			return null;
		}
		return this.isFootnoteReference(anchor) ? anchor : null;
	}

	private findFootnoteReferenceFromEvent(event: Event): HTMLAnchorElement | null {
		const composedPath = typeof event.composedPath === "function" ? event.composedPath() : [];
		for (const target of composedPath) {
			const anchor = this.findFootnoteReference(target as EventTarget | null);
			if (anchor) {
				return anchor;
			}
		}
		return this.findFootnoteReference(event.target);
	}

	private buildPendingFootnotePreviewInfo(
		doc: Document,
		anchor: HTMLAnchorElement,
		rectOverride?: ReaderFootnotePreviewInfo["rect"]
	): ReaderFootnotePreviewInfo | null {
		return this.footnotePreviewResolver.buildPendingPreviewInfo(doc, anchor, rectOverride);
	}

	private buildStatusFootnotePreviewInfo(
		doc: Document,
		anchor: HTMLAnchorElement,
		text: string,
		rectOverride?: ReaderFootnotePreviewInfo["rect"]
	): ReaderFootnotePreviewInfo | null {
		return this.footnotePreviewResolver.buildStatusPreviewInfo(doc, anchor, text, rectOverride);
	}

	private buildFootnotePreviewInfo(
		doc: Document,
		anchor: HTMLAnchorElement,
		rectOverride?: ReaderFootnotePreviewInfo["rect"]
	): Promise<ReaderFootnotePreviewInfo | null> {
		return this.footnotePreviewResolver.buildPreviewInfo(doc, anchor, rectOverride);
	}

	private notifyFootnotePreview(info: ReaderFootnotePreviewInfo | null): void {
		for (const callback of this.footnotePreviewCallbacks) {
			try {
				callback(info);
			} catch (error) {
				logger.warn("[FoliateReaderService] Footnote preview listener failed:", error);
			}
		}
	}

	private emitFootnotePreviewForAnchor(
		doc: Document,
		anchor: HTMLAnchorElement,
		options?: {
			pinned?: boolean;
			suppressRelocateMs?: number;
			rectOverride?: ReaderFootnotePreviewInfo["rect"];
		}
	): void {
		this.footnotePreviewController.emitForAnchor(doc, anchor, options);
	}

	private dismissFootnotePreview(options?: { unpin?: boolean }): void {
		this.footnotePreviewController.dismiss(options);
	}

	dismissParagraphFootnotePreview(options?: { unpin?: boolean }): void {
		this.paragraphFootnotePreviewSession += 1;
		this.dismissFootnotePreview(options);
	}

	private normalizeDocument(doc: Document): void {
		const mountPoint = doc.head || doc.documentElement;
		if (!mountPoint) {
			return;
		}
		const colorScheme = this.getCurrentColorScheme();
		doc.documentElement.setAttribute("data-weave-host-scheme", colorScheme);
		this.sanitizeRuntimeAuthorColorOverrides(doc);

		const background = this.getObsidianCSSVar("--background-primary", "rgb(255, 255, 255)");
		const textColor = this.getObsidianCSSVar("--text-normal", "rgb(28, 29, 31)");

		let styleElement = this.documentStyleElements.get(doc);
		if (!styleElement || !styleElement.isConnected) {
			styleElement = doc.createElement("style");
			styleElement.setAttribute("data-weave-foliate-reader-style", "true");
			mountPoint.appendChild(styleElement);
			this.documentStyleElements.set(doc, styleElement);
		}
		styleElement.textContent = `${this.buildReaderStyles()}\n${buildReaderHostSurfaceCss(
			background,
			textColor,
			colorScheme
		)}`;
		mountPoint.appendChild(styleElement);

		this.attachFootnotePreviewListeners(doc);
	}

	private sanitizeRuntimeAuthorColorOverrides(doc: Document): void {
		sanitizeLegacyAuthorColorAttributes(doc);
		for (const element of Array.from(doc.querySelectorAll("[style]"))) {
			const style = element.getAttribute("style");
			if (!style) {
				continue;
			}
			const sanitized = stripInlineAuthorColorStyles(style);
			if (sanitized) {
				element.setAttribute("style", sanitized);
			} else {
				element.removeAttribute("style");
			}
		}
	}

	private async navigateViewWithFallback(
		primaryTarget?: string,
		fallbackTarget?: string,
		positionOperationToken?: number,
		viewSessionToken?: number
	): Promise<void> {
		const normalizedPrimaryTarget = String(primaryTarget || "").trim();
		const normalizedFallbackTarget = String(fallbackTarget || "").trim();
		if (
			!this.foliateView ||
			!this.sessionGuard.canApplyPositionOperation(
				this.foliateView,
				positionOperationToken,
				viewSessionToken
			) ||
			(!normalizedPrimaryTarget && !normalizedFallbackTarget)
		) {
			return;
		}

		const preferredSafeTarget = this.getPreferredSafeNavigationTarget(
			normalizedPrimaryTarget,
			normalizedFallbackTarget
		);
		if (preferredSafeTarget) {
			await this.goToAndStabilize(preferredSafeTarget, positionOperationToken, viewSessionToken);
			return;
		}

		if (normalizedPrimaryTarget) {
			try {
				await this.goToAndStabilize(
					normalizedPrimaryTarget,
					positionOperationToken,
					viewSessionToken
				);
				return;
			} catch (error) {
				if (
					!normalizedFallbackTarget ||
					normalizedFallbackTarget === normalizedPrimaryTarget ||
					!this.shouldFallbackFromNavigationError(normalizedPrimaryTarget, error)
				) {
					throw error;
				}
				logger.warn(
					"[FoliateReaderService] EPUB navigation target failed, falling back to section href:",
					{
						primaryTarget: normalizedPrimaryTarget,
						fallbackTarget: normalizedFallbackTarget,
						error,
					}
				);
			}
		}

		await this.goToAndStabilize(
			normalizedFallbackTarget,
			positionOperationToken,
			viewSessionToken
		);
	}

	private async goToAndStabilize(
		target: string,
		positionOperationToken?: number,
		viewSessionToken?: number
	): Promise<void> {
		if (
			!this.foliateView ||
			!this.sessionGuard.canApplyPositionOperation(
				this.foliateView,
				positionOperationToken,
				viewSessionToken
			)
		) {
			return;
		}
		const view = this.foliateView;
		await view.goTo(target);
		if (
			!this.sessionGuard.canApplyPositionOperation(
				this.foliateView,
				positionOperationToken,
				viewSessionToken,
				view
			)
		) {
			return;
		}
		const normalizedTarget = String(target || "").trim();
		await this.stabilizeViewAfterNavigation(
			normalizedTarget,
			positionOperationToken,
			viewSessionToken,
			{
				retarget:
					this.layoutChangeInFlight ||
					!normalizedTarget ||
					!this.isCfiLikeTarget(normalizedTarget) ||
					this.isSectionBaseCfiTarget(normalizedTarget),
			}
		);
	}

	private async tryApplyLightweightLocationUpdate(
		canonical: string,
		positionOperationToken?: number
	): Promise<boolean> {
		if (
			!this.foliateView ||
			!this.sessionGuard.canApplyPositionOperation(this.foliateView, positionOperationToken)
		) {
			return false;
		}

		const chapterIndex = this.parser.getSectionIndexForCfi(canonical);
		if (chapterIndex === null || chapterIndex !== this.getCurrentChapterIndex()) {
			return false;
		}

		const visibleFrame = this.getVisibleFramesWithIndex().find(
			(item) => item.index === chapterIndex
		);
		if (!visibleFrame) {
			return false;
		}

		const range = this.parser.resolveRangeInLoadedSection(
			canonical,
			visibleFrame.frameDocument,
			chapterIndex
		);
		if (!range) {
			return false;
		}

		if (this.currentFlowMode === "paginated") {
			const targetPage = await this.parser.resolvePageNumber(canonical);
			const currentPage = this.normalizeCurrentPage(this.parser.getTotalPositions());
			if (targetPage && currentPage && targetPage !== currentPage) {
				return false;
			}
		}

		await this.syncCurrentPositionFromTarget(canonical, undefined, positionOperationToken);
		return this.sessionGuard.canApplyPositionOperation(
			this.foliateView,
			positionOperationToken
		);
	}

	private async scrollResolvedTargetIntoView(
		resolved: FoliateResolvedTarget,
		positionOperationToken?: number
	): Promise<void> {
		if (
			!resolved.range ||
			!this.sessionGuard.canApplyPositionOperation(this.foliateView, positionOperationToken)
		) {
			return;
		}

		await this.waitForAnimationFrame();
		if (
			!this.sessionGuard.canApplyPositionOperation(this.foliateView, positionOperationToken)
		) {
			return;
		}

		const frames = this.getVisibleFramesWithIndex();
		const frame =
			frames.find((item) => item.index === resolved.index) ||
			frames.find((item) => item.frameDocument === resolved.doc) ||
			null;
		if (!frame) {
			return;
		}

		const targetCfi = String(resolved.cfi || "").trim();
		const liveRange =
			(targetCfi
				? this.parser.resolveRangeInLoadedSection(
						targetCfi,
						frame.frameDocument,
						frame.index,
						resolved.textHint
					)
				: null) || resolved.range;
		if (!liveRange) {
			return;
		}

		const rect = this.createViewportRect(frame, liveRange);
		if (!rect) {
			this.scrollRangeIntoDocument(liveRange);
			return;
		}

		const container = this.renderContainer;
		if (!container) {
			this.scrollRangeIntoDocument(liveRange);
			return;
		}

		const containerRect = container.getBoundingClientRect();
		const targetTop = rect.top - containerRect.top + container.scrollTop;
		const targetLeft = rect.left - containerRect.left + container.scrollLeft;
		const nextTop = Math.max(
			0,
			targetTop - Math.max(0, (container.clientHeight - rect.height) / 2)
		);
		container.scrollTo({
			top: nextTop,
			left: targetLeft,
			behavior: "smooth",
		});
	}

	private scrollRangeIntoDocument(range: Range): void {
		try {
			const node = range.startContainer;
			const element = domInstanceOf(node, Element) ? node : node.parentElement;
			element?.scrollIntoView?.({ block: "center", behavior: "smooth" });
		} catch (error) {
			logger.debug("[FoliateReaderService] Failed to scroll resolved range into view:", error);
		}
	}

	private getSectionHrefFallbackTarget(...candidates: Array<string | null | undefined>): string {
		for (const candidate of candidates) {
			const normalized = String(candidate || "").trim();
			if (!normalized) {
				continue;
			}
			if (!this.isCfiLikeTarget(normalized)) {
				return normalized;
			}
			const href = this.parser.getSectionHrefForCfi(normalized);
			if (href) {
				return href;
			}
			const sectionBaseIndex = this.getSectionIndexFromSectionBaseCfi(normalized);
			if (typeof sectionBaseIndex === "number") {
				const sectionHref = this.parser.getSectionHrefByIndex(sectionBaseIndex);
				if (sectionHref) {
					return sectionHref;
				}
			}
		}
		return (
			this.currentChapterHref ||
			this.parser.getSectionHrefByIndex(this.currentPosition.chapterIndex || 0)
		);
	}

	/** Map spine-only EPUB CFIs such as `epubcfi(/6/14)` to a section index. */
	private getSectionIndexFromSectionBaseCfi(target: string): number | null {
		if (!this.isSectionBaseCfiTarget(target)) {
			return null;
		}
		const wrapped = target.startsWith("epubcfi(") ? target : `epubcfi(${target})`;
		const match = /^epubcfi\(\/6\/(\d+)\)$/.exec(wrapped);
		if (!match) {
			return null;
		}
		const spinePart = Number(match[1]);
		if (!Number.isFinite(spinePart) || spinePart < 2) {
			return null;
		}
		return Math.max(0, Math.floor(spinePart / 2) - 1);
	}

	private shouldFallbackFromNavigationError(target: string, error: unknown): boolean {
		if (!this.isCfiLikeTarget(target)) {
			return false;
		}
		const normalizedMessage = String(
			(error as { message?: string } | null)?.message || ""
		).toLowerCase();
		return (
			normalizedMessage.includes("invalid epub cfi target") ||
			normalizedMessage.includes("childnodes") ||
			normalizedMessage.includes("reading 'length'") ||
			normalizedMessage.includes('reading "length"') ||
			normalizedMessage.includes("epubcfi") ||
			normalizedMessage.includes(" cfi")
		);
	}

	private getPreferredSafeNavigationTarget(
		primaryTarget: string,
		fallbackTarget: string
	): string | null {
		if (!primaryTarget || !this.isSectionBaseCfiTarget(primaryTarget)) {
			return null;
		}
		const preferredTarget = this.getSectionHrefFallbackTarget(primaryTarget, fallbackTarget);
		if (
			!preferredTarget ||
			preferredTarget === primaryTarget ||
			this.isCfiLikeTarget(preferredTarget)
		) {
			return null;
		}
		return preferredTarget;
	}

	private isCfiLikeTarget(target: string): boolean {
		const normalized = String(target || "").trim();
		return normalized.startsWith("epubcfi(") || /^\/\d+/.test(normalized);
	}

	private isSectionBaseCfiTarget(target: string): boolean {
		const normalized = String(target || "").trim();
		if (!this.isCfiLikeTarget(normalized)) {
			return false;
		}
		const wrapped = normalized.startsWith("epubcfi(") ? normalized : `epubcfi(${normalized})`;
		return wrapped.startsWith("epubcfi(/6/") && !wrapped.includes("!");
	}

	private async syncCurrentPositionFromTarget(
		target: string,
		textHint?: string,
		positionOperationToken?: number
	): Promise<void> {
		const resolved = await this.parser.resolveNavigationTarget(target, textHint);
		if (
			!resolved ||
			!this.sessionGuard.canApplyPositionOperation(this.foliateView, positionOperationToken)
		) {
			return;
		}

		const totalPages = this.parser.getTotalPositions();
		const currentPage = resolved.cfi
			? this.parser.resolvePageNumberForResolvedTarget(resolved) || (totalPages > 0 ? 1 : 0)
			: totalPages > 0
			? 1
			: 0;

		let percent = 0;
		if (totalPages > 1 && currentPage > 0) {
			percent = this.clamp(((currentPage - 1) / (totalPages - 1)) * 100, 0, 100);
		} else if (resolved.doc && resolved.range) {
			const sectionProgress = this.computeSectionProgression(resolved.doc, resolved.range);
			const chapterCount = Math.max(this.parser.getMetadata().chapterCount, 1);
			percent = this.clamp(((resolved.index + sectionProgress) / chapterCount) * 100, 0, 100);
		}

		this.currentChapterTitle = this.parser.getSectionTitleByIndex(resolved.index);
		this.currentChapterHref = resolved.href;
		this.currentPosition = {
			chapterIndex: resolved.index,
			cfi: resolved.cfi || this.currentPosition.cfi,
			percent,
		};
		this.currentPaginationInfo = {
			currentPage,
			totalPages,
		};
		if (this.currentBook) {
			this.currentBook.currentPosition = { ...this.currentPosition };
		}

		const sectionProgression =
			resolved.doc && resolved.range
				? this.computeSectionProgression(resolved.doc, resolved.range)
				: 0;
		this.recordReadingPaceOnRelocate(currentPage, resolved.index, sectionProgression);

		for (const callback of this.relocatedCallbacks) {
			try {
				callback(this.currentPosition);
			} catch (error) {
				logger.warn("[FoliateReaderService] Relocate listener failed:", error);
			}
		}
		this.publishScrolledChapterEndStateIfChanged();
	}

	private computeSectionProgression(doc: Document, range: Range): number {
		const root = doc.body || doc.documentElement;
		const text = root?.textContent?.replace(/\s+/g, " ").trim() || "";
		if (!text) {
			return 0;
		}
		const probe = doc.createRange();
		probe.selectNodeContents(root);
		probe.setEnd(range.startContainer, range.startOffset);
		return this.clamp(probe.toString().length / Math.max(text.length, 1), 0, 1);
	}

	private getFoliateVisibleContents(): Array<{ index?: number; doc?: Document | null }> {
		const rendererContents = (
			this.foliateView?.renderer as FoliateRenderer | undefined
		)?.getContents?.();
		if (Array.isArray(rendererContents)) {
			return rendererContents;
		}

		// Backward-compat fallback for older foliate runtimes that exposed getContents() on the view.
		const legacyView = this.foliateView as
			| (FoliateViewElement & {
					getContents?: () => Array<{ index?: number; doc?: Document | null }>;
			  })
			| null;
		const legacyContents = legacyView?.getContents?.();
		return Array.isArray(legacyContents) ? legacyContents : [];
	}

	private getVisibleFramesWithIndex(): VisibleFrameWithIndex[] {
		const contents = this.getFoliateVisibleContents();
		const visibleFrames: VisibleFrameWithIndex[] = [];

		for (const item of contents) {
			const doc = item.doc;
			if (!doc?.defaultView) {
				continue;
			}

			const index =
				typeof item.index === "number"
					? item.index
					: this.loadedDocumentSectionIndexes.get(doc) ?? this.currentPosition.chapterIndex;
			const frame = this.createReaderFrame(doc, index);
			visibleFrames.push({
				index,
				href: this.parser.getSectionHrefByIndex(index),
				frameDocument: doc,
				frameElement: (doc.defaultView.frameElement as HTMLElement | null) || null,
				frame,
			});
		}

		return visibleFrames;
	}

	private createReaderFrame(doc: Document, index: number): ReaderFrame {
		return {
			frameDocument: doc,
			window: doc.defaultView as Window,
			cfiFromRange: (range: Range) => {
				try {
					return this.parser.createCfiFromRange(index, range);
				} catch (error) {
					logger.warn("[FoliateReaderService] Failed to build CFI from range:", {
						index,
						error,
					});
					return null;
				}
			},
		};
	}

	private async toReaderParagraph(
		paragraph: ReaderParagraphRecord,
		options?: { includeHtml?: boolean }
	): Promise<ReaderParagraph> {
		return {
			id: paragraph.id,
			chapterIndex: paragraph.chapterIndex,
			chapterTitle: paragraph.chapterTitle,
			chapterHref: paragraph.chapterHref,
			text: paragraph.text,
			html: options?.includeHtml ? await this.ensureParagraphHtml(paragraph) : undefined,
			htmlRevision: options?.includeHtml ? paragraph.htmlRevision : undefined,
			cfiRange: paragraph.cfiRange,
		};
	}

	private async getParagraphRecordsForChapter(
		chapterIndex: number
	): Promise<ReaderParagraphRecord[]> {
		if (!Number.isInteger(chapterIndex) || chapterIndex < 0) {
			return [];
		}
		const cached = this.paragraphCache.get(chapterIndex);
		if (cached) {
			return cached;
		}

		const source = await this.resolveParagraphExtractionSource(chapterIndex);
		const title = this.parser.getSectionTitleByIndex(source?.chapterIndex ?? chapterIndex);
		const paragraphs = source
			? this.extractParagraphRecordsFromDocument(
					source.doc,
					source.chapterIndex,
					source.chapterHref,
					title
				)
			: [];
		for (const paragraph of paragraphs) {
			this.paragraphRecordById.set(paragraph.id, paragraph);
		}
		if (
			this.getNonBoilerplateParagraphRecordsTextLength(paragraphs) > 0 ||
			paragraphs.length === 0
		) {
			this.paragraphCache.set(chapterIndex, paragraphs);
		}
		return paragraphs;
	}

	private async getMergedParagraphRecordsForReadingContext(
		anchorChapterIndex: number
	): Promise<ReaderParagraphRecord[]> {
		const visibleIndexes = [
			...new Set(
				this.getVisibleFramesWithIndex()
					.map((frame) => frame.index)
					.filter((index) => Number.isInteger(index) && index >= 0)
			),
		].sort((left, right) => left - right);

		if (visibleIndexes.length <= 1) {
			return this.getParagraphRecordsForChapter(anchorChapterIndex);
		}

		const merged: ReaderParagraphRecord[] = [];
		for (const index of visibleIndexes) {
			merged.push(...(await this.getParagraphRecordsForChapter(index)));
		}
		if (this.getNonBoilerplateParagraphRecordsTextLength(merged) > 0) {
			return merged;
		}
		return this.getParagraphRecordsForChapter(anchorChapterIndex);
	}

	private async resolveParagraphExtractionSource(
		chapterIndex: number
	): Promise<ParagraphExtractionSource | null> {
		const defaultHref = this.parser.getSectionHrefByIndex(chapterIndex);
		const candidates: Array<{
			doc: Document;
			chapterIndex: number;
			chapterHref: string;
			nonBoilerplateLength: number;
			readableLength: number;
			explicitParagraphCount: number;
			sourcePriority: number;
		}> = [];

		const pushCandidate = (
			doc: Document | null | undefined,
			sourceChapterIndex: number,
			sourceHref: string,
			sourceKind: ParagraphExtractionCandidateSource
		) => {
			if (!doc?.body) {
				return;
			}
			const root = doc.body;
			candidates.push({
				doc,
				chapterIndex: sourceChapterIndex,
				chapterHref: sourceHref,
				readableLength: this.getParagraphReadableBodyTextLength(root),
				nonBoilerplateLength: this.getNonBoilerplateReadableBodyTextLength(root),
				explicitParagraphCount: this.countMeaningfulExplicitParagraphElements(root),
				sourcePriority: PARAGRAPH_EXTRACTION_SOURCE_PRIORITY[sourceKind],
			});
		};

		const visibleFrame = this.getVisibleFramesWithIndex().find(
			(frame) => frame.index === chapterIndex
		);
		pushCandidate(visibleFrame?.frameDocument, chapterIndex, defaultHref, "visible");

		const processed = await this.parser.getProcessedDocumentByIndex(chapterIndex);
		pushCandidate(processed, chapterIndex, defaultHref, "processed");

		const raw = await this.parser.getRawDocumentByIndex(chapterIndex);
		pushCandidate(raw, chapterIndex, defaultHref, "raw");

		if (raw) {
			for (const embedded of await this.loadEmbeddedParagraphSources(raw, chapterIndex, defaultHref)) {
				pushCandidate(embedded.doc, embedded.chapterIndex, embedded.chapterHref, "embedded");
			}
		}

		if (candidates.length === 0) {
			return null;
		}

		candidates.sort((left, right) => {
			const lengthBaseline = Math.max(
				left.nonBoilerplateLength,
				right.nonBoilerplateLength,
				1
			);
			const lengthGap = Math.abs(right.nonBoilerplateLength - left.nonBoilerplateLength);
			if (lengthGap / lengthBaseline > 0.08) {
				return right.nonBoilerplateLength - left.nonBoilerplateLength;
			}
			if (right.explicitParagraphCount !== left.explicitParagraphCount) {
				return right.explicitParagraphCount - left.explicitParagraphCount;
			}
			if (right.sourcePriority !== left.sourcePriority) {
				return right.sourcePriority - left.sourcePriority;
			}
			return right.readableLength - left.readableLength;
		});

		const best = candidates[0];
		return {
			doc: best.doc,
			chapterIndex: best.chapterIndex,
			chapterHref: best.chapterHref,
		};
	}

	private async loadEmbeddedParagraphSources(
		doc: Document,
		fallbackChapterIndex: number,
		chapterHref: string
	): Promise<ParagraphExtractionSource[]> {
		const sources: ParagraphExtractionSource[] = [];
		const seenHrefs = new Set<string>();
		const elements = Array.from(
			doc.querySelectorAll("iframe[src], object[data], embed[src]")
		);
		for (const element of elements) {
			const rawHref = String(
				element.getAttribute("src") || element.getAttribute("data") || ""
			).trim();
			if (!rawHref || /^(?:https?:|data:|blob:|javascript:)/i.test(rawHref)) {
				continue;
			}
			const resolvedHref = this.parser.resolveHrefAgainst(chapterHref, rawHref);
			const normalizedHref = resolvedHref.split("#")[0]?.split("?")[0] || "";
			if (!normalizedHref || seenHrefs.has(normalizedHref)) {
				continue;
			}
			seenHrefs.add(normalizedHref);
			const embeddedIndex = this.parser.getSectionIndexForHref(normalizedHref);
			const embeddedChapterIndex =
				embeddedIndex >= 0 ? embeddedIndex : fallbackChapterIndex;
			const loaders = [
				this.parser.getProcessedDocumentByHref(normalizedHref),
				this.parser.getRawDocumentByHref(normalizedHref),
			];
			for (const loader of loaders) {
				const embeddedDoc = await loader;
				if (embeddedDoc?.body) {
					sources.push({
						doc: embeddedDoc,
						chapterIndex: embeddedChapterIndex,
						chapterHref: normalizedHref,
					});
					break;
				}
			}
		}
		return sources;
	}

	private getNonBoilerplateReadableBodyTextLength(root: Element): number {
		let boilerplateLength = 0;
		for (const element of Array.from(
			root.querySelectorAll<HTMLElement>("div, section, article, p, span, footer, aside")
		)) {
			const text = element.textContent?.replace(/\s+/g, " ").trim() || "";
			if (text.length < 16 || !this.isParagraphBoilerplate(text)) {
				continue;
			}
			if (element.querySelector("div, section, article, p")) {
				continue;
			}
			boilerplateLength += text.length;
		}
		return Math.max(0, this.getParagraphReadableBodyTextLength(root) - boilerplateLength);
	}

	private maybeInvalidateParagraphCacheForSection(chapterIndex: number, liveDoc: Document): void {
		const cached = this.paragraphCache.get(chapterIndex);
		if (!cached?.length) {
			return;
		}
		const root = liveDoc.body || liveDoc.documentElement;
		if (root && this.isUnderSegmentedParagraphExtraction(cached, root)) {
			this.dropParagraphCacheForChapter(chapterIndex);
			return;
		}
		const cachedLength = this.getNonBoilerplateParagraphRecordsTextLength(cached);
		const liveLength = root ? this.getNonBoilerplateReadableBodyTextLength(root) : 0;
		const liveExplicitCount = root ? this.countMeaningfulExplicitParagraphElements(root) : 0;
		const cachedNonBoilerplateCount = cached.filter(
			(record) => !this.isParagraphBoilerplate(record.text)
		).length;
		if (
			liveExplicitCount >= 2 &&
			cachedNonBoilerplateCount < Math.min(liveExplicitCount, Math.max(2, Math.ceil(liveExplicitCount * 0.55)))
		) {
			this.dropParagraphCacheForChapter(chapterIndex);
			return;
		}
		if (liveLength > cachedLength + 80) {
			this.dropParagraphCacheForChapter(chapterIndex);
		}
	}

	private dropParagraphCacheForChapter(chapterIndex: number): void {
		const cached = this.paragraphCache.get(chapterIndex);
		if (cached) {
			for (const record of cached) {
				this.paragraphRecordById.delete(record.id);
			}
		}
		this.paragraphCache.delete(chapterIndex);
	}

	private extractParagraphRecordsFromDocument(
		doc: Document,
		chapterIndex: number,
		chapterHref: string,
		chapterTitle: string
	): ReaderParagraphRecord[] {
		const root = doc.body || doc.documentElement;
		if (!root) {
			return [];
		}

		const primary = this.buildParagraphRecordsForElements(
			doc,
			root,
			this.collectParagraphCandidateElements(root),
			chapterIndex,
			chapterHref,
			chapterTitle
		);
		return this.finalizeParagraphExtractionRecords(
			doc,
			root,
			primary,
			chapterIndex,
			chapterHref,
			chapterTitle
		);
	}

	private buildParagraphRecordsForElements(
		doc: Document,
		root: Element,
		elements: HTMLElement[],
		chapterIndex: number,
		chapterHref: string,
		chapterTitle: string
	): ReaderParagraphRecord[] {
		const paragraphs: ReaderParagraphRecord[] = [];
		for (const element of elements) {
			if (this.isParagraphReadingExcludedElement(element)) {
				continue;
			}
			const record = this.buildParagraphRecordFromElement(
				doc,
				element,
				chapterIndex,
				chapterHref,
				chapterTitle,
				paragraphs.length
			);
			if (record) {
				paragraphs.push(record);
			}
		}
		return paragraphs;
	}

	private finalizeParagraphExtractionRecords(
		doc: Document,
		root: Element,
		primary: ReaderParagraphRecord[],
		chapterIndex: number,
		chapterHref: string,
		chapterTitle: string
	): ReaderParagraphRecord[] {
		let resolved = this.filterParagraphBoilerplateRecords(primary, root);
		if (!this.shouldExpandParagraphExtraction(resolved, root)) {
			return this.applyGranularParagraphFallbackIfNeeded(
				doc,
				root,
				resolved,
				chapterIndex,
				chapterHref,
				chapterTitle
			);
		}

		const expanded: ReaderParagraphRecord[] = [];
		for (const range of this.collectBrDelimitedParagraphRanges(root)) {
			const record = this.buildParagraphRecordFromRange(
				doc,
				range,
				chapterIndex,
				chapterHref,
				chapterTitle,
				expanded.length
			);
			if (record) {
				expanded.push(record);
			}
		}
		for (const element of this.collectNestedBlockParagraphElements(root)) {
			const record = this.buildParagraphRecordFromElement(
				doc,
				element,
				chapterIndex,
				chapterHref,
				chapterTitle,
				expanded.length
			);
			if (record) {
				expanded.push(record);
			}
		}
		for (const range of this.collectOversizedExplicitParagraphRanges(root)) {
			const record = this.buildParagraphRecordFromRange(
				doc,
				range,
				chapterIndex,
				chapterHref,
				chapterTitle,
				expanded.length
			);
			if (record) {
				expanded.push(record);
			}
		}
		for (const range of this.collectOversizedContainerParagraphRanges(root)) {
			const record = this.buildParagraphRecordFromRange(
				doc,
				range,
				chapterIndex,
				chapterHref,
				chapterTitle,
				expanded.length
			);
			if (record) {
				expanded.push(record);
			}
		}

		const expandedFiltered = this.filterParagraphBoilerplateRecords(expanded, root);
		if (this.isStrongerParagraphExtraction(expandedFiltered, resolved, root)) {
			resolved = expandedFiltered;
		}

		const mainContentRecords: ReaderParagraphRecord[] = [];
		for (const range of this.collectMainContentParagraphRanges(root)) {
			const record = this.buildParagraphRecordFromRange(
				doc,
				range,
				chapterIndex,
				chapterHref,
				chapterTitle,
				mainContentRecords.length
			);
			if (record) {
				mainContentRecords.push(record);
			}
		}
		const mainContentFiltered = this.filterParagraphBoilerplateRecords(mainContentRecords, root);
		if (this.isStrongerParagraphExtraction(mainContentFiltered, resolved, root)) {
			resolved = mainContentFiltered;
		}

		if (this.getNonBoilerplateParagraphRecordsTextLength(resolved) > 0) {
			return this.applyGranularParagraphFallbackIfNeeded(
				doc,
				root,
				resolved,
				chapterIndex,
				chapterHref,
				chapterTitle
			);
		}

		const fallbackCandidates = this.collectFallbackParagraphElements(root);
		const fallback = this.buildParagraphRecordsForElements(
			doc,
			root,
			fallbackCandidates,
			chapterIndex,
			chapterHref,
			chapterTitle
		);
		const fallbackFiltered = this.filterParagraphBoilerplateRecords(fallback, root);
		if (fallbackFiltered.length > 0) {
			return fallbackFiltered;
		}

		const rootText = root.textContent?.replace(/\s+/g, " ").trim() || "";
		if (rootText.length > 0 && rootText.length <= 900) {
			const fallbackRecord = this.buildParagraphRecordFromElement(
				doc,
				root,
				chapterIndex,
				chapterHref,
				chapterTitle,
				0
			);
			return fallbackRecord ? [fallbackRecord] : [];
		}

		const blockFallback = this.buildParagraphRecordsForElements(
			doc,
			root,
			this.collectBlockFallbackElements(root),
			chapterIndex,
			chapterHref,
			chapterTitle
		);
		return this.filterParagraphBoilerplateRecords(blockFallback, root);
	}

	private normalizeParagraphTagName(tagName: string): string {
		return String(tagName || "").toUpperCase();
	}

	private collectParagraphCandidateElements(root: Element): HTMLElement[] {
		const elements = [
			...Array.from(root.querySelectorAll<HTMLElement>(PARAGRAPH_EXPLICIT_SELECTOR)),
			...Array.from(root.querySelectorAll<HTMLElement>(LEAF_PARAGRAPH_CONTAINER_SELECTOR)),
		];
		const unique = new Set<HTMLElement>();
		const results: HTMLElement[] = [];
		for (const element of elements) {
			if (!unique.has(element) && this.isParagraphCandidateElement(element)) {
				unique.add(element);
				results.push(element);
			}
		}
		return results;
	}

	private isParagraphCandidateElement(element: HTMLElement): boolean {
		if (this.isParagraphReadingExcludedElement(element)) {
			return false;
		}
		const tagName = this.normalizeParagraphTagName(element.tagName);
		if (PARAGRAPH_TAG_NAMES.has(tagName)) {
			const explicitLength = this.getElementNormalizedTextLength(element);
			return explicitLength >= 2 && explicitLength <= PARAGRAPH_EXPLICIT_MAX_LENGTH;
		}
		if (tagName !== "DIV" && tagName !== "SECTION" && tagName !== "ARTICLE") {
			return false;
		}
		if (element.querySelector(PARAGRAPH_CHILD_BLOCK_SELECTOR)) {
			return false;
		}
		const textLength = this.getElementNormalizedTextLength(element);
		if (textLength < 24 || textLength > PARAGRAPH_CONTAINER_MAX_LENGTH) {
			return false;
		}
		const sentenceCount = this.estimateSentenceCount(element.textContent || "");
		if (sentenceCount > 28) {
			return false;
		}
		return this.hasOnlyInlineDescendants(element);
	}

	private collectFallbackParagraphElements(root: Element): HTMLElement[] {
		const blocks = Array.from(
			root.querySelectorAll<HTMLElement>(LEAF_PARAGRAPH_CONTAINER_SELECTOR)
		);
		return blocks.filter((element) => this.isFallbackParagraphElement(element));
	}

	private isFallbackParagraphElement(element: HTMLElement): boolean {
		if (this.isParagraphCandidateElement(element)) {
			return true;
		}
		if (element.querySelector(PARAGRAPH_EXPLICIT_SELECTOR)) {
			return false;
		}
		if (!this.hasOnlyInlineDescendants(element)) {
			return false;
		}
		const textLength = this.getElementNormalizedTextLength(element);
		if (textLength < 18 || textLength > 1800) {
			return false;
		}
		return this.estimateSentenceCount(element.textContent || "") <= 20;
	}

	private collectBlockFallbackElements(root: Element): HTMLElement[] {
		const elements = Array.from(
			root.querySelectorAll<HTMLElement>(BLOCK_PARAGRAPH_FALLBACK_SELECTOR)
		);
		const unique = new Set<HTMLElement>();
		const results: HTMLElement[] = [];
		for (const element of elements) {
			if (unique.has(element)) {
				continue;
			}
			if (element.querySelector(PARAGRAPH_EXPLICIT_SELECTOR)) {
				continue;
			}
			const textLength = this.getElementNormalizedTextLength(element);
			if (textLength < 16 || textLength > 2000) {
				continue;
			}
			if (!this.hasOnlyInlineDescendants(element)) {
				continue;
			}
			unique.add(element);
			results.push(element);
		}
		return results;
	}

	private getElementNormalizedTextLength(element: Element): number {
		return (element.textContent?.replace(/\s+/g, " ").trim() || "").length;
	}

	private estimateSentenceCount(text: string): number {
		return (text.match(/[.!?。！？；;]+/g) || []).length + 1;
	}

	private hasOnlyInlineDescendants(element: HTMLElement): boolean {
		for (const descendant of Array.from(element.children)) {
			if (!domInstanceOf(descendant, HTMLElement)) {
				continue;
			}
			const descendantTagName = this.normalizeParagraphTagName(descendant.tagName);
			if (descendantTagName === "BR") {
				continue;
			}
			if (PARAGRAPH_TAG_NAMES.has(descendantTagName)) {
				return false;
			}
			if (
				["DIV", "SECTION", "ARTICLE", "UL", "OL", "TABLE", "ASIDE", "MAIN"].includes(
					descendantTagName
				)
			) {
				return false;
			}
		}
		return true;
	}

	private buildParagraphRecordFromElement(
		doc: Document,
		element: Element,
		chapterIndex: number,
		chapterHref: string,
		chapterTitle: string,
		ordinal: number
	): ReaderParagraphRecord | null {
		const segments = this.collectParagraphTextSegments(doc, element);
		if (segments.length === 0) {
			return null;
		}
		const normalized = this.normalizeParagraphSegments(segments);
		if (!normalized.text.trim() || normalized.charMap.length === 0) {
			return null;
		}

		const range = this.createParagraphRangeFromCharMap(doc, segments, normalized.charMap);
		if (!range) {
			return null;
		}

		return this.buildParagraphRecordFromResolvedRange(
			doc,
			element,
			range,
			segments,
			normalized.charMap,
			normalized.text,
			chapterIndex,
			chapterHref,
			chapterTitle,
			ordinal
		);
	}

	private buildParagraphRecordFromRange(
		doc: Document,
		range: Range,
		chapterIndex: number,
		chapterHref: string,
		chapterTitle: string,
		ordinal: number
	): ReaderParagraphRecord | null {
		const presentationElement = this.resolveParagraphPresentationElement(range);
		const segments = this.collectParagraphTextSegmentsInRange(doc, range);
		if (segments.length === 0) {
			return null;
		}
		const normalized = this.normalizeParagraphSegments(segments);
		if (!normalized.text.trim() || normalized.charMap.length === 0) {
			return null;
		}
		const resolvedRange = this.createParagraphRangeFromCharMap(doc, segments, normalized.charMap);
		if (!resolvedRange) {
			return null;
		}
		return this.buildParagraphRecordFromResolvedRange(
			doc,
			presentationElement,
			resolvedRange,
			segments,
			normalized.charMap,
			normalized.text,
			chapterIndex,
			chapterHref,
			chapterTitle,
			ordinal
		);
	}

	private buildParagraphRecordFromResolvedRange(
		doc: Document,
		presentationElement: Element,
		range: Range,
		segments: ReaderParagraphTextSegment[],
		charMap: ReaderParagraphCharPointer[],
		text: string,
		chapterIndex: number,
		chapterHref: string,
		chapterTitle: string,
		ordinal: number
	): ReaderParagraphRecord | null {
		let cfiRange = "";
		try {
			cfiRange = this.parser.createCfiFromRange(chapterIndex, range);
		} catch (error) {
			logger.warn("[FoliateReaderService] Failed to build paragraph CFI:", {
				chapterIndex,
				error,
			});
			return null;
		}
		return {
			id: `${chapterIndex}:${ordinal}:${cfiRange}`,
			chapterIndex,
			chapterTitle,
			chapterHref,
			text,
			cfiRange,
			elementPath: this.getNodePath(doc.body || doc.documentElement, presentationElement),
			segments,
			charMap,
		};
	}

	private resolveParagraphPresentationElement(range: Range): Element {
		let current: Node | null = range.commonAncestorContainer;
		if (current.nodeType === Node.TEXT_NODE) {
			current = current.parentElement;
		}
		while (domInstanceOf(current, Element)) {
			const currentTagName = this.normalizeParagraphTagName(current.tagName);
			if (
				PARAGRAPH_TAG_NAMES.has(currentTagName) ||
				["DIV", "SECTION", "ARTICLE", "MAIN"].includes(currentTagName)
			) {
				return current;
			}
			current = current.parentElement;
		}
		return domInstanceOf(range.commonAncestorContainer, Element)
			? range.commonAncestorContainer
			: range.startContainer.parentElement ||
					range.commonAncestorContainer.parentElement ||
					range.startContainer.ownerDocument?.body ||
					range.startContainer.ownerDocument?.documentElement ||
					range.startContainer.ownerDocument?.documentElement;
	}

	private collectParagraphTextSegmentsInRange(
		doc: Document,
		range: Range
	): ReaderParagraphTextSegment[] {
		const root = doc.body || doc.documentElement;
		if (!root) {
			return [];
		}
		const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: (node) => {
				if (!(domInstanceOf(node, Text)) || !node.textContent) {
					return NodeFilter.FILTER_REJECT;
				}
				if (!node.parentElement) {
					return NodeFilter.FILTER_REJECT;
				}
				if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(node.parentElement.tagName)) {
					return NodeFilter.FILTER_REJECT;
				}
				if (!range.intersectsNode(node)) {
					return NodeFilter.FILTER_REJECT;
				}
				return NodeFilter.FILTER_ACCEPT;
			},
		});

		const segments: ReaderParagraphTextSegment[] = [];
		let current = walker.nextNode();
		while (current) {
			if (domInstanceOf(current, Text) && current.textContent) {
				segments.push({
					path: this.getNodePath(root, current),
					relativePath: this.getNodePath(range.commonAncestorContainer, current),
					text: current.textContent,
				});
			}
			current = walker.nextNode();
		}
		return segments;
	}

	private isParagraphReadingExcludedElement(element: Element): boolean {
		return Boolean(element.closest(PARAGRAPH_READING_EXCLUDED_SELECTOR));
	}

	private isParagraphBoilerplate(text: string): boolean {
		const normalized = text.replace(/\s+/g, " ").trim();
		if (normalized.length < 16) {
			return false;
		}
		let signalCount = 0;
		for (const pattern of PARAGRAPH_BOILERPLATE_PATTERNS) {
			if (pattern.test(normalized)) {
				signalCount += 1;
			}
		}
		if (signalCount >= 2) {
			return true;
		}
		return signalCount >= 1 && normalized.length <= 280;
	}

	private getParagraphReadableBodyTextLength(root: Element): number {
		const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: (node) => {
				if (!(domInstanceOf(node, Text)) || !node.textContent?.trim()) {
					return NodeFilter.FILTER_REJECT;
				}
				const parent = node.parentElement;
				if (!parent || this.isParagraphReadingExcludedElement(parent)) {
					return NodeFilter.FILTER_REJECT;
				}
				if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) {
					return NodeFilter.FILTER_REJECT;
				}
				return NodeFilter.FILTER_ACCEPT;
			},
		});
		let length = 0;
		let current = walker?.nextNode();
		while (current) {
			if (domInstanceOf(current, Text)) {
				length += current.textContent?.replace(/\s+/g, " ").trim().length || 0;
			}
			current = walker?.nextNode() || null;
		}
		return length;
	}

	private getParagraphRecordsTextLength(records: ReaderParagraphRecord[]): number {
		return records.reduce((total, record) => total + record.text.length, 0);
	}

	private getNonBoilerplateParagraphRecordsTextLength(records: ReaderParagraphRecord[]): number {
		return records
			.filter((record) => !this.isParagraphBoilerplate(record.text))
			.reduce((total, record) => total + record.text.length, 0);
	}

	private countMeaningfulExplicitParagraphElements(root: Element): number {
		let count = 0;
		for (const element of Array.from(root.querySelectorAll<HTMLElement>(PARAGRAPH_EXPLICIT_SELECTOR))) {
			if (this.isParagraphReadingExcludedElement(element)) {
				continue;
			}
			const text = this.normalizeParagraphTextFragment(element.textContent || "", true);
			if (text.length >= PARAGRAPH_MIN_MEANINGFUL_LENGTH) {
				count += 1;
			}
		}
		return count;
	}

	private isUnderSegmentedParagraphExtraction(
		records: ReaderParagraphRecord[],
		root: Element
	): boolean {
		const filtered = records.filter((record) => !this.isParagraphBoilerplate(record.text));
		if (filtered.length === 0) {
			return true;
		}
		const bodyLength = this.getParagraphReadableBodyTextLength(root);
		if (bodyLength < 200) {
			return false;
		}
		if (
			filtered.some((record) => record.text.length > PARAGRAPH_CONTAINER_MAX_LENGTH)
		) {
			return true;
		}
		const explicitCount = this.countMeaningfulExplicitParagraphElements(root);
		const expectedMinimum = Math.min(
			explicitCount,
			Math.max(2, Math.ceil(explicitCount * 0.55))
		);
		if (explicitCount >= 2 && filtered.length < expectedMinimum) {
			return true;
		}
		if (filtered.length === 1 && explicitCount >= 2) {
			return filtered[0].text.length / bodyLength >= 0.55;
		}
		return false;
	}

	private collectGranularExplicitParagraphElements(root: Element): HTMLElement[] {
		const elements = Array.from(root.querySelectorAll<HTMLElement>(PARAGRAPH_EXPLICIT_SELECTOR));
		const unique = new Set<HTMLElement>();
		const results: HTMLElement[] = [];
		for (const element of elements) {
			if (unique.has(element) || this.isParagraphReadingExcludedElement(element)) {
				continue;
			}
			const text = this.normalizeParagraphTextFragment(element.textContent || "", true);
			if (text.length < PARAGRAPH_MIN_MEANINGFUL_LENGTH) {
				continue;
			}
			unique.add(element);
			results.push(element);
		}
		return results;
	}

	private applyGranularParagraphFallbackIfNeeded(
		doc: Document,
		root: Element,
		resolved: ReaderParagraphRecord[],
		chapterIndex: number,
		chapterHref: string,
		chapterTitle: string
	): ReaderParagraphRecord[] {
		if (!this.isUnderSegmentedParagraphExtraction(resolved, root)) {
			return resolved;
		}
		const granular = this.buildParagraphRecordsForElements(
			doc,
			root,
			this.collectGranularExplicitParagraphElements(root),
			chapterIndex,
			chapterHref,
			chapterTitle
		);
		const granularFiltered = this.filterParagraphBoilerplateRecords(granular, root);
		if (
			granularFiltered.length > 0 &&
			(this.isStrongerParagraphExtraction(granularFiltered, resolved, root) ||
				granularFiltered.length > resolved.length)
		) {
			return granularFiltered;
		}
		return resolved;
	}

	private shouldExpandParagraphExtraction(
		records: ReaderParagraphRecord[],
		root: Element
	): boolean {
		if (records.length === 0) {
			return true;
		}
		const bodyLength = this.getParagraphReadableBodyTextLength(root);
		if (bodyLength <= 0) {
			return false;
		}
		const nonBoilerplateLength = this.getNonBoilerplateParagraphRecordsTextLength(records);
		if (nonBoilerplateLength <= 0) {
			return true;
		}
		if (records.every((record) => this.isParagraphBoilerplate(record.text))) {
			return true;
		}
		if (this.isUnderSegmentedParagraphExtraction(records, root)) {
			return true;
		}
		return nonBoilerplateLength / bodyLength < PARAGRAPH_BODY_COVERAGE_THRESHOLD;
	}

	private isStrongerParagraphExtraction(
		candidate: ReaderParagraphRecord[],
		current: ReaderParagraphRecord[],
		root: Element
	): boolean {
		const candidateLength = this.getNonBoilerplateParagraphRecordsTextLength(candidate);
		const currentLength = this.getNonBoilerplateParagraphRecordsTextLength(current);
		if (candidateLength > currentLength) {
			return true;
		}
		if (candidateLength < currentLength) {
			return false;
		}
		const bodyLength = this.getParagraphReadableBodyTextLength(root);
		if (bodyLength <= 0) {
			return candidate.length > current.length;
		}
		return (
			candidate.length > current.length &&
			candidateLength / bodyLength >= PARAGRAPH_BODY_COVERAGE_THRESHOLD
		);
	}

	private filterParagraphBoilerplateRecords(
		records: ReaderParagraphRecord[],
		root: Element
	): ReaderParagraphRecord[] {
		if (records.length === 0) {
			return records;
		}
		const filtered = records.filter((record) => !this.isParagraphBoilerplate(record.text));
		if (filtered.length === 0) {
			return [];
		}
		const bodyLength = this.getParagraphReadableBodyTextLength(root);
		if (bodyLength <= 0) {
			return filtered;
		}
		if (this.getParagraphRecordsTextLength(filtered) / bodyLength >= PARAGRAPH_BODY_COVERAGE_THRESHOLD) {
			return filtered;
		}
		return filtered;
	}

	private collectMainContentParagraphRanges(root: Element): Range[] {
		const doc = root.ownerDocument;
		if (!doc) {
			return [];
		}
		let best: HTMLElement | null = null;
		let bestScore = 0;
		for (const element of Array.from(
			root.querySelectorAll<HTMLElement>("div, section, article, main, p")
		)) {
			if (this.isParagraphReadingExcludedElement(element)) {
				continue;
			}
			const text = this.normalizeParagraphTextFragment(element.textContent || "", true);
			if (text.length < 80 || this.isParagraphBoilerplate(text)) {
				continue;
			}
			if (
				element.querySelector(PARAGRAPH_CHILD_BLOCK_SELECTOR) &&
				this.normalizeParagraphTagName(element.tagName) !== "P"
			) {
				continue;
			}
			if (text.length > bestScore) {
				bestScore = text.length;
				best = element;
			}
		}
		if (!best) {
			return [];
		}
		if (best.querySelector("br")) {
			return this.splitElementIntoBrDelimitedRanges(best);
		}
		if (this.getElementNormalizedTextLength(best) > PARAGRAPH_CONTAINER_MAX_LENGTH) {
			return this.splitElementTextIntoChunkRanges(best);
		}
		const range = doc.createRange();
		range.selectNodeContents(best);
		return [range];
	}

	private collectBrDelimitedParagraphRanges(root: Element): Range[] {
		const doc = root.ownerDocument;
		if (!doc) {
			return [];
		}
		const ranges: Range[] = [];
		const seen = new Set<string>();
		const containers = root.querySelectorAll("div, section, article, p, blockquote, li");
		for (const container of Array.from(containers)) {
			if (!domInstanceOf(container, HTMLElement)) {
				continue;
			}
			if (this.isParagraphReadingExcludedElement(container)) {
				continue;
			}
			if (container.querySelector("br") === null) {
				continue;
			}
			const textLength = this.getElementNormalizedTextLength(container);
			if (textLength < 40) {
				continue;
			}
			for (const range of this.splitElementIntoBrDelimitedRanges(container)) {
				const signature = this.normalizeParagraphTextFragment(range.toString(), true);
				if (signature.length < PARAGRAPH_MIN_MEANINGFUL_LENGTH || seen.has(signature)) {
					continue;
				}
				seen.add(signature);
				ranges.push(range);
			}
		}
		return ranges;
	}

	private splitElementIntoBrDelimitedRanges(container: HTMLElement): Range[] {
		const doc = container.ownerDocument;
		if (!doc) {
			return [];
		}
		const ranges: Range[] = [];
		let startAnchor: { node: Node; offset: number } | null = null;

		const pushRange = (endNode: Node, endOffset: number) => {
			if (!startAnchor) {
				return;
			}
			const range = doc.createRange();
			range.setStart(startAnchor.node, startAnchor.offset);
			range.setEnd(endNode, endOffset);
			const text = this.normalizeParagraphTextFragment(range.toString(), true);
			if (text.length >= PARAGRAPH_MIN_MEANINGFUL_LENGTH) {
				ranges.push(range);
			}
			startAnchor = null;
		};

		const visit = (node: Node) => {
			if (node.nodeType === Node.TEXT_NODE) {
				const text = node.textContent || "";
				const firstOffset = text.search(/\S/u);
				if (firstOffset < 0) {
					return;
				}
				if (!startAnchor) {
					startAnchor = { node, offset: firstOffset };
				}
				return;
			}
			if (domInstanceOf(node, HTMLBRElement)) {
				pushRange(node, 0);
				return;
			}
			if (node.nodeType === Node.ELEMENT_NODE) {
				for (const child of Array.from(node.childNodes)) {
					visit(child);
				}
			}
		};

		for (const child of Array.from(container.childNodes)) {
			visit(child);
		}
		const endBoundary = this.findLastTextEndInElement(container);
		if (startAnchor && endBoundary) {
			pushRange(endBoundary.node, endBoundary.offset);
		}
		return ranges;
	}

	private findLastTextEndInElement(element: Element): { node: Text; offset: number } | null {
		const doc = element.ownerDocument;
		if (!doc) {
			return null;
		}
		const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
			acceptNode: (node) => {
				if (!(domInstanceOf(node, Text)) || !node.textContent?.trim()) {
					return NodeFilter.FILTER_REJECT;
				}
				const parent = node.parentElement;
				if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) {
					return NodeFilter.FILTER_REJECT;
				}
				return NodeFilter.FILTER_ACCEPT;
			},
		});
		let last: Text | null = null;
		let current = walker.nextNode();
		while (current) {
			if (domInstanceOf(current, Text)) {
				last = current;
			}
			current = walker.nextNode();
		}
		return last ? { node: last, offset: last.textContent?.length || 0 } : null;
	}

	private collectNestedBlockParagraphElements(root: Element): HTMLElement[] {
		const results: HTMLElement[] = [];
		const seen = new Set<HTMLElement>();
		const containers = root.querySelectorAll("div, section, article");
		for (const container of Array.from(containers)) {
			if (!domInstanceOf(container, HTMLElement)) {
				continue;
			}
			if (this.isParagraphReadingExcludedElement(container)) {
				continue;
			}
			const blockChildren = Array.from(container.children).filter(
				(child): child is HTMLElement =>
					domInstanceOf(child, HTMLElement) &&
					["DIV", "SECTION", "ARTICLE", "P"].includes(
						this.normalizeParagraphTagName(child.tagName)
					)
			);
			if (blockChildren.length < 2) {
				continue;
			}
			for (const child of blockChildren) {
				if (seen.has(child) || this.isParagraphReadingExcludedElement(child)) {
					continue;
				}
				const textLength = this.getElementNormalizedTextLength(child);
				if (textLength < 18 || textLength > PARAGRAPH_EXPLICIT_MAX_LENGTH) {
					continue;
				}
				if (
					child.querySelector(PARAGRAPH_CHILD_BLOCK_SELECTOR) &&
					this.normalizeParagraphTagName(child.tagName) !== "P"
				) {
					continue;
				}
				seen.add(child);
				results.push(child);
			}
		}
		return results;
	}

	private collectOversizedContainerParagraphRanges(root: Element): Range[] {
		const ranges: Range[] = [];
		for (const element of Array.from(
			root.querySelectorAll<HTMLElement>(LEAF_PARAGRAPH_CONTAINER_SELECTOR)
		)) {
			if (this.isParagraphReadingExcludedElement(element)) {
				continue;
			}
			if (element.querySelector(PARAGRAPH_EXPLICIT_SELECTOR)) {
				continue;
			}
			if (element.querySelector("br")) {
				continue;
			}
			const textLength = this.getElementNormalizedTextLength(element);
			if (textLength <= PARAGRAPH_CONTAINER_MAX_LENGTH) {
				continue;
			}
			ranges.push(...this.splitElementTextIntoChunkRanges(element));
		}
		return ranges;
	}

	private collectOversizedExplicitParagraphRanges(root: Element): Range[] {
		const ranges: Range[] = [];
		for (const element of Array.from(root.querySelectorAll<HTMLElement>(PARAGRAPH_EXPLICIT_SELECTOR))) {
			if (this.isParagraphReadingExcludedElement(element)) {
				continue;
			}
			const textLength = this.getElementNormalizedTextLength(element);
			if (textLength <= PARAGRAPH_CONTAINER_MAX_LENGTH) {
				continue;
			}
			ranges.push(...this.splitElementTextIntoChunkRanges(element));
		}
		return ranges;
	}

	private splitElementTextIntoChunkRanges(element: HTMLElement): Range[] {
		const doc = element.ownerDocument;
		if (!doc) {
			return [];
		}
		const segments = this.collectParagraphTextSegments(doc, element);
		const normalized = this.normalizeParagraphSegments(segments);
		if (normalized.charMap.length <= PARAGRAPH_EXPLICIT_SPLIT_CHUNK) {
			return [];
		}

		const ranges: Range[] = [];
		let chunkStart = 0;
		while (chunkStart < normalized.charMap.length) {
			let chunkEnd = Math.min(chunkStart + PARAGRAPH_EXPLICIT_SPLIT_CHUNK, normalized.charMap.length);
			if (chunkEnd < normalized.charMap.length) {
				const preferredBreak = normalized.text.lastIndexOf("。", chunkEnd - 1);
				const fallbackBreak = normalized.text.lastIndexOf("，", chunkEnd - 1);
				const breakOffset = Math.max(preferredBreak, fallbackBreak);
				if (breakOffset > chunkStart + 80) {
					chunkEnd = breakOffset + 1;
				}
			}
			const range = this.createRangeFromSegmentPointers(doc, segments, normalized.charMap[chunkStart], {
				segmentIndex: normalized.charMap[chunkEnd - 1].segmentIndex,
				nodeOffset: normalized.charMap[chunkEnd - 1].nodeOffset + 1,
			});
			if (range) {
				ranges.push(range);
			}
			chunkStart = chunkEnd;
		}
		return ranges;
	}

	private async ensureParagraphHtml(paragraph: ReaderParagraphRecord): Promise<string | undefined> {
		if (
			typeof paragraph.html === "string" &&
			paragraph.htmlRevision === this.paragraphPresentationRevision
		) {
			return paragraph.html;
		}
		const doc = await this.parser.getRawDocumentByIndex(paragraph.chapterIndex);
		if (!doc) {
			return paragraph.html;
		}
		const root = doc.body || doc.documentElement;
		const element = this.resolveElementPath(root, paragraph.elementPath);
		if (!element) {
			return paragraph.html;
		}
		const range = this.resolveParagraphRangeInDocument(paragraph, doc);
		if (!range) {
			return paragraph.html;
		}
		const html = this.buildParagraphHtml(
			doc,
			element,
			range,
			paragraph.segments,
			paragraph.charMap,
			paragraph.chapterIndex
		);
		paragraph.html = html;
		paragraph.htmlRevision = this.paragraphPresentationRevision;
		return html;
	}

	private collectParagraphTextSegments(
		doc: Document,
		element: Element
	): ReaderParagraphTextSegment[] {
		const root = doc.body || doc.documentElement;
		if (!root) {
			return [];
		}
		const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
			acceptNode: (node) => {
				if (!(domInstanceOf(node, Text)) || !node.textContent) {
					return NodeFilter.FILTER_REJECT;
				}
				if (!node.parentElement) {
					return NodeFilter.FILTER_REJECT;
				}
				if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(node.parentElement.tagName)) {
					return NodeFilter.FILTER_REJECT;
				}
				return NodeFilter.FILTER_ACCEPT;
			},
		});

		const segments: ReaderParagraphTextSegment[] = [];
		let current = walker.nextNode();
		while (current) {
			if (domInstanceOf(current, Text) && current.textContent) {
				segments.push({
					path: this.getNodePath(root, current),
					relativePath: this.getNodePath(element, current),
					text: current.textContent,
				});
			}
			current = walker.nextNode();
		}
		return segments;
	}

	private normalizeParagraphSegments(segments: ReaderParagraphTextSegment[]): {
		text: string;
		charMap: ReaderParagraphCharPointer[];
	} {
		let text = "";
		const charMap: ReaderParagraphCharPointer[] = [];
		let lastWasWhitespace = true;

		for (const [segmentIndex, segment] of segments.entries()) {
			for (let offset = 0; offset < segment.text.length; offset += 1) {
				const char = segment.text[offset];
				if (/\s/u.test(char)) {
					if (!lastWasWhitespace) {
						text += " ";
						charMap.push({ segmentIndex, nodeOffset: offset });
						lastWasWhitespace = true;
					}
					continue;
				}
				text += char;
				charMap.push({ segmentIndex, nodeOffset: offset });
				lastWasWhitespace = false;
			}
		}

		while (text.endsWith(" ")) {
			text = text.slice(0, -1);
			charMap.pop();
		}

		return { text, charMap };
	}

	private createParagraphRangeFromCharMap(
		doc: Document,
		segments: ReaderParagraphTextSegment[],
		charMap: ReaderParagraphCharPointer[]
	): Range | null {
		if (charMap.length === 0) {
			return null;
		}
		const startPointer = charMap[0];
		const endPointer = charMap[charMap.length - 1];
		return this.createRangeFromSegmentPointers(doc, segments, startPointer, {
			segmentIndex: endPointer.segmentIndex,
			nodeOffset: endPointer.nodeOffset + 1,
		});
	}

	private createRangeFromSegmentPointers(
		doc: Document,
		segments: ReaderParagraphTextSegment[],
		startPointer: ReaderParagraphCharPointer,
		endPointer: ReaderParagraphCharPointer
	): Range | null {
		const root = doc.body || doc.documentElement;
		if (!root) {
			return null;
		}
		const startNode = this.resolveTextNodePath(root, segments[startPointer.segmentIndex]?.path);
		const endNode = this.resolveTextNodePath(root, segments[endPointer.segmentIndex]?.path);
		if (!startNode || !endNode) {
			return null;
		}

		const range = doc.createRange();
		range.setStart(
			startNode,
			this.clamp(startPointer.nodeOffset, 0, startNode.textContent?.length || 0)
		);
		range.setEnd(endNode, this.clamp(endPointer.nodeOffset, 0, endNode.textContent?.length || 0));
		return range;
	}

	private createRangeFromRelativeSegmentPointers(
		doc: Document,
		root: Node,
		segments: ReaderParagraphTextSegment[],
		startPointer: ReaderParagraphCharPointer,
		endPointer: ReaderParagraphCharPointer
	): Range | null {
		const startNode = this.resolveTextNodePath(
			root,
			segments[startPointer.segmentIndex]?.relativePath
		);
		const endNode = this.resolveTextNodePath(root, segments[endPointer.segmentIndex]?.relativePath);
		if (!startNode || !endNode) {
			return null;
		}
		const range = doc.createRange();
		range.setStart(
			startNode,
			this.clamp(startPointer.nodeOffset, 0, startNode.textContent?.length || 0)
		);
		range.setEnd(endNode, this.clamp(endPointer.nodeOffset, 0, endNode.textContent?.length || 0));
		return range;
	}

	private getNodePath(root: Node, target: Node): number[] {
		const path: number[] = [];
		let current: Node | null = target;
		while (current && current !== root) {
			const parent: Node | null = current.parentNode;
			if (!parent) {
				return [];
			}
			path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
			current = parent;
		}
		return path;
	}

	private resolveTextNodePath(root: Node, path: number[] | undefined): Text | null {
		if (!path?.length) {
			return domInstanceOf(root, Text) ? root : null;
		}
		let current: Node | null = root;
		for (const index of path) {
			current = current?.childNodes?.[index] || null;
			if (!current) {
				return null;
			}
		}
		return domInstanceOf(current, Text) ? current : null;
	}

	private resolveElementPath(root: Node | null, path: number[] | undefined): Element | null {
		if (!root || !path?.length) {
			return domInstanceOf(root, Element) ? root : null;
		}
		let current: Node | null = root;
		for (const index of path) {
			current = current?.childNodes?.[index] || null;
			if (!current) {
				return null;
			}
		}
		return domInstanceOf(current, Element) ? current : null;
	}

	private resolveParagraphRangeInDocument(
		paragraph: ReaderParagraphRecord,
		doc: Document,
		startOffset = 0,
		endOffset = paragraph.text.length
	): Range | null {
		if (paragraph.charMap.length === 0) {
			return null;
		}
		const normalizedStart = this.clamp(Math.floor(startOffset), 0, paragraph.text.length);
		const normalizedEnd = this.clamp(Math.ceil(endOffset), 0, paragraph.text.length);
		if (normalizedEnd <= normalizedStart) {
			return null;
		}
		if (normalizedStart === 0 && normalizedEnd === paragraph.text.length) {
			const cachedRange = this.getCachedParagraphRangeInDocument(paragraph, doc);
			if (cachedRange) {
				return cachedRange;
			}
		}
		const startPointer = paragraph.charMap[normalizedStart];
		const endPointer = paragraph.charMap[normalizedEnd - 1];
		if (!startPointer || !endPointer) {
			return null;
		}
		const range = this.createRangeFromSegmentPointers(doc, paragraph.segments, startPointer, {
			segmentIndex: endPointer.segmentIndex,
			nodeOffset: endPointer.nodeOffset + 1,
		});
		if (normalizedStart === 0 && normalizedEnd === paragraph.text.length) {
			this.storeCachedParagraphRangeInDocument(paragraph, doc, range);
		}
		return range;
	}

	private getCachedParagraphRangeInDocument(
		paragraph: ReaderParagraphRecord,
		doc: Document
	): Range | null {
		const byParagraphId = this.paragraphRangeCache.get(doc);
		if (!byParagraphId || !byParagraphId.has(paragraph.id)) {
			return null;
		}
		const cached = byParagraphId.get(paragraph.id) || null;
		return cached ? cached.cloneRange() : null;
	}

	private storeCachedParagraphRangeInDocument(
		paragraph: ReaderParagraphRecord,
		doc: Document,
		range: Range | null
	): void {
		let byParagraphId = this.paragraphRangeCache.get(doc);
		if (!byParagraphId) {
			byParagraphId = new Map<string, Range | null>();
			this.paragraphRangeCache.set(doc, byParagraphId);
		}
		byParagraphId.set(paragraph.id, range ? range.cloneRange() : null);
	}

	private buildParagraphHtml(
		doc: Document,
		element: Element,
		paragraphRange: Range,
		segments: ReaderParagraphTextSegment[],
		charMap: ReaderParagraphCharPointer[],
		chapterIndex: number
	): string | undefined {
		const clone = element.cloneNode(true) as Element;
		this.decorateParagraphFootnoteAnchors(element, clone);
		const highlights = this.collectParagraphHighlightDecorations(
			doc,
			this.normalizeParagraphTextFragment(paragraphRange.toString(), true),
			paragraphRange,
			segments,
			charMap,
			chapterIndex
		);
		for (const decoration of highlights.sort(
			(left, right) => right.startOffset - left.startOffset
		)) {
			const cloneRange =
				this.createRangeFromRelativeOffsets(
					clone.ownerDocument,
					clone,
					segments,
					charMap,
					decoration.startOffset,
					decoration.endOffset
				) ||
				this.createRangeFromNormalizedTextOffsets(
					clone.ownerDocument,
					clone,
					decoration.startOffset,
					decoration.endOffset
				);
			if (!cloneRange) {
				continue;
			}
			const marker = createSpanInOwnerDocument(clone.ownerDocument);
			marker.className = "weave-paragraph-annotation";
			marker.setAttribute("data-cfi-range", decoration.cfiRange);
			marker.setAttribute("data-color", decoration.color || "yellow");
			marker.setAttribute("data-style", decoration.style || "highlight");
			if (decoration.hasCommentDivider) {
				marker.setAttribute("data-has-comment", "true");
			}
			const fragment = cloneRange.extractContents();
			marker.appendChild(fragment);
			cloneRange.insertNode(marker);
		}
		return clone.innerHTML || undefined;
	}

	private decorateParagraphFootnoteAnchors(sourceElement: Element, clonedElement: Element): void {
		const sourceAnchors = Array.from(sourceElement.querySelectorAll("a"));
		const clonedAnchors = Array.from(clonedElement.querySelectorAll("a"));
		for (let index = 0; index < sourceAnchors.length; index += 1) {
			const sourceAnchor = sourceAnchors[index];
			const clonedAnchor = clonedAnchors[index];
			if (
				!domInstanceOf(sourceAnchor, HTMLAnchorElement) ||
				!domInstanceOf(clonedAnchor, HTMLAnchorElement)
			) {
				continue;
			}
			if (!this.isFootnoteReference(sourceAnchor)) {
				continue;
			}
			clonedAnchor.classList.add("weave-paragraph-footnote");
			clonedAnchor.setAttribute(
				"data-footnote-href",
				String(sourceAnchor.getAttribute("href") || "").trim()
			);
			clonedAnchor.setAttribute(
				"data-footnote-label",
				String(sourceAnchor.textContent || "")
					.replace(/\s+/g, " ")
					.trim()
			);
		}
	}

	private collectParagraphHighlightDecorations(
		doc: Document,
		paragraphText: string,
		paragraphRange: Range,
		segments: ReaderParagraphTextSegment[],
		charMap: ReaderParagraphCharPointer[],
		chapterIndex: number
	): Array<{
		startOffset: number;
		endOffset: number;
		cfiRange: string;
		color: string;
		style?: EpubHighlightStyle;
		hasCommentDivider?: boolean;
	}> {
		const decorations: Array<{
			startOffset: number;
			endOffset: number;
			cfiRange: string;
			color: string;
			style?: EpubHighlightStyle;
			hasCommentDivider?: boolean;
		}> = [];
		for (const highlight of this.getAllParagraphModeHighlights()) {
			const fallbackDecoration = this.buildParagraphTextMatchDecoration(paragraphText, highlight);
			const resolvedChapterIndex =
				typeof highlight.chapterIndex === "number" && Number.isFinite(highlight.chapterIndex)
					? highlight.chapterIndex
					: this.parser.getSectionIndexForCfi(highlight.cfiRange);
			if (typeof resolvedChapterIndex === "number" && resolvedChapterIndex !== chapterIndex) {
				if (fallbackDecoration) {
					decorations.push(fallbackDecoration);
				}
				continue;
			}
			const highlightRange = this.parser.resolveRangeInLoadedSection(
				highlight.cfiRange,
				doc,
				chapterIndex,
				highlight.text
			);
			if (!highlightRange || !this.rangesIntersect(paragraphRange, highlightRange)) {
				if (fallbackDecoration) {
					decorations.push(fallbackDecoration);
				}
				continue;
			}
			const intersection = this.createIntersectionRange(doc, paragraphRange, highlightRange);
			if (!intersection) {
				continue;
			}
			const startOffset = this.getNormalizedParagraphOffsetForBoundary(
				doc,
				paragraphRange,
				intersection.startContainer,
				intersection.startOffset
			);
			const endOffset = this.getNormalizedParagraphOffsetForBoundary(
				doc,
				paragraphRange,
				intersection.endContainer,
				intersection.endOffset
			);
			if (endOffset <= startOffset) {
				continue;
			}
			decorations.push({
				startOffset,
				endOffset,
				cfiRange: highlight.cfiRange,
				color: highlight.color || "yellow",
				style: highlight.style,
				hasCommentDivider: highlight.hasCommentDivider,
			});
		}
		return this.dedupeParagraphDecorations(decorations);
	}

	private buildParagraphTextMatchDecoration(
		paragraphText: string,
		highlight: ReaderHighlight
	): {
		startOffset: number;
		endOffset: number;
		cfiRange: string;
		color: string;
		style?: EpubHighlightStyle;
		hasCommentDivider?: boolean;
	} | null {
		const normalizedParagraph = this.normalizeParagraphTextFragment(paragraphText, true);
		const normalizedHighlightText = this.normalizeParagraphTextFragment(highlight.text || "", true);
		if (!normalizedParagraph || !normalizedHighlightText) {
			return null;
		}
		const startOffset = normalizedParagraph.indexOf(normalizedHighlightText);
		if (startOffset < 0) {
			return null;
		}
		const endOffset = startOffset + normalizedHighlightText.length;
		if (endOffset <= startOffset) {
			return null;
		}
		return {
			startOffset,
			endOffset,
			cfiRange: highlight.cfiRange,
			color: highlight.color || "yellow",
			style: highlight.style,
			hasCommentDivider: highlight.hasCommentDivider,
		};
	}

	private getAllParagraphModeHighlights(): ReaderHighlight[] {
		const merged = new Map<string, ReaderHighlight>();
		for (const highlight of this.savedHighlights) {
			merged.set(getReaderHighlightIdentityKey(highlight), highlight);
		}
		for (const highlight of this.highlightDataMap.values()) {
			merged.set(getReaderHighlightIdentityKey(highlight), highlight);
		}
		for (const highlight of this.temporaryHighlightDataMap.values()) {
			merged.set(getReaderHighlightIdentityKey(highlight), highlight);
		}
		return Array.from(merged.values());
	}

	private dedupeParagraphDecorations(
		decorations: Array<{
			startOffset: number;
			endOffset: number;
			cfiRange: string;
			color: string;
			style?: EpubHighlightStyle;
			hasCommentDivider?: boolean;
		}>
	): Array<{
		startOffset: number;
		endOffset: number;
		cfiRange: string;
		color: string;
		style?: EpubHighlightStyle;
		hasCommentDivider?: boolean;
	}> {
		const deduped = new Map<string, typeof decorations[number]>();
		for (const decoration of decorations) {
			const key = [
				decoration.startOffset,
				decoration.endOffset,
				decoration.color,
				decoration.style || "highlight",
				decoration.hasCommentDivider ? "comment" : "plain",
			].join(":");
			deduped.set(key, decoration);
		}
		return Array.from(deduped.values());
	}

	private rangesIntersect(left: Range, right: Range): boolean {
		return (
			left.compareBoundaryPoints(Range.END_TO_START, right) > 0 &&
			left.compareBoundaryPoints(Range.START_TO_END, right) < 0
		);
	}

	private createIntersectionRange(doc: Document, base: Range, target: Range): Range | null {
		if (!this.rangesIntersect(base, target)) {
			return null;
		}
		const range = doc.createRange();
		if (base.compareBoundaryPoints(Range.START_TO_START, target) >= 0) {
			range.setStart(base.startContainer, base.startOffset);
		} else {
			range.setStart(target.startContainer, target.startOffset);
		}
		if (base.compareBoundaryPoints(Range.END_TO_END, target) <= 0) {
			range.setEnd(base.endContainer, base.endOffset);
		} else {
			range.setEnd(target.endContainer, target.endOffset);
		}
		return range;
	}

	private getNormalizedParagraphOffsetForBoundary(
		doc: Document,
		paragraphRange: Range,
		container: Node,
		offset: number
	): number {
		const probe = paragraphRange.cloneRange();
		probe.setEnd(container, offset);
		return this.normalizeParagraphTextFragment(probe.toString(), false).length;
	}

	private normalizeParagraphTextFragment(text: string, trimTrailing: boolean): string {
		let normalized = "";
		let lastWasWhitespace = true;
		for (const char of String(text || "")) {
			if (/\s/u.test(char)) {
				if (!lastWasWhitespace) {
					normalized += " ";
					lastWasWhitespace = true;
				}
				continue;
			}
			normalized += char;
			lastWasWhitespace = false;
		}
		return trimTrailing ? normalized.trimEnd() : normalized;
	}

	private createRangeFromRelativeOffsets(
		doc: Document,
		root: Node,
		segments: ReaderParagraphTextSegment[],
		charMap: ReaderParagraphCharPointer[],
		startOffset: number,
		endOffset: number
	): Range | null {
		if (charMap.length === 0) {
			return null;
		}
		const normalizedStart = this.clamp(Math.floor(startOffset), 0, charMap.length);
		const normalizedEnd = this.clamp(Math.ceil(endOffset), 0, charMap.length);
		if (normalizedEnd <= normalizedStart) {
			return null;
		}
		const startPointer = charMap[normalizedStart];
		const endPointer = charMap[normalizedEnd - 1];
		if (!startPointer || !endPointer) {
			return null;
		}
		return this.createRangeFromRelativeSegmentPointers(doc, root, segments, startPointer, {
			segmentIndex: endPointer.segmentIndex,
			nodeOffset: endPointer.nodeOffset + 1,
		});
	}

	private createRangeFromNormalizedTextOffsets(
		doc: Document,
		root: Node,
		startOffset: number,
		endOffset: number
	): Range | null {
		const normalized = this.collectNormalizedTextPointersForRoot(doc, root);
		if (normalized.charMap.length === 0) {
			return null;
		}
		const normalizedStart = this.clamp(Math.floor(startOffset), 0, normalized.charMap.length);
		const normalizedEnd = this.clamp(Math.ceil(endOffset), 0, normalized.charMap.length);
		if (normalizedEnd <= normalizedStart) {
			return null;
		}
		const startPointer = normalized.charMap[normalizedStart];
		const endPointer = normalized.charMap[normalizedEnd - 1];
		if (!startPointer || !endPointer) {
			return null;
		}
		const range = doc.createRange();
		range.setStart(
			startPointer.node,
			this.clamp(startPointer.nodeOffset, 0, startPointer.node.textContent?.length || 0)
		);
		range.setEnd(
			endPointer.node,
			this.clamp(endPointer.nodeOffset + 1, 0, endPointer.node.textContent?.length || 0)
		);
		return range;
	}

	private collectNormalizedTextPointersForRoot(
		doc: Document,
		root: Node
	): {
		text: string;
		charMap: Array<{ node: Text; nodeOffset: number }>;
	} {
		const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: (node) => {
				if (!(domInstanceOf(node, Text)) || !node.textContent) {
					return NodeFilter.FILTER_REJECT;
				}
				if (!node.parentElement) {
					return NodeFilter.FILTER_REJECT;
				}
				if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(node.parentElement.tagName)) {
					return NodeFilter.FILTER_REJECT;
				}
				return NodeFilter.FILTER_ACCEPT;
			},
		});
		let text = "";
		const charMap: Array<{ node: Text; nodeOffset: number }> = [];
		let lastWasWhitespace = true;
		let current = walker.nextNode();
		while (current) {
			if (domInstanceOf(current, Text) && current.textContent) {
				for (let offset = 0; offset < current.textContent.length; offset += 1) {
					const char = current.textContent[offset];
					if (/\s/u.test(char)) {
						if (!lastWasWhitespace) {
							text += " ";
							charMap.push({ node: current, nodeOffset: offset });
							lastWasWhitespace = true;
						}
						continue;
					}
					text += char;
					charMap.push({ node: current, nodeOffset: offset });
					lastWasWhitespace = false;
				}
			}
			current = walker.nextNode();
		}
		while (text.endsWith(" ")) {
			text = text.slice(0, -1);
			charMap.pop();
		}
		return { text, charMap };
	}

	private async createParagraphSelectionRange(
		paragraph: ReaderParagraphRecord,
		startOffset: number,
		endOffset: number
	): Promise<{ range: Range; chapterIndex: number } | null> {
		const visibleFrame = this.getVisibleFramesWithIndex().find(
			(item) => item.index === paragraph.chapterIndex
		);
		if (visibleFrame) {
			const liveRange = this.resolveParagraphRangeInDocument(
				paragraph,
				visibleFrame.frameDocument,
				startOffset,
				endOffset
			);
			if (liveRange) {
				return { range: liveRange, chapterIndex: paragraph.chapterIndex };
			}
		}

		const rawDoc = await this.parser.getRawDocumentByIndex(paragraph.chapterIndex);
		if (!rawDoc) {
			return null;
		}
		const rawRange = this.resolveParagraphRangeInDocument(
			paragraph,
			rawDoc,
			startOffset,
			endOffset
		);
		return rawRange ? { range: rawRange, chapterIndex: paragraph.chapterIndex } : null;
	}

	private async resolveCurrentParagraphIndex(
		chapterIndex: number,
		paragraphs: ReaderParagraphRecord[]
	): Promise<number> {
		const currentCfi = String(this.currentPosition.cfi || "").trim();
		if (!currentCfi) {
			return 0;
		}
		const visibleFrame = this.getVisibleFramesWithIndex().find(
			(item) => item.index === chapterIndex
		);
		if (!visibleFrame) {
			const exactIndex = paragraphs.findIndex(
				(paragraph) =>
					this.normalizeLocationKey(paragraph.cfiRange) === this.normalizeLocationKey(currentCfi)
			);
			return exactIndex >= 0 ? exactIndex : 0;
		}

		const currentRange = this.parser.resolveRangeInLoadedSection(
			currentCfi,
			visibleFrame.frameDocument,
			chapterIndex
		);
		if (!currentRange) {
			return 0;
		}

		for (const [index, paragraph] of paragraphs.entries()) {
			const paragraphRange = this.resolveParagraphRangeInDocument(paragraph, visibleFrame.frameDocument);
			if (!paragraphRange) {
				continue;
			}
			if (
				paragraphRange.comparePoint(currentRange.startContainer, currentRange.startOffset) <= 0 &&
				paragraphRange.comparePoint(currentRange.endContainer, currentRange.endOffset) >= 0
			) {
				return index;
			}
		}

		let closestIndex = 0;
		let closestDistance = Number.POSITIVE_INFINITY;
		for (const [index, paragraph] of paragraphs.entries()) {
			const paragraphRange = this.resolveParagraphRangeInDocument(paragraph, visibleFrame.frameDocument);
			if (!paragraphRange) {
				continue;
			}
			const distance = Math.abs(
				paragraphRange.comparePoint(currentRange.startContainer, currentRange.startOffset)
			);
			if (distance < closestDistance) {
				closestDistance = distance;
				closestIndex = index;
			}
		}
		return closestIndex;
	}

	private attachHighlightClickListeners(doc: Document): void {
		if (this.documentHighlightClickCleanups.has(doc)) {
			return;
		}

		const onClick = (event: MouseEvent) => {
			this.handleFrameHighlightClick(event, doc);
		};

		doc.addEventListener("click", onClick, true);
		doc.defaultView?.addEventListener("click", onClick, true);

		const cleanup = () => {
			doc.removeEventListener("click", onClick, true);
			doc.defaultView?.removeEventListener("click", onClick, true);
		};
		this.documentHighlightClickCleanups.set(doc, cleanup);
	}

	private handleFrameHighlightClick(event: MouseEvent, doc: Document): void {
		if (event.button !== 0 || event.defaultPrevented) {
			return;
		}

		const frame = this.getVisibleFramesWithIndex().find((item) => item.frameDocument === doc);
		if (!frame) {
			return;
		}

		if (this.findFootnoteReference(event.target)) {
			return;
		}

		const highlight = this.findHighlightAtPointer(event.clientX, event.clientY, frame);
		if (!highlight) {
			return;
		}

		if (this.hasActiveReaderSelection(doc)) {
			return;
		}

		const geometry = this.getCurrentHighlightViewportGeometry(highlight.cfiRange, highlight.text);
		if (!geometry?.rect) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.clearSelections();
		this.notifyHighlightClick(
			buildHighlightClickInfo(highlight, geometry, "highlight")
		);
	}

	private isClientPointInViewportRect(
		clientX: number,
		clientY: number,
		rect: HighlightClickInfo["rect"]
	): boolean {
		return (
			clientX >= rect.left &&
			clientX <= rect.right &&
			clientY >= rect.top &&
			clientY <= rect.bottom
		);
	}

	private isClientPointInHighlightGeometry(
		clientX: number,
		clientY: number,
		geometry: { rect: HighlightClickInfo["rect"]; rects?: HighlightClickInfo["rect"][] }
	): boolean {
		if (this.isClientPointInViewportRect(clientX, clientY, geometry.rect)) {
			return true;
		}
		for (const rect of geometry.rects || []) {
			if (this.isClientPointInViewportRect(clientX, clientY, rect)) {
				return true;
			}
		}
		return false;
	}

	private collectHighlightsForSection(sectionIndex: number): ReaderHighlight[] {
		const results: ReaderHighlight[] = [];
		for (const highlight of [
			...this.highlightDataMap.values(),
			...this.temporaryHighlightDataMap.values(),
		]) {
			const highlightSection =
				typeof highlight.chapterIndex === "number"
					? highlight.chapterIndex
					: this.parser.getSectionIndexForCfi(highlight.cfiRange);
			if (highlightSection === sectionIndex) {
				results.push(highlight);
			}
		}
		return results;
	}

	private findHighlightAtPointer(
		clientX: number,
		clientY: number,
		frame: VisibleFrameWithIndex
	): ReaderHighlight | null {
		const sectionHighlights = this.collectHighlightsForSection(frame.index);
		for (let index = sectionHighlights.length - 1; index >= 0; index -= 1) {
			const highlight = sectionHighlights[index];
			const geometry = this.getCurrentHighlightViewportGeometry(
				highlight.cfiRange,
				highlight.text
			);
			if (geometry && this.isClientPointInHighlightGeometry(clientX, clientY, geometry)) {
				return highlight;
			}
		}

		return this.findHighlightAtDocumentPoint(clientX, clientY, frame);
	}

	private findHighlightAtDocumentPoint(
		clientX: number,
		clientY: number,
		frame: VisibleFrameWithIndex
	): ReaderHighlight | null {
		const doc = frame.frameDocument;
		const caretRange = this.createCaretRangeFromClientPoint(doc, clientX, clientY);
		if (!caretRange) {
			return null;
		}

		for (const highlight of this.collectHighlightsForSection(frame.index)) {
			const highlightRange = this.parser.resolveRangeInLoadedSection(
				highlight.cfiRange,
				doc,
				frame.index,
				highlight.text
			);
			if (!highlightRange) {
				continue;
			}
			if (this.pointerIsInsideHighlightRange(caretRange, highlightRange)) {
				return highlight;
			}
		}
		return null;
	}

	private pointerIsInsideHighlightRange(caretRange: Range, highlightRange: Range): boolean {
		try {
			return highlightRange.isPointInRange(
				caretRange.startContainer,
				caretRange.startOffset
			);
		} catch {
			return (
				highlightRange.compareBoundaryPoints(Range.START_TO_END, caretRange) <= 0 &&
				highlightRange.compareBoundaryPoints(Range.END_TO_START, caretRange) >= 0
			);
		}
	}

	private createCaretRangeFromClientPoint(
		doc: Document,
		clientX: number,
		clientY: number
	): Range | null {
		const view = doc.defaultView;
		if (!view) {
			return null;
		}

		const docWithCaretApis = doc as Document & Record<string, unknown>;
		const caretPositionFromPoint = docWithCaretApis["caretPositionFromPoint"];
		if (typeof caretPositionFromPoint === "function") {
			const position = Reflect.apply(
				caretPositionFromPoint as (
					this: Document,
					x: number,
					y: number
				) => { offsetNode: Node; offset: number } | null,
				doc,
				[clientX, clientY]
			);
			if (position?.offsetNode) {
				const range = doc.createRange();
				range.setStart(position.offsetNode, position.offset);
				range.collapse(true);
				return range;
			}
		}

		return null;
	}

	private attachSelectionListeners(doc: Document): void {
		if (this.documentSelectionCleanups.has(doc)) {
			return;
		}

		let pendingFrame = 0;
		const scheduleEmit = () => {
			if (pendingFrame) {
				window.cancelAnimationFrame(pendingFrame);
			}
			pendingFrame = window.requestAnimationFrame(() => {
				pendingFrame = 0;
				this.emitSelectionChangeIfNeeded(doc);
			});
		};

		const onSelectionChange = () => scheduleEmit();
		const onMouseUp = (event: MouseEvent) => {
			scheduleEmit();
			this.bridgeHostSelectionMouseUp(doc, event);
		};
		const onTouchEnd = () => scheduleEmit();
		const onKeyUp = () => scheduleEmit();

		doc.addEventListener("selectionchange", onSelectionChange);
		doc.addEventListener("mouseup", onMouseUp);
		doc.addEventListener("touchend", onTouchEnd);
		doc.addEventListener("keyup", onKeyUp);

		const cleanup = () => {
			if (pendingFrame) {
				window.cancelAnimationFrame(pendingFrame);
			}
			doc.removeEventListener("selectionchange", onSelectionChange);
			doc.removeEventListener("mouseup", onMouseUp);
			doc.removeEventListener("touchend", onTouchEnd);
			doc.removeEventListener("keyup", onKeyUp);
		};
		this.documentSelectionCleanups.set(doc, cleanup);
	}

	private attachWheelListeners(doc: Document): void {
		if (this.documentWheelCleanups.has(doc)) {
			return;
		}

		const eventOptions: AddEventListenerOptions = { passive: false, capture: true };
		const onWheel = (event: WheelEvent) => {
			this.handleWheelPageTurn(event, doc);
		};

		doc.addEventListener("wheel", onWheel, eventOptions);
		doc.defaultView?.addEventListener("wheel", onWheel, eventOptions);

		const cleanup = () => {
			doc.removeEventListener("wheel", onWheel, true);
			doc.defaultView?.removeEventListener("wheel", onWheel, true);
		};
		this.documentWheelCleanups.set(doc, cleanup);
	}

	private attachRenderContainerWheelListener(container: HTMLElement, hostView?: HTMLElement): void {
		if (this.renderContainerWheelCleanup) {
			this.renderContainerWheelCleanup();
			this.renderContainerWheelCleanup = null;
		}

		const eventOptions: AddEventListenerOptions = { passive: false, capture: true };
		const onWheel = (event: WheelEvent) => {
			this.handleWheelPageTurn(event);
		};

		container.addEventListener("wheel", onWheel, eventOptions);
		hostView?.addEventListener("wheel", onWheel, eventOptions);
		this.renderContainerWheelCleanup = () => {
			container.removeEventListener("wheel", onWheel, true);
			hostView?.removeEventListener("wheel", onWheel, true);
		};
	}

	private handleWheelPageTurn(event: WheelEvent, sourceDoc?: Document): void {
		if (this.layoutChangeInFlight || !this.foliateView) {
			this.resetWheelPageTurnState();
			return;
		}

		if (this.currentFlowMode === "scrolled") {
			this.handleScrolledBookEndWheel(event, sourceDoc);
			return;
		}

		if (this.currentFlowMode !== "paginated") {
			this.resetWheelPageTurnState();
			return;
		}
		if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}
		if (this.isWheelEventOnInteractiveElement(event.target)) {
			return;
		}

		const deltaX = this.normalizeWheelDelta(event.deltaX, event.deltaMode, sourceDoc);
		const deltaY = this.normalizeWheelDelta(event.deltaY, event.deltaMode, sourceDoc);
		if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 4) {
			return;
		}
		if (Math.abs(deltaX) > Math.abs(deltaY)) {
			return;
		}
		if (this.hasActiveReaderSelection(sourceDoc)) {
			return;
		}

		const isDiscreteWheelInput =
			event.deltaMode === WheelEvent.DOM_DELTA_LINE ||
			event.deltaMode === WheelEvent.DOM_DELTA_PAGE;
		const hasDiscreteTurnIntent = isDiscreteWheelInput && Math.abs(event.deltaY) >= 1;

		event.preventDefault();
		event.stopPropagation();

		if (hasDiscreteTurnIntent) {
			const direction: "next" | "prev" = deltaY > 0 ? "next" : "prev";
			this.resetWheelPageTurnState();
			void this.performWheelPageTurn(direction);
			return;
		}

		const now = Date.now();
		if (now - this.lastWheelEventAt > 360) {
			this.wheelDeltaAccumulator = 0;
		}
		this.lastWheelEventAt = now;
		this.wheelDeltaAccumulator += deltaY;

		if (Math.abs(this.wheelDeltaAccumulator) < 64) {
			return;
		}

		const direction: "next" | "prev" = this.wheelDeltaAccumulator > 0 ? "next" : "prev";
		this.resetWheelPageTurnState();
		void this.performWheelPageTurn(direction);
	}

	private normalizeWheelDelta(delta: number, deltaMode: number, sourceDoc?: Document): number {
		if (!Number.isFinite(delta)) {
			return 0;
		}
		if (deltaMode === WheelEvent.DOM_DELTA_LINE) {
			return delta * 16;
		}
		if (deltaMode === WheelEvent.DOM_DELTA_PAGE) {
			const viewportHeight =
				sourceDoc?.defaultView?.innerHeight || this.renderContainer?.clientHeight || 800;
			return delta * viewportHeight;
		}
		return delta;
	}

	private handleScrolledBookEndWheel(event: WheelEvent, sourceDoc?: Document): void {
		if (!this.isAtBookEnd() || !this.bookEndAdvanceHandler) {
			return;
		}
		if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}
		if (this.isWheelEventOnInteractiveElement(event.target)) {
			return;
		}

		const deltaY = this.normalizeWheelDelta(event.deltaY, event.deltaMode, sourceDoc);
		if (!Number.isFinite(deltaY) || deltaY <= 4) {
			return;
		}

		const scrollContainer = this.resolveWheelScrollContainer(event.target);
		if (!scrollContainer || !this.isScrollContainerAtBottom(scrollContainer)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		void this.shouldBlockBookEndAdvance();
	}

	private resolveWheelScrollContainer(target: EventTarget | null): HTMLElement | null {
		const originElement = this.getElementFromEventTarget(target);
		if (!originElement || typeof originElement.closest !== "function") {
			return this.renderContainer;
		}

		let node: Element | null = originElement;
		while (node) {
			if (domInstanceOf(node, HTMLElement) && node.scrollHeight > node.clientHeight + 1) {
				return node;
			}
			node = node.parentElement;
		}
		return this.renderContainer;
	}

	private isScrollContainerAtBottom(container: HTMLElement): boolean {
		return container.scrollTop + container.clientHeight >= container.scrollHeight - 6;
	}

	private async performWheelPageTurn(direction: "next" | "prev"): Promise<void> {
		if (this.wheelTurnInFlight) {
			return;
		}
		this.wheelTurnInFlight = true;
		try {
			if (direction === "next") {
				if (await this.shouldBlockBookEndAdvance()) {
					return;
				}
				await this.nextPage();
				return;
			}
			await this.prevPage();
		} finally {
			window.setTimeout(() => {
				this.wheelTurnInFlight = false;
			}, 180);
		}
	}

	private resetWheelPageTurnState(): void {
		this.wheelDeltaAccumulator = 0;
		this.lastWheelEventAt = 0;
	}

	private isWheelEventOnInteractiveElement(target: EventTarget | null): boolean {
		const originElement = this.getElementFromEventTarget(target);
		if (!originElement || typeof originElement.closest !== "function") {
			return false;
		}
		const interactive = originElement.closest(
			'a, button, input, textarea, select, summary, label, [contenteditable="true"], [role="button"], [role="link"]'
		);
		return Boolean(interactive);
	}

	private attachFootnotePreviewListeners(doc: Document): void {
		if (this.documentFootnoteCleanups.has(doc)) {
			return;
		}

		let hoverTimer: ReturnType<typeof window.setTimeout> | null = null;
		let hideTimer: ReturnType<typeof window.setTimeout> | null = null;
		let activeAnchor: HTMLAnchorElement | null = null;

		const clearHoverTimer = () => {
			if (hoverTimer) {
				window.clearTimeout(hoverTimer);
				hoverTimer = null;
			}
		};

		const clearHideTimer = () => {
			if (hideTimer) {
				window.clearTimeout(hideTimer);
				hideTimer = null;
			}
		};

		const schedulePreviewForAnchor = (anchor: HTMLAnchorElement) => {
			if (this.footnotePreviewPinned) {
				return;
			}
			if (activeAnchor === anchor) {
				clearHideTimer();
				return;
			}
			activeAnchor = anchor;
			clearHoverTimer();
			clearHideTimer();
			hoverTimer = window.setTimeout(() => {
				hoverTimer = null;
				this.emitFootnotePreviewForAnchor(doc, anchor);
			}, 180);
		};

		const scheduleHidePreview = () => {
			if (this.footnotePreviewPinned) {
				return;
			}
			clearHoverTimer();
			clearHideTimer();
			hideTimer = window.setTimeout(() => {
				activeAnchor = null;
				this.dismissFootnotePreview();
			}, 120);
		};

		const onMouseOver = (event: MouseEvent) => {
			const anchor = this.findFootnoteReferenceFromEvent(event);
			if (!anchor) {
				return;
			}
			const href = anchor.getAttribute("href") || "";
			const text = String(anchor.textContent || "").trim();
			logFootnoteDiag(`Hover reference detected href=${href} text=${text}`);
			schedulePreviewForAnchor(anchor);
		};

		const onMouseOut = (event: MouseEvent) => {
			const anchor = this.findFootnoteReferenceFromEvent(event);
			if (!anchor) {
				return;
			}
			const relatedAnchor = this.findFootnoteReference(event.relatedTarget);
			if (relatedAnchor === anchor) {
				return;
			}
			scheduleHidePreview();
		};

		const onClick = (event: MouseEvent) => {
			const anchor = this.findFootnoteReferenceFromEvent(event);
			if (!anchor) {
				if (this.footnotePreviewPinned) {
					activeAnchor = null;
					clearHoverTimer();
					clearHideTimer();
					this.dismissFootnotePreview({ unpin: true });
				}
				return;
			}
			activeAnchor = anchor;
			clearHoverTimer();
			clearHideTimer();
			if (this.currentFootnoteClickAction === "navigate") {
				this.dismissFootnotePreview({ unpin: true });
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			(
				event as MouseEvent & { stopImmediatePropagation?: () => void }
			).stopImmediatePropagation?.();
			const href = anchor.getAttribute("href") || "";
			const text = String(anchor.textContent || "").trim();
			logFootnoteDiag(`Click reference intercepted href=${href} text=${text}`);
			this.emitFootnotePreviewForAnchor(doc, anchor, {
				pinned: true,
				suppressRelocateMs: 1800,
			});
		};

		const onFocusIn = (event: FocusEvent) => {
			const anchor = this.findFootnoteReference(event.target);
			if (!anchor) {
				return;
			}
			schedulePreviewForAnchor(anchor);
		};

		const onFocusOut = (event: FocusEvent) => {
			const anchor = this.findFootnoteReference(event.target);
			if (!anchor) {
				return;
			}
			scheduleHidePreview();
		};

		doc.addEventListener("mouseover", onMouseOver, true);
		doc.addEventListener("mouseout", onMouseOut, true);
		doc.addEventListener("click", onClick, true);
		doc.addEventListener("focusin", onFocusIn);
		doc.addEventListener("focusout", onFocusOut);

		const cleanup = () => {
			clearHoverTimer();
			clearHideTimer();
			doc.removeEventListener("mouseover", onMouseOver, true);
			doc.removeEventListener("mouseout", onMouseOut, true);
			doc.removeEventListener("click", onClick, true);
			doc.removeEventListener("focusin", onFocusIn);
			doc.removeEventListener("focusout", onFocusOut);
		};
		this.documentFootnoteCleanups.set(doc, cleanup);
	}

	private get footnotePreviewPinned(): boolean {
		return this.footnotePreviewController.isPinned();
	}

	private set footnotePreviewPinned(value: boolean) {
		this.footnotePreviewController.setPinnedState(value);
	}

	private hasNonCollapsedTextSelection(doc: Document | null | undefined): boolean {
		if (!doc?.defaultView) {
			return false;
		}
		const selection = doc.defaultView.getSelection?.();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
			return false;
		}
		return Boolean(selection.toString().trim());
	}

	private hasActiveReaderSelection(preferredDoc?: Document | null): boolean {
		if (this.hasNonCollapsedTextSelection(preferredDoc)) {
			return true;
		}
		for (const frame of this.getVisibleFramesWithIndex()) {
			if (frame.frameDocument === preferredDoc) {
				continue;
			}
			if (this.hasNonCollapsedTextSelection(frame.frameDocument)) {
				return true;
			}
		}
		return this.hasNonCollapsedTextSelection(activeDocument);
	}

	private emitSelectionChangeIfNeeded(doc: Document): void {
		const selection = doc.defaultView?.getSelection?.();
		const frame = this.getVisibleFramesWithIndex().find((item) => item.frameDocument === doc);
		if (!frame) {
			return;
		}

		if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
			const hadSelection = this.lastSelectionByDocument.has(doc);
			this.lastSelectionByDocument.delete(doc);
			if (hadSelection) {
				this.notifySelectionChange("", frame.frame);
			}
			return;
		}

		const range = selection.getRangeAt(0);
		const text = selection.toString().trim();
		if (!text) {
			const hadSelection = this.lastSelectionByDocument.has(doc);
			this.lastSelectionByDocument.delete(doc);
			if (hadSelection) {
				this.notifySelectionChange("", frame.frame);
			}
			return;
		}

		const cfiRange = frame.frame.cfiFromRange(range.cloneRange());
		if (!cfiRange) {
			return;
		}

		const lastCfi = this.lastSelectionByDocument.get(doc);
		if (lastCfi === cfiRange) {
			return;
		}
		this.lastSelectionByDocument.set(doc, cfiRange);
		this.notifySelectionChange(cfiRange, frame.frame);
	}

	private applyRenderOptions(options?: ReaderRenderOptions): void {
		this.currentFlowMode = options?.flow === "scrolled" ? "scrolled" : "paginated";
		this.currentLayoutMode = options?.spread === "always" ? "double" : "paginated";
		this.currentWidthMode = options?.widthMode || this.currentWidthMode;
		if (typeof options?.lineHeight === "number" && options.lineHeight > 0) {
			this.currentLineHeight = options.lineHeight;
		}
		if (typeof options?.letterSpacing === "number" && Number.isFinite(options.letterSpacing)) {
			this.currentLetterSpacing = options.letterSpacing;
		}
		if (typeof options?.pageMargin === "number" && Number.isFinite(options.pageMargin)) {
			this.currentPageMargin = options.pageMargin;
		}
		if (options?.strikethroughPresentation) {
			this.currentStrikethroughPresentation = options.strikethroughPresentation;
		}
	}

	private computePaginatorLayoutMetrics(): {
		hostWidth: number;
		inlineSize: string;
		paginatorMargin: number;
		gap: string;
	} {
		const renderContainerWidth = Math.max(
			0,
			Math.round(this.renderContainer?.getBoundingClientRect().width || 0)
		);
		const renderer = this.foliateView?.renderer as FoliateRenderer | undefined;
		const rendererClientWidth = Math.max(
			0,
			this.foliateView?.clientWidth || this.foliateView?.offsetWidth || renderer?.clientWidth || 0
		);
		return computePaginatorLayoutMetrics({
			renderContainerWidth,
			rendererClientWidth,
			currentWidthMode: this.currentWidthMode,
			currentLayoutMode: this.currentLayoutMode,
			currentFlowMode: this.currentFlowMode,
			currentPageMargin: this.currentPageMargin,
		});
	}

	private applyRendererLayout(): void {
		const renderer = this.foliateView?.renderer as FoliateRenderer | undefined;
		if (!renderer) {
			return;
		}
		const metrics = this.computePaginatorLayoutMetrics();
		applyRendererLayoutAttributes(
			renderer,
			metrics,
			this.currentFlowMode,
			this.currentLayoutMode,
			this.currentWidthMode
		);
	}

	private applyRendererAppearance(): void {
		const renderer = this.foliateView?.renderer as FoliateRenderer | undefined;
		const styles = this.buildReaderStyles();
		renderer?.setStyles?.(styles);
		this.applyHostThemeSurface();
		for (const frame of this.getVisibleFramesWithIndex()) {
			this.normalizeDocument(frame.frameDocument);
		}
		this.schedulePaginatedLayoutRecovery();
	}

	private applyHostThemeSurface(): void {
		applyReaderThemeHostSurfaces({
			styleSource: this.getObsidianStyleSource(),
			renderContainer: this.renderContainer,
			foliateView: (this.foliateView as HTMLElement | null) ?? null,
			renderer: this.foliateView?.renderer as HTMLElement | undefined,
		});
	}

	private schedulePaginatedLayoutRecovery(): void {
		if (!this.renderContainer || !this.foliateView || this.currentFlowMode !== "paginated") {
			return;
		}
		const renderer = this.foliateView.renderer as FoliateRenderer | undefined;
		if (!isFoliatePaginatorRenderer(renderer)) {
			return;
		}
		this.paginatedLayoutRecovery.schedule((token) => this.recoverPaginatedLayoutIfNeeded(token));
	}

	private async recoverPaginatedLayoutIfNeeded(recoveryToken: number): Promise<void> {
		if (!this.paginatedLayoutRecovery.isCurrentToken(recoveryToken)) {
			return;
		}
		await this.waitForAnimationFrame();
		if (
			!this.paginatedLayoutRecovery.isCurrentToken(recoveryToken) ||
			!this.shouldRecoverPaginatedLayout()
		) {
			return;
		}

		this.applyRendererLayout();

		await this.waitForAnimationFrame();
		if (
			!this.paginatedLayoutRecovery.isCurrentToken(recoveryToken) ||
			!this.shouldRecoverPaginatedLayout()
		) {
			return;
		}

		this.applyRendererLayout();
	}

	private shouldRecoverPaginatedLayout(): boolean {
		if (!this.renderContainer || !this.foliateView || this.currentFlowMode !== "paginated") {
			return false;
		}
		const renderer = this.foliateView.renderer as FoliateRenderer | undefined;
		if (!isFoliatePaginatorRenderer(renderer)) {
			return false;
		}

		const { hostWidth } = this.computePaginatorLayoutMetrics();
		const visibleFrames = this.getVisibleFramesWithIndex();
		return shouldRecoverPaginatedLayout({
			hostWidth,
			frameViewportWidths: visibleFrames.map((frame) =>
				Math.max(
					frame.frameDocument.documentElement?.clientWidth || 0,
					frame.frameDocument.body?.clientWidth || 0
				)
			),
		});
	}

	private buildReaderStyles(): string {
		return buildReaderChapterStyles({
			styleSource: this.getObsidianStyleSource(),
			currentLineHeight: this.currentLineHeight,
			currentLetterSpacing: this.currentLetterSpacing,
			currentPageMargin: this.currentPageMargin,
			currentWidthMode: this.currentWidthMode,
		});
	}

	private getVisibleSectionKey(): string {
		const visibleFrames = this.getVisibleFramesWithIndex();
		if (!visibleFrames.length) {
			return "";
		}
		return visibleFrames
			.map((frame) => frame.index)
			.sort((left, right) => left - right)
			.join(",");
	}

	private scheduleAnnotationSyncAfterRelocate(): void {
		const visibleKey = this.getVisibleSectionKey();
		if (!this.annotationSyncForceNext && visibleKey === this.lastSyncedVisibleSectionKey) {
			return;
		}
		void this.queueAnnotationSync(false);
	}

	private queueAnnotationSync(force = false): Promise<void> {
		if (force) {
			this.annotationSyncForceNext = true;
		}
		if (this.annotationSyncInFlight) {
			this.annotationSyncQueued = true;
			return this.annotationSyncInFlight;
		}
		this.annotationSyncInFlight = this.runQueuedAnnotationSync().finally(() => {
			this.annotationSyncInFlight = null;
			if (this.annotationSyncQueued) {
				this.annotationSyncQueued = false;
				void this.queueAnnotationSync(false);
			}
		});
		return this.annotationSyncInFlight;
	}

	private async runQueuedAnnotationSync(): Promise<void> {
		const force = this.annotationSyncForceNext;
		this.annotationSyncForceNext = false;
		const visibleKey = this.getVisibleSectionKey();
		if (!force && visibleKey === this.lastSyncedVisibleSectionKey) {
			return;
		}
		await this.syncAnnotationsWithView();
		this.lastSyncedVisibleSectionKey = visibleKey;
	}

	private resetAnnotationSyncState(): void {
		this.lastSyncedVisibleSectionKey = "";
		this.annotationSyncQueued = false;
		this.annotationSyncForceNext = false;
		this.annotationSyncInFlight = null;
	}

	private async syncAnnotationsWithView(): Promise<void> {
		const view = this.foliateView;
		if (!view) {
			this.renderedAnnotations.clear();
			return;
		}

		const visibleFrames = this.getVisibleFramesWithIndex();
		const visibleIndexes = new Set(visibleFrames.map((item) => item.index));
		const desiredVisible = new Map<string, RenderedFoliateAnnotation>();

		const highlightKeys = new Set([
			...this.highlightDataMap.keys(),
			...this.temporaryHighlightDataMap.keys(),
		]);

		const pendingVisible: Array<{
			key: string;
			persistentHighlight?: ReaderHighlight;
			temporaryHighlight?: ReaderHighlight;
			visibleHighlight: ReaderHighlight;
		}> = [];

		for (const key of highlightKeys) {
			const persistentHighlight = this.highlightDataMap.get(key);
			const temporaryHighlight = this.temporaryHighlightDataMap.get(key);
			const visibleHighlight = temporaryHighlight || persistentHighlight;
			if (!visibleHighlight) {
				continue;
			}
			const sectionIndex = resolveHighlightSectionIndexForView(
				visibleHighlight,
				visibleFrames,
				this.parser
			);
			if (sectionIndex === null || !visibleIndexes.has(sectionIndex)) {
				continue;
			}
			pendingVisible.push({
				key,
				persistentHighlight,
				temporaryHighlight,
				visibleHighlight,
			});
		}

		await Promise.all(
			pendingVisible.map(async ({
				key,
				persistentHighlight,
				temporaryHighlight,
				visibleHighlight,
			}) => {
				const resolvedHighlight = await this.resolveHighlightAnchorForRender(visibleHighlight);
				const sourceLocateFocusColor =
					!temporaryHighlight && persistentHighlight
						? this.getSourceLocateFocusColor(resolvedHighlight.cfiRange)
						: undefined;
				desiredVisible.set(
					key,
					this.createRenderedAnnotationWithOptionalSourceLocateFocus({
						persistentHighlight: temporaryHighlight
							? persistentHighlight
							: resolvedHighlight,
						temporaryHighlight: temporaryHighlight ? resolvedHighlight : temporaryHighlight,
						sourceLocateFocusColor,
					})
				);
			})
		);

		for (const [key, rendered] of Array.from(this.renderedAnnotations.entries())) {
			const desired = desiredVisible.get(key);
			if (
				!desired ||
				rendered.renderSignature !== desired.renderSignature ||
				!isSameFoliateAnnotation(rendered.annotation, desired.annotation)
			) {
				try {
					await view.deleteAnnotation(rendered.annotation);
				} catch (error) {
					logger.debugWithTag("FoliateReaderService", "Failed to delete foliate annotation", {
						key,
						error,
					});
				}
				this.renderedAnnotations.delete(key);
			}
		}

		for (const [key, rendered] of desiredVisible.entries()) {
			if (this.renderedAnnotations.has(key)) {
				continue;
			}
			try {
				await view.addAnnotation(rendered.annotation);
				this.renderedAnnotations.set(key, rendered);
			} catch (error) {
				logger.warn("[FoliateReaderService] Failed to add foliate annotation:", {
					key,
					error,
				});
			}
		}
	}

	private getCurrentHighlightByCfi(cfiRange: string): ReaderHighlight | null {
		return this.findHighlightForAnnotationValue(cfiRange);
	}

	private notifyCommentMarkerClick(
		cfiRange: string,
		markerElement: Element,
		anchorRect?: HighlightClickInfo["rect"] | null
	): void {
		const highlight = this.getCurrentHighlightByCfi(cfiRange);
		if (!highlight) {
			return;
		}
		const rangeGeometry = this.getCurrentHighlightViewportGeometry(cfiRange);
		const markerRect = createElementViewportRect(markerElement);
		const rect = markerRect || anchorRect || rangeGeometry?.rect;
		if (!rect) {
			return;
		}
		this.notifyHighlightClick(
			buildHighlightClickInfo(
				highlight,
				{
					rect,
					rects: markerRect ? [markerRect] : rangeGeometry?.rects,
					anchorPoint: createAnchorPointFromRect(markerRect || anchorRect || rect),
				},
				"comment-marker"
			)
		);
	}

	private notifyNoteMarkerClick(
		annotation: ReaderFoliateAnnotation,
		markerElement: Element,
		anchorRect?: HighlightClickInfo["rect"] | null
	): void {
		const rangeGeometry = this.getCurrentHighlightViewportGeometry(annotation.cfiRange);
		const markerRect = createElementViewportRect(markerElement);
		const rect = markerRect || anchorRect || rangeGeometry?.rect;
		if (!rect) {
			return;
		}
		this.notifyHighlightClick(
			buildHighlightClickInfo(
				annotation,
				{
					rect,
					rects: markerRect ? [markerRect] : rangeGeometry?.rects,
					anchorPoint: createAnchorPointFromRect(markerRect || anchorRect || rect),
				},
				"highlight"
			)
		);
	}

	private getCurrentHighlightViewportGeometry(
		cfiRange: string,
		textHint?: string
	): { rect: HighlightClickInfo["rect"]; rects?: HighlightClickInfo["rect"][] } | null {
		return resolveHighlightViewportGeometry(cfiRange, {
			highlight: this.getCurrentHighlightByCfi(cfiRange),
			textHint,
			frames: this.getVisibleFramesWithIndex(),
			port: this.parser,
			createViewportRect: (frame, range) => this.createViewportRect(frame, range),
			createViewportRectList: (frame, range) => this.createViewportRectList(frame, range),
		});
	}

	private async drawAnnotation(
		annotation: FoliateAnnotation,
		draw: (draw: (rects: unknown[], options?: unknown) => SVGElement, options?: unknown) => void
	): Promise<void> {
		if (shouldRenderAnnotationAsConceal(annotation, this.currentStrikethroughPresentation)) {
			const key = getReaderHighlightIdentityKey(annotation);
			if (!this.temporarilyRevealedConcealmentTimers.has(key)) {
				draw((rects) =>
					this.createConcealmentOverlay(this.resolveAnnotationDrawRects(annotation, rects))
				);
				return;
			}
		}

		const overlayer = await this.getOverlayerModule();
		draw((rects) =>
			this.createCompositeAnnotationOverlay(
				annotation,
				this.resolveAnnotationDrawRects(annotation, rects),
				overlayer
			)
		);
	}

	private resolveAnnotationDrawRects(
		annotation: FoliateAnnotation,
		suppliedRects: unknown[]
	): unknown[] {
		if (!hasUsableOverlayRects(suppliedRects)) {
			const textHint = String(annotation.text || "").trim();
			return textHint ? this.resolveHighlightOverlayRects(annotation) : [];
		}

		const textHint = String(annotation.text || "").trim();
		if (!textHint || this.doesHighlightCfiCoverSavedText(annotation)) {
			return suppliedRects;
		}

		const quoteRects = this.resolveHighlightOverlayRects(annotation);
		return quoteRects.length > 0 ? quoteRects : suppliedRects;
	}

	private doesHighlightCfiCoverSavedText(
		highlight: Pick<ReaderHighlight, "cfiRange" | "text" | "chapterIndex">
	): boolean {
		const textHint = String(highlight.text || "").trim();
		if (!textHint) {
			return true;
		}
		const preferredChapter =
			typeof highlight.chapterIndex === "number" && Number.isFinite(highlight.chapterIndex)
				? highlight.chapterIndex
				: this.parser.getSectionIndexForCfi(highlight.cfiRange);
		for (const frame of orderVisibleHighlightFrames(
			this.getVisibleFramesWithIndex(),
			preferredChapter
		)) {
			const cfiOnlyRange = this.parser.resolveRangeInLoadedSection(
				highlight.cfiRange,
				frame.frameDocument,
				frame.index
			);
			if (!cfiOnlyRange) {
				continue;
			}
			return resolvedRangeCoversHighlightText(cfiOnlyRange, textHint);
		}
		return false;
	}

	private resolveHighlightOverlayRects(highlight: {
		cfiRange: string;
		text?: string;
		chapterIndex?: number;
	}): Array<{ left: number; top: number; width: number; height: number }> {
		return resolveHighlightOverlayRects(highlight, this.getVisibleFramesWithIndex(), this.parser);
	}

	private getOverlayerModule(): Promise<FoliateOverlayerModule> {
		if (!this.overlayerModulePromise) {
			this.overlayerModulePromise = import(
				"foliate-js/overlayer.js"
			) as Promise<FoliateOverlayerModule>;
		}
		return this.overlayerModulePromise;
	}

	private createCompositeAnnotationOverlay(
		annotation: FoliateAnnotation,
		rects: unknown[],
		overlayer?: FoliateOverlayerModule
	): SVGElement {
		return this.annotationOverlayRenderer.createCompositeAnnotationOverlay(
			annotation,
			rects,
			overlayer
		);
	}

	private createConcealmentOverlay = (rects: unknown[]): SVGElement =>
		this.annotationOverlayRenderer.createConcealmentOverlay(rects);

	private createCommentMarkerOverlay(annotation: FoliateAnnotation, rects: unknown[]): SVGElement {
		return this.annotationOverlayRenderer.createCommentMarkerOverlay(annotation, rects);
	}

	private createReferenceBadgeOverlay(annotation: FoliateAnnotation, rects: unknown[]): SVGElement {
		return this.annotationOverlayRenderer.createReferenceBadgeOverlay(annotation, rects);
	}

	private notifyReferenceBadgeClick(
		cfiRange: string,
		geometry?: {
			rect: HighlightClickInfo["rect"] | null;
			rects?: HighlightClickInfo["rects"];
			anchorPoint?: HighlightClickInfo["anchorPoint"];
		}
	): void {
		const highlight = this.getCurrentHighlightByCfi(cfiRange);
		let info: HighlightClickInfo | null = null;

		if (highlight && geometry?.rect) {
			info = buildHighlightClickInfo(
				highlight,
				{
					rect: geometry.rect,
					rects: geometry.rects,
					anchorPoint: geometry.anchorPoint,
				},
				"reference-badge"
			);
		} else {
			info = this.getHighlightClickInfo(cfiRange, "reference-badge");
		}

		if (info) {
			for (const listener of this.referenceBadgeClickCallbacks) {
				try {
					listener(info);
				} catch (error) {
					logger.warn("[FoliateReaderService] Reference badge click listener failed:", {
						cfiRange,
						error,
					});
				}
			}
		}

		// 兼容旧链路：如果外部仍依赖高亮点击或 DOM 事件，这里继续发出。
		if (info) {
			this.notifyHighlightClick(info);
		}

		if (this.foliateView) {
			this.foliateView.dispatchEvent(
				new CustomEvent("reference-badge-click", {
					detail: { cfiRange },
					bubbles: true,
				})
			);
		}
	}

	private createStyledAnnotationOverlay = (
		rects: unknown[],
		style: EpubHighlightStyle,
		color?: string
	): SVGElement =>
		this.annotationOverlayRenderer.createStyledAnnotationOverlay(rects, style, color);

	private createTemporaryFocusOverlay = (rects: unknown[], color: string): SVGElement =>
		this.annotationOverlayRenderer.createTemporaryFocusOverlay(rects, color);

	private async addResolvedHighlight(
		highlight: ReaderHighlight,
		durationMs?: number
	): Promise<void> {
		const canonical =
			(await this.parser.canonicalizeLocation(highlight.cfiRange, highlight.text)) ||
			highlight.cfiRange;
		const normalizedHighlight = this.normalizeHighlightSources({
			...highlight,
			cfiRange: canonical,
		});
		const key = getReaderHighlightIdentityKey(normalizedHighlight);

		const existingTimer = this.temporaryHighlightTimers.get(key);
		if (existingTimer) {
			window.clearTimeout(existingTimer);
			this.temporaryHighlightTimers.delete(key);
		}

		if (normalizedHighlight.temporary) {
			const existingTemporaryHighlight = this.temporaryHighlightDataMap.get(key);
			this.temporaryHighlightDataMap.set(
				key,
				existingTemporaryHighlight
					? this.mergeHighlights(existingTemporaryHighlight, normalizedHighlight)
					: normalizedHighlight
			);
			await this.refreshHighlights();

			if (typeof durationMs === "number" && durationMs > 0) {
				const timer = window.setTimeout(() => {
					this.temporaryHighlightTimers.delete(key);
					void this.removeTemporaryHighlight(normalizedHighlight.cfiRange);
				}, durationMs);
				this.temporaryHighlightTimers.set(key, timer);
			}
			return;
		}

		const deduped = new Map<string, ReaderHighlight>();
		for (const item of this.savedHighlights) {
			deduped.set(getReaderHighlightIdentityKey(item), item);
		}
		const existingHighlight = deduped.get(key);
		const mergedHighlight = existingHighlight
			? this.mergeHighlights(existingHighlight, normalizedHighlight)
			: normalizedHighlight;
		deduped.set(key, mergedHighlight);
		this.highlightDataMap.set(key, mergedHighlight);
		this.savedHighlights = Array.from(deduped.values());
		await this.refreshHighlights();
	}

	private async removeTemporaryHighlight(cfiRange: string): Promise<void> {
		const highlight = this.findStoredHighlightByCfi(cfiRange, "temporary");
		const key = highlight ? getReaderHighlightIdentityKey(highlight) : this.normalizeLocationKey(cfiRange);
		const existingTimer = this.temporaryHighlightTimers.get(key);
		if (existingTimer) {
			window.clearTimeout(existingTimer);
			this.temporaryHighlightTimers.delete(key);
		}
		this.temporaryHighlightDataMap.delete(key);
		this.invalidateParagraphPresentation();
		await this.refreshHighlights();
	}

	private dedupeHighlights(highlights: ReaderHighlight[]): ReaderHighlight[] {
		const deduped = new Map<string, ReaderHighlight>();
		for (const highlight of highlights) {
			const normalized = this.normalizeHighlightSources(highlight);
			const key = getReaderHighlightIdentityKey(normalized);
			const existing = deduped.get(key);
			deduped.set(key, existing ? this.mergeHighlights(existing, normalized) : normalized);
		}
		return Array.from(deduped.values());
	}

	private collectHighlightSourceLocators(highlight: {
		sourceFile?: string;
		sourceRef?: string;
		excerptId?: string;
		sourceLocators?: HighlightSourceLocator[];
	}): HighlightSourceLocator[] {
		const locators: HighlightSourceLocator[] = [];
		const primarySourceFile = String(highlight.sourceFile || "").trim();
		if (primarySourceFile) {
			locators.push({
				sourceFile: primarySourceFile,
				sourceRef: highlight.sourceRef,
				...(highlight.excerptId ? { excerptId: highlight.excerptId } : {}),
			});
		}
		for (const locator of highlight.sourceLocators || []) {
			const sourceFile = String(locator?.sourceFile || "").trim();
			if (!sourceFile) continue;
			locators.push({
				sourceFile,
				sourceRef: locator.sourceRef,
				...(locator.excerptId ? { excerptId: locator.excerptId } : {}),
			});
		}
		return this.mergeHighlightSourceLocators([], locators);
	}

	private mergeHighlightSourceLocators(
		existing: HighlightSourceLocator[],
		incoming: HighlightSourceLocator[]
	): HighlightSourceLocator[] {
		const merged = new Map<string, HighlightSourceLocator>();
		for (const locator of [...existing, ...incoming]) {
			const sourceFile = String(locator?.sourceFile || "").trim();
			if (!sourceFile) continue;
			const normalizedRef = String(locator?.sourceRef || "").trim();
			const normalizedExcerptId = String(locator?.excerptId || "").trim();
			const key = `${sourceFile}::${normalizedRef}::${normalizedExcerptId}`;
			if (!merged.has(key)) {
				merged.set(key, {
					sourceFile,
					sourceRef: normalizedRef || undefined,
					...(normalizedExcerptId ? { excerptId: normalizedExcerptId } : {}),
				});
			}
		}
		return Array.from(merged.values());
	}

	private selectPrimarySourceLocator(
		locators: HighlightSourceLocator[]
	): HighlightSourceLocator | null {
		if (locators.length === 0) {
			return null;
		}

		const cardLocator = locators.find(
			(locator) => typeof locator.sourceRef === "string" && locator.sourceRef.startsWith("card:")
		);
		if (cardLocator) {
			return cardLocator;
		}

		const referencedLocator = locators.find(
			(locator) => typeof locator.sourceRef === "string" && locator.sourceRef.trim().length > 0
		);
		if (referencedLocator) {
			return referencedLocator;
		}

		const excerptLocator = locators.find(
			(locator) => typeof locator.excerptId === "string" && locator.excerptId.trim().length > 0
		);
		if (excerptLocator) {
			return excerptLocator;
		}

		const markdownLocator = locators.find((locator) => locator.sourceFile.endsWith(".md"));
		if (markdownLocator) {
			return markdownLocator;
		}

		const canvasLocator = locators.find((locator) => locator.sourceFile.endsWith(".canvas"));
		if (canvasLocator) {
			return canvasLocator;
		}

		const wdeckLocator = locators.find((locator) => locator.sourceFile.endsWith(".wdeck"));
		if (wdeckLocator) {
			return wdeckLocator;
		}

		const jsonLocator = locators.find((locator) => locator.sourceFile.endsWith(".json"));
		if (jsonLocator) {
			return jsonLocator;
		}

		return locators[0] || null;
	}

	private normalizeHighlightSources(highlight: ReaderHighlight): ReaderHighlight {
		const sourceLocators = this.collectHighlightSourceLocators(highlight);
		const primaryLocator = this.selectPrimarySourceLocator(sourceLocators);
		return {
			...highlight,
			sourceFile: primaryLocator?.sourceFile || highlight.sourceFile,
			sourceRef: primaryLocator?.sourceRef || highlight.sourceRef,
			excerptId: primaryLocator?.excerptId || highlight.excerptId,
			sourceLocators,
		};
	}

	private mergeHighlights(existing: ReaderHighlight, incoming: ReaderHighlight): ReaderHighlight {
		const sourceLocators = this.mergeHighlightSourceLocators(
			this.collectHighlightSourceLocators(existing),
			this.collectHighlightSourceLocators(incoming)
		);
		const primaryLocator = this.selectPrimarySourceLocator(sourceLocators);
		const mergedStyle =
			existing.style === "reading-note" || incoming.style === "reading-note"
				? "reading-note"
				: incoming.style || existing.style;
		const baseHighlightColor =
			(existing.style !== "reading-note" ? existing.color : undefined) ||
			(incoming.style !== "reading-note" ? incoming.color : undefined) ||
			existing.baseHighlightColor ||
			incoming.baseHighlightColor;
		const baseStyle =
			(existing.style !== "reading-note" ? existing.style : undefined) ||
			(incoming.style !== "reading-note" ? incoming.style : undefined) ||
			existing.baseStyle ||
			incoming.baseStyle;

		return {
			...existing,
			...incoming,
			...(mergedStyle ? { style: mergedStyle } : {}),
			...(baseHighlightColor ? { baseHighlightColor } : {}),
			...(baseStyle ? { baseStyle } : {}),
			sourceFile: primaryLocator?.sourceFile || incoming.sourceFile || existing.sourceFile,
			sourceRef: primaryLocator?.sourceRef || incoming.sourceRef || existing.sourceRef,
			excerptId: primaryLocator?.excerptId || incoming.excerptId || existing.excerptId,
			sourceLocators,
		};
	}

	private async resolveHighlightAnchorForRender(highlight: ReaderHighlight): Promise<ReaderHighlight> {
		const key = getReaderHighlightIdentityKey(highlight);
		let inflight = this.highlightAnchorResolutionByKey.get(key);
		if (!inflight) {
			inflight = this.resolveHighlightAnchorCfiSafe(highlight).then((cfiRange) => {
				if (cfiRange !== highlight.cfiRange) {
					const updated = this.normalizeHighlightSources({ ...highlight, cfiRange });
					if (this.highlightDataMap.has(key)) {
						this.highlightDataMap.set(key, updated);
						this.savedHighlights = this.savedHighlights.map((item) =>
							getReaderHighlightIdentityKey(item) === key ? updated : item
						);
					}
					const temporary = this.temporaryHighlightDataMap.get(key);
					if (temporary) {
						this.temporaryHighlightDataMap.set(
							key,
							this.normalizeHighlightSources({ ...temporary, cfiRange })
						);
					}
				}
				return cfiRange;
			});
			this.highlightAnchorResolutionByKey.set(key, inflight);
		}
		try {
			const cfiRange = await inflight;
			return cfiRange === highlight.cfiRange
				? highlight
				: this.normalizeHighlightSources({ ...highlight, cfiRange });
		} catch {
			return highlight;
		}
	}

	private async resolveHighlightAnchorCfiSafe(highlight: ReaderHighlight): Promise<string> {
		try {
			return await this.resolveHighlightAnchorCfi(highlight);
		} catch (error) {
			logger.debugWithTag("FoliateReaderService", "Skipped highlight anchor resolution", {
				error,
			});
			return String(highlight.cfiRange || "").trim();
		}
	}

	private async resolveHighlightAnchorCfi(highlight: ReaderHighlight): Promise<string> {
		const textHint = String(highlight.text || "").trim();
		const originalCfi = String(highlight.cfiRange || "").trim();

		if (textHint && originalCfi) {
			const originalIndex =
				typeof highlight.chapterIndex === "number"
					? highlight.chapterIndex
					: this.parser.getSectionIndexForCfi(originalCfi);
			if (originalIndex !== null) {
				const originalDoc = await this.parser.getRawDocumentByIndex(originalIndex);
				if (originalDoc) {
					const originalRange = this.parser.resolveRangeInLoadedSection(
						originalCfi,
						originalDoc,
						originalIndex,
						textHint
					);
					if (originalRange && resolvedRangeCoversHighlightText(originalRange, textHint)) {
						try {
							return this.parser.createCfiFromRange(originalIndex, originalRange);
						} catch {
							// Fall through to canonicalization.
						}
					}
				}
			}
		}

		const canonical =
			(await this.parser.canonicalizeLocation(originalCfi, textHint || undefined)) || originalCfi;

		if (!textHint) {
			return canonical;
		}

		const sectionIndex =
			typeof highlight.chapterIndex === "number"
				? highlight.chapterIndex
				: (this.parser.getSectionIndexForCfi(canonical) ??
					this.parser.getSectionIndexForCfi(highlight.cfiRange));

		if (sectionIndex === null) {
			return canonical;
		}

		const resolveInDocument = (document: Document, index: number): string | null => {
			const range = this.parser.resolveRangeInLoadedSection(
				highlight.cfiRange,
				document,
				index,
				textHint
			);
			if (!range) {
				return null;
			}
			try {
				return this.parser.createCfiFromRange(index, range);
			} catch {
				return null;
			}
		};

		const virtualDoc = await this.parser.getRawDocumentByIndex(sectionIndex);
		if (virtualDoc) {
			const precise = resolveInDocument(virtualDoc, sectionIndex);
			if (precise) {
				return precise;
			}
		}

		for (const frame of this.getVisibleFramesWithIndex()) {
			if (frame.index !== sectionIndex) {
				continue;
			}
			const precise = resolveInDocument(frame.frameDocument, frame.index);
			if (precise) {
				return precise;
			}
		}

		return canonical;
	}

	private findHighlightForAnnotationValue(
		value: string,
		clickRange?: Range | null,
		sectionIndex?: number
	): ReaderHighlight | null {
		const trimmed = String(value || "").trim();
		if (!trimmed) {
			return null;
		}

		const identityHit =
			this.highlightDataMap.get(trimmed) || this.temporaryHighlightDataMap.get(trimmed);
		if (identityHit) {
			return identityHit;
		}

		const cfiKey = this.normalizeLocationKey(trimmed);
		const normalizedValue = EpubLinkService.normalizeCfi(trimmed);
		const matches: ReaderHighlight[] = [];
		const maps = [this.highlightDataMap, this.temporaryHighlightDataMap];
		for (const map of maps) {
			for (const highlight of map.values()) {
				if (
					this.normalizeLocationKey(highlight.cfiRange) === cfiKey ||
					EpubLinkService.normalizeCfi(highlight.cfiRange) === normalizedValue
				) {
					matches.push(highlight);
				}
			}
		}

		if (matches.length === 0) {
			return null;
		}
		if (matches.length === 1) {
			return matches[0];
		}

		const clickedText = clickRange?.toString().trim() || "";
		if (clickedText) {
			const normalizedClick = normalizeHighlightQuoteText(clickedText);
			const byText = matches.find(
				(highlight) => normalizeHighlightQuoteText(highlight.text) === normalizedClick
			);
			if (byText) {
				return byText;
			}
		}

		if (typeof sectionIndex === "number") {
			const bySection = matches.find((highlight) => highlight.chapterIndex === sectionIndex);
			if (bySection) {
				return bySection;
			}
		}

		return matches[0];
	}

	private findStoredHighlightByCfi(
		cfiRange: string,
		presentation?: ReaderHighlight["presentation"] | "temporary"
	): ReaderHighlight | null {
		const highlight = this.findHighlightForAnnotationValue(cfiRange);
		if (!highlight) {
			return null;
		}
		if (presentation === "conceal" && highlight.presentation !== "conceal") {
			return null;
		}
		if (presentation === "temporary" && !this.temporaryHighlightDataMap.has(
			getReaderHighlightIdentityKey(highlight)
		)) {
			return null;
		}
		return highlight;
	}

	private normalizeLocationKey(value: string): string {
		return this.normalizeLocationString(value).toLowerCase();
	}

	private normalizeLocationString(value: string): string {
		let normalized = String(value || "")
			.replace(/%5B/gi, "[")
			.replace(/%5D/gi, "]")
			.replace(/%7C/gi, "|")
			.trim();
		if (normalized.includes("%")) {
			try {
				normalized = decodeURIComponent(normalized);
			} catch {
				// Keep the original string when decoding fails.
			}
		}
		return normalized;
	}

	private attachThemeChangeListener(): void {
		if (this.themeChangeCleanup) {
			this.themeChangeCleanup();
			this.themeChangeCleanup = null;
		}

		let skipInitialNotification = true;
		this.themeChangeCleanup = UnifiedThemeManager.getInstance().addListener(() => {
			if (skipInitialNotification) {
				skipInitialNotification = false;
				return;
			}
			this.scheduleThemeRefresh();
		});
	}

	private scheduleThemeRefresh(): void {
		if (!this.renderContainer || !this.foliateView) {
			return;
		}

		const refreshToken = ++this.themeRefreshToken;
		if (this.pendingThemeRefreshFrame !== null) {
			window.cancelAnimationFrame(this.pendingThemeRefreshFrame);
		}

		this.pendingThemeRefreshFrame = window.requestAnimationFrame(() => {
			if (refreshToken !== this.themeRefreshToken) {
				this.pendingThemeRefreshFrame = null;
				return;
			}
			this.pendingThemeRefreshFrame = window.requestAnimationFrame(() => {
				this.pendingThemeRefreshFrame = null;
				void this.refreshThemeAfterHostChange(refreshToken);
			});
		});
	}

	private async refreshThemeAfterHostChange(refreshToken: number): Promise<void> {
		if (refreshToken !== this.themeRefreshToken || !this.renderContainer || !this.foliateView) {
			return;
		}

		try {
			this.applyHostThemeSurface();
			await this.applyReaderAppearance({});
			if (refreshToken !== this.themeRefreshToken || !this.foliateView) {
				return;
			}
			const renderer = this.foliateView.renderer as FoliateRenderer | undefined;
			this.applyRendererLayout();
			renderer?.render?.();
			await this.waitForAnimationFrame();
			if (refreshToken !== this.themeRefreshToken) {
				return;
			}
			this.applyHostThemeSurface();
			this.applyRendererLayout();
			renderer?.render?.();
			await this.waitForAnimationFrame();
			if (refreshToken !== this.themeRefreshToken) {
				return;
			}
			this.schedulePaginatedLayoutRecovery();
		} catch (error) {
			logger.warn(
				"[FoliateReaderService] Failed to refresh reader appearance after theme change:",
				error
			);
		}
	}

	private async destroyViewOnly(): Promise<void> {
		this.flushReadingPace();
		this.resetReadingPaceTracking();
		this.sessionGuard.invalidateViewSession();
		this.dismissFootnotePreview({ unpin: true });
		for (const cleanup of this.documentFootnoteCleanups.values()) {
			cleanup();
		}
		this.documentFootnoteCleanups.clear();
		for (const cleanup of this.documentSelectionCleanups.values()) {
			cleanup();
		}
		this.documentSelectionCleanups.clear();
		for (const cleanup of this.documentHighlightClickCleanups.values()) {
			cleanup();
		}
		this.documentHighlightClickCleanups.clear();
		for (const cleanup of this.documentWheelCleanups.values()) {
			cleanup();
		}
		this.documentWheelCleanups.clear();
		if (this.themeChangeCleanup) {
			this.themeChangeCleanup();
			this.themeChangeCleanup = null;
		}
		this.themeRefreshToken += 1;
		if (this.pendingThemeRefreshFrame !== null) {
			window.cancelAnimationFrame(this.pendingThemeRefreshFrame);
			this.pendingThemeRefreshFrame = null;
		}
		this.paginatedLayoutRecovery.bumpToken();
		if (this.renderContainerWheelCleanup) {
			this.renderContainerWheelCleanup();
			this.renderContainerWheelCleanup = null;
		}
		this.layoutChangeInFlight = false;
		this.resetWheelPageTurnState();
		this.wheelTurnInFlight = false;
		this.detachScrolledChapterEndMonitor();
		this.publishScrolledChapterEndState(false);

		const currentContainer = this.renderContainer;
		const currentView = this.foliateView;
		this.foliateView = null;
		this.renderContainer = null;
		this.renderedAnnotations.clear();
		this.resetAnnotationSyncState();
		this.loadedDocumentSectionIndexes = new WeakMap<Document, number>();
		this.lastSelectionByDocument = new WeakMap<Document, string>();

		if (currentContainer) {
			currentContainer.removeAttribute("data-foliate");
		}
		if (!currentView) {
			return;
		}

		currentView.removeEventListener("relocate", this.handleRelocateEvent as EventListener);
		currentView.removeEventListener("load", this.handleLoadEvent as EventListener);
		currentView.removeEventListener("link", this.handleLinkEvent as EventListener);
		currentView.removeEventListener(
			"draw-annotation",
			this.handleDrawAnnotationEvent as EventListener
		);
		currentView.removeEventListener(
			"show-annotation",
			this.handleShowAnnotationEvent as EventListener
		);
		try {
			currentView.close();
		} catch (error) {
			logger.warn("[FoliateReaderService] Failed to close foliate view cleanly:", error);
		}
		currentView.remove();
	}

	private async destroyAll(): Promise<void> {
		await this.destroyViewOnly();
		this.resetHighlightState();
		this.resetParagraphState();
		this.parser.dispose();
		this.resetReaderState();
		this.relocatedCallbacks.clear();
		this.scrolledChapterEndCallbacks.clear();
		this.footnotePreviewCallbacks.clear();
		this.selectionChangeCallbacks.clear();
		this.highlightClickCallbacks.clear();
		this.referenceBadgeClickCallbacks.clear();
	}

	private resetTemporaryHighlightTimers(): void {
		for (const timer of this.temporaryHighlightTimers.values()) {
			window.clearTimeout(timer);
		}
		this.temporaryHighlightTimers.clear();
	}

	private resetSourceLocateFocusTimers(): void {
		for (const timer of this.sourceLocateFocusTimers.values()) {
			window.clearTimeout(timer);
		}
		this.sourceLocateFocusTimers.clear();
	}

	private normalizeSourceLocateFocusCfiKey(cfiRange: string): string {
		return this.normalizeLocationKey(cfiRange);
	}

	private clearSourceLocateFocus(): void {
		if (this.sourceLocateFocusByCfiKey.size === 0) {
			return;
		}
		this.resetSourceLocateFocusTimers();
		this.sourceLocateFocusByCfiKey.clear();
	}

	private setSourceLocateFocus(cfiRange: string, color: string): void {
		const cfiKey = this.normalizeSourceLocateFocusCfiKey(cfiRange);
		if (!cfiKey) {
			return;
		}
		const existingTimer = this.sourceLocateFocusTimers.get(cfiKey);
		if (existingTimer) {
			window.clearTimeout(existingTimer);
		}
		this.sourceLocateFocusByCfiKey.set(cfiKey, {
			color,
			cfiRange: String(cfiRange || "").trim(),
		});
		const timer = window.setTimeout(() => {
			this.sourceLocateFocusTimers.delete(cfiKey);
			this.sourceLocateFocusByCfiKey.delete(cfiKey);
			void this.refreshHighlights();
		}, READER_SOURCE_LOCATE_FOCUS_DURATION_MS);
		this.sourceLocateFocusTimers.set(cfiKey, timer);
	}

	private getSourceLocateFocusColor(cfiRange: string): string | undefined {
		return this.sourceLocateFocusByCfiKey.get(
			this.normalizeSourceLocateFocusCfiKey(cfiRange)
		)?.color;
	}

	private collectSourceLocateOverlayAnchorCfis(): string[] {
		const cfis: string[] = [];
		const seen = new Set<string>();
		const pushCfi = (value: string | undefined): void => {
			const normalized = String(value || "").trim();
			if (!normalized || seen.has(normalized)) {
				return;
			}
			seen.add(normalized);
			cfis.push(normalized);
		};
		for (const highlight of this.temporaryHighlightDataMap.values()) {
			pushCfi(highlight.cfiRange);
		}
		for (const focus of this.sourceLocateFocusByCfiKey.values()) {
			pushCfi(focus.cfiRange);
		}
		return cfis;
	}

	private hasPersistentHighlightAtCfi(cfiRange: string): boolean {
		const cfiKey = this.normalizeSourceLocateFocusCfiKey(cfiRange);
		if (!cfiKey) {
			return false;
		}
		for (const highlight of this.highlightDataMap.values()) {
			if (this.normalizeSourceLocateFocusCfiKey(highlight.cfiRange) === cfiKey) {
				return true;
			}
		}
		return false;
	}

	private createRenderedAnnotationWithOptionalSourceLocateFocus(input: {
		persistentHighlight?: ReaderHighlight;
		temporaryHighlight?: ReaderHighlight;
		sourceLocateFocusColor?: string;
	}): RenderedReaderFoliateAnnotation {
		const rendered = createRenderedFoliateAnnotation({
			persistentHighlight: input.persistentHighlight,
			temporaryHighlight: input.temporaryHighlight,
			currentStrikethroughPresentation: this.currentStrikethroughPresentation,
			colorScheme: this.getCurrentColorScheme(),
			temporarilyRevealedConcealmentKeys: this.temporarilyRevealedConcealmentTimers,
		});
		if (!input.sourceLocateFocusColor) {
			return rendered;
		}
		const annotation = createReaderFoliateAnnotation(
			rendered.annotation,
			input.sourceLocateFocusColor
		);
		return {
			annotation,
			renderSignature: buildAnnotationRenderSignature({
				annotation,
				currentStrikethroughPresentation: this.currentStrikethroughPresentation,
				colorScheme: this.getCurrentColorScheme(),
				temporarilyRevealedConcealmentKeys: this.temporarilyRevealedConcealmentTimers,
			}),
		};
	}

	private async clearActiveTemporaryHighlights(): Promise<void> {
		if (this.temporaryHighlightDataMap.size === 0) {
			return;
		}
		this.resetTemporaryHighlightTimers();
		this.temporaryHighlightDataMap.clear();
		this.invalidateParagraphPresentation();
		await this.refreshHighlights();
	}

	private resetHighlightState(): void {
		this.resetTemporaryHighlightTimers();
		this.resetSourceLocateFocusTimers();
		this.sourceLocateFocusByCfiKey.clear();
		for (const timer of this.temporarilyRevealedConcealmentTimers.values()) {
			window.clearTimeout(timer);
		}
		this.temporarilyRevealedConcealmentTimers.clear();
		this.highlightDataMap.clear();
		this.temporaryHighlightDataMap.clear();
		this.highlightAnchorResolutionByKey.clear();
		this.savedHighlights = [];
		this.renderedAnnotations.clear();
		this.resetAnnotationSyncState();
	}

	private resetParagraphState(): void {
		this.paragraphCache.clear();
		this.paragraphRecordById.clear();
		this.paragraphRangeCache = new WeakMap<Document, Map<string, Range | null>>();
		this.paragraphPresentationRevision = 0;
	}

	private invalidateParagraphPresentation(): void {
		this.paragraphPresentationRevision += 1;
	}

	private resetReaderState(): void {
		this.resetReadingPaceTracking();
		this.currentBook = null;
		this.currentPosition = { chapterIndex: 0, cfi: "", percent: 0 };
		this.currentPaginationInfo = { currentPage: 0, totalPages: 0 };
		this.currentChapterTitle = "";
		this.currentChapterHref = "";
	}

	private collectSectionSlices(): SectionReadingSlice[] {
		const chapterCount = Math.max(this.parser.getMetadata().chapterCount, 0);
		const slices: SectionReadingSlice[] = [];
		for (let index = 0; index < chapterCount; index += 1) {
			const section = this.parser.getSectionReadingMetrics(index);
			if (!section) {
				continue;
			}
			slices.push({
				index: section.index,
				wordCount: section.wordCount,
				positionStart: section.positionStart,
				positionCount: section.positionCount,
			});
		}
		return slices;
	}

	private getConsumedBookWordsForPace(currentPage: number): number {
		return estimateConsumedBookWords(
			this.collectSectionSlices(),
			currentPage,
			this.parser.getTotalWordCount(),
			this.currentPosition.percent
		);
	}

	private markReaderActivity(): void {
		this.lastReaderActivityAt = Date.now();
	}

	private isDocumentVisibleForPace(): boolean {
		return typeof activeDocument === "undefined" || activeDocument.visibilityState === "visible";
	}

	private resetReadingPaceTracking(): void {
		this.readingPaceAnchor = null;
		this.pendingActiveReadMs = 0;
		this.lastReaderActivityAt = 0;
		this.currentSectionProgression = 0;
		this.stopPaceHeartbeat();
		if (this.paceVisibilityCleanup) {
			this.paceVisibilityCleanup();
			this.paceVisibilityCleanup = null;
		}
	}

	private stopPaceHeartbeat(): void {
		if (this.paceHeartbeatTimer !== null) {
			window.clearInterval(this.paceHeartbeatTimer);
			this.paceHeartbeatTimer = null;
		}
	}

	private attachReadingPaceListeners(): void {
		this.resetReadingPaceTracking();
		this.markReaderActivity();
		if (typeof activeDocument === "undefined") {
			return;
		}
		const onVisibility = () => {
			if (!this.isDocumentVisibleForPace()) {
				this.flushReadingPace();
			} else {
				this.markReaderActivity();
			}
		};
		activeDocument.addEventListener("visibilitychange", onVisibility);
		this.paceVisibilityCleanup = () => {
			activeDocument.removeEventListener("visibilitychange", onVisibility);
		};
		this.paceHeartbeatTimer = window.setInterval(() => {
			this.tickReadingPaceHeartbeat();
		}, FoliateReaderService.PACE_HEARTBEAT_MS);
	}

	private tickReadingPaceHeartbeat(): void {
		if (!this.currentBook || !this.foliateView) {
			return;
		}
		if (!this.isDocumentVisibleForPace()) {
			return;
		}
		const now = Date.now();
		if (now - this.lastReaderActivityAt > FoliateReaderService.PACE_IDLE_CUTOFF_MS) {
			return;
		}
		this.pendingActiveReadMs = Math.min(
			PACE_MAX_INTERVAL_MS,
			this.pendingActiveReadMs + FoliateReaderService.PACE_HEARTBEAT_MS
		);
	}

	private recordReadingPaceOnRelocate(
		currentPage: number,
		_chapterIndex: number,
		sectionProgression: number
	): void {
		if (!this.currentBook) {
			return;
		}
		this.markReaderActivity();
		this.currentSectionProgression = sectionProgression;

		const consumedBookWords = this.getConsumedBookWordsForPace(currentPage);
		const now = Date.now();

		if (!this.readingPaceAnchor) {
			this.readingPaceAnchor = createPaceAnchor(consumedBookWords, currentPage, now);
			return;
		}

		const wordsRead = Math.max(0, consumedBookWords - this.readingPaceAnchor.consumedBookWords);
		const pageAdvanced = currentPage > this.readingPaceAnchor.currentPage;
		const activeMs = Math.min(
			PACE_MAX_INTERVAL_MS,
			now - this.readingPaceAnchor.at + this.pendingActiveReadMs
		);
		this.pendingActiveReadMs = 0;

		if (!this.isDocumentVisibleForPace()) {
			this.readingPaceAnchor = createPaceAnchor(consumedBookWords, currentPage, now);
			return;
		}

		if (pageAdvanced || wordsRead >= PACE_MIN_INTERVAL_WORDS) {
			if (shouldRecordPaceInterval(wordsRead, activeMs, true)) {
				this.currentBook.readingStats = recordReadingInterval({
					stats: this.currentBook.readingStats,
					wordsRead,
					activeMs,
					now,
				});
			} else if (activeMs > 0) {
				const normalized = normalizeReadingPaceStats(this.currentBook.readingStats);
				this.currentBook.readingStats = {
					...normalized,
					totalReadTime: normalized.totalReadTime + activeMs,
					lastReadTime: now,
				};
			}
		}

		this.readingPaceAnchor = createPaceAnchor(consumedBookWords, currentPage, now);
	}

	private createNotReadyError(methodName: string): Error {
		return new Error(`FoliateReaderService not initialized yet: cannot call ${methodName}`);
	}

	private notifySelectionChange(cfiRange: string, frame: ReaderFrame): void {
		const event: ReaderSelectionChange = { cfiRange, frame };
		for (const listener of this.selectionChangeCallbacks) {
			try {
				listener(event);
			} catch (error) {
				logger.warn("[FoliateReaderService] Selection listener failed:", { cfiRange, error });
			}
		}
	}

	private notifyHighlightClick(info: HighlightClickInfo): void {
		this.dismissParagraphFootnotePreview({ unpin: true });
		for (const listener of this.highlightClickCallbacks) {
			try {
				listener(info);
			} catch (error) {
				logger.warn("[FoliateReaderService] Highlight click listener failed:", {
					cfiRange: info.cfiRange,
					error,
				});
			}
		}
	}

	private resolveHighlightTint(color?: string): string {
		return resolveReaderHighlightTint(this.getCurrentColorScheme(), color);
	}

	private normalizeCurrentPage(totalPositions: number): number {
		const currentPage = Math.round(this.currentPaginationInfo.currentPage || 0);
		if (currentPage > 0) {
			return Math.min(currentPage, Math.max(totalPositions, 1));
		}
		if (totalPositions <= 0) {
			return 0;
		}
		return Math.min(
			totalPositions,
			Math.max(1, Math.round((this.currentPosition.percent / 100) * totalPositions))
		);
	}

	private getConcealmentPalette(): {
		base: string;
		stripe: string;
		border: string;
	} {
		return readConcealmentPalette(this.getCurrentColorScheme());
	}

	private getObsidianStyleSource(): HTMLElement {
		return this.renderContainer || activeDocument.body || activeDocument.documentElement;
	}

	private getObsidianCSSVar(varName: string, fallback: string): string {
		return readObsidianCssVar(this.getObsidianStyleSource(), varName, fallback);
	}

	private getCurrentColorScheme(): "light" | "dark" {
		return readObsidianColorScheme();
	}

	private clamp(value: number, min: number, max: number): number {
		return Math.min(Math.max(value, min), max);
	}
}
