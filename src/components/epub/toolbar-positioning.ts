import { domInstanceOf } from "../../utils/dom-instance-of";
import { getWorkspaceBounds } from "../../utils/mobile-modal-bounds";

export type ToolbarMode = "floating" | "docked";

export type FloatingSidePreference = "top" | "bottom" | "auto";
export type FloatingAlign = "center" | "start" | "end";

export interface ToolbarRect {
	top: number;
	left: number;
	bottom: number;
	right: number;
	width: number;
	height: number;
}

export interface ToolbarPoint {
	x: number;
	y: number;
}

export interface ToolbarPositionResult {
	top: number;
	left: number;
	arrowOffset: number;
	isBelowAnchor: boolean;
	mode: ToolbarMode;
	anchorRect: ToolbarRect;
}

export interface ToolbarPositionOptions {
	anchorRect: ToolbarRect;
	anchorRects?: ToolbarRect[];
	anchorPoint?: ToolbarPoint;
	containerWidth: number;
	containerHeight: number;
	toolbarWidth: number;
	toolbarHeight: number;
	mobile: boolean;
	insetTop?: number;
	insetBottom?: number;
	edgeMargin?: number;
	gap?: number;
	arrowPadding?: number;
	preferredSide?: FloatingSidePreference;
	align?: FloatingAlign;
}

export const TOOLBAR_EDGE_MARGIN = 12;
export const TOOLBAR_GAP = 12;
export const TOOLBAR_ARROW_PADDING = 18;
export const NATIVE_SELECTION_MENU_HEIGHT = 48;
export const MOBILE_FLOATING_BOTTOM_BASE_INSET = 16;

export type NativeSelectionMenuSide = "above" | "below";

export function resolveMobileFloatingInsetBottom(mobileDockBottomOffset = 0): number {
	return mobileDockBottomOffset + MOBILE_FLOATING_BOTTOM_BASE_INSET;
}

/** Mirrors iOS/Android behavior: native menu prefers above the selection when space allows. */
export function estimateNativeSelectionMenuSide(
	anchorRect: ToolbarRect,
	containerHeight: number,
	edgeMargin = TOOLBAR_EDGE_MARGIN,
	nativeMenuHeight = NATIVE_SELECTION_MENU_HEIGHT
): NativeSelectionMenuSide {
	const spaceAbove = anchorRect.top - edgeMargin;
	const spaceBelow = containerHeight - anchorRect.bottom - edgeMargin;

	if (spaceAbove >= nativeMenuHeight) {
		return "above";
	}
	if (spaceBelow >= nativeMenuHeight) {
		return "below";
	}
	return spaceAbove >= spaceBelow ? "above" : "below";
}

export function mirrorFloatingSide(nativeMenuSide: NativeSelectionMenuSide): "top" | "bottom" {
	return nativeMenuSide === "above" ? "bottom" : "top";
}

function clamp(value: number, min: number, max: number) {
	if (max < min) {
		return min;
	}
	return Math.min(Math.max(value, min), max);
}

function getRectCenterX(rect: ToolbarRect): number {
	return rect.left + rect.width / 2;
}

function normalizeAnchorRects(anchorRect: ToolbarRect, anchorRects?: ToolbarRect[]): ToolbarRect[] {
	const normalized = (anchorRects || []).filter(
		(rect) =>
			Number.isFinite(rect.left) &&
			Number.isFinite(rect.top) &&
			Number.isFinite(rect.right) &&
			Number.isFinite(rect.bottom) &&
			rect.width > 0 &&
			rect.height > 0
	);
	return normalized.length ? normalized : [anchorRect];
}

function chooseFloatingSide(
	anchorRect: ToolbarRect,
	containerHeight: number,
	toolbarHeight: number,
	gap: number,
	edgeMargin: number,
	insetTop: number,
	insetBottom: number,
	preferredSide: FloatingSidePreference
): "top" | "bottom" {
	const availableAbove = anchorRect.top - gap - edgeMargin - insetTop;
	const availableBelow = containerHeight - insetBottom - anchorRect.bottom - gap - edgeMargin;

	if (preferredSide === "bottom") {
		return availableBelow >= toolbarHeight || availableBelow >= availableAbove ? "bottom" : "top";
	}

	return availableAbove >= toolbarHeight || availableAbove >= availableBelow ? "top" : "bottom";
}

function chooseAnchorRectForSide(
	rects: ToolbarRect[],
	side: "top" | "bottom",
	anchorPoint?: ToolbarPoint
): ToolbarRect {
	if (rects.length <= 1) {
		return rects[0];
	}

	const edgeValue = side === "top"
		? Math.min(...rects.map((rect) => rect.top))
		: Math.max(...rects.map((rect) => rect.bottom));
	const edgeRects = rects.filter((rect) =>
		side === "top"
			? Math.abs(rect.top - edgeValue) < 0.5
			: Math.abs(rect.bottom - edgeValue) < 0.5
	);
	if (edgeRects.length <= 1) {
		return edgeRects[0] || rects[0];
	}

	if (anchorPoint && Number.isFinite(anchorPoint.x)) {
		return edgeRects.reduce((best, current) => {
			const bestDistance = Math.abs(getRectCenterX(best) - anchorPoint.x);
			const currentDistance = Math.abs(getRectCenterX(current) - anchorPoint.x);
			return currentDistance < bestDistance ? current : best;
		});
	}

	return edgeRects.reduce((best, current) => {
		return getRectCenterX(current) < getRectCenterX(best) ? current : best;
	});
}

function getAnchorX(rect: ToolbarRect, anchorPoint: ToolbarPoint | undefined, align: FloatingAlign): number {
	if (align === "start") {
		return rect.left;
	}
	if (align === "end") {
		return rect.right;
	}
	if (anchorPoint && Number.isFinite(anchorPoint.x)) {
		return anchorPoint.x;
	}
	return getRectCenterX(rect);
}

function toolbarOverlapsAnchor(
	top: number,
	toolbarHeight: number,
	anchorRect: ToolbarRect,
	gap: number
): boolean {
	const toolbarBottom = top + toolbarHeight;
	return toolbarBottom > anchorRect.top - gap && top < anchorRect.bottom + gap;
}

function floatingClearsAnchor(
	top: number,
	toolbarHeight: number,
	anchorRect: ToolbarRect,
	gap: number,
	isBelowAnchor: boolean
): boolean {
	if (isBelowAnchor) {
		return top >= anchorRect.bottom + gap - 0.5;
	}
	return top + toolbarHeight <= anchorRect.top - gap + 0.5;
}

function createDockedPosition(left: number, activeAnchorRect: ToolbarRect): ToolbarPositionResult {
	return {
		top: 0,
		left,
		arrowOffset: 0,
		isBelowAnchor: true,
		mode: "docked",
		anchorRect: activeAnchorRect,
	};
}

interface FloatingPlacementInput {
	activeAnchorRect: ToolbarRect;
	anchorX: number;
	left: number;
	side: "top" | "bottom";
	containerHeight: number;
	toolbarWidth: number;
	toolbarHeight: number;
	insetTop: number;
	insetBottom: number;
	edgeMargin: number;
	gap: number;
	arrowPadding: number;
}

function computeFloatingPlacement({
	activeAnchorRect,
	anchorX,
	left,
	side,
	containerHeight,
	toolbarWidth,
	toolbarHeight,
	insetTop,
	insetBottom,
	edgeMargin,
	gap,
	arrowPadding,
}: FloatingPlacementInput): ToolbarPositionResult {
	const isBelowAnchor = side === "bottom";
	const preferredTop = isBelowAnchor
		? activeAnchorRect.bottom + gap
		: activeAnchorRect.top - toolbarHeight - gap;
	const minTop = edgeMargin + insetTop;
	const maxTop = containerHeight - insetBottom - toolbarHeight - edgeMargin;
	const top = clamp(preferredTop, minTop, maxTop);
	const arrowLimit = Math.max(0, toolbarWidth / 2 - arrowPadding);

	return {
		top,
		left,
		arrowOffset: clamp(anchorX - (left + toolbarWidth / 2), -arrowLimit, arrowLimit),
		isBelowAnchor,
		mode: "floating",
		anchorRect: activeAnchorRect,
	};
}

function mobileMirrorSideHasRoom(
	side: "top" | "bottom",
	anchorRect: ToolbarRect,
	containerHeight: number,
	toolbarHeight: number,
	gap: number,
	edgeMargin: number,
	insetTop: number,
	insetBottom: number
): boolean {
	if (side === "bottom") {
		const availableBelow =
			containerHeight - insetBottom - anchorRect.bottom - gap - edgeMargin;
		return availableBelow >= toolbarHeight;
	}

	const availableAbove = anchorRect.top - gap - edgeMargin - insetTop;
	return availableAbove >= toolbarHeight;
}

function toolbarOverlapsNativeMenu(
	top: number,
	toolbarHeight: number,
	anchorRect: ToolbarRect,
	nativeMenuSide: NativeSelectionMenuSide,
	gap: number,
	nativeMenuHeight = NATIVE_SELECTION_MENU_HEIGHT
): boolean {
	const toolbarBottom = top + toolbarHeight;
	if (nativeMenuSide === "above") {
		const nativeZoneBottom = anchorRect.top - gap;
		const nativeZoneTop = nativeZoneBottom - nativeMenuHeight;
		return toolbarBottom > nativeZoneTop && top < nativeZoneBottom;
	}

	const nativeZoneTop = anchorRect.bottom + gap;
	const nativeZoneBottom = nativeZoneTop + nativeMenuHeight;
	return toolbarBottom > nativeZoneTop && top < nativeZoneBottom;
}

function shouldUseMobileDockedFallback(
	floating: ToolbarPositionResult,
	toolbarHeight: number,
	anchorRect: ToolbarRect,
	nativeMenuSide: NativeSelectionMenuSide,
	gap: number
): boolean {
	const ourSide = floating.isBelowAnchor ? "bottom" : "top";
	const nativeOccupiedSide = nativeMenuSide === "above" ? "top" : "bottom";
	if (ourSide === nativeOccupiedSide) {
		return true;
	}

	if (
		!floatingClearsAnchor(
			floating.top,
			toolbarHeight,
			anchorRect,
			gap,
			floating.isBelowAnchor
		)
	) {
		return true;
	}

	if (toolbarOverlapsAnchor(floating.top, toolbarHeight, anchorRect, gap)) {
		return true;
	}

	return toolbarOverlapsNativeMenu(
		floating.top,
		toolbarHeight,
		anchorRect,
		nativeMenuSide,
		gap
	);
}

export function computeToolbarPosition({
	anchorRect,
	anchorRects,
	anchorPoint,
	containerWidth,
	containerHeight,
	toolbarWidth,
	toolbarHeight,
	mobile,
	insetTop = 0,
	insetBottom = 0,
	edgeMargin = TOOLBAR_EDGE_MARGIN,
	gap = TOOLBAR_GAP,
	arrowPadding = TOOLBAR_ARROW_PADDING,
	preferredSide = "top",
	align = "center",
}: ToolbarPositionOptions): ToolbarPositionResult {
	const normalizedRects = normalizeAnchorRects(anchorRect, anchorRects);
	const sideSelectionBounds =
		normalizedRects.length > 1
			? {
				top: Math.min(...normalizedRects.map((rect) => rect.top)),
				left: Math.min(...normalizedRects.map((rect) => rect.left)),
				bottom: Math.max(...normalizedRects.map((rect) => rect.bottom)),
				right: Math.max(...normalizedRects.map((rect) => rect.right)),
				width: 0,
				height: 0,
			}
			: anchorRect;
	if (normalizedRects.length > 1) {
		sideSelectionBounds.width = sideSelectionBounds.right - sideSelectionBounds.left;
		sideSelectionBounds.height = sideSelectionBounds.bottom - sideSelectionBounds.top;
	}
	if (mobile) {
		const minLeft = edgeMargin;
		const maxLeft = containerWidth - edgeMargin - toolbarWidth;
		const idealLeft = (containerWidth - toolbarWidth) / 2;
		const left = clamp(idealLeft, minLeft, maxLeft);
		return createDockedPosition(left, anchorRect);
	}

	const side = chooseFloatingSide(
		sideSelectionBounds,
		containerHeight,
		toolbarHeight,
		gap,
		edgeMargin,
		insetTop,
		insetBottom,
		preferredSide
	);
	const activeAnchorRect = chooseAnchorRectForSide(normalizedRects, side, anchorPoint);
	const anchorX = getAnchorX(activeAnchorRect, anchorPoint, align);
	const minLeft = edgeMargin;
	const maxLeft = containerWidth - edgeMargin - toolbarWidth;
	const idealLeft = align === "center"
		? anchorX - toolbarWidth / 2
		: align === "end"
			? anchorX - toolbarWidth
			: anchorX;
	const left = clamp(idealLeft, minLeft, maxLeft);

	return computeFloatingPlacement({
		activeAnchorRect,
		anchorX,
		left,
		side,
		containerHeight,
		toolbarWidth,
		toolbarHeight,
		insetTop,
		insetBottom,
		edgeMargin,
		gap,
		arrowPadding,
	});
}

export function createEventBinder() {
	const listeners: Array<() => void> = [];

	return {
		bind(
			target: EventTarget | null | undefined,
			event: string,
			handler: EventListenerOrEventListenerObject,
			options?: AddEventListenerOptions | boolean
		) {
			if (!target?.addEventListener || !target?.removeEventListener) {
				return;
			}
			target.addEventListener(event, handler, options);
			listeners.push(() => target.removeEventListener(event, handler, options));
		},
		dispose() {
			for (const dispose of listeners.splice(0)) {
				dispose();
			}
		},
	};
}

/** Cross-realm safe (EPUB iframe / popout) event target resolution. */
export function getEventTargetNode(target: unknown): Node | null {
	if (target == null || typeof target !== "object") {
		return null;
	}
	const node = target as Node;
	return typeof node.nodeType === "number" ? node : null;
}

export function getEventTargetElement(target: unknown): Element | null {
	const node = getEventTargetNode(target);
	if (!node) {
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

export function isEventOutsideToolbar(toolbarEl: HTMLElement | undefined, event: Event): boolean {
	const target = getEventTargetNode(event.target);
	return Boolean(toolbarEl && target && !toolbarEl.contains(target));
}

const OBSIDIAN_FLOATING_UI_SELECTOR =
	".menu, .modal-container, .modal, .popover, .suggestion-container, .dropdown-menu";

export function isEventInsideObsidianFloatingUi(event: Event): boolean {
	const element = getEventTargetElement(event.target);
	return Boolean(element?.closest(OBSIDIAN_FLOATING_UI_SELECTOR));
}

/** True when a pointer event should dismiss the selection toolbar (outside toolbar and floating UI). */
export function shouldDismissToolbarOnPointerDown(
	toolbarEl: HTMLElement | undefined,
	event: Event
): boolean {
	const target = getEventTargetNode(event.target);
	if (!target) {
		return false;
	}
	if (toolbarEl?.contains(target)) {
		return false;
	}
	if (isEventInsideObsidianFloatingUi(event)) {
		return false;
	}
	return true;
}

let sessionMobilePopoverPos: { left: number; top: number } | null = null;

export function getSessionMobilePopoverPosition(): { left: number; top: number } | null {
	return sessionMobilePopoverPos;
}

export function setSessionMobilePopoverPosition(pos: { left: number; top: number } | null): void {
	sessionMobilePopoverPos = pos;
}

export function getMobileSafeBounds(viewportEl: HTMLElement): {
	minLeft: number;
	maxRight: number;
	minTop: number;
	maxBottom: number;
	availableWidth: number;
	availableHeight: number;
} {
	const wsBounds = getWorkspaceBounds();
	const containerRect = viewportEl.getBoundingClientRect();
	const vv = typeof window !== "undefined" ? window.visualViewport : null;
	const vvWidth = vv?.width ?? (typeof window !== "undefined" ? window.innerWidth : containerRect.width);
	const vvHeight = vv?.height ?? (typeof window !== "undefined" ? window.innerHeight : containerRect.height);
	const vvLeft = vv?.offsetLeft ?? 0;
	const vvTop = vv?.offsetTop ?? 0;

	const safeLeft = 12;
	const safeRight = 12;
	const safeTop = wsBounds.top || 12;
	const safeBottom = wsBounds.bottom || 12;

	const globalMinLeft = vvLeft + safeLeft;
	const globalMaxRight = vvLeft + vvWidth - safeRight;
	const globalMinTop = vvTop + safeTop;
	const globalMaxBottom = vvTop + vvHeight - safeBottom;

	const minLeft = Math.max(8, globalMinLeft - containerRect.left);
	const maxRight = Math.min(containerRect.width - 8, globalMaxRight - containerRect.left);
	const minTop = Math.max(8, globalMinTop - containerRect.top);
	const maxBottom = Math.min(containerRect.height - 8, globalMaxBottom - containerRect.top);

	const availableWidth = Math.max(160, maxRight - minLeft);
	const availableHeight = Math.max(160, maxBottom - minTop);

	return {
		minLeft,
		maxRight,
		minTop,
		maxBottom,
		availableWidth,
		availableHeight,
	};
}

export function clampPopoverPosition(
	pos: { left: number; top: number },
	popoverWidth: number,
	popoverHeight: number,
	viewportEl: HTMLElement,
	isMobile: boolean
): { left: number; top: number } {
	if (isMobile) {
		const bounds = getMobileSafeBounds(viewportEl);
		const clampMinLeft = bounds.minLeft;
		const clampMaxLeft = Math.max(bounds.minLeft, bounds.maxRight - popoverWidth);
		const clampMinTop = bounds.minTop;
		const clampMaxTop = Math.max(bounds.minTop, bounds.maxBottom - popoverHeight);

		return {
			left: Math.round(clamp(pos.left, clampMinLeft, clampMaxLeft)),
			top: Math.round(clamp(pos.top, clampMinTop, clampMaxTop)),
		};
	}

	const vpWidth = viewportEl.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 500);
	const vpHeight = viewportEl.clientHeight || (typeof window !== "undefined" ? window.innerHeight : 500);

	return {
		left: Math.round(clamp(pos.left, 0, Math.max(0, vpWidth - popoverWidth))),
		top: Math.round(clamp(pos.top, 0, Math.max(0, vpHeight - popoverHeight))),
	};
}

export function computeMobilePopoverCenterPosition(
	popoverWidth: number,
	popoverHeight: number,
	viewportEl: HTMLElement
): { left: number; top: number; maxHeight: number; maxWidth: number } {
	const bounds = getMobileSafeBounds(viewportEl);
	const actualWidth = Math.min(popoverWidth, bounds.availableWidth);
	const actualHeight = Math.min(popoverHeight, bounds.availableHeight);

	const centerLeft = bounds.minLeft + (bounds.availableWidth - actualWidth) / 2;
	const centerTop = bounds.minTop + (bounds.availableHeight - actualHeight) / 2;

	const clamped = clampPopoverPosition(
		{ left: centerLeft, top: centerTop },
		actualWidth,
		actualHeight,
		viewportEl,
		true
	);

	return {
		left: clamped.left,
		top: clamped.top,
		maxHeight: bounds.availableHeight,
		maxWidth: bounds.availableWidth,
	};
}
