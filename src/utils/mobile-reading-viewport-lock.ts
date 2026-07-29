import { domInstanceOf } from "./dom-instance-of";
import {
	type VisualViewportLayout,
	bindMobileFloatingViewport,
	getVisualViewportLayout,
} from "./mobile-floating-viewport";

export const READING_VIEWPORT_LOCK_CLASS = "epub-reading-viewport-locked";

const LOCKED_STYLE_KEYS = [
	"position",
	"top",
	"left",
	"right",
	"bottom",
	"width",
	"height",
	"maxHeight",
	"overflow",
	"boxSizing",
] as const;

function stylePropToCss(prop: typeof LOCKED_STYLE_KEYS[number]): string {
	return prop.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function captureStyleSnapshot(target: HTMLElement): Map<string, string> {
	const snapshot = new Map<string, string>();
	for (const prop of LOCKED_STYLE_KEYS) {
		snapshot.set(prop, target.style.getPropertyValue(stylePropToCss(prop)));
	}
	return snapshot;
}

function restoreStyleSnapshot(
	target: HTMLElement,
	snapshot: Map<string, string>,
) {
	for (const prop of LOCKED_STYLE_KEYS) {
		const cssProp = stylePropToCss(prop);
		const previous = snapshot.get(prop);
		if (previous) {
			target.style.setProperty(cssProp, previous);
		} else {
			target.style.removeProperty(cssProp);
		}
	}
}

function applyLayoutToTarget(
	target: HTMLElement,
	layout: VisualViewportLayout,
) {
	target.style.setProperty("--epub-reading-vp-top", `${layout.offsetTop}px`);
	target.style.setProperty("--epub-reading-vp-left", `${layout.offsetLeft}px`);
	target.style.setProperty("--epub-reading-vp-width", `${layout.width}px`);
	target.style.setProperty("--epub-reading-vp-height", `${layout.height}px`);
}

function stabilizeLayoutViewportScroll() {
	if (window.scrollY !== 0) {
		window.scrollTo(0, 0);
	}
}

/**
 * 解析应锁定的阅读器容器：优先 Obsidian leaf 的 view-content，其次插件 shell。
 */
export function resolveReadingViewportLockTarget(
	rootEl: HTMLElement | null | undefined,
): HTMLElement | null {
	if (!rootEl) {
		return null;
	}

	const leafContent = rootEl.closest(
		'.workspace-leaf-content[data-type="weave-epub-reader"], .workspace-leaf-content[data-type="weave-epub-ai-reader"]',
	);
	const viewContent = leafContent?.querySelector(":scope > .view-content");
	if (domInstanceOf(viewContent, HTMLElement)) {
		return viewContent;
	}

	const shell = rootEl.closest(".weave-epub-view-shell");
	return domInstanceOf(shell, HTMLElement) ? shell : null;
}

/**
 * 将阅读区域钉在当前 visual viewport 内，避免键盘弹出时正文被整体上推并露出空白占位。
 */
export function applyReadingViewportLock(target: HTMLElement): () => void {
	const snapshot = captureStyleSnapshot(target);
	let unbindViewport = () => {};

	target.classList.add(READING_VIEWPORT_LOCK_CLASS);

	const sync = () => {
		const layout = getVisualViewportLayout();
		applyLayoutToTarget(target, layout);
		stabilizeLayoutViewportScroll();
	};

	sync();
	unbindViewport = bindMobileFloatingViewport(sync);

	return () => {
		unbindViewport();
		target.classList.remove(READING_VIEWPORT_LOCK_CLASS);
		restoreStyleSnapshot(target, snapshot);
	};
}
