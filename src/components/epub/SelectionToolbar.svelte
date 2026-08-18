<script lang="ts">
	import { setIcon, Platform, Menu } from 'obsidian';
	import type { App } from 'obsidian';
	import { onMount, tick, untrack } from 'svelte';
	import { PREMIUM_FEATURES } from '../../services/premium/PremiumFeatureGuard';
	import { tr } from '../../utils/i18n';
	import { logger } from '../../utils/logger';
import type {
EpubBook,
EpubHighlightStyle,
EpubReaderEngine,
ReaderFrame,
} from '../../services/epub';
import type { ReaderAnchorPoint, ReaderViewportRect } from '../../services/epub/reader-engine-types';
	import type { ResolvedWebTranslationProvider } from '../../config/selection-translation-settings';
	import { openObsidianVaultSearch } from '../../services/obsidian/obsidian-vault-search';
	import { openObsidianWebSearch } from '../../services/obsidian/obsidian-web-search';
	import {
		listActiveTranslationProviders,
		openWebTranslationProvider,
		readSelectionTranslationSettings,
	} from '../../services/obsidian/obsidian-web-translate';
	import { extractSelectionContext, isDictionaryLookupCandidate } from '../../services/obsidian/selection-lookup-routing';
	import type { IntegratedAISettings } from '../../config/integrated-ai-settings';
	import type { ZoraSelectionTranslationInput } from '../../services/ai/zora/zora-translation-service';
	import SelectionDictionaryPopover from './SelectionDictionaryPopover.svelte';
	import { showNotification } from '../../utils/notifications';
	import { domInstanceOf } from '../../utils/dom-instance-of';
	import {
		computeToolbarPosition,
		createEventBinder,
		getEventTargetNode,
		shouldDismissToolbarOnPointerDown,
		resolveMobileFloatingInsetBottom,
	} from './toolbar-positioning';

	type ExternalSelectionState = {
		text: string;
		cfiRange: string;
		rect: DOMRect;
		rects?: DOMRect[];
		clear?: () => void;
	};

	interface Props {
		app: App;
		readerService: EpubReaderEngine;
		book: EpubBook | null;
		readerVersion?: number;
		autoInsert?: boolean;
		canvasMode?: boolean;
		canUseExcerptNotes?: boolean;
		canUseStyledExcerpts?: boolean;
		showPremiumFeaturePreviewEnabled?: boolean;
		onRequestPremiumFeaturePreview?: (featureId: string) => void;
		boundsEl?: HTMLElement | null;
		mobileDockBottomOffset?: number;
		externalSelection?: ExternalSelectionState | null;
		onInsertToNote?: (text: string, cfiRange: string, color?: string, style?: EpubHighlightStyle) => void;
		onCopySelectionLink?: (
			action: 'protocolMarkdown' | 'vaultWikilink' | 'obsidianUri' | 'plainText',
			text: string,
			cfiRange: string
		) => void | Promise<void>;
		onAutoInsert?: (text: string, cfiRange: string, color?: string, style?: EpubHighlightStyle) => void;
		onExtractToCard?: (text: string, cfiRange: string) => void;
		onCreateReadingPoint?: (text: string, cfiRange: string) => void;
		onOpenAIMenu: (event: MouseEvent, text: string, cfiRange: string) => void;
		translationSettings?: IntegratedAISettings;
	}

	let {
		app,
		readerService,
		book,
		readerVersion = 0,
		autoInsert = false,
		canvasMode = false,
		canUseExcerptNotes = true,
		canUseStyledExcerpts = true,
		showPremiumFeaturePreviewEnabled = false,
		onRequestPremiumFeaturePreview,
		boundsEl = null,
		mobileDockBottomOffset = 0,
		externalSelection = null,
		onInsertToNote,
		onCopySelectionLink,
		onAutoInsert,
		onExtractToCard,
		onCreateReadingPoint,
		onOpenAIMenu,
		translationSettings
	}: Props = $props();
	let t = $derived($tr);

	let toolbarEl: HTMLDivElement | undefined = $state(undefined);
	let isVisible = $state(false);
	let posTop = $state(0);
	let posLeft = $state(0);
	let isBelowSelection = $state(false);
	let toolbarMode = $state<'floating' | 'docked'>('floating');
	let arrowOffset = $state(0);
	let selectedText = $state('');
	let currentCfiRange = $state('');
	let iframeDoc: Document | null = null;
	let teardownReaderTracking: (() => void) | null = null;
	let teardownPositionTracking: (() => void) | null = null;
	let activeFrame: ReaderFrame | null = null;
	let pendingSyncFrame: number | null = null;
	let activeClearSelection: (() => void) | null = null;
	let pendingExternalSelectionHideFrame: number | null = null;
	let activeToolbarMenu: Menu | null = null;
let lookupSelection: ZoraSelectionTranslationInput & { anchorRect: DOMRect; anchorRects: DOMRect[]; anchorPoint?: ReaderAnchorPoint } | null = $state(null);
let lookupViewportEl: HTMLElement | null = $state(null);

	const isMobileToolbar = Platform.isMobile || activeDocument.body.classList.contains('is-mobile');

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

	function getFrameElement(frame: ReaderFrame | null | undefined): HTMLIFrameElement | null {
		const iframeWindow = frame?.window || frame?.frameDocument?.defaultView;
		return (iframeWindow?.frameElement as HTMLIFrameElement | null) || null;
	}

	function closestAcrossShadowHosts(node: Node | null | undefined, selector: string): HTMLElement | null {
		let current: Node | null | undefined = node;
		while (current) {
			if (domInstanceOf(current, HTMLElement)) {
				const matched = current.closest(selector) as HTMLElement | null;
				if (matched) {
					return matched;
				}
			}
			const rootNode = current.getRootNode?.();
			if (!domInstanceOf(rootNode, ShadowRoot) || !domInstanceOf(rootNode.host, HTMLElement)) {
				break;
			}
			current = rootNode.host;
		}
		return null;
	}

	function getViewportContainer(frame: ReaderFrame | null | undefined): HTMLElement | null {
		const iframe = getFrameElement(frame);
		return closestAcrossShadowHosts(iframe, '.epub-reader-viewport')
			|| boundsEl
			|| (activeDocument.querySelector('.epub-reader-viewport') as HTMLElement | null);
	}

	function getScrollTrackingHost(frame: ReaderFrame | null | undefined): HTMLElement | null {
		const iframe = getFrameElement(frame);
		return closestAcrossShadowHosts(iframe, '.epub-content-wrapper')
			|| (activeDocument.querySelector('.epub-content-wrapper') as HTMLElement | null);
	}

	function viewportRectToDOMRect(rect: ReaderViewportRect): DOMRect {
		return new DOMRect(rect.left, rect.top, rect.width, rect.height);
	}

	function resolveSelectionGeometry(
		cfiRange: string,
		frame: ReaderFrame,
		selection: Selection
	): {
		rect: DOMRect;
		rects: DOMRect[];
		anchorPoint?: ReaderAnchorPoint;
	} | null {
		const geometry = readerService.getSelectionViewportGeometry?.(cfiRange);
		if (geometry?.rect) {
			const rects = (geometry.rects?.length ? geometry.rects : [geometry.rect]).map(viewportRectToDOMRect);
			return {
				rect: viewportRectToDOMRect(geometry.rect),
				rects,
				anchorPoint: geometry.anchorPoint,
			};
		}

		const rangeRect = getSelectionRect(selection);
		const rangeRects = getSelectionRects(selection);
		const iframe = getFrameElement(frame);
		if (rangeRect && iframe) {
			const iframeRect = iframe.getBoundingClientRect();
			return {
				rect: new DOMRect(
					rangeRect.left + iframeRect.left,
					rangeRect.top + iframeRect.top,
					rangeRect.width,
					rangeRect.height
				),
				rects: rangeRects.map(
					(rect) =>
						new DOMRect(
							rect.left + iframeRect.left,
							rect.top + iframeRect.top,
							rect.width,
							rect.height
						)
				),
			};
		}
		if (rangeRect) {
			return {
				rect: rangeRect,
				rects: rangeRects,
			};
		}

		const navigationRect = readerService.getNavigationTargetRect({
			cfi: cfiRange,
			text: selection.toString().trim(),
		});
		if (!navigationRect) {
			return null;
		}
		return {
			rect: navigationRect,
			rects: [navigationRect],
		};
	}

	function clearPendingSync() {
		if (pendingSyncFrame !== null) {
			window.cancelAnimationFrame(pendingSyncFrame);
			pendingSyncFrame = null;
		}
	}

	function clearPendingExternalSelectionHide() {
		if (pendingExternalSelectionHideFrame !== null) {
			window.cancelAnimationFrame(pendingExternalSelectionHideFrame);
			pendingExternalSelectionHideFrame = null;
		}
	}

	function stopPositionTracking() {
		clearPendingSync();
		teardownPositionTracking?.();
		teardownPositionTracking = null;
		activeFrame = null;
	}

	function dismissActiveToolbarMenu(): void {
		if (!activeToolbarMenu) {
			return;
		}
		activeToolbarMenu.hide();
		if (typeof activeToolbarMenu.close === 'function') {
			activeToolbarMenu.close();
		}
		activeToolbarMenu = null;
	}

	function hideToolbar() {
		dismissActiveToolbarMenu();
		clearPendingExternalSelectionHide();
		isVisible = false;
		isBelowSelection = false;
		toolbarMode = 'floating';
		arrowOffset = 0;
		selectedText = '';
		currentCfiRange = '';
		activeClearSelection = null;
		stopPositionTracking();
	}

	function clearAndHide() {
		if (activeClearSelection) {
			activeClearSelection();
		} else if (iframeDoc) {
			iframeDoc.getSelection()?.removeAllRanges();
		}
		hideToolbar();
	}

	function canPreviewLockedExcerptFeature(): boolean {
		return !canUseExcerptNotes && showPremiumFeaturePreviewEnabled;
	}

	function handlePremiumExcerptFeaturePreview(): void {
		onRequestPremiumFeaturePreview?.(PREMIUM_FEATURES.EPUB_EXCERPT_NOTES);
		clearAndHide();
	}

	function handlePremiumStyledExcerptFeaturePreview(): void {
		onRequestPremiumFeaturePreview?.(PREMIUM_FEATURES.EPUB_STYLED_EXCERPTS);
		clearAndHide();
	}

	async function handleHighlight(color: string, style?: EpubHighlightStyle) {
		if (!canUseExcerptNotes) {
			if (showPremiumFeaturePreviewEnabled) {
				handlePremiumExcerptFeaturePreview();
				return;
			}
			clearAndHide();
			return;
		}
		if (style && !canUseStyledExcerpts) {
			if (showPremiumFeaturePreviewEnabled) {
				handlePremiumStyledExcerptFeaturePreview();
				return;
			}
			clearAndHide();
			return;
		}
		if (!book || !selectedText || !currentCfiRange) {
			clearAndHide();
			return;
		}

		try {
			const highlight = { cfiRange: currentCfiRange, color, style, text: selectedText };
			if (autoInsert || canvasMode) {
				readerService.addHighlight(highlight);
			} else {
				readerService.addTemporaryHighlight(highlight, 2000);
			}
		} catch (e) {
			logger.warn('[SelectionToolbar] Failed to apply highlight:', e);
		}

		onAutoInsert?.(selectedText, currentCfiRange, color, style);
		clearAndHide();
	}

	function handleInsertToNote() {
		if (!canUseExcerptNotes && showPremiumFeaturePreviewEnabled) {
			handlePremiumExcerptFeaturePreview();
			return;
		}
		if (selectedText && currentCfiRange) {
			onInsertToNote?.(selectedText, currentCfiRange);
		}
		clearAndHide();
	}

	async function runSelectionLinkCopy(
		action: 'protocolMarkdown' | 'vaultWikilink' | 'obsidianUri' | 'plainText'
	) {
		if (!canUseExcerptNotes && showPremiumFeaturePreviewEnabled) {
			handlePremiumExcerptFeaturePreview();
			return;
		}
		if (selectedText && currentCfiRange) {
			await onCopySelectionLink?.(action, selectedText, currentCfiRange);
		}
		clearAndHide();
	}

	function handleExtractToCard() {
		if (selectedText && currentCfiRange) {
			onExtractToCard?.(selectedText, currentCfiRange);
		}
		clearAndHide();
	}

	function handleCreateReadingPoint() {
		if (selectedText && currentCfiRange) {
			onCreateReadingPoint?.(selectedText, currentCfiRange);
		}
		clearAndHide();
	}

	function handleOpenAIMenu(event: MouseEvent) {
		if (selectedText && currentCfiRange) {
			onOpenAIMenu(event, selectedText, currentCfiRange);
		}
		clearAndHide();

	}

function handleDictionaryLookup() {
if (!selectedText || !currentCfiRange || !activeFrame || !translationSettings) return;
const frameWindow = activeFrame.window || activeFrame.frameDocument?.defaultView;
const frameDocument = frameWindow?.document;
const liveSelection = frameDocument?.getSelection?.();
const range = liveSelection && liveSelection.rangeCount > 0 ? liveSelection.getRangeAt(0).cloneRange() : null;
const viewportEl = getViewportContainer(activeFrame);
if (!viewportEl) return;
const geometry = liveSelection ? resolveSelectionGeometry(currentCfiRange, activeFrame, liveSelection) : null;
if (!geometry) return;
lookupSelection = {
text: selectedText,
cfiRange: currentCfiRange,
chapter: readerService.getCurrentChapterTitle?.() || '',
bookPath: book?.filePath || '',
bookTitle: book?.metadata?.title || '',
context: extractSelectionContext(iframeDoc, selectedText),
range,
anchorRect: geometry.rect,
anchorRects: geometry.rects,
anchorPoint: geometry.anchorPoint,
};
lookupViewportEl = viewportEl;
hideToolbar();
}

function closeDictionaryLookup() {
lookupSelection = null;
lookupViewportEl = null;
clearAndHide();
}


	function handleVaultSearch() {
		if (!selectedText) return;
		if (!openObsidianVaultSearch(app, selectedText)) {
			showNotification(t('epub.selectionToolbar.vaultSearchUnavailable'), 'warning');
		}
		clearAndHide();
	}

	async function runWebSearch(): Promise<void> {
		if (!selectedText.trim()) {
			return;
		}
		const opened = await openObsidianWebSearch(app, selectedText);
		if (!opened) {
			showNotification(t('epub.selectionToolbar.webSearchUnavailable'), 'warning');
		}
	}

	function resolveBuiltinTranslationLabel(
		provider: { nameKey: string }
	): string {
		return t(`epub.translationProviders.${provider.nameKey}`);
	}

	function listTranslationProviders(): ResolvedWebTranslationProvider[] {
		return listActiveTranslationProviders({
			app,
			resolveBuiltinLabel: resolveBuiltinTranslationLabel,
		});
	}

	async function openLookupProvider(
		provider: ResolvedWebTranslationProvider,
		query: string
	): Promise<boolean> {
		const settings = readSelectionTranslationSettings(app);
		const context = extractSelectionContext(iframeDoc, query);
		return openWebTranslationProvider(app, provider, query, {
			context,
			settings,
			resolveBuiltinLabel: resolveBuiltinTranslationLabel,
		});
	}

	function addLookupProviderMenuItems(
		menu: Menu,
		providers: ResolvedWebTranslationProvider[],
		query: string,
		unavailableLabel: string,
		openFailedLabel: string
	): void {
		if (providers.length === 0) {
			menu.addItem((subItem) => {
				subItem.setTitle(unavailableLabel);
				subItem.setIcon('info');
				subItem.setDisabled(true);
			});
			return;
		}

		for (const provider of providers) {
			menu.addItem((subItem) => {
				subItem.setTitle(provider.label);
				subItem.setIcon(provider.icon);
				subItem.onClick(async () => {
					const opened = await openLookupProvider(provider, query);
					if (!opened) {
						showNotification(openFailedLabel, 'warning');
					}
					clearAndHide();
				});
			});
		}
	}

	function resolveSelectionToolbarSubmenu(item: unknown, fallbackMenu: Menu): Menu {
		const candidate = item as { setSubmenu?: () => Menu };
		if (typeof candidate.setSubmenu === 'function') {
			return candidate.setSubmenu();
		}
		return fallbackMenu;
	}

	function handleOpenMoreMenu(event: MouseEvent) {
		event.stopPropagation();
		const text = selectedText.trim();
		if (!text) {
			return;
		}

		dismissActiveToolbarMenu();
		const translationProviders = listTranslationProviders();
		const menu = new Menu();
		activeToolbarMenu = menu;

		menu.addItem((item) => {
			item.setTitle(t('epub.selectionToolbar.webSearch'));
			item.setIcon('globe');
			item.onClick(async () => {
				await runWebSearch();
				clearAndHide();
			});
		});

		menu.addItem((item) => {
			item.setTitle(t('epub.selectionToolbar.translate'));
			item.setIcon('languages');
			const translateMenu = resolveSelectionToolbarSubmenu(item, menu);
			addLookupProviderMenuItems(
				translateMenu,
				translationProviders,
				text,
				t('epub.selectionToolbar.translateUnavailable'),
				t('epub.selectionToolbar.translateOpenFailed')
			);
		});

		if (onCopySelectionLink && (canUseExcerptNotes || canPreviewLockedExcerptFeature())) {
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle(t('epub.selectionToolbar.copyMdLink'));
				item.setIcon('link');
				item.onClick(() => {
					void runSelectionLinkCopy('protocolMarkdown');
				});
			});
			menu.addItem((item) => {
				item.setTitle(t('epub.selectionToolbar.copyVaultLink'));
				item.setIcon('links-going-out');
				item.onClick(() => {
					void runSelectionLinkCopy('vaultWikilink');
				});
			});
			menu.addItem((item) => {
				item.setTitle(t('epub.selectionToolbar.copyObsidianUri'));
				item.setIcon('external-link');
				item.onClick(() => {
					void runSelectionLinkCopy('obsidianUri');
				});
			});
			menu.addItem((item) => {
				item.setTitle(t('epub.selectionToolbar.copyPlainText'));
				item.setIcon('clipboard-copy');
				item.onClick(() => {
					void runSelectionLinkCopy('plainText');
				});
			});
		}

		menu.showAtMouseEvent(event);
	}

	function handlePointerDownOutside(event: Event) {
		if (!shouldDismissToolbarOnPointerDown(toolbarEl, event)) {
			const target = getEventTargetNode(event.target);
			if (target && toolbarEl?.contains(target)) {
				dismissActiveToolbarMenu();
			}
			return;
		}

		dismissActiveToolbarMenu();
		if (isVisible) {
			clearAndHide();
		}
	}

	function getSelectionRect(selection: Selection): DOMRect | null {
		if (!selection.rangeCount) return null;
		const range = selection.getRangeAt(0);
		const rect = range.getBoundingClientRect();
		if (rect.width || rect.height) {
			return rect;
		}

		const rects = range.getClientRects();
		if (!rects.length) return null;

		let left = rects[0].left;
		let top = rects[0].top;
		let right = rects[0].right;
		let bottom = rects[0].bottom;

		for (let i = 1; i < rects.length; i++) {
			const current = rects[i];
			left = Math.min(left, current.left);
			top = Math.min(top, current.top);
			right = Math.max(right, current.right);
			bottom = Math.max(bottom, current.bottom);
		}

		return new DOMRect(left, top, right - left, bottom - top);
	}

	function getSelectionRects(selection: Selection): DOMRect[] {
		if (!selection.rangeCount) return [];
		const range = selection.getRangeAt(0);
		const rects = Array.from(range.getClientRects());
		if (rects.length) {
			return rects.map((rect) => new DOMRect(rect.left, rect.top, rect.width, rect.height));
		}
		const rect = range.getBoundingClientRect();
		return rect.width || rect.height ? [new DOMRect(rect.left, rect.top, rect.width, rect.height)] : [];
	}

	async function positionToolbar(
		anchorRect: DOMRect,
		containerEl: HTMLElement,
		anchorRects: DOMRect[] = [],
		anchorPoint?: ReaderAnchorPoint
	) {
		isVisible = true;
		await tick();

		if (!toolbarEl) return;

		const containerRect = containerEl.getBoundingClientRect();
		const toRelativeRect = (rect: DOMRect) => ({
			top: rect.top - containerRect.top,
			left: rect.left - containerRect.left,
			bottom: rect.bottom - containerRect.top,
			right: rect.right - containerRect.left,
			width: rect.width,
			height: rect.height,
		});
		const position = computeToolbarPosition({
			anchorRect: toRelativeRect(anchorRect),
			anchorRects: anchorRects.map((rect) => toRelativeRect(rect)),
			anchorPoint: anchorPoint
				? {
					x: anchorPoint.x - containerRect.left,
					y: anchorPoint.y - containerRect.top,
				}
				: undefined,
			containerWidth: containerEl.clientWidth,
			containerHeight: containerEl.clientHeight,
			toolbarWidth: toolbarEl.offsetWidth || 296,
			toolbarHeight: toolbarEl.offsetHeight || 78,
			mobile: isMobileToolbar,
			insetBottom: isMobileToolbar
				? resolveMobileFloatingInsetBottom(mobileDockBottomOffset)
				: 0,
		});

		toolbarMode = position.mode;
		posTop = position.top;
		posLeft = position.left;
		isBelowSelection = position.isBelowAnchor;
		arrowOffset = position.arrowOffset;
	}

	function scheduleActiveSync() {
		if (!activeFrame) return;
		const frame = activeFrame;
		const trackedCfiRange = currentCfiRange;
		clearPendingSync();
		pendingSyncFrame = window.requestAnimationFrame(() => {
			pendingSyncFrame = null;
			void syncSelection(frame, trackedCfiRange || undefined);
		});
	}

	function startPositionTracking(frame: ReaderFrame) {
		if (activeFrame === frame && teardownPositionTracking) {
			return;
		}

		stopPositionTracking();
		activeFrame = frame;

		const iframeWindow = frame.window || frame.frameDocument?.defaultView;
		const iframeDocument = iframeWindow?.document;
		const scrollHost = getScrollTrackingHost(frame);
		const visualViewport = window.visualViewport;
		const binder = createEventBinder();

		binder.bind(scrollHost, 'scroll', scheduleActiveSync, { passive: true });
		binder.bind(iframeWindow, 'scroll', scheduleActiveSync, { passive: true });
		binder.bind(iframeWindow, 'resize', scheduleActiveSync);
		binder.bind(iframeDocument, 'mousedown', handlePointerDownOutside, { capture: true });
		binder.bind(iframeDocument, 'touchstart', handlePointerDownOutside, { capture: true, passive: true });
		binder.bind(activeDocument, 'mousedown', handlePointerDownOutside, { capture: true });
		binder.bind(activeDocument, 'touchstart', handlePointerDownOutside, { capture: true, passive: true });
		binder.bind(window, 'resize', scheduleActiveSync);
		binder.bind(window, 'orientationchange', scheduleActiveSync);
		binder.bind(visualViewport, 'resize', scheduleActiveSync);
		binder.bind(visualViewport, 'scroll', scheduleActiveSync);

		teardownPositionTracking = () => {
			binder.dispose();
		};
	}

	async function syncSelection(frame: ReaderFrame, cfiRange?: string) {
		const repositionOnly = isVisible && Boolean(cfiRange);
		try {
			const iframeWindow = frame.window || frame.frameDocument?.defaultView;
			if (!iframeWindow) {
				if (!repositionOnly) {
					hideToolbar();
				}
				return;
			}

			iframeDoc = iframeWindow.document;
			const selection = iframeWindow.getSelection();
			if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
				hideToolbar();
				return;
			}

			const text = selection.toString().trim();
			if (!text) {
				if (!repositionOnly) {
					hideToolbar();
				}
				return;
			}

			const range = selection.getRangeAt(0);
			const resolvedCfiRange = cfiRange || frame.cfiFromRange(range);
			if (!resolvedCfiRange) {
				if (!repositionOnly) {
					hideToolbar();
				}
				return;
			}

			const viewportEl = getViewportContainer(frame);
			if (!viewportEl) {
				if (!repositionOnly) {
					hideToolbar();
				}
				return;
			}

			selectedText = text;
			currentCfiRange = resolvedCfiRange;
			activeClearSelection = null;

			const geometry = resolveSelectionGeometry(resolvedCfiRange, frame, selection);
			if (!geometry) {
				if (!repositionOnly) {
					hideToolbar();
				}
				return;
			}

			startPositionTracking(frame);
			await positionToolbar(geometry.rect, viewportEl, geometry.rects, geometry.anchorPoint);
		} catch (e) {
			logger.warn('[SelectionToolbar] Failed to sync selection:', e);
			if (!repositionOnly) {
				hideToolbar();
			}
		}
	}

	$effect(() => {
		const currentReaderService = readerService;

		// Keep teardown handles out of the effect dependency graph to avoid
		// self-triggered reruns when the toolbar updates its own subscriptions.
		untrack(() => {
			teardownReaderTracking?.();
			teardownReaderTracking = () => {
				stopPositionTracking();
			};
		});

		const offSelection = currentReaderService.onSelectionChange(({ cfiRange, frame }) => {
			void syncSelection(frame, cfiRange);
		});
		const offHighlightClick = currentReaderService.onHighlightClick(() => {
			hideToolbar();
		});

		untrack(() => {
			teardownReaderTracking = () => {
				offSelection();
				offHighlightClick();
				stopPositionTracking();
			};
		});

		return () => {
			untrack(() => {
				teardownReaderTracking?.();
				teardownReaderTracking = null;
			});
		};
	});

	$effect(() => {
		const _readerVersion = readerVersion;
		untrack(() => {
			hideToolbar();
		});
	});

	$effect(() => {
		const selection = externalSelection;
		if (!selection) {
			const hasActiveClearSelection = untrack(() => Boolean(activeClearSelection));
			if (hasActiveClearSelection) {
				clearPendingExternalSelectionHide();
				pendingExternalSelectionHideFrame = window.requestAnimationFrame(() => {
					pendingExternalSelectionHideFrame = null;
					if (!externalSelection) {
						hideToolbar();
					}
				});
			}
			return;
		}
		clearPendingExternalSelectionHide();

		const viewportEl = boundsEl || (activeDocument.querySelector('.epub-reader-viewport') as HTMLElement | null);
		if (!viewportEl) {
			untrack(() => {
				hideToolbar();
			});
			return;
		}

		untrack(() => {
			selectedText = selection.text;
			currentCfiRange = selection.cfiRange;
			activeClearSelection = selection.clear || null;
			stopPositionTracking();
		});
		void positionToolbar(selection.rect, viewportEl, selection.rects || [selection.rect]);
	});

	onMount(() => {
		activeDocument.addEventListener('mousedown', handlePointerDownOutside, { capture: true });
		activeDocument.addEventListener('touchstart', handlePointerDownOutside, { capture: true, passive: true });
		return () => {
			activeDocument.removeEventListener('mousedown', handlePointerDownOutside, { capture: true });
			activeDocument.removeEventListener('touchstart', handlePointerDownOutside, { capture: true });
			teardownReaderTracking?.();
			teardownReaderTracking = null;
			stopPositionTracking();
			clearPendingSync();
			clearPendingExternalSelectionHide();
		};
	});
</script>

<div
	class="epub-selection-toolbar epub-glass-panel"
	class:visible={isVisible}
	class:below-selection={isBelowSelection}
	class:mobile-docked={toolbarMode === 'docked'}
	style={`top: ${posTop}px; left: ${posLeft}px; --toolbar-arrow-offset: ${arrowOffset}px; --toolbar-bottom-offset: ${Math.max(0, mobileDockBottomOffset)}px;`}
	bind:this={toolbarEl}
>
	<div class="selection-main-row">
		{#if canUseExcerptNotes || canPreviewLockedExcerptFeature()}
			<div class="selection-top-row">
				<div class="toolbar-row colors-row selection-color-row selection-primary-row">
					<button class="color-btn yellow" onclick={() => handleHighlight('yellow')} aria-label={t('epub.selectionToolbar.highlightYellow')} title={t('epub.selectionToolbar.highlightYellow')}><span class="color-btn-core"></span></button>
					<button class="color-btn blue" onclick={() => handleHighlight('blue')} aria-label={t('epub.selectionToolbar.highlightBlue')} title={t('epub.selectionToolbar.highlightBlue')}><span class="color-btn-core"></span></button>
					<button class="color-btn red" onclick={() => handleHighlight('red')} aria-label={t('epub.selectionToolbar.highlightRed')} title={t('epub.selectionToolbar.highlightRed')}><span class="color-btn-core"></span></button>
					<button class="color-btn purple" onclick={() => handleHighlight('purple')} aria-label={t('epub.selectionToolbar.highlightPurple')} title={t('epub.selectionToolbar.highlightPurple')}><span class="color-btn-core"></span></button>
					<button class="color-btn green" onclick={() => handleHighlight('green')} aria-label={t('epub.selectionToolbar.highlightGreen')} title={t('epub.selectionToolbar.highlightGreen')}><span class="color-btn-core"></span></button>
				</div>

					<div class="selection-style-shell">
						<div class="toolbar-row selection-style-row">
							<button class="clickable-icon action-item icon-only style-action-item" onclick={() => handleHighlight('yellow', 'underline')} title={t('epub.selectionToolbar.underline')} aria-label={t('epub.selectionToolbar.underline')}>
								<span class="action-icon style-icon underline-style-icon" use:icon={'underline'}></span>
							</button>
							<button class="clickable-icon action-item icon-only style-action-item" onclick={() => handleHighlight('yellow', 'strikethrough')} title={t('epub.selectionToolbar.strikethrough')} aria-label={t('epub.selectionToolbar.strikethrough')}>
								<span class="action-icon style-icon strikethrough-style-icon" use:icon={'strikethrough'}></span>
							</button>
							<button class="clickable-icon action-item icon-only style-action-item" onclick={() => handleHighlight('yellow', 'wavy')} title={t('epub.selectionToolbar.wavy')} aria-label={t('epub.selectionToolbar.wavy')}>
								<span class="action-icon style-icon wavy-style-icon" use:icon={'pen-tool'}></span>
							</button>
						</div>
					</div>
			</div>
		{/if}

		<div class="selection-actions-shell">
			<div class="toolbar-row actions-row selection-actions-row">
				{#if canUseExcerptNotes || canPreviewLockedExcerptFeature()}
					<button class="clickable-icon action-item" onclick={handleInsertToNote} title={autoInsert ? t('epub.selectionToolbar.insert') : t('epub.selectionToolbar.copy')} aria-label={autoInsert ? t('epub.selectionToolbar.insert') : t('epub.selectionToolbar.copy')}>
						<span class="action-icon" use:icon={autoInsert ? 'clipboard-paste' : 'clipboard-copy'}></span>
						<span class="action-label">{autoInsert ? t('epub.selectionToolbar.insert') : t('epub.selectionToolbar.copy')}</span>
					</button>
				{/if}
				<button class="clickable-icon action-item" onclick={handleVaultSearch} title={t('epub.selectionToolbar.vaultSearchTitle')} aria-label={t('epub.selectionToolbar.vaultSearch')}>
					<span class="action-icon" use:icon={'search'}></span>
					<span class="action-label">{t('epub.selectionToolbar.vaultSearch')}</span>
				</button>

				{#if onExtractToCard && (canUseExcerptNotes || canPreviewLockedExcerptFeature())}
					<div class="row-divider"></div>
				{/if}

				{#if onExtractToCard}
					<button class="clickable-icon action-item accent" onclick={handleExtractToCard} title={t('epub.selectionToolbar.createCardTitle')} aria-label={t('epub.selectionToolbar.createCardTitle')}>
						<span class="action-icon" use:icon={'scissors'}></span>
						<span class="action-label">{t('epub.selectionToolbar.createCard')}</span>
					</button>
				{/if}

				{#if onCreateReadingPoint}
					<button class="clickable-icon action-item accent" onclick={handleCreateReadingPoint} title={t('epub.selectionToolbar.readingPointTitle')} aria-label={t('epub.selectionToolbar.readingPointTitle')}>
						<span class="action-icon" use:icon={'book-plus'}></span>
						<span class="action-label">{t('epub.selectionToolbar.readingPoint')}</span>
					</button>
				{/if}
{#if translationSettings?.enabled !== false}
<button class="clickable-icon action-item accent" onclick={handleDictionaryLookup} title={isDictionaryLookupCandidate(selectedText) ? '词义' : '翻译'} aria-label={isDictionaryLookupCandidate(selectedText) ? '词义' : '翻译'}>
<span class="action-icon" use:icon={isDictionaryLookupCandidate(selectedText) ? 'book-open' : 'languages'}></span>
<span class="action-label">{isDictionaryLookupCandidate(selectedText) ? '词义' : '翻译'}</span>
</button>
{/if}
				<button class="clickable-icon action-item ai" onclick={handleOpenAIMenu} title="AI 助手" aria-label="AI 助手">
					<span class="action-icon" use:icon={'sparkles'}></span>
					<span class="action-label">AI</span>
				</button>
				<button
					class="clickable-icon action-item selection-actions-more"
					onclick={handleOpenMoreMenu}
					title={t('epub.selectionToolbar.moreMenuTitle')}
					aria-label={t('epub.selectionToolbar.moreMenu')}
				>
					<span class="action-icon" use:icon={'more-horizontal'}></span>
					<span class="action-label">{t('epub.selectionToolbar.moreMenu')}</span>
				</button>
			</div>
		</div>
	</div>

	<div class="toolbar-arrow"></div>
</div>

{#if lookupSelection && lookupViewportEl && translationSettings}
<SelectionDictionaryPopover
app={app}
settings={translationSettings}
selection={lookupSelection}
anchorRect={lookupSelection.anchorRect}
anchorRects={lookupSelection.anchorRects}
anchorPoint={lookupSelection.anchorPoint}
viewportEl={lookupViewportEl}
onClose={closeDictionaryLookup}
/>
{/if}
