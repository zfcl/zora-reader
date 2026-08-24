<script lang="ts">
 	import { onMount } from 'svelte';
	import { Platform } from 'obsidian';
	import {
		DEFAULT_CONTINUOUS_READING_POSITION_AUTO_SAVE_ENABLED,
		DEFAULT_CONTINUOUS_READING_POSITION_AUTO_SAVE_PAGES,
		normalizeContinuousReadingPositionAutoSaveEnabled,
		normalizeContinuousReadingPositionAutoSavePages,
	} from '../../config/reading-position-auto-save';
	import {
		advanceReadingPositionAutoSaveTracker,
		createReadingPositionAutoSaveTrackerState,
	} from '../../services/epub/reading-position-auto-save-tracker';
	import { choosePreferredRestorePosition } from '../../services/epub/restore-position';
	import { reportEpubError } from '../../services/epub/epub-error';
	import type { EpubBook, EpubExcerptSettings, EpubFlowMode, EpubLayoutMode, EpubReaderEngine, EpubReaderSettings, EpubStorageService, PaginationInfo, ReaderHighlight, ReadingPosition } from '../../services/epub';
	import { flushEpubPendingProgress } from '../../services/epub';
	import type { EpubAnnotationService } from '../../services/epub';
	import { logger } from '../../utils/logger';
	import { logMobileEvent, logMobileError, logMobileSyncDebug } from '../../utils/zora-mobile-logger';
	import { getZoraSyncService } from '../../services/sync/zora-sync-access';

	interface Props {
		filePath: string;
		book: EpubBook | null;
		readerService: EpubReaderEngine;
		storageService: EpubStorageService;
		annotationService: EpubAnnotationService;
		backlinkService: EpubBacklinkHighlightService;
		settings: EpubReaderSettings;
		excerptSettings: EpubExcerptSettings;
		canUseReadingProgress?: boolean;
		canUseExcerptNotes?: boolean;
		getReadingPositionAutoSaveConfig?: () => { enabled: boolean; pages: number };
		isParagraphModeActive?: () => boolean;
		isParagraphModeProgressDetached?: () => boolean;
		shouldSkipReadingProgressPersistOnRelocate?: () => boolean;
		onAutoReadingPositionSaved?: (position: ReadingPosition) => void | Promise<void>;
		hasPendingNavigation?: boolean;
		onProgressChange?: (percent: number) => void;
		onPaginationChange?: (info: PaginationInfo) => void;
		onChapterChange?: (title: string) => void;
		onReaderReady?: () => void;
		onRenderError?: (message: string) => void;
	}

	let {
		filePath,
		book,
		readerService,
		storageService,
		annotationService,
		backlinkService,
		settings,
		excerptSettings,
		canUseReadingProgress = true,
		canUseExcerptNotes = true,
		getReadingPositionAutoSaveConfig,
		isParagraphModeActive,
		isParagraphModeProgressDetached,
		shouldSkipReadingProgressPersistOnRelocate,
		onAutoReadingPositionSaved,
		hasPendingNavigation = false,
		onProgressChange: onProgressChangeProp,
		onPaginationChange: onPaginationChangeProp,
		onChapterChange,
		onReaderReady: onReaderReadyProp,
		onRenderError: onRenderErrorProp,
	}: Props = $props();

	let viewerContainer: HTMLDivElement;
	let rendered = false;
	let resizeObserver: ResizeObserver | null = null;
	let currentLayoutMode: EpubLayoutMode = 'paginated';
	let currentFlowMode: EpubFlowMode = 'paginated';
	let currentWidthMode: EpubReaderSettings['widthMode'] = 'full';
	let retryTimer: ReturnType<typeof window.setTimeout> | null = null;
	let highlightReapplyTimer: ReturnType<typeof window.setTimeout> | null = null;
	let mobileStabilizationTimer: ReturnType<typeof window.setTimeout> | null = null;
	let highlightsReady = false;
	let detachRelocatedHandler: (() => void) | null = null;
	let skipNextAppearanceSync = false;
	let renderSessionToken = 0;
	let mobileStabilizationToken = 0;
	let viewDisposed = false;
	let readingPositionAutoSaveTrackerState = createReadingPositionAutoSaveTrackerState('', 0);
	let readingPositionAutoSaveEnabled = DEFAULT_CONTINUOUS_READING_POSITION_AUTO_SAVE_ENABLED;
	let readingPositionAutoSavePages = DEFAULT_CONTINUOUS_READING_POSITION_AUTO_SAVE_PAGES;

	function notifyProgressChange(percent: number): void {
		if (typeof onProgressChangeProp === 'function') {
			onProgressChangeProp(percent);
		}
	}

	function notifyPaginationChange(info: PaginationInfo): void {
		if (typeof onPaginationChangeProp === 'function') {
			onPaginationChangeProp(info);
		}
	}

	function notifyChapterChange(title: string): void {
		if (typeof onChapterChange === 'function') {
			onChapterChange(title);
		}
	}

	function notifyReaderReady(): void {
		if (typeof onReaderReadyProp === 'function') {
			onReaderReadyProp();
		}
	}

	function notifyRenderError(message: string): void {
		if (typeof onRenderErrorProp === 'function') {
			onRenderErrorProp(message);
		}
	}

	function resolveReadingPositionAutoSaveConfig(): { enabled: boolean; pages: number } {
		const config = getReadingPositionAutoSaveConfig?.();
		return {
			enabled: normalizeContinuousReadingPositionAutoSaveEnabled(
				config?.enabled ?? DEFAULT_CONTINUOUS_READING_POSITION_AUTO_SAVE_ENABLED
			),
			pages: normalizeContinuousReadingPositionAutoSavePages(
				config?.pages ?? DEFAULT_CONTINUOUS_READING_POSITION_AUTO_SAVE_PAGES
			),
		};
	}

	function resetReadingPositionAutoSaveTracking(currentPage = 0): void {
		readingPositionAutoSaveTrackerState = createReadingPositionAutoSaveTrackerState(
			String(book?.id || ''),
			currentPage
		);
	}

	async function persistReadingProgress(position: EpubBook['currentPosition']): Promise<void> {
		if (!canUseReadingProgress) {
			return;
		}
		if (!book?.id || !position?.cfi) {
			return;
		}
		readerService.flushReadingPace?.();
		const readingStats = readerService.getReadingStats?.() ?? book.readingStats;
		if (readingStats) {
			book.readingStats = readingStats;
		}
		book.currentPosition = position;
		await storageService.saveProgress(book.id, position, readingStats);

		try {
			const app = storageService.getApp?.();
			if (app) {
				const syncService = getZoraSyncService(app);
				syncService.saveProgress(book.id, {
					cfi: position.cfi,
					href: position.href,
					percentage: position.percent || 0,
				});
			}
		} catch (syncErr) {
			logger.debug('[EpubReaderView] Sync save progress notice:', syncErr);
		}
	}

	async function syncReadingPositionPersistence(position: EpubBook['currentPosition'], info: PaginationInfo): Promise<void> {
		if (!canUseReadingProgress) {
			resetReadingPositionAutoSaveTracking(info.currentPage);
			return;
		}
		if (isParagraphModeActive?.() && !isParagraphModeProgressDetached?.()) {
			await persistReadingProgress(position);
			await onAutoReadingPositionSaved?.(position as ReadingPosition);
			resetReadingPositionAutoSaveTracking(info.currentPage);
			return;
		}
		const config = resolveReadingPositionAutoSaveConfig();
		const currentBookId = String(book?.id || '');

		if (
			currentBookId !== readingPositionAutoSaveTrackerState.trackedBookId
			|| config.enabled !== readingPositionAutoSaveEnabled
			|| config.pages !== readingPositionAutoSavePages
		) {
			readingPositionAutoSaveEnabled = config.enabled;
			readingPositionAutoSavePages = config.pages;
			resetReadingPositionAutoSaveTracking(info.currentPage);
		}

		if (!book) {
			return;
		}

		const trackerResult = advanceReadingPositionAutoSaveTracker(readingPositionAutoSaveTrackerState, {
			bookId: currentBookId,
			currentPage: info.currentPage,
			enabled: config.enabled,
			pages: config.pages,
		});
		readingPositionAutoSaveTrackerState = trackerResult.nextState;

		if (!trackerResult.shouldPersist) {
			return;
		}

		await persistReadingProgress(position);
		await onAutoReadingPositionSaved?.(position as ReadingPosition);
		resetReadingPositionAutoSaveTracking(info.currentPage);
	}

	async function persistLatestReadingProgressOnTeardown(
		targetStorageService: EpubStorageService = storageService
	): Promise<void> {
		if (!targetStorageService || typeof targetStorageService !== "object") {
			return;
		}
		try {
			if (!canUseReadingProgress) {
				await flushEpubPendingProgress(targetStorageService);
				return;
			}
			if (!book?.id) {
				await flushEpubPendingProgress(targetStorageService);
				return;
			}
			if (isParagraphModeProgressDetached?.()) {
				await flushEpubPendingProgress(targetStorageService);
				return;
			}

			readerService.flushReadingPace?.();
			const readingStats = readerService.getReadingStats?.() ?? book.readingStats;

			const livePosition = readerService.getCurrentPosition();
			const currentCfi = String(livePosition?.cfi || readerService.getCurrentCFI() || book.currentPosition?.cfi || '').trim();
			if (!currentCfi) {
				await flushEpubPendingProgress(targetStorageService);
				return;
			}

			const latestPosition = {
				chapterIndex:
					typeof livePosition?.chapterIndex === 'number'
						? livePosition.chapterIndex
						: book.currentPosition?.chapterIndex || 0,
				cfi: currentCfi,
				percent:
					typeof livePosition?.percent === 'number' && Number.isFinite(livePosition.percent)
						? livePosition.percent
						: book.currentPosition?.percent || 0,
			};

			if (readingStats) {
				book.readingStats = readingStats;
			}
			await persistReadingProgress(latestPosition);
			await flushEpubPendingProgress(targetStorageService);
		} catch (error) {
			logger.warn('[EpubReaderView] Failed to persist reading progress on teardown:', error);
		}
	}

	function isStaleRender(renderToken: number): boolean {
		return viewDisposed || renderToken !== renderSessionToken;
	}

	async function canonicalizeStoredCfiLocation<T extends { cfi: string }>(
		saved: T | null,
		options: {
			bookId: string;
			label: string;
			persistCanonical: (value: T) => Promise<void>;
		}
	): Promise<T | null> {
		if (!saved?.cfi) {
			return saved;
		}

		if (typeof readerService.canonicalizeLocation !== 'function') {
			return saved;
		}

		try {
			const canonicalCfi = await readerService.canonicalizeLocation(saved.cfi);
			if (!canonicalCfi) {
				logger.warn(`[EpubReaderView] Skipping saved ${options.label} because it could not be canonicalized for the current engine.`, {
					bookId: options.bookId,
					cfi: saved.cfi,
				});
				return null;
			}

			if (canonicalCfi === saved.cfi) {
				return saved;
			}

			const canonicalValue = {
				...saved,
				cfi: canonicalCfi,
			};
			await options.persistCanonical(canonicalValue);
			logger.info(`[EpubReaderView] Canonicalized saved ${options.label} before restoring it into the current reader runtime.`, {
				bookId: options.bookId,
				from: saved.cfi,
				to: canonicalCfi,
			});
			return canonicalValue;
		} catch (error) {
			logger.warn(`[EpubReaderView] Failed to canonicalize saved ${options.label} before restore:`, {
				bookId: options.bookId,
				cfi: saved.cfi,
				error,
			});
			return null;
		}
	}

	async function resolveRestorableProgress() {
		if (!canUseReadingProgress) {
			return null;
		}
		const currentBook = book;
		if (!currentBook) {
			return null;
		}

		let candidateProgress: any = null;
		const app = storageService.getApp?.();
		if (app) {
			try {
				const syncService = getZoraSyncService(app);
				const syncProgress = await syncService.loadProgress(currentBook.id);
				if (syncProgress?.cfi) {
					candidateProgress = {
						cfi: syncProgress.cfi,
						href: syncProgress.href || '',
						percent: syncProgress.percentage,
						updatedAt: new Date(syncProgress.updatedAt).getTime() || Date.now(),
					};
				}
			} catch (syncErr) {
				logger.debug('[EpubReaderView] Sync load progress notice:', syncErr);
			}
		}

		const savedProgress = await storageService.loadProgress(currentBook.id, currentBook);
		if (candidateProgress && savedProgress) {
			const savedTime = (savedProgress as any)?.updatedAt ? new Date((savedProgress as any).updatedAt).getTime() : 0;
			const syncTime = candidateProgress.updatedAt || 0;
			if (syncTime < savedTime) {
				candidateProgress = savedProgress;
			}
		} else if (!candidateProgress) {
			candidateProgress = savedProgress;
		}

		return canonicalizeStoredCfiLocation(candidateProgress, {
			bookId: currentBook.id,
			label: 'EPUB progress',
			persistCanonical: async (canonicalProgress) => {
				currentBook.currentPosition = canonicalProgress;
				await storageService.saveProgress(currentBook.id, canonicalProgress);
			},
		});
	}

	async function resolveLastOpenBookmark() {
		if (!canUseReadingProgress) {
			return null;
		}
		const currentBook = book;
		if (!currentBook) {
			return null;
		}

		const savedBookmark = await storageService.loadLastOpenBookmark(currentBook.id);
		return canonicalizeStoredCfiLocation(savedBookmark, {
			bookId: currentBook.id,
			label: 'last-open EPUB bookmark',
			persistCanonical: async (canonicalBookmark) => {
				await storageService.saveLastOpenBookmark(currentBook.id, canonicalBookmark);
			},
		});
	}

	async function resolvePreferredRestorePosition() {
		const savedProgress = await resolveRestorableProgress();
		const savedLastOpenBookmark = await resolveLastOpenBookmark();
		return choosePreferredRestorePosition(savedProgress, savedLastOpenBookmark);
	}

	async function refreshReaderHighlights() {
		if (!canUseExcerptNotes) {
			await readerService.applyHighlights([]);
			return;
		}
		if (typeof readerService.refreshHighlights === 'function') {
			await readerService.refreshHighlights();
			return;
		}
		await loadSavedHighlights();
	}

	interface ContainerRect {
		width: number;
		height: number;
	}

	function readContainerRect(): ContainerRect {
		const rect = viewerContainer?.getBoundingClientRect();
		return {
			width: Math.round(rect?.width || 0),
			height: Math.round(rect?.height || 0)
		};
	}

	function waitForNextFrame(): Promise<void> {
		return new Promise((resolve) => requestAnimationFrame(() => resolve()));
	}

	function waitForDelay(delayMs: number): Promise<void> {
		return new Promise((resolve) => {
			if (delayMs <= 0) {
				resolve();
				return;
			}
			mobileStabilizationTimer = window.setTimeout(() => {
				mobileStabilizationTimer = null;
				resolve();
			}, delayMs);
		});
	}

	function normalizeLocationKey(value: string | null | undefined): string {
		let normalized = String(value || "")
			.replace(/%5B/gi, "[")
			.replace(/%5D/gi, "]")
			.replace(/%7C/gi, "|")
			.trim();
		if (normalized.includes("%")) {
			try {
				normalized = decodeURIComponent(normalized);
			} catch (_error) {
				// Keep the original string when decoding fails.
			}
		}
		return normalized.toLowerCase();
	}

	function isMeaningfullyRestored(savedProgress: NonNullable<Awaited<ReturnType<typeof resolveRestorableProgress>>>): boolean {
		const currentPosition = readerService.getCurrentPosition();
		const savedKey = normalizeLocationKey(savedProgress.cfi);
		const currentKey = normalizeLocationKey(currentPosition.cfi);
		if (savedKey && currentKey && savedKey === currentKey) {
			return true;
		}

		const currentPercent = Number.isFinite(currentPosition.percent) ? currentPosition.percent : 0;
		const savedPercent = Number.isFinite(savedProgress.percent) ? savedProgress.percent : 0;
		if (Math.abs(currentPercent - savedPercent) <= 0.35) {
			return true;
		}

		return currentPosition.chapterIndex === savedProgress.chapterIndex
			&& savedPercent > 0
			&& currentPercent > 0;
	}

	async function restoreSavedProgress(
		savedProgress: NonNullable<Awaited<ReturnType<typeof resolveRestorableProgress>>>,
		renderToken: number
	): Promise<void> {
		const retryDelays = [0, 80, 180];

		for (const delayMs of retryDelays) {
			if (isStaleRender(renderToken)) {
				return;
			}

			try {
				await readerService.goToLocation(savedProgress.cfi);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error || "");
				if (/navigation timed out/i.test(message)) {
					logger.warn('[EpubReaderView] Saved EPUB progress restore timed out; continuing with the current reader position.', {
						bookId: book?.id,
						filePath,
						savedProgress,
						error,
					});
					return;
				}
				throw error;
			}
			if (isStaleRender(renderToken)) {
				return;
			}

			await waitForNextFrame();
			if (delayMs > 0) {
				await waitForDelay(delayMs);
			}
			if (isStaleRender(renderToken)) {
				return;
			}

			if (isMeaningfullyRestored(savedProgress)) {
				return;
			}
		}

		logger.warn('[EpubReaderView] EPUB saved progress restore did not land on the expected position after retries.', {
			bookId: book?.id,
			filePath,
			savedProgress,
			currentPosition: readerService.getCurrentPosition(),
		});
	}

	function getRenderMode(readerSettings: EpubReaderSettings): {
		flow: 'paginated' | 'scrolled';
		spread: 'always' | 'none';
		manager: 'default' | 'continuous';
		minSpreadWidth: number;
	} {
		if (readerSettings.flowMode === 'scrolled') {
			return {
				flow: 'scrolled',
				spread: 'none',
				manager: 'continuous',
				minSpreadWidth: 800
			};
		}

		const isDoubleLayout = readerSettings.layoutMode === 'double';
		return {
			flow: 'paginated',
			spread: isDoubleLayout ? 'always' : 'none',
			manager: 'default',
			minSpreadWidth: isDoubleLayout ? 0 : 800
		};
	}

	async function waitForStableContainer(maxFrames = 24): Promise<ContainerRect> {
		let previous = readContainerRect();
		let stableFrames = previous.width > 0 && previous.height > 0 ? 1 : 0;

		for (let i = 0; i < maxFrames; i++) {
			await waitForNextFrame();
			const current = readContainerRect();
			const isSameSize = current.width === previous.width && current.height === previous.height;
			const isRenderable = current.width > 0 && current.height > 0;

			if (isRenderable && isSameSize) {
				stableFrames += 1;
				if (stableFrames >= 2) {
					return current;
				}
			} else {
				stableFrames = isRenderable ? 1 : 0;
			}

			previous = current;
		}

		return previous.width > 0 && previous.height > 0
			? previous
			: { width: 800, height: 600 };
	}

	async function renderBook() {
		if (!book || !viewerContainer || rendered) return;
		const renderToken = ++renderSessionToken;
		rendered = true;

		try {
			// Start collecting highlights in parallel with rendering
			const highlightPromise = collectAllHighlights();
			const stableRect = await waitForStableContainer();
			if (isStaleRender(renderToken)) {
				return;
			}
			const renderMode = getRenderMode(settings);
			await readerService.renderTo(viewerContainer, {
				flow: renderMode.flow,
				spread: renderMode.spread,
				manager: renderMode.manager,
				minSpreadWidth: renderMode.minSpreadWidth,
				width: stableRect.width,
				height: stableRect.height,
				lineHeight: settings.lineHeight,
				widthMode: settings.widthMode,
				strikethroughPresentation: excerptSettings.strikethroughDisplayMode
			});
			if (isStaleRender(renderToken)) {
				return;
			}
			currentLayoutMode = settings.layoutMode;
			currentFlowMode = settings.flowMode;
			currentWidthMode = settings.widthMode;
			skipNextAppearanceSync = true;

			setupResizeObserver();

			registerRelocatedHandler();

			// Let the reader layout settle after settings/resize before navigating
			await new Promise(r => window.setTimeout(r, 50));
			if (isStaleRender(renderToken)) {
				return;
			}

			// Keep source-note / explicit navigation highest priority.
			let restoredPositionCfi: string | undefined;
			if (!hasPendingNavigation) {
				const preferredRestorePosition = await resolvePreferredRestorePosition();
				if (isStaleRender(renderToken)) {
					return;
				}
				if (preferredRestorePosition?.cfi) {
					restoredPositionCfi = preferredRestorePosition.cfi;
					await restoreSavedProgress(preferredRestorePosition, renderToken);
					if (isStaleRender(renderToken)) {
						return;
					}
				}
			}

			const currentPaginationInfo = await readerService.getPaginationInfo();
			resetReadingPositionAutoSaveTracking(currentPaginationInfo.currentPage);
			notifyProgressChange(canUseReadingProgress ? readerService.getReadingProgress() : 0);
			notifyPaginationChange(currentPaginationInfo);
			notifyChapterChange(readerService.getCurrentChapterTitle());
			if (isStaleRender(renderToken)) {
				return;
			}

			// Apply pre-collected highlights (already resolved or nearly so)
			const allHighlights = await highlightPromise;
			if (isStaleRender(renderToken)) {
				return;
			}
			if (allHighlights.length > 0) {
				await readerService.applyHighlights(allHighlights);
			} else {
				scheduleHighlightRetry();
			}
			highlightsReady = true;

			notifyReaderReady();
			logMobileEvent("EPUB", "RenderSuccess", {
				bookId: book?.id,
				title: book?.title,
				chapter: readerService.getCurrentChapterTitle(),
				progress: canUseReadingProgress ? readerService.getReadingProgress() : 0,
			});
			const directHighlightsCount = allHighlights.filter((h) => h.style !== 'reading-note').length;
			const readingNoteMarkerCount = allHighlights.filter((h) => h.style === 'reading-note').length;
			void logMobileSyncDebug({
				app: storageService.getApp(),
				bookId: book?.id,
				sourceId: book?.sourceId,
				filePath,
				readingPositionCfi: restoredPositionCfi,
				directHighlightsCount,
				readingNoteMarkerCount,
				selectionRangeCount: 0,
				selectionCollapsed: true,
			});
			void stabilizeMobileRenderer(renderToken);
		} catch (error) {
			if (isStaleRender(renderToken)) {
				return;
			}
			const classified = reportEpubError(error, 'render');
			rendered = false;
			notifyRenderError(classified.userMessage);
			logMobileError("EPUB", error, {
				bookId: book?.id,
				filePath,
				classified: classified.userMessage,
			});
		}
	}

	function setupResizeObserver() {
		if (resizeObserver) resizeObserver.disconnect();
		resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const { width, height } = entry.contentRect;
				if (width > 0 && height > 0 && !readerService.isLayoutChanging()) {
					readerService.resize(width, height);
					scheduleHighlightReapply();
				}
			}
		});
		resizeObserver.observe(viewerContainer);
	}

	async function applySettings() {
		if (!rendered) return;
		await readerService.applyReaderAppearance({
			lineHeight: settings.lineHeight,
			letterSpacing: settings.letterSpacing,
			pageMargin: settings.pageMargin,
			widthMode: settings.widthMode,
			strikethroughPresentation: excerptSettings.strikethroughDisplayMode,
		});
	}

	async function collectAllHighlights(): Promise<ReaderHighlight[]> {
		if (!book) return [];
		try {
			const allHighlights = await annotationService.collectAllHighlights(book.id, filePath, backlinkService);
			logger.debug('[EpubReaderView] total highlights to apply:', allHighlights.length);
			return allHighlights;
		} catch (e) {
			logger.warn('[EpubReaderView] Failed to collect highlights:', e);
			return [];
		}
	}

	function scheduleHighlightReapply(delayMs = 300) {
		if (!highlightsReady) return;
		if (highlightReapplyTimer) window.clearTimeout(highlightReapplyTimer);
		highlightReapplyTimer = window.setTimeout(async () => {
			highlightReapplyTimer = null;
			await refreshReaderHighlights();
		}, delayMs);
	}

	function scheduleHighlightRetry() {
		if (!canUseExcerptNotes) {
			return;
		}
		if (retryTimer) window.clearTimeout(retryTimer);
		retryTimer = window.setTimeout(async () => {
			retryTimer = null;
			const retried = await collectAllHighlights();
			if (retried.length > 0) {
				await readerService.applyHighlights(retried);
			}
		}, 1200);
	}

	async function stabilizeMobileRenderer(renderToken: number) {
		if (!Platform.isMobile || settings.flowMode !== 'scrolled' || !rendered || !book) {
			return;
		}

		const stabilizationToken = ++mobileStabilizationToken;
		const runPass = async (delayMs: number) => {
			await waitForDelay(delayMs);
			if (isStaleRender(renderToken) || stabilizationToken !== mobileStabilizationToken || !rendered) {
				return;
			}

			const rect = await waitForStableContainer(8);
			if (isStaleRender(renderToken) || stabilizationToken !== mobileStabilizationToken || !rendered) {
				return;
			}

			readerService.resize(rect.width, rect.height);
			const currentCfi = readerService.getCurrentCFI();
			if (currentCfi) {
				await readerService.goToLocation(currentCfi);
			}
			if (isStaleRender(renderToken) || stabilizationToken !== mobileStabilizationToken || !rendered) {
				return;
			}
			await refreshReaderHighlights();
		};

		await runPass(0);
		await runPass(140);
	}

	async function loadSavedHighlights() {
		const allHighlights = await collectAllHighlights();
		await readerService.applyHighlights(allHighlights);
	}

	function registerRelocatedHandler() {
		if (detachRelocatedHandler) return;
		detachRelocatedHandler = readerService.onRelocated(async (position) => {
			const paginationInfo = await readerService.getPaginationInfo();
			const skipPersist = shouldSkipReadingProgressPersistOnRelocate?.() === true;
			if (!skipPersist && position?.cfi) {
				await persistReadingProgress(position);
				await syncReadingPositionPersistence(position, paginationInfo);
			}
			notifyProgressChange(canUseReadingProgress ? position.percent : 0);
			notifyPaginationChange(paginationInfo);
			notifyChapterChange(readerService.getCurrentChapterTitle());
		});
	}

	async function handleReaderModeChange() {
		if (!rendered) return;
		if (
			settings.layoutMode === currentLayoutMode
			&& settings.flowMode === currentFlowMode
			&& settings.widthMode === currentWidthMode
		) return;
		const previousLayoutMode = currentLayoutMode;
		const previousFlowMode = currentFlowMode;
		const previousWidthMode = currentWidthMode;
		const nextLayoutMode = settings.layoutMode;
		const nextFlowMode = settings.flowMode;
		const nextWidthMode = settings.widthMode;
		try {
			currentLayoutMode = nextLayoutMode;
			currentFlowMode = nextFlowMode;
			currentWidthMode = nextWidthMode;
			await readerService.setLayoutMode(nextLayoutMode, nextFlowMode, {
				lineHeight: settings.lineHeight,
				letterSpacing: settings.letterSpacing,
				pageMargin: settings.pageMargin,
				widthMode: nextWidthMode,
				strikethroughPresentation: excerptSettings.strikethroughDisplayMode,
			});
			skipNextAppearanceSync = true;

			await new Promise(r => window.setTimeout(r, 150));

			await refreshReaderHighlights();
			notifyReaderReady();
			void stabilizeMobileRenderer(renderSessionToken);
		} catch (error) {
			const classified = reportEpubError(error, 'render');
			currentLayoutMode = previousLayoutMode;
			currentFlowMode = previousFlowMode;
			currentWidthMode = previousWidthMode;
			notifyRenderError(classified.userMessage);
		}
	}

	$effect(() => {
		if (book && viewerContainer && !rendered) {
			renderBook();
		}
	});

	$effect(() => {
		const _lh = settings.lineHeight;
		const _ls = settings.letterSpacing;
		const _pm = settings.pageMargin;
		const _sp = excerptSettings.strikethroughDisplayMode;
		if (rendered) {
			if (skipNextAppearanceSync) {
				skipNextAppearanceSync = false;
				return;
			}
			applySettings().then(() => {
				scheduleHighlightReapply(150);
			});
		}
	});

	$effect(() => {
		const _layout = settings.layoutMode;
		const _flow = settings.flowMode;
		const _width = settings.widthMode;
		if (rendered && (_layout !== currentLayoutMode || _flow !== currentFlowMode || _width !== currentWidthMode)) {
			void handleReaderModeChange();
		}
	});

	onMount(() => {
		const capturedStorageService = storageService;
		return () => {
			viewDisposed = true;
			renderSessionToken += 1;
			mobileStabilizationToken += 1;
			void persistLatestReadingProgressOnTeardown(capturedStorageService);
			if (detachRelocatedHandler) {
				detachRelocatedHandler();
				detachRelocatedHandler = null;
			}
			if (retryTimer) window.clearTimeout(retryTimer);
			if (highlightReapplyTimer) window.clearTimeout(highlightReapplyTimer);
			if (mobileStabilizationTimer) window.clearTimeout(mobileStabilizationTimer);
			if (resizeObserver) {
				resizeObserver.disconnect();
			}
		};
	});
</script>

<div
	class="epub-reader-view"
	class:epub-width-full={settings.widthMode === 'full' || settings.widthMode === 'fit' || settings.widthMode === 'edge'}
	class:epub-width-edge={settings.widthMode === 'edge'}
>
	<div class="epub-viewer-container" bind:this={viewerContainer}></div>
</div>
