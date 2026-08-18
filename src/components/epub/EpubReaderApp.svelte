<script lang="ts">
        import type { App, WorkspaceLeaf, TAbstractFile, EventRef } from 'obsidian';
        import { setIcon, MarkdownView, Notice, Menu, TFile, Platform, normalizePath } from 'obsidian';
	import { onMount, untrack } from 'svelte';
	import { get } from 'svelte/store';
	import EpubReaderView from './EpubReaderView.svelte';
	import BookshelfView from './BookshelfView.svelte';
	import BottomNav from './BottomNav.svelte';
	import EpubLoadingState from './EpubLoadingState.svelte';
	import SelectionToolbar from './SelectionToolbar.svelte';
	import ParagraphReadingOverlay from './ParagraphReadingOverlay.svelte';
	import BookNotesExportPopover from './BookNotesExportPopover.svelte';
	import ScreenshotOverlay from './ScreenshotOverlay.svelte';
	import EpubTutorial from './EpubTutorial.svelte';
	import type { TutorialTabId } from './epub-tutorial-content';
	import EpubHighlightToolbar from './EpubHighlightToolbar.svelte';
	import EpubCommentEditorPopover from './EpubCommentEditorPopover.svelte';
	import EpubFootnotePreviewPopover from './EpubFootnotePreviewPopover.svelte';
	import ReferenceDetailModal from './ReferenceDetailModal.svelte';
	import EpubPremiumFeaturePopover from './EpubPremiumFeaturePopover.svelte';
	import { canUseEpubCanvasExcerpts, canUseEpubChapterExport, canUseEpubExcerptNotes, canUseEpubFootnotePreview, canUseEpubParagraphMode, canUseEpubReadingProgress, canUseEpubReadingReference, canUseEpubSourceLocation, canUseEpubStyledExcerpts, createEpubReaderEngine, DEFAULT_EPUB_EXCERPT_SETTINGS, ensureBookSourceLocationAccess, ensureEpubPremiumFeature, EPUB_RUNTIME, EpubAnnotationService, EpubLinkService, EpubLocationMigrationService, flushEpubPendingProgress, getEpubAnnotationIndexService, getEpubBacklinkHighlightService, getEpubHighlightViewSnapshotService, getEpubStorageService, isBookCompleted, resolveDisplayProgress, resolveEpubHost, resolveEpubWeaveOfficialAPI, warmEpubAnnotationIndexForPaths } from '../../services/epub';
	import { EpubBookmarkService } from '../../services/epub/EpubBookmarkService';
	import { EpubReferenceStatsService } from '../../services/epub/EpubReferenceStatsService';
	import {
		getDefaultEpubReaderSettings,
		normalizeEpubReaderSettingsForDevice,
		type EpubReaderSettingsDeviceKind,
	} from '../../services/epub/reader-settings';
	import type { ReferenceSourceInfo, ReferenceStats } from '../../services/epub/EpubReferenceStatsService';
	import type { BacklinkSourceMatch } from '../../services/epub/EpubBacklinkHighlightService';
	import { EpubScreenshotService } from '../../services/epub/EpubScreenshotService';
	import { EpubCanvasService } from '../../services/epub/EpubCanvasService';
	import {
		WEAVE_EPUB_CANVAS_LAYOUT_DIRECTION_EVENT,
		type WeaveEpubCanvasLayoutDirectionPayload,
	} from '../../services/epub/canvas-excerpt-anchor';
	import type { EpubVisibleFrameLike, ScreenshotRect } from '../../services/epub/EpubScreenshotService';
	import type { EpubBook, EpubExcerptSettings, EpubFlowMode, EpubHighlightStyle, EpubHostCapabilities, EpubLayoutMode, EpubParagraphModeReadingPosition, EpubParagraphModeTransitionStyle, EpubReaderEngine, EpubReaderSettings, EpubReadingReferencePoint, EpubWeaveExcerptRemovalMode, EpubWeaveOfficialAPI, EpubWeaveRemoveExcerptResult, FlashStyle, HighlightClickInfo, PaginationInfo, ReaderFootnotePreviewInfo, ReaderHighlight, ReaderParagraph, ReadingPosition, TocItem, EpubChapterReadingPointDraft } from '../../services/epub';
	import { PremiumFeatureGuard, PREMIUM_FEATURES } from '../../services/premium/PremiumFeatureGuard';
	import { getBookFormatDisplayLabel, isSupportedBookFile } from '../../services/epub/book-format';
	import {
		applyChapterHighlightsToMarkdownAsync,
		highlightBelongsToChapterExport,
		highlightTextAppearsInChapterDraft,
	} from '../../services/epub/chapter-marked-markdown-export';
	import type { FlatTocExportItem } from '../../services/epub/epub-toc-export-scope';
	import type { EpubTocChapterMark, EpubTocChapterMarkMap } from '../../services/epub/epub-toc-chapter-mark';
	import type { EpubTocChapterMarkSettings } from '../../services/epub/epub-toc-chapter-mark-settings';
	import {
		BookLoadCancelledError,
		buildBookLoadSlowWarningMessage,
		runBookLoadSession,
	} from '../../services/epub/book-load-session';
	import {
		canReuseExistingBook,
		resolveBookLoadRestoredPosition,
	} from '../../services/epub/epub-reader-book-load-helpers';
	import {
		ensureDefaultBookNotesExportTemplates,
		isMarkdownVaultFile,
		buildBookNotesExportLabelsFromTranslator,
		renderBookNotesMarkdown,
	} from '../../services/epub/book-notes-export/book-notes-export';
	import { resolveBookNotesExportTemplateFolder } from '../../services/epub/book-notes-export/template-folder';
	import {
		getBookshelfDisplayModeOptions,
		getBookshelfDisplayModeOption,
		normalizeBookshelfDisplayMode,
		type BookshelfDisplayMode,
	} from '../../services/epub/bookshelf-display-mode';
	import {
		createDebouncedBookshelfProgressChangedNotifier,
		dispatchEpubBookshelfDataChanged,
		dispatchEpubBookshelfRefreshRequest,
	} from '../../services/epub/bookshelf-data-events';
	import { epubActiveDocumentStore } from '../../stores/epub-active-document-store';
	import { logger } from '../../utils/logger';
	import { tr } from '../../utils/i18n';
	import { getOpenEpubFilePath, pathsReferToSameOpenBook } from '../../utils/epub-leaf-utils';
	import { showObsidianChoice, showObsidianConfirm } from '../../utils/obsidian-confirm';
	import { UnifiedThemeManager } from '../../utils/theme-detection';
	import { getSourceLocateOverlayService } from '../../services/ui/SourceLocateOverlayService';
	import { getNavigationHub } from '../../services/navigation/navigation-hub-access';
	import type { BookLocateIntent, NavigationIntent, PendingLocateState } from '../../services/navigation/navigation-intent';
	import { getBookSessionManager } from '../../services/epub/session/book-session-manager-access';
	import type { BookSession } from '../../services/epub/session/BookSessionManager';
	import {
		applyHighlightSourceOptimisticSyncResult,
		computeHighlightSourceOptimisticSync,
		getReaderHighlightIdentityKey,
		hasReaderHighlightPresentationChanged,
		mergeReaderHighlightsByIdentity,
	} from './useEpubHighlights';
	import {
		buildEpubDisplayHighlightSelectionKey,
		type EpubDisplayHighlight,
	} from '../../services/epub/EpubHighlightViewSnapshotService';
	import { createEpubNavigationController } from './useEpubNavigation';
	import { resolveReadingViewportLockTarget } from '../../utils/mobile-reading-viewport-lock';
	import { domInstanceOf } from '../../utils/dom-instance-of';
	import { shouldDismissToolbarOnPointerDown } from './toolbar-positioning';
	import { buildEpubMarkdownLocateCandidates } from '../../services/ui/source-locate-candidates';
	import { attachExternalHighlightSyncReload } from './external-highlight-sync-reload';
	import {
		attachEpubCardHighlightSyncBridge,
		buildEpubHighlightSyncSnapshot,
		type EpubSavedCardSnapshot,
	} from '../../services/epub/epub-card-highlight-sync';
	import { isEphemeralEditorHighlightSourcePath } from '../../services/epub/epub-highlight-source-path';
	import type { EpubHostCreateCardInput } from '../../services/epub';
	import {
		normalizeContinuousReadingPositionAutoSaveEnabled,
		normalizeContinuousReadingPositionAutoSavePages,
	} from '../../config/reading-position-auto-save';
	import '../../styles/epub/epub-reader.css';

	interface Props {
		app: App;
		filePath: string;
		pendingLocate?: PendingLocateState | null;
		pendingCfi?: string;
		pendingText?: string;
		autoInsertEnabled?: boolean;
		getLastActiveMarkdownLeaf?: () => WorkspaceLeaf | null;
		onTitleChange?: (title: string) => void;
		onChapterTitleChange?: (title: string) => void;
		onReadingReferencePointChange?: (point: EpubReadingReferencePoint | null) => void;
		onReadingPositionAutoSaveChange?: () => void;
		onPremiumUiStateChange?: () => void;
		onReaderSettingsLoaded?: (settings: EpubReaderSettings) => void;
		onBackFromBookshelf?: () => void | Promise<void>;
		onCancelBookLoad?: () => void | Promise<void>;
		onActionsReady?: (actions: {
			setAutoInsert: (enabled: boolean) => void;
			setScreenshotMode: (active: boolean) => void;
			setLayoutMode: (mode: EpubLayoutMode) => void;
			setFlowMode: (mode: EpubFlowMode) => void;
			toggleParagraphMode: () => void;
			openTypographyPanel: () => void;
			getReaderSettings: () => EpubReaderSettings;
			updateReaderSettings: (patch: Partial<EpubReaderSettings>) => Promise<void>;
			setScreenshotSaveMode: (saveAsImage: boolean) => void;
			navigateToCfi: (cfi: string, linkTextHint?: string) => void;
			toggleTutorial: () => void;
			addBookmark: () => Promise<void>;
			canUseReadingProgress?: () => boolean;
			canUseReadingReference?: () => boolean;
			canUseParagraphMode?: () => boolean;
			canUseExcerptNotes?: () => boolean;
			canUseStyledExcerpts?: () => boolean;
			canUseCanvasExcerpts?: () => boolean;
			canUseFootnotePreview?: () => boolean;
			isPremiumFeaturePreviewEnabled?: () => boolean;
			showPremiumFeaturePreview?: (featureId: string) => void;
			saveReadingReferencePoint?: () => Promise<void>;
			openReadingPositionMenu?: (event: MouseEvent | KeyboardEvent) => void;
			getReadingPositionAutoSaveEnabled?: () => boolean;
			setReadingPositionAutoSaveEnabled?: (enabled: boolean) => Promise<boolean>;
			bindCanvasPath: (canvasPath: string) => void;
			unbindCanvas: () => void;
			getCanvasService: () => EpubCanvasService;
			exportCurrentChapterToMarkdown?: () => Promise<void>;
			exportCurrentChapterMarkedToMarkdown?: () => Promise<void>;
			exportCurrentChapterHighlightsToMarkdown?: () => Promise<void>;
			exportBookHighlightsToMarkdown?: (event?: MouseEvent) => Promise<void>;
			getExcerptSettings: () => EpubExcerptSettings;
			updateExcerptSettings: (patch: Partial<EpubExcerptSettings>) => Promise<void>;
			prevPage: () => void | Promise<void>;
			nextPage: () => void | Promise<void>;
		}) => void;
		onSwitchBook?: (filePath: string) => void;
		onCanvasStateChange?: (active: boolean, canvasPath: string | null) => void;
		onCanvasLayoutDirectionChange?: (direction: import('../../services/epub/canvas-types').CanvasLayoutDirection) => void;
	}

	let { 
		app, 
		filePath, 
		pendingLocate = null,
		pendingCfi = '', 
		pendingText = '', 
		autoInsertEnabled: initialAutoInsert = false, 
		getLastActiveMarkdownLeaf, 
		onTitleChange, 
		onChapterTitleChange,
		onReadingReferencePointChange,
		onReadingPositionAutoSaveChange,
		onPremiumUiStateChange,
		onReaderSettingsLoaded, 
		onBackFromBookshelf,
		onCancelBookLoad,
		onActionsReady, 
		onSwitchBook, 
		onCanvasStateChange,
		onCanvasLayoutDirectionChange
	}: Props = $props();
	let t = $derived($tr);

	function getDefaultReaderLineHeight(): number {
		return getDefaultReaderSettings().lineHeight;
	}

	function getDefaultReaderPageMargin(): number {
		return getDefaultReaderSettings().pageMargin;
	}

	function getDefaultReaderWidthMode(): EpubReaderSettings['widthMode'] {
		return getDefaultReaderSettings().widthMode;
	}

	function getDefaultReaderFlowMode(): EpubReaderSettings['flowMode'] {
		return getDefaultReaderSettings().flowMode;
	}

	function isDesktopScrolledSideNavVisible(): boolean {
		return settings.flowMode === 'scrolled' && settings.showScrolledSideNav && !isMobileReader();
	}

	function getReaderRootStyle(): string {
		const effectiveLineHeight = typeof settings.lineHeight === 'number' && settings.lineHeight > 0
			? settings.lineHeight
			: getDefaultReaderLineHeight();
		const pagedSafeInset = `${(effectiveLineHeight * 0.5).toFixed(3)}em`;
		return `--epub-line-height: ${effectiveLineHeight}; --epub-paged-safe-top: ${pagedSafeInset}; --epub-paged-safe-bottom: ${pagedSafeInset};`;
	}

	let readerService: EpubReaderEngine = untrack(() => createEpubReaderEngine(app));
	let storageService = untrack(() => getEpubStorageService(app));
	let bookmarkService = untrack(() => new EpubBookmarkService(app));
	let annotationService = untrack(() => new EpubAnnotationService(storageService));
	let highlightViewSnapshotService = untrack(() => getEpubHighlightViewSnapshotService(app));
	let locationMigrationService = untrack(() => new EpubLocationMigrationService(app, storageService, readerService));
	let linkService = untrack(() => new EpubLinkService(app));
	let screenshotService = untrack(() => new EpubScreenshotService(app));
	let canvasService = untrack(() => new EpubCanvasService(app));
	let backlinkService = untrack(() => getEpubBacklinkHighlightService(app));
	let referenceStatsService = untrack(() => new EpubReferenceStatsService(app, backlinkService));

	let book = $state<EpubBook | null>(null);
	let loading = $state(true);
	let bookLoadSlowWarning = $state(false);
	let errorMsg = $state('');
	let readingProgress = $state(0);
	let paginationInfo = $state<PaginationInfo>({ currentPage: 0, totalPages: 0 });
	let currentChapterIndex = $state(0);
	let showScrolledChapterNavActions = $state(false);
	let readerVersion = $state(0);
	let autoInsert = $state(untrack(() => initialAutoInsert));
	let screenshotMode = $state(false);
	let screenshotSaveAsImage = $state(true);
	let tutorialVisible = $state(false);
	let tutorialInitialTab = $state<TutorialTabId | undefined>(undefined);
	let readerTutorialDismissed = $state(false);
	let tutorialDismissStateReady = untrack(() =>
		storageService.loadPluginUiMemory().then((memory) => {
			readerTutorialDismissed = memory.readerTutorialDismissed;
		}).catch((error) => {
			logger.warn('[EpubReaderApp] Failed to load tutorial dismiss state:', error);
		})
	);
	let canvasMode = $state(false);
	let transientStatusText = $state('');
	let readingReferencePoint = $state<EpubReadingReferencePoint | null>(null);
	let sessionReadingStartPercent = $state<number | null>(null);
	let bookCompletionPromptOpen = false;
	let bookCompletionPromptDismissedBookId = '';
	let premiumFeaturePreviewEnabled = $state(false);
	let isPremiumLicenseActive = $state(false);
	let premiumFeaturePreviewFeatureId = $state<string | null>(null);
	let paragraphModeSelection = $state<{
		text: string;
		cfiRange: string;
		rect: DOMRect;
		rects: DOMRect[];
		clear: () => void;
	} | null>(null);
	let paragraphModeLocation = $state<{ paragraphs: ReaderParagraph[]; currentIndex: number } | null>(null);
	let paragraphModeBusy = $state(false);
	let paragraphModeImmersive = $state(false);
	let paragraphModeAnchorParagraphId = '';
	let paragraphModeSuppressReactiveRefresh = 0;
	let paragraphModeLastNavigationAt = 0;
	let paragraphModePersistTimer: ReturnType<typeof setTimeout> | null = null;
	let paragraphModeDetachedSession = $state(false);
	let paragraphModeDetachedSnapshot = $state<{
		readingPosition: ReadingPosition;
		paragraphId?: string;
		paragraphIndex?: number;
		paragraphTextPreview?: string;
	} | null>(null);
	const PARAGRAPH_MODE_PERSIST_DEBOUNCE_MS = 1400;
	const PARAGRAPH_MODE_REACTIVE_REFRESH_COOLDOWN_MS = 450;
	let rootEl = $state<HTMLDivElement | null>(null);
	let viewportEl = $state<HTMLDivElement | null>(null);
	let readingViewportLockEl = $derived(resolveReadingViewportLockTarget(rootEl));
	let exportNotesPopoverEl = $state<HTMLDivElement | null>(null);
	let exportNotesPopoverOpen = $state(false);
	let exportNotesSubmitting = $state(false);
	let typographyPopoverOpen = $state(false);
	let paragraphModeNavBottomOffset = $state(0);
	let readerReady = $state(false);
	let scrolledNavSyncFrame = 0;
	let scrolledNavResizeObserver: ResizeObserver | null = null;
	let highlightToolbarInfo = $state<HighlightClickInfo | null>(null);
	let commentEditorInfo = $state<HighlightClickInfo | null>(null);
	let footnotePreviewInfo = $state<ReaderFootnotePreviewInfo | null>(null);
	let referencePopoverInfo = $state<HighlightClickInfo | null>(null);
	let referencePopoverStats = $state<ReferenceStats | null>(null);
	let commentEditorDraft = $state('');
	let commentEditorSaving = $state(false);
	const SCROLLED_NAV_FRAME_INSET_VAR = '--epub-scrolled-side-nav-frame-inset-end';
	const SCROLLED_NAV_SCROLLBAR_VAR = '--epub-scrolled-side-nav-scrollbar-width';
	let excerptSettings = $state<EpubExcerptSettings>({
		...DEFAULT_EPUB_EXCERPT_SETTINGS,
		bookNotesExportTemplateFolder: '',
	});
	let excerptSettingsLoaded = $state(false);
	let excerptSettingsReady: Promise<void> = Promise.resolve();
	let trackedHighlightSourceFiles = new Set<string>();
	let bookSession = untrack(() => getBookSessionManager(app).acquire(filePath));
	let vaultEventRefs: EventRef[] = [];
	let pendingLoadedHighlights: ReaderHighlight[] | null = null;
	let highlightReloadToken = 0;
	let highlightReloading = $state(false);
	let annotationRevision = $state(0);
	let bookmarkRevision = $state(0);
	let tocChapterMarks = $state<EpubTocChapterMarkMap>({});
	let tocChapterMarkSettings = $state<EpubTocChapterMarkSettings>({});
	let tocChapterMarkRevision = $state(0);
	let tocChapterMarkSettingsRevision = $state(0);
	let migratedLocationBookIds = new Set<string>();
	let migratingLocationBookId: string | null = null;
	let referenceBadgeClickCleanup: (() => void) | null = null;
	let scrolledChapterEndCleanup: (() => void) | null = null;
	const sourceLocateOverlay = getSourceLocateOverlayService();
	let hasPendingBookLocate = $state(false);
	const epubNavigation = untrack(() =>
		createEpubNavigationController({
			getReaderReady: () => readerReady,
			getReaderService: () => readerService,
			getSourceLocateOverlay: () => sourceLocateOverlay,
			getLocateOverlayLabel: () => t('epub.reader.locateSourcePosition'),
			onPendingChange: (hasPending) => {
				hasPendingBookLocate = hasPending;
			},
		})
	);
	let transientStatusTimer: ReturnType<typeof setTimeout> | null = null;
	let deferredHighlightReloadTimer: ReturnType<typeof setTimeout> | null = null;
	let componentDisposed = false;
	let activeBookLoadToken = 0;
	let readerStoreSyncTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingReaderStorePatch: Record<string, unknown> = {};
	const READER_STORE_SYNC_MS = 350;

	function icon(node: HTMLElement, name: string) {
		setIcon(node, name);
		return {
			update(newName: string) {
				// /skip innerHTML is used to clear the trusted icon container before setIcon rerenders it
				node.replaceChildren();
				setIcon(node, newName);
			}
		};
	}

	let settings = $state<EpubReaderSettings>({
		lineHeight: getDefaultReaderLineHeight(),
		letterSpacing: 0,
		pageMargin: getDefaultReaderPageMargin(),
		viewportSidePadding: Platform.isMobile ? 18 : 24,
		theme: 'default',
		widthMode: getDefaultReaderWidthMode(),
		layoutMode: 'paginated',
		flowMode: getDefaultReaderFlowMode(),
		showScrolledSideNav: true,
		footnoteClickAction: 'preview',
		paragraphModeEnabled: false,
		paragraphModeFontSize: 'medium',
		paragraphModeFontScale: 100,
		paragraphModeSurfaceStyle: 'spotlight',
		paragraphModeTransitionStyle: 'settle',
	});

	const paragraphTransitionStyleOptions: Array<{
		value: EpubParagraphModeTransitionStyle;
		labelKey: string;
	}> = [
		{ value: 'steady', labelKey: 'epub.reader.paragraphMode.transitionStyleSteady' },
		{ value: 'fade', labelKey: 'epub.reader.paragraphMode.transitionStyleFade' },
		{ value: 'settle', labelKey: 'epub.reader.paragraphMode.transitionStyleSettle' },
		{ value: 'slide', labelKey: 'epub.reader.paragraphMode.transitionStyleSlide' },
	];
	let hostTheme = $state<'light' | 'dark'>(
		untrack(() => (UnifiedThemeManager.getInstance().isDarkMode() ? 'dark' : 'light'))
	);

	function isMobileReader(): boolean {
		return Platform.isMobile;
	}

	function getReaderDeviceKind(): EpubReaderSettingsDeviceKind {
		return isMobileReader() ? 'mobile' : 'desktop';
	}

	function getDefaultReaderSettings(): EpubReaderSettings {
		return getDefaultEpubReaderSettings(getReaderDeviceKind());
	}

	function hasReadingProgressCapability(): boolean {
		return canUseEpubReadingProgress(app);
	}

	function hasReadingReferenceCapability(): boolean {
		return canUseEpubReadingReference(app);
	}

	function hasParagraphModeCapability(): boolean {
		return canUseEpubParagraphMode(app);
	}

	function hasExcerptNotesCapability(): boolean {
		return canUseEpubExcerptNotes(app);
	}

	function hasStyledExcerptCapability(): boolean {
		return canUseEpubStyledExcerpts(app);
	}

	function hasSourceLocationCapability(): boolean {
		return canUseEpubSourceLocation(app);
	}

	function hasCanvasExcerptCapability(): boolean {
		return canUseEpubCanvasExcerpts(app);
	}

	function hasFootnotePreviewCapability(): boolean {
		return canUseEpubFootnotePreview(app);
	}

	function hasChapterExportCapability(): boolean {
		return canUseEpubChapterExport(app);
	}

	function isPremiumFeaturePreviewEnabled(): boolean {
		return premiumFeaturePreviewEnabled;
	}

	function getPremiumFeatureEntryTitle(baseTitle: string, featureId: string): string {
		return PremiumFeatureGuard.getInstance().getFeatureEntryTitle(baseTitle, featureId, {
			page: 'epub-reader',
		});
	}

	function getReadingPositionLabel(percent: number): string {
		return t('epub.reader.readingPosition', { percent: Math.round(percent) });
	}

	function closePremiumFeaturePreview(): void {
		premiumFeaturePreviewFeatureId = null;
	}

	function notifyPremiumUiStateChanged(): void {
		if (isPremiumLicenseActive) {
			closePremiumFeaturePreview();
		}
		void refreshReadingReferencePointState(book?.id);
		syncAsActiveEpubDocumentIfActive();
		onReadingPositionAutoSaveChange?.();
		onPremiumUiStateChange?.();
	}

	function handlePremiumFeaturePreviewRequest(event: Event): void {
		const featureId = String((event as CustomEvent<{ featureId?: string }>).detail?.featureId || '').trim();
		if (!featureId) {
			return;
		}
		openPremiumFeaturePreview(featureId);
	}

	function openPremiumFeaturePreview(featureId: string): void {
		const normalizedFeatureId = String(featureId || '').trim();
		if (!normalizedFeatureId) {
			return;
		}
		clearParagraphModeSelection();
		highlightToolbarInfo = null;
		closeCommentEditor();
		footnotePreviewInfo = null;
		exportNotesPopoverOpen = false;
		typographyPopoverOpen = false;
		premiumFeaturePreviewFeatureId = normalizedFeatureId;
	}

	function requestParagraphModeFeatureAccess(): boolean {
		if (hasParagraphModeCapability()) {
			return true;
		}
		if (isPremiumFeaturePreviewEnabled()) {
			openPremiumFeaturePreview(PREMIUM_FEATURES.EPUB_PARAGRAPH_MODE);
			return false;
		}
		return ensureEpubPremiumFeature(
			app,
			PREMIUM_FEATURES.EPUB_PARAGRAPH_MODE,
			t('epub.reader.paragraphModeFeatureNotice')
		);
	}

	function normalizeFootnoteClickActionForAccess(
		action: EpubReaderSettings['footnoteClickAction'] | undefined
	): EpubReaderSettings['footnoteClickAction'] {
		const normalizedAction = action === 'navigate' || action === 'preview' ? action : 'preview';
		return normalizedAction === 'preview' && !hasFootnotePreviewCapability()
			? 'navigate'
			: normalizedAction;
	}

	function normalizeReaderSettings(readerSettings: EpubReaderSettings): EpubReaderSettings {
		const normalizedSettings = normalizeEpubReaderSettingsForDevice(getReaderDeviceKind(), {
			...readerSettings,
			footnoteClickAction: normalizeFootnoteClickActionForAccess(readerSettings.footnoteClickAction),
		});

		return normalizedSettings;
	}

	function setError(message: string) {
		clearTransientStatus();
		errorMsg = message;
		loading = false;
	}

	function clearTransientStatus() {
		if (transientStatusTimer) {
			clearTimeout(transientStatusTimer);
			transientStatusTimer = null;
		}
		transientStatusText = '';
	}

	function showTransientStatus(message: string, durationMs = 2200) {
		if (transientStatusTimer) {
			clearTimeout(transientStatusTimer);
			transientStatusTimer = null;
		}
		transientStatusText = message;
		if (durationMs > 0) {
			transientStatusTimer = setTimeout(() => {
				transientStatusTimer = null;
				transientStatusText = '';
			}, durationMs);
		}
	}

	function clampReaderSetting(value: number, min: number, max: number, digits = 2): number {
		const clamped = Math.min(Math.max(value, min), max);
		return Number(clamped.toFixed(digits));
	}

	function openTypographyPanel() {
		typographyPopoverOpen = true;
	}

	function closeTypographyPanel() {
		typographyPopoverOpen = false;
	}

	function clearParagraphModeSelection(): void {
		paragraphModeSelection?.clear?.();
		paragraphModeSelection = null;
	}

	function updateParagraphModeAnchorParagraphId(location: { paragraphs: ReaderParagraph[]; currentIndex: number } | null): void {
		const paragraph = location?.paragraphs?.[location.currentIndex];
		paragraphModeAnchorParagraphId = paragraph?.id || '';
	}

	async function persistParagraphModeReadingPositionFromLocation(
		location: { paragraphs: ReaderParagraph[]; currentIndex: number } | null = paragraphModeLocation
	): Promise<void> {
		const currentBook = book;
		if (!currentBook || !location || location.paragraphs.length === 0) {
			return;
		}
		const activeIndex = Math.max(0, Math.min(location.currentIndex, location.paragraphs.length - 1));
		const paragraph = location.paragraphs[activeIndex];
		if (!paragraph?.id || !paragraph.cfiRange) {
			return;
		}
		const currentPosition = readerService.getCurrentPosition();
		const payload: EpubParagraphModeReadingPosition = {
			bookId: currentBook.id,
			filePath: currentBook.filePath,
			bookTitle: currentBook.metadata.title || '',
			chapterTitle: paragraph.chapterTitle || readerService.getCurrentChapterTitle() || '',
			chapterHref: paragraph.chapterHref || readerService.getCurrentChapterHref?.() || '',
			chapterIndex: paragraph.chapterIndex,
			cfi: paragraph.cfiRange,
			percent: Number.isFinite(currentPosition.percent) ? currentPosition.percent : 0,
			paragraphId: paragraph.id,
			paragraphIndex: activeIndex,
			paragraphTextPreview: paragraph.text.slice(0, 160),
			savedAt: Date.now(),
		};
		await storageService.saveParagraphModeReadingPosition(payload);
	}

	async function persistParagraphModeReadingProgress(
		location: { paragraphs: ReaderParagraph[]; currentIndex: number } | null = paragraphModeLocation
	): Promise<void> {
		if (paragraphModeDetachedSession) {
			return;
		}
		await persistParagraphModeReadingPositionFromLocation(location);
		const currentBook = book;
		if (!currentBook?.id || !hasReadingProgressCapability()) {
			return;
		}
		const currentPosition = readerService.getCurrentPosition();
		if (!currentPosition?.cfi) {
			return;
		}
		readerService.flushReadingPace?.();
		const readingStats = readerService.getReadingStats?.() ?? currentBook.readingStats;
		if (readingStats) {
			currentBook.readingStats = readingStats;
		}
		currentBook.currentPosition = currentPosition;
		await storageService.saveProgress(currentBook.id, currentPosition, readingStats);
		await flushEpubPendingProgress(storageService);
		await syncReadingReferencePointFromAutoSave(currentPosition);
		notifyBookshelfProgressChanged(currentBook.filePath);
	}

	async function showParagraphExitAnchor(paragraph: ReaderParagraph): Promise<void> {
		if (!paragraph.cfiRange || typeof readerService.navigateAndHighlight !== 'function') {
			return;
		}
		const anchorText = paragraph.text.slice(0, 120);
		try {
			await readerService.navigateAndHighlight({
				cfi: paragraph.cfiRange,
				text: anchorText,
				flashStyle: 'highlight',
			});
			window.setTimeout(() => {
				const rect = readerService.getNavigationTargetRect?.({
					cfi: paragraph.cfiRange,
					text: anchorText,
				});
				if (rect) {
					sourceLocateOverlay.showAtRect(rect, {
						label: t('epub.reader.paragraphMode.exitAnchor'),
						icon: 'bookmark',
						durationMs: 3200,
					});
				}
			}, 80);
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to show paragraph mode exit anchor:', error);
		}
	}

	function clearParagraphModeDetachedSession(): void {
		paragraphModeDetachedSession = false;
		paragraphModeDetachedSnapshot = null;
	}

	async function beginParagraphModeDetachedSession(): Promise<void> {
		const currentBook = book;
		if (!currentBook || paragraphModeDetachedSession) {
			return;
		}
		if (paragraphModePersistTimer) {
			clearTimeout(paragraphModePersistTimer);
			paragraphModePersistTimer = null;
			await persistParagraphModeReadingProgress();
		}
		const activeLocation = paragraphModeLocation;
		const activeIndex = activeLocation?.currentIndex ?? 0;
		const activeParagraph = activeLocation?.paragraphs?.[activeIndex];
		const livePosition = readerReady ? readerService.getCurrentPosition() : currentBook.currentPosition;
		const readingPosition: ReadingPosition = {
			chapterIndex:
				typeof livePosition?.chapterIndex === 'number'
					? livePosition.chapterIndex
					: currentBook.currentPosition?.chapterIndex || 0,
			cfi: String(livePosition?.cfi || currentBook.currentPosition?.cfi || '').trim(),
			percent:
				typeof livePosition?.percent === 'number' && Number.isFinite(livePosition.percent)
					? livePosition.percent
					: currentBook.currentPosition?.percent || 0,
		};
		if (!readingPosition.cfi) {
			return;
		}
		paragraphModeDetachedSnapshot = {
			readingPosition,
			paragraphId: activeParagraph?.id,
			paragraphIndex: activeIndex,
			paragraphTextPreview: activeParagraph?.text.slice(0, 120),
		};
		paragraphModeDetachedSession = true;
	}

	async function restoreParagraphModeDetachedSnapshot(
		snapshot: {
			readingPosition: ReadingPosition;
			paragraphId?: string;
			paragraphIndex?: number;
			paragraphTextPreview?: string;
		} | null = paragraphModeDetachedSnapshot
	): Promise<void> {
		if (!snapshot?.readingPosition?.cfi) {
			return;
		}
		try {
			await readerService.goToLocation(snapshot.readingPosition.cfi);
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to restore reading position after detached paragraph session:', error);
		}
	}

	async function showParagraphModeDetachedExitAnchor(
		snapshot: {
			readingPosition: ReadingPosition;
			paragraphTextPreview?: string;
		}
	): Promise<void> {
		if (!snapshot.readingPosition?.cfi || typeof readerService.navigateAndHighlight !== 'function') {
			return;
		}
		const anchorText = String(snapshot.paragraphTextPreview || '').trim();
		try {
			await readerService.navigateAndHighlight({
				cfi: snapshot.readingPosition.cfi,
				text: anchorText || undefined,
				flashStyle: 'highlight',
			});
			window.setTimeout(() => {
				const rect = readerService.getNavigationTargetRect?.({
					cfi: snapshot.readingPosition.cfi,
					text: anchorText || undefined,
				});
				if (rect) {
					sourceLocateOverlay.showAtRect(rect, {
						label: t('epub.reader.paragraphMode.exitAnchor'),
						icon: 'bookmark',
						durationMs: 3200,
					});
				}
			}, 80);
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to show detached paragraph mode exit anchor:', error);
		}
	}

	async function exitParagraphModeToMainReader(options?: {
		persist?: boolean;
		disableSetting?: boolean;
		showExitAnchor?: boolean;
		notifySaved?: boolean;
	}): Promise<void> {
		const activeLocation = paragraphModeLocation;
		const activeIndex = activeLocation?.currentIndex ?? 0;
		const activeParagraph = activeLocation?.paragraphs?.[activeIndex];
		const detachedSnapshot = paragraphModeDetachedSnapshot;
		const wasDetachedSession = paragraphModeDetachedSession;
		const shouldPersist = options?.persist !== false && Boolean(activeParagraph) && !wasDetachedSession;
		const shouldDisableSetting = options?.disableSetting !== false;
		const shouldShowExitAnchor = options?.showExitAnchor !== false;
		const shouldNotifySaved = options?.notifySaved !== false;

		// Disable paragraph mode before async persistence so reactive refresh cannot reopen the overlay.
		if (shouldDisableSetting && settings.paragraphModeEnabled) {
			applyAndPersistReaderSettings({
				...settings,
				paragraphModeEnabled: false,
			});
		}
		clearParagraphModeSelection();
		paragraphModeLocation = null;
		paragraphModeAnchorParagraphId = '';
		clearParagraphModeDetachedSession();
		await setParagraphModeImmersive(false);

		if (!shouldPersist && !shouldShowExitAnchor && !wasDetachedSession) {
			return;
		}

		void (async () => {
			if (wasDetachedSession && detachedSnapshot) {
				try {
					if (paragraphModePersistTimer) {
						clearTimeout(paragraphModePersistTimer);
						paragraphModePersistTimer = null;
					}
					await restoreParagraphModeDetachedSnapshot(detachedSnapshot);
					if (shouldShowExitAnchor) {
						await showParagraphModeDetachedExitAnchor(detachedSnapshot);
					}
				} catch (error) {
					logger.warn('[EpubReaderApp] Failed to restore detached paragraph mode reading position on exit:', error);
				}
				return;
			}
			if (shouldPersist && activeLocation) {
				try {
					if (paragraphModePersistTimer) {
						clearTimeout(paragraphModePersistTimer);
						paragraphModePersistTimer = null;
					}
					await persistParagraphModeReadingProgress(activeLocation);
					if (shouldNotifySaved) {
						showTransientStatus(t('epub.reader.paragraphMode.positionSaved'), 2200);
						new Notice(t('epub.reader.paragraphMode.positionSaved'));
					}
				} catch (error) {
					logger.warn('[EpubReaderApp] Failed to persist paragraph mode reading progress on exit:', error);
				}
			}
			if (shouldShowExitAnchor && activeParagraph?.cfiRange) {
				try {
					await showParagraphExitAnchor(activeParagraph);
				} catch (error) {
					logger.warn('[EpubReaderApp] Failed to show paragraph mode exit anchor:', error);
				}
			}
		})();
	}

	function setParagraphModeImmersiveClass(active: boolean): void {
		document.body.classList.toggle('weave-epub-immersive-paragraph-mode', active);
		document.documentElement.classList.toggle('weave-epub-immersive-paragraph-mode', active);
	}

	async function setParagraphModeImmersive(active: boolean): Promise<void> {
		if (paragraphModeImmersive === active) {
			return;
		}
		paragraphModeImmersive = active;
		setParagraphModeImmersiveClass(active);
		if (active) {
			try {
				const fullscreenHost = document.documentElement;
				if (document.fullscreenElement !== fullscreenHost) {
					await fullscreenHost.requestFullscreen?.();
				}
			} catch (error) {
				logger.warn('[EpubReaderApp] Failed to enter immersive fullscreen paragraph mode:', error);
			}
			return;
		}
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen?.();
			}
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to exit immersive fullscreen paragraph mode:', error);
		}
	}

	function toggleParagraphModeImmersive(): void {
		void setParagraphModeImmersive(!paragraphModeImmersive);
	}

	function handleFullscreenChange(): void {
		const active = Boolean(document.fullscreenElement);
		if (!active && paragraphModeImmersive) {
			paragraphModeImmersive = false;
			setParagraphModeImmersiveClass(false);
		}
	}

	async function closeParagraphMode(options?: { persist?: boolean }): Promise<void> {
		try {
			await exitParagraphModeToMainReader({
				persist: options?.persist,
				disableSetting: options?.persist !== false,
				showExitAnchor: true,
				notifySaved: options?.persist !== false,
			});
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to close paragraph mode:', error);
			if (settings.paragraphModeEnabled) {
				applyAndPersistReaderSettings({
					...settings,
					paragraphModeEnabled: false,
				});
			}
			clearParagraphModeSelection();
			paragraphModeLocation = null;
			paragraphModeAnchorParagraphId = '';
			await setParagraphModeImmersive(false);
		}
	}

	function scheduleParagraphModePersist(): void {
		if (paragraphModeDetachedSession) {
			return;
		}
		if (paragraphModePersistTimer) {
			clearTimeout(paragraphModePersistTimer);
		}
		paragraphModePersistTimer = setTimeout(() => {
			paragraphModePersistTimer = null;
			void persistParagraphModeReadingProgress();
		}, PARAGRAPH_MODE_PERSIST_DEBOUNCE_MS);
	}

	function applyParagraphModeIndex(
		location: { paragraphs: ReaderParagraph[]; currentIndex: number },
		targetIndex: number
	): void {
		const boundedIndex = Math.max(0, Math.min(targetIndex, location.paragraphs.length - 1));
		paragraphModeLocation = {
			paragraphs: location.paragraphs,
			currentIndex: boundedIndex,
		};
		updateParagraphModeAnchorParagraphId(paragraphModeLocation);
	}

	async function hydrateParagraphModeActiveParagraph(targetIndex: number): Promise<void> {
		const location = paragraphModeLocation;
		const paragraph = location?.paragraphs?.[targetIndex];
		if (!paragraph?.id || typeof readerService.hydrateReaderParagraph !== 'function') {
			return;
		}
		if (paragraph.html) {
			return;
		}
		const hydrated = await readerService.hydrateReaderParagraph(paragraph.id);
		if (!hydrated || paragraphModeLocation?.paragraphs?.[targetIndex]?.id !== paragraph.id) {
			return;
		}
		const paragraphs = [...paragraphModeLocation.paragraphs];
		paragraphs[targetIndex] = hydrated;
		paragraphModeLocation = {
			paragraphs,
			currentIndex: paragraphModeLocation.currentIndex,
		};
	}

	async function syncParagraphModeAnchor(cfi: string): Promise<void> {
		if (typeof readerService.syncParagraphAnchor === 'function') {
			await readerService.syncParagraphAnchor(cfi);
			return;
		}
		await readerService.goToLocation(cfi);
	}

	async function refreshParagraphModeLocation(
		preferredIndex?: number,
		preferredParagraphId?: string,
		options?: { persist?: boolean }
	): Promise<void> {
		if (!settings.paragraphModeEnabled || !readerReady || typeof readerService.getCurrentParagraphLocation !== 'function') {
			paragraphModeLocation = null;
			return;
		}
		paragraphModeBusy = true;
		try {
			const location = await readerService.getCurrentParagraphLocation({
				preferredIndex,
				preferredParagraphId,
			});
			if (!location || location.paragraphs.length === 0) {
				paragraphModeLocation = null;
				paragraphModeAnchorParagraphId = '';
				return;
			}
			paragraphModeLocation = location;
			updateParagraphModeAnchorParagraphId(location);
			if (options?.persist !== false && !paragraphModeDetachedSession) {
				scheduleParagraphModePersist();
			}
		} finally {
			paragraphModeBusy = false;
		}
	}

	async function setParagraphModeEnabled(enabled: boolean): Promise<void> {
		if (enabled && !requestParagraphModeFeatureAccess()) {
			return;
		}
		if (enabled === settings.paragraphModeEnabled) {
			if (enabled) {
				await refreshParagraphModeLocation(undefined, paragraphModeAnchorParagraphId || undefined);
			}
			return;
		}
		clearParagraphModeSelection();
		highlightToolbarInfo = null;
		closeCommentEditor();
		footnotePreviewInfo = null;
		referencePopoverInfo = null;
		referencePopoverStats = null;
		screenshotMode = false;
		if (!enabled) {
			await exitParagraphModeToMainReader({
				persist: true,
				disableSetting: true,
				showExitAnchor: true,
				notifySaved: false,
			});
			return;
		}
		applyAndPersistReaderSettings({
			...settings,
			paragraphModeEnabled: true,
		});
		const savedParagraphPosition = book
			? await storageService.loadParagraphModeReadingPosition(book.id)
			: null;
		if (savedParagraphPosition?.cfi) {
			try {
				await readerService.goToLocation(savedParagraphPosition.cfi);
			} catch (error) {
				logger.warn('[EpubReaderApp] Failed to restore paragraph mode reading position:', error);
			}
		}
		await refreshParagraphModeLocation();
		if (savedParagraphPosition?.paragraphId && paragraphModeLocation?.paragraphs?.length) {
			const restoredIndex = paragraphModeLocation.paragraphs.findIndex(
				(item) => item.id === savedParagraphPosition.paragraphId
			);
			if (restoredIndex >= 0) {
				await refreshParagraphModeLocation(restoredIndex);
			}
		}
	}

	function toggleParagraphMode(): void {
		void setParagraphModeEnabled(!settings.paragraphModeEnabled);
	}

	async function setParagraphModeTransitionStyle(nextStyle: EpubParagraphModeTransitionStyle): Promise<void> {
		if (nextStyle === settings.paragraphModeTransitionStyle) {
			return;
		}
		await updateReaderSettings({
			paragraphModeTransitionStyle: nextStyle,
		});
	}

	async function navigateToRandomParagraph(): Promise<void> {
		if (!settings.paragraphModeEnabled || paragraphModeBusy || !readerReady) {
			return;
		}
		if (typeof readerService.pickRandomParagraph !== 'function') {
			return;
		}
		const shouldStartDetachedSession = !paragraphModeDetachedSession;
		if (shouldStartDetachedSession) {
			await beginParagraphModeDetachedSession();
			if (!paragraphModeDetachedSession) {
				return;
			}
		}
		const currentParagraph = paragraphModeLocation?.paragraphs?.[paragraphModeLocation.currentIndex];
		const pick = await readerService.pickRandomParagraph({
			excludeParagraphId: currentParagraph?.id,
		});
		if (!pick?.paragraph?.cfiRange) {
			if (shouldStartDetachedSession) {
				clearParagraphModeDetachedSession();
			}
			showTransientStatus(t('epub.reader.paragraphMode.randomReadingUnavailable'), 2200);
			return;
		}

		paragraphModeBusy = true;
		paragraphModeSuppressReactiveRefresh += 1;
		try {
			clearParagraphModeSelection();
			applyParagraphModeIndex(
				{ paragraphs: pick.chapterParagraphs, currentIndex: pick.paragraphIndex },
				pick.paragraphIndex
			);
			void hydrateParagraphModeActiveParagraph(pick.paragraphIndex);
			try {
				await syncParagraphModeAnchor(pick.paragraph.cfiRange);
			} catch (error) {
				logger.warn('[EpubReaderApp] Failed to navigate to random paragraph:', error);
				return;
			}
			await refreshParagraphModeLocation(pick.paragraphIndex, pick.paragraph.id, { persist: false });
		} finally {
			paragraphModeLastNavigationAt = Date.now();
			paragraphModeSuppressReactiveRefresh = Math.max(0, paragraphModeSuppressReactiveRefresh - 1);
			paragraphModeBusy = false;
		}
	}

	async function navigateParagraphRelative(direction: -1 | 1): Promise<void> {
		const currentLocation = paragraphModeLocation;
		if (!currentLocation || currentLocation.paragraphs.length === 0 || paragraphModeBusy) {
			return;
		}
		paragraphModeBusy = true;
		paragraphModeSuppressReactiveRefresh += 1;
		try {
			const targetIndex = currentLocation.currentIndex + direction;
			if (targetIndex < 0 || targetIndex >= currentLocation.paragraphs.length) {
				const targetChapterIndex = readerService.getCurrentChapterIndex() + direction;
				if (typeof readerService.getParagraphsForChapter !== 'function' || targetChapterIndex < 0) {
					return;
				}
				const nextChapterParagraphs = await readerService.getParagraphsForChapter(targetChapterIndex, {
					includeHtml: false,
				});
				if (nextChapterParagraphs.length === 0) {
					return;
				}
				const crossChapterIndex = direction > 0 ? 0 : nextChapterParagraphs.length - 1;
				const paragraph = nextChapterParagraphs[crossChapterIndex];
				clearParagraphModeSelection();
				applyParagraphModeIndex(
					{ paragraphs: nextChapterParagraphs, currentIndex: crossChapterIndex },
					crossChapterIndex
				);
				void hydrateParagraphModeActiveParagraph(crossChapterIndex);
				try {
					await syncParagraphModeAnchor(paragraph.cfiRange);
				} catch (error) {
					logger.warn('[EpubReaderApp] Failed to navigate paragraph across chapters:', error);
				}
				await refreshParagraphModeLocation(crossChapterIndex, paragraph.id, { persist: false });
				scheduleParagraphModePersist();
				return;
			}

			const paragraph = currentLocation.paragraphs[targetIndex];
			if (!paragraph?.cfiRange) {
				return;
			}
			clearParagraphModeSelection();
			applyParagraphModeIndex(currentLocation, targetIndex);
			void hydrateParagraphModeActiveParagraph(targetIndex);
			try {
				await syncParagraphModeAnchor(paragraph.cfiRange);
			} catch (error) {
				logger.warn('[EpubReaderApp] Failed to navigate paragraph within chapter:', error);
			}
			scheduleParagraphModePersist();
		} finally {
			paragraphModeLastNavigationAt = Date.now();
			paragraphModeSuppressReactiveRefresh = Math.max(0, paragraphModeSuppressReactiveRefresh - 1);
			paragraphModeBusy = false;
		}
	}

	async function handleParagraphOverlaySelectionChange(selection: {
		text: string;
		startOffset: number;
		endOffset: number;
		rect: DOMRect;
		rects: DOMRect[];
		clear: () => void;
	} | null): Promise<void> {
		if (!selection || !paragraphModeLocation || typeof readerService.resolveParagraphSelection !== 'function') {
			paragraphModeSelection = null;
			return;
		}

		const paragraph = paragraphModeLocation.paragraphs[paragraphModeLocation.currentIndex];
		if (!paragraph) {
			paragraphModeSelection = null;
			return;
		}

		const resolved = await readerService.resolveParagraphSelection(
			paragraph.id,
			selection.startOffset,
			selection.endOffset
		);
		if (!resolved?.cfiRange) {
			paragraphModeSelection = null;
			return;
		}

		paragraphModeSelection = {
			text: resolved.text || selection.text,
			cfiRange: resolved.cfiRange,
			rect: selection.rect,
			rects: selection.rects,
			clear: selection.clear,
		};
	}

	async function handleParagraphFootnoteActivate(info: {
		href: string;
		label?: string;
		pinned?: boolean;
		rect?: DOMRect;
	}): Promise<void> {
		if (typeof readerService.openParagraphFootnotePreview !== 'function' || !paragraphModeLocation) {
			return;
		}
		const paragraph = paragraphModeLocation.paragraphs[paragraphModeLocation.currentIndex];
		if (!paragraph?.id || !info?.href) {
			return;
		}
		try {
			await readerService.openParagraphFootnotePreview(paragraph.id, info.href, info.label, {
				pinned: info.pinned === true,
				rect: info.rect
					? {
							top: info.rect.top,
							left: info.rect.left,
							bottom: info.rect.bottom,
							right: info.rect.right,
							width: info.rect.width,
							height: info.rect.height,
						}
					: undefined,
			});
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to open paragraph footnote preview:', error);
		}
	}

	function dismissParagraphFootnotePreview(options?: { unpin?: boolean }): void {
		readerService.dismissParagraphFootnotePreview?.(options);
	}

	function handleParagraphHighlightActivate(info: {
		cfiRange: string;
		rect: DOMRect;
		rects: DOMRect[];
	}): void {
		if (!hasExcerptNotesCapability() || !readerService.getHighlightClickInfo) {
			return;
		}
		footnotePreviewInfo = null;
		referencePopoverInfo = null;
		referencePopoverStats = null;
		closeCommentEditor();
		highlightToolbarInfo = readerService.getHighlightClickInfo(info.cfiRange, 'highlight', {
			rect: {
				top: info.rect.top,
				left: info.rect.left,
				bottom: info.rect.bottom,
				right: info.rect.right,
				width: info.rect.width,
				height: info.rect.height,
			},
			rects: info.rects.map((rect) => ({
				top: rect.top,
				left: rect.left,
				bottom: rect.bottom,
				right: rect.right,
				width: rect.width,
				height: rect.height,
			})),
			anchorPoint: {
				x: info.rect.left + info.rect.width / 2,
				y: info.rect.top + info.rect.height / 2,
			},
		});
	}

	function applyReaderSettingsState(nextSettings: EpubReaderSettings, persist: boolean) {
		const normalizedSettings = normalizeReaderSettings(nextSettings);
		settings = normalizedSettings;
		readerService.setFootnoteClickAction?.(normalizedSettings.footnoteClickAction);
		onReaderSettingsLoaded?.(normalizedSettings);
		if (persist) {
			void storageService.saveReaderSettings(normalizedSettings);
		}
	}

	async function updateReaderSettings(patch: Partial<EpubReaderSettings>) {
		applyAndPersistReaderSettings({
			...settings,
			...patch,
		});
	}

	function previewReaderSettings(nextSettings: EpubReaderSettings) {
		applyReaderSettingsState(nextSettings, false);
	}

	function persistCurrentReaderSettings() {
		applyReaderSettingsState(settings, true);
	}

	function previewReaderLineHeight(value: string) {
		previewReaderSettings({
			...settings,
			lineHeight: clampReaderSetting(Number(value), 1.2, 2.4),
		});
	}

	function previewReaderLetterSpacing(value: string) {
		previewReaderSettings({
			...settings,
			letterSpacing: clampReaderSetting(Number(value), -0.02, 0.24, 3),
		});
	}

	function previewReaderPageMargin(value: string) {
		previewReaderSettings({
			...settings,
			pageMargin: clampReaderSetting(Number(value), 8, 96, 0),
		});
	}

	function setReaderWidthMode(mode: EpubReaderSettings['widthMode']) {
		if (settings.layoutMode === 'double' && mode !== 'fit') {
			return;
		}
		applyAndPersistReaderSettings({
			...settings,
			widthMode: mode,
		});
	}

	function setFootnoteClickAction(action: EpubReaderSettings['footnoteClickAction']) {
		applyAndPersistReaderSettings({
			...settings,
			footnoteClickAction: action,
		});
	}

	function resetReaderTypographySettings() {
		applyAndPersistReaderSettings({
			...settings,
			lineHeight: getDefaultReaderLineHeight(),
			letterSpacing: 0,
			pageMargin: getDefaultReaderPageMargin(),
			widthMode: settings.layoutMode === 'double' ? 'fit' : getDefaultReaderWidthMode(),
			showScrolledSideNav: true,
			footnoteClickAction: 'preview',
			paragraphModeFontSize: 'medium',
			paragraphModeFontScale: 100,
			paragraphModeSurfaceStyle: 'spotlight',
			paragraphModeTransitionStyle: 'settle',
		});
	}

	function formatLetterSpacingValue(value: number): string {
		return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
	}

	function handleTypographyPointerDownOutside(event: MouseEvent) {
		if (!typographyPopoverOpen) {
			return;
		}
		const target = event.target as HTMLElement | null;
		if (target?.closest?.('.epub-settings-float')) {
			return;
		}
		closeTypographyPanel();
	}

	function updateReadingReferencePointState(point: EpubReadingReferencePoint | null) {
		readingReferencePoint = point;
		onReadingReferencePointChange?.(point);
	}

	function updateSessionReadingStartPercent(value: number | null | undefined) {
		sessionReadingStartPercent = typeof value === 'number' && Number.isFinite(value)
			? Math.max(0, value)
			: null;
	}

	function clearReaderStoreSyncTimer() {
		if (readerStoreSyncTimer) {
			clearTimeout(readerStoreSyncTimer);
			readerStoreSyncTimer = null;
		}
		pendingReaderStorePatch = {};
	}

	function isActiveEpubReaderInstance(leaf: WorkspaceLeaf | null = app.workspace.activeLeaf): boolean {
		if (!leaf) {
			return false;
		}
		const activePath = getOpenEpubFilePath(leaf);
		const currentPath = normalizePath(String(filePath || '').trim());
		if (currentPath) {
			return !!activePath && pathsReferToSameOpenBook(activePath, currentPath);
		}
		return !activePath;
	}

	function flushReaderStoreSync() {
		clearReaderStoreSyncTimer();
		const patch = pendingReaderStorePatch;
		pendingReaderStorePatch = {};
		if (Object.keys(patch).length > 0 && isActiveEpubReaderInstance()) {
			epubActiveDocumentStore.setSharedState(patch);
		}
	}

	function scheduleReaderStoreSync(patch: Record<string, unknown>) {
		if (!isActiveEpubReaderInstance()) {
			return;
		}
		pendingReaderStorePatch = { ...pendingReaderStorePatch, ...patch };
		if (readerStoreSyncTimer) {
			return;
		}
		readerStoreSyncTimer = setTimeout(() => {
			readerStoreSyncTimer = null;
			const nextPatch = pendingReaderStorePatch;
			pendingReaderStorePatch = {};
			if (Object.keys(nextPatch).length > 0 && isActiveEpubReaderInstance()) {
				epubActiveDocumentStore.setSharedState(nextPatch);
			}
		}, READER_STORE_SYNC_MS);
	}

	function isStaleBookLoad(loadToken: number): boolean {
		return componentDisposed || loadToken !== activeBookLoadToken;
	}

	function normalizeTrackedVaultPath(path?: string | null): string {
		return normalizePath(String(path || '').trim());
	}

	function rememberHighlightSourcePath(path?: string | null) {
		const normalizedPath = normalizeTrackedVaultPath(path);
		if (!normalizedPath) {
			return;
		}
		trackedHighlightSourceFiles.add(normalizedPath);
	}

	function collectTrackedHighlightSourceFiles(highlights: ReaderHighlight[]): Set<string> {
		const trackedPaths = new Set<string>();
		for (const highlight of highlights) {
			const primarySourceFile = normalizeTrackedVaultPath(highlight.sourceFile);
			if (primarySourceFile) {
				trackedPaths.add(primarySourceFile);
			}
			for (const locator of highlight.sourceLocators || []) {
				const locatorSourceFile = normalizeTrackedVaultPath(locator?.sourceFile);
				if (locatorSourceFile) {
					trackedPaths.add(locatorSourceFile);
				}
			}
		}
		return trackedPaths;
	}

	function getBoundCanvasPath(): string | null {
		const canvasPath = normalizeTrackedVaultPath(canvasService.getCanvasPath());
		return canvasPath || null;
	}

	type HighlightReloadOptions = {
		invalidateCache?: boolean;
		incremental?: boolean;
	};

	function reloadHighlightsAfterExcerptMutation(sourcePath?: string | null) {
		rememberHighlightSourcePath(sourcePath);
		void reloadHighlights({ incremental: true });
	}

	function queueHighlightReload(delayMs = 350, options: HighlightReloadOptions = {}) {
		if (componentDisposed) {
			return;
		}
		if (deferredHighlightReloadTimer) {
			clearTimeout(deferredHighlightReloadTimer);
		}
		deferredHighlightReloadTimer = setTimeout(() => {
			deferredHighlightReloadTimer = null;
			if (!componentDisposed) {
				const incremental = options.incremental === true;
				void reloadHighlights({
					invalidateCache: options.invalidateCache === true,
					incremental,
				});
			}
		}, delayMs);
	}

	function prefetchAnnotationIndexForBook(
		loadedBook: EpubBook,
		targetFilePath: string,
		options?: { priority?: 'immediate' | 'background' }
	) {
		if (!hasExcerptNotesCapability()) {
			return;
		}
		void getEpubAnnotationIndexService(app).prefetchBook({
			bookId: loadedBook.id,
			filePath: targetFilePath,
			showStrikethroughHighlights: excerptSettings.showStrikethroughInSidebar,
			annotationService,
			backlinkService,
			readerService,
			highlightRevision: annotationRevision,
			priority: options?.priority ?? 'immediate',
		});
	}

	function publishSidebarHighlights(highlights: ReaderHighlight[]) {
		if (!book || !hasExcerptNotesCapability()) {
			return;
		}
		const nextRevision = annotationRevision + 1;
		highlightViewSnapshotService.publishFromHighlights({
			bookId: book.id,
			filePath,
			showStrikethroughHighlights: excerptSettings.showStrikethroughInSidebar,
			revision: nextRevision,
			highlights,
			readerService,
		});
		annotationRevision = nextRevision;
		epubActiveDocumentStore.setSharedState({ annotationRevision });
	}

	function getEpubActionHost() {
		return resolveEpubHost(app);
	}

	function getContinuousReadingPositionAutoSaveConfig(): { enabled: boolean; pages: number } {
		const host = getEpubActionHost() as {
			settings?: {
				continuousReadingPositionAutoSaveEnabled?: unknown;
				continuousReadingPositionAutoSavePages?: unknown;
			};
		} | null;

		return {
			enabled: normalizeContinuousReadingPositionAutoSaveEnabled(
				host?.settings?.continuousReadingPositionAutoSaveEnabled
			),
			pages: normalizeContinuousReadingPositionAutoSavePages(
				host?.settings?.continuousReadingPositionAutoSavePages
			),
		};
	}

	async function setContinuousReadingPositionAutoSaveEnabled(enabled: boolean): Promise<boolean> {
		const host = getEpubActionHost() as
			| ({
				settings?: {
					continuousReadingPositionAutoSaveEnabled?: unknown;
					continuousReadingPositionAutoSavePages?: unknown;
				};
				saveSettings?: () => Promise<void>;
			})
			| null;
		const normalizedEnabled = normalizeContinuousReadingPositionAutoSaveEnabled(enabled);
		if (!host?.settings) {
			return normalizedEnabled;
		}
		host.settings.continuousReadingPositionAutoSaveEnabled = normalizedEnabled;
		if (host.settings.continuousReadingPositionAutoSavePages == null) {
			host.settings.continuousReadingPositionAutoSavePages =
				DEFAULT_CONTINUOUS_READING_POSITION_AUTO_SAVE_PAGES;
		}
		await host.saveSettings?.();
		return normalizedEnabled;
	}

	const bookshelfProgressChangedNotifier = createDebouncedBookshelfProgressChangedNotifier();

	function notifyBookshelfProgressChanged(bookPath?: string) {
		bookshelfProgressChangedNotifier.notify(bookPath);
	}

	async function persistCurrentReadingProgress(
		targetBook: EpubBook | null = book
	): Promise<boolean> {
		if (!hasReadingProgressCapability()) {
			await flushEpubPendingProgress(storageService);
			return false;
		}
		if (!targetBook?.id) {
			await flushEpubPendingProgress(storageService);
			return false;
		}

		const fallbackPosition = targetBook.currentPosition;
		const livePosition = readerReady ? readerService.getCurrentPosition() : fallbackPosition;
		const currentCfi = String(
			livePosition?.cfi || readerService.getCurrentCFI() || fallbackPosition?.cfi || ''
		).trim();

		const position = currentCfi
			? {
				chapterIndex:
					typeof livePosition?.chapterIndex === 'number'
						? livePosition.chapterIndex
						: fallbackPosition?.chapterIndex || 0,
				cfi: currentCfi,
				percent:
					typeof livePosition?.percent === 'number' && Number.isFinite(livePosition.percent)
						? livePosition.percent
						: fallbackPosition?.percent || 0,
			}
			: fallbackPosition;

		if (!position?.cfi) {
			await flushEpubPendingProgress(storageService);
			return false;
		}

		readerService.flushReadingPace?.();
		const readingStats = readerService.getReadingStats?.() ?? targetBook.readingStats;
		if (readingStats) {
			targetBook.readingStats = readingStats;
		}
		targetBook.currentPosition = position;
		await storageService.saveProgress(targetBook.id, position, readingStats);
		await flushEpubPendingProgress(storageService);
		notifyBookshelfProgressChanged(targetBook.filePath);
		return true;
	}

	const EXCERPT_SETTINGS_CHANGED_EVENT = EPUB_RUNTIME.events.excerptSettingsChanged;
	const EPUB_PENDING_NAVIGATION_KEY = EPUB_RUNTIME.globals.pendingNavigationKey;
	const EPUB_NAVIGATE_EVENT = EPUB_RUNTIME.events.navigate;
	const LEGACY_EPUB_PENDING_NAVIGATION_KEY = EPUB_PENDING_NAVIGATION_KEY === '__weaveEpubStandalonePendingNav'
		? '__weaveEpubPendingNav'
		: null;
	const LEGACY_EPUB_NAVIGATE_EVENT = EPUB_NAVIGATE_EVENT === 'WeaveEpubStandalone:epub-navigate'
		? 'Weave:epub-navigate'
		: null;

	function syncReadingProgressDisplay(rawPercent?: number): void {
		const currentBook = book;
		if (!currentBook) {
			readingProgress = 0;
			return;
		}
		readingProgress = resolveDisplayProgress(currentBook, rawPercent);
	}

	async function markCurrentBookCompleted(): Promise<void> {
		const currentBook = book;
		if (!currentBook?.id || !hasReadingProgressCapability()) {
			return;
		}
		const updated = await storageService.markBookCompleted(currentBook.id);
		if (!updated) {
			return;
		}
		currentBook.readingStats = updated.readingStats;
		syncReadingProgressDisplay();
		epubActiveDocumentStore.setSharedState({
			progress: readingProgress,
		});
		notifyBookshelfProgressChanged(currentBook.filePath);
		const title = currentBook.metadata.title?.trim() || currentBook.filePath;
		new Notice(t('epub.reader.bookCompletionMarked', { title }));
	}

	async function handleBookEndAdvanceAttempt(): Promise<boolean> {
		if (!hasReadingProgressCapability()) {
			return false;
		}
		const currentBook = book;
		if (!currentBook?.id || !readerService.isAtBookEnd?.()) {
			return false;
		}
		if (isBookCompleted(currentBook.readingStats)) {
			return true;
		}
		if (bookCompletionPromptOpen) {
			return true;
		}
		if (bookCompletionPromptDismissedBookId === currentBook.id) {
			return true;
		}

		bookCompletionPromptOpen = true;
		const title = currentBook.metadata.title?.trim() || currentBook.filePath;
		const confirmed = await showObsidianConfirm(
			app,
			t('epub.reader.bookCompletionConfirmMessage', { title }),
			{
				title: t('epub.reader.bookCompletionConfirmTitle'),
				confirmText: t('epub.reader.bookCompletionConfirmButton'),
			}
		);
		bookCompletionPromptOpen = false;
		if (confirmed) {
			await markCurrentBookCompleted();
		} else {
			bookCompletionPromptDismissedBookId = currentBook.id;
		}
		return true;
	}

	async function openScanImportModal(scanEntries?: Awaited<ReturnType<typeof storageService.loadScanIndex>>) {
		const entries = scanEntries ?? await storageService.loadScanIndex();
		if (entries.length === 0) {
			new Notice(t('epub.bookshelf.vaultScanEmpty'));
			return;
		}

		const membership = await storageService.loadBookshelfMembership();
		const { EpubBookshelfImportModal } = await import('../modals/EpubBookshelfImportModal');
		const modal = new EpubBookshelfImportModal(app, {
			entries,
			membership,
			title: t('epub.bookshelf.vaultScanTitle'),
			onConfirm: async (paths: string[]) => {
				const addedEntries = await storageService.addBooksToBookshelf(paths);
				if (addedEntries.length === 0) {
					new Notice(
						paths.length > 0
							? t('epub.bookshelf.vaultScanAddFailed')
							: t('epub.bookshelf.vaultScanAlreadyAdded')
					);
					return;
				}
				warmEpubAnnotationIndexForPaths(
					app,
					addedEntries.map((entry) => entry.path)
				);
				dispatchEpubBookshelfDataChanged();
				new Notice(t('epub.bookshelf.vaultScanAdded', { count: addedEntries.length }));
			},
		});
		modal.open();
	}

	async function scanVaultAndPromptImport() {
		try {
			const scanEntries = await storageService.scanVaultBooks();
			dispatchEpubBookshelfDataChanged();

			if (scanEntries.length === 0) {
				new Notice(t('epub.bookshelf.vaultScanEmpty'));
				return;
			}

			await openScanImportModal(scanEntries);
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to scan vault EPUB files:', error);
			new Notice(t('epub.bookshelf.vaultScanFailed'));
		}
	}

	async function requestBookshelfRefresh() {
		dispatchEpubBookshelfRefreshRequest(undefined, { showNotice: true });
	}

	function getCreateCardPlugin(): {
		openCreateCardModal?: (input: EpubHostCreateCardInput) => Promise<void>;
	} | null {
		const host = getEpubActionHost();
		if (!host?.openCreateCardModal) {
			new Notice(t('epub.reader.createCardUnavailable'));
			return null;
		}
		return host;
	}

	function getExcerptPipeline() {
		return bookSession.excerptPipeline;
	}

	function syncBookSessionForPath(nextFilePath: string): BookSession {
		const manager = getBookSessionManager(app);
		if (!manager.pathsShareSession(filePath, nextFilePath)) {
			manager.release(filePath);
		}
		bookSession = manager.acquire(nextFilePath);
		return bookSession;
	}

	function syncReaderHighlightsFromCollection(
		nextHighlights: ReaderHighlight[],
		previousHighlights: ReaderHighlight[]
	): void {
		if (!readerReady) {
			return;
		}
		const previousByKey = new Map(
			previousHighlights.map((highlight) => [
				getReaderHighlightIdentityKey(highlight),
				highlight,
			])
		);
		for (const highlight of nextHighlights) {
			const key = getReaderHighlightIdentityKey(highlight);
			if (!key) {
				continue;
			}
			const previous = previousByKey.get(key);
			if (!previous || hasReaderHighlightPresentationChanged(previous, highlight)) {
				readerService.addHighlight(highlight);
			}
		}
	}

	function buildHighlightIdentityFields(info: HighlightClickInfo) {
		return {
			cfiRange: info.cfiRange,
			text: info.text,
			excerptId: info.excerptId,
			sourceFile: info.sourceFile,
			sourceRef: info.sourceRef,
			createdTime: info.createdTime,
		};
	}

	function purgeOrphanHighlightFromReader(info: HighlightClickInfo): void {
		const identityKey = getReaderHighlightIdentityKey(buildHighlightIdentityFields(info));
		if (identityKey) {
			readerService.removeHighlightByIdentityKey(identityKey);
			pendingLoadedHighlights = (pendingLoadedHighlights || []).filter(
				(highlight) => getReaderHighlightIdentityKey(highlight) !== identityKey
			);
		} else {
			readerService.removeHighlight(info.cfiRange);
			const normalizedCfi = EpubLinkService.normalizeCfi(info.cfiRange);
			pendingLoadedHighlights = (pendingLoadedHighlights || []).filter(
				(highlight) => EpubLinkService.normalizeCfi(highlight.cfiRange) !== normalizedCfi
			);
		}
		if (pendingLoadedHighlights) {
			publishSidebarHighlights(pendingLoadedHighlights);
		}
		highlightToolbarInfo = null;
	}

	async function isHighlightStillPersistedInSource(
		info: HighlightClickInfo,
		source: BacklinkSourceMatch
	): Promise<boolean> {
		const sourceFile = normalizeTrackedVaultPath(source.sourceFile);
		if (!sourceFile || !app.vault.getAbstractFileByPath(sourceFile)) {
			return false;
		}
		try {
			const highlights = await backlinkService.collectHighlightsFromSourcePath(
				filePath,
				sourceFile,
				getBoundCanvasPath()
			);
			const mutationCfi = resolveHighlightMutationCfi(info, source);
			const normalizedTargetCfi = EpubLinkService.normalizeCfi(mutationCfi);
			return highlights.some((highlight) => {
				if (source.excerptId && highlight.excerptId) {
					return highlight.excerptId === source.excerptId;
				}
				return EpubLinkService.normalizeCfi(highlight.cfiRange) === normalizedTargetCfi;
			});
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to inspect highlight persistence in source:', error);
			return true;
		}
	}

	async function finalizeHighlightRemoval(
		info: HighlightClickInfo,
		source: BacklinkSourceMatch,
		options?: { quiet?: boolean }
	): Promise<void> {
		purgeOrphanHighlightFromReader(info);
		if (!options?.quiet) {
			new Notice(t('epub.reader.highlightDeleted'));
		}
		reloadHighlightsAfterExcerptMutation(source.sourceFile);
	}

	async function syncHighlightsAfterSourcePathChange(sourcePath?: string | null): Promise<boolean> {
		const normalizedPath = normalizeTrackedVaultPath(sourcePath);
		if (!normalizedPath || !book || componentDisposed) {
			return false;
		}
		const current = pendingLoadedHighlights || [];
		if (current.length === 0) {
			return false;
		}

		let remainingFromSource: ReaderHighlight[] = [];
		try {
			const fromSource = await backlinkService.collectHighlightsFromSourcePath(
				filePath,
				normalizedPath,
				getBoundCanvasPath()
			);
			remainingFromSource = fromSource.map((highlight) => ({
				...highlight,
				presentation: 'highlight' as const,
			}));
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to sync highlights after source path change:', {
				path: normalizedPath,
				error,
			});
			return false;
		}

		const syncResult = computeHighlightSourceOptimisticSync(
			current,
			normalizedPath,
			remainingFromSource
		);
		if (syncResult.removed.length === 0 && syncResult.updated.length === 0) {
			return false;
		}

		const nextHighlights = applyHighlightSourceOptimisticSyncResult(current, syncResult);
		pendingLoadedHighlights = nextHighlights;
		getExcerptPipeline().syncCollectedHighlights(nextHighlights);
		publishSidebarHighlights(nextHighlights);

		if (readerReady) {
			for (const highlight of syncResult.removed) {
				const key = getReaderHighlightIdentityKey(highlight);
				if (key) {
					readerService.removeHighlightByIdentityKey(key);
				} else {
					readerService.removeHighlight(highlight.cfiRange);
				}
			}
			syncReaderHighlightsFromCollection(syncResult.updated, current);
		}
		return true;
	}

	function resolveCommentDraftFromMemory(info: HighlightClickInfo): string {
		const key = getReaderHighlightIdentityKey({
			cfiRange: info.cfiRange,
			text: info.text,
			excerptId: info.excerptId,
			sourceFile: info.sourceFile,
			sourceRef: info.sourceRef,
			createdTime: info.createdTime,
		});
		if (key) {
			const loaded = pendingLoadedHighlights.find(
				(highlight) => getReaderHighlightIdentityKey(highlight) === key
			);
			if (loaded?.commentText) {
				return loaded.commentText;
			}
		}
		return info.commentText || '';
	}

	async function resolveCommentDraftFromSource(info: HighlightClickInfo): Promise<string> {
		const memoryDraft = resolveCommentDraftFromMemory(info);
		if (memoryDraft.trim()) {
			return memoryDraft;
		}
		const source = await resolveHighlightSource(info);
		if (!source?.sourceFile) {
			return memoryDraft;
		}
		try {
			const highlights = await backlinkService.collectHighlightsFromSourcePath(
				filePath,
				source.sourceFile,
				getBoundCanvasPath()
			);
			const mutationCfi = resolveHighlightMutationCfi(info, source);
			const normalizedTargetCfi = EpubLinkService.normalizeCfi(mutationCfi);
			const match = highlights.find((highlight) => {
				if (source.excerptId && highlight.excerptId) {
					return highlight.excerptId === source.excerptId;
				}
				return EpubLinkService.normalizeCfi(highlight.cfiRange) === normalizedTargetCfi;
			});
			return match?.commentText || memoryDraft;
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to resolve highlight comment from source:', error);
			return memoryDraft;
		}
	}

	function applyIncomingReaderHighlights(incoming: ReaderHighlight[]): boolean {
		if (incoming.length === 0) {
			return false;
		}
		const previousHighlights = pendingLoadedHighlights || [];
		pendingLoadedHighlights = mergeReaderHighlightsByIdentity(previousHighlights, incoming);
		syncReaderHighlightsFromCollection(incoming, previousHighlights);
		publishSidebarHighlights(pendingLoadedHighlights);
		return true;
	}

	async function mergeHighlightsFromSourcePath(sourcePath?: string | null): Promise<boolean> {
		const normalizedPath = normalizeTrackedVaultPath(sourcePath);
		if (!normalizedPath || !book || componentDisposed) {
			return false;
		}
		try {
			const fromSource = await backlinkService.collectHighlightsFromSourcePath(
				filePath,
				normalizedPath,
				getBoundCanvasPath()
			);
			if (fromSource.length === 0) {
				return syncHighlightsAfterSourcePathChange(normalizedPath);
			}
			const incoming: ReaderHighlight[] = fromSource.map((highlight) => ({
				...highlight,
				presentation: 'highlight' as const,
			}));
			return applyIncomingReaderHighlights(incoming);
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to merge highlights from source path:', {
				path: normalizedPath,
				error,
			});
			return false;
		}
	}

	async function handleSavedCardHighlightSync(card: EpubSavedCardSnapshot) {
		if (!book || componentDisposed || !hasExcerptNotesCapability()) {
			return;
		}
		const normalizedCard = buildEpubHighlightSyncSnapshot(card);
		await getExcerptPipeline().handleCardSaved({
			card: normalizedCard,
			extractFromCard: () =>
				backlinkService.extractHighlightsFromSavedCard(
					normalizedCard,
					filePath,
					book?.sourceId
				),
			mergeFromSourcePath: (sourcePath) => mergeHighlightsFromSourcePath(sourcePath),
			applyReaderHighlights: (incoming) => applyIncomingReaderHighlights(incoming),
			requestReload: (request) =>
				queueHighlightReload(request.delayMs ?? 300, {
					incremental: request.incremental,
					invalidateCache: request.invalidateCache,
				}),
			rememberSourcePath: (sourcePath) => rememberHighlightSourcePath(sourcePath),
		});
	}

	async function extractContentToCard(
		content: string,
		successMessage: string,
		errorLogLabel: string,
		failureMessage: string,
		onSuccess?: () => void
	) {
		try {
			const plugin = getCreateCardPlugin();
			if (!plugin?.openCreateCardModal) return;

			const handleCardSaved = (card: EpubSavedCardSnapshot) => {
				void handleSavedCardHighlightSync(card);
			};
			const modalInput: EpubHostCreateCardInput & {
				onSuccess?: (card: EpubSavedCardSnapshot) => void | Promise<void>;
			} = {
				initialContent: `${content}\n---div---\n\n`,
				onCardSaved: handleCardSaved,
				onSuccess: handleCardSaved,
			};

			await plugin.openCreateCardModal(modalInput);
			onSuccess?.();
			new Notice(successMessage);
		} catch (error) {
			logger.error(`[EpubReaderApp] ${errorLogLabel}:`, error);
			new Notice(failureMessage);
		}
	}

	function getMarkdownExportHost(): EpubHostCapabilities | null {
		const host = getEpubActionHost();
		if (!host) {
			return null;
		}
		return host;
	}

	function hasCreateReadingPointCapability(): boolean {
		return Boolean(getEpubActionHost()?.openIRReadingPointFromExternalSelection);
	}

	function hasScheduleChapterForIncrementalReadingCapability(): boolean {
		return Boolean(getEpubActionHost()?.scheduleEpubChapterForIncrementalReading);
	}

	function getIncrementalReadingHost(): EpubHostCapabilities | null {
		const host = getEpubActionHost();
		if (!host) {
			return null;
		}
		return host;
	}

	function applyAndPersistReaderSettings(nextSettings: EpubReaderSettings) {
		applyReaderSettingsState(nextSettings, true);
	}

	async function finalizeBookLoad(
		loadToken: number,
		loadedBook: EpubBook,
		targetFilePath: string,
		reusableBook: EpubBook | null
	): Promise<void> {
		if (isStaleBookLoad(loadToken)) {
			return;
		}

		try {
			const sourceEntry = await storageService.ensureSourceIdentity(targetFilePath, {
				preferredSourceId: reusableBook?.sourceId,
			});
			if (isStaleBookLoad(loadToken)) {
				return;
			}

			if (sourceEntry) {
				loadedBook.sourceId = sourceEntry.sourceId;
				loadedBook.sourceFingerprint = sourceEntry.sourceFingerprint;
				loadedBook.sourceSize = sourceEntry.sourceSize;
				loadedBook.sourceMtime = sourceEntry.sourceMtime;
				loadedBook.filePath = sourceEntry.filePath;
			} else if (reusableBook?.sourceId) {
				loadedBook.sourceId = reusableBook.sourceId;
			}

			await storageService.saveBook(loadedBook);
			if (isStaleBookLoad(loadToken)) {
				return;
			}

			await refreshReadingReferencePointState(loadedBook.id);
			if (isStaleBookLoad(loadToken)) {
				return;
			}

			await initCanvasBinding();
			if (isStaleBookLoad(loadToken)) {
				return;
			}

			await refreshTocChapterMarksForBook(loadedBook.id);
			if (isStaleBookLoad(loadToken)) {
				return;
			}

			void reloadHighlights();
			prefetchAnnotationIndexForBook(loadedBook, targetFilePath, { priority: 'immediate' });
		} catch (error) {
			logger.warn('[EpubReaderApp] Deferred book persistence failed:', error);
		}
	}

	async function cancelSlowBookLoad() {
		activeBookLoadToken += 1;
		bookLoadSlowWarning = false;
		loading = false;
		errorMsg = '';
		try {
			await onCancelBookLoad?.();
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to cancel book load:', error);
		}
	}

	async function loadBook() {
		syncBookSessionForPath(filePath);
		const loadToken = ++activeBookLoadToken;
		const targetFilePath = filePath;
		const previousBook = book;
		if (previousBook?.id) {
			void persistCurrentReadingProgress(previousBook);
		}
		loading = true;
		bookLoadSlowWarning = false;
		errorMsg = '';
		readerReady = false;
		highlightReloading = false;
		pendingLoadedHighlights = null;
		highlightToolbarInfo = null;
		commentEditorInfo = null;
		footnotePreviewInfo = null;
		commentEditorDraft = '';
		commentEditorSaving = false;
		updateReadingReferencePointState(null);
		updateSessionReadingStartPercent(null);
		try {
			const canonicalFilePath =
				storageService.resolveSupportedBookFilePath(targetFilePath) || targetFilePath;
			if (canonicalFilePath !== targetFilePath) {
				await storageService.updateBookFileReferences(targetFilePath, canonicalFilePath);
			}
			const vaultFile = app.vault.getAbstractFileByPath(canonicalFilePath);
			if (!isSupportedBookFile(vaultFile)) {
				if (await storageService.isBookshelfSourceMissing(targetFilePath)) {
					await storageService.removeMissingBookshelfEntry(targetFilePath);
					throw new Error(t('epub.bookshelf.notFoundRemoved'));
				}
				throw new Error(t('views.epubView.notice.bookFileMissing'));
			}

			const existingBook =
				(await storageService.findBookByFilePath(canonicalFilePath))
				|| (canonicalFilePath !== targetFilePath
					? await storageService.findBookByFilePath(targetFilePath)
					: null);
			if (isStaleBookLoad(loadToken)) {
				return;
			}
			if (existingBook?.id) {
				await storageService.hydrateBookState(existingBook.id);
			}
			if (isStaleBookLoad(loadToken)) {
				return;
			}
			const reusableBook = canReuseExistingBook(existingBook, vaultFile) ? existingBook : null;
			if (existingBook && !reusableBook) {
				await storageService.removeBookByFilePath(canonicalFilePath);
				showTransientStatus(
					t('epub.reader.fileUpdatedRebuilt', {
						format: getBookFormatDisplayLabel(canonicalFilePath),
					}),
					3200
				);
			}
			const loadedBook = await runBookLoadSession({
				filePath: canonicalFilePath,
				fileSizeBytes: vaultFile.stat.size,
				loadPromise: readerService.loadEpub(canonicalFilePath, reusableBook?.id),
				onSlowLoad: () => {
					if (!isStaleBookLoad(loadToken)) {
						bookLoadSlowWarning = true;
					}
				},
				isCancelled: () => isStaleBookLoad(loadToken),
			});

			if (isStaleBookLoad(loadToken)) {
				return;
			}

			if (reusableBook) {
				loadedBook.readingStats = reusableBook.readingStats;
				const storedTitle = reusableBook.metadata?.title?.trim();
				if (storedTitle) {
					loadedBook.metadata = {
						...loadedBook.metadata,
						title: storedTitle,
					};
				}
			}

			const sourceEntry = await storageService.ensureSourceIdentity(canonicalFilePath, {
				preferredSourceId: reusableBook?.sourceId,
				preferredSourceFingerprint: reusableBook?.sourceFingerprint,
			});
			if (isStaleBookLoad(loadToken)) {
				return;
			}
			if (sourceEntry) {
				loadedBook.sourceId = sourceEntry.sourceId;
				loadedBook.sourceFingerprint = sourceEntry.sourceFingerprint;
				loadedBook.sourceSize = sourceEntry.sourceSize;
				loadedBook.sourceMtime = sourceEntry.sourceMtime;
				loadedBook.filePath = sourceEntry.filePath;
			} else if (reusableBook?.sourceId) {
				loadedBook.sourceId = reusableBook.sourceId;
				loadedBook.sourceFingerprint = reusableBook.sourceFingerprint;
			}

			const restoredPosition = await resolveBookLoadRestoredPosition({
				hasProgressCapability: hasReadingProgressCapability(),
				reusableBook,
				loadedBook,
				loadProgress: (bookId, book) => storageService.loadProgress(bookId, book),
			});
			if (isStaleBookLoad(loadToken)) {
				return;
			}
			if (hasReadingProgressCapability() && restoredPosition?.cfi) {
				loadedBook.currentPosition = restoredPosition;
				await readerService.setRestoredPosition?.(restoredPosition);
			}

			book = loadedBook;
			bookCompletionPromptDismissedBookId = '';
			currentChapterIndex = loadedBook.currentPosition?.chapterIndex ?? 0;
			syncReadingProgressDisplay(loadedBook.currentPosition?.percent ?? 0);
			updateSessionReadingStartPercent(readingProgress);
			showScrolledChapterNavActions = false;
			bookmarkRevision = 0;
			tocChapterMarks = {};
			tocChapterMarkRevision = 0;
			onTitleChange?.(loadedBook.metadata.title);
			if (isActiveEpubReaderInstance()) {
				epubActiveDocumentStore.setSharedState({ filePath: targetFilePath, book: loadedBook });
			}
			syncAsActiveEpubDocumentIfActive();
			prefetchAnnotationIndexForBook(loadedBook, targetFilePath, { priority: 'immediate' });

			// Unblock the reader shell as soon as the engine can render.
			loading = false;
			void maybeShowTutorialOnBookOpen();
			void finalizeBookLoad(loadToken, loadedBook, targetFilePath, reusableBook);
		} catch (error) {
			if (isStaleBookLoad(loadToken) || error instanceof BookLoadCancelledError) {
				return;
			}
			logger.error(
				`[EpubReaderApp] Failed to load ${getBookFormatDisplayLabel(targetFilePath)}:`,
				error
			);
			setError(`${error instanceof Error ? error.message : t('epub.reader.unknownError')}`);
		} finally {
			if (!isStaleBookLoad(loadToken)) {
				loading = false;
			}
		}
	}

	async function refreshTocChapterMarksForBook(bookId: string): Promise<void> {
		const normalizedBookId = String(bookId || '').trim();
		if (!normalizedBookId) {
			tocChapterMarks = {};
			return;
		}

		try {
			tocChapterMarks = await storageService.getTocChapterMarks(normalizedBookId);
			tocChapterMarkRevision += 1;
			if (isActiveEpubReaderInstance()) {
				epubActiveDocumentStore.setSharedState({
					tocChapterMarks,
					tocChapterMarkRevision,
				});
			}
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to load TOC chapter marks:', error);
			tocChapterMarks = {};
		}
	}

	async function handleSetTocChapterMark(item: TocItem, mark: EpubTocChapterMark | null): Promise<void> {
		if (!book) {
			new Notice(t('epub.reader.bookNotLoaded'));
			return;
		}
		const href = String(item.href || '').trim();
		if (!href) {
			return;
		}

		try {
			tocChapterMarks = await storageService.setTocChapterMark(book.id, href, mark);
			tocChapterMarkRevision += 1;
			epubActiveDocumentStore.setSharedState({
				tocChapterMarks,
				tocChapterMarkRevision,
			});
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to update TOC chapter mark:', error);
			new Notice(t('epub.globalSidebar.tocMarkUpdateFailed'));
			throw error;
		}
	}

	async function handleSaveTocChapterMarkSettings(
		nextSettings: EpubTocChapterMarkSettings
	): Promise<void> {
		try {
			tocChapterMarkSettings = await storageService.saveTocChapterMarkSettings(nextSettings);
			tocChapterMarkSettingsRevision += 1;
			epubActiveDocumentStore.setSharedState({
				tocChapterMarkSettings,
				tocChapterMarkSettingsRevision,
			});
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to save TOC chapter mark settings:', error);
			new Notice(t('epub.globalSidebar.tocMarkSettingsSaveFailed'));
			throw error;
		}
	}

	async function refreshReadingReferencePointState(bookId?: string | null) {
		if (!hasReadingReferenceCapability()) {
			updateReadingReferencePointState(null);
			return;
		}
		const normalizedBookId = String(bookId || '').trim();
		if (!normalizedBookId) {
			updateReadingReferencePointState(null);
			return;
		}

		try {
			const point = await storageService.loadReadingReferencePoint(normalizedBookId);
			updateReadingReferencePointState(point);
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to load reading reference point:', error);
			updateReadingReferencePointState(null);
		}
	}

	function closeTutorial() {
		tutorialVisible = false;
		tutorialInitialTab = undefined;
	}

	function toggleTutorial() {
		if (tutorialVisible) {
			closeTutorial();
			return;
		}
		tutorialInitialTab = undefined;
		tutorialVisible = true;
	}

	async function dismissTutorialPermanently() {
		readerTutorialDismissed = true;
		try {
			await storageService.savePluginUiMemory({ readerTutorialDismissed: true });
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to save tutorial dismiss state:', error);
		}
		closeTutorial();
	}

	async function maybeShowTutorialOnBookOpen() {
		await tutorialDismissStateReady;
		if (readerTutorialDismissed) {
			return;
		}
		tutorialInitialTab = 'workflow';
		tutorialVisible = true;
	}

	async function addBookmark() {
		if (!book) {
			new Notice(t('epub.reader.bookNotLoaded'));
			return;
		}
		try {
			const pos = readerService.getCurrentPosition();
			let currentCfi = EpubLinkService.normalizeCfi(
				pos.cfi || readerService.getCurrentCFI() || book.currentPosition?.cfi || ''
			);
			if (!currentCfi) {
				new Notice(t('epub.reader.readingPositionUnavailable'));
				return;
			}

			if (typeof readerService.canonicalizeLocation === 'function') {
				const canonicalCfi = await readerService.canonicalizeLocation(currentCfi);
				if (canonicalCfi) {
					currentCfi = canonicalCfi;
				}
			}

			const chapterTitle = readerService.getCurrentChapterTitle() || getReadingPositionLabel(pos.percent);
			const result = await bookmarkService.addBookmark(book, {
				cfi: currentCfi,
				chapterIndex: pos.chapterIndex,
				percent: pos.percent,
				chapterTitle,
				pageNumber: settings.flowMode !== 'scrolled' && paginationInfo.currentPage > 0
					? paginationInfo.currentPage
					: undefined,
				totalPages: settings.flowMode !== 'scrolled' && paginationInfo.totalPages > 0
					? paginationInfo.totalPages
					: undefined,
				createdAt: Date.now(),
				preview: chapterTitle,
			});
			bookmarkRevision += 1;
			epubActiveDocumentStore.setSharedState({ bookmarkRevision });
			new Notice(result.created ? t('epub.reader.bookmarkAdded') : t('epub.reader.bookmarkExists'));
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to add bookmark:', error);
			new Notice(t('epub.reader.bookmarkActionFailed'));
		}
	}

	async function deleteBookmarkById(bookmarkId: string): Promise<boolean> {
		if (!book) {
			new Notice(t('epub.reader.bookNotLoaded'));
			return false;
		}

		try {
			const deleted = await bookmarkService.deleteBookmark(book, bookmarkId);
			if (!deleted) {
				new Notice(t('epub.reader.bookmarkMissing'));
				return false;
			}
			bookmarkRevision += 1;
			epubActiveDocumentStore.setSharedState({ bookmarkRevision });
			new Notice(t('epub.reader.bookmarkDeleted'));
			return true;
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to delete bookmark:', error);
			new Notice(t('epub.reader.bookmarkDeleteFailed'));
			return false;
		}
	}

	async function buildReadingReferencePoint(position?: ReadingPosition | null): Promise<EpubReadingReferencePoint | null> {
		if (!book) {
			return null;
		}

		const currentPosition = position ?? readerService.getCurrentPosition();
		let currentCfi = EpubLinkService.normalizeCfi(
			currentPosition.cfi || readerService.getCurrentCFI() || book.currentPosition?.cfi || ''
		);
		if (!currentCfi) {
			return null;
		}

		if (typeof readerService.canonicalizeLocation === 'function') {
			const canonicalCfi = await readerService.canonicalizeLocation(currentCfi);
			if (canonicalCfi) {
				currentCfi = canonicalCfi;
			}
		}

		const percent =
			typeof currentPosition.percent === 'number' && Number.isFinite(currentPosition.percent)
				? currentPosition.percent
				: book.currentPosition?.percent || 0;
		const chapterIndex =
			typeof currentPosition.chapterIndex === 'number' && Number.isFinite(currentPosition.chapterIndex)
				? currentPosition.chapterIndex
				: book.currentPosition?.chapterIndex || 0;
		const chapterTitle = readerService.getCurrentChapterTitle()
			|| getReadingPositionLabel(percent);

		return {
			chapterIndex,
			cfi: currentCfi,
			percent,
			title: chapterTitle,
			savedAt: Date.now(),
		};
	}

	async function saveReadingReferencePoint() {
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_READING_REFERENCE, t('epub.reader.readingReferenceFeatureNotice'))) {
			return;
		}
		if (!book) {
			new Notice(t('epub.reader.bookNotLoaded'));
			return;
		}

		try {
			const point = await buildReadingReferencePoint();
			if (!point) {
				new Notice(t('epub.reader.readingPositionUnavailable'));
				return;
			}

			await storageService.saveReadingReferencePoint(book.id, point);
			updateReadingReferencePointState(point);
			showTransientStatus(t('epub.reader.referenceSavedStatus', { title: point.title }), 2600);
			new Notice(t('epub.reader.referenceSaved'));
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to save reading reference point:', error);
			new Notice(t('epub.reader.referenceSaveFailed'));
		}
	}

	async function syncReadingReferencePointFromAutoSave(position: ReadingPosition): Promise<void> {
		if (!hasReadingReferenceCapability()) {
			return;
		}
		if (!book) {
			return;
		}

		try {
			const point = await buildReadingReferencePoint(position);
			if (!point) {
				return;
			}

			await storageService.saveReadingReferencePoint(book.id, point);
			updateReadingReferencePointState(point);
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to sync reading reference point from auto-saved reading progress:', error);
		}
	}

	async function handleAutoReadingPositionSaved(position: ReadingPosition): Promise<void> {
		await syncReadingReferencePointFromAutoSave(position);
		await flushEpubPendingProgress(storageService);
		notifyBookshelfProgressChanged(book?.filePath);
	}

	async function goToReadingReferencePoint() {
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_READING_REFERENCE, t('epub.reader.readingReferenceFeatureNotice'))) {
			return;
		}
		if (!readingReferencePoint?.cfi) {
			new Notice(t('epub.reader.referenceMissing'));
			return;
		}
		try {
			const referenceTitle = readingReferencePoint.title || t('epub.reader.referenceFallbackTitle');
			requestBookLocate({
				cfi: readingReferencePoint.cfi,
				flashStyle: 'highlight',
				showLocateOverlay: true,
			});
			showTransientStatus(t('epub.reader.referenceJumpedStatus', { title: referenceTitle }), 2200);
			new Notice(t('epub.reader.referenceJumped'));
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to jump to reading reference point:', error);
			new Notice(t('epub.reader.referenceJumpFailed'));
		}
	}

	async function clearReadingReferencePoint() {
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_READING_REFERENCE, t('epub.reader.readingReferenceFeatureNotice'))) {
			return;
		}
		if (!book) {
			new Notice(t('epub.reader.bookNotLoaded'));
			return;
		}
		try {
			await storageService.deleteReadingReferencePoint(book.id);
			updateReadingReferencePointState(null);
			showTransientStatus(t('epub.reader.referenceCleared'), 2200);
			new Notice(t('epub.reader.referenceCleared'));
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to clear reading reference point:', error);
			new Notice(t('epub.reader.referenceClearFailed'));
		}
	}

	function openReadingReferencePointMenu(event: MouseEvent | KeyboardEvent) {
		const canUseReference = hasReadingReferenceCapability();
		const canUseProgress = hasReadingProgressCapability();
		const autoSaveEnabled = getContinuousReadingPositionAutoSaveConfig().enabled;
		const menu = new Menu();

		if (canUseReference && readingReferencePoint) {
			menu.addItem((item) => {
				item.setTitle(getReadingReferenceTitleText());
				item.setIcon('flag');
				item.setDisabled(true);
			});
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle(t('epub.reader.referenceJumpMenu'));
				item.setIcon('locate-fixed');
				item.onClick(() => {
					void goToReadingReferencePoint();
				});
			});
			menu.addItem((item) => {
				item.setTitle(t('epub.reader.referenceUpdateMenu'));
				item.setIcon('flag');
				item.onClick(() => {
					void saveReadingReferencePoint();
				});
			});
			menu.addItem((item) => {
				item.setTitle(t('epub.reader.referenceClearMenu'));
				item.setIcon('trash-2');
				item.onClick(() => {
					void clearReadingReferencePoint();
				});
			});
		} else if (canUseReference) {
			menu.addItem((item) => {
				item.setTitle(t('epub.reader.referenceRecordMenu'));
				item.setIcon('flag');
				item.onClick(() => {
					void saveReadingReferencePoint();
				});
			});
		} else if (isPremiumFeaturePreviewEnabled()) {
			menu.addItem((item) => {
				item.setTitle(
					getPremiumFeatureEntryTitle(
						t('epub.reader.referenceRecordMenu'),
						PREMIUM_FEATURES.EPUB_READING_REFERENCE
					)
				);
				item.setIcon('flag');
				item.onClick(() => {
					openPremiumFeaturePreview(PREMIUM_FEATURES.EPUB_READING_REFERENCE);
				});
			});
		}

		if (canUseReference || isPremiumFeaturePreviewEnabled()) {
			menu.addSeparator();
		}

		if (canUseProgress) {
			menu.addItem((item) => {
				item.setTitle(t('epub.reader.readingPositionAutoSaveMenu'));
				item.setIcon(autoSaveEnabled ? 'locate-fixed' : 'map-pinned');
				item.setChecked(autoSaveEnabled);
				item.onClick(() => {
					void (async () => {
						const nextEnabled = !getContinuousReadingPositionAutoSaveConfig().enabled;
						await setContinuousReadingPositionAutoSaveEnabled(nextEnabled);
						onReadingPositionAutoSaveChange?.();
						new Notice(
							nextEnabled
								? t('epub.reader.autoSaveEnabled')
								: t('epub.reader.autoSaveDisabled')
						);
					})();
				});
			});
		}

		showMenuAtAnchor(menu, event);
	}

	async function applyAndPersistExcerptSettings(patch: Partial<EpubExcerptSettings>) {
		const nextExcerptSettings = {
			...excerptSettings,
			...patch,
		};
		excerptSettings = nextExcerptSettings;
		epubActiveDocumentStore.setSharedState({ excerptSettings: nextExcerptSettings });
		await storageService.saveExcerptSettings(nextExcerptSettings);
	}

	async function syncExcerptSettingsFromStorage() {
		try {
			const savedExcerptSettings = await storageService.loadExcerptSettings();
			excerptSettings = savedExcerptSettings;
			excerptSettingsLoaded = true;
			epubActiveDocumentStore.setSharedState({ excerptSettings: savedExcerptSettings });
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to sync excerpt settings:', error);
		}
	}

	function resolveExcerptChapterTitle(): string {
		const format = excerptSettings.chapterLocationFormat ?? 'leaf';
		if (typeof readerService.getChapterLocationLabel === 'function') {
			return readerService.getChapterLocationLabel(format);
		}
		return readerService.getCurrentChapterTitle();
	}

	function resolveExcerptChapterLabelMaxLength(): number {
		return excerptSettings.chapterLocationFormat === 'full'
			? EpubLinkService.MAX_FULL_CHAPTER_LABEL_LENGTH
			: EpubLinkService.MAX_CHAPTER_LABEL_LENGTH;
	}

	function handleGlobalExcerptSettingsChanged(event: Event) {
		const detail = event instanceof CustomEvent ? event.detail : null;
		const nextExcerptSettings = detail?.settings;
		if (!nextExcerptSettings || typeof nextExcerptSettings !== 'object') {
			void syncExcerptSettingsFromStorage();
			return;
		}
		excerptSettings = nextExcerptSettings as EpubExcerptSettings;
		excerptSettingsLoaded = true;
		epubActiveDocumentStore.setSharedState({ excerptSettings });
	}

	function showSettingsMenu(evt: MouseEvent) {
		const menu = new Menu();
		const bookshelfSettingsHost = resolveEpubHost(app) as
			| ({ settings?: Record<string, unknown>; saveSettings?: () => Promise<void> })
			| null;
		const currentBookshelfDisplayMode = normalizeBookshelfDisplayMode(
			bookshelfSettingsHost?.settings?.bookshelfDisplayMode
		);

		const applyBookshelfDisplayMode = (mode: BookshelfDisplayMode) => {
			void (async () => {
				if (!bookshelfSettingsHost?.settings) {
					return;
				}
				bookshelfSettingsHost.settings.bookshelfDisplayMode = mode;
				bookshelfSettingsHost.settings.bookshelfAutoViewByLocationEnabled = mode === 'adaptive';
				if (typeof bookshelfSettingsHost.saveSettings === 'function') {
					await bookshelfSettingsHost.saveSettings();
				}
				window.dispatchEvent(new CustomEvent(EPUB_RUNTIME.events.bookshelfDisplaySettingsChanged, {
					detail: {
						enabled: mode === 'adaptive',
						mode,
					},
				}));
				new Notice(t('epub.bookshelf.switchDisplayMode', { mode: getBookshelfDisplayModeOption(mode).label }));
			})();
		};

		menu.addItem((item) => {
			item.setTitle(t('epub.reader.displayFeatures'));
			item.setIcon('library');
			const subMenu = (item as any).setSubmenu();

			for (const option of getBookshelfDisplayModeOptions()) {
				subMenu.addItem((subItem: any) => {
					subItem.setTitle(option.label);
					subItem.setIcon(option.icon);
					subItem.setChecked(currentBookshelfDisplayMode === option.mode);
					subItem.onClick(() => {
						applyBookshelfDisplayMode(option.mode);
					});
				});
			}
		});

		menu.addItem((item) => {
			item.setTitle(t('epub.reader.scanVault'));
			item.setIcon('scan-search');
			item.onClick(() => {
				void scanVaultAndPromptImport();
			});
		});

		menu.addItem((item) => {
			item.setTitle(t('epub.reader.refreshBookshelf'));
			item.setIcon('refresh-cw');
			item.onClick(() => {
				void requestBookshelfRefresh();
			});
		});

		menu.showAtMouseEvent(evt);
	}

	function handleLayoutModeChange(mode: EpubLayoutMode) {
		if (isMobileReader()) {
			mode = 'paginated';
		}
		applyAndPersistReaderSettings({
			...settings,
			layoutMode: mode,
			widthMode: mode === 'double' ? 'fit' : settings.widthMode
		});
	}

	function handleFlowModeChange(mode: EpubFlowMode) {
		applyAndPersistReaderSettings({
			...settings,
			layoutMode: mode === 'scrolled' ? 'paginated' : settings.layoutMode,
			flowMode: mode
		});
	}

	function handleScrolledSideNavToggle(enabled: boolean) {
		applyAndPersistReaderSettings({
			...settings,
			showScrolledSideNav: enabled
		});
	}

	function showBottomNav() {
		return settings.flowMode !== 'scrolled' || (!isMobileReader() && settings.showScrolledSideNav);
	}

	function useVerticalNav() {
		return settings.flowMode === 'scrolled';
	}

	function getBottomNavStatusText(): string | undefined {
		if (transientStatusText.trim()) {
			if (!useVerticalNav()) {
				return undefined;
			}
			return transientStatusText;
		}
		if (!useVerticalNav()) {
			return undefined;
		}
		if (!hasReadingProgressCapability()) {
			return undefined;
		}
		return `${Math.max(0, Math.round(readingProgress))}%`;
	}

	function getBottomNavStatusDetail(): string | undefined {
		if (useVerticalNav()) {
			return undefined;
		}
		const detail = transientStatusText.trim();
		return detail || undefined;
	}

	function getReadingReferenceDeltaText(): string {
		if (sessionReadingStartPercent === null) {
			return '0%';
		}
		const delta = Math.round(readingProgress - sessionReadingStartPercent);
		return delta > 0 ? `+${delta}%` : `${delta}%`;
	}

	function getReadingReferenceTitleText(): string {
		if (!readingReferencePoint) {
			return t('epub.reader.sessionDeltaLabel');
		}
		const currentDelta = getReadingReferenceDeltaText();
		const resumePercent = Math.max(0, Math.round(readingReferencePoint.percent));
		const title = String(
			readingReferencePoint.title || getReadingPositionLabel(resumePercent)
		).trim();
		return t('epub.reader.sessionDeltaTitle', {
			delta: currentDelta,
			percent: resumePercent,
			title,
		});
	}

	function showMenuAtAnchor(menu: Menu, event: MouseEvent | KeyboardEvent) {
		if (domInstanceOf(event, MouseEvent)) {
			menu.showAtMouseEvent(event);
			return;
		}
		menu.showAtPosition({
			x: Math.max(24, Math.round(window.innerWidth / 2)),
			y: Math.max(24, Math.round(window.innerHeight / 2)),
		});
	}

	function clearScrolledNavMetrics() {
		rootEl?.style.removeProperty(SCROLLED_NAV_FRAME_INSET_VAR);
		rootEl?.style.removeProperty(SCROLLED_NAV_SCROLLBAR_VAR);
	}

	function getVisibleReaderFrameGeometry(): {
		frameElement: HTMLElement;
		frameWindow: Window;
		frameDocument: Document;
	} | null {
		for (const frame of readerService.getVisibleFrames()) {
			const frameElement = frame.window?.frameElement;
			if (!domInstanceOf(frameElement, HTMLElement)) {
				continue;
			}
			return {
				frameElement,
				frameWindow: frame.window,
				frameDocument: frame.frameDocument,
			};
		}
		return null;
	}

	function syncScrolledNavMetrics() {
		if (!rootEl || !viewportEl || !showBottomNav() || !useVerticalNav()) {
			clearScrolledNavMetrics();
			return;
		}

		const frameGeometry = getVisibleReaderFrameGeometry();
		if (!frameGeometry) {
			clearScrolledNavMetrics();
			return;
		}

		const viewportRect = viewportEl.getBoundingClientRect();
		const frameRect = frameGeometry.frameElement.getBoundingClientRect();
		const documentElement = frameGeometry.frameDocument.documentElement;
		const body = frameGeometry.frameDocument.body;
		const contentWidth = Math.max(documentElement?.clientWidth || 0, body?.clientWidth || 0);
		const scrollbarWidth = Math.max(0, frameGeometry.frameWindow.innerWidth - contentWidth);
		const frameInsetEnd = Math.max(0, viewportRect.right - frameRect.right);

		rootEl.style.setProperty(SCROLLED_NAV_FRAME_INSET_VAR, `${frameInsetEnd}px`);
		rootEl.style.setProperty(SCROLLED_NAV_SCROLLBAR_VAR, `${scrollbarWidth}px`);
	}

	function scheduleScrolledNavLayoutSync() {
		if (scrolledNavSyncFrame) {
			return;
		}
		scrolledNavSyncFrame = window.requestAnimationFrame(() => {
			scrolledNavSyncFrame = 0;
			syncScrolledNavMetrics();
		});
	}

	function setupScrolledNavMetricsObserver() {
		if (scrolledNavResizeObserver) {
			scrolledNavResizeObserver.disconnect();
		}
		scrolledNavResizeObserver = new ResizeObserver(() => {
			scheduleScrolledNavLayoutSync();
		});
		if (rootEl) {
			scrolledNavResizeObserver.observe(rootEl);
		}
		if (viewportEl) {
			scrolledNavResizeObserver.observe(viewportEl);
		}
	}

	async function handlePrevPage() {
		await readerService.prevPage();
	}

	async function handleNextPage() {
		await readerService.nextPage();
	}

	async function handleJumpToPage(pageNumber: number) {
		await readerService.goToPage(pageNumber);
	}

	function hasPrevChapter(): boolean {
		return Boolean(book && currentChapterIndex > 0);
	}

	function hasNextChapter(): boolean {
		return Boolean(book && currentChapterIndex >= 0 && currentChapterIndex < book.metadata.chapterCount - 1);
	}

	function syncScrolledChapterNavVisibility() {
		const atChapterEnd = Boolean(readerService.isAtCurrentChapterEnd?.());
		showScrolledChapterNavActions = Boolean(
			atChapterEnd && (hasPrevChapter() || hasNextChapter())
		);
	}

	async function handlePrevChapter() {
		if (!hasPrevChapter()) {
			return;
		}

		const moved = await readerService.prevChapter?.();
		if (!moved) {
			new Notice(t('epub.reader.prevChapterExists'));
			return;
		}

		showScrolledChapterNavActions = false;
	}

	async function handleNextChapter() {
		if (!hasNextChapter()) {
			return;
		}

		const moved = await readerService.nextChapter?.();
		if (!moved) {
			new Notice(t('epub.reader.nextChapterExists'));
			return;
		}

		showScrolledChapterNavActions = false;
	}

	function resolveExcerptLinkSourcePath(forEditorInsert: boolean): string | undefined {
		if (!forEditorInsert) {
			return undefined;
		}
		return (getLastActiveMarkdownLeaf?.()?.view as MarkdownView | undefined)?.file?.path;
	}

	function buildNoteContent(
		text: string,
		cfiRange: string,
		color?: string,
		style?: EpubHighlightStyle,
		forEditorInsert = false
	): string {
		const chapterIndex = readerService.getCurrentChapterIndex();
		const chapterTitle = resolveExcerptChapterTitle();
		const timestamp = excerptSettings.addCreationTime ? formatTimestamp(new Date()) : undefined;
		return linkService.buildQuoteBlock(
			filePath,
			cfiRange,
			text,
			chapterIndex,
			color,
			chapterTitle,
			timestamp,
			resolveExcerptLinkSourcePath(forEditorInsert),
			book?.sourceId,
			undefined,
			style,
			resolveExcerptChapterLabelMaxLength()
		);
	}

	function buildReadingPointSourceLink(text: string, cfiRange: string): string {
		const chapterIndex = readerService.getCurrentChapterIndex();
		const chapterTitle = resolveExcerptChapterTitle();
		return linkService.buildEpubLink(
			filePath,
			cfiRange,
			text,
			chapterIndex,
			chapterTitle,
			undefined,
			book?.sourceId
		);
	}

	function buildChapterReadingPointSourceLink(
		text: string,
		cfiRange: string,
		chapterIndex?: number
	): string {
		return linkService.buildEpubLink(
			filePath,
			cfiRange,
			text,
			chapterIndex,
			text,
			undefined,
			book?.sourceId
		);
	}

	function formatTimestamp(date: Date): string {
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
	}

	function insertToEditor(content: string): string | null {
		const leaf = getLastActiveMarkdownLeaf?.();
		if (!leaf) {
			new Notice(t('epub.reader.markdownEditorMissing'));
			return null;
		}
		const view = leaf.view;
		if (!(view instanceof MarkdownView) || !view.editor) {
			new Notice(t('epub.reader.markdownEditorMissing'));
			return null;
		}
		const editor = view.editor;
		const cursor = editor.getCursor();
		editor.replaceRange(content + '\n', cursor);
		const lines = content.split('\n').length;
		editor.setCursor({ line: cursor.line + lines, ch: 0 });
		return view.file?.path || null;
	}

	function insertToEditorAndTrack(content: string, delayMs = 900) {
		const sourcePath = insertToEditor(content);
		rememberHighlightSourcePath(sourcePath);
		if (sourcePath) {
			queueHighlightReload(delayMs, { incremental: true });
		}
	}

	async function copyTextToClipboard(content: string) {
		try {
			await navigator.clipboard.writeText(content);
			new Notice(t('epub.reader.copiedToClipboard'));
		} catch (_e) {
			new Notice(t('epub.reader.copyFailed'));
		}
	}

	async function copyImageToClipboard(blob: Blob) {
		try {
			await navigator.clipboard.write([
				new ClipboardItem({ [blob.type]: blob })
			]);
			new Notice(t('epub.reader.imageCopied'));
		} catch (_e) {
			new Notice(t('epub.reader.imageCopyFailed'));
		}
	}

	function outputNote(text: string, cfiRange: string, color?: string, style?: EpubHighlightStyle) {
		if (!hasExcerptNotesCapability()) {
			return;
		}
		if (canvasMode && canvasService.isActive() && hasCanvasExcerptCapability()) {
			addToCanvas(text, cfiRange, color, style);
			return;
		}

		const content = buildNoteContent(text, cfiRange, color, style, autoInsert);
		if (autoInsert) {
			insertToEditorAndTrack(content);
		} else {
			copyTextToClipboard(content);
		}
	}

	async function handleCopySelectionLink(
		action: 'protocolMarkdown' | 'vaultWikilink' | 'obsidianUri' | 'plainText',
		text: string,
		cfiRange: string
	) {
		if (!hasExcerptNotesCapability()) {
			if (isPremiumFeaturePreviewEnabled()) {
				openPremiumFeaturePreview(PREMIUM_FEATURES.EPUB_EXCERPT_NOTES);
			}
			return;
		}
		const content = linkService.buildSelectionCopyLink(action, filePath, cfiRange, text, {
			chapterIndex: readerService.getCurrentChapterIndex(),
			chapterTitle: resolveExcerptChapterTitle(),
			sourceId: book?.sourceId,
			chapterLabelMaxLength: resolveExcerptChapterLabelMaxLength(),
		});
		if (content) {
			await copyTextToClipboard(content);
		}
	}

	function showCanvasAddedNotice(
		anchorMode: ReturnType<EpubCanvasService['getLastInsertAnchorMode']>
	): void {
		const noticeKey =
			anchorMode === 'locked'
				? 'epub.reader.addedToCanvasLocked'
				: anchorMode === 'selection'
					? 'epub.reader.addedToCanvasSelection'
					: anchorMode === 'chain'
						? 'epub.reader.addedToCanvasChain'
						: 'epub.reader.addedToCanvas';
		new Notice(t(noticeKey));
	}

	async function addToCanvas(
		text: string,
		cfiRange: string,
		color?: string,
		style?: EpubHighlightStyle
	) {
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_CANVAS_EXCERPTS, t('epub.reader.canvasExcerptFeatureNotice'))) {
			return;
		}
		const chapterIndex = readerService.getCurrentChapterIndex();
		const chapterTitle = resolveExcerptChapterTitle();

		const timestamp = excerptSettings.addCreationTime ? formatTimestamp(new Date()) : undefined;
		const node = await canvasService.addExcerptNode(
			text,
			cfiRange,
			filePath,
			chapterIndex,
			chapterTitle,
			color,
			timestamp,
			book?.sourceId,
			style,
			resolveExcerptChapterLabelMaxLength()
		);
		if (node) {
			rememberHighlightSourcePath(canvasService.getCanvasPath());
			queueHighlightReload(120, { incremental: true });
			showCanvasAddedNotice(canvasService.getLastInsertAnchorMode());
		}
	}

	async function initCanvasBinding() {
		if (!book || !hasCanvasExcerptCapability()) {
			canvasService.setCanvasPath(null);
			canvasService.setAnchor(null);
			canvasMode = false;
			onCanvasStateChange?.(false, null);
			return;
		}
		const savedPath = await storageService.getCanvasBinding(book.id);
		if (savedPath) {
			const exists = await app.vault.adapter.exists(savedPath);
			if (exists) {
				canvasService.setCanvasPath(savedPath);
				canvasMode = true;
				onCanvasStateChange?.(true, savedPath);
			}
		}
	}

	async function bindCanvas(canvasPath: string) {
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_CANVAS_EXCERPTS, t('epub.reader.canvasExcerptFeatureNotice'))) {
			return;
		}
		if (!book) return;
		canvasService.setCanvasPath(canvasPath);
		await storageService.setCanvasBinding(book.id, canvasPath);
		canvasMode = true;
		onCanvasStateChange?.(true, canvasPath);
		void reloadHighlights({ invalidateCache: true });
	}

	async function unbindCanvas() {
		if (!book) return;
		canvasService.setCanvasPath(null);
		canvasService.setAnchor(null);
		await storageService.removeCanvasBinding(book.id);
		canvasMode = false;
		onCanvasStateChange?.(false, null);
		void reloadHighlights({ invalidateCache: true });
	}

	function handleInsertToNote(
		text: string,
		cfiRange: string,
		color?: string,
		style?: EpubHighlightStyle
	) {
		outputNote(text, cfiRange, color, style);
	}

	async function handleExtractToCard(
		text: string,
		cfiRange: string,
		color?: string,
		style?: EpubHighlightStyle
	) {
		if (readerReady && hasExcerptNotesCapability()) {
			try {
				readerService.addHighlight({
					cfiRange,
					color: color || 'yellow',
					style,
					text,
					presentation: 'highlight',
				});
			} catch (error) {
				logger.warn('[EpubReaderApp] Failed to apply immediate highlight before card extract:', error);
			}
		}
		await extractContentToCard(
			buildNoteContent(text, cfiRange, color, style),
			t('epub.reader.createCardSuccess'),
			'Failed to extract selection to card',
			t('epub.reader.createCardFailed')
		);
	}

	function showSelectedTextAIMenu(event: MouseEvent, text: string, cfiRange: string) {
		const host = resolveEpubHost(app);
		if (!host?.openSelectedTextAISplitMenu || !host.openSelectedTextAIPanelFromEpub) {
			new Notice(t('epub.commands.aiSplitUnavailable'));
			return;
		}

		host.openSelectedTextAISplitMenu({
			event,
			selectedText: text,
			onSelectAction: (actionId: string) => {
				void host.openSelectedTextAIPanelFromEpub?.({
					filePath,
					selectedText: text,
					actionId,
					sourceLink: buildReadingPointSourceLink(text, cfiRange),
				});
			},
		});
	}

	async function handleCreateReadingPoint(text: string, cfiRange: string) {
		try {
			const plugin = getIncrementalReadingHost();
			if (!plugin?.openIRReadingPointFromExternalSelection) {
				new Notice(t('epub.reader.irUnavailable'));
				return;
			}

			await plugin.openIRReadingPointFromExternalSelection({
				filePath,
				selectedText: text,
				sourceLink: buildReadingPointSourceLink(text, cfiRange),
				successNotice: t('epub.reader.irReadingPointCreated')
			});
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to create reading point from selection:', error);
			new Notice(t('epub.reader.createReadingPointFailed'));
		}
	}

	async function handleCreateChapterReadingPoint(item: TocItem, event?: MouseEvent) {
		try {
			const plugin = getIncrementalReadingHost();
			if (!plugin?.scheduleEpubChapterForIncrementalReading) {
				new Notice(t('epub.reader.irUnavailable'));
				return;
			}

			const topicProvider = plugin.getAvailableEpubIncrementalReadingTopics;
			if (!topicProvider) {
				await plugin.scheduleEpubChapterForIncrementalReading({
					filePath,
					title: item.label,
					tocHref: item.href,
					tocLevel: item.level
				});
				return;
			}

			const topics = (await topicProvider())
				.filter((topic) => String(topic.id || '').trim() && String(topic.name || '').trim());
			if (topics.length === 0) {
				new Notice(t('epub.reader.noIncrementalTopics'));
				return;
			}

			const menu = new Menu();
			for (const topic of topics) {
				menu.addItem((menuItem) => {
					menuItem.setTitle(topic.name);
					menuItem.onClick(() => {
						void plugin.scheduleEpubChapterForIncrementalReading?.({
							filePath,
							title: item.label,
							tocHref: item.href,
							tocLevel: item.level,
							deckId: topic.id,
						});
					});
				});
			}
			if (domInstanceOf(event, MouseEvent)) {
				menu.showAtMouseEvent(event);
			} else {
				menu.showAtPosition({
					x: Math.max(24, Math.round(window.innerWidth / 2)),
					y: Math.max(24, Math.round(window.innerHeight / 2)),
				});
			}
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to add chapter to incremental reading:', error);
			new Notice(t('epub.reader.addToIncrementalReadingFailed'));
		}
	}

	async function exportCurrentChapterToMarkdown() {
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_CHAPTER_EXPORT, t('epub.reader.chapterExportFeatureNotice'))) {
			return;
		}
		try {
			const plugin = getMarkdownExportHost();
			if (!plugin?.exportEpubChapterToMarkdown) {
				new Notice(t('epub.reader.exportMarkdownUnavailable'));
				return;
			}

			const chapterHref = readerService.getCurrentChapterHref?.() || '';
			const titleHint = readerService.getCurrentChapterTitle() || book?.metadata.title || t('epub.reader.epubChapterDefaultTitle');
			if (!chapterHref) {
				new Notice(t('epub.reader.chapterLocateFailed'));
				return;
			}

			const draft = await readerService.getChapterReadingPointDraft?.(chapterHref, titleHint);
			if (!draft?.text?.trim()) {
				new Notice(t('epub.reader.chapterExtractFailed'));
				return;
			}

			await plugin.exportEpubChapterToMarkdown({
				filePath,
				title: draft.title || titleHint,
				body: draft.text,
				markdown: draft.markdown,
				assets: draft.assets,
				sourceLink: buildChapterReadingPointSourceLink(
					draft.title || titleHint,
					draft.cfi,
					draft.chapterIndex
				),
				bookTitle: book?.metadata.title,
				author: book?.metadata.author,
			});
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to export current chapter to markdown:', error);
			new Notice(t('epub.reader.exportMarkdownFailed'));
		}
	}

	async function exportChapterMarkedDraftToMarkdown(
		draft: EpubChapterReadingPointDraft,
		titleHint: string,
		options?: { restrictHighlightsToDraftText?: boolean }
	) {
		if (!book) {
			new Notice(t('epub.reader.bookNotReady'));
			return;
		}

		const plugin = getMarkdownExportHost();
		if (!plugin?.exportEpubChapterToMarkdown) {
			new Notice(t('epub.reader.exportMarkdownUnavailable'));
			return;
		}

		const chapterIndex = draft.chapterIndex;
		let chapterHighlights = (await annotationService.collectAllHighlights(book.id, filePath, backlinkService))
			.filter((highlight) =>
				highlightBelongsToChapterExport(highlight, chapterIndex, draft.chapterHref, {
					getSectionIndexForCfi: (cfi) => readerService.getSectionIndexForCfi?.(cfi) ?? null,
					getSectionHrefForCfi: (cfi) => readerService.getSectionHrefForCfi?.(cfi) ?? null,
				})
			);
		if (options?.restrictHighlightsToDraftText) {
			chapterHighlights = chapterHighlights.filter((highlight) =>
				highlightTextAppearsInChapterDraft(highlight, draft.text)
			);
		}

		const sourceMarkdown = draft.markdown || draft.text;
		const markedExport = await applyChapterHighlightsToMarkdownAsync(sourceMarkdown, chapterHighlights, {
			plainText: draft.text,
			resolveRangeText: (highlight) =>
				readerService.resolveChapterHighlightRangeText?.(
					highlight,
					draft.chapterHref,
					chapterIndex
				) ?? Promise.resolve(null),
		});

		await plugin.exportEpubChapterToMarkdown({
			filePath,
			title: draft.title || titleHint,
			body: draft.text,
			markdown: markedExport.markdown,
			footnotesMarkdown: markedExport.footnotesMarkdown,
			assets: draft.assets,
			sourceLink: buildChapterReadingPointSourceLink(
				draft.title || titleHint,
				draft.cfi,
				draft.chapterIndex
			),
			bookTitle: book.metadata.title,
			author: book.metadata.author,
		});
	}

	async function exportCurrentChapterMarkedToMarkdown() {
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_CHAPTER_EXPORT, t('epub.reader.chapterExportFeatureNotice'))) {
			return;
		}
		try {
			const chapterHref = readerService.getCurrentChapterHref?.() || '';
			const titleHint = readerService.getCurrentChapterTitle() || book?.metadata.title || t('epub.reader.epubChapterDefaultTitle');
			if (!chapterHref) {
				new Notice(t('epub.reader.chapterLocateFailed'));
				return;
			}

			const draft = await readerService.getChapterReadingPointDraft?.(chapterHref, titleHint);
			if (!draft?.text?.trim()) {
				new Notice(t('epub.reader.chapterExtractFailed'));
				return;
			}

			await exportChapterMarkedDraftToMarkdown(draft, titleHint);
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to export current chapter marked markdown:', error);
			new Notice(t('epub.reader.exportMarkdownFailed'));
		}
	}

	async function exportTocChapterMarkedToMarkdown(
		item: TocItem,
		itemIndex: number,
		flatTocItems: FlatTocExportItem[]
	) {
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_CHAPTER_EXPORT, t('epub.reader.chapterExportFeatureNotice'))) {
			return;
		}
		try {
			if (!readerService.getTocChapterReadingPointDraft) {
				new Notice(t('epub.reader.exportMarkdownUnavailable'));
				return;
			}

			const titleHint = String(item.label || '').trim() || t('epub.reader.epubChapterDefaultTitle');
			const draft = await readerService.getTocChapterReadingPointDraft(
				item.href,
				titleHint,
				flatTocItems,
				itemIndex
			);
			if (!draft?.text?.trim()) {
				new Notice(t('epub.reader.chapterExtractFailed'));
				return;
			}

			await exportChapterMarkedDraftToMarkdown(draft, titleHint, {
				restrictHighlightsToDraftText: true,
			});
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to export toc chapter marked markdown:', error);
			new Notice(t('epub.reader.exportMarkdownFailed'));
		}
	}

	function getHighlightStyleLabel(highlight: ReaderHighlight): string | null {
		if (highlight.presentation === 'conceal') {
			return t('epub.reader.concealed');
		}

		switch (highlight.style) {
			case 'underline':
				return t('epub.reader.underline');
			case 'strikethrough':
				return t('epub.reader.strikethrough');
			case 'wavy':
				return t('epub.reader.wavy');
			default:
				return null;
		}
	}

	function isHighlightSelectedForBookNotesExport(highlight: ReaderHighlight): boolean {
		if (highlight.presentation !== 'highlight') {
			return false;
		}
		if (highlight.style === 'underline') {
			return excerptSettings.bookNotesExportIncludeUnderline;
		}
		if (highlight.style === 'strikethrough') {
			return excerptSettings.bookNotesExportIncludeStrikethrough;
		}
		if (highlight.style === 'wavy') {
			return excerptSettings.bookNotesExportIncludeWavy;
		}
		return excerptSettings.bookNotesExportIncludeHighlight;
	}

	function ensureBookNotesExportSelection(): boolean {
		return Boolean(
			excerptSettings.bookNotesExportIncludeHighlight ||
			excerptSettings.bookNotesExportIncludeUnderline ||
			excerptSettings.bookNotesExportIncludeStrikethrough ||
			excerptSettings.bookNotesExportIncludeWavy
		);
	}

	async function updateBookNotesExportSetting(
		patch: Partial<Pick<
			EpubExcerptSettings,
			| 'bookNotesExportIncludeHighlight'
			| 'bookNotesExportIncludeUnderline'
			| 'bookNotesExportIncludeStrikethrough'
			| 'bookNotesExportIncludeWavy'
			| 'bookNotesExportTemplatePath'
			| 'bookNotesExportTargetMode'
			| 'bookNotesExportAppendPath'
		>>
	) {
		await applyAndPersistExcerptSettings(patch);
	}

	function canSubmitBookNotesExport(): boolean {
		if (!ensureBookNotesExportSelection()) {
			return false;
		}
		if (!String(excerptSettings.bookNotesExportTemplatePath || '').trim()) {
			return false;
		}
		if (
			excerptSettings.bookNotesExportTargetMode === 'append' &&
			!String(excerptSettings.bookNotesExportAppendPath || '').trim()
		) {
			return false;
		}
		return true;
	}

	function buildBookNotesExportLabels() {
		return buildBookNotesExportLabelsFromTranslator(t);
	}

	async function resolveHighlightPageNumber(highlight: ReaderHighlight): Promise<number | undefined> {
		if (!highlight.cfiRange) {
			return undefined;
		}
		try {
			const pageNumber = await readerService.getPageNumberFromCfi(highlight.cfiRange);
			return typeof pageNumber === 'number' && Number.isFinite(pageNumber) && pageNumber > 0
				? pageNumber
				: undefined;
		} catch {
			return undefined;
		}
	}

	async function renderBookNotesExportMarkdown(highlights: ReaderHighlight[]): Promise<string> {
		if (!book) {
			throw new Error('Book not ready');
		}
		return await renderBookNotesMarkdown({
			app,
			book,
			filePath,
			highlights,
			templatePath: excerptSettings.bookNotesExportTemplatePath,
			templateFolder: excerptSettings.bookNotesExportTemplateFolder,
			legacyTemplate: excerptSettings.bookNotesExportLegacyTemplate,
			trimBlocks: excerptSettings.bookNotesExportTrimBlocks,
			labels: buildBookNotesExportLabels(),
			formatTimestamp,
			resolvePageNumber: resolveHighlightPageNumber,
		});
	}

	async function exportRenderedBookNotes(
		markdown: string,
		options: {
			bookTitle?: string;
			targetMode?: EpubExcerptSettings['bookNotesExportTargetMode'];
			appendTargetPath?: string | null;
			rememberAppendTarget?: boolean;
		} = {}
	): Promise<void> {
		const plugin = getMarkdownExportHost();
		if (!plugin?.exportEpubBookNotesToMarkdown) {
			new Notice(t('epub.reader.exportMarkdownUnavailable'));
			return;
		}
		if (!book) {
			new Notice(t('epub.reader.bookNotReady'));
			return;
		}

		const targetMode = options.targetMode ?? excerptSettings.bookNotesExportTargetMode;
		const appendTargetPath =
			options.appendTargetPath ?? excerptSettings.bookNotesExportAppendPath;

		await plugin.exportEpubBookNotesToMarkdown({
			filePath,
			markdown,
			bookTitle: options.bookTitle || book.metadata.title,
			targetMode,
			appendTargetPath,
		});

		if (options.rememberAppendTarget !== false && targetMode === 'append' && appendTargetPath) {
			await storageService.saveBookNotesExportAppendPath(filePath, appendTargetPath);
			await updateBookNotesExportSetting({
				bookNotesExportAppendPath: appendTargetPath,
			});
		}
	}

	async function prepareExportNotesPopoverState(): Promise<void> {
		await excerptSettingsReady;
		const templateFolder = resolveBookNotesExportTemplateFolder(excerptSettings);
		if (!templateFolder) {
			return;
		}
		const templateResult = await ensureDefaultBookNotesExportTemplates(app, templateFolder);
		const perBookAppendPath = await storageService.loadBookNotesExportAppendPath(filePath);
		const patch: Partial<EpubExcerptSettings> = {};

		if (
			!String(excerptSettings.bookNotesExportTemplatePath || '').trim() &&
			templateResult.digestBTemplatePath
		) {
			patch.bookNotesExportTemplatePath = templateResult.digestBTemplatePath;
		}
		if (perBookAppendPath && !String(excerptSettings.bookNotesExportAppendPath || '').trim()) {
			patch.bookNotesExportAppendPath = perBookAppendPath;
		}
		if (Object.keys(patch).length > 0) {
			await applyAndPersistExcerptSettings(patch);
		}
	}

	async function updateBookNotesExportTargetMode(
		targetMode: EpubExcerptSettings['bookNotesExportTargetMode']
	): Promise<void> {
		if (excerptSettings.bookNotesExportTargetMode === targetMode) {
			return;
		}
		await updateBookNotesExportSetting({ bookNotesExportTargetMode: targetMode });
	}

	function closeExportNotesPopover() {
		exportNotesPopoverOpen = false;
		exportNotesSubmitting = false;
	}

	function openExportNotesPopover(event?: MouseEvent) {
		event?.preventDefault();
		exportNotesSubmitting = false;
		// Defer until Obsidian pane menu has dismissed so outside-clicks do not hit both layers.
		window.setTimeout(() => {
			void prepareExportNotesPopoverState().finally(() => {
				exportNotesPopoverOpen = true;
			});
		}, 0);
	}

	function handleExportNotesPointerDownOutside(event: MouseEvent) {
		if (!exportNotesPopoverOpen || !exportNotesPopoverEl) {
			return;
		}
		if (!shouldDismissToolbarOnPointerDown(exportNotesPopoverEl, event)) {
			return;
		}
		closeExportNotesPopover();
	}

	function getHighlightChapterIndex(highlight: ReaderHighlight): number | undefined {
		return typeof highlight.chapterIndex === 'number' && Number.isFinite(highlight.chapterIndex)
			? highlight.chapterIndex
			: undefined;
	}

	function buildReaderHighlightSelectionKey(highlight: ReaderHighlight): string {
		return buildEpubDisplayHighlightSelectionKey({
			cfiRange: highlight.cfiRange,
			sourceRef: highlight.sourceRef,
			sourceFile: highlight.sourceFile,
			excerptId: highlight.excerptId,
		});
	}

	function buildHighlightClickInfoFromDisplay(highlight: EpubDisplayHighlight): HighlightClickInfo {
		const style =
			highlight.noteTypeKey === 'underline' ||
			highlight.noteTypeKey === 'strikethrough' ||
			highlight.noteTypeKey === 'wavy'
				? highlight.noteTypeKey
				: undefined;
		return {
			cfiRange: highlight.cfiRange,
			color: highlight.color,
			style,
			text: highlight.text,
			commentText: highlight.commentText,
			hasCommentDivider: highlight.hasCommentDivider,
			sourceFile: highlight.sourceFile || '',
			sourceRef: highlight.sourceRef,
			excerptId: highlight.excerptId,
			createdTime: highlight.createdTime,
			presentation: 'highlight',
			rect: { top: 0, left: 0, width: 0, height: 0 },
		};
	}

	async function exportHighlightsBySelectionKeys(selectionKeys: string[]): Promise<void> {
		try {
			const plugin = getMarkdownExportHost();
			if (!plugin?.exportEpubBookNotesToMarkdown) {
				new Notice(t('epub.reader.exportMarkdownUnavailable'));
				return;
			}
			if (!book) {
				new Notice(t('epub.reader.bookNotReady'));
				return;
			}
			if (!ensureBookNotesExportSelection()) {
				new Notice(t('epub.reader.selectAtLeastOneExportType'));
				return;
			}

			const keySet = new Set(selectionKeys);
			const highlights = (await annotationService.collectAllHighlights(book.id, filePath, backlinkService))
				.filter((highlight) => keySet.has(buildReaderHighlightSelectionKey(highlight)))
				.filter(isHighlightSelectedForBookNotesExport);
			if (highlights.length === 0) {
				new Notice(t('epub.notes.noExportableSelection'));
				return;
			}

			const markdown = await renderBookNotesExportMarkdown(highlights);
			await exportRenderedBookNotes(markdown, {
				targetMode: 'new',
				rememberAppendTarget: false,
			});
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to export selected highlights to markdown:', error);
			new Notice(t('epub.reader.exportReadingNotesFailed'));
		}
	}

	async function exportCurrentChapterHighlightsToMarkdown() {
		try {
			if (!book) {
				new Notice(t('epub.reader.bookNotReady'));
				return;
			}
			if (!ensureBookNotesExportSelection()) {
				new Notice(t('epub.reader.selectAtLeastOneExportType'));
				return;
			}

			const chapterIndex = readerService.getCurrentChapterIndex();
			const chapterTitle = readerService.getCurrentChapterTitle() || t('epub.reader.epubChapterDefaultTitle');
			const highlights = (await annotationService.collectAllHighlights(book.id, filePath, backlinkService))
				.filter((highlight) => getHighlightChapterIndex(highlight) === chapterIndex)
				.filter(isHighlightSelectedForBookNotesExport);
			if (highlights.length === 0) {
				new Notice(t('epub.reader.noChapterExportableNotes'));
				return;
			}

			const markdown = await renderBookNotesExportMarkdown(highlights);
			await exportRenderedBookNotes(markdown, {
				bookTitle: `${book.metadata.title} - ${chapterTitle}`,
				targetMode: 'new',
				rememberAppendTarget: false,
			});
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to export current chapter highlights to markdown:', error);
			new Notice(t('epub.reader.exportReadingNotesFailed'));
		}
	}

	async function exportBookHighlightsToMarkdown(event?: MouseEvent) {
		try {
			if (!book) {
				new Notice(t('epub.reader.bookNotReady'));
				return;
			}

			if (event) {
				openExportNotesPopover(event);
				return;
			}

			if (!canSubmitBookNotesExport()) {
				if (!ensureBookNotesExportSelection()) {
					new Notice(t('epub.reader.selectAtLeastOneExportType'));
				} else if (!String(excerptSettings.bookNotesExportTemplatePath || '').trim()) {
					new Notice(t('epub.reader.exportNotesPopover.templateRequired'));
				} else {
					new Notice(t('epub.reader.exportNotesPopover.appendTargetRequired'));
				}
				return;
			}

			const highlights = (await annotationService.collectAllHighlights(book.id, filePath, backlinkService))
				.filter(isHighlightSelectedForBookNotesExport);
			if (highlights.length === 0) {
				new Notice(t('epub.reader.noExportableNotes'));
				return;
			}

			const markdown = await renderBookNotesExportMarkdown(highlights);
			await exportRenderedBookNotes(markdown);
			closeExportNotesPopover();
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to export book highlights to markdown:', error);
			new Notice(t('epub.reader.exportReadingNotesFailed'));
			exportNotesSubmitting = false;
		}
	}

	async function submitBookNotesExport() {
		if (exportNotesSubmitting) {
			return;
		}
		if (!hasExcerptNotesCapability()) {
			return;
		}
		exportNotesSubmitting = true;
		try {
			await exportBookHighlightsToMarkdown();
		} finally {
			if (exportNotesPopoverOpen) {
				exportNotesSubmitting = false;
			}
		}
	}

	async function handleHighlightExtractToCard(info: HighlightClickInfo) {
		await extractContentToCard(
			buildNoteContent(info.text, info.cfiRange, info.color, info.style),
			t('epub.reader.createCardSuccess'),
			'Failed to extract highlight to card',
			t('epub.reader.highlightExtractFailed'),
			() => {
				highlightToolbarInfo = null;
			}
		);
	}

        function handleAutoInsertSelection(
		text: string,
		cfiRange: string,
		color?: string,
		style?: EpubHighlightStyle
	) {
		if (!hasExcerptNotesCapability()) {
			return;
		}
		outputNote(text, cfiRange, color, style);
	}

	async function handleConcealSelection(text: string, cfiRange: string) {
		if (!hasExcerptNotesCapability()) {
			return;
		}
		if (!book) {
			new Notice(t('epub.reader.bookNotReady'));
			return;
		}

		try {
			const canonicalCfi = typeof readerService.canonicalizeLocation === 'function'
				? await readerService.canonicalizeLocation(cfiRange, text)
				: cfiRange;
			await annotationService.createConcealedText(
				book.id,
				text,
				readerService.getCurrentChapterIndex(),
				canonicalCfi || cfiRange,
				'mask'
			);
			new Notice(t('epub.reader.hideTextSuccess'));
			void reloadHighlights();
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to conceal selection:', error);
			new Notice(t('epub.reader.hideTextFailed'));
		}
	}

	function requestSourceBookLocate(nav: BookLocateIntent): boolean {
		if (!ensureBookSourceLocationAccess(app, t('epub.reader.sourceLocationFeatureNotice'))) {
			return false;
		}
		epubNavigation.requestBookLocate(nav);
		return true;
	}

	function requestBookLocate(nav: BookLocateIntent) {
		epubNavigation.requestBookLocate(nav);
	}

	function flushPendingLocateFromProps() {
		if (!hasSourceLocationCapability()) {
			return;
		}
		epubNavigation.flushPendingLocateFromProps(pendingLocate, pendingCfi, pendingText);
	}

	/** `linkTextHint` is only honored when embedded in link metadata, not callout body text. */
	function navigateToCfi(cfi: string, linkTextHint = '') {
		requestSourceBookLocate({
			cfi,
			text: linkTextHint,
			flashStyle: 'highlight',
			showLocateOverlay: true,
		});
	}

	function getVisibleReaderFrames(): EpubVisibleFrameLike[] {
		return readerService.getVisibleFrames() as EpubVisibleFrameLike[];
	}

	async function handleScreenshotCapture(blob: Blob, rect: ScreenshotRect) {
		const currentCfi = readerService.getCurrentCFI();
		const chapterIndex = readerService.getCurrentChapterIndex();
		const chapterTitle = resolveExcerptChapterTitle();
		const targetNotePath = (getLastActiveMarkdownLeaf?.()?.view as MarkdownView | undefined)?.file?.path;

		let canvasContent: string | null = null;

		if (autoInsert) {
			if (screenshotSaveAsImage) {
				const bookTitle = book?.metadata.title || 'epub';
				const imagePath = await screenshotService.saveAsJpeg(blob, bookTitle);
				const insertText = screenshotService.buildJpegInsert(
					imagePath,
					filePath,
					currentCfi,
					chapterIndex,
					chapterTitle,
					targetNotePath
				);
				insertToEditorAndTrack(insertText);
				canvasContent = insertText;
			} else {
				const extractedText = screenshotService.extractTextFromRect(viewportEl!, rect, getVisibleReaderFrames());
				const insertText = screenshotService.buildSnapshotEmbed(
					filePath,
					currentCfi,
					extractedText,
					chapterIndex,
					chapterTitle,
					targetNotePath
				);
				insertToEditorAndTrack(insertText);
				canvasContent = insertText;
			}
		} else {
			if (screenshotSaveAsImage) {
				const pngBlob = await convertToClipboardImage(blob);
				await copyImageToClipboard(pngBlob);
			} else {
				const extractedText = screenshotService.extractTextFromRect(viewportEl!, rect, getVisibleReaderFrames());
				const content = screenshotService.buildSnapshotEmbed(
					filePath,
					currentCfi,
					extractedText,
					chapterIndex,
					chapterTitle,
					targetNotePath
				);
				await copyTextToClipboard(content);
				canvasContent = content;
			}
		}

		if (canvasMode && canvasService.isActive() && canvasContent) {
			const node = await canvasService.addRawTextNode(canvasContent);
			if (node) {
				showCanvasAddedNotice(canvasService.getLastInsertAnchorMode());
			}
		}
	}

	async function convertToClipboardImage(blob: Blob): Promise<Blob> {
		const img = new Image();
		const url = URL.createObjectURL(blob);
		return new Promise((resolve) => {
			img.onload = () => {
				const canvas = activeWindow.createEl('canvas');
				canvas.width = img.naturalWidth;
				canvas.height = img.naturalHeight;
				const ctx = canvas.getContext('2d')!;
				ctx.drawImage(img, 0, 0);
				URL.revokeObjectURL(url);
				canvas.toBlob((b) => resolve(b || blob), 'image/png');
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
				resolve(blob);
			};
			img.src = url;
		});
	}

	function handleEpubNavigateEvent(e: Event) {
		const detail = (e as CustomEvent).detail;
		if (!detail || detail.filePath !== filePath) return;

		const nav = epubNavigation.buildLocateFromEventDetail(detail);
		if (nav) {
			requestSourceBookLocate(nav);
		}
	}

	function setupHighlightClickHandler() {
		readerService.onHighlightClick((info: HighlightClickInfo) => {
			footnotePreviewInfo = null;
			if (info.interactionTarget === 'comment-marker') {
				referencePopoverInfo = null;
				referencePopoverStats = null;
				openCommentEditor(info);
				return;
			}
			if (info.interactionTarget === 'reference-badge') {
				return;
			}
			referencePopoverInfo = null;
			referencePopoverStats = null;
			closeCommentEditor();
			highlightToolbarInfo = info;
		});
	}

	function setupScrolledChapterEndHandler() {
		scrolledChapterEndCleanup?.();
		scrolledChapterEndCleanup = null;
		if (typeof readerService.onScrolledChapterEndChange !== 'function') {
			return;
		}
		scrolledChapterEndCleanup = readerService.onScrolledChapterEndChange(() => {
			syncScrolledChapterNavVisibility();
		});
	}

	function setupReferenceBadgeClickHandler() {
		referenceBadgeClickCleanup?.();
		referenceBadgeClickCleanup = null;

		const cleanupTasks: Array<() => void> = [];

		if (typeof readerService.onReferenceBadgeClick === 'function') {
			cleanupTasks.push(
				readerService.onReferenceBadgeClick((info: HighlightClickInfo) => {
					void handleReferenceBadgeClick(info);
				})
			);
		}

		// 保留旧的 DOM 自定义事件监听作为兼容兜底。
		if (readerService && typeof (readerService as any).foliateView !== 'undefined') {
			const foliateView = (readerService as any).foliateView;
			if (foliateView) {
				const handleReferenceBadgeClickEvent = (event: Event) => {
					const customEvent = event as CustomEvent;
					const cfiRange = customEvent.detail?.cfiRange;
					if (cfiRange) {
						const info = readerService.getHighlightClickInfo?.(cfiRange, 'reference-badge') || cfiRange;
						void handleReferenceBadgeClick(info);
					}
				};

				foliateView.addEventListener('reference-badge-click', handleReferenceBadgeClickEvent as EventListener);
				cleanupTasks.push(() => {
					foliateView.removeEventListener(
						'reference-badge-click',
						handleReferenceBadgeClickEvent as EventListener
					);
				});
			}
		}

		if (cleanupTasks.length > 0) {
			referenceBadgeClickCleanup = () => {
				for (const cleanup of cleanupTasks) {
					cleanup();
				}
			};
		}
	}

	function setupFootnotePreviewHandler() {
		readerService.onFootnotePreview((info: ReaderFootnotePreviewInfo | null) => {
			logger.debugWithTag(
				'FootnoteDiag',
				`[FootnoteDiag] EpubReaderApp received footnote preview event hasInfo=${String(Boolean(info))} href=${info?.href || ''} textLength=${String(info?.text.length || 0)}`
			);
			if (!hasFootnotePreviewCapability()) {
				footnotePreviewInfo = null;
				return;
			}
			if (highlightToolbarInfo || commentEditorInfo) {
				footnotePreviewInfo = null;
				return;
			}
			footnotePreviewInfo = info;
		});
	}

	function openCommentEditor(info: HighlightClickInfo) {
		if (!hasExcerptNotesCapability()) {
			return;
		}
		highlightToolbarInfo = null;
		footnotePreviewInfo = null;
		referencePopoverInfo = null;
		referencePopoverStats = null;
		commentEditorInfo = info;
		commentEditorDraft = resolveCommentDraftFromMemory(info);
		commentEditorSaving = false;
		void hydrateCommentEditorDraft(info);
	}

	async function hydrateCommentEditorDraft(info: HighlightClickInfo) {
		const hydrated = await resolveCommentDraftFromSource(info);
		if (commentEditorInfo !== info) {
			return;
		}
		commentEditorDraft = hydrated;
		if (!hydrated.trim()) {
			return;
		}
		if (info.commentText === hydrated && info.hasCommentDivider) {
			return;
		}
		const refreshedHighlight: ReaderHighlight = {
			cfiRange: info.cfiRange,
			color: info.color,
			style: info.style,
			text: info.text,
			commentText: hydrated,
			hasCommentDivider: true,
			sourceFile: info.sourceFile,
			sourceRef: info.sourceRef,
			excerptId: info.excerptId,
			sourceLocators: info.sourceLocators,
			createdTime: info.createdTime,
			presentation: info.presentation,
		};
		readerService.addHighlight(refreshedHighlight);
		pendingLoadedHighlights = mergeReaderHighlightsByIdentity(
			pendingLoadedHighlights,
			[refreshedHighlight]
		);
	}

	function closeCommentEditor() {
		commentEditorInfo = null;
		commentEditorDraft = '';
		commentEditorSaving = false;
	}

	function closeReferencePopover() {
		referencePopoverInfo = null;
		referencePopoverStats = null;
	}

	function syncAsActiveEpubDocumentIfActive(leaf: WorkspaceLeaf | null = app.workspace.activeLeaf): void {
		if (isActiveEpubReaderInstance(leaf)) {
			syncAsActiveEpubDocument();
		}
	}

	function handleWorkspaceActiveLeafChange(leaf: WorkspaceLeaf | null): void {
		syncAsActiveEpubDocumentIfActive(leaf);
	}

	function syncAsActiveEpubDocument() {
		const activeFilePath = filePath?.trim() ? filePath : null;
		const canUseReadingProgress = hasReadingProgressCapability();
		const canUseExcerptNotes = hasExcerptNotesCapability();
		if (!activeFilePath) {
			epubActiveDocumentStore.clearActiveDocument();
			epubActiveDocumentStore.setSharedState({
				filePath: null,
				canUseReadingProgress,
				canUseExcerptNotes,
				excerptSettings,
				highlightViewSnapshotService: canUseExcerptNotes ? highlightViewSnapshotService : null,
				onDeleteBookmark: null,
				onDeleteHighlight: null,
				onExportHighlights: null,
				onSettingsClick: showSettingsMenu,
			});
			return;
		}

		epubActiveDocumentStore.setActiveDocument(activeFilePath);
		epubActiveDocumentStore.setSharedState({
			filePath: activeFilePath,
			readerService,
			annotationService: canUseExcerptNotes ? annotationService : null,
			highlightViewSnapshotService: canUseExcerptNotes ? highlightViewSnapshotService : null,
			backlinkService: canUseExcerptNotes ? backlinkService : null,
			referenceStatsService: canUseExcerptNotes ? referenceStatsService : null,
			book,
			canUseReadingProgress,
			canUseExcerptNotes,
			excerptSettings,
			annotationRevision,
			bookmarkRevision,
			tocChapterMarks,
			tocChapterMarkSettings,
			tocChapterMarkRevision,
			tocChapterMarkSettingsRevision,
			progress: canUseReadingProgress ? readingProgress : 0,
			chapterTitle: readerService.getCurrentChapterTitle(),
			chapterHref: readerService.getCurrentChapterHref?.() || '',
			paginationInfo,
			onDeleteBookmark: deleteBookmarkById,
			onDeleteHighlight: canUseExcerptNotes ? deleteDisplayHighlight : null,
			onExportHighlights: canUseExcerptNotes ? exportHighlightsBySelectionKeys : null,
			onNavigate: requestBookLocate,
			onSettingsClick: showSettingsMenu,
			onSwitchBook,
			onCreateChapterReadingPoint: hasScheduleChapterForIncrementalReadingCapability()
				? handleCreateChapterReadingPoint
				: null,
			onExportTocChapterMarked: hasChapterExportCapability()
				? exportTocChapterMarkedToMarkdown
				: null,
			onSetTocChapterMark: handleSetTocChapterMark,
			onSaveTocChapterMarkSettings: handleSaveTocChapterMarkSettings,
		});
	}

	async function resolveHighlightSource(info: HighlightClickInfo): Promise<BacklinkSourceMatch | null> {
		let sourceFile = String(info.sourceFile || '').trim();
		let sourceRef = info.sourceRef;
		let excerptId = info.excerptId;
		let storedCfiRange: string | undefined;

		const resolved = await backlinkService.findSourceForCfi(
			info.cfiRange,
			filePath,
			sourceFile || undefined,
			{
				text: info.text,
				createdTime: info.createdTime,
			}
		);
		if (resolved?.sourceFile) {
			sourceFile = resolved.sourceFile;
			if (!sourceRef && resolved.sourceRef) {
				sourceRef = resolved.sourceRef;
			}
			if (!excerptId && resolved.excerptId) {
				excerptId = resolved.excerptId;
			}
			if (resolved.cfiRange) {
				storedCfiRange = resolved.cfiRange;
			}
		}

		if (!sourceFile) {
			sourceFile = await backlinkService.findSourceFileForCfi(info.cfiRange, filePath) || '';
		}

		if (!sourceFile) {
			return null;
		}

		return {
			sourceFile,
			sourceRef,
			excerptId,
			cfiRange: storedCfiRange,
		};
	}

	function resolveHighlightMutationCfi(
		info: HighlightClickInfo,
		source: BacklinkSourceMatch
	): string {
		return String(source.cfiRange || info.cfiRange || '').trim();
	}

	async function handleHighlightDelete(
		info: HighlightClickInfo,
		options?: { quiet?: boolean }
	): Promise<boolean> {
		const quiet = options?.quiet === true;
		if (!hasExcerptNotesCapability()) {
			return false;
		}
		if (info.presentation === 'conceal') {
			readerService.removeHighlight(info.cfiRange);
			if (!book) {
				if (!quiet) {
					new Notice(t('epub.reader.bookNotReady'));
				}
				return false;
			}
			await annotationService.deleteConcealedTextByCfi(book.id, info.cfiRange);
			if (!quiet) {
				new Notice(t('epub.reader.hideTextRestored'));
			}
			highlightToolbarInfo = null;
			void reloadHighlights();
			return true;
		}
		const source = await resolveHighlightSource(info);
		if (!source?.sourceFile) {
			if (!quiet) {
				new Notice(t('epub.reader.highlightSourcePending'));
			}
			void reloadHighlights();
			return false;
		}
		const mutationCfiRange = resolveHighlightMutationCfi(info, source);

		const officialApi = resolveEpubWeaveOfficialAPI(app);
		const officialApiInfo = officialApi?.getInfo?.();
		const canUseOfficialExcerptApi = !!(
			officialApi?.removeExcerpt &&
			officialApiInfo?.capabilities?.excerpts?.remove
		);
		const supportsInteractiveUserChoice = !!officialApiInfo?.capabilities?.excerpts?.supportsInteractiveUserChoice;

		if (canUseOfficialExcerptApi) {
			const officialApiResult = await deleteHighlightThroughOfficialAPI(
				officialApi,
				info,
				source,
				mutationCfiRange,
				supportsInteractiveUserChoice
			);
			if (officialApiResult !== 'fallback') {
				if (officialApiResult === 'success') {
					readerService.removeHighlight(info.cfiRange);
					if (!quiet) {
						new Notice(t('epub.reader.highlightDeleted'));
					}
					highlightToolbarInfo = null;
					reloadHighlightsAfterExcerptMutation(source.sourceFile);
					return true;
				}
				if (officialApiResult === 'failed') {
					if (!(await isHighlightStillPersistedInSource(info, source))) {
						await finalizeHighlightRemoval(info, source, { quiet });
						return true;
					}
					if (!quiet) {
						new Notice(t('epub.reader.highlightDeleteFailed'));
					}
				}
				if (officialApiResult !== 'cancelled') {
					void reloadHighlights({ invalidateCache: true });
				}
				return false;
			}
		}

		let cardDeletionMode: 'excerpt-only' | 'delete-card' | undefined;
		if (source.sourceFile.endsWith('.json') || source.sourceFile.endsWith('.wdeck')) {
			const analysis = await backlinkService.inspectCardDataHighlightDeletion(
				source.sourceFile,
				mutationCfiRange,
				filePath,
				source.sourceRef,
				source.excerptId
			);

			if (analysis?.hasAdditionalContent) {
				const message = [
					t('epub.reader.highlightDeleteChoiceMessage'),
					analysis.additionalContentPreview
						? `${t('epub.reader.highlightDeleteChoicePreviewLabel')}\n${analysis.additionalContentPreview}`
						: '',
				].filter(Boolean).join('\n\n');
				const choice = await showObsidianChoice(app, message, {
					title: t('epub.reader.highlightDeleteChoiceTitle'),
					cancelText: t('epub.reader.highlightDeleteChoiceCancel'),
					choices: [
						{
							value: 'excerpt-only',
							text: t('epub.reader.highlightDeleteChoiceExcerptOnly'),
							description: t('epub.reader.highlightDeleteChoiceExcerptOnlyDescription'),
							className: 'mod-cta',
						},
						{
							value: 'delete-card',
							text: t('epub.reader.highlightDeleteChoiceDeleteCard'),
							description: t('epub.reader.highlightDeleteChoiceDeleteCardDescription'),
							className: 'mod-warning',
						},
					],
				});

				if (!choice) {
					reloadHighlightsAfterExcerptMutation(source.sourceFile);
					return false;
				}
				cardDeletionMode = choice;
			} else if (analysis?.matched) {
				cardDeletionMode = analysis.recommendedMode;
			}
		}

		const deleted = await backlinkService.deleteHighlight(
			source.sourceFile,
			mutationCfiRange,
			filePath,
			source.sourceRef,
			source.excerptId,
			cardDeletionMode
		);
		if (deleted) {
			readerService.removeHighlight(info.cfiRange);
			if (!quiet) {
				new Notice(t('epub.reader.highlightDeleted'));
			}
			highlightToolbarInfo = null;
			reloadHighlightsAfterExcerptMutation(source.sourceFile);
			return true;
		}
		if (!(await isHighlightStillPersistedInSource(info, source))) {
			await finalizeHighlightRemoval(info, source, { quiet });
			return true;
		}
		if (!quiet) {
			new Notice(t('epub.reader.highlightDeleteFailed'));
		}
		reloadHighlightsAfterExcerptMutation(source.sourceFile);
		return false;
	}

	async function deleteDisplayHighlight(highlight: EpubDisplayHighlight, quiet = false): Promise<boolean> {
		return handleHighlightDelete(buildHighlightClickInfoFromDisplay(highlight), { quiet });
	}

	async function deleteHighlightThroughOfficialAPI(
		api: EpubWeaveOfficialAPI,
		info: HighlightClickInfo,
		source: BacklinkSourceMatch & { excerptId?: string },
		mutationCfiRange: string,
		supportsInteractiveUserChoice: boolean
	): Promise<'success' | 'failed' | 'cancelled' | 'fallback'> {
		const initialResult = await api.removeExcerpt?.({
			sourceType: 'epub',
			epubFilePath: filePath,
			cfiRange: mutationCfiRange,
			cardId: extractCardIdFromSourceRef(source.sourceRef),
			sourceFile: source.sourceFile,
			sourceRef: source.sourceRef,
			excerptId: source.excerptId,
			mode: 'auto',
		});

		if (!initialResult) {
			return 'fallback';
		}

		if (initialResult.needsUserChoice && supportsInteractiveUserChoice) {
			const choice = await promptHighlightDeleteChoice(initialResult);
			if (!choice) {
				return 'cancelled';
			}
			const retryResult = await api.removeExcerpt?.({
				sourceType: 'epub',
				epubFilePath: filePath,
				cfiRange: mutationCfiRange,
				cardId:
					extractCardIdFromSourceRef(source.sourceRef) ||
					initialResult.affectedCardIds?.[0],
				sourceFile: source.sourceFile,
				sourceRef: source.sourceRef,
				excerptId: source.excerptId,
				mode: choice,
			});
			return retryResult?.success ? 'success' : 'failed';
		}

		if (initialResult.needsUserChoice) {
			return 'fallback';
		}

		if (!initialResult.success || initialResult.action === 'noop') {
			return 'failed';
		}

		return 'success';
	}

	function extractCardIdFromSourceRef(sourceRef?: string): string | undefined {
		const normalized = String(sourceRef || '').trim();
		if (!normalized.startsWith('card:')) {
			return undefined;
		}
		const cardId = normalized.slice(5).trim();
		return cardId || undefined;
	}

	async function promptHighlightDeleteChoice(
		result: EpubWeaveRemoveExcerptResult
	): Promise<EpubWeaveExcerptRemovalMode | null> {
		const message = [
			t('epub.reader.highlightDeleteChoiceMessage'),
			result.additionalContentPreview
				? `${t('epub.reader.highlightDeleteChoicePreviewLabel')}\n${result.additionalContentPreview}`
				: '',
		].filter(Boolean).join('\n\n');

		const choice = await showObsidianChoice(app, message, {
			title: t('epub.reader.highlightDeleteChoiceTitle'),
			cancelText: t('epub.reader.highlightDeleteChoiceCancel'),
			choices: [
				{
					value: 'excerpt-only',
					text: t('epub.reader.highlightDeleteChoiceExcerptOnly'),
					description: t('epub.reader.highlightDeleteChoiceExcerptOnlyDescription'),
					className: 'mod-cta',
				},
				{
					value: 'delete-card',
					text: t('epub.reader.highlightDeleteChoiceDeleteCard'),
					description: t('epub.reader.highlightDeleteChoiceDeleteCardDescription'),
					className: 'mod-warning',
				},
			],
		});

		return choice ?? null;
	}

        function handleTemporarilyRevealConcealed(info: HighlightClickInfo) {
                if (info.presentation !== 'conceal') {
                        return;
                }

                readerService.temporarilyRevealConcealedText?.(info.cfiRange, 3000);
                highlightToolbarInfo = null;
                new Notice(t('epub.reader.transientRevealSuccess'));
        }

        async function handleHighlightChangeColor(info: HighlightClickInfo, newColor: string) {
                if (!hasExcerptNotesCapability()) {
			return;
		}
		if (newColor === info.color) return;
		const source = await resolveHighlightSource(info);
		if (!source?.sourceFile) {
			new Notice(t('epub.reader.highlightSourcePending'));
			void reloadHighlights();
			return;
		}
		const changed = await backlinkService.changeHighlightColor(
			source.sourceFile,
			resolveHighlightMutationCfi(info, source),
			filePath,
			newColor,
			source.sourceRef,
			source.excerptId
		);

		if (changed) {
			highlightToolbarInfo = null;
			reloadHighlightsAfterExcerptMutation(source.sourceFile);
		} else {
			new Notice(t('epub.reader.changeColorFailed'));
		}
	}

	async function handleHighlightChangeStyle(
		info: HighlightClickInfo,
		newStyle?: HighlightClickInfo['style']
	) {
		if (!hasExcerptNotesCapability()) {
			return;
		}
		if (!ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_STYLED_EXCERPTS, t('epub.reader.styledExcerptFeatureNotice'))) {
			return;
		}
		if (newStyle === info.style) return;
		const source = await resolveHighlightSource(info);
		if (!source?.sourceFile) {
			new Notice(t('epub.reader.highlightSourcePending'));
			void reloadHighlights();
			return;
		}
		const changed = await backlinkService.changeHighlightStyle(
			source.sourceFile,
			resolveHighlightMutationCfi(info, source),
			filePath,
			newStyle,
			source.sourceRef,
			source.excerptId
		);

		if (changed) {
			highlightToolbarInfo = null;
			reloadHighlightsAfterExcerptMutation(source.sourceFile);
		} else {
			new Notice(t('epub.reader.changeStyleFailed'));
		}
	}

	async function handleReferenceBadgeClick(infoOrCfi: HighlightClickInfo | string) {
		if (!hasExcerptNotesCapability()) {
			if (isPremiumFeaturePreviewEnabled()) {
				openPremiumFeaturePreview(PREMIUM_FEATURES.EPUB_EXCERPT_NOTES);
			}
			return;
		}
		try {
			if (!book || !filePath) {
				logger.warn('[EpubReaderApp] Reference badge click ignored because reader context is incomplete', {
					hasBook: Boolean(book),
					filePath,
					cfiRange: typeof infoOrCfi === 'string' ? infoOrCfi : infoOrCfi.cfiRange,
				});
				new Notice(t('epub.reader.readingContextUnavailable'));
				return;
			}

			const info = typeof infoOrCfi === 'string'
				? readerService.getHighlightClickInfo?.(infoOrCfi, 'reference-badge') || null
				: infoOrCfi;
			const cfiRange = typeof infoOrCfi === 'string' ? infoOrCfi : infoOrCfi.cfiRange;

			const stats = await referenceStatsService.getStatsForCfi(
				filePath,
				cfiRange,
				getBoundCanvasPath()
			);

			if (!stats) {
				logger.warn('[EpubReaderApp] No reference stats found for clicked badge', {
					filePath,
					cfiRange,
				});
				new Notice(t('epub.reader.referenceStatsMissing'));
				return;
			}
			if (!info) {
				logger.warn('[EpubReaderApp] Reference stats found but anchor info is missing', {
					filePath,
					cfiRange,
				});
				new Notice(t('epub.reader.referenceRectUnavailable'));
				return;
			}
			closeCommentEditor();
			highlightToolbarInfo = null;
			footnotePreviewInfo = null;
			referencePopoverInfo = info;
			referencePopoverStats = stats;
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to open reference detail popover:', error);
			new Notice(t('epub.reader.referencePopoverOpenFailed'));
		}
	}

	async function handleHighlightBacklink(info: HighlightClickInfo) {
		if (!ensureBookSourceLocationAccess(app, t('epub.reader.sourceLocationFeatureNotice'))) {
			return;
		}
		const source = await resolveHighlightSource(info);
		if (!source?.sourceFile) {
			new Notice(t('epub.reader.relatedNoteMissing'));
			return;
		}

		const sourceFile = source.sourceFile;
		const sourceRef = source.sourceRef;

		if (sourceRef?.startsWith('card:')) {
			await navigateExternalSource({ kind: 'card', resourcePath: sourceRef.slice(5) });
			highlightToolbarInfo = null;
			return;
		}

		if (sourceFile.endsWith('.wdeck')) {
			await navigateExternalSource({ kind: 'json', resourcePath: sourceFile });
			highlightToolbarInfo = null;
			return;
		}

		const encodedCfi = EpubLinkService.encodeCfiForWikilink(info.cfiRange);

		if (sourceFile.endsWith('.canvas')) {
			await navigateExternalSource({
				kind: 'canvas',
				resourcePath: sourceFile,
				locate: { candidates: [encodedCfi, info.cfiRange, sourceFile] },
				context: { nodeId: sourceRef, epubFilePath: filePath },
			});
			highlightToolbarInfo = null;
			return;
		}

		if (sourceFile.endsWith('.json')) {
			await navigateExternalSource({ kind: 'json', resourcePath: sourceFile });
			highlightToolbarInfo = null;
			return;
		}

		await navigateToMarkdownCallout(sourceFile, encodedCfi, info.cfiRange, info.text, info.createdTime);
		highlightToolbarInfo = null;
	}

	function handleHighlightEditComment(info: HighlightClickInfo) {
		openCommentEditor(info);
	}

	async function saveHighlightComment() {
		if (!hasExcerptNotesCapability()) {
			return;
		}
		const info = commentEditorInfo;
		if (!info) {
			return;
		}
		const source = await resolveHighlightSource(info);
		if (!source?.sourceFile) {
			new Notice(t('epub.reader.highlightSourcePending'));
			void reloadHighlights();
			return;
		}
		commentEditorSaving = true;
		const updated = await backlinkService.updateHighlightComment(
			source.sourceFile,
			resolveHighlightMutationCfi(info, source),
			filePath,
			commentEditorDraft,
			source.sourceRef,
			source.excerptId,
			true
		);
		commentEditorSaving = false;
		if (!updated) {
			new Notice(t('epub.reader.commentSaveFailed'));
			return;
		}
		const optimisticHighlight: ReaderHighlight = {
			cfiRange: resolveHighlightMutationCfi(info, source),
			color: info.color,
			style: info.style,
			text: info.text,
			commentText: commentEditorDraft,
			hasCommentDivider: true,
			sourceFile: source.sourceFile,
			sourceRef: source.sourceRef,
			excerptId: source.excerptId,
			sourceLocators: info.sourceLocators,
			createdTime: info.createdTime,
			presentation: info.presentation,
		};
		readerService.addHighlight(optimisticHighlight);
		pendingLoadedHighlights = mergeReaderHighlightsByIdentity(
			pendingLoadedHighlights,
			[optimisticHighlight]
		);
		new Notice(t('epub.reader.commentSaved'));
		closeCommentEditor();
		reloadHighlightsAfterExcerptMutation(source.sourceFile);
	}

	async function navigateExternalSource(intent: NavigationIntent): Promise<boolean> {
		if (!ensureBookSourceLocationAccess(app, t('epub.reader.sourceLocationFeatureNotice'))) {
			return false;
		}
		const result = await getNavigationHub(app).navigate({
			...intent,
			policy: { reuseLeaf: true, focus: true, ...intent.policy },
		});
		if (!result.success) {
			if (intent.kind === 'card') {
				new Notice(t('epub.reader.cardLocateUnavailable'));
			} else if (intent.kind === 'json') {
				new Notice(t('epub.reader.relatedNoteMissing'));
			} else {
				new Notice(t('epub.reader.relatedNoteMissing'));
			}
			return false;
		}
		if (intent.kind === 'card') {
			new Notice(t('epub.reader.cardLocated'));
		} else if (intent.kind === 'json') {
			new Notice(t('epub.reader.openedSourceFileSearchHighlight'));
		}
		return true;
	}

	async function navigateToReferenceSource(source: ReferenceSourceInfo) {
		if (source.sourceRef?.startsWith('card:')) {
			await navigateExternalSource({ kind: 'card', resourcePath: source.sourceRef.slice(5) });
			return;
		}

		if (source.type === 'canvas') {
			await navigateExternalSource({
				kind: 'canvas',
				resourcePath: source.file,
				locate: { candidates: source.locateCandidates },
				context: { nodeId: source.nodeId, epubFilePath: filePath },
			});
			return;
		}

		if (source.file.endsWith('.json')) {
			await navigateExternalSource({ kind: 'json', resourcePath: source.file });
			return;
		}

		await navigateExternalSource({
			kind: 'markdown',
			resourcePath: source.file,
			locate: { candidates: source.locateCandidates },
			context: { epubFilePath: filePath },
		});
	}

	async function navigateToMarkdownCallout(sourceFile: string, encodedCfi: string, rawCfi: string, excerptText?: string, createdTime?: number) {
		const locateCandidates = buildEpubMarkdownLocateCandidates({
			epubFilePath: filePath,
			encodedCfi,
			rawCfi,
			excerptText,
			createdTime,
		});
		await navigateExternalSource({
			kind: 'markdown',
			resourcePath: sourceFile,
			locate: { candidates: locateCandidates },
			context: { epubFilePath: filePath },
		});
	}

	async function openCardBacklink(cardUuid: string) {
		try {
			await navigateExternalSource({ kind: 'card', resourcePath: cardUuid });
		} catch (error) {
			logger.error('[EpubReaderApp] Failed to open card backlink:', error);
			new Notice(t('epub.reader.cardLocateFailed'));
		}
	}

	async function handleHighlightCopyText(info: HighlightClickInfo) {
		const plainText = info.text.replace(/^>\s?/gm, '').trim();
		await copyTextToClipboard(plainText);
		highlightToolbarInfo = null;
	}

	async function reloadHighlights(options?: HighlightReloadOptions) {
		if (!book || componentDisposed) return;
		if (!hasExcerptNotesCapability()) {
			trackedHighlightSourceFiles = new Set<string>();
			pendingLoadedHighlights = [];
			highlightReloading = false;
			highlightToolbarInfo = null;
			closeCommentEditor();
			if (readerReady) {
				await readerService.applyHighlights([]);
			}
			annotationRevision += 1;
			epubActiveDocumentStore.setSharedState({ annotationRevision });
			return;
		}
		const incremental = options?.incremental === true;
		const invalidateCache = options?.invalidateCache === true;
		const reloadToken = ++highlightReloadToken;
		highlightReloading = true;
		const previousHighlights = pendingLoadedHighlights || [];
		try {
			if (invalidateCache) {
				annotationService.invalidateCollectedHighlightsCache(book.id, filePath);
				if (!incremental) {
					highlightViewSnapshotService.invalidate(book.id, filePath);
					referenceStatsService.clearCache(filePath);
				}
				await backlinkService.invalidateHighlightsCacheForEpub(filePath, getBoundCanvasPath());
			} else if (incremental) {
				annotationService.invalidateCollectedHighlightsCache(book.id, filePath);
			}
			const additionalSourcePaths = Array.from(trackedHighlightSourceFiles);
			const collectedHighlights = await annotationService.collectAllHighlights(
				book.id,
				filePath,
				backlinkService,
				additionalSourcePaths.length > 0
					? { additionalSourcePaths, diskIncremental: incremental }
					: undefined
			);
			if (componentDisposed || reloadToken !== highlightReloadToken) {
				return;
			}

			const allHighlights = collectedHighlights;

			const referenceStats = referenceStatsService.computeReferenceStatsFromHighlights(
				allHighlights,
				filePath,
				getBoundCanvasPath()
			);

			const highlightsWithStats = allHighlights.map((highlight) => {
				const normalizedCfi = EpubLinkService.normalizeCfi(highlight.cfiRange);
				const stats = referenceStats.get(normalizedCfi);

				return {
					...highlight,
					referenceCount: stats?.referenceCount || 1,
					referenceHeat: stats?.referenceHeat || 0,
				};
			});

			trackedHighlightSourceFiles = collectTrackedHighlightSourceFiles(highlightsWithStats);
			pendingLoadedHighlights = highlightsWithStats;
			getExcerptPipeline().syncCollectedHighlights(highlightsWithStats);

			if (readerReady) {
				const previousKeys = new Set(
					previousHighlights
						.map((highlight) => getReaderHighlightIdentityKey(highlight))
						.filter((key) => key.length > 0)
				);
				const nextKeys = new Set(
					highlightsWithStats
						.map((highlight) => getReaderHighlightIdentityKey(highlight))
						.filter((key) => key.length > 0)
				);
				const hasRemovedHighlights = [...previousKeys].some((key) => !nextKeys.has(key));
				const shouldReplaceAllHighlights =
					!incremental ||
					hasRemovedHighlights ||
					highlightsWithStats.length < previousHighlights.length ||
					!highlightsWithStats.every((highlight) => {
						const key = getReaderHighlightIdentityKey(highlight);
						return (
							!key ||
							previousHighlights.some(
								(previous) => getReaderHighlightIdentityKey(previous) === key
							)
						);
					});

				if (shouldReplaceAllHighlights) {
					await readerService.applyHighlights(highlightsWithStats);
				} else {
					syncReaderHighlightsFromCollection(highlightsWithStats, previousHighlights);
				}
			}

			if (!incremental) {
				const nextRevision = annotationRevision + 1;
				highlightViewSnapshotService.publishFromHighlights({
					bookId: book.id,
					filePath,
					showStrikethroughHighlights: excerptSettings.showStrikethroughInSidebar,
					revision: nextRevision,
					highlights: highlightsWithStats,
					readerService,
				});
				annotationRevision = nextRevision;
				epubActiveDocumentStore.setSharedState({ annotationRevision });
			} else {
				publishSidebarHighlights(highlightsWithStats);
			}

			if (book) {
				void bookmarkService.syncAnalytics(book, highlightsWithStats).catch((error) => {
					logger.warn('[EpubReaderApp] Failed to sync bookmark analytics:', error);
				});
			}
		} catch (_e) {
			logger.warn('[EpubReaderApp] Failed to reload highlights:', _e);
		} finally {
			if (reloadToken === highlightReloadToken) {
				highlightReloading = false;
			}
		}
	}

	async function migrateLegacyStoredLocations(options?: {
		requireReaderReady?: boolean;
		targetBook?: EpubBook | null;
	}) {
		const targetBook = options?.targetBook ?? book;
		const requireReaderReady = options?.requireReaderReady ?? true;
		if (!targetBook || (requireReaderReady && !readerReady)) {
			return;
		}
		if (migratedLocationBookIds.has(targetBook.id) || migratingLocationBookId === targetBook.id) {
			return;
		}

		migratingLocationBookId = targetBook.id;
		try {
			const summary = await locationMigrationService.migrateBookData(targetBook.id, filePath);
			migratedLocationBookIds.add(targetBook.id);
			migratingLocationBookId = null;

			if (
				summary.progressMigrated
				|| summary.resumePointsMigrated > 0
			) {
				if (readerReady) {
					annotationRevision += 1;
					epubActiveDocumentStore.setSharedState({ annotationRevision });
				}
			}
		} catch (error) {
			logger.warn('[EpubReaderApp] Failed to migrate legacy EPUB locations:', error);
		} finally {
			if (migratingLocationBookId === targetBook.id) {
				migratingLocationBookId = null;
			}
		}
	}

	function trackHighlightSourceChanges() {
		if (vaultEventRefs.length > 0) return;

		const shouldReloadForPath = (path: string): boolean => {
			const normalizedPath = normalizeTrackedVaultPath(path);
			if (!normalizedPath) return false;
			if (trackedHighlightSourceFiles.has(normalizedPath)) return true;
			const canvasPath = normalizeTrackedVaultPath(canvasService.getCanvasPath());
			if (canvasPath && normalizedPath === canvasPath) return true;
			return false;
		};

		const requestReload = (path: string, delayMs = 180) => {
			const normalizedPath = normalizeTrackedVaultPath(path);
			if (!normalizedPath || !book || componentDisposed) return;
			if (isEphemeralEditorHighlightSourcePath(app, normalizedPath)) {
				return;
			}
			if (shouldReloadForPath(normalizedPath)) {
				rememberHighlightSourcePath(normalizedPath);
				void syncHighlightsAfterSourcePathChange(normalizedPath);
				queueHighlightReload(delayMs, { incremental: true });
				return;
			}
			void (async () => {
				try {
					const mayAffectHighlights = await backlinkService.mayFileAffectHighlights(
						normalizedPath,
						filePath,
						canvasService.getCanvasPath()
					);
					if (!mayAffectHighlights || componentDisposed) {
						return;
					}
					rememberHighlightSourcePath(normalizedPath);
					void syncHighlightsAfterSourcePathChange(normalizedPath);
					queueHighlightReload(delayMs, { incremental: true });
				} catch (error) {
					logger.debug('[EpubReaderApp] Failed to inspect changed highlight source file:', {
						path: normalizedPath,
						error,
					});
				}
			})();
		};

		vaultEventRefs = [
			app.vault.on('create', (file: TAbstractFile) => {
				requestReload(file.path, 160);
			}),
			app.vault.on('modify', (file: TAbstractFile) => {
				requestReload(file.path, 180);
			}),
			app.vault.on('delete', (file: TAbstractFile) => {
				requestReload(file.path, 120);
			}),
			app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				if (shouldReloadForPath(oldPath) || shouldReloadForPath(file.path)) {
					rememberHighlightSourcePath(oldPath);
					rememberHighlightSourcePath(file.path);
					queueHighlightReload(120, { incremental: true });
					return;
				}
				requestReload(file.path, 160);
			}),
		];
	}

	onMount(() => {
		document.addEventListener('fullscreenchange', handleFullscreenChange);
		const cleanupExternalHighlightSyncReload = attachExternalHighlightSyncReload({
			canReload: () => !componentDisposed && !!book && hasExcerptNotesCapability(),
			onReload: (delayMs) => {
				queueHighlightReload(delayMs, { incremental: true });
			},
		});
		const cleanupCardHighlightSync = attachEpubCardHighlightSyncBridge({
			app,
			getEpubFilePath: () => filePath,
			getBookSourceId: () => book?.sourceId,
			isActive: () => !componentDisposed && !!book && hasExcerptNotesCapability(),
			backlinkService,
			onCardSaved: handleSavedCardHighlightSync,
		});
		const premiumGuard = PremiumFeatureGuard.getInstance();
		isPremiumLicenseActive = get(premiumGuard.isPremiumActive);
		premiumFeaturePreviewEnabled = get(premiumGuard.premiumFeaturesPreviewEnabled);
		const unsubscribePremiumActive = premiumGuard.isPremiumActive.subscribe((value) => {
			isPremiumLicenseActive = value;
			notifyPremiumUiStateChanged();
		});
		const unsubscribePremiumPreview = premiumGuard.premiumFeaturesPreviewEnabled.subscribe((value) => {
			premiumFeaturePreviewEnabled = value;
			if (!value) {
				closePremiumFeaturePreview();
			}
			notifyPremiumUiStateChanged();
		});
		const handlePremiumUiStateChanged = () => {
			notifyPremiumUiStateChanged();
		};
		window.addEventListener(EPUB_RUNTIME.events.premiumUiStateChanged, handlePremiumUiStateChanged);
		window.addEventListener(
			EPUB_RUNTIME.events.premiumFeaturePreviewRequest,
			handlePremiumFeaturePreviewRequest
		);
		const handleBookDisplayTitleChanged = (event: Event) => {
			const detail = (event as CustomEvent<{ filePath?: string; title?: string }>).detail;
			const changedPath = normalizePath(String(detail?.filePath || "").trim());
			const activePath = normalizePath(String(filePath || "").trim());
			const nextTitle = String(detail?.title || "").trim();
			if (!changedPath || changedPath !== activePath || !nextTitle || !book) {
				return;
			}
			book = {
				...book,
				metadata: {
					...book.metadata,
					title: nextTitle,
				},
			};
			onTitleChange?.(nextTitle);
			if (isActiveEpubReaderInstance()) {
				epubActiveDocumentStore.setSharedState({ book });
			}
		};
		window.addEventListener(
			EPUB_RUNTIME.events.bookDisplayTitleChanged,
			handleBookDisplayTitleChanged
		);
		const canvasDirectionRef = app.workspace.on(
			WEAVE_EPUB_CANVAS_LAYOUT_DIRECTION_EVENT,
			(payload: WeaveEpubCanvasLayoutDirectionPayload) => {
				const activePath = normalizePath(String(canvasService.getCanvasPath() || '').trim());
				const eventPath = normalizePath(String(payload?.canvasPath || '').trim());
				if (!activePath || activePath !== eventPath || !payload?.direction) {
					return;
				}
				canvasService.applyLayoutDirection(payload.direction);
				onCanvasLayoutDirectionChange?.(payload.direction);
			}
		);
		componentDisposed = false;
		setupScrolledNavMetricsObserver();
		window.addEventListener('resize', scheduleScrolledNavLayoutSync);
		const loadReaderPreferences = async (): Promise<void> => {
			try {
				const [savedExcerptSettings, savedReaderSettings, savedTocChapterMarkSettings] = await Promise.all([
					storageService.loadExcerptSettings(),
					storageService.loadReaderSettings(),
					storageService.loadTocChapterMarkSettings(),
				]);
				excerptSettings = savedExcerptSettings;
				excerptSettingsLoaded = true;
				tocChapterMarkSettings = savedTocChapterMarkSettings;
				epubActiveDocumentStore.setSharedState({
					excerptSettings: savedExcerptSettings,
					tocChapterMarkSettings: savedTocChapterMarkSettings,
				});
				const normalizedSettings = normalizeReaderSettings(savedReaderSettings);
				settings = normalizedSettings;
				readerService.setFootnoteClickAction?.(normalizedSettings.footnoteClickAction);
				onReaderSettingsLoaded?.(normalizedSettings);
				if (
					normalizedSettings.widthMode !== savedReaderSettings.widthMode
					|| normalizedSettings.layoutMode !== savedReaderSettings.layoutMode
					|| normalizedSettings.flowMode !== savedReaderSettings.flowMode
					|| normalizedSettings.footnoteClickAction !== savedReaderSettings.footnoteClickAction
					|| normalizedSettings.paragraphModeEnabled !== savedReaderSettings.paragraphModeEnabled
				) {
					await storageService.saveReaderSettings(normalizedSettings);
				}
			} catch (error) {
				logger.warn('[EpubReaderApp] Failed to load reader settings:', error);
			}
		};
		excerptSettingsReady = loadReaderPreferences();
		const readerPreferencesReady = excerptSettingsReady;

		void (async () => {
			if (!filePath) {
				await readerPreferencesReady;
				book = null;
				loading = false;
				errorMsg = '';
				readerReady = false;
				onReadingReferencePointChange?.(null);
				onChapterTitleChange?.('');
				scheduleScrolledNavLayoutSync();
				return;
			}

			// Apply persisted flow/layout (and related reader prefs) before first render.
			await readerPreferencesReady;
			await loadBook();
		})();

		// Check global pending IR navigation (set by sidebar before this component mounts)
		const pending =
			(window as any)[EPUB_PENDING_NAVIGATION_KEY] ??
			(LEGACY_EPUB_PENDING_NAVIGATION_KEY
				? (window as any)[LEGACY_EPUB_PENDING_NAVIGATION_KEY]
				: null);
		if (pending && pending.filePath === filePath) {
			const nav = epubNavigation.buildLocateFromEventDetail(pending);
			if (nav) {
				requestSourceBookLocate(nav);
			}
		}

		flushPendingLocateFromProps();

		setupHighlightClickHandler();
		setupReferenceBadgeClickHandler();
		setupFootnotePreviewHandler();
		trackHighlightSourceChanges();
		setupScrolledChapterEndHandler();
		readerService.setBookEndAdvanceHandler?.(handleBookEndAdvanceAttempt);
		const activeLeafChangeRef = app.workspace.on(
			'active-leaf-change',
			handleWorkspaceActiveLeafChange
		);
		syncAsActiveEpubDocumentIfActive();

		if (rootEl) {
			rootEl.addEventListener('pointerdown', syncAsActiveEpubDocument);
			rootEl.addEventListener('focusin', syncAsActiveEpubDocument);
		}

		window.addEventListener(EXCERPT_SETTINGS_CHANGED_EVENT, handleGlobalExcerptSettingsChanged);
		window.addEventListener(EPUB_NAVIGATE_EVENT, handleEpubNavigateEvent);
		if (LEGACY_EPUB_NAVIGATE_EVENT) {
			window.addEventListener(LEGACY_EPUB_NAVIGATE_EVENT, handleEpubNavigateEvent);
		}

		onActionsReady?.({
			setAutoInsert: (enabled: boolean) => { autoInsert = enabled; },
			setScreenshotMode: (active: boolean) => { screenshotMode = active; },
			setLayoutMode: handleLayoutModeChange,
			setFlowMode: handleFlowModeChange,
			toggleParagraphMode,
			openTypographyPanel,
			getReaderSettings: () => settings,
			updateReaderSettings,
			setScreenshotSaveMode: (saveAsImage: boolean) => { screenshotSaveAsImage = saveAsImage; },
			navigateToCfi,
			toggleTutorial,
			addBookmark,
			canUseReadingProgress: hasReadingProgressCapability,
			canUseReadingReference: hasReadingReferenceCapability,
			canUseParagraphMode: hasParagraphModeCapability,
			canUseExcerptNotes: hasExcerptNotesCapability,
			canUseStyledExcerpts: hasStyledExcerptCapability,
			canUseCanvasExcerpts: hasCanvasExcerptCapability,
			canUseFootnotePreview: hasFootnotePreviewCapability,
			isPremiumFeaturePreviewEnabled,
			showPremiumFeaturePreview: openPremiumFeaturePreview,
			saveReadingReferencePoint: hasReadingReferenceCapability() ? saveReadingReferencePoint : undefined,
			openReadingPositionMenu: openReadingReferencePointMenu,
			getReadingPositionAutoSaveEnabled: hasReadingProgressCapability()
				? () => getContinuousReadingPositionAutoSaveConfig().enabled
				: undefined,
			setReadingPositionAutoSaveEnabled: hasReadingProgressCapability()
				? setContinuousReadingPositionAutoSaveEnabled
				: undefined,
			bindCanvasPath: (canvasPath: string) => { bindCanvas(canvasPath); },
			unbindCanvas: () => { unbindCanvas(); },
			getCanvasService: () => canvasService,
			exportCurrentChapterToMarkdown: hasChapterExportCapability() ? exportCurrentChapterToMarkdown : undefined,
			exportCurrentChapterMarkedToMarkdown: hasChapterExportCapability()
				? exportCurrentChapterMarkedToMarkdown
				: undefined,
			exportCurrentChapterHighlightsToMarkdown: hasExcerptNotesCapability()
				? exportCurrentChapterHighlightsToMarkdown
				: undefined,
			exportBookHighlightsToMarkdown: hasExcerptNotesCapability() ? exportBookHighlightsToMarkdown : undefined,
			getExcerptSettings: () => excerptSettings,
			updateExcerptSettings: applyAndPersistExcerptSettings,
			prevPage: handlePrevPage,
			nextPage: handleNextPage,
		});
		return () => {
			app.workspace.offref(activeLeafChangeRef);
			app.workspace.offref(canvasDirectionRef);
			document.removeEventListener('fullscreenchange', handleFullscreenChange);
			cleanupExternalHighlightSyncReload();
			cleanupCardHighlightSync();
			setParagraphModeImmersiveClass(false);
			unsubscribePremiumActive();
			unsubscribePremiumPreview();
			window.removeEventListener(EPUB_RUNTIME.events.premiumUiStateChanged, handlePremiumUiStateChanged);
			window.removeEventListener(
				EPUB_RUNTIME.events.premiumFeaturePreviewRequest,
				handlePremiumFeaturePreviewRequest
			);
			window.removeEventListener(
				EPUB_RUNTIME.events.bookDisplayTitleChanged,
				handleBookDisplayTitleChanged
			);
			componentDisposed = true;
			getBookSessionManager(app).releaseIfNoOpenLeaves(app, filePath);
			clearParagraphModeSelection();
			window.removeEventListener('resize', scheduleScrolledNavLayoutSync);
			if (scrolledNavSyncFrame) {
				cancelAnimationFrame(scrolledNavSyncFrame);
				scrolledNavSyncFrame = 0;
			}
			if (scrolledNavResizeObserver) {
				scrolledNavResizeObserver.disconnect();
				scrolledNavResizeObserver = null;
			}
			clearScrolledNavMetrics();
			activeBookLoadToken += 1;
			if (deferredHighlightReloadTimer) {
				clearTimeout(deferredHighlightReloadTimer);
				deferredHighlightReloadTimer = null;
			}
			flushReaderStoreSync();
			if (rootEl) {
				rootEl.removeEventListener('pointerdown', syncAsActiveEpubDocument);
				rootEl.removeEventListener('focusin', syncAsActiveEpubDocument);
			}
			for (const ref of vaultEventRefs) {
				app.vault.offref(ref);
			}
			vaultEventRefs = [];
			referenceBadgeClickCleanup?.();
			referenceBadgeClickCleanup = null;
			window.removeEventListener(EXCERPT_SETTINGS_CHANGED_EVENT, handleGlobalExcerptSettingsChanged);
			window.removeEventListener(EPUB_NAVIGATE_EVENT, handleEpubNavigateEvent);
			if (LEGACY_EPUB_NAVIGATE_EVENT) {
				window.removeEventListener(LEGACY_EPUB_NAVIGATE_EVENT, handleEpubNavigateEvent);
			}
			sourceLocateOverlay.clear();
			scrolledChapterEndCleanup?.();
			scrolledChapterEndCleanup = null;
			readerService.setBookEndAdvanceHandler?.(null);
			void persistCurrentReadingProgress(book).then((saved) => {
				if (saved) {
					bookshelfProgressChangedNotifier.flush();
				}
			}).finally(() => {
				bookshelfProgressChangedNotifier.dispose();
			});
			readerService.destroy();
			epubActiveDocumentStore.clearActiveDocument(filePath);
		};
	});

	onMount(() => {
		const unsubscribeTheme = UnifiedThemeManager.getInstance().addListener((result) => {
			hostTheme = result.isDark ? 'dark' : 'light';
		});
		window.addEventListener('mousedown', handleExportNotesPointerDownOutside);
		window.addEventListener('mousedown', handleTypographyPointerDownOutside);
		return () => {
			unsubscribeTheme();
			window.removeEventListener('mousedown', handleExportNotesPointerDownOutside);
			window.removeEventListener('mousedown', handleTypographyPointerDownOutside);
		};
	});

	$effect(() => {
		const _flowMode = settings.flowMode;
		const _showScrolledSideNav = settings.showScrolledSideNav;
		const _widthMode = settings.widthMode;
		const _layoutMode = settings.layoutMode;
		const _viewport = viewportEl;
		const _readingReferencePoint = readingReferencePoint?.cfi;
		void _flowMode;
		void _showScrolledSideNav;
		void _widthMode;
		void _layoutMode;
		void _viewport;
		void _readingReferencePoint;
		untrack(() => {
			setupScrolledNavMetricsObserver();
			scheduleScrolledNavLayoutSync();
		});
	});

	$effect(() => {
		const paragraphModeEnabled = settings.paragraphModeEnabled;
		const ready = readerReady;
		const chapterIndex = currentChapterIndex;
		const currentPage = paginationInfo.currentPage;
		const version = readerVersion;
		const revision = annotationRevision;
		void chapterIndex;
		void currentPage;
		void version;
		void revision;
		if (!paragraphModeEnabled || !ready) {
			untrack(() => {
				paragraphModeLocation = null;
				paragraphModeAnchorParagraphId = '';
				paragraphModeSelection = null;
			});
			return;
		}

		if (untrack(() => paragraphModeSuppressReactiveRefresh) > 0) {
			return;
		}
		if (Date.now() - untrack(() => paragraphModeLastNavigationAt) < PARAGRAPH_MODE_REACTIVE_REFRESH_COOLDOWN_MS) {
			return;
		}

		const preferredAnchorParagraphId = untrack(() => paragraphModeAnchorParagraphId || undefined);
		untrack(() => {
			void refreshParagraphModeLocation(undefined, preferredAnchorParagraphId);
		});
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="epub-reader-root"
	data-theme={settings.theme}
	data-host-theme={hostTheme}
	data-flow={settings.flowMode}
	data-layout={settings.layoutMode}
	data-width={settings.widthMode}
	data-paragraph-mode={settings.paragraphModeEnabled ? 'active' : 'inactive'}
	data-scrolled-side-nav={isDesktopScrolledSideNavVisible() ? 'visible' : 'hidden'}
	style={getReaderRootStyle()}
	bind:this={rootEl}
>
	{#if loading}
		<div class="epub-loading">
			<div class="epub-loading__panel">
				<EpubLoadingState
					message={bookLoadSlowWarning
						? buildBookLoadSlowWarningMessage(filePath)
						: t('epub.reader.loading')}
				/>
				{#if bookLoadSlowWarning}
					<button
						type="button"
						class="epub-loading__cancel-btn"
						onclick={() => {
							void cancelSlowBookLoad();
						}}
					>
						{t('epub.reader.cancelLoading')}
					</button>
				{/if}
			</div>
		</div>
	{:else if errorMsg}
		<div class="epub-error">
			<span>{errorMsg}</span>
		</div>
	{:else if !filePath}
		<BookshelfView
			{app}
			{onSwitchBook}
			onClose={() => {}}
			onBack={() => {
				void onBackFromBookshelf?.();
			}}
			onSettingsClick={showSettingsMenu}
		/>
	{:else}
		<div
			class="epub-reader-viewport"
			bind:this={viewportEl}
		>
			{#if hasExcerptNotesCapability() && readerReady && highlightReloading}
				<div class="epub-reader-highlight-loading-overlay">
					<EpubLoadingState
						variant="compact"
						message={t('epub.reader.highlightLoadingHint')}
					/>
				</div>
			{/if}
			<div class="epub-content-wrapper">
				<EpubReaderView
					{filePath}
					{book}
					{readerService}
					{storageService}
					{annotationService}
					{backlinkService}
					{settings}
					{excerptSettings}
					canUseReadingProgress={hasReadingProgressCapability()}
					canUseExcerptNotes={hasExcerptNotesCapability()}
					getReadingPositionAutoSaveConfig={getContinuousReadingPositionAutoSaveConfig}
					isParagraphModeActive={() => settings.paragraphModeEnabled}
					isParagraphModeProgressDetached={() => paragraphModeDetachedSession}
					shouldSkipReadingProgressPersistOnRelocate={() =>
						paragraphModeDetachedSession
						|| (
							settings.paragraphModeEnabled
							&& (
								paragraphModeBusy
								|| paragraphModeSuppressReactiveRefresh > 0
								|| readerService.isParagraphAnchorSyncInFlight?.() === true
							)
						)
					}
					onAutoReadingPositionSaved={handleAutoReadingPositionSaved}
					hasPendingNavigation={hasPendingBookLocate}
					onProgressChange={(p) => {
						syncReadingProgressDisplay(p);
						scheduleReaderStoreSync({
							progress: hasReadingProgressCapability() ? readingProgress : 0,
							chapterTitle: readerService.getCurrentChapterTitle(),
							chapterHref: readerService.getCurrentChapterHref?.() || '',
							paginationInfo,
						});
						syncScrolledChapterNavVisibility();
						scheduleScrolledNavLayoutSync();
					}}
					onPaginationChange={(info) => {
						paginationInfo = info;
						currentChapterIndex = readerService.getCurrentChapterIndex();
						scheduleReaderStoreSync({
							paginationInfo: info,
							chapterTitle: readerService.getCurrentChapterTitle(),
							chapterHref: readerService.getCurrentChapterHref?.() || '',
						});
						syncScrolledChapterNavVisibility();
						scheduleScrolledNavLayoutSync();
					}}
					onChapterChange={(title) => {
						currentChapterIndex = readerService.getCurrentChapterIndex();
						if (isActiveEpubReaderInstance()) {
							epubActiveDocumentStore.setSharedState({
								chapterTitle: String(title || '').trim(),
								chapterHref: readerService.getCurrentChapterHref?.() || '',
							});
						}
						syncScrolledChapterNavVisibility();
						onChapterTitleChange?.(String(title || '').trim());
					}}
					onReaderReady={() => {
						readerVersion++;
						readerReady = true;
						if (pendingLoadedHighlights) {
							void readerService.applyHighlights(pendingLoadedHighlights).then(() => {
								if (pendingLoadedHighlights && pendingLoadedHighlights.length > 0) {
									publishSidebarHighlights(pendingLoadedHighlights);
								}
							});
						} else if (book) {
							void reloadHighlights();
						}
						epubNavigation.flushPendingBookLocate();
						void migrateLegacyStoredLocations();
						syncScrolledChapterNavVisibility();
						scheduleScrolledNavLayoutSync();
					}}
					onRenderError={(message) => {
						logger.error('[EpubReaderApp] Reader view render error:', message);
						setError(message);
					}}
				/>
			</div>

		{#if !settings.paragraphModeEnabled && showBottomNav() && useVerticalNav()}
				<BottomNav
					onPrev={handlePrevPage}
					onNext={handleNextPage}
					onJumpToPage={handleJumpToPage}
					currentPage={paginationInfo.currentPage}
					totalPages={paginationInfo.totalPages}
					vertical={true}
					statusText={getBottomNavStatusText()}
					statusDetail={getBottomNavStatusDetail()}
				/>
			{/if}

			{#if !settings.paragraphModeEnabled && useVerticalNav() && showScrolledChapterNavActions}
				<div class="epub-scrolled-chapter-action-slot">
					<div class="epub-scrolled-chapter-action-start">
						{#if hasPrevChapter()}
							<button
								type="button"
								class="clickable-icon epub-nav-btn"
								title={t('epub.reader.prevChapter')}
								aria-label={t('epub.reader.prevChapter')}
								onclick={() => void handlePrevChapter()}
							>
								<span class="epub-nav-btn-icon" use:icon={'arrow-left'}></span>
								<span class="epub-nav-btn-label">{t('epub.reader.prevChapter')}</span>
							</button>
						{/if}
					</div>
					<div class="epub-scrolled-chapter-action-end">
						{#if hasNextChapter()}
							<button
								type="button"
								class="clickable-icon epub-nav-btn"
								title={t('epub.reader.nextChapter')}
								aria-label={t('epub.reader.nextChapter')}
								onclick={() => void handleNextChapter()}
							>
								<span class="epub-nav-btn-icon" use:icon={'arrow-right'}></span>
								<span class="epub-nav-btn-label">{t('epub.reader.nextChapter')}</span>
							</button>
						{/if}
					</div>
				</div>
			{/if}

			<ParagraphReadingOverlay
				active={settings.paragraphModeEnabled}
				paragraph={paragraphModeLocation?.paragraphs?.[paragraphModeLocation.currentIndex] || null}
				fontScale={settings.paragraphModeFontScale}
				surfaceStyle={settings.paragraphModeSurfaceStyle}
				transitionStyle={settings.paragraphModeTransitionStyle}
				immersive={paragraphModeImmersive}
				randomReadingActive={paragraphModeDetachedSession}
				currentIndex={paragraphModeLocation?.currentIndex || 0}
				totalCount={paragraphModeLocation?.paragraphs?.length || 0}
				onFontScaleChange={(fontScale) => void updateReaderSettings({ paragraphModeFontScale: fontScale })}
				onSurfaceStyleChange={(surfaceStyle) => void updateReaderSettings({ paragraphModeSurfaceStyle: surfaceStyle })}
				onTransitionStyleChange={setParagraphModeTransitionStyle}
				onRandomParagraph={() => navigateToRandomParagraph()}
				onPrev={() => navigateParagraphRelative(-1)}
				onNext={() => navigateParagraphRelative(1)}
				onFootnoteActivate={handleParagraphFootnoteActivate}
				onHighlightActivate={handleParagraphHighlightActivate}
				onFootnoteDismiss={dismissParagraphFootnotePreview}
				onToggleImmersive={toggleParagraphModeImmersive}
				onClose={() => void closeParagraphMode()}
				onSelectionChange={handleParagraphOverlaySelectionChange}
				onNavMetricsChange={({ bottomDockOffset }) => {
					paragraphModeNavBottomOffset = bottomDockOffset;
				}}
			/>

			<EpubHighlightToolbar
				readerService={readerService}
				mobileDockBottomOffset={settings.paragraphModeEnabled ? paragraphModeNavBottomOffset : 0}
				info={hasExcerptNotesCapability() ? highlightToolbarInfo : null}
				canUseStyledExcerpts={hasStyledExcerptCapability()}
				canUseSourceLocation={hasSourceLocationCapability()}
				showPremiumFeaturePreviewEnabled={isPremiumFeaturePreviewEnabled()}
				onRequestPremiumFeaturePreview={openPremiumFeaturePreview}
				onDelete={handleHighlightDelete}
				onTemporarilyReveal={handleTemporarilyRevealConcealed}
				onChangeColor={handleHighlightChangeColor}
				onChangeStyle={handleHighlightChangeStyle}
				onBacklink={handleHighlightBacklink}
				onExtractToCard={handleHighlightExtractToCard}
				onCopyText={handleHighlightCopyText}
				onEditComment={handleHighlightEditComment}
				onDismiss={() => highlightToolbarInfo = null}
			/>

			<EpubCommentEditorPopover
				open={hasExcerptNotesCapability() && commentEditorInfo !== null}
				info={hasExcerptNotesCapability() ? commentEditorInfo : null}
				{readerService}
				boundsEl={viewportEl}
				readingLockEl={readingViewportLockEl}
				draftText={commentEditorDraft}
				saving={commentEditorSaving}
				onDraftTextChange={(value) => commentEditorDraft = value}
				onSave={saveHighlightComment}
				onClose={closeCommentEditor}
			/>

			<EpubFootnotePreviewPopover
				info={footnotePreviewInfo}
				boundsEl={viewportEl}
			/>

			<ReferenceDetailModal
				open={referencePopoverInfo !== null && referencePopoverStats !== null}
				info={referencePopoverInfo}
				stats={referencePopoverStats}
				{readerService}
				boundsEl={viewportEl}
				onNavigate={async (source: ReferenceSourceInfo) => {
					await navigateToReferenceSource(source);
					closeReferencePopover();
				}}
				onClose={closeReferencePopover}
			/>

			<SelectionToolbar
				{app}
				{readerService}
				{book}
				{readerVersion}
				boundsEl={viewportEl}
				mobileDockBottomOffset={settings.paragraphModeEnabled ? paragraphModeNavBottomOffset : 0}
				externalSelection={settings.paragraphModeEnabled ? paragraphModeSelection : null}
				{autoInsert}
				{canvasMode}
				canUseExcerptNotes={hasExcerptNotesCapability()}
				canUseStyledExcerpts={hasStyledExcerptCapability()}
				showPremiumFeaturePreviewEnabled={isPremiumFeaturePreviewEnabled()}
				onRequestPremiumFeaturePreview={openPremiumFeaturePreview}
				onInsertToNote={hasExcerptNotesCapability() ? handleInsertToNote : undefined}
				onCopySelectionLink={
					hasExcerptNotesCapability() || isPremiumFeaturePreviewEnabled()
						? handleCopySelectionLink
						: undefined
				}
				onExtractToCard={handleExtractToCard}
				onCreateReadingPoint={hasCreateReadingPointCapability() ? handleCreateReadingPoint : undefined}
				onAutoInsert={hasExcerptNotesCapability() ? handleAutoInsertSelection : undefined}
				onOpenAIMenu={showSelectedTextAIMenu}
				translationSettings={resolveEpubHost(app)?.settings?.aiAssistant}
			/>

			<EpubPremiumFeaturePopover
				open={premiumFeaturePreviewFeatureId !== null}
				featureId={premiumFeaturePreviewFeatureId}
				onClose={closePremiumFeaturePreview}
				onOpenSettings={() => resolveEpubHost(app)?.openEpubPremiumSettings?.()}
			/>

			<EpubTutorial
				visible={tutorialVisible}
				initialTab={tutorialInitialTab}
				showDismissOption={!readerTutorialDismissed}
				onClose={closeTutorial}
				onDismissPermanently={dismissTutorialPermanently}
			/>

			<ScreenshotOverlay
				active={screenshotMode}
				sourceEl={viewportEl}
				{screenshotService}
				getVisibleFrames={getVisibleReaderFrames}
				onCapture={handleScreenshotCapture}
				onCancel={() => screenshotMode = false}
			/>

			{#if typographyPopoverOpen}
				<div class="epub-settings-float epub-glass-panel">
					<div class="epub-settings-row epub-settings-row--stack">
						<div class="epub-settings-row__heading">
							<span class="label">{t('epub.reader.typography.lineHeight')}</span>
							<span class="epub-settings-value">{settings.lineHeight.toFixed(2)}</span>
						</div>
						<input
							class="epub-settings-range"
							type="range"
							min="1.2"
							max="2.4"
							step="0.01"
							value={settings.lineHeight}
							aria-label={t('epub.reader.typography.lineHeightAria')}
							oninput={(event) => previewReaderLineHeight((event.currentTarget as HTMLInputElement).value)}
							onchange={persistCurrentReaderSettings}
						/>
					</div>
					<div class="epub-settings-row epub-settings-row--stack">
						<div class="epub-settings-row__heading">
							<span class="label">{t('epub.reader.typography.letterSpacing')}</span>
							<span class="epub-settings-value">{formatLetterSpacingValue(settings.letterSpacing)}</span>
						</div>
						<input
							class="epub-settings-range"
							type="range"
							min="-0.02"
							max="0.24"
							step="0.01"
							value={settings.letterSpacing}
							aria-label={t('epub.reader.typography.letterSpacingAria')}
							oninput={(event) => previewReaderLetterSpacing((event.currentTarget as HTMLInputElement).value)}
							onchange={persistCurrentReaderSettings}
						/>
					</div>
					<div class="epub-settings-row epub-settings-row--stack">
						<div class="epub-settings-row__heading">
							<span class="label">{t('epub.reader.typography.pageMargin')}</span>
							<span class="epub-settings-value">{Math.round(settings.pageMargin)}</span>
						</div>
						<input
							class="epub-settings-range"
							type="range"
							min="8"
							max="96"
							step="1"
							value={settings.pageMargin}
							aria-label={t('epub.reader.typography.pageMarginAria')}
							oninput={(event) => previewReaderPageMargin((event.currentTarget as HTMLInputElement).value)}
							onchange={persistCurrentReaderSettings}
						/>
					</div>
					<div class="epub-settings-row">
						<span class="label">{t('epub.reader.typography.widthMode')}</span>
						<div class="epub-settings-mode-group">
							<button
								type="button"
							class="clickable-icon epub-settings-mode-btn"
							class:active={settings.widthMode === 'standard'}
							disabled={settings.layoutMode === 'double'}
							onclick={() => setReaderWidthMode('standard')}
						>{t('epub.reader.typography.widthStandard')}</button>
						<button
							type="button"
							class="clickable-icon epub-settings-mode-btn"
							class:active={settings.widthMode === 'full'}
							disabled={settings.layoutMode === 'double'}
							onclick={() => setReaderWidthMode('full')}
						>{t('epub.reader.typography.widthWide')}</button>
						<button
							type="button"
							class="clickable-icon epub-settings-mode-btn"
							class:active={settings.widthMode === 'fit'}
							onclick={() => setReaderWidthMode('fit')}
						>{t('epub.reader.typography.widthFull')}</button>
						<button
							type="button"
							class="clickable-icon epub-settings-mode-btn"
							class:active={settings.widthMode === 'edge'}
							disabled={settings.layoutMode === 'double'}
							onclick={() => setReaderWidthMode('edge')}
						>{t('epub.reader.typography.widthEdge')}</button>
						</div>
					</div>
					<div class="epub-settings-row">
						<span class="label">{t('epub.reader.typography.scrolledSideNav')}</span>
						<label class="epub-export-notes-popover__toggle-switch">
							<input
								type="checkbox"
								checked={settings.showScrolledSideNav}
								onchange={(event) => handleScrolledSideNavToggle((event.currentTarget as HTMLInputElement).checked)}
							/>
							<span class="epub-export-notes-popover__toggle-slider"></span>
						</label>
					</div>
					<div class="epub-settings-row">
						<span class="label">{t('epub.reader.typography.footnoteAction')}</span>
						<div class="epub-settings-mode-group">
							{#if hasFootnotePreviewCapability()}
								<button
									type="button"
									class="clickable-icon epub-settings-mode-btn"
									class:active={settings.footnoteClickAction === 'preview'}
									onclick={() => setFootnoteClickAction('preview')}
								>{t('epub.reader.typography.footnotePreview')}</button>
							{/if}
							<button
								type="button"
								class="clickable-icon epub-settings-mode-btn"
								class:active={settings.footnoteClickAction === 'navigate'}
								onclick={() => setFootnoteClickAction('navigate')}
							>{t('epub.reader.typography.footnoteNavigate')}</button>
						</div>
					</div>
					<div class="epub-settings-actions">
						<button type="button" class="epub-settings-reset" onclick={resetReaderTypographySettings}>{t('epub.reader.typography.reset')}</button>
					</div>
				</div>
			{/if}

			<BookNotesExportPopover
				{app}
				open={exportNotesPopoverOpen}
				excerptSettingsReady={excerptSettingsLoaded}
				bind:exportNotesPopoverEl
				{excerptSettings}
				exportNotesSubmitting={exportNotesSubmitting}
				canSubmit={canSubmitBookNotesExport()}
				{t}
				{isMarkdownVaultFile}
				onUpdateSetting={updateBookNotesExportSetting}
				onUpdateTargetMode={updateBookNotesExportTargetMode}
				onClose={closeExportNotesPopover}
				onSubmit={submitBookNotesExport}
			/>

		</div>

		{#if !settings.paragraphModeEnabled && showBottomNav() && !useVerticalNav()}
			<div class="epub-bottom-nav-slot">
				<BottomNav
					onPrev={handlePrevPage}
					onNext={handleNextPage}
					onJumpToPage={handleJumpToPage}
					currentPage={paginationInfo.currentPage}
					totalPages={paginationInfo.totalPages}
					vertical={false}
					statusText={getBottomNavStatusText()}
					statusDetail={getBottomNavStatusDetail()}
				/>
			</div>
		{/if}
	{/if}
</div>
