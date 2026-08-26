import type { EpubWidthMode } from "./types";
import {
	READER_HIGHLIGHT_BLEND_MODE_MAP,
	READER_HIGHLIGHT_OPACITY_MAP,
	readConcealmentPalette,
	readObsidianColorScheme,
	readObsidianCssVar,
	readObsidianFontStack,
	readObsidianMonospaceFontStack,
	readObsidianTextFontSize,
	type ReaderColorScheme,
} from "./reader-theme-tokens";

export interface ReaderChapterStylesInput {
	styleSource: HTMLElement;
	currentLineHeight: number;
	currentLetterSpacing: number;
	currentPageMargin: number;
	colorScheme?: ReaderColorScheme;
	isMobile?: boolean;
}

export function buildReaderChapterStyles(input: ReaderChapterStylesInput): string {
	const colorScheme = input.colorScheme ?? readObsidianColorScheme();
	const background = readObsidianCssVar(input.styleSource, "--background-primary", "rgb(255, 255, 255)");
	const textColor = readObsidianCssVar(input.styleSource, "--text-normal", "rgb(28, 29, 31)");
	const linkColor = readObsidianCssVar(input.styleSource, "--link-color", "rgb(80, 110, 214)");
	const selectionBackground = readObsidianCssVar(
		input.styleSource,
		"--text-selection",
		"rgba(120, 140, 255, 0.32)"
	);
	const selectionTextColor = readObsidianCssVar(input.styleSource, "--text-on-accent", textColor);
	const fontFamily = readObsidianFontStack(input.styleSource);
	const monospaceFontFamily = readObsidianMonospaceFontStack(input.styleSource);
	const fontSize = readObsidianTextFontSize(input.styleSource);
	const concealment = readConcealmentPalette(colorScheme);
	const highlightOpacity = READER_HIGHLIGHT_OPACITY_MAP[colorScheme];
	const highlightBlendMode = READER_HIGHLIGHT_BLEND_MODE_MAP[colorScheme];
	const letterSpacing = `${input.currentLetterSpacing.toFixed(3)}em`;
	const horizontalPageMargin = `${
		input.currentWidthMode === "edge" ? 0 : Math.max(0, Math.round(input.currentPageMargin))
	}px`;
	const darkModeTextSelectors =
		"article, section, main, aside, header, footer, nav, p, div, span, li, dd, dt, blockquote, figcaption, td, th, caption, label, legend, h1, h2, h3, h4, h5, h6, em, strong, i, b, u, small, sub, sup, mark";
	const darkModeOverrides =
		colorScheme === "dark"
			? `
html[data-weave-host-scheme="dark"] body :is(${darkModeTextSelectors}) {
	color: ${textColor} !important;
	-webkit-text-fill-color: currentColor !important;
	background-color: transparent !important;
}
html[data-weave-host-scheme="dark"] body :is(table, thead, tbody, tfoot, tr) {
	background-color: transparent !important;
}`
			: "";

	const isMobile =
		input.isMobile ??
		(Boolean(input.styleSource?.ownerDocument?.body?.classList.contains("is-mobile")) ||
			Boolean(input.styleSource?.ownerDocument?.body?.classList.contains("is-phone")) ||
			(typeof document !== "undefined" &&
				(document.body.classList.contains("is-mobile") ||
					document.body.classList.contains("is-phone"))));

	const mobileSelectionDisablingRules = isMobile
		? `
html, body, body * {
	-webkit-user-select: none !important;
	user-select: none !important;
	-webkit-touch-callout: none !important;
}
input, textarea, select, [contenteditable="true"] {
	-webkit-user-select: auto !important;
	user-select: auto !important;
	-webkit-touch-callout: default !important;
}`
		: "";

	return `:root {
	color-scheme: ${colorScheme};
	--overlayer-highlight-opacity: ${highlightOpacity};
	--overlayer-highlight-blend-mode: ${highlightBlendMode};
	--weave-reader-font-family: ${fontFamily};
	--weave-reader-monospace-font-family: ${monospaceFontFamily};
	--weave-reader-font-size: ${fontSize};
	--weave-reader-letter-spacing: ${letterSpacing};
	--weave-reader-page-margin-inline: ${horizontalPageMargin};
}
html {
	background: ${background} !important;
	color: ${textColor} !important;
	font-family: var(--weave-reader-font-family) !important;
	font-size: var(--weave-reader-font-size) !important;
	line-height: ${input.currentLineHeight} !important;
	letter-spacing: var(--weave-reader-letter-spacing) !important;
	-webkit-text-size-adjust: 100%;
}
	body {
		background: ${background} !important;
		color: ${textColor} !important;
		font-family: var(--weave-reader-font-family) !important;
	font-size: inherit !important;
	line-height: inherit !important;
	letter-spacing: inherit !important;
	margin: 0 var(--weave-reader-page-margin-inline) !important;
	text-rendering: optimizeLegibility;
	font-kerning: normal;
	-webkit-touch-callout: none;
}
body :is(article, section, main, aside, header, footer, nav, p, div, span, li, dd, dt, blockquote, figcaption, td, th, caption, label, legend) {
	font-family: inherit !important;
	font-size: inherit !important;
	letter-spacing: inherit !important;
}
body :is(p, div, li, dd, dt, blockquote, figcaption) {
	line-height: inherit !important;
}
body :is(h1, h2, h3, h4, h5, h6) {
	font-family: inherit !important;
	line-height: inherit !important;
}
body :is(p, div, span, li, dd, dt, blockquote, figcaption, h1, h2, h3, h4, h5, h6, td, th, caption, label, legend) {
	color: inherit;
}
body :is(a, a:link, a:visited) {
	color: ${linkColor} !important;
	font-family: inherit !important;
	font-size: inherit !important;
}
body :is(pre, code, kbd, samp) {
	font-family: var(--weave-reader-monospace-font-family) !important;
	white-space: pre-wrap !important;
	word-break: break-word;
}
body :is(img, svg, video, canvas) {
	max-width: 100% !important;
	height: auto !important;
}
body ::selection {
	background: ${selectionBackground} !important;
	color: ${selectionTextColor} !important;
}
body .weave-foliate-concealment {
	fill: ${concealment.base};
	stroke: ${concealment.border};
	stroke-width: 1;
}${darkModeOverrides}${mobileSelectionDisablingRules}`;
}
