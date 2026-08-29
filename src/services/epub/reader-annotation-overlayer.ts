import type { EpubHighlightStyle } from "./types";
import type { HighlightClickInfo, ReaderViewportRect } from "./reader-engine-types";
import type { ReaderFoliateAnnotation } from "./reader-annotation-model";
import {
	createAnchorPointFromRect,
	createViewportRectFromRawRect,
	createViewportRectFromRawRectList,
	createViewportRectListFromRawRectList,
	type RawViewportRect,
} from "./reader-highlight-geometry";
import { setSvgInteractionAttributes } from "./svg-interaction";
import { i18n } from "../../utils/i18n";
import type { ReaderColorScheme } from "./reader-theme-tokens";

const SVG_NS = "http://www.w3.org/2000/svg";

export type FoliateOverlayerModule = {
	Overlayer: {
		highlight: (rects: unknown[], options?: unknown) => SVGElement;
	};
};

export type ConcealmentPalette = {
	base: string;
	stripe: string;
	border: string;
};

export interface ReaderAnnotationOverlayPorts {
	resolveHighlightTint(color?: string): string;
	getColorScheme?(): ReaderColorScheme;
	getObsidianCSSVar(varName: string, fallback: string): string;
	getConcealmentPalette(): ConcealmentPalette;
	onCommentMarkerClick(
		cfiRange: string,
		markerElement: Element,
		anchorRect?: ReaderViewportRect | null
	): void;
	onNoteMarkerClick?(
		annotation: ReaderFoliateAnnotation,
		markerElement: Element,
		anchorRect?: ReaderViewportRect | null
	): void;
	onReferenceBadgeClick(
		cfiRange: string,
		geometry?: {
			rect: HighlightClickInfo["rect"] | null;
			rects?: HighlightClickInfo["rects"];
			anchorPoint?: HighlightClickInfo["anchorPoint"];
		}
	): void;
}

export function getReferenceBadgeColor(heat: number): string {
	if (heat >= 80) {
		return "#ef4444";
	}
	if (heat >= 50) {
		return "#f97316";
	}
	if (heat >= 20) {
		return "#eab308";
	}
	return "#667eea";
}

function createStraightLineOverlay(
	rect: RawViewportRect,
	strokeColor: string,
	y: number
): SVGLineElement {
	const line = activeDocument.createElementNS(SVG_NS, "line");
	line.setAttribute("x1", String(rect.left));
	line.setAttribute("y1", String(y));
	line.setAttribute("x2", String(rect.left + rect.width));
	line.setAttribute("y2", String(y));
	line.setAttribute("stroke", strokeColor);
	line.setAttribute("stroke-width", String(Math.max(1.4, Math.min(2.2, rect.height * 0.1))));
	line.setAttribute("stroke-linecap", "round");
	line.setAttribute("stroke-opacity", "0.96");
	return line;
}

function createWavyLineOverlay(rect: RawViewportRect, strokeColor: string): SVGPathElement {
	const path = activeDocument.createElementNS(SVG_NS, "path");
	const baseY = rect.top + rect.height - 1.5;
	const amplitude = Math.max(1.2, Math.min(2.8, rect.height * 0.12));
	const wavelength = Math.max(6, Math.min(12, rect.height * 0.8));
	let currentX = rect.left;
	let d = `M ${rect.left} ${baseY}`;
	while (currentX < rect.left + rect.width) {
		const nextX = Math.min(currentX + wavelength, rect.left + rect.width);
		const midX = currentX + (nextX - currentX) / 2;
		d += ` Q ${currentX + wavelength * 0.25} ${baseY - amplitude}, ${midX} ${baseY}`;
		d += ` Q ${currentX + wavelength * 0.75} ${baseY + amplitude}, ${nextX} ${baseY}`;
		currentX = nextX;
	}
	path.setAttribute("d", d);
	path.setAttribute("fill", "none");
	path.setAttribute("stroke", strokeColor);
	path.setAttribute("stroke-width", String(Math.max(1.4, Math.min(2.2, rect.height * 0.1))));
	path.setAttribute("stroke-linecap", "round");
	path.setAttribute("stroke-linejoin", "round");
	path.setAttribute("stroke-opacity", "0.96");
	return path;
}

export type NoteMarkerFallbackType =
	| "top-end-center"
	| "top-end-aligned"
	| "bottom-end-center";

export interface ComputeNoteMarkerOptions {
	viewportBounds?: { width: number; height: number };
	adjacentRects?: RawViewportRect[];
	gutterX?: number;
}

export function isRectIntersecting(
	a: { left: number; top: number; right: number; bottom: number },
	b: { left: number; top: number; right: number; bottom: number }
): boolean {
	return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function computeNoteMarkerPosition(
	rects: RawViewportRect[],
	markerSize = 8,
	options?: ComputeNoteMarkerOptions
): { x: number; y: number; chosenFallback: NoteMarkerFallbackType } | null {
	const validRects = (rects || []).filter(
		(r) => r && Number(r.width) > 0 && Number(r.height) > 0
	);
	if (validRects.length === 0) {
		return null;
	}
	const targetRect = validRects[validRects.length - 1];
	const targetRight =
		typeof targetRect.right === "number"
			? targetRect.right
			: targetRect.left + targetRect.width;
	const targetBottom =
		typeof targetRect.bottom === "number"
			? targetRect.bottom
			: targetRect.top + targetRect.height;

	const viewportWidth =
		options?.viewportBounds?.width ??
		(typeof activeDocument !== "undefined" && activeDocument.documentElement?.clientWidth
			? activeDocument.documentElement.clientWidth
			: typeof window !== "undefined"
				? window.innerWidth
				: Infinity);
	const viewportHeight =
		options?.viewportBounds?.height ??
		(typeof activeDocument !== "undefined" && activeDocument.documentElement?.clientHeight
			? activeDocument.documentElement.clientHeight
			: typeof window !== "undefined"
				? window.innerHeight
				: Infinity);

	const allObstacles = [
		...validRects,
		...(options?.adjacentRects || []).filter(
			(r) => r && Number(r.width) > 0 && Number(r.height) > 0
		),
	];

	const isWithinViewport = (x: number, y: number): boolean => {
		return (
			x >= 0 &&
			y >= 0 &&
			x + markerSize <= viewportWidth &&
			y + markerSize <= viewportHeight
		);
	};

	const collidesWithObstacles = (x: number, y: number): boolean => {
		const box = { left: x, top: y, right: x + markerSize, bottom: y + markerSize };
		return allObstacles.some((r) => {
			const rRight =
				typeof r.right === "number" ? r.right : r.left + r.width;
			const rBottom =
				typeof r.bottom === "number" ? r.bottom : r.top + r.height;
			return isRectIntersecting(box, {
				left: r.left,
				top: r.top,
				right: rRight,
				bottom: rBottom,
			});
		});
	};

	// Primary position: 选区最后一行、最后一个字符终点的正上方
	// Marker 水平中心对准选区终点: x = targetRect.right - markerSize / 2
	// 纵向必须整个悬在该行上方: y = targetRect.top - markerSize - 3px
	const candidatePrimary = {
		x: targetRight - markerSize / 2,
		y: targetRect.top - markerSize - 3,
		type: "top-end-center" as const,
	};

	// Fallback 1: 靠右对齐正上方（当中心点略微超出视口右侧时）
	const candidateTopAligned = {
		x: Math.max(0, targetRight - markerSize),
		y: targetRect.top - markerSize - 3,
		type: "top-end-aligned" as const,
	};

	// Fallback 2: 选区终点正下方（当页面顶部贴顶 y < 0 时）
	const candidateBottomCenter = {
		x: targetRight - markerSize / 2,
		y: targetBottom + 3,
		type: "bottom-end-center" as const,
	};

	const candidates = [candidatePrimary, candidateTopAligned, candidateBottomCenter];

	for (const candidate of candidates) {
		if (
			isWithinViewport(candidate.x, candidate.y) &&
			!collidesWithObstacles(candidate.x, candidate.y)
		) {
			return { x: candidate.x, y: candidate.y, chosenFallback: candidate.type };
		}
	}

	for (const candidate of candidates) {
		if (!collidesWithObstacles(candidate.x, candidate.y)) {
			return { x: candidate.x, y: candidate.y, chosenFallback: candidate.type };
		}
	}

	return { x: candidatePrimary.x, y: candidatePrimary.y, chosenFallback: candidatePrimary.type };
}

export class ReaderAnnotationOverlayRenderer {
	constructor(private readonly ports: ReaderAnnotationOverlayPorts) {}

	createCompositeAnnotationOverlay(
		annotation: ReaderFoliateAnnotation,
		rects: unknown[],
		overlayer?: FoliateOverlayerModule
	): SVGElement {
		const group = activeDocument.createElementNS(SVG_NS, "g");

		if (annotation.style === "reading-note") {
			if (annotation.baseHighlightColor) {
				if (annotation.baseStyle && annotation.baseStyle !== "reading-note") {
					group.appendChild(
						this.createStyledAnnotationOverlay(
							rects,
							annotation.baseStyle,
							annotation.baseHighlightColor
						)
					);
				} else if (overlayer) {
					group.appendChild(
						overlayer.Overlayer.highlight(rects, {
							color: this.ports.resolveHighlightTint(annotation.baseHighlightColor),
							padding: 1,
						})
					);
				}
			} else {
				group.appendChild(this.createReadingNoteHintOverlay(rects, annotation.color));
			}
			group.appendChild(this.createNoteMarkerOverlay(annotation, rects));
		} else if (annotation.style) {
			group.appendChild(this.createStyledAnnotationOverlay(rects, annotation.style, annotation.color));
		} else if (overlayer) {
			group.appendChild(
				overlayer.Overlayer.highlight(rects, {
					color: this.ports.resolveHighlightTint(annotation.color),
					padding: 1,
				})
			);
		}

		if (annotation.hasCommentDivider && annotation.style !== "reading-note") {
			group.appendChild(this.createCommentMarkerOverlay(annotation, rects));
		}

		if (annotation.focusColor) {
			group.appendChild(this.createTemporaryFocusOverlay(rects, annotation.focusColor));
		}

		if (annotation.referenceCount && annotation.referenceCount > 1) {
			group.appendChild(this.createReferenceBadgeOverlay(annotation, rects));
		}

		return group;
	}

	createReadingNoteHintOverlay(rects: unknown[], color?: string): SVGElement {
		const group = activeDocument.createElementNS(SVG_NS, "g");
		group.setAttribute("data-zora-reading-note-hint", "group");
		const noteColor = this.ports.resolveHighlightTint(color === "blue" ? "blue" : "purple");
		const isDark = this.ports.getColorScheme?.() === "dark";
		const fillOpacity = isDark ? "0.24" : "0.10";
		const strokeOpacity = isDark ? "0.58" : "0.20";
		for (const rect of rects as RawViewportRect[]) {
			if (rect.width <= 0 || rect.height <= 0) {
				continue;
			}
			const bg = activeDocument.createElementNS(SVG_NS, "rect");
			bg.setAttribute("data-zora-reading-note-hint", "tint");
			bg.setAttribute("x", String(rect.left));
			bg.setAttribute("y", String(rect.top));
			bg.setAttribute("width", String(rect.width));
			bg.setAttribute("height", String(rect.height));
			bg.setAttribute("rx", "2");
			bg.setAttribute("ry", "2");
			bg.setAttribute("fill", noteColor);
			bg.setAttribute("fill-opacity", fillOpacity);
			bg.setAttribute("stroke", noteColor);
			bg.setAttribute("stroke-opacity", strokeOpacity);
			bg.setAttribute("stroke-width", isDark ? "0.75" : "0.5");
			setSvgInteractionAttributes(bg, { pointerEvents: "none" });
			group.appendChild(bg);
		}
		return group;
	}

	createConcealmentOverlay(rects: unknown[]): SVGElement {
		const palette = this.ports.getConcealmentPalette();
		const group = activeDocument.createElementNS(SVG_NS, "g");

		for (const rect of rects as RawViewportRect[]) {
			const background = activeDocument.createElementNS(SVG_NS, "rect");
			background.setAttribute("x", String(rect.left));
			background.setAttribute("y", String(rect.top));
			background.setAttribute("width", String(rect.width));
			background.setAttribute("height", String(rect.height));
			background.setAttribute("rx", "4");
			background.setAttribute("fill", palette.base);
			background.setAttribute("stroke", palette.border);
			group.appendChild(background);

			const stripeWidth = 9;
			for (let x = rect.left; x < rect.left + rect.width; x += stripeWidth * 2) {
				const stripe = activeDocument.createElementNS(SVG_NS, "rect");
				stripe.setAttribute("x", String(x));
				stripe.setAttribute("y", String(rect.top));
				stripe.setAttribute("width", String(Math.min(stripeWidth, rect.left + rect.width - x)));
				stripe.setAttribute("height", String(rect.height));
				stripe.setAttribute("fill", palette.stripe);
				stripe.setAttribute("opacity", "0.92");
				group.appendChild(stripe);
			}
		}

		return group;
	}

	createStyledAnnotationOverlay(
		rects: unknown[],
		style: EpubHighlightStyle,
		color?: string
	): SVGElement {
		const group = activeDocument.createElementNS(SVG_NS, "g");
		const strokeColor = this.ports.resolveHighlightTint(color);

		for (const rect of rects as RawViewportRect[]) {
			if (rect.width <= 0 || rect.height <= 0) {
				continue;
			}
			if (style === "reading-note") {
				continue;
			}
			if (style === "underline") {
				group.appendChild(createStraightLineOverlay(rect, strokeColor, rect.top + rect.height - 1.5));
				continue;
			}
			if (style === "strikethrough") {
				group.appendChild(
					createStraightLineOverlay(rect, strokeColor, rect.top + rect.height * 0.5)
				);
				continue;
			}
			group.appendChild(createWavyLineOverlay(rect, strokeColor));
		}
		return group;
	}

	createTemporaryFocusOverlay(rects: unknown[], color: string): SVGElement {
		const group = activeDocument.createElementNS(SVG_NS, "g");
		const strokeColor = this.ports.resolveHighlightTint(color);

		for (const rect of rects as RawViewportRect[]) {
			const outline = activeDocument.createElementNS(SVG_NS, "rect");
			outline.setAttribute("x", String(rect.left - 1.5));
			outline.setAttribute("y", String(rect.top - 1.5));
			outline.setAttribute("width", String(rect.width + 3));
			outline.setAttribute("height", String(rect.height + 3));
			outline.setAttribute("rx", "5");
			outline.setAttribute("fill", "none");
			outline.setAttribute("stroke", strokeColor);
			outline.setAttribute("stroke-width", "2");
			outline.setAttribute("stroke-opacity", "0.95");
			group.appendChild(outline);
		}

		return group;
	}

	createNoteMarkerOverlay(
		annotation: ReaderFoliateAnnotation,
		rects: unknown[],
		options?: ComputeNoteMarkerOptions
	): SVGElement {
		const group = activeDocument.createElementNS(SVG_NS, "g");
		group.setAttribute("data-zora-note-marker", "group");
		const rectList = rects as RawViewportRect[];
		const anchorRect = createViewportRectFromRawRectList(rectList);

		const size = 8;
		const hitSize = 26;
		const cornerRadius = 2.0;

		const position = computeNoteMarkerPosition(rectList, size, options);
		if (!position) {
			return group;
		}

		const markerX = position.x;
		const markerY = position.y;

		const markerColor = this.ports.resolveHighlightTint(
			annotation.color === "blue" ? "blue" : "purple"
		);
		const markerBorder = markerColor;
		const fillColor = "#ffffff";

		const badge = activeDocument.createElementNS(SVG_NS, "rect");
		badge.setAttribute("data-zora-note-marker", "badge");
		badge.setAttribute("x", String(markerX));
		badge.setAttribute("y", String(markerY));
		badge.setAttribute("width", String(size));
		badge.setAttribute("height", String(size));
		badge.setAttribute("rx", String(cornerRadius));
		badge.setAttribute("ry", String(cornerRadius));
		badge.setAttribute("fill", markerColor);
		badge.setAttribute("stroke", markerBorder);
		badge.setAttribute("stroke-width", "0.75");
		setSvgInteractionAttributes(badge, { pointerEvents: "none" });

		const icon = activeDocument.createElementNS(SVG_NS, "path");
		icon.setAttribute("data-zora-note-marker", "icon");
		const pad = 1.4;
		const x0 = markerX + pad;
		const y0 = markerY + pad;
		const w = size - pad * 2;
		const h = size - pad * 2;
		icon.setAttribute(
			"d",
			`M ${x0} ${y0} h ${w * 0.65} l ${w * 0.35} ${h * 0.35} v ${h * 0.65} h ${-w} Z M ${x0 + w * 0.22} ${y0 + h * 0.45} h ${w * 0.55} M ${x0 + w * 0.22} ${y0 + h * 0.72} h ${w * 0.38}`
		);
		icon.setAttribute("fill", "none");
		icon.setAttribute("stroke", fillColor);
		icon.setAttribute("stroke-width", "0.75");
		icon.setAttribute("stroke-linecap", "round");
		icon.setAttribute("stroke-linejoin", "round");
		setSvgInteractionAttributes(icon, { pointerEvents: "none" });

		const hitOffset = (hitSize - size) / 2;
		const viewportWidth = Math.max(
			0,
			options?.viewportBounds?.width ?? activeDocument.documentElement?.clientWidth ?? 0
		);
		const viewportHeight = Math.max(
			0,
			options?.viewportBounds?.height ?? activeDocument.documentElement?.clientHeight ?? 0
		);
		const hitWidth = viewportWidth > 0 ? Math.min(hitSize, viewportWidth) : hitSize;
		const hitHeight = viewportHeight > 0 ? Math.min(hitSize, viewportHeight) : hitSize;
		const desiredHitX = markerX - hitOffset;
		const desiredHitY = markerY - hitOffset;
		const hitX = viewportWidth > 0
			? Math.max(0, Math.min(desiredHitX, Math.max(0, viewportWidth - hitWidth)))
			: desiredHitX;
		const hitY = viewportHeight > 0
			? Math.max(0, Math.min(desiredHitY, Math.max(0, viewportHeight - hitHeight)))
			: desiredHitY;
		const hitArea = activeDocument.createElementNS(SVG_NS, "rect");
		hitArea.setAttribute("data-zora-note-marker", "hit-area");
		hitArea.setAttribute("x", String(hitX));
		hitArea.setAttribute("y", String(hitY));
		hitArea.setAttribute("width", String(hitWidth));
		hitArea.setAttribute("height", String(hitHeight));
		hitArea.setAttribute("rx", String(cornerRadius + 1.5));
		hitArea.setAttribute("ry", String(cornerRadius + 1.5));
		hitArea.setAttribute("fill", "#000000");
		hitArea.setAttribute("fill-opacity", "0.001");
		hitArea.setAttribute("role", "button");
		hitArea.setAttribute("aria-label", "读书笔记 Marker");
		setSvgInteractionAttributes(hitArea, { cursor: "pointer", pointerEvents: "auto" });

		const handleMarkerClick = (event: Event) => {
			event.preventDefault();
			event.stopPropagation();
			if (this.ports.onNoteMarkerClick) {
				this.ports.onNoteMarkerClick(annotation, badge, anchorRect);
			} else {
				this.ports.onCommentMarkerClick(annotation.cfiRange, badge, anchorRect);
			}
		};
		hitArea.addEventListener("click", handleMarkerClick);

		group.appendChild(hitArea);
		group.appendChild(badge);
		group.appendChild(icon);
		return group;
	}

	createCommentMarkerOverlay(annotation: ReaderFoliateAnnotation, rects: unknown[]): SVGElement {
		const group = activeDocument.createElementNS(SVG_NS, "g");
		group.setAttribute("data-weave-comment-marker", "group");
		const rectList = rects as RawViewportRect[];
		const anchorRect = createViewportRectFromRawRectList(rectList);
		const targetRect = [...rectList].reverse().find((rect) => rect.width > 0 && rect.height > 0);
		if (!targetRect) {
			return group;
		}

		const accentColor = annotation.color
			? this.ports.resolveHighlightTint(annotation.color)
			: this.ports.getObsidianCSSVar("--interactive-accent", "#7c3aed");
		const fillColor = this.ports.getObsidianCSSVar("--background-primary", "#ffffff");
		const accentTextColor = this.ports.getObsidianCSSVar("--text-on-accent", "#ffffff");
		const inset = Math.max(1.15, Math.min(2.1, targetRect.height * 0.1));
		const availableWidth = Math.max(12, targetRect.width - inset * 2);
		const availableHeight = Math.max(9.5, targetRect.height - inset * 2);
		const bubbleHeight = Math.min(
			Math.max(10.2, Math.min(12.8, targetRect.height * 0.62)),
			availableHeight
		);
		const tailSize = Math.min(
			Math.max(1.9, Math.min(2.8, bubbleHeight * 0.24)),
			Math.max(1.5, bubbleHeight * 0.26)
		);
		const bubbleBodyHeight = Math.max(7.5, bubbleHeight - tailSize);
		const badgeWidth = Math.min(
			Math.max(14.8, Math.min(20.5, bubbleBodyHeight * 1.78)),
			availableWidth
		);
		const cornerRadius = Math.max(4.2, Math.min(6.6, bubbleBodyHeight * 0.5));
		const badgeX = Math.max(
			targetRect.left + inset,
			targetRect.left + targetRect.width - badgeWidth - inset
		);
		const badgeY = targetRect.top + inset;
		const bubbleBackdrop = activeDocument.createElementNS(SVG_NS, "rect");
		bubbleBackdrop.setAttribute("data-weave-comment-marker", "backdrop");
		bubbleBackdrop.setAttribute("x", String(badgeX));
		bubbleBackdrop.setAttribute("y", String(badgeY));
		bubbleBackdrop.setAttribute("width", String(badgeWidth));
		bubbleBackdrop.setAttribute("height", String(bubbleBodyHeight));
		bubbleBackdrop.setAttribute("rx", String(cornerRadius));
		bubbleBackdrop.setAttribute("ry", String(cornerRadius));
		bubbleBackdrop.setAttribute("fill", accentColor);
		bubbleBackdrop.setAttribute("fill-opacity", "0.16");
		setSvgInteractionAttributes(bubbleBackdrop, { pointerEvents: "none" });
		const bubbleBody = activeDocument.createElementNS(SVG_NS, "rect");
		bubbleBody.setAttribute("data-weave-comment-marker", "bubble");
		bubbleBody.setAttribute("x", String(badgeX));
		bubbleBody.setAttribute("y", String(badgeY));
		bubbleBody.setAttribute("width", String(badgeWidth));
		bubbleBody.setAttribute("height", String(bubbleBodyHeight));
		bubbleBody.setAttribute("rx", String(cornerRadius));
		bubbleBody.setAttribute("ry", String(cornerRadius));
		bubbleBody.setAttribute("fill", accentColor);
		bubbleBody.setAttribute("fill-opacity", "0.12");
		bubbleBody.setAttribute("stroke", accentColor);
		bubbleBody.setAttribute("stroke-width", "1.75");
		bubbleBody.setAttribute("opacity", "1");
		setSvgInteractionAttributes(bubbleBody, { pointerEvents: "none" });

		const bubbleInner = activeDocument.createElementNS(SVG_NS, "rect");
		bubbleInner.setAttribute("data-weave-comment-marker", "inner");
		bubbleInner.setAttribute("x", String(badgeX + 1.15));
		bubbleInner.setAttribute("y", String(badgeY + 1.1));
		bubbleInner.setAttribute("width", String(Math.max(7, badgeWidth - 2.3)));
		bubbleInner.setAttribute("height", String(Math.max(4.8, bubbleBodyHeight - 2.25)));
		bubbleInner.setAttribute("rx", String(Math.max(3.2, cornerRadius - 1.2)));
		bubbleInner.setAttribute("ry", String(Math.max(3.2, cornerRadius - 1.2)));
		bubbleInner.setAttribute("fill", fillColor);
		bubbleInner.setAttribute("fill-opacity", "0.2");
		setSvgInteractionAttributes(bubbleInner, { pointerEvents: "none" });

		const bubbleTail = activeDocument.createElementNS(SVG_NS, "path");
		bubbleTail.setAttribute("data-weave-comment-marker", "tail");
		bubbleTail.setAttribute(
			"d",
			[
				`M ${badgeX + badgeWidth * 0.56} ${badgeY + bubbleBodyHeight - 0.18}`,
				`L ${badgeX + badgeWidth * 0.78} ${badgeY + bubbleHeight - 0.12}`,
				`L ${badgeX + badgeWidth * 0.44} ${badgeY + bubbleBodyHeight + 0.28}`,
				"Z",
			].join(" ")
		);
		bubbleTail.setAttribute("fill", accentColor);
		bubbleTail.setAttribute("fill-opacity", "0.12");
		bubbleTail.setAttribute("stroke", accentColor);
		bubbleTail.setAttribute("stroke-width", "1.55");
		bubbleTail.setAttribute("stroke-linejoin", "round");
		setSvgInteractionAttributes(bubbleTail, { pointerEvents: "none" });

		const dotRadius = Math.max(1.08, Math.min(1.55, bubbleBodyHeight * 0.15));
		const dotCenterY = badgeY + bubbleBodyHeight * 0.56;
		const dots: SVGCircleElement[] = [];
		for (const ratio of [0.3, 0.5, 0.7]) {
			const dot = activeDocument.createElementNS(SVG_NS, "circle");
			dot.setAttribute("data-weave-comment-marker", "dot");
			dot.setAttribute("cx", String(badgeX + badgeWidth * ratio));
			dot.setAttribute("cy", String(dotCenterY));
			dot.setAttribute("r", String(dotRadius));
			dot.setAttribute("fill", accentColor);
			setSvgInteractionAttributes(dot, { pointerEvents: "none" });
			dots.push(dot);
		}

		const stickerSize = Math.max(2.4, Math.min(3.4, bubbleBodyHeight * 0.26));
		const sticker = activeDocument.createElementNS(SVG_NS, "circle");
		sticker.setAttribute("data-weave-comment-marker", "sticker");
		sticker.setAttribute("cx", String(badgeX + badgeWidth - stickerSize - 1.15));
		sticker.setAttribute("cy", String(badgeY + stickerSize + 0.85));
		sticker.setAttribute("r", String(stickerSize));
		sticker.setAttribute("fill", accentColor);
		sticker.setAttribute("stroke", fillColor);
		sticker.setAttribute("stroke-width", "0.95");
		setSvgInteractionAttributes(sticker, { pointerEvents: "none" });

		const stickerHighlight = activeDocument.createElementNS(SVG_NS, "circle");
		stickerHighlight.setAttribute("data-weave-comment-marker", "sticker-highlight");
		stickerHighlight.setAttribute("cx", String(badgeX + badgeWidth - stickerSize - 1.9));
		stickerHighlight.setAttribute("cy", String(badgeY + stickerSize + 0.1));
		stickerHighlight.setAttribute("r", String(Math.max(0.7, stickerSize * 0.34)));
		stickerHighlight.setAttribute("fill", accentTextColor);
		stickerHighlight.setAttribute("fill-opacity", "0.78");
		setSvgInteractionAttributes(stickerHighlight, { pointerEvents: "none" });

		const hitAreaX = Math.max(targetRect.left, badgeX - 1.5);
		const hitAreaY = Math.max(targetRect.top, badgeY - 1.5);
		const hitAreaRight = Math.min(targetRect.left + targetRect.width, badgeX + badgeWidth + 1.5);
		const hitAreaBottom = Math.min(targetRect.top + targetRect.height, badgeY + bubbleHeight + 2);
		const hitArea = activeDocument.createElementNS(SVG_NS, "rect");
		hitArea.setAttribute("data-weave-comment-marker", "hit-area");
		hitArea.setAttribute("x", String(hitAreaX));
		hitArea.setAttribute("y", String(hitAreaY));
		hitArea.setAttribute("width", String(Math.max(6, hitAreaRight - hitAreaX)));
		hitArea.setAttribute("height", String(Math.max(6, hitAreaBottom - hitAreaY)));
		hitArea.setAttribute("rx", String(cornerRadius + 1.5));
		hitArea.setAttribute("ry", String(cornerRadius + 1.5));
		hitArea.setAttribute("fill", "#000000");
		hitArea.setAttribute("fill-opacity", "0.001");
		hitArea.setAttribute("role", "button");
		hitArea.setAttribute("aria-label", i18n.t("epub.reader.commentMarkerAria"));
		setSvgInteractionAttributes(hitArea, { cursor: "pointer", pointerEvents: "auto" });

		const handleMarkerClick = (event: Event) => {
			event.preventDefault();
			event.stopPropagation();
			this.ports.onCommentMarkerClick(annotation.cfiRange, bubbleBody, anchorRect);
		};
		hitArea.addEventListener("click", handleMarkerClick);
		group.appendChild(hitArea);
		group.appendChild(bubbleBackdrop);
		group.appendChild(bubbleBody);
		group.appendChild(bubbleInner);
		group.appendChild(bubbleTail);
		for (const dot of dots) {
			group.appendChild(dot);
		}
		group.appendChild(sticker);
		group.appendChild(stickerHighlight);
		return group;
	}

	createReferenceBadgeOverlay(annotation: ReaderFoliateAnnotation, rects: unknown[]): SVGElement {
		const group = activeDocument.createElementNS(SVG_NS, "g");
		group.setAttribute("data-weave-reference-badge", "group");

		const rectList = rects as RawViewportRect[];
		const targetRect = [...rectList].reverse().find((rect) => rect.width > 0 && rect.height > 0);
		if (!targetRect) {
			return group;
		}

		const count = annotation.referenceCount || 0;
		const heat = annotation.referenceHeat || 0;
		const badgeColor = getReferenceBadgeColor(heat);
		const fillColor = this.ports.getObsidianCSSVar("--background-primary", "#ffffff");
		const inset = Math.max(0.85, Math.min(1.8, targetRect.height * 0.1));
		const availableWidth = Math.max(9.5, targetRect.width - inset * 2);
		const availableHeight = Math.max(8.2, targetRect.height - inset * 2);
		const badgeHeight = Math.min(
			Math.max(8.8, Math.min(12.6, targetRect.height * 0.58)),
			availableHeight
		);
		const badgeWidth = Math.min(
			Math.max(badgeHeight + 2, Math.min(18.5, count >= 10 ? 16.5 : count >= 5 ? 14.8 : 13.2)),
			availableWidth
		);
		const badgeX = Math.max(
			targetRect.left + inset,
			targetRect.left + targetRect.width - badgeWidth - inset
		);
		const badgeY = targetRect.top + inset;
		const cornerRadius = Math.max(3.6, Math.min(6.2, badgeHeight * 0.52));

		const background = activeDocument.createElementNS(SVG_NS, "rect");
		background.setAttribute("data-weave-reference-badge", "background");
		background.setAttribute("x", String(badgeX));
		background.setAttribute("y", String(badgeY));
		background.setAttribute("width", String(badgeWidth));
		background.setAttribute("height", String(badgeHeight));
		background.setAttribute("rx", String(cornerRadius));
		background.setAttribute("ry", String(cornerRadius));
		background.setAttribute("fill", badgeColor);
		background.setAttribute("stroke", fillColor);
		background.setAttribute("stroke-width", "0.8");
		setSvgInteractionAttributes(background, { pointerEvents: "none" });

		const inner = activeDocument.createElementNS(SVG_NS, "rect");
		inner.setAttribute("data-weave-reference-badge", "inner");
		inner.setAttribute("x", String(badgeX + 0.9));
		inner.setAttribute("y", String(badgeY + 0.8));
		inner.setAttribute("width", String(Math.max(5.5, badgeWidth - 1.8)));
		inner.setAttribute("height", String(Math.max(4.8, badgeHeight - 1.6)));
		inner.setAttribute("rx", String(Math.max(2.8, cornerRadius - 0.9)));
		inner.setAttribute("ry", String(Math.max(2.8, cornerRadius - 0.9)));
		inner.setAttribute("fill", "#ffffff");
		inner.setAttribute("fill-opacity", "0.14");
		setSvgInteractionAttributes(inner, { pointerEvents: "none" });

		const text = activeDocument.createElementNS(SVG_NS, "text");
		text.setAttribute("data-weave-reference-badge", "text");
		text.setAttribute("x", String(badgeX + badgeWidth / 2));
		text.setAttribute("y", String(badgeY + badgeHeight * 0.56));
		text.setAttribute("text-anchor", "middle");
		text.setAttribute("dominant-baseline", "middle");
		text.setAttribute("fill", "#ffffff");
		text.setAttribute("font-size", String(Math.max(7.2, Math.min(9.6, badgeHeight * 0.56))));
		text.setAttribute("font-weight", "700");
		text.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
		text.textContent = String(count);
		setSvgInteractionAttributes(text, { pointerEvents: "none" });

		const hitArea = activeDocument.createElementNS(SVG_NS, "rect");
		hitArea.setAttribute("data-weave-reference-badge", "hit-area");
		hitArea.setAttribute("x", String(Math.max(targetRect.left, badgeX - 1.25)));
		hitArea.setAttribute("y", String(Math.max(targetRect.top, badgeY - 1.25)));
		hitArea.setAttribute(
			"width",
			String(Math.max(6, Math.min(targetRect.width, badgeWidth + 2.5)))
		);
		hitArea.setAttribute(
			"height",
			String(Math.max(6, Math.min(targetRect.height, badgeHeight + 2.5)))
		);
		hitArea.setAttribute("rx", String(cornerRadius + 1.1));
		hitArea.setAttribute("ry", String(cornerRadius + 1.1));
		hitArea.setAttribute("fill", "#000000");
		hitArea.setAttribute("fill-opacity", "0.001");
		hitArea.setAttribute("role", "button");
		hitArea.setAttribute("aria-label", i18n.t("epub.reader.referenceBadgeAria", { count }));
		setSvgInteractionAttributes(hitArea, { cursor: "pointer", pointerEvents: "auto" });
		const badgeRect = createViewportRectFromRawRect({
			left: Math.max(targetRect.left, badgeX - 1.25),
			top: Math.max(targetRect.top, badgeY - 1.25),
			width: Math.max(6, Math.min(targetRect.width, badgeWidth + 2.5)),
			height: Math.max(6, Math.min(targetRect.height, badgeHeight + 2.5)),
		});
		const badgeAnchorPoint = createAnchorPointFromRect(badgeRect);
		const highlightRects = createViewportRectListFromRawRectList(rectList);

		const handleBadgeClick = (event: Event) => {
			event.preventDefault();
			event.stopPropagation();
			this.ports.onReferenceBadgeClick(annotation.cfiRange, {
				rect: badgeRect,
				rects: highlightRects,
				anchorPoint: badgeAnchorPoint,
			});
		};
		hitArea.addEventListener("click", handleBadgeClick);

		group.appendChild(hitArea);
		group.appendChild(background);
		group.appendChild(inner);
		group.appendChild(text);
		return group;
	}
}
