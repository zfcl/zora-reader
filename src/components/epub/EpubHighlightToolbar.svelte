<script lang="ts">
	import { setIcon, Platform } from 'obsidian';
	import { tick, untrack } from 'svelte';
	import { PREMIUM_FEATURES } from '../../services/premium/PremiumFeatureGuard';
	import { tr } from '../../utils/i18n';
	import type { EpubReaderEngine, HighlightClickInfo } from '../../services/epub';
	import {
		computeToolbarPosition,
		computeMobilePopoverCenterPosition,
		createEventBinder,
		isEventOutsideToolbar,
		resolveMobileFloatingInsetBottom,
	} from './toolbar-positioning';

	interface Props {
		info: HighlightClickInfo | null;
		readerService: EpubReaderEngine;
		mobileDockBottomOffset?: number;
		canUseStyledExcerpts?: boolean;
		canUseSourceLocation?: boolean;
		showPremiumFeaturePreviewEnabled?: boolean;
		onRequestPremiumFeaturePreview?: (featureId: string) => void;
		onDelete: (info: HighlightClickInfo) => void;
		onTemporarilyReveal: (info: HighlightClickInfo) => void;
		onChangeColor: (info: HighlightClickInfo, newColor: string) => void;
		onChangeStyle: (info: HighlightClickInfo, newStyle?: HighlightClickInfo['style']) => void;
		onEditComment: (info: HighlightClickInfo) => void;
		onBacklink: (info: HighlightClickInfo) => void | Promise<void>;
		onExtractToCard: (info: HighlightClickInfo) => void;
		onCopyText: (info: HighlightClickInfo) => void;
		onDismiss: () => void;
	}

	let {
		info,
		readerService,
		mobileDockBottomOffset = 0,
		canUseStyledExcerpts = true,
		canUseSourceLocation = true,
		showPremiumFeaturePreviewEnabled = false,
		onRequestPremiumFeaturePreview,
		onDelete,
		onTemporarilyReveal,
		onChangeColor,
		onChangeStyle,
		onEditComment,
		onBacklink,
		onExtractToCard,
		onCopyText,
		onDismiss
	}: Props = $props();
	let t = $derived($tr);

	let toolbarEl: HTMLDivElement | undefined = $state(undefined);
	let posTop = $state(0);
	let posLeft = $state(0);
	let isBelowTarget = $state(false);
	let toolbarMode = $state<'floating' | 'docked' | 'centered'>('floating');
	let arrowOffset = $state(0);
	let teardownOutsidePointerTracking: (() => void) | null = null;
	let teardownViewportTracking: (() => void) | null = null;

	const colors = ['yellow', 'blue', 'red', 'purple', 'green'] as const;
	let colorLabels = $derived.by<Record<(typeof colors)[number], string>>(() => ({
		yellow: t('epub.highlightToolbar.yellow'),
		blue: t('epub.highlightToolbar.blue'),
		red: t('epub.highlightToolbar.red'),
		purple: t('epub.highlightToolbar.purple'),
		green: t('epub.highlightToolbar.green')
	}));
	const isMobileToolbar = Platform.isMobile
		|| activeDocument.body.classList.contains('is-mobile')
		|| activeDocument.body.classList.contains('is-phone');

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

	function stopReaderGesture(node: HTMLElement) {
		const stopPropagation = (event: Event) => event.stopPropagation();
		const eventNames = [
			'click',
			'mousedown',
			'mouseup',
			'pointerdown',
			'pointerup',
			'touchstart',
			'touchmove',
			'touchend',
		] as const;
		for (const eventName of eventNames) {
			node.addEventListener(eventName, stopPropagation);
		}
		return {
			destroy() {
				for (const eventName of eventNames) {
					node.removeEventListener(eventName, stopPropagation);
				}
			},
		};
	}

	function backlinkAction(node: HTMLElement, initialInfo: HighlightClickInfo) {
		let currentInfo = initialInfo;
		const handleClick = (event: MouseEvent) => {
			void handleBacklinkAction(event, currentInfo);
		};
		node.addEventListener('click', handleClick);
		return {
			update(nextInfo: HighlightClickInfo) {
				currentInfo = nextInfo;
			},
			destroy() {
				node.removeEventListener('click', handleClick);
			},
		};
	}

	function stopOutsidePointerTracking() {
		teardownOutsidePointerTracking?.();
		teardownOutsidePointerTracking = null;
	}

	function startOutsidePointerTracking() {
		if (!info || !toolbarEl || teardownOutsidePointerTracking) return;

		const binder = createEventBinder();
		const eventTargets = new Set<EventTarget>([document]);
		for (const frame of readerService.getVisibleFrames()) {
			if (frame?.frameDocument) {
				eventTargets.add(frame.frameDocument);
			}
		}

		for (const target of eventTargets) {
			binder.bind(target, 'mousedown', handleClickOutside);
			binder.bind(target, 'touchstart', handleClickOutside, { passive: true });
		}

		teardownOutsidePointerTracking = () => {
			binder.dispose();
		};
	}

	function stopViewportTracking() {
		teardownViewportTracking?.();
		teardownViewportTracking = null;
	}

	function startViewportTracking() {
		if (!toolbarEl || teardownViewportTracking) return;

		const viewportEl = toolbarEl.closest('.epub-reader-viewport') as HTMLElement | null;
		const scrollHost = toolbarEl.closest('.epub-reader-viewport')?.querySelector('.epub-content-wrapper') as HTMLElement | null;
		const visualViewport = window.visualViewport;
		const dismiss = () => onDismiss();
		const binder = createEventBinder();

		binder.bind(scrollHost, 'scroll', dismiss, { passive: true });
		binder.bind(viewportEl, 'scroll', dismiss, { passive: true });
		binder.bind(window, 'resize', dismiss);
		binder.bind(window, 'orientationchange', dismiss);
		binder.bind(visualViewport, 'resize', dismiss);
		binder.bind(visualViewport, 'scroll', dismiss);

		teardownViewportTracking = () => {
			binder.dispose();
		};
	}

	async function positionToolbar() {
		const currentInfo = info;
		if (!currentInfo) {
			stopOutsidePointerTracking();
			stopViewportTracking();
			toolbarMode = 'floating';
			arrowOffset = 0;
			return;
		}

		await tick();
		if (!toolbarEl || info !== currentInfo) return;

		startOutsidePointerTracking();

		const viewportEl = toolbarEl.closest('.epub-reader-viewport') as HTMLElement | null;
		if (!viewportEl) return;

		startViewportTracking();
		const shouldCenterNoteActions = isMobileToolbar && Boolean(
			currentInfo.style === 'reading-note' || currentInfo.sourceLocators?.length
		);
		if (shouldCenterNoteActions) {
			toolbarMode = 'centered';
			await tick();
			if (!toolbarEl || info !== currentInfo) return;
			const centered = computeMobilePopoverCenterPosition(
				toolbarEl.offsetWidth || 296,
				toolbarEl.offsetHeight || 78,
				viewportEl
			);
			posTop = centered.top;
			posLeft = centered.left;
			isBelowTarget = false;
			arrowOffset = 0;
			return;
		}

		const containerRect = viewportEl.getBoundingClientRect();
		const toRelativeRect = (rect: HighlightClickInfo['rect']) => ({
			top: rect.top - containerRect.top,
			left: rect.left - containerRect.left,
			bottom: rect.bottom - containerRect.top,
			right: rect.right - containerRect.left,
			width: rect.width,
			height: rect.height,
		});
		const position = computeToolbarPosition({
			anchorRect: toRelativeRect(currentInfo.rect),
			anchorRects: (currentInfo.rects || []).map((rect) => toRelativeRect(rect)),
			anchorPoint: currentInfo.anchorPoint
				? {
					x: currentInfo.anchorPoint.x - containerRect.left,
					y: currentInfo.anchorPoint.y - containerRect.top,
				}
				: undefined,
			containerWidth: viewportEl.clientWidth,
			containerHeight: viewportEl.clientHeight,
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
		isBelowTarget = position.isBelowAnchor;
		arrowOffset = position.arrowOffset;
	}

	function handleClickOutside(e: Event) {
		if (info && isEventOutsideToolbar(toolbarEl, e)) {
			onDismiss();
		}
	}

	function handleStyleToggle(targetInfo: HighlightClickInfo, nextStyle: HighlightClickInfo['style']) {
		if (!canUseStyledExcerpts) {
			if (showPremiumFeaturePreviewEnabled) {
				onRequestPremiumFeaturePreview?.(PREMIUM_FEATURES.EPUB_STYLED_EXCERPTS);
				onDismiss();
			}
			return;
		}
		onChangeStyle(targetInfo, targetInfo.style === nextStyle ? undefined : nextStyle);
	}

	async function handleBacklinkAction(event: Event, targetInfo: HighlightClickInfo) {
		event.preventDefault();
		event.stopPropagation();
		if (!canUseSourceLocation) {
			if (showPremiumFeaturePreviewEnabled) {
				onRequestPremiumFeaturePreview?.(PREMIUM_FEATURES.EPUB_SOURCE_LOCATION);
				onDismiss();
			}
			return;
		}
		await onBacklink(targetInfo);
	}

	$effect(() => {
		const currentInfo = info;
		const currentReaderService = readerService;

		void currentReaderService;

		// Avoid tracking local teardown/positioning mutations as effect
		// dependencies, which can otherwise spiral into Svelte update loops.
		untrack(() => {
			stopOutsidePointerTracking();
		});

		if (currentInfo) {
			void positionToolbar();
		} else {
			untrack(() => {
				stopViewportTracking();
				toolbarMode = 'floating';
				arrowOffset = 0;
			});
		}

		return () => {
			untrack(() => {
				stopOutsidePointerTracking();
				stopViewportTracking();
			});
		};
	});
</script>

<div
	class="epub-highlight-toolbar epub-glass-panel"
	class:visible={info !== null}
	class:below-target={isBelowTarget}
	class:mobile-docked={toolbarMode === 'docked'}
	class:mobile-centered={toolbarMode === 'centered'}
	style={`top: ${posTop}px; left: ${posLeft}px; --toolbar-arrow-offset: ${arrowOffset}px;`}
	use:stopReaderGesture
	bind:this={toolbarEl}
>
	{#if info}
		{#if info.presentation === 'conceal'}
			<div class="highlight-main-row">
				<div class="toolbar-row actions-row highlight-actions-row concealment-actions">
					<button class="clickable-icon action-item" onclick={() => onTemporarilyReveal(info)} title={t('epub.highlightToolbar.temporaryRevealTitle')}>
						<span class="action-icon" use:icon={'eye'}></span>
						<span class="action-label">{t('epub.highlightToolbar.temporaryReveal')}</span>
					</button>
					<button class="clickable-icon action-item" onclick={() => onCopyText(info)} title={t('epub.highlightToolbar.copyHiddenTitle')}>
						<span class="action-icon" use:icon={'clipboard-copy'}></span>
						<span class="action-label">{t('epub.highlightToolbar.copy')}</span>
					</button>
					<button class="clickable-icon action-item accent concealment-reset" onclick={() => onDelete(info)} title={t('epub.highlightToolbar.resetHiddenTitle')}>
						<span class="action-icon" use:icon={'eye'}></span>
						<span class="action-label">{t('epub.highlightToolbar.resetHidden')}</span>
					</button>
				</div>
			</div>
		{:else if info.sourceLocators?.length || info.style === 'reading-note'}
			<div class="highlight-main-row">
				<div class="toolbar-row actions-row highlight-actions-row">
					<button class="clickable-icon action-item backlink-action" use:backlinkAction={info} title="打开笔记">
						<span class="action-icon" use:icon={'external-link'}></span>
						<span class="action-label">打开笔记</span>
					</button>
					<button class="clickable-icon action-item backlink-action" use:backlinkAction={info} title="编辑笔记">
						<span class="action-icon" use:icon={'edit'}></span>
						<span class="action-label">编辑笔记</span>
					</button>
					<button class="clickable-icon action-item delete delete-action" onclick={() => onDelete(info)} title="删除笔记">
						<span class="action-icon" use:icon={'trash-2'}></span>
						<span class="action-label">删除笔记</span>
					</button>
					<div class="row-divider"></div>
					<button class="clickable-icon action-item copy-action" onclick={() => onCopyText(info)} title={t('epub.highlightToolbar.copyTitle')}>
						<span class="action-icon" use:icon={'clipboard-copy'}></span>
						<span class="action-label">{t('epub.highlightToolbar.copy')}</span>
					</button>
				</div>
			</div>
		{:else}
			<div class="highlight-main-row">
				<div class="highlight-top-row">
					<div class="toolbar-row colors-row highlight-color-row highlight-primary-row">
						{#each colors as c}
							<button
								class="color-btn {c}"
								class:active={c === info.color}
								onclick={() => onChangeColor(info, c)}
								title={t('epub.highlightToolbar.switchColor', { color: colorLabels[c] })}
								aria-label={t('epub.highlightToolbar.switchColorAria', { color: colorLabels[c] })}
							>
								<span class="color-btn-core"></span>
							</button>
						{/each}
					</div>

					<div class="row-divider"></div>

					<div class="toolbar-row highlight-style-row">
						<button class="clickable-icon action-item icon-only style-action-item" class:accent={info.style === 'underline'} onclick={() => handleStyleToggle(info, 'underline')} title={t('epub.highlightToolbar.underline')} aria-label={t('epub.highlightToolbar.underline')}>
							<span class="action-icon style-icon underline-style-icon" use:icon={'underline'}></span>
						</button>
						<button class="clickable-icon action-item icon-only style-action-item" class:accent={info.style === 'strikethrough'} onclick={() => handleStyleToggle(info, 'strikethrough')} title={t('epub.highlightToolbar.strikethrough')} aria-label={t('epub.highlightToolbar.strikethrough')}>
							<span class="action-icon style-icon strikethrough-style-icon" use:icon={'strikethrough'}></span>
						</button>
						<button class="clickable-icon action-item icon-only style-action-item" class:accent={info.style === 'wavy'} onclick={() => handleStyleToggle(info, 'wavy')} title={t('epub.highlightToolbar.wavy')} aria-label={t('epub.highlightToolbar.wavy')}>
							<span class="action-icon style-icon wavy-style-icon">
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon">
									<path d="M6 4v6a6 6 0 0 0 12 0V4" />
									<path d="M4 20c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0" />
								</svg>
							</span>
						</button>
					</div>
				</div>

				<div class="toolbar-row actions-row highlight-actions-row">
					<button class="clickable-icon action-item copy-action" onclick={() => onCopyText(info)} title={t('epub.highlightToolbar.copyTitle')}>
						<span class="action-icon" use:icon={'clipboard-copy'}></span>
						<span class="action-label">{t('epub.highlightToolbar.copy')}</span>
					</button>
					<div class="row-divider"></div>
					<button class="clickable-icon action-item delete delete-action" onclick={() => onDelete(info)} title={t('epub.highlightToolbar.deleteTitle')}>
						<span class="action-icon" use:icon={'trash-2'}></span>
						<span class="action-label">{t('epub.highlightToolbar.delete')}</span>
					</button>
				</div>
			</div>
		{/if}
	{/if}

	<div class="toolbar-arrow"></div>
</div>
