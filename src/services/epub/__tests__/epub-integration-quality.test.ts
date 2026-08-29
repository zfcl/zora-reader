import { describe, expect, it, vi } from "vitest";
import {
	normalizeBookNotesExportAppendMap,
	normalizeBookNotesExportExcerptFields,
	readBookNotesExportAppendPath,
	writeBookNotesExportAppendPath,
} from "../epub-book-notes-export-store";
import {
	dedupeBookshelfMembershipEntries,
	normalizeBookshelfMembershipEntries,
} from "../epub-bookshelf-membership-store";
import {
	clampBookshelfProgress,
	getBookshelfProgressToneClass,
} from "../bookshelf-progress-display";
import { buildReaderChapterStyles } from "../reader-chapter-styles";
import { resolveReaderHighlightTint, READER_HIGHLIGHT_TINT_MAP } from "../reader-highlight-tints";
import { EpubProgressStore, normalizePendingProgressPayload } from "../epub-progress-store";
import { DEFAULT_EPUB_EXCERPT_SETTINGS } from "../epub-excerpt-settings";
import { getBuiltinBookNotesExportTemplate } from "../book-notes-export/builtin-templates";
import { renderBookNotesTemplate } from "../book-notes-export/template-renderer";
import {
	applyRendererLayoutAttributes,
	computePaginatorLayoutMetrics,
	isFoliatePaginatorRenderer,
} from "../reader-renderer-layout";
import {
	ReaderPaginatedLayoutRecoveryScheduler,
	shouldRecoverPaginatedLayout,
} from "../reader-paginated-layout-recovery";
import {
	buildReaderNavigationRectTargets,
	resolveReaderSourceNavigationViewTargets,
} from "../reader-navigation-targets";
import {
	cloneEpubLocalReaderData,
	createEmptyEpubLocalReaderData,
	isDestinationFileAlreadyExistsError,
} from "../epub-local-data-clone";
import { matchesBookshelfSearchQuery } from "../bookshelf-search-match";
import { parseSearchQuery } from "../../../utils/search-parser";
import {
	buildAnnotationRenderSignature,
	composeVisibleAnnotationHighlight,
	createRenderedFoliateAnnotation,
	isSameFoliateAnnotation,
	shouldRenderAnnotationAsConceal,
} from "../reader-annotation-model";
import {
	buildHighlightClickInfo,
	createAnchorPointFromRect,
	createViewportRectFromRawRect,
	createViewportRectFromRawRectList,
	extractRangeClientRects,
	hasUsableOverlayRects,
} from "../reader-highlight-geometry";
import { resolveHighlightOverlayRects } from "../reader-highlight-overlay-rects";
import { getReaderHighlightIdentityKey } from "../highlight/highlight-identity";
import {
	orderVisibleHighlightFrames,
	resolveHighlightSectionIndexForView,
} from "../reader-highlight-section-resolver";
import {
	getReferenceBadgeColor,
	ReaderAnnotationOverlayRenderer,
} from "../reader-annotation-overlayer";
import {
	listEpubUnifiedLocalDataCandidatePaths,
	resolveEpubUnifiedLocalDataPath,
} from "../epub-unified-local-data-paths";
import {
	EpubUnifiedLocalDataSessionCache,
	readWithTransientParseRetry,
	writeUnifiedLocalDataAtomically,
} from "../epub-unified-local-data-store";
import { mapRawRectToViewport } from "../reader-viewport-rect-map";
import { resolveHighlightViewportGeometry } from "../reader-highlight-viewport-geometry";
import {
	canReuseExistingBook,
	resolveBookLoadRestoredPosition,
} from "../epub-reader-book-load-helpers";
import { peelEmbeddedScanIndexFromUnifiedData } from "../epub-unified-local-data-read";
import { normalizeLocalReaderData } from "../epub-local-data-normalize";

describe("epub-book-notes-export-store", () => {
	it("round-trips per-book append targets", () => {
		const initial = writeBookNotesExportAppendPath({}, "Books/demo.epub", "Notes/demo.md");
		expect(readBookNotesExportAppendPath(initial, "Books/demo.epub")).toBe("Notes/demo.md");
		const cleared = writeBookNotesExportAppendPath(initial, "Books/demo.epub", null);
		expect(readBookNotesExportAppendPath(cleared, "Books/demo.epub")).toBeNull();
	});

	it("normalizes append map keys and drops empty values", () => {
		expect(
			normalizeBookNotesExportAppendMap({
				" Books/a.epub ": " Notes/a.md ",
				"Books/b.epub": "  ",
			})
		).toEqual({
			"Books/a.epub": "Notes/a.md",
		});
	});

	it("normalizes legacy template settings into excerpt fields", () => {
		const normalized = normalizeBookNotesExportExcerptFields({
			bookNotesExportTemplate: "template2",
			bookNotesExportTargetMode: "append",
			bookNotesExportIncludeHighlight: false,
		});
		expect(normalized.bookNotesExportLegacyTemplate).toBe("callout");
		expect(normalized.bookNotesExportTargetMode).toBe("append");
		expect(normalized.bookNotesExportIncludeHighlight).toBe(false);
		expect(normalized.bookNotesExportTemplatePath).toBe(
			DEFAULT_EPUB_EXCERPT_SETTINGS.bookNotesExportTemplatePath
		);
	});

	it("clears template path when it falls outside the configured folder", () => {
		const normalized = normalizeBookNotesExportExcerptFields({
			bookNotesExportTemplateFolder: "Library/templates",
			bookNotesExportTemplatePath: "Weave EPUB/Export templates/excerpt-digest-b.md",
		});
		expect(normalized.bookNotesExportTemplateFolder).toBe("Library/templates");
		expect(normalized.bookNotesExportTemplatePath).toBeNull();
	});
});

describe("reader-paginated-layout-recovery", () => {
	it("detects foliate paginator renderers safely", () => {
		expect(isFoliatePaginatorRenderer({ tagName: "foliate-paginator", setAttribute: () => undefined })).toBe(
			true
		);
		expect(isFoliatePaginatorRenderer({ tagName: "", setAttribute: () => undefined })).toBe(false);
	});

	it("requires a sufficiently narrow iframe viewport before recovering layout", () => {
		expect(
			shouldRecoverPaginatedLayout({
				hostWidth: 800,
				frameViewportWidths: [760],
			})
		).toBe(false);
		expect(
			shouldRecoverPaginatedLayout({
				hostWidth: 800,
				frameViewportWidths: [220],
			})
		).toBe(true);
	});

	it("bumps recovery tokens when cancelled", () => {
		const scheduler = new ReaderPaginatedLayoutRecoveryScheduler();
		const first = scheduler.schedule(() => undefined);
		scheduler.bumpToken();
		expect(scheduler.isCurrentToken(first)).toBe(false);
	});
});

describe("reader-highlight-geometry", () => {
	it("builds viewport rects and click payloads from raw geometry", () => {
		const rect = createViewportRectFromRawRect({ left: 10, top: 20, width: 40, height: 8 });
		expect(rect?.right).toBe(50);
		expect(
			createViewportRectFromRawRectList([
				{ left: 0, top: 0, width: 10, height: 5 },
				{ left: 20, top: 4, width: 6, height: 6 },
			])
		).toMatchObject({ left: 0, top: 0, right: 26, bottom: 10 });
		expect(createAnchorPointFromRect(rect)).toEqual({ x: 30, y: 24 });
		expect(hasUsableOverlayRects([{ width: 0, height: 0 }])).toBe(false);
		expect(hasUsableOverlayRects([{ width: 4, height: 0 }])).toBe(true);
		const clickInfo = buildHighlightClickInfo(
			{
				cfiRange: "cfi",
				color: "yellow",
				text: "Quote",
				sourceFile: "Notes/demo.md",
			},
			{ rect: rect! }
		);
		expect(clickInfo.text).toBe("Quote");
		expect(clickInfo.interactionTarget).toBe("highlight");
	});
});

describe("reader-annotation-model", () => {
	const persistent = {
		cfiRange: "cfi",
		color: "yellow",
		text: "Quote",
		sourceFile: "Notes/demo.md",
	};

	it("renders temporary source-focus flashes alone so they can expire cleanly", () => {
		const rendered = createRenderedFoliateAnnotation({
			persistentHighlight: persistent,
			temporaryHighlight: { ...persistent, color: "blue", temporary: true },
			currentStrikethroughPresentation: "highlight",
			colorScheme: "light",
			temporarilyRevealedConcealmentKeys: new Set(),
		});
		expect(rendered.annotation.color).toBe("blue");
		expect(rendered.annotation.focusColor).toBeUndefined();
		expect(rendered.renderSignature).toContain("focus:");
		expect(rendered.renderSignature).not.toContain("focus:blue");
		expect(
			isSameFoliateAnnotation(
				rendered.annotation,
				composeVisibleAnnotationHighlight(undefined, {
					...persistent,
					color: "blue",
					temporary: true,
				})
			)
		).toBe(true);
	});

	it("tracks concealment and temporary reveal in render signatures", () => {
		const concealed = composeVisibleAnnotationHighlight({
			...persistent,
			presentation: "conceal",
		});
		const concealedKey = getReaderHighlightIdentityKey(concealed);
		const hiddenSignature = buildAnnotationRenderSignature({
			annotation: concealed,
			currentStrikethroughPresentation: "highlight",
			colorScheme: "dark",
			temporarilyRevealedConcealmentKeys: new Set(),
		});
		const revealedSignature = buildAnnotationRenderSignature({
			annotation: concealed,
			currentStrikethroughPresentation: "highlight",
			colorScheme: "dark",
			temporarilyRevealedConcealmentKeys: new Set([concealedKey]),
		});
		expect(hiddenSignature).toContain("concealment:concealed");
		expect(revealedSignature).toContain("concealment:revealed");
		expect(
			shouldRenderAnnotationAsConceal(
				{ ...persistent, style: "strikethrough" },
				"conceal"
			)
		).toBe(true);
	});
});

describe("reader-highlight-section-resolver", () => {
	it("prefers visible direct section matches and falls back to text resolution", () => {
		const visibleFrames = [
			{ index: 1, frameDocument: {} as Document },
			{ index: 2, frameDocument: {} as Document },
		];
		const port = {
			getSectionIndexForCfi: vi.fn((cfi: string) => (cfi === "cfi-1" ? 1 : 2)),
			resolveRangeInLoadedSection: vi.fn(
				(_cfi: string, _doc: Document, sectionIndex: number, textHint?: string) =>
					textHint && sectionIndex === 2 ? ({} as Range) : null
			),
		};

		expect(
			resolveHighlightSectionIndexForView(
				{ cfiRange: "cfi-1", color: "yellow", sourceFile: "", text: "needle" },
				visibleFrames,
				port
			)
		).toBe(1);
		expect(
			resolveHighlightSectionIndexForView(
				{ cfiRange: "cfi-2", color: "yellow", sourceFile: "", text: "needle" },
				visibleFrames,
				port
			)
		).toBe(2);
	});
});

describe("reader-annotation-overlayer", () => {
	it("maps reference heat to badge colors", () => {
		expect(getReferenceBadgeColor(0)).toBe("#667eea");
		expect(getReferenceBadgeColor(25)).toBe("#eab308");
		expect(getReferenceBadgeColor(55)).toBe("#f97316");
		expect(getReferenceBadgeColor(90)).toBe("#ef4444");
	});

	it("renders styled overlays and comment markers via ports", () => {
		const onCommentMarkerClick = vi.fn();
		const renderer = new ReaderAnnotationOverlayRenderer({
			resolveHighlightTint: () => "rgb(37, 99, 235)",
			getColorScheme: () => "light",
			getObsidianCSSVar: (_name, fallback) => fallback,
			getConcealmentPalette: () => ({ base: "#111", stripe: "#222", border: "#333" }),
			onCommentMarkerClick,
			onReferenceBadgeClick: vi.fn(),
		});
		const rects = [{ left: 10, top: 12, width: 24, height: 10 }];
		const styled = renderer.createStyledAnnotationOverlay(rects, "underline", "blue");
		expect(styled.tagName.toLowerCase()).toBe("g");
		const concealed = renderer.createConcealmentOverlay(rects);
		expect(concealed.querySelectorAll("rect").length).toBeGreaterThan(1);
		const marker = renderer.createCommentMarkerOverlay(
			{
				cfiRange: "cfi",
				color: "yellow",
				text: "Quote",
				sourceFile: "",
				value: "cfi",
				hasCommentDivider: true,
			},
			rects
		);
		const hitArea = marker.querySelector('[data-weave-comment-marker="hit-area"]');
		expect(hitArea).toBeTruthy();
		hitArea?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(onCommentMarkerClick).toHaveBeenCalledTimes(1);
	});
});

describe("reader-highlight-overlay-rects", () => {
	it("extracts client rects from DOM ranges", () => {
		const range = {
			getClientRects: () => [{ left: 4, top: 6, width: 8, height: 3 }],
			getBoundingClientRect: () => ({ left: 4, top: 6, width: 8, height: 3 }),
		} as unknown as Range;
		expect(extractRangeClientRects(range)).toEqual([{ left: 4, top: 6, width: 8, height: 3 }]);
	});

	it("resolves overlay rects from visible frames and text hints", () => {
		const visibleFrames = [
			{ index: 0, frameDocument: document.implementation.createHTMLDocument("a") },
			{ index: 1, frameDocument: document.implementation.createHTMLDocument("b") },
		];
		const port = {
			getSectionIndexForCfi: vi.fn(() => 1),
			resolveRangeInLoadedSection: vi.fn(
				(_cfi: string, _doc: Document, sectionIndex: number) =>
					sectionIndex === 1
						? ({
								getClientRects: () => [{ left: 1, top: 2, width: 3, height: 4 }],
								getBoundingClientRect: () => ({ left: 1, top: 2, width: 3, height: 4 }),
							} as Range)
						: null
			),
		};
		expect(
			resolveHighlightOverlayRects(
				{ cfiRange: "cfi", text: "needle", chapterIndex: 1 },
				visibleFrames,
				port
			)
		).toEqual([{ left: 1, top: 2, width: 3, height: 4 }]);
		expect(orderVisibleHighlightFrames(visibleFrames, 1)[0]?.index).toBe(1);
	});
});

describe("epub-unified-local-data-store", () => {
	it("serializes writes through a per-key session lock", async () => {
		const app = {} as import("obsidian").App;
		const cache = new EpubUnifiedLocalDataSessionCache<string>(app, "state.json");
		const order: string[] = [];
		const first = cache.runWithWriteLock(async () => {
			order.push("first-start");
			await new Promise((resolve) => window.setTimeout(resolve, 20));
			order.push("first-end");
		});
		const second = cache.runWithWriteLock(async () => {
			order.push("second");
		});
		await Promise.all([first, second]);
		expect(order).toEqual(["first-start", "first-end", "second"]);
	});

	it("retries transient parse failures and writes atomically", async () => {
		let attempts = 0;
		const recovered = await readWithTransientParseRetry(async () => {
			attempts += 1;
			if (attempts < 2) {
				throw new Error("partial write");
			}
			return "ok";
		}, { delayMs: 1 });
		expect(recovered).toBe("ok");
		expect(attempts).toBe(2);

		const writes: string[] = [];
		const adapter = {
			write: vi.fn(async (path: string, content: string) => {
				writes.push(`${path}:${content}`);
			}),
			rename: vi.fn(async (from: string, to: string) => {
				writes.push(`rename:${from}->${to}`);
			}),
		};
		await writeUnifiedLocalDataAtomically(adapter, "state.json", "{\"version\":1}");
		expect(writes).toEqual(["state.json.tmp:{\"version\":1}", "rename:state.json.tmp->state.json"]);
	});
});

describe("epub-unified-local-data-paths", () => {
	it("lists canonical and legacy unified local data paths", () => {
		const app = {};
		const paths = listEpubUnifiedLocalDataCandidatePaths(app, "weave-epub-reader");
		const canonical = resolveEpubUnifiedLocalDataPath(app, "weave-epub-reader");
		expect(paths[0]).toBe(canonical);
		expect(paths.length).toBeGreaterThanOrEqual(1);
	});
});

describe("reader-renderer-layout", () => {
	it("computes double-page fit width metrics", () => {
		const metrics = computePaginatorLayoutMetrics({
			renderContainerWidth: 1000,
			rendererClientWidth: 1000,
			currentWidthMode: "fit",
			currentLayoutMode: "double",
			currentFlowMode: "paginated",
			currentPageMargin: 24,
		});
		expect(metrics.paginatorMargin).toBe(16);
		expect(metrics.inlineSize).toBe("484px");
	});

	it("ignores renderer layout when tagName is missing", () => {
		const setAttribute = vi.fn();
		const render = vi.fn();
		applyRendererLayoutAttributes(
			{ tagName: "", setAttribute, render },
			{
				hostWidth: 800,
				inlineSize: "720px",
				paginatorMargin: 16,
				gap: "7%",
			},
			"paginated",
			"single",
			"standard"
		);
		expect(setAttribute).not.toHaveBeenCalled();
		expect(render).not.toHaveBeenCalled();
	});

	it("applies paginator attributes for scrolled flow", () => {
		const setAttribute = vi.fn();
		const render = vi.fn();
		applyRendererLayoutAttributes(
			{ tagName: "foliate-paginator", setAttribute, render },
			{
				hostWidth: 800,
				inlineSize: "720px",
				paginatorMargin: 16,
				gap: "4%",
			},
			"scrolled",
			"single",
			"standard"
		);
		expect(setAttribute).toHaveBeenCalledWith("flow", "scrolled");
		expect(render).toHaveBeenCalled();
	});
});

describe("epub-bookshelf-membership-store", () => {
	it("dedupes membership entries by path and keeps earliest addedAt", () => {
		const deduped = dedupeBookshelfMembershipEntries([
			{ path: "Books/a.epub", addedAt: 20 },
			{ path: "Books/a.epub", addedAt: 10, customCoverPath: "Covers/a.png" },
		]);
		expect(deduped).toEqual([
			{ path: "Books/a.epub", addedAt: 10, customCoverPath: "Covers/a.png" },
		]);
	});

	it("drops invalid membership rows", () => {
		expect(
			normalizeBookshelfMembershipEntries([
				{ path: " Books/a.epub ", addedAt: 5 },
				{ path: "  ", addedAt: 1 },
				null,
			])
		).toEqual([{ path: "Books/a.epub", addedAt: 5 }]);
	});
});

describe("bookshelf-progress-display", () => {
	it("maps progress values to tone classes", () => {
		expect(getBookshelfProgressToneClass(0)).toBe("is-progress-start");
		expect(getBookshelfProgressToneClass(92)).toBe("is-progress-complete");
		expect(clampBookshelfProgress(120)).toBe(100);
	});
});

describe("reader-chapter-styles", () => {
	it("builds chapter stylesheet with typography tokens", () => {
		const styleSource = document.createElement("div");
		document.body.appendChild(styleSource);
		const styles = buildReaderChapterStyles({
			styleSource,
			currentLineHeight: 1.8,
			currentLetterSpacing: 0.02,
			currentPageMargin: 24,
			currentWidthMode: "standard",
			colorScheme: "light",
		});
		styleSource.remove();
		expect(styles).toContain("--weave-reader-font-family");
		expect(styles).toContain("line-height: 1.8");
	});
});

describe("epub-progress-store", () => {
	it("debounces writes and flushes the latest pending payload", async () => {
		vi.useFakeTimers();
		const writes: Array<{ bookId: string; position: string }> = [];
		const store = new EpubProgressStore({
			resolveCanonicalBookId: async (bookId) => bookId,
			getBook: async (bookId) =>
				({
					id: bookId,
					currentPosition: { chapterIndex: 0, cfi: "", percent: 0 },
					readingStats: { lastReadTime: 0, createdTime: 0 },
				}) as import("../types").EpubBook,
			writeBookState: async (bookId, state) => {
				writes.push({ bookId, position: state.currentPosition.cfi });
			},
		});

		store.scheduleSave("book-1", { chapterIndex: 0, cfi: "cfi-1", percent: 1 });
		store.scheduleSave("book-1", { chapterIndex: 0, cfi: "cfi-2", percent: 2 });
		await vi.advanceTimersByTimeAsync(300);
		expect(writes).toEqual([{ bookId: "book-1", position: "cfi-2" }]);
		vi.useRealTimers();
	});

	it("normalizes legacy pending payloads", () => {
		expect(
			normalizePendingProgressPayload({
				bookId: "book-1",
				position: { chapterIndex: 1, cfi: "cfi", percent: 12 },
			})?.position.cfi
		).toBe("cfi");
		expect(normalizePendingProgressPayload({ bookId: "book-1" })).toBeNull();
	});
});

describe("reader-highlight-tints", () => {
	it("resolves named highlight colors for the active color scheme", () => {
		expect(resolveReaderHighlightTint("dark", "blue")).toBe(
			READER_HIGHLIGHT_TINT_MAP.dark.blue
		);
		expect(resolveReaderHighlightTint("light")).toBe(READER_HIGHLIGHT_TINT_MAP.light.yellow);
	});
});

describe("reader-navigation-targets", () => {
	it("prefers section href for generic loader text navigation", () => {
		const targets = resolveReaderSourceNavigationViewTargets({
			resolved: { index: 2, cfi: "cfi", href: "chapter-2.xhtml" },
			rawCfi: "cfi",
			rawHref: "",
			canonical: "cfi",
			rawTarget: "cfi",
			text: "needle",
			usesGenericBookLoader: true,
			sectionEntryCfi: "entry-cfi",
			sectionHref: "chapter-2.xhtml",
			fallbackTarget: "fallback",
		});
		expect(targets.viewTarget).toBe("chapter-2.xhtml");
	});

	it("collects navigation rect targets from primary and current anchors", () => {
		expect(
			buildReaderNavigationRectTargets({
				cfi: "cfi-primary",
				currentCfi: "cfi-current",
				currentHref: "chapter.xhtml",
			})
		).toEqual(["cfi-primary", "cfi-current", "chapter.xhtml"]);
	});
});

describe("epub-local-data-clone", () => {
	it("creates empty local reader snapshots and deep clones payloads", () => {
		const empty = createEmptyEpubLocalReaderData();
		expect(empty.version).toBe(1);
		expect(empty.books).toEqual({});
		const source = { books: { a: { state: { cfi: "x" } } } };
		const cloned = cloneEpubLocalReaderData(source);
		cloned.books.a.state.cfi = "y";
		expect(source.books.a.state.cfi).toBe("x");
	});

	it("detects adapter overwrite-on-rename errors", () => {
		expect(isDestinationFileAlreadyExistsError(new Error("Destination file already exists."))).toBe(
			true
		);
		expect(isDestinationFileAlreadyExistsError(new Error("other"))).toBe(false);
	});
});

describe("bookshelf-search-match", () => {
	const baseBook = {
		displayTitle: "Demo Book",
		metaText: "Author · EPUB",
		statsLine: "12%",
		name: "demo.epub",
		folder: "Books",
		author: "Author",
		formatLabel: "EPUB",
		readingStatus: "reading",
		localizedReadingStatus: "Reading",
		path: "Books/demo.epub",
		addedAt: Date.parse("2026-01-15T12:00:00.000Z"),
	};

	it("matches free-text and field filters", () => {
		const query = parseSearchQuery(
			"demo author:Author status:reading format:epub created:2026-01-01..2026-01-31"
		);
		expect(matchesBookshelfSearchQuery(baseBook, query)).toBe(true);
		expect(matchesBookshelfSearchQuery(baseBook, parseSearchQuery("-demo"))).toBe(false);
	});
});

describe("book-notes export integration", () => {
	it("renders export markdown from normalized excerpt settings", () => {
		const excerptSettings = normalizeBookNotesExportExcerptFields({
			bookNotesExportIncludeHighlight: true,
			bookNotesExportLegacyTemplate: "classic",
		});
		const rendered = renderBookNotesTemplate({
			templateSource: getBuiltinBookNotesExportTemplate(excerptSettings.bookNotesExportLegacyTemplate),
			context: {
				book: {
					title: "Integration Demo",
					author: "Author",
					publisher: "",
					isbn: "",
					filePath: "Books/demo.epub",
					sourceId: "",
				},
				export: {
					notesTitle: "Notes",
					exportedAt: "2026-06-13T00:00:00.000Z",
				},
				chapters: [
					{
						index: 0,
						title: "Chapter 1",
						label: "Chapter 1",
						highlights: [
							{
								text: "Quoted line",
								commentText: "",
								color: "yellow",
								style: "",
								styleLabel: "Highlight",
								createdTimeFormatted: "2026-06-13 10:00",
								excerptId: "excerpt-1",
								cfiRange: "cfi",
								chapterIndex: 0,
								chapterTitle: "Chapter 1",
								excerptHeading: "Excerpt 1",
								blockquote: "> Quoted line",
								pageLabel: "p. 1",
							},
						],
					},
				],
			},
			trimBlocks: excerptSettings.bookNotesExportTrimBlocks,
		});
		expect(rendered).toContain("# Notes");
		expect(rendered).toContain("Quoted line");
	});
});

describe("reader-viewport-rect-map", () => {
	it("offsets raw rects by iframe client bounds", () => {
		const iframe = document.createElement("iframe");
		Object.defineProperty(iframe, "getBoundingClientRect", {
			value: () => ({ left: 10, top: 20, width: 300, height: 400 }),
		});
		const rect = mapRawRectToViewport(iframe, { left: 5, top: 6, width: 40, height: 12 });
		expect(rect?.left).toBe(15);
		expect(rect?.top).toBe(26);
	});
});

describe("reader-highlight-viewport-geometry", () => {
	it("resolves geometry from the preferred visible frame", () => {
		const frameDocument = document.implementation.createHTMLDocument("frame");
		const range = frameDocument.createRange();
		const geometry = resolveHighlightViewportGeometry("cfi-range", {
			highlight: { text: "needle", chapterIndex: 1 },
			frames: [{ index: 1, frameDocument, frameElement: null }],
			port: {
				getSectionIndexForCfi: () => 1,
				resolveRangeInLoadedSection: () => range,
			},
			createViewportRect: () => ({
				top: 1,
				left: 2,
				bottom: 3,
				right: 4,
				width: 2,
				height: 2,
			}),
			createViewportRectList: () => [],
		});
		expect(geometry?.rect.left).toBe(2);
	});
});

describe("epub-reader-book-load-helpers", () => {
	it("reuses books when source fingerprint matches vault stat", () => {
		const book = {
			id: "book-1",
			filePath: "Books/demo.epub",
			metadata: { title: "Demo", author: "", chapterCount: 1 },
			currentPosition: { chapterIndex: 0, cfi: "", percent: 0 },
			readingStats: { totalReadTime: 0, lastReadTime: 0, createdTime: 0 },
			sourceSize: 100,
			sourceMtime: 200,
		};
		expect(
			canReuseExistingBook(book, { stat: { size: 100, mtime: 200 } } as import("obsidian").TFile)
		).toBe(true);
		expect(
			canReuseExistingBook(book, { stat: { size: 101, mtime: 200 } } as import("obsidian").TFile)
		).toBe(false);
	});

	it("prefers reusable in-memory progress before loading stored progress", async () => {
		const reusablePosition = { chapterIndex: 2, cfi: "cfi-reused", percent: 40 };
		const restored = await resolveBookLoadRestoredPosition({
			hasProgressCapability: true,
			reusableBook: {
				id: "book-1",
				filePath: "Books/demo.epub",
				metadata: { title: "Demo", author: "", chapterCount: 1 },
				currentPosition: reusablePosition,
				readingStats: { totalReadTime: 0, lastReadTime: 0, createdTime: 0 },
			},
			loadedBook: {
				id: "book-1",
				filePath: "Books/demo.epub",
				metadata: { title: "Demo", author: "", chapterCount: 1 },
				currentPosition: { chapterIndex: 0, cfi: "", percent: 0 },
				readingStats: { totalReadTime: 0, lastReadTime: 0, createdTime: 0 },
			},
			loadProgress: async () => ({ chapterIndex: 0, cfi: "cfi-stored", percent: 10 }),
		});
		expect(restored?.cfi).toBe("cfi-reused");
	});
});

describe("epub-unified-local-data-read", () => {
	it("peels embedded scan index out of unified local snapshots", () => {
		const { data, embeddedScanIndex } = peelEmbeddedScanIndexFromUnifiedData({
			version: 1,
			updatedAt: 0,
			scanIndex: [{ path: "Books/demo.epub", name: "demo", folder: "/", size: 1, mtime: 2 }],
		});
		expect(embeddedScanIndex).toHaveLength(1);
		expect(data.scanIndex).toBeUndefined();
	});
});

describe("epub-local-data-normalize", () => {
	it("normalizes unified local reader snapshots with safe defaults", () => {
		const normalized = normalizeLocalReaderData({
			version: 1,
			updatedAt: 123,
			books: {
				"book-1": {
					descriptor: {
						id: "book-1",
						filePath: "Books/demo.epub",
						metadata: { title: "Demo", author: "Author", chapterCount: 1 },
					},
				},
			},
		});
		expect(normalized.updatedAt).toBe(123);
		expect(normalized.books?.["book-1"]?.descriptor?.metadata.title).toBe("Demo");
	});
});
