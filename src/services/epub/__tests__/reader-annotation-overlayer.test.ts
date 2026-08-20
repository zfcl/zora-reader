import { describe, expect, it, vi } from "vitest";
import {
	ReaderAnnotationOverlayRenderer,
	computeNoteMarkerPosition,
	isRectIntersecting,
} from "../reader-annotation-overlayer";
import type { ReaderFoliateAnnotation } from "../reader-annotation-model";

describe("ReaderAnnotationOverlayRenderer", () => {
	const mockPorts = {
		resolveHighlightTint: vi.fn((color?: string) => color || "#fde047"),
		getObsidianCSSVar: vi.fn((_varName: string, fallback: string) => fallback),
		getConcealmentPalette: vi.fn(() => ({
			base: "#000000",
			stripe: "#333333",
			border: "#666666",
		})),
		onCommentMarkerClick: vi.fn(),
		onNoteMarkerClick: vi.fn(),
		onReferenceBadgeClick: vi.fn(),
	};

	const sampleRects = [
		{ left: 50, top: 100, width: 200, height: 20, right: 250, bottom: 120 },
	];

	it("creates subtle hint background and note marker for reading-note style", () => {
		const renderer = new ReaderAnnotationOverlayRenderer(mockPorts);
		const annotation: ReaderFoliateAnnotation = {
			value: "epubcfi(/6/2!/4/2)",
			cfiRange: "epubcfi(/6/2!/4/2)",
			color: "purple",
			style: "reading-note",
		};

		const overlay = renderer.createCompositeAnnotationOverlay(annotation, sampleRects);
		expect(overlay).toBeTruthy();

		// Reading note hint background check
		const hintGroup = overlay.querySelector('[data-zora-reading-note-hint="group"]');
		expect(hintGroup).toBeTruthy();
		const hintTint = hintGroup?.querySelector('[data-zora-reading-note-hint="tint"]');
		expect(hintTint).toBeTruthy();
		expect(hintTint?.getAttribute("fill")).toBe("#8b5cf6");
		expect(Number(hintTint?.getAttribute("fill-opacity"))).toBeCloseTo(0.08, 2);

		// Note Marker check: visible size 8px × 8px
		const markerGroup = overlay.querySelector('[data-zora-note-marker="group"]');
		expect(markerGroup).toBeTruthy();

		const badge = markerGroup?.querySelector('[data-zora-note-marker="badge"]');
		expect(badge).toBeTruthy();
		expect(badge?.getAttribute("width")).toBe("8");
		expect(badge?.getAttribute("height")).toBe("8");
		expect(badge?.getAttribute("fill")).toBe("#8b5cf6");
		// Horizontal center at targetRect.right (250): x = 250 - 8/2 = 246
		expect(Number(badge?.getAttribute("x"))).toBe(246);
		// y = 100 - 8 - 3 = 89
		expect(Number(badge?.getAttribute("y"))).toBe(89);

		// Hit area check: size 18px, centered
		const hitArea = markerGroup?.querySelector('[data-zora-note-marker="hit-area"]');
		expect(hitArea).toBeTruthy();
		expect(hitArea?.getAttribute("width")).toBe("18");
		expect(hitArea?.getAttribute("height")).toBe("18");
		// 246 - (18 - 8)/2 = 241
		expect(Number(hitArea?.getAttribute("x"))).toBe(241);
		// 89 - 5 = 84
		expect(Number(hitArea?.getAttribute("y"))).toBe(84);

		// Does not create comment marker for reading-note
		const commentMarker = overlay.querySelector('[data-weave-comment-marker]');
		expect(commentMarker).toBeNull();
	});

	it("coexists with normal highlight color when baseHighlightColor is present", () => {
		const renderer = new ReaderAnnotationOverlayRenderer(mockPorts);
		const annotation: ReaderFoliateAnnotation = {
			value: "epubcfi(/6/2!/4/2)",
			cfiRange: "epubcfi(/6/2!/4/2)",
			color: "purple",
			style: "reading-note",
			baseHighlightColor: "yellow",
		};

		const mockOverlayer = {
			Overlayer: {
				highlight: vi.fn(() => {
					const el = document.createElementNS("http://www.w3.org/2000/svg", "g");
					el.setAttribute("data-test-highlight", "yellow");
					return el;
				}),
			},
		};

		const overlay = renderer.createCompositeAnnotationOverlay(
			annotation,
			sampleRects,
			mockOverlayer as any
		);
		expect(overlay).toBeTruthy();

		// Renders normal highlight via overlayer
		expect(mockOverlayer.Overlayer.highlight).toHaveBeenCalled();
		expect(mockPorts.resolveHighlightTint).toHaveBeenCalledWith("yellow");

		// Also renders note marker
		const markerGroup = overlay.querySelector('[data-zora-note-marker="group"]');
		expect(markerGroup).toBeTruthy();
	});

	describe("computeNoteMarkerPosition and collision avoidance", () => {
		it("aligns marker center with selection endpoint directly above text line", () => {
			const rects = [{ left: 50, top: 100, width: 150, height: 20 }]; // right: 200
			const pos = computeNoteMarkerPosition(rects, 8, {
				viewportBounds: { width: 800, height: 600 },
			});
			expect(pos).toBeTruthy();
			expect(pos?.chosenFallback).toBe("top-end-center");
			// Center at 200 -> x = 200 - 8/2 = 196
			expect(pos?.x).toBe(196);
			expect(pos?.y).toBe(100 - 8 - 3); // 89

			// Center check
			expect(pos!.x + 8 / 2).toBe(200);

			const markerBox = {
				left: pos!.x,
				top: pos!.y,
				right: pos!.x + 8,
				bottom: pos!.y + 8,
			};
			// Invariant: marker bottom is strictly above the text top
			expect(markerBox.bottom).toBe(89 + 8);
			expect(markerBox.bottom).toBeLessThan(100);

			const selectionBox = {
				left: rects[0].left,
				top: rects[0].top,
				right: rects[0].left + rects[0].width,
				bottom: rects[0].top + rects[0].height,
			};
			expect(isRectIntersecting(markerBox, selectionBox)).toBe(false);
		});

		it("guarantees zero collision with text and following words ('... if I want.' followed by 'I am...')", () => {
			// Selected text: "... if I want."
			const selectionRect = { left: 50, top: 100, width: 150, height: 20 }; // right: 200, bottom: 120
			// Unselected next word: "I am..." on the same line
			const adjacentNextWord = { left: 204, top: 100, width: 100, height: 20 }; // right: 304, bottom: 120

			const pos = computeNoteMarkerPosition([selectionRect], 8, {
				viewportBounds: { width: 800, height: 600 },
				adjacentRects: [adjacentNextWord],
			});
			expect(pos).toBeTruthy();
			expect(pos?.chosenFallback).toBe("top-end-center");
			expect(pos?.x).toBe(196); // 200 - 4
			expect(pos?.y).toBe(89); // 100 - 8 - 3

			const markerBox = {
				left: pos!.x,
				top: pos!.y,
				right: pos!.x + 8,
				bottom: pos!.y + 8,
			};

			// Must not collide with selected text
			const selBox = {
				left: selectionRect.left,
				top: selectionRect.top,
				right: selectionRect.left + selectionRect.width,
				bottom: selectionRect.top + selectionRect.height,
			};
			expect(isRectIntersecting(markerBox, selBox)).toBe(false);

			// Must not collide with unselected next text
			const nextBox = {
				left: adjacentNextWord.left,
				top: adjacentNextWord.top,
				right: adjacentNextWord.left + adjacentNextWord.width,
				bottom: adjacentNextWord.top + adjacentNextWord.height,
			};
			expect(isRectIntersecting(markerBox, nextBox)).toBe(false);
		});

		it("falls back to top-end-aligned when center exceeds viewport right edge", () => {
			const rects = [{ left: 50, top: 100, width: 200, height: 18 }]; // ends at x=250
			// Viewport width 252: center would be at x=246, right edge 254 > 252
			const pos = computeNoteMarkerPosition(rects, 8, {
				viewportBounds: { width: 252, height: 600 },
			});
			expect(pos).toBeTruthy();
			expect(pos?.chosenFallback).toBe("top-end-aligned");
			expect(pos?.x).toBe(250 - 8); // 242
			expect(pos?.y).toBe(100 - 8 - 3);

			const markerBox = {
				left: pos!.x,
				top: pos!.y,
				right: pos!.x + 8,
				bottom: pos!.y + 8,
			};
			const selectionBox = {
				left: rects[0].left,
				top: rects[0].top,
				right: rects[0].left + rects[0].width,
				bottom: rects[0].top + rects[0].height,
			};
			expect(isRectIntersecting(markerBox, selectionBox)).toBe(false);
		});
	});
});
