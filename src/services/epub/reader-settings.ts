import type { EpubFlowMode, EpubLayoutMode, EpubReaderSettings, EpubTopStickerLayout, EpubWidthMode } from "./types";

export type EpubReaderSettingsDeviceKind = "desktop" | "mobile";

export const DEFAULT_READER_SETTINGS: EpubReaderSettings = {
	lineHeight: 1.72,
	letterSpacing: 0,
	pageMargin: 48,
	viewportSidePadding: 24,
	theme: "default",
	widthMode: "standard",
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

export const DEFAULT_MOBILE_READER_SETTINGS: EpubReaderSettings = {
	...DEFAULT_READER_SETTINGS,
	lineHeight: 1.66,
	pageMargin: 24,
	viewportSidePadding: 18,
	widthMode: "full",
	flowMode: "paginated",
	layoutMode: "paginated",
};

export function getDefaultEpubReaderSettings(
	deviceKind: EpubReaderSettingsDeviceKind
): EpubReaderSettings {
	return deviceKind === "mobile"
		? { ...DEFAULT_MOBILE_READER_SETTINGS }
		: { ...DEFAULT_READER_SETTINGS };
}

export function normalizeEpubReaderSettingsForDevice(
	deviceKind: EpubReaderSettingsDeviceKind,
	settings: Partial<EpubReaderSettings>
): EpubReaderSettings {
	const defaults = getDefaultEpubReaderSettings(deviceKind);
	const normalized: EpubReaderSettings = {
		lineHeight:
			typeof settings.lineHeight === "number" && settings.lineHeight > 0
				? settings.lineHeight
				: defaults.lineHeight,
		letterSpacing:
			typeof settings.letterSpacing === "number" && Number.isFinite(settings.letterSpacing)
				? clamp(settings.letterSpacing, -0.02, 0.24)
				: defaults.letterSpacing,
		pageMargin:
			typeof settings.pageMargin === "number" && Number.isFinite(settings.pageMargin)
				? clamp(settings.pageMargin, 8, 96)
				: defaults.pageMargin,
		viewportSidePadding:
			typeof settings.viewportSidePadding === "number" &&
			Number.isFinite(settings.viewportSidePadding)
				? clamp(settings.viewportSidePadding, 0, 72)
				: defaults.viewportSidePadding,
		theme: defaults.theme,
		widthMode: normalizeWidthMode(settings.widthMode, defaults.widthMode),
		layoutMode: normalizeLayoutMode(settings.layoutMode, defaults.layoutMode),
		flowMode: normalizeFlowMode(settings.flowMode, defaults.flowMode),
		showScrolledSideNav:
			typeof settings.showScrolledSideNav === "boolean"
				? settings.showScrolledSideNav
				: defaults.showScrolledSideNav,
		footnoteClickAction:
			settings.footnoteClickAction === "navigate" || settings.footnoteClickAction === "preview"
				? settings.footnoteClickAction
				: defaults.footnoteClickAction,
		showTopSticker:
			typeof settings.showTopSticker === "boolean"
				? settings.showTopSticker
				: defaults.showTopSticker,
		topStickerLayout: normalizeTopStickerLayout(settings.topStickerLayout, defaults.topStickerLayout),
		paragraphModeEnabled:
			typeof settings.paragraphModeEnabled === "boolean"
				? settings.paragraphModeEnabled
				: defaults.paragraphModeEnabled,
		paragraphModeFontSize:
			settings.paragraphModeFontSize === "small" || settings.paragraphModeFontSize === "large"
				? settings.paragraphModeFontSize
				: "medium",
		paragraphModeFontScale:
			typeof settings.paragraphModeFontScale === "number" && Number.isFinite(settings.paragraphModeFontScale)
				? clamp(settings.paragraphModeFontScale, 85, 135)
				: defaults.paragraphModeFontScale,
		paragraphModeSurfaceStyle:
			settings.paragraphModeSurfaceStyle === "blend" || settings.paragraphModeSurfaceStyle === "dashed"
				? settings.paragraphModeSurfaceStyle
				: "spotlight",
		paragraphModeTransitionStyle: normalizeParagraphModeTransitionStyle(
			settings.paragraphModeTransitionStyle,
			defaults.paragraphModeTransitionStyle
		),
	};

	if (deviceKind === "mobile") {
		normalized.flowMode = "paginated";
		normalized.layoutMode = "paginated";
	}

	if (normalized.flowMode === "scrolled") {
		normalized.layoutMode = "paginated";
	}

	if (normalized.layoutMode === "double") {
		normalized.widthMode = "fit";
	}

	return normalized;
}

function normalizeWidthMode(value: unknown, fallback: EpubWidthMode): EpubWidthMode {
	if (value === "container") {
		return "fit";
	}
	return value === "standard" || value === "full" || value === "fit" || value === "edge"
		? value
		: fallback;
}

function normalizeTopStickerLayout(value: unknown, fallback: EpubTopStickerLayout): EpubTopStickerLayout {
	return value === "auto" || value === "inline" || value === "sidebar" ? value : fallback;
}

function normalizeLayoutMode(value: unknown, fallback: EpubLayoutMode): EpubLayoutMode {
	return value === "double" || value === "paginated" ? value : fallback;
}

function normalizeFlowMode(value: unknown, fallback: EpubFlowMode): EpubFlowMode {
	return value === "scrolled" || value === "paginated" ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function normalizeParagraphModeTransitionStyle(
	value: unknown,
	fallback: EpubReaderSettings["paragraphModeTransitionStyle"]
): EpubReaderSettings["paragraphModeTransitionStyle"] {
	return value === "steady"
		|| value === "fade"
		|| value === "settle"
		|| value === "slide"
		? value
		: fallback;
}
