import { beforeEach, describe, expect, it, vi } from "vitest";
import { Vault } from "obsidian";
import { getReaderHighlightIdentityKey } from "../highlight/highlight-identity";
import {
	buildAnnotationRenderSignature,
	createReaderFoliateAnnotation,
	createRenderedFoliateAnnotation,
	isSameFoliateAnnotation,
} from "../reader-annotation-model";
import { FoliateReaderService } from "../FoliateReaderService";

vi.mock("obsidian", async () => {
	const actual = await vi.importActual<typeof import("obsidian")>("obsidian");

	class MockTFile {
		path: string;
		basename: string;
		extension: string;

		constructor(path: string) {
			this.path = path;
			const parts = path.split("/");
			const name = parts[parts.length - 1] || path;
			const dotIndex = name.lastIndexOf(".");
			this.basename = dotIndex >= 0 ? name.slice(0, dotIndex) : name;
			this.extension = dotIndex >= 0 ? name.slice(dotIndex + 1) : "";
		}
	}

	class MockVault {
		adapter = {
			readBinary: vi.fn(async () => new ArrayBuffer(0)),
		};
		getAbstractFileByPath(path: string) {
			return new MockTFile(path);
		}
	}

	return {
		...actual,
		TFile: MockTFile,
		Vault: MockVault,
		Platform: { isDesktopApp: true },
	};
});

function createMockApp(buffer: ArrayBuffer) {
	return {
		vault: {
			adapter: {
				readBinary: vi.fn(async () => buffer),
			},
			getAbstractFileByPath: vi.fn((path: string) => ({
				path,
				basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") || path,
				extension: path.split(".").pop() || "",
			})),
		} as unknown as Vault,
	} as any;
}

describe("FoliateReaderService comment marker layering", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("keeps a single foliate annotation for commented highlights so the shared overlayer key does not overwrite prior layers", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const highlight = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				style: "underline" as const,
				text: "Selection text for testing",
				hasCommentDivider: true,
				presentation: "highlight" as const,
			};

			const rendered = createRenderedFoliateAnnotation({
				persistentHighlight: highlight,
				currentStrikethroughPresentation: service.currentStrikethroughPresentation,
				colorScheme: service.getCurrentColorScheme(),
				temporarilyRevealedConcealmentKeys: (service as any).temporarilyRevealedConcealmentTimers,
			});

			expect(rendered.annotation).toMatchObject({
				style: "underline",
				hasCommentDivider: true,
			});
			expect(rendered.renderSignature).toContain("style:underline");
			expect(rendered.renderSignature).toContain("comment:visible");
		} finally {
			service.destroy();
		}
	});

	it("keeps multiple highlights that share a canonical CFI but have different excerpt ids", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const sharedCfi = "epubcfi(/6/26)";
			const highlights = [
				{
					cfiRange: sharedCfi,
					color: "yellow",
					text: "第一段摘录",
					excerptId: "excerpt-a",
					chapterIndex: 12,
					presentation: "highlight" as const,
				},
				{
					cfiRange: sharedCfi,
					color: "green",
					text: "第二段摘录",
					excerptId: "excerpt-b",
					chapterIndex: 12,
					presentation: "highlight" as const,
				},
			];

			vi.spyOn(service as any, "resolveHighlightAnchorCfi").mockImplementation(
				(async (...args: any[]) => {
					const [highlight] = args as [{ excerptId?: string; cfiRange: string }];
					if (highlight.excerptId === "excerpt-a") {
						return "epubcfi(/6/26!/4/2/1,/1:0,/1:4)";
					}
					if (highlight.excerptId === "excerpt-b") {
						return "epubcfi(/6/26!/4/2/2,/1:0,/1:4)";
					}
					return highlight.cfiRange;
				}) as any
			);
			vi.spyOn((service as any).parser, "getSectionIndexForCfi").mockReturnValue(12);
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([{ index: 12 }]);
			const view = {
				addAnnotation: vi.fn(async (..._args: any[]) => undefined),
				deleteAnnotation: vi.fn(async () => undefined),
				removeEventListener: vi.fn(),
				close: vi.fn(),
				remove: vi.fn(),
			};
			(service as any).foliateView = view;

			await service.applyHighlights(highlights);

			expect((service as any).highlightDataMap.size).toBe(2);
			expect(view.addAnnotation).toHaveBeenCalledTimes(2);
			const values = view.addAnnotation.mock.calls.map(
				(call) => (call[0] as unknown as { value?: string }).value
			);
			expect(new Set(values).size).toBe(2);
			const renderedValues = view.addAnnotation.mock.calls.map(
				(call) => (call[0] as unknown as { value?: string; excerptId?: string }).value
			);
			expect(renderedValues).toEqual(
				expect.arrayContaining([
					"epubcfi(/6/26!/4/2/1,/1:0,/1:4)",
					"epubcfi(/6/26!/4/2/2,/1:0,/1:4)",
				])
			);
		} finally {
			service.destroy();
		}
	});

	it("falls back to excerpt text when foliate supplies empty annotation rects", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const doc = document.implementation.createHTMLDocument("novel");
			const paragraph = doc.createElement("p");
			paragraph.textContent = "不能要太高悬赏";
			doc.body.appendChild(paragraph);

			const frame = {
				index: 12,
				href: "txt-section-13.xhtml",
				frameDocument: doc,
				frameElement: null,
				frame: {
					frameDocument: doc,
					window: doc.defaultView as Window,
					cfiFromRange: () => null,
				},
			};
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([frame]);
			vi.spyOn((service as any).parser, "resolveRangeInLoadedSection").mockImplementation(
				((...args: any[]) => {
					const [_cfi, document, index, textHint] = args as [string, Document, number, string?];
					if (index !== 12 || !textHint) {
						return null;
					}
					const range = document.createRange();
					range.selectNodeContents(paragraph);
					return range;
				}) as any
			);

			const annotation = createReaderFoliateAnnotation({
				cfiRange: "epubcfi(/6/26!/4/2/4,/17:15,/17:22)",
				color: "green",
				text: "不能要太高悬赏",
				chapterIndex: 12,
				presentation: "highlight",
			});
			vi.spyOn(service as any, "resolveHighlightOverlayRects").mockReturnValue([
				{ left: 10, top: 20, width: 120, height: 18 },
			]);
			const compositeSpy = vi.spyOn(service as any, "createCompositeAnnotationOverlay");
			const draw = vi.fn((factory: (rects: unknown[], options?: unknown) => SVGElement) => {
				factory([]);
			});

			await (service as any).drawAnnotation(annotation, draw);

			expect(compositeSpy).toHaveBeenCalledTimes(1);
			const overlayRects = compositeSpy.mock.calls[0]?.[1] as Array<{
				width: number;
				height: number;
			}>;
			expect(overlayRects).toEqual([{ left: 10, top: 20, width: 120, height: 18 }]);
		} finally {
			service.destroy();
		}
	});

	it("draws the base style and comment marker together inside one composite overlay", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const annotation = createReaderFoliateAnnotation(
				{
					cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
					color: "purple",
					style: "wavy",
					text: "Selection text for testing",
					hasCommentDivider: true,
					presentation: "highlight",
				},
				{
					focusColor: "blue",
				}
			);
			const renderer = (service as any).annotationOverlayRenderer;
			const markerSpy = vi.spyOn(renderer, "createCommentMarkerOverlay");
			const styleSpy = vi.spyOn(renderer, "createStyledAnnotationOverlay");
			const focusSpy = vi.spyOn(renderer, "createTemporaryFocusOverlay");
			const compositeSpy = vi.spyOn(service as any, "createCompositeAnnotationOverlay");
			const draw = vi.fn((factory: (rects: unknown[], options?: unknown) => SVGElement) => {
				factory([
					{
						left: 10,
						top: 10,
						width: 24,
						height: 12,
					},
				]);
			});

			await (service as any).drawAnnotation(annotation, draw);

			expect(draw).toHaveBeenCalledTimes(1);
			expect(compositeSpy).toHaveBeenCalledTimes(1);
			expect(markerSpy).toHaveBeenCalledTimes(1);
			expect(styleSpy).toHaveBeenCalledTimes(1);
			expect(focusSpy).toHaveBeenCalledTimes(1);
		} finally {
			service.destroy();
		}
	});

	it("draws a reference badge inside the composite overlay when a styled highlight has multiple references", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const annotation = createReaderFoliateAnnotation({
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				style: "underline",
				text: "Selection text for testing",
				referenceCount: 5,
				referenceHeat: 60,
				presentation: "highlight",
			});
			const renderer = (service as any).annotationOverlayRenderer;
			const badgeSpy = vi.spyOn(renderer, "createReferenceBadgeOverlay");
			const styleSpy = vi.spyOn(renderer, "createStyledAnnotationOverlay");
			const compositeSpy = vi.spyOn(service as any, "createCompositeAnnotationOverlay");
			const draw = vi.fn((factory: (rects: unknown[], options?: unknown) => SVGElement) => {
				factory([
					{
						left: 10,
						top: 10,
						width: 24,
						height: 12,
					},
				]);
			});

			await (service as any).drawAnnotation(annotation, draw);

			expect(draw).toHaveBeenCalledTimes(1);
			expect(compositeSpy).toHaveBeenCalledTimes(1);
			expect(styleSpy).toHaveBeenCalledTimes(1);
			expect(badgeSpy).toHaveBeenCalledTimes(1);
		} finally {
			service.destroy();
		}
	});

	it("keeps the reference badge geometry inside the highlight bounds so it is not clipped", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const annotation = createReaderFoliateAnnotation({
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				referenceCount: 5,
				referenceHeat: 60,
				presentation: "highlight",
			});

			const overlay = (service as any).createReferenceBadgeOverlay(annotation, [
				{
					left: 10,
					top: 10,
					width: 24,
					height: 12,
				},
			]) as SVGGElement;

			const background = overlay.querySelector('[data-weave-reference-badge="background"]');
			const hitArea = overlay.querySelector('[data-weave-reference-badge="hit-area"]');
			expect(background).toBeTruthy();
			expect(hitArea).toBeTruthy();

			const x = Number(background?.getAttribute("x"));
			const y = Number(background?.getAttribute("y"));
			const width = Number(background?.getAttribute("width"));
			const height = Number(background?.getAttribute("height"));

			expect(x).toBeGreaterThanOrEqual(10);
			expect(y).toBeGreaterThanOrEqual(10);
			expect(x + width).toBeLessThanOrEqual(34);
			expect(y + height).toBeLessThanOrEqual(22);
		} finally {
			service.destroy();
		}
	});

	it("treats reference count changes as an annotation render change", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const base = createReaderFoliateAnnotation({
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				referenceCount: 1,
				presentation: "highlight",
			});
			const updated = createReaderFoliateAnnotation({
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				referenceCount: 3,
				presentation: "highlight",
			});

			expect(isSameFoliateAnnotation(base, updated)).toBe(false);
			expect(
				buildAnnotationRenderSignature({
					annotation: base,
					currentStrikethroughPresentation: service.currentStrikethroughPresentation,
					colorScheme: service.getCurrentColorScheme(),
					temporarilyRevealedConcealmentKeys: (service as any).temporarilyRevealedConcealmentTimers,
				})
			).not.toBe(
				buildAnnotationRenderSignature({
					annotation: updated,
					currentStrikethroughPresentation: service.currentStrikethroughPresentation,
					colorScheme: service.getCurrentColorScheme(),
					temporarilyRevealedConcealmentKeys: (service as any).temporarilyRevealedConcealmentTimers,
				})
			);
		} finally {
			service.destroy();
		}
	});

	it("routes reference badge clicks through the highlight click callback chain when highlight geometry is available", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const notifySpy = vi.spyOn(service as any, "notifyHighlightClick");
			(service as any).foliateView = {
				addEventListener: vi.fn(),
				close: vi.fn(),
				dispatchEvent: vi.fn(),
				remove: vi.fn(),
				removeEventListener: vi.fn(),
			};
			const fallbackDispatchSpy = vi.spyOn((service as any).foliateView, "dispatchEvent");
			const info = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				sourceFile: "",
				interactionTarget: "reference-badge",
				rect: {
					top: 10,
					left: 10,
					bottom: 22,
					right: 34,
					width: 24,
					height: 12,
				},
			};
			vi.spyOn(service, "getHighlightClickInfo").mockReturnValue(info as any);

			(service as any).notifyReferenceBadgeClick(info.cfiRange);

			expect(notifySpy).toHaveBeenCalledWith(info);
			expect(fallbackDispatchSpy).toHaveBeenCalledTimes(1);
		} finally {
			service.destroy();
		}
	});

	it("notifies dedicated reference badge listeners from click-time badge geometry even when runtime lookup is unavailable", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			(service as any).foliateView = {
				addEventListener: vi.fn(),
				close: vi.fn(),
				dispatchEvent: vi.fn(),
				remove: vi.fn(),
				removeEventListener: vi.fn(),
			};
			const callback = vi.fn();
			service.onReferenceBadgeClick(callback);
			const highlight = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				sourceFile: "",
				presentation: "highlight",
			};
			(service as any).highlightDataMap.set("epubcfi(/6/2!/4/2,/1:0,/1:9)", highlight);
			vi.spyOn(service, "getHighlightClickInfo").mockReturnValue(null);

			(service as any).notifyReferenceBadgeClick("epubcfi(/6/2!/4/2,/1:0,/1:9)", {
				rect: {
					top: 11,
					left: 22,
					bottom: 19,
					right: 32,
					width: 10,
					height: 8,
				},
				rects: [
					{
						top: 10,
						left: 10,
						bottom: 22,
						right: 34,
						width: 24,
						height: 12,
					},
				],
				anchorPoint: {
					x: 27,
					y: 15,
				},
			});

			expect(callback).toHaveBeenCalledWith(
				expect.objectContaining({
					cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
					interactionTarget: "reference-badge",
					rect: expect.objectContaining({
						left: 22,
						top: 11,
					}),
					anchorPoint: expect.objectContaining({
						x: 27,
						y: 15,
					}),
				})
			);
			expect((service as any).foliateView.dispatchEvent).toHaveBeenCalledTimes(1);
		} finally {
			service.destroy();
		}
	});

	it("preserves reading-note style and captures base highlight color when merging with a normal highlight", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const existing = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				sourceFile: "Notes/book.md",
				presentation: "highlight" as const,
			};
			const incoming = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "purple",
				style: "reading-note" as const,
				text: "Selection text for testing",
				sourceFile: "Notes/读书笔记/book.md",
				excerptId: "eid123",
				presentation: "highlight" as const,
			};

			const merged = (service as any).mergeHighlights(existing, incoming);
			expect(merged.style).toBe("reading-note");
			expect(merged.baseHighlightColor).toBe("yellow");
			expect(merged.excerptId).toBe("eid123");
			expect(merged.sourceFile).toBe("Notes/读书笔记/book.md");
		} finally {
			service.destroy();
		}
	});

	it("preserves reading-note style when merged with an incoming highlight that has undefined style", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const existing = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "purple",
				style: "reading-note" as const,
				text: "Selection text for testing",
				sourceFile: "Notes/读书笔记/book.md",
				excerptId: "eid123",
				presentation: "highlight" as const,
			};
			const incoming = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "purple",
				style: undefined,
				text: "Selection text for testing",
				sourceFile: "",
				presentation: "highlight" as const,
			};

			const merged = (service as any).mergeHighlights(existing, incoming);
			expect(merged.style).toBe("reading-note");
			expect(merged.excerptId).toBe("eid123");
		} finally {
			service.destroy();
		}
	});
});
