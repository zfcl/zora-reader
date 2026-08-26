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
	import { openObsidianVaultSearch } from '../../services/obsidian/obsidian-vault-search';
	import { extractSelectionContext, isDictionaryLookupCandidate } from '../../services/obsidian/selection-lookup-routing';
	import type { IntegratedAISettings } from '../../config/integrated-ai-settings';
	import type { ZoraSelectionTranslationInput } from '../../services/ai/zora/zora-translation-service';
	import SelectionDictionaryPopover from './SelectionDictionaryPopover.svelte';
	import SelectionComprehensionPopover from './SelectionComprehensionPopover.svelte';
	import SelectionGrammarPopover from './SelectionGrammarPopover.svelte';
	import SelectionNotePopover from './SelectionNotePopover.svelte';
	import { showNotification } from '../../utils/notifications';
	import { domInstanceOf } from '../../utils/dom-instance-of';
	import { logMobileEvent, logMobileError } from '../../utils/zora-mobile-logger';
	import {
		computeToolbarPosition,
		createEventBinder,
		getEventTargetNode,
		shouldDismissToolbarOnPointerDown,
		resolveMobileFloatingInsetBottom,
	} from './toolbar-positioning';
	import { expandRangeToSentence, expandRangeToParagraph } from './sentence-selection';
	import { extractWordRangeFromTextNode } from './mobile-tap-selection';
	import { getWorkspaceBounds } from '../../utils/mobile-modal-bounds';

	type ExternalSelectionState = {
		source?: string;
		text: string;
		cfiRange: string;
		rect: DOMRect;
		rects?: DOMRect[];
		range?: Range;
		frame?: ReaderFrame;
		frameDocument?: Document;
		initialWordRange?: Range;
		initialWordText?: string;
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
		onCustomSelectionExpand?: (newRange: Range, newText: string, newCfiRange: string) => void;
		onHighlight?: (text: string, cfiRange: string, color: string, style?: EpubHighlightStyle) => void | Promise<void>;
		onInsertToNote?: (text: string, cfiRange: string, color?: string, style?: EpubHighlightStyle) => void;
		onCopySelectionLink?: (
			action: 'protocolMarkdown' | 'vaultWikilink' | 'obsidianUri' | 'plainText',
			text: string,
			cfiRange: string
		) => void | Promise<void>;
		onCreateReadingPoint?: (text: string, cfiRange: string) => void;
		onOpenAIMenu?: (event: MouseEvent, text: string, cfiRange: string) => void;
		onRunAIAction?: (actionId: string, text: string, cfiRange: string) => void;
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
		onCustomSelectionExpand,
		onHighlight,
		onInsertToNote,
		onCopySelectionLink,
		onAutoInsert,
		onExtractToCard,
		onCreateReadingPoint,
		onOpenAIMenu,
		onRunAIAction,
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
	let pendingCollapsedHideTimer: ReturnType<typeof setTimeout> | null = null;
	let activeCustomRange: Range | null = null;
	let activeCustomGeometry: { rect: DOMRect; rects: DOMRect[]; anchorPoint?: ReaderAnchorPoint } | null = null;
	let activeInitialWordRange: Range | null = null;
	let activeInitialWordText: string | null = null;
	let activeGranularity = $state<'word' | 'sentence' | 'paragraph'>('word');
let lookupSelection: ZoraSelectionTranslationInput & { anchorRect: DOMRect; anchorRects: DOMRect[]; anchorPoint?: ReaderAnchorPoint } | null = $state(null);
let lookupViewportEl: HTMLElement | null = $state(null);
let activePopoverType = $state<'dict' | 'comprehension' | 'grammar' | 'note' | null>(null);

	const isMobileToolbar = Platform.isMobile || activeDocument.body.classList.contains('is-mobile');
	let mobileBottomClearance = $state(0);

	function updateMobileBottomClearance() {
		if (!isMobileToolbar) return;
		try {
			const bounds = getWorkspaceBounds();
			mobileBottomClearance = Math.max(0, bounds.bottom);
		} catch {
			mobileBottomClearance = 0;
		}
	}

	function clearPendingCollapsedHide() {
		if (pendingCollapsedHideTimer !== null) {
			clearTimeout(pendingCollapsedHideTimer);
			pendingCollapsedHideTimer = null;
		}
	}

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
		clearPendingCollapsedHide();
		dismissActiveToolbarMenu();
		clearPendingExternalSelectionHide();
		isVisible = false;
		isBelowSelection = false;
		toolbarMode = 'floating';
		arrowOffset = 0;
		selectedText = '';
		currentCfiRange = '';
		activeClearSelection = null;
		activeCustomRange = null;
		activeCustomGeometry = null;
		activeInitialWordRange = null;
		activeInitialWordText = null;
		activeGranularity = 'word';
		stopPositionTracking();
	}

	function clearAndHide() {
		clearPendingCollapsedHide();
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
		logger.logHighlightDebugToFile('ENTER: SelectionToolbar.handleHighlight', {
			bookId: book?.id,
			cfiRange: currentCfiRange,
			color,
			style
		});
		if (!book || !selectedText || !currentCfiRange) {
			clearAndHide();
			return;
		}

		try {
			const highlight = { cfiRange: currentCfiRange, color, style, text: selectedText };
			readerService.addHighlight(highlight);
		} catch (e) {
			logger.warn('[SelectionToolbar] Failed to apply highlight:', e);
		}

		try {
			await onHighlight?.(selectedText, currentCfiRange, color, style);
			logger.logHighlightDebugToFile('SUCCESS: SelectionToolbar.handleHighlight -> onHighlight completed', { cfiRange: currentCfiRange });
		} catch (err: any) {
			logger.logHighlightDebugToFile('ERROR: SelectionToolbar.handleHighlight -> onHighlight failed', { error: err?.message || err });
		}

		if (autoInsert) {
			onAutoInsert?.(selectedText, currentCfiRange, color, style);
		}
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

	function handleRunAIAction(actionId: string) {
		if (!selectedText || !currentCfiRange) return;
		if (onRunAIAction) {
			onRunAIAction(actionId, selectedText, currentCfiRange);
		}
		clearAndHide();
	}

	function prepareLookupSelection() {
		if (!selectedText || !currentCfiRange) return null;
		const viewportEl = getViewportContainer(activeFrame);
		if (!viewportEl) return null;

		let range: Range | null = activeCustomRange;
		let geometry: { rect: DOMRect; rects: DOMRect[]; anchorPoint?: ReaderAnchorPoint } | null = activeCustomGeometry;

		if (activeFrame) {
			const frameWindow = activeFrame.window || activeFrame.frameDocument?.defaultView;
			const frameDocument = frameWindow?.document;
			const liveSelection = frameDocument?.getSelection?.();
			if (liveSelection && liveSelection.rangeCount > 0 && !range) {
				range = liveSelection.getRangeAt(0).cloneRange();
			}
			if (!geometry && liveSelection && liveSelection.rangeCount > 0) {
				geometry = resolveSelectionGeometry(currentCfiRange, activeFrame, liveSelection);
			}
		}

		if (!geometry && currentCfiRange) {
			const navigationRect = readerService.getNavigationTargetRect({
				cfi: currentCfiRange,
				text: selectedText,
			});
			if (navigationRect) {
				geometry = { rect: navigationRect, rects: [navigationRect] };
			}
		}

		if (!geometry) return null;

		return {
			selection: {
				text: selectedText,
				cfiRange: currentCfiRange,
				chapter: readerService.getCurrentChapterTitle?.() || '',
				bookPath: book?.filePath || '',
				bookTitle: book?.metadata?.title || '',
				context: extractSelectionContext(iframeDoc, selectedText, 240, range),
				range,
				anchorRect: geometry.rect,
				anchorRects: geometry.rects,
				anchorPoint: geometry.anchorPoint,
			},
			viewportEl,
		};
	}

	function handleDictionaryLookup() {
		const prepared = prepareLookupSelection();
		if (!prepared || !translationSettings) return;
		lookupSelection = prepared.selection;
		lookupViewportEl = prepared.viewportEl;
		activePopoverType = 'dict';
		hideToolbar();
	}

	function handleComprehensionLookup() {
		const prepared = prepareLookupSelection();
		if (!prepared || !translationSettings) return;
		lookupSelection = prepared.selection;
		lookupViewportEl = prepared.viewportEl;
		activePopoverType = 'comprehension';
		hideToolbar();
	}

	function handleGrammarLookup() {
		const prepared = prepareLookupSelection();
		if (!prepared || !translationSettings) return;
		lookupSelection = prepared.selection;
		lookupViewportEl = prepared.viewportEl;
		activePopoverType = 'grammar';
		hideToolbar();
	}

	function handleNoteLookup() {
		const prepared = prepareLookupSelection();
		if (!prepared) return;
		lookupSelection = prepared.selection;
		lookupViewportEl = prepared.viewportEl;
		activePopoverType = 'note';
		hideToolbar();
	}

	function handleNoteSaved(info: { cfiRange: string; blockId: string; text: string; filePath: string }) {
		readerService?.addHighlight?.({
			cfiRange: info.cfiRange,
			color: 'purple',
			style: 'reading-note',
			text: info.text,
			excerptId: info.blockId,
			sourceFile: info.filePath,
			presentation: 'highlight',
		});
	}

	function closePopover() {
		lookupSelection = null;
		lookupViewportEl = null;
		activePopoverType = null;
		clearAndHide();
	}

	async function handleGranularityChange(granularity: 'word' | 'sentence' | 'paragraph') {
		const doc = iframeDoc || activeFrame?.frameDocument;
		if (!doc) return;

		let targetRange: Range | null = null;
		let targetText = '';

		if (granularity === 'word') {
			if (activeInitialWordRange && activeInitialWordText) {
				targetRange = activeInitialWordRange.cloneRange();
				targetText = activeInitialWordText;
			} else {
				let baseRange = activeCustomRange;
				if (!baseRange && activeFrame) {
					const frameWin = activeFrame.window || activeFrame.frameDocument?.defaultView;
					const live = frameWin?.getSelection?.();
					if (live && live.rangeCount > 0) baseRange = live.getRangeAt(0);
				}
				if (baseRange) {
					const node = baseRange.startContainer;
					const offset = baseRange.startOffset;
					if (domInstanceOf(node, Text)) {
						const wordRes = extractWordRangeFromTextNode(doc, node, offset);
						if (wordRes) {
							targetRange = wordRes.range;
							targetText = wordRes.text;
						}
					}
				}
			}
		} else if (granularity === 'sentence') {
			let baseRange = activeInitialWordRange || activeCustomRange;
			if (!baseRange && activeFrame) {
				const frameWin = activeFrame.window || activeFrame.frameDocument?.defaultView;
				const live = frameWin?.getSelection?.();
				if (live && live.rangeCount > 0) baseRange = live.getRangeAt(0);
			}
			if (baseRange) {
				const expanded = expandRangeToSentence(baseRange, doc);
				if (expanded) {
					targetRange = expanded.range;
					targetText = expanded.text;
				}
			}
		} else if (granularity === 'paragraph') {
			let baseRange = activeInitialWordRange || activeCustomRange;
			if (!baseRange && activeFrame) {
				const frameWin = activeFrame.window || activeFrame.frameDocument?.defaultView;
				const live = frameWin?.getSelection?.();
				if (live && live.rangeCount > 0) baseRange = live.getRangeAt(0);
			}
			if (baseRange) {
				const expanded = expandRangeToParagraph(baseRange, doc);
				if (expanded) {
					targetRange = expanded.range;
					targetText = expanded.text;
				}
			}
		}

		if (!targetRange || !targetText) return;

		activeGranularity = granularity;
		const frame = activeFrame || (readerService.getVisibleFrames ? readerService.getVisibleFrames()[0] : null);
		const newCfiRange = frame?.cfiFromRange ? frame.cfiFromRange(targetRange) : currentCfiRange;
		if (!newCfiRange) return;

		selectedText = targetText;
		currentCfiRange = newCfiRange;
		activeCustomRange = targetRange;
		lookupSelection = null;
		lookupViewportEl = null;

		if (onCustomSelectionExpand) {
			onCustomSelectionExpand(targetRange, targetText, newCfiRange);
		}

		const iframe = activeFrame ? getFrameElement(activeFrame) : null;
		const iframeRect = iframe?.getBoundingClientRect() || { left: 0, top: 0 };
		const bRect = typeof targetRange.getBoundingClientRect === 'function'
			? targetRange.getBoundingClientRect()
			: new DOMRect(0, 0, 0, 0);
		const rawRects = typeof targetRange.getClientRects === 'function'
			? Array.from(targetRange.getClientRects())
			: [];
		const geometry = {
			rect: new DOMRect(bRect.left + iframeRect.left, bRect.top + iframeRect.top, bRect.width, bRect.height),
			rects: rawRects.map((r) => new DOMRect(r.left + iframeRect.left, r.top + iframeRect.top, r.width, r.height)),
		};
		activeCustomGeometry = geometry;

		const viewportEl = getViewportContainer(activeFrame);
		if (geometry && viewportEl) {
			await positionToolbar(geometry.rect, viewportEl, geometry.rects, geometry.anchorPoint);
		}

		logMobileEvent("Selection", "GranularityChanged", {
			granularity,
			originalLength: selectedText?.length,
			newLength: targetText.length,
			cfiRange: newCfiRange,
		});
	}

	async function handleExpandSentenceSelection() {
		await handleGranularityChange('sentence');
	}

	function handleVaultSearch() {
		if (!selectedText) return;
		if (!openObsidianVaultSearch(app, selectedText)) {
			showNotification(t('epub.selectionToolbar.vaultSearchUnavailable'), 'warning');
		}
		clearAndHide();
	}

	function handleOpenMoreMenu(event: MouseEvent) {
		event.stopPropagation();
		const text = selectedText.trim();
		if (!text) {
			return;
		}

		dismissActiveToolbarMenu();
		const menu = new Menu();
		activeToolbarMenu = menu;

		if (onCopySelectionLink && (canUseExcerptNotes || canPreviewLockedExcerptFeature())) {
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
			if (isMobileToolbar) {
				return;
			}
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
		updateMobileBottomClearance();
		isVisible = true;
		await tick();

		if (isMobileToolbar) {
			toolbarMode = 'docked';
			posTop = 0;
			posLeft = 0;
			isBelowSelection = false;
			arrowOffset = 0;
			return;
		}

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
			insetBottom: 0,
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
		binder.bind(iframeDocument, 'selectionchange', scheduleActiveSync);
		if (!isMobileToolbar) {
			binder.bind(iframeDocument, 'mousedown', handlePointerDownOutside, { capture: true });
			binder.bind(activeDocument, 'mousedown', handlePointerDownOutside, { capture: true });
		}
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
				if (isMobileToolbar) {
					clearPendingCollapsedHide();
					pendingCollapsedHideTimer = setTimeout(() => {
						pendingCollapsedHideTimer = null;
						const currentSelection = iframeWindow.getSelection();
						if (!currentSelection || currentSelection.isCollapsed || currentSelection.rangeCount === 0) {
							hideToolbar();
							logMobileEvent("Selection", "ToolbarHiddenCollapsed", {
								rangeCount: currentSelection?.rangeCount ?? 0,
								isCollapsed: currentSelection?.isCollapsed ?? true,
							});
						}
					}, 200);
					return;
				}
				hideToolbar();
				return;
			}
			clearPendingCollapsedHide();

			const text = selection.toString().trim();
			if (!text) {
				if (isMobileToolbar) {
					clearPendingCollapsedHide();
					pendingCollapsedHideTimer = setTimeout(() => {
						pendingCollapsedHideTimer = null;
						const currentSelection = iframeWindow.getSelection();
						if (!currentSelection || currentSelection.isCollapsed || currentSelection.rangeCount === 0 || !currentSelection.toString().trim()) {
							hideToolbar();
						}
					}, 200);
					return;
				}
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
			// 新选区立即替换旧词义 Popover，避免旧请求晚返回覆盖新选区。
			lookupSelection = null;
			lookupViewportEl = null;

			const geometry = resolveSelectionGeometry(resolvedCfiRange, frame, selection);
			if (!geometry) {
				if (!repositionOnly) {
					hideToolbar();
				}
				return;
			}

			startPositionTracking(frame);
			await positionToolbar(geometry.rect, viewportEl, geometry.rects, geometry.anchorPoint);
			logMobileEvent("Selection", "TextSelected", {
				length: text?.length,
				snippet: text ? text.slice(0, 30) : "",
				cfiRange: resolvedCfiRange,
				rangeCount: selection.rangeCount,
				isCollapsed: selection.isCollapsed,
			});
		} catch (e) {
			logger.warn('[SelectionToolbar] Failed to sync selection:', e);
			logMobileError("Selection", e);
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
			if (selection.frame) {
				activeFrame = selection.frame;
			}
			if (selection.frameDocument) {
				iframeDoc = selection.frameDocument;
			}
			activeCustomRange = selection.range || null;
			activeCustomGeometry = {
				rect: selection.rect,
				rects: selection.rects || [selection.rect],
			};
			if (selection.initialWordRange) {
				activeInitialWordRange = selection.initialWordRange;
				activeInitialWordText = selection.initialWordText || selection.text;
			} else {
				activeInitialWordRange = selection.range ? selection.range.cloneRange() : null;
				activeInitialWordText = selection.text;
			}
			activeGranularity = 'word';
			stopPositionTracking();
		});
		void positionToolbar(selection.rect, viewportEl, selection.rects || [selection.rect]);
	});

	onMount(() => {
		if (!isMobileToolbar) {
			activeDocument.addEventListener('mousedown', handlePointerDownOutside, { capture: true });
		}
		return () => {
			if (!isMobileToolbar) {
				activeDocument.removeEventListener('mousedown', handlePointerDownOutside, { capture: true });
			}
			teardownReaderTracking?.();
			teardownReaderTracking = null;
			stopPositionTracking();
			clearPendingSync();
			clearPendingExternalSelectionHide();
			clearPendingCollapsedHide();
		};
	});
</script>

<div
	class="epub-selection-toolbar epub-glass-panel"
	class:visible={isVisible}
	class:below-selection={isBelowSelection}
	class:mobile-docked={toolbarMode === 'docked'}
	style={`top: ${toolbarMode === 'docked' ? 'auto' : posTop + 'px'}; left: ${toolbarMode === 'docked' ? 'auto' : posLeft + 'px'}; --toolbar-arrow-offset: ${arrowOffset}px; --toolbar-bottom-offset: ${Math.max(0, mobileDockBottomOffset)}px; --epub-mobile-bottom-clearance: ${mobileBottomClearance}px;`}
	ontouchstart={(e) => e.stopPropagation()}
	ontouchmove={(e) => e.stopPropagation()}
	ontouchend={(e) => e.stopPropagation()}
	onpointerdown={(e) => e.stopPropagation()}
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

				<div class="row-divider"></div>

				<div class="toolbar-row selection-style-row">
					<button class="clickable-icon action-item icon-only style-action-item" onclick={() => handleHighlight('yellow', 'underline')} title={t('epub.selectionToolbar.underline')} aria-label={t('epub.selectionToolbar.underline')}>
						<span class="action-icon style-icon underline-style-icon" use:icon={'underline'}></span>
					</button>
					<button class="clickable-icon action-item icon-only style-action-item" onclick={() => handleHighlight('yellow', 'strikethrough')} title={t('epub.selectionToolbar.strikethrough')} aria-label={t('epub.selectionToolbar.strikethrough')}>
						<span class="action-icon style-icon strikethrough-style-icon" use:icon={'strikethrough'}></span>
					</button>
					<button class="clickable-icon action-item icon-only style-action-item" onclick={() => handleHighlight('yellow', 'wavy')} title={t('epub.selectionToolbar.wavy')} aria-label={t('epub.selectionToolbar.wavy')}>
						<span class="action-icon style-icon wavy-style-icon">
							<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon">
								<path d="M6 4v6a6 6 0 0 0 12 0V4" />
								<path d="M4 20c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0" />
							</svg>
						</span>
					</button>
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

				{#if isMobileToolbar}
					<button class="clickable-icon action-item granularity-action" class:active={activeGranularity === 'word'} onclick={() => handleGranularityChange('word')} title="选取当前单词" aria-label="词">
						<span class="action-label">词</span>
					</button>
					<button class="clickable-icon action-item granularity-action" class:active={activeGranularity === 'sentence'} onclick={() => handleGranularityChange('sentence')} title="扩展至当前完整句" aria-label="句">
						<span class="action-label">句</span>
					</button>
					<button class="clickable-icon action-item granularity-action" class:active={activeGranularity === 'paragraph'} onclick={() => handleGranularityChange('paragraph')} title="扩展至当前段落" aria-label="段">
						<span class="action-label">段</span>
					</button>
				{/if}

				{#if translationSettings?.enabled !== false}
					<button class="clickable-icon action-item accent" onclick={handleDictionaryLookup} title={isDictionaryLookupCandidate(selectedText) ? '词义' : '翻译'} aria-label={isDictionaryLookupCandidate(selectedText) ? '词义' : '翻译'}>
						<span class="action-icon" use:icon={isDictionaryLookupCandidate(selectedText) ? 'book-open' : 'languages'}></span>
						<span class="action-label">{isDictionaryLookupCandidate(selectedText) ? '词义' : '翻译'}</span>
					</button>
				{/if}

				{#if translationSettings?.enabled !== false}
					<button class="clickable-icon action-item ai" onclick={handleComprehensionLookup} title="简易理解" aria-label="理解">
						<span class="action-icon" use:icon={'sparkles'}></span>
						<span class="action-label">理解</span>
					</button>
				{/if}

				{#if translationSettings?.enabled !== false}
					<button class="clickable-icon action-item ai" onclick={handleGrammarLookup} title="英语语法解析" aria-label="语法">
						<span class="action-icon" use:icon={'braces'}></span>
						<span class="action-label">语法</span>
					</button>
				{/if}

				<button class="clickable-icon action-item note-action" onclick={handleNoteLookup} title="添加笔记" aria-label="笔记">
					<span class="action-icon" use:icon={'pen-tool'}></span>
					<span class="action-label">笔记</span>
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

{#if lookupSelection && lookupViewportEl}
	{#if activePopoverType === 'dict' && translationSettings}
		<SelectionDictionaryPopover
			{app}
			settings={translationSettings}
			selection={lookupSelection}
			anchorRect={lookupSelection.anchorRect}
			anchorRects={lookupSelection.anchorRects}
			anchorPoint={lookupSelection.anchorPoint}
			viewportEl={lookupViewportEl}
			onClose={closePopover}
		/>
	{:else if activePopoverType === 'comprehension' && translationSettings}
		<SelectionComprehensionPopover
			{app}
			settings={translationSettings}
			selection={lookupSelection}
			anchorRect={lookupSelection.anchorRect}
			anchorRects={lookupSelection.anchorRects}
			anchorPoint={lookupSelection.anchorPoint}
			viewportEl={lookupViewportEl}
			onClose={closePopover}
		/>
	{:else if activePopoverType === 'grammar' && translationSettings}
		<SelectionGrammarPopover
			{app}
			settings={translationSettings}
			selection={lookupSelection}
			anchorRect={lookupSelection.anchorRect}
			anchorRects={lookupSelection.anchorRects}
			anchorPoint={lookupSelection.anchorPoint}
			viewportEl={lookupViewportEl}
			onClose={closePopover}
		/>
	{:else if activePopoverType === 'note'}
		<SelectionNotePopover
			{app}
			selection={lookupSelection}
			anchorRect={lookupSelection.anchorRect}
			anchorRects={lookupSelection.anchorRects}
			anchorPoint={lookupSelection.anchorPoint}
			viewportEl={lookupViewportEl}
			onSaved={handleNoteSaved}
			onClose={closePopover}
		/>
	{/if}
{/if}
