import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Platform, TFile } from "obsidian";
import { getReaderHighlightIdentityKey } from "../highlight/highlight-identity";
import {
	buildAnnotationRenderSignature,
	createReaderFoliateAnnotation,
	createRenderedFoliateAnnotation,
	isSameFoliateAnnotation,
	shouldRenderAnnotationAsConceal,
} from "../reader-annotation-model";
import { FoliateReaderService } from "../FoliateReaderService";
import {
	normalizeDesktopFoliateSandboxValue,
	resetMobileBlobIframePatchStateForTests,
} from "../foliate-runtime-patches";
import * as blobUrlText from "../../../utils/blob-url-text";
import { logger } from "../../../utils/logger";
import { flushThemeManagerForTests } from "../../../utils/theme-detection";
import { READER_SOURCE_LOCATE_FOCUS_DURATION_MS } from "../../ui/source-locate-overlay-timing";

async function createSampleEpubBuffer(): Promise<ArrayBuffer> {
	const zip = new JSZip();
	zip.file("mimetype", "application/epub+zip");
	zip.file(
		"META-INF/container.xml",
		`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
	<rootfiles>
		<rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
	</rootfiles>
</container>`
	);
	zip.file(
		"OPS/content.opf",
		`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="BookId" xmlns="http://www.idpf.org/2007/opf">
	<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
		<dc:title>Foliate Sample</dc:title>
		<dc:creator>Author F</dc:creator>
		<dc:contributor opf:role="trl" xmlns:opf="http://www.idpf.org/2007/opf">Translator F</dc:contributor>
		<dc:publisher>Weave Press</dc:publisher>
		<dc:language>zh-CN</dc:language>
		<dc:identifier id="BookId">ISBN 978-7-111-22222-3</dc:identifier>
		<dc:description>用于阅读器测试的示例简介。</dc:description>
		<dc:date>2025-01</dc:date>
		<dc:subject>测试</dc:subject>
		<dc:subject>阅读</dc:subject>
		<meta name="calibre:series" content="阅读器测试系列" />
	</metadata>
	<manifest>
		<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
		<item id="chapter-1" href="text/chapter1.xhtml" media-type="application/xhtml+xml" />
	</manifest>
	<spine>
		<itemref idref="chapter-1" />
	</spine>
</package>`
	);
	zip.file(
		"OPS/nav.xhtml",
		`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
	<body>
		<nav epub:type="toc">
			<ol>
				<li>
					<a href="text/chapter1.xhtml">Chapter 1</a>
					<ol>
						<li><a href="text/chapter1.xhtml#sec-1">Section 1</a></li>
					</ol>
				</li>
			</ol>
		</nav>
	</body>
</html>`
	);
	zip.file(
		"OPS/text/chapter1.xhtml",
		`<html xmlns="http://www.w3.org/1999/xhtml">
	<head><title>Chapter 1</title></head>
	<body>
		<h1 id="sec-1">Chapter 1</h1>
		<p id="para-1">Selection text for testing.</p>
	</body>
</html>`
	);
	return zip.generateAsync({ type: "arraybuffer" });
}

async function createMultiParagraphChapterSampleEpubBuffer(): Promise<ArrayBuffer> {
	const zip = new JSZip();
	zip.file("mimetype", "application/epub+zip");
	zip.file(
		"META-INF/container.xml",
		`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
	<rootfiles>
		<rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
	</rootfiles>
</container>`
	);
	zip.file(
		"OPS/content.opf",
		`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="BookId" xmlns="http://www.idpf.org/2007/opf">
	<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
		<dc:title>Multi Paragraph Sample</dc:title>
		<dc:language>zh-CN</dc:language>
	</metadata>
	<manifest>
		<item id="chapter-1" href="text/chapter1.xhtml" media-type="application/xhtml+xml" />
	</manifest>
	<spine>
		<itemref idref="chapter-1" />
	</spine>
</package>`
	);
	zip.file(
		"OPS/text/chapter1.xhtml",
		`<html xmlns="http://www.w3.org/1999/xhtml">
	<head><title>Chapter 1</title></head>
	<body>
		<p>第一段：清晨的雾气还未散尽，街市已经醒了。</p>
		<p>第二段：小贩支起棚子，油锅里的香气先一步飘出来。</p>
		<p>第三段：行人踩着石板路，鞋底带起细碎的水声。</p>
		<p>第四段：远处钟楼敲过三下，一天才算真正开始。</p>
	</body>
</html>`
	);
	return zip.generateAsync({ type: "arraybuffer" });
}

async function createBrLayoutParagraphSampleEpubBuffer(): Promise<ArrayBuffer> {
	const zip = new JSZip();
	zip.file("mimetype", "application/epub+zip");
	zip.file(
		"META-INF/container.xml",
		`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
	<rootfiles>
		<rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
	</rootfiles>
</container>`
	);
	zip.file(
		"OPS/content.opf",
		`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="BookId" xmlns="http://www.idpf.org/2007/opf">
	<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
		<dc:title>BR Layout Sample</dc:title>
		<dc:language>zh-CN</dc:language>
	</metadata>
	<manifest>
		<item id="chapter-1" href="text/chapter1.xhtml" media-type="application/xhtml+xml" />
	</manifest>
	<spine>
		<itemref idref="chapter-1" />
	</spine>
</package>`
	);
	zip.file(
		"OPS/text/chapter1.xhtml",
		`<html xmlns="http://www.w3.org/1999/xhtml">
	<head><title>Chapter 1</title></head>
	<body>
		<div class="content">
			猪肠在滚水中汆烫后切段，口感弹牙而不腥。<br/>
			猪板油分成叶油与网油，前者清亮，后者香腻。<br/>
			叶油适合炒制时润锅，网油则常包入馅料蒸熟。<br/>
			不同部位油脂的风味差异，决定了菜肴的底味层次。
		</div>
		<div class="watermark">© 未经授权禁止转载 获取更多电子书：https://t.me/+WwC4dCWvXRDhOTNh | ID: EPUB_20240125002648</div>
	</body>
</html>`
	);
	return zip.generateAsync({ type: "arraybuffer" });
}

async function createInlineFootnoteSampleEpubBuffer(): Promise<ArrayBuffer> {
	const zip = new JSZip();
	zip.file("mimetype", "application/epub+zip");
	zip.file(
		"META-INF/container.xml",
		`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
	<rootfiles>
		<rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
	</rootfiles>
</container>`
	);
	zip.file(
		"OPS/content.opf",
		`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="BookId" xmlns="http://www.idpf.org/2007/opf">
	<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
		<dc:title>Inline Footnote Sample</dc:title>
		<dc:creator>Author F</dc:creator>
		<dc:language>zh-CN</dc:language>
	</metadata>
	<manifest>
		<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
		<item id="chapter-1" href="text/chapter1.xhtml" media-type="application/xhtml+xml" />
	</manifest>
	<spine>
		<itemref idref="chapter-1" />
	</spine>
</package>`
	);
	zip.file(
		"OPS/nav.xhtml",
		`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
	<body>
		<nav epub:type="toc">
			<ol>
				<li><a href="text/chapter1.xhtml">Chapter 1</a></li>
			</ol>
		</nav>
	</body>
</html>`
	);
	zip.file(
		"OPS/text/chapter1.xhtml",
		`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
	<head><title>Chapter 1</title></head>
	<body>
		<p>正文里的脚注引用<a href="#note-2" epub:type="noteref">2</a>继续正文。</p>
		<p id="note-2">2. 这是同章普通段落中的脚注正文。<a href="#ref-2">↩</a></p>
	</body>
</html>`
	);
	return zip.generateAsync({ type: "arraybuffer" });
}

async function createFootnoteSampleEpubBuffer(): Promise<ArrayBuffer> {
	const zip = new JSZip();
	zip.file("mimetype", "application/epub+zip");
	zip.file(
		"META-INF/container.xml",
		`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
	<rootfiles>
		<rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
	</rootfiles>
</container>`
	);
	zip.file(
		"OPS/content.opf",
		`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="BookId" xmlns="http://www.idpf.org/2007/opf">
	<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
		<dc:title>Footnote Sample</dc:title>
		<dc:creator>Author F</dc:creator>
		<dc:language>zh-CN</dc:language>
	</metadata>
	<manifest>
		<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
		<item id="chapter-1" href="text/chapter1.xhtml" media-type="application/xhtml+xml" />
		<item id="backnotes" href="text/backnotes.xhtml" media-type="application/xhtml+xml" />
	</manifest>
	<spine>
		<itemref idref="chapter-1" />
		<itemref idref="backnotes" linear="no" />
	</spine>
</package>`
	);
	zip.file(
		"OPS/nav.xhtml",
		`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
	<body>
		<nav epub:type="toc">
			<ol>
				<li><a href="text/chapter1.xhtml">Chapter 1</a></li>
				<li><a href="text/backnotes.xhtml">Backnotes</a></li>
			</ol>
		</nav>
	</body>
</html>`
	);
	zip.file(
		"OPS/text/chapter1.xhtml",
		`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
	<head><title>Chapter 1</title></head>
	<body>
		<p>这里是正文<a id="ref-1" href="backnotes.xhtml#note-1" epub:type="noteref">[1]</a>，用于测试脚注浮窗。</p>
	</body>
</html>`
	);
	zip.file(
		"OPS/text/backnotes.xhtml",
		`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
	<head><title>Backnotes</title></head>
	<body>
		<section epub:type="endnotes" role="doc-endnotes">
			<ol>
				<li id="note-1">
					<p>这是来自真实 EPUB 书末尾注的正文内容。<a href="chapter1.xhtml#ref-1" role="doc-backlink">↩</a></p>
				</li>
			</ol>
		</section>
	</body>
</html>`
	);
	return zip.generateAsync({ type: "arraybuffer" });
}

function getBinarySize(binary: unknown): number {
	if (binary instanceof ArrayBuffer) {
		return binary.byteLength;
	}
	if (ArrayBuffer.isView(binary)) {
		return binary.byteLength;
	}
	if (Array.isArray(binary)) {
		return binary.length;
	}
	return 0;
}

function createMockApp(binary: unknown) {
	const createVaultFile = (path: string) => {
		const normalizedPath = path.replace(/\\/g, "/");
		const fileName = normalizedPath.split("/").pop() || "sample.epub";
		const folderPath = normalizedPath.includes("/")
			? normalizedPath.slice(0, normalizedPath.lastIndexOf("/"))
			: "";
		return Object.assign(Object.create(TFile.prototype), {
			path: normalizedPath,
			name: fileName,
			basename: fileName.replace(/\.[^.]+$/, ""),
			extension: "epub",
			parent: folderPath ? { path: folderPath } : null,
			stat: {
				size: getBinarySize(binary),
				mtime: Date.now(),
				ctime: Date.now(),
			},
		});
	};

	return {
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => createVaultFile(path)),
			readBinary: vi.fn(async () => binary),
		},
	};
}

describe("FoliateReaderService", () => {
	it("uses a deterministic fallback book id when no existing book id is provided", async () => {
		const binary = await createSampleEpubBuffer();
		const service = new FoliateReaderService(createMockApp(binary) as any);

		try {
			const first = await service.loadEpub("Books/foliate-sample.epub");
			const second = await service.loadEpub("Books/foliate-sample.epub");

			expect(first.id).toBe(second.id);
			expect(first.id).toMatch(/^epub-/);
		} finally {
			service.destroy();
		}
	});

	it("accepts an externally restored reading position before render", async () => {
		const binary = await createSampleEpubBuffer();
		const app = createMockApp(binary) as any;
		const service = new FoliateReaderService(app);

		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const restoredCfi = "epubcfi(/6/2!/4/2/6,/1:0,/1:8)";
			await service.setRestoredPosition?.({
				chapterIndex: 0,
				cfi: restoredCfi,
				percent: 50,
			});

			const currentPosition = service.getCurrentPosition();
			expect(currentPosition.cfi.startsWith("epubcfi(")).toBe(true);
			expect(currentPosition.cfi).not.toBe("");
			expect(currentPosition.cfi).not.toBe(service.getSectionHrefForCfi?.(currentPosition.cfi) || "");
		} finally {
			service.destroy();
		}
	});
});

class FakeFoliateViewElement extends HTMLElement {
	private contents: Array<{ index: number; doc: Document | null }> = [];
	goToCalls: unknown[] = [];

	renderer = Object.assign(document.createElement("div"), {
		setStyles: vi.fn(),
		render: vi.fn(),
		getContents: () => this.contents,
	});
	book: unknown = null;
	lastLocation: unknown = null;

	async open(book: unknown): Promise<void> {
		this.book = book;
		this.contents = [{ index: 0, doc: document }];
	}

	close(): void {}

	async goTo(target: unknown): Promise<void> {
		this.lastLocation = target;
		this.goToCalls.push(target);
	}

	async goToTextStart(): Promise<void> {
		this.lastLocation = "text-start";
	}
}

if (!customElements.get("foliate-view")) {
	customElements.define("foliate-view", FakeFoliateViewElement);
}

afterEach(() => {
	const themeCleanup = (window as Window & { __weaveThemeManagerCleanup?: (() => void) | null })
		.__weaveThemeManagerCleanup;
	if (typeof themeCleanup === "function") {
		themeCleanup();
	}
	vi.useRealTimers();
	vi.restoreAllMocks();
	document.body.innerHTML = "";
	document.body.className = "";
	document.documentElement.className = "";
});

async function waitForRafPasses(count = 1): Promise<void> {
	for (let index = 0; index < count; index += 1) {
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	}
}

async function withPlatformIsMobile<T>(value: boolean, run: () => Promise<T>): Promise<T> {
	const originalDescriptor = Object.getOwnPropertyDescriptor(Platform, "isMobile");
	Object.defineProperty(Platform, "isMobile", {
		configurable: true,
		value,
	});
	try {
		return await run();
	} finally {
		if (originalDescriptor) {
			Object.defineProperty(Platform, "isMobile", originalDescriptor);
		} else {
			(Platform as { isMobile?: boolean }).isMobile = undefined;
		}
	}
}

describe("FoliateReaderService", () => {
	it("loads EPUBs and exposes toc/search data through the foliate parser", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			const book = await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			expect(book.metadata.title).toBe("Foliate Sample");
			expect(book.metadata.author).toBe("Author F");
			expect(book.metadata.translator).toBe("Translator F");
			expect(book.metadata.identifier).toBe("ISBN 978-7-111-22222-3");
			expect(book.metadata.isbn).toBe("9787111222223");
			expect(book.metadata.description).toBe("用于阅读器测试的示例简介。");
			expect(book.metadata.publishDate).toBe("2025-01");
			expect(book.metadata.subjects).toEqual(["测试", "阅读"]);
			expect(book.metadata.series).toBe("阅读器测试系列");
			expect(book.metadata.chapterCount).toBe(1);

			const toc = await service.getTableOfContents();
			expect(toc).toHaveLength(1);
			expect(toc[0]?.label).toBe("Chapter 1");
			expect(toc[0]?.level).toBe(1);
			expect(toc[0]?.pageNumber).toBe(1);
			expect(toc[0]?.subitems?.[0]?.label).toBe("Section 1");
			expect(toc[0]?.subitems?.[0]?.level).toBe(2);
			expect(toc[0]?.subitems?.[0]?.pageNumber).toBe(1);

			const results = await service.searchText("Selection text for testing");
			expect(results).toHaveLength(1);
			expect(["Chapter 1", "Section 1"]).toContain(results[0]?.chapterTitle);
			expect(results[0]?.excerpt).toContain("Selection text for testing");
			expect(results[0]?.cfi.startsWith("epubcfi(")).toBe(true);

			expect(service.getChapterLocationLabel("root")).toBe("Chapter 1");
			expect(service.getChapterLocationLabel("leaf")).toBe("Section 1");
			expect(service.getChapterLocationLabel("full")).toBe("Chapter 1/Section 1");
		} finally {
			service.destroy();
		}
	});

	it("canonicalizes legacy readium locations into foliate cfi targets", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const legacyLocation = `readium:${encodeURIComponent(
				JSON.stringify({
					href: "OPS/text/chapter1.xhtml",
					locations: { fragments: ["sec-1"] },
					text: { highlight: "Chapter 1" },
				})
			)}`;

			const canonical = await service.canonicalizeLocation(legacyLocation, "Chapter 1");
			expect(canonical?.startsWith("epubcfi(")).toBe(true);
			expect(await service.getPageNumberFromCfi(canonical as string)).toBe(1);
		} finally {
			service.destroy();
		}
	});

	it("strips volatile runtime cfi assertions before reusing saved epub progress", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const results = await service.searchText("Selection text for testing");
			const stableCfi = results[0]?.cfi;
			expect(stableCfi?.startsWith("epubcfi(")).toBe(true);

			const volatileCfi = String(stableCfi).replace("/4,", "/4[UGI0-volatile-marker],");
			const normalizedStable = await service.canonicalizeLocation(String(stableCfi));
			const canonical = await service.canonicalizeLocation(volatileCfi);

			expect(canonical).toBe(normalizedStable);
			expect(canonical).not.toContain("UGI0-volatile-marker");
		} finally {
			service.destroy();
		}
	});

	it("degrades malformed CFIs to a stable section target instead of crashing EPUB open flow", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const malformedCfi = "epubcfi(/6/2!/4/999,/1:0,/1:9)";
			const stableStartCfi = service.getCurrentPosition().cfi;

			await expect(service.canonicalizeLocation(malformedCfi)).resolves.toBe(stableStartCfi);
			await expect(service.getPageNumberFromCfi(malformedCfi)).resolves.toBe(1);
		} finally {
			service.destroy();
		}
	});

	it("falls back to chapter href when foliate rejects a precise cfi target during navigation", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const container = document.createElement("div");
			document.body.appendChild(container);

			await service.renderTo(container);

			const view = container.querySelector("foliate-view") as FakeFoliateViewElement | null;
			expect(view).toBeTruthy();

			const viewInstance = view as FakeFoliateViewElement;
			const stableCfi = (await service.searchText("Selection text for testing"))[0]?.cfi as string;
			const fallbackHref = service.getSectionHrefForCfi(stableCfi);
			expect(fallbackHref).toBe("OPS/text/chapter1.xhtml");
			const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

			const beforeGoToCount = viewInstance.goToCalls.length;
			vi.spyOn(viewInstance, "goTo").mockImplementation(async (target: unknown) => {
				viewInstance.lastLocation = target;
				viewInstance.goToCalls.push(target);
				if (typeof target === "string" && target.startsWith("epubcfi(")) {
					throw new Error("TypeError: Cannot read properties of undefined (reading 'length')");
				}
			});

			await expect(service.navigateTo({ cfi: stableCfi })).resolves.toBeUndefined();

			const navigationCalls = (viewInstance.goToCalls ?? []).slice(beforeGoToCount);
			expect(navigationCalls[0]).toBe(stableCfi);
			expect(navigationCalls).toContain(fallbackHref);
			expect(service.getCurrentPosition().cfi).toBe(stableCfi);
			expect(warnSpy).toHaveBeenCalledWith(
				"[FoliateReaderService] EPUB navigation target failed, falling back to section href:",
				expect.objectContaining({
					primaryTarget: stableCfi,
					fallbackTarget: fallbackHref,
				})
			);
		} finally {
			service.destroy();
		}
	});

	it("canonicalizes section-base cfi targets into stable precise cfi values", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const baseCfi = "epubcfi(/6/2)";
			const canonical = await service.canonicalizeLocation(baseCfi);
			expect(canonical).toBeTruthy();
			expect(canonical).not.toBe(baseCfi);
			expect(String(canonical)).toContain("!");
			expect(await service.getPageNumberFromCfi(String(canonical))).toBe(1);
		} finally {
			service.destroy();
		}
	});

	it("resolves section-base spine cfis to section hrefs when parser cfi lookup is unavailable", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			vi.spyOn((service as any).parser, "getSectionHrefForCfi").mockReturnValue(null);
			expect((service as any).getSectionIndexFromSectionBaseCfi("epubcfi(/6/14)")).toBe(6);
			const fallback = (service as any).getSectionHrefFallbackTarget("epubcfi(/6/2)");
			expect(fallback).toBe("OPS/text/chapter1.xhtml");
		} finally {
			service.destroy();
		}
	});

	it("renders into a container without crashing when a foliate-view element is available", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const container = document.createElement("div");
			document.body.appendChild(container);

			await expect(service.renderTo(container)).resolves.toBeUndefined();
			expect(container.querySelector("foliate-view")).toBeTruthy();
		} finally {
			service.destroy();
		}
	});

	it("resets reader state when a follow-up EPUB load fails", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			expect(service.getCurrentPosition().cfi).not.toBe("");

			const loadError = new Error("load failed");
			vi.spyOn((service as any).parser, "load").mockRejectedValueOnce(loadError);

			await expect(service.loadEpub("Books/broken.epub", "broken-book")).rejects.toThrow(loadError);
			expect(service.getCurrentPosition()).toEqual({
				chapterIndex: 0,
				cfi: "",
				percent: 0,
			});
			expect(service.getCurrentChapterTitle()).toBe("");
			expect(service.getCurrentChapterHref?.()).toBe("");
			await expect(service.renderTo(document.createElement("div"))).rejects.toThrow(
				"FoliateReaderService not initialized yet"
			);
		} finally {
			service.destroy();
		}
	});

	it("cleans up partially created view state when foliate view open fails", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		const openError = new Error("open failed");
		let openSpy: ReturnType<typeof vi.spyOn> | undefined;
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			openSpy = vi
				.spyOn(FakeFoliateViewElement.prototype as any, "open")
				.mockRejectedValueOnce(openError);
			const container = document.createElement("div");
			document.body.appendChild(container);

			await expect(service.renderTo(container)).rejects.toThrow(openError);

			expect(openSpy).toHaveBeenCalledTimes(1);
			expect((service as any).foliateView).toBeNull();
			expect((service as any).renderContainer).toBeNull();
			expect((service as any).layoutChangeInFlight).toBe(false);
			expect(container.querySelector("foliate-view")).toBeNull();
			expect(container.dataset.foliate).toBeUndefined();
		} finally {
			openSpy?.mockRestore();
			service.destroy();
		}
	});

	it("does not inject custom root scrollbar styling into foliate reading documents", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const container = document.createElement("div");
			document.body.appendChild(container);

			await service.renderTo(container);

			const styleElement = document.head.querySelector(
				'style[data-weave-foliate-reader-style="true"]'
			) as HTMLStyleElement | null;
			expect(styleElement).toBeTruthy();
			const styleText = styleElement?.textContent || "";
			expect(styleText).not.toContain("scrollbar-color");
			expect(styleText).not.toContain("::-webkit-scrollbar");
			expect(styleText).not.toContain("scrollbar-width");
		} finally {
			service.destroy();
		}
	});

	it("intercepts foliate link events for footnote references instead of allowing default navigation", async () => {
		vi.restoreAllMocks();
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const container = document.createElement("div");
			document.body.appendChild(container);

			await service.renderTo(container);

			const view = (service as any).foliateView as FakeFoliateViewElement | null;
			expect(view).toBeTruthy();
			service.setFootnoteClickAction?.("preview");

			const anchor = document.createElement("a");
			anchor.setAttribute("href", "part0115_split_000.html#zhu87");
			anchor.textContent = "[87]";
			container.appendChild(anchor);
			expect((service as any).isFootnoteReference(anchor)).toBe(true);

			const linkEvent = {
				cancelable: true,
				defaultPrevented: false,
				currentTarget: view,
				detail: {
					a: anchor,
					href: "part0115_split_000.html#zhu87",
				},
				preventDefault() {
					this.defaultPrevented = true;
				},
			};

			(service as any).handleLinkEvent(linkEvent);

			expect(linkEvent.defaultPrevented).toBe(true);
			expect((service as any).footnotePreviewPinned).toBe(true);
		} finally {
			vi.useRealTimers();
			service.destroy();
		}
	});

	it("resets internal flow and layout state when renderTo switches back from scrolled to paginated", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any) as any;
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const container = document.createElement("div");
			document.body.appendChild(container);

			await service.renderTo(container, {
				flow: "scrolled",
				spread: "none",
			});
			expect(service.currentFlowMode).toBe("scrolled");
			expect(service.currentLayoutMode).toBe("paginated");

			await service.renderTo(container, {
				flow: "paginated",
				spread: "always",
			});
			expect(service.currentFlowMode).toBe("paginated");
			expect(service.currentLayoutMode).toBe("double");

			await service.renderTo(container, {
				flow: "paginated",
				spread: "none",
			});
			expect(service.currentFlowMode).toBe("paginated");
			expect(service.currentLayoutMode).toBe("paginated");
		} finally {
			service.destroy();
		}
	});

	it("defers the initial scrolled layout until the first chapter navigation has mounted", async () => {
		const service = new FoliateReaderService(
			createMockApp(await createSampleEpubBuffer()) as any
		) as any;
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const order: string[] = [];
			const originalNavigate = service.navigateViewWithFallback.bind(service);
			vi.spyOn(service, "applyRendererLayout").mockImplementation(() => {
				order.push("layout");
			});
			vi.spyOn(service, "navigateViewWithFallback").mockImplementation(
				async (...args: unknown[]) => {
					order.push("navigate");
					return originalNavigate(...args);
				}
			);

			await service.renderTo(document.createElement("div"), {
				flow: "scrolled",
				spread: "none",
			});

			expect(order).toContain("navigate");
			expect(order).toContain("layout");
			expect(order.indexOf("layout")).toBeGreaterThan(order.indexOf("navigate"));
		} finally {
			service.destroy();
		}
	});

	it("renders strikethrough as visible text strike and conceal presentation as conceal", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any) as any;
		try {
			expect(
				shouldRenderAnnotationAsConceal(
					{
						cfiRange: "readium:strike",
						presentation: "highlight",
						style: "strikethrough",
					},
					service.currentStrikethroughPresentation
				)
			).toBe(false);

			expect(
				shouldRenderAnnotationAsConceal(
					{
						cfiRange: "readium:legacy-conceal",
						presentation: "conceal",
						style: undefined,
					},
					service.currentStrikethroughPresentation
				)
			).toBe(true);
		} finally {
			service.destroy();
		}
	});

	it("reads visible frames from renderer.getContents in modern foliate runtime", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const container = document.createElement("div");
			document.body.appendChild(container);

			await service.renderTo(container);

			const frames = service.getVisibleFrames();
			expect(frames).toHaveLength(1);
			expect(frames[0]?.frameDocument).toBe(document);
		} finally {
			service.destroy();
		}
	});

	it("recomputes paginated fit width on resize instead of only rerendering stale layout", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any) as any;
		const container = document.createElement("div");
		document.body.appendChild(container);
		vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 760, 800));

		const renderer = document.createElement("foliate-paginator") as HTMLElement & {
			render: ReturnType<typeof vi.fn>;
			getContents: () => Array<{ index: number; doc: Document }>;
		};
		renderer.render = vi.fn();
		renderer.getContents = () => [];

		service.renderContainer = container;
		service.foliateView = { renderer, clientWidth: 0, offsetWidth: 0 } as any;
		service.currentWidthMode = "fit";
		service.currentLayoutMode = "paginated";
		service.currentFlowMode = "paginated";
		service.currentPageMargin = 48;

		service.resize(760, 800);

		expect(renderer.getAttribute("max-inline-size")).toBe("664px");
		expect(renderer.getAttribute("margin")).toBe("48px");
		expect(renderer.render).toHaveBeenCalled();
	});

	it("self-heals abnormally narrow paginated frame widths after resize", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any) as any;
		const container = document.createElement("div");
		document.body.appendChild(container);
		vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 900, 800));

		const frameDoc = document.implementation.createHTMLDocument("chapter");
		Object.defineProperty(frameDoc.documentElement, "clientWidth", {
			configurable: true,
			value: 136,
		});
		Object.defineProperty(frameDoc.body, "clientWidth", {
			configurable: true,
			value: 136,
		});

		const renderer = document.createElement("foliate-paginator") as HTMLElement & {
			render: ReturnType<typeof vi.fn>;
			getContents: () => Array<{ index: number; doc: Document }>;
		};
		renderer.render = vi.fn();
		renderer.getContents = () => [{ index: 0, doc: frameDoc }];

		service.renderContainer = container;
		service.foliateView = { renderer, clientWidth: 0, offsetWidth: 0 } as any;
		service.currentWidthMode = "fit";
		service.currentLayoutMode = "paginated";
		service.currentFlowMode = "paginated";
		service.currentPageMargin = 48;

		service.resize(900, 800);
		await waitForRafPasses(3);

		expect(renderer.render.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(renderer.getAttribute("max-inline-size")).toBe("804px");
	});

	it("navigates toc hrefs with raw href targets while still canonicalizing reader state", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const container = document.createElement("div");
			document.body.appendChild(container);

			await service.renderTo(container);

			const view = container.querySelector("foliate-view") as FakeFoliateViewElement | null;
			expect(view).toBeTruthy();

			const renderSpy = view?.renderer.render as ReturnType<typeof vi.fn>;
			const beforeRenderCount = renderSpy.mock.calls.length;
			const beforeGoToCount = view?.goToCalls.length ?? 0;
			const hrefTarget = "OPS/text/chapter1.xhtml#sec-1";

			await service.navigateTo({ href: hrefTarget });

			const navigationCalls = (view?.goToCalls ?? []).slice(beforeGoToCount);

			expect(renderSpy.mock.calls.length).toBeGreaterThanOrEqual(beforeRenderCount + 2);
			expect(navigationCalls).toHaveLength(2);
			expect(navigationCalls).toEqual([hrefTarget, hrefTarget]);
			expect(service.getCurrentPosition().cfi.startsWith("epubcfi(")).toBe(true);
			expect(service.getCurrentChapterHref()).toBe("OPS/text/chapter1.xhtml");
		} finally {
			service.destroy();
		}
	});

	it("serializes overlapping TOC navigations so foliate goTo is never invoked concurrently", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const container = document.createElement("div");
			document.body.appendChild(container);

			await service.renderTo(container);

			const view = container.querySelector("foliate-view") as FakeFoliateViewElement | null;
			expect(view).toBeTruthy();

			let inFlightCount = 0;
			let maxConcurrentCount = 0;
			const originalGoTo = view!.goTo.bind(view);
			view!.goTo = vi.fn(async (target: unknown) => {
				inFlightCount += 1;
				maxConcurrentCount = Math.max(maxConcurrentCount, inFlightCount);
				await new Promise((resolve) => setTimeout(resolve, 30));
				try {
					await originalGoTo(target);
				} finally {
					inFlightCount -= 1;
				}
			});

			await Promise.all([
				service.navigateTo({ href: "OPS/text/chapter1.xhtml" }),
				service.navigateTo({ href: "OPS/text/chapter1.xhtml#sec-1" }),
			]);

			expect(maxConcurrentCount).toBe(1);
		} finally {
			service.destroy();
		}
	});

	it("keeps queued navigations serialized after a timed-out navigation", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		const originalTimeoutMs = (FoliateReaderService as any).NAVIGATION_TIMEOUT_MS;
		(FoliateReaderService as any).NAVIGATION_TIMEOUT_MS = 120;
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const container = document.createElement("div");
			document.body.appendChild(container);

			await service.renderTo(container);

			const view = container.querySelector("foliate-view") as FakeFoliateViewElement | null;
			expect(view).toBeTruthy();

			let resolveFirstGoTo: (() => void) | null = null;
			const originalGoTo = view!.goTo.bind(view);
			const goToSpy = vi.fn((target: unknown) => {
				if (!resolveFirstGoTo) {
					return new Promise<void>((resolve) => {
						resolveFirstGoTo = resolve;
					});
				}
				return originalGoTo(target);
			});
			view!.goTo = goToSpy;

			const firstNavigation = service.navigateTo({ href: "OPS/text/chapter1.xhtml" });
			const firstNavigationAssertion = expect(firstNavigation).rejects.toThrow(
				"FoliateReaderService navigation timed out"
			);
			await new Promise((resolve) => setTimeout(resolve, 140));
			await firstNavigationAssertion;

			const secondNavigation = service.navigateTo({ href: "OPS/text/chapter1.xhtml#sec-1" });
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(goToSpy).toHaveBeenCalledTimes(1);

			expect(resolveFirstGoTo).toBeTypeOf("function");
			(resolveFirstGoTo as unknown as () => void)();
			await secondNavigation;

			expect(goToSpy.mock.calls.length).toBeGreaterThan(1);
		} finally {
			(FoliateReaderService as any).NAVIGATION_TIMEOUT_MS = originalTimeoutMs;
			service.destroy();
		}
	});

	it("tracks paragraph anchor sync depth for reading-progress persist suppression", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			expect(service.isParagraphAnchorSyncInFlight()).toBe(false);
			const syncPromise = service.syncParagraphAnchor("OPS/text/chapter1.xhtml#sec-1");
			expect(service.isParagraphAnchorSyncInFlight()).toBe(true);
			await syncPromise;
			expect(service.isParagraphAnchorSyncInFlight()).toBe(false);
		} finally {
			service.destroy();
		}
	});

	it("uses lightweight same-chapter paragraph navigation without a second paginated goTo", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const container = document.createElement("div");
			document.body.appendChild(container);

			await service.renderTo(container);
			const paragraphs = await service.getParagraphsForChapter(0);
			const sourceParagraph = paragraphs.find((item) =>
				item.text.includes("Selection text for testing")
			);
			expect(sourceParagraph?.cfiRange).toBeTruthy();

			await service.goToLocation(sourceParagraph!.cfiRange);
			const view = container.querySelector("foliate-view") as FakeFoliateViewElement | null;
			expect(view).toBeTruthy();
			const goToSpy = vi.spyOn(view!, "goTo");

			await service.goToLocation(sourceParagraph!.cfiRange);
			expect(goToSpy).not.toHaveBeenCalled();
			expect(service.getCurrentPosition().cfi).toBeTruthy();
		} finally {
			service.destroy();
		}
	});

	it("skips annotation sync on relocate when visible sections are unchanged", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const syncSpy = vi.spyOn(service as any, "syncAnnotationsWithView").mockResolvedValue(undefined);
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([{ index: 2 }]);
			(service as any).lastSyncedVisibleSectionKey = "2";

			(service as any).scheduleAnnotationSyncAfterRelocate();
			await Promise.resolve();

			expect(syncSpy).not.toHaveBeenCalled();
		} finally {
			service.destroy();
		}
	});

	it("ignores stale relocate events from a previously destroyed foliate view", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const firstContainer = document.createElement("div");
			const secondContainer = document.createElement("div");
			document.body.appendChild(firstContainer);
			document.body.appendChild(secondContainer);

			await service.renderTo(firstContainer);
			const firstView = firstContainer.querySelector("foliate-view") as FakeFoliateViewElement | null;
			expect(firstView).toBeTruthy();

			await service.goToLocation("OPS/text/chapter1.xhtml#sec-1");
			const relocatedCfi = service.getCurrentPosition().cfi;
			expect(relocatedCfi).not.toBe("");

			await service.renderTo(secondContainer);
			firstView?.dispatchEvent(
				new CustomEvent("relocate", {
					detail: {
						cfi: "OPS/text/chapter1.xhtml",
					},
				})
			);

			expect(service.getCurrentPosition().cfi).toBe(relocatedCfi);
			expect(service.getCurrentChapterHref?.()).toBe("OPS/text/chapter1.xhtml");
		} finally {
			service.destroy();
		}
	});

	it("maps iframe text rects into viewport coordinates for source locate overlays", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			const iframe = document.createElement("iframe");
			vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue(new DOMRect(240, 80, 900, 640));

			const fakeRange = {
				getBoundingClientRect: () => new DOMRect(36, 148, 420, 32),
			} as Range;

			const rect = (service as any).createViewportRect(
				{
					frameElement: iframe,
				},
				fakeRange
			);

			expect(rect).toMatchObject({
				left: 276,
				top: 228,
				right: 696,
				bottom: 260,
				width: 420,
				height: 32,
			});
		} finally {
			service.destroy();
		}
	});

	it("bridges iframe mouseup selections to host document listeners for external translation plugins", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const iframe = document.createElement("iframe");
			vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue(new DOMRect(240, 80, 900, 640));

			const sourceRange = {
				cloneRange: () => sourceRange,
				cloneContents: () => document.createDocumentFragment(),
				commonAncestorContainer: frameDoc.body,
				startContainer: frameDoc.body,
				startOffset: 0,
				endContainer: frameDoc.body,
				endOffset: 1,
				getBoundingClientRect: () => new DOMRect(36, 148, 120, 24),
				getClientRects: () => [new DOMRect(36, 148, 120, 24)],
			} as unknown as Range;

			const sourceSelection = {
				isCollapsed: false,
				rangeCount: 1,
				anchorNode: frameDoc.body,
				anchorOffset: 0,
				focusNode: frameDoc.body,
				focusOffset: 1,
				toString: () => "epub",
				getRangeAt: () => sourceRange,
				containsNode: () => true,
				removeAllRanges: vi.fn(),
			} as unknown as Selection;

			Object.defineProperty(frameDoc, "defaultView", {
				configurable: true,
				value: {
					getSelection: () => sourceSelection,
				},
			});

			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([
				{
					index: 0,
					href: "OPS/text/chapter1.xhtml",
					frameDocument: frameDoc,
					frameElement: iframe,
					frame: {
						frameDocument: frameDoc,
						window: frameDoc.defaultView,
						cfiFromRange: () => "epubcfi(/6/2!/4/2,/1:0,/1:4)",
					},
				},
			]);

			(service as any).attachSelectionListeners(frameDoc);

			const hostMouseUpListener = vi.fn((event: MouseEvent) => {
				const hostSelection = window.getSelection();
				const documentSelection = document.getSelection?.();
				const hostRange = hostSelection?.getRangeAt(0);
				expect(hostSelection?.toString()).toBe("epub");
				expect(documentSelection?.toString()).toBe("epub");
				expect(hostRange?.getBoundingClientRect()).toMatchObject({
					left: 276,
					top: 228,
					width: 120,
					height: 24,
				});
				expect(event.ctrlKey).toBe(true);
			});

			document.addEventListener("mouseup", hostMouseUpListener, { once: true });
			(service as any).bridgeHostSelectionMouseUp(
				frameDoc,
				new MouseEvent("mouseup", { bubbles: true, ctrlKey: true })
			);

			expect(hostMouseUpListener).toHaveBeenCalledTimes(1);
		} finally {
			service.destroy();
		}
	});

	it("prefers the current canonical cfi when resolving a precise EPUB locate overlay rect", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const iframe = document.createElement("iframe");
			vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue(new DOMRect(240, 80, 900, 640));

			const fakeRange = {
				getBoundingClientRect: () => new DOMRect(36, 148, 420, 32),
			} as Range;

			(service as any).currentPosition = {
				chapterIndex: 0,
				cfi: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				percent: 0,
			};
			(service as any).currentChapterHref = "OPS/text/chapter1.xhtml";

			vi.spyOn((service as any).parser, "resolveRangeInLoadedSection").mockImplementation(
				(...args: unknown[]) => {
					const [target] = args as [string, ...unknown[]];
					return target === "epubcfi(/6/2!/4/2,/1:0,/1:9)" ? fakeRange : null;
				}
			);
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([
				{
					index: 0,
					href: "OPS/text/chapter1.xhtml",
					frameDocument: frameDoc,
					frameElement: iframe,
					frame: {
						frameDocument: frameDoc,
						window,
						cfiFromRange: () => null,
					},
				},
			]);

			const rect = service.getNavigationTargetRect({
				cfi: "legacy-missing-cfi",
				text: "Selection text for testing",
				allowFallback: false,
			});

			expect(rect).toMatchObject({
				left: 276,
				top: 228,
				width: 420,
				height: 32,
			});
			expect((service as any).parser.resolveRangeInLoadedSection).toHaveBeenNthCalledWith(
				1,
				"legacy-missing-cfi",
				frameDoc,
				0,
				"Selection text for testing"
			);
			expect((service as any).parser.resolveRangeInLoadedSection).toHaveBeenNthCalledWith(
				2,
				"epubcfi(/6/2!/4/2,/1:0,/1:9)",
				frameDoc,
				0,
				"Selection text for testing"
			);
		} finally {
			service.destroy();
		}
	});

	it("returns null instead of the reader container rect when precise EPUB locate rects are required", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const container = document.createElement("div");
			vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(18, 28, 960, 720));

			(service as any).renderContainer = container;
			vi.spyOn((service as any).parser, "resolveRangeInLoadedSection").mockReturnValue(null);
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([
				{
					index: 0,
					href: "OPS/text/chapter1.xhtml",
					frameDocument: frameDoc,
					frameElement: null,
					frame: {
						frameDocument: frameDoc,
						window,
						cfiFromRange: () => null,
					},
				},
			]);

			const preciseRect = service.getNavigationTargetRect({
				cfi: "missing-target",
				allowFallback: false,
			});
			const fallbackRect = service.getNavigationTargetRect({
				cfi: "missing-target",
			});

			expect(preciseRect).toBeNull();
			expect(fallbackRect).toMatchObject({
				left: 18,
				top: 28,
				width: 960,
				height: 720,
			});
		} finally {
			service.destroy();
		}
	});

	it("uses stronger highlight palette and normal blend mode for EPUB body highlights", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const lightStyles = (service as any).buildReaderStyles();
			expect((service as any).resolveHighlightTint("yellow")).toBe("rgb(250, 204, 21)");
			expect(lightStyles).toContain("--overlayer-highlight-opacity: 0.72");
			expect(lightStyles).toContain("--overlayer-highlight-blend-mode: normal");

			document.body.classList.add("theme-dark");
			const darkStyles = (service as any).buildReaderStyles();
			expect((service as any).resolveHighlightTint("yellow")).toBe("rgb(255, 222, 89)");
			expect(darkStyles).toContain("--overlayer-highlight-opacity: 0.68");
			expect(darkStyles).toContain("--overlayer-highlight-blend-mode: normal");
			expect(darkStyles).toContain('html[data-weave-host-scheme="dark"] body :is(article');
			expect(darkStyles).toContain("-webkit-text-fill-color: currentColor !important");
		} finally {
			document.body.classList.remove("theme-dark");
			service.destroy();
		}
	});

	it("automatically reapplies reader appearance when the host theme changes", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		const originalRequestAnimationFrame = window.requestAnimationFrame;
		const originalCancelAnimationFrame = window.cancelAnimationFrame;
		try {
			const container = document.createElement("div");
			document.body.appendChild(container);
			(service as any).renderContainer = container;
			(service as any).foliateView = {
				removeEventListener: vi.fn(),
				close: vi.fn(),
				remove: vi.fn(),
				renderer: {
					setStyles: vi.fn(),
					render: vi.fn(),
					getContents: () => [],
				},
			};
			window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			}) as typeof window.requestAnimationFrame;
			window.cancelAnimationFrame = vi.fn() as typeof window.cancelAnimationFrame;

			const refreshSpy = vi.spyOn(service as any, "scheduleThemeRefresh");
			(service as any).attachThemeChangeListener();
			activeDocument.documentElement.classList.add("theme-dark");
			flushThemeManagerForTests();
			expect(refreshSpy).toHaveBeenCalled();

			service.destroy();
			refreshSpy.mockClear();
			document.body.classList.remove("theme-dark");
			flushThemeManagerForTests();

			expect(refreshSpy).not.toHaveBeenCalled();
		} finally {
			window.requestAnimationFrame = originalRequestAnimationFrame;
			window.cancelAnimationFrame = originalCancelAnimationFrame;
			service.destroy();
		}
	});

	it("automatically reapplies reader appearance when host theme variables change without dark-light mode switching", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		const originalRequestAnimationFrame = window.requestAnimationFrame;
		const originalCancelAnimationFrame = window.cancelAnimationFrame;
		try {
			document.body.classList.add("theme-dark");
			document.body.style.setProperty("--background-primary", "rgb(24, 24, 27)");
			const container = document.createElement("div");
			document.body.appendChild(container);
			(service as any).renderContainer = container;
			(service as any).foliateView = {
				removeEventListener: vi.fn(),
				close: vi.fn(),
				remove: vi.fn(),
				renderer: {
					setStyles: vi.fn(),
					render: vi.fn(),
					getContents: () => [],
				},
			};
			window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			}) as typeof window.requestAnimationFrame;
			window.cancelAnimationFrame = vi.fn() as typeof window.cancelAnimationFrame;

			const refreshSpy = vi.spyOn(service as any, "scheduleThemeRefresh");
			(service as any).attachThemeChangeListener();
			refreshSpy.mockClear();

			activeDocument.body.style.setProperty("--background-primary", "rgb(31, 41, 55)");
			flushThemeManagerForTests();
			expect(refreshSpy).toHaveBeenCalled();
		} finally {
			window.requestAnimationFrame = originalRequestAnimationFrame;
			window.cancelAnimationFrame = originalCancelAnimationFrame;
			service.destroy();
		}
	});

	it("uses Obsidian text font variables for EPUB body typography", () => {
		document.body.style.setProperty("--font-text", '"Source Han Sans SC"');
		document.body.style.setProperty("--font-monospace", '"JetBrains Mono"');
		document.body.style.setProperty("--font-text-size", "19px");

		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const styles = (service as any).buildReaderStyles();

			expect(styles).toContain('--weave-reader-font-family: "Source Han Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif');
			expect(styles).toContain('--weave-reader-monospace-font-family: "JetBrains Mono", ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace');
			expect(styles).toContain("--weave-reader-font-size: 19px");
			expect(styles).toContain("html {");
			expect(styles).toContain("font-size: var(--weave-reader-font-size) !important;");
			expect(styles).toContain("font-family: var(--weave-reader-font-family) !important;");
			expect(styles).toContain("body :is(article, section, main, aside, header, footer, nav, p, div, span, li, dd, dt, blockquote, figcaption, td, th, caption, label, legend) {");
			expect(styles).toContain("font-size: inherit !important;");
		} finally {
			service.destroy();
		}
	});

	it("re-renders conceal annotations when temporary reveal state changes", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const highlight = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				presentation: "conceal" as const,
			};
			const key = getReaderHighlightIdentityKey(highlight);
			const view = {
				addAnnotation: vi.fn(async () => undefined),
				deleteAnnotation: vi.fn(async () => undefined),
				removeEventListener: vi.fn(),
				close: vi.fn(),
				remove: vi.fn(),
			};

			(service as any).foliateView = view;
			(service as any).highlightDataMap.set(key, highlight);
			vi.spyOn((service as any).parser, "getSectionIndexForCfi").mockReturnValue(0);
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([
				{ index: 0 },
			]);

			const concealedRendered = createRenderedFoliateAnnotation({
				persistentHighlight: highlight,
				currentStrikethroughPresentation: service.currentStrikethroughPresentation,
				colorScheme: service.getCurrentColorScheme(),
				temporarilyRevealedConcealmentKeys: (service as any).temporarilyRevealedConcealmentTimers,
			});
			(service as any).renderedAnnotations.set(key, concealedRendered);
			(service as any).temporarilyRevealedConcealmentTimers.set(key, setTimeout(() => undefined, 1000));

			await (service as any).syncAnnotationsWithView();

			expect(view.deleteAnnotation).toHaveBeenCalledTimes(1);
			expect(view.deleteAnnotation).toHaveBeenCalledWith(concealedRendered.annotation);
			expect(view.addAnnotation).toHaveBeenCalledTimes(1);
			const nextRendered = (service as any).renderedAnnotations.get(key);
			expect(nextRendered?.renderSignature).toContain("concealment:revealed");
		} finally {
			service.destroy();
		}
	});

	it("re-renders highlight annotations when color changes", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const initialHighlight = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				presentation: "highlight" as const,
			};
			const key = getReaderHighlightIdentityKey(initialHighlight);
			const view = {
				addAnnotation: vi.fn(async () => undefined),
				deleteAnnotation: vi.fn(async () => undefined),
				removeEventListener: vi.fn(),
				close: vi.fn(),
				remove: vi.fn(),
			};

			(service as any).foliateView = view;
			(service as any).highlightDataMap.set(key, initialHighlight);
			vi.spyOn((service as any).parser, "getSectionIndexForCfi").mockReturnValue(0);
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([
				{ index: 0 },
			]);

			const initialRendered = createRenderedFoliateAnnotation({
				persistentHighlight: initialHighlight,
				currentStrikethroughPresentation: service.currentStrikethroughPresentation,
				colorScheme: service.getCurrentColorScheme(),
				temporarilyRevealedConcealmentKeys: (service as any).temporarilyRevealedConcealmentTimers,
			});
			(service as any).renderedAnnotations.set(key, initialRendered);
			(service as any).highlightDataMap.set(key, {
				...initialHighlight,
				color: "purple",
			});

			await (service as any).syncAnnotationsWithView();

			expect(view.deleteAnnotation).toHaveBeenCalledTimes(1);
			expect(view.deleteAnnotation).toHaveBeenCalledWith(initialRendered.annotation);
			expect(view.addAnnotation).toHaveBeenCalledTimes(1);
			const nextRendered = (service as any).renderedAnnotations.get(key);
			expect(nextRendered?.annotation.color).toBe("purple");
			expect(nextRendered?.renderSignature).toContain("color:purple");
		} finally {
			service.destroy();
		}
	});

	it("keeps persistent highlight color after temporary source-focus highlight expires", async () => {
		vi.useFakeTimers();
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const persistentHighlight = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				presentation: "highlight" as const,
			};
			const key = getReaderHighlightIdentityKey(persistentHighlight);
			vi.spyOn((service as any).parser, "canonicalizeLocation").mockResolvedValue(
				persistentHighlight.cfiRange
			);

			await service.applyHighlights([persistentHighlight]);
			service.addTemporaryHighlight(
				{
					cfiRange: persistentHighlight.cfiRange,
					color: "blue",
					text: persistentHighlight.text,
				},
				READER_SOURCE_LOCATE_FOCUS_DURATION_MS
			);

			await vi.waitFor(() => {
				expect((service as any).temporaryHighlightDataMap.get(key)?.color).toBe("blue");
			});
			expect((service as any).highlightDataMap.get(key)?.color).toBe("yellow");
			expect((service as any).savedHighlights).toHaveLength(1);

			await vi.advanceTimersByTimeAsync(READER_SOURCE_LOCATE_FOCUS_DURATION_MS);

			expect((service as any).temporaryHighlightDataMap.has(key)).toBe(false);
			expect((service as any).highlightDataMap.get(key)?.color).toBe("yellow");
			expect((service as any).savedHighlights).toHaveLength(1);
			expect((service as any).savedHighlights[0]?.color).toBe("yellow");
		} finally {
			vi.useRealTimers();
			service.destroy();
		}
	});

	it("uses source-locate focus overlay instead of replacing an existing excerpt highlight", async () => {
		vi.useFakeTimers();
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const persistentHighlight = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Saved excerpt quote",
				presentation: "highlight" as const,
			};
			const key = getReaderHighlightIdentityKey(persistentHighlight);
			await service.applyHighlights([persistentHighlight]);
			vi.spyOn(service as any, "resolveNavigationRequest").mockResolvedValue({
				canonical: persistentHighlight.cfiRange,
			});
			const refreshSpy = vi.spyOn(service, "refreshHighlights");

			await service.navigateAndHighlight({
				cfi: persistentHighlight.cfiRange,
				text: "Different navigation hint",
				flashStyle: "highlight",
				flashColor: "blue",
			});

			expect((service as any).temporaryHighlightDataMap.size).toBe(0);
			expect((service as any).sourceLocateFocusByCfiKey.size).toBe(1);
			expect((service as any).highlightDataMap.get(key)?.color).toBe("yellow");
			expect(refreshSpy).toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(READER_SOURCE_LOCATE_FOCUS_DURATION_MS);

			expect((service as any).sourceLocateFocusByCfiKey.size).toBe(0);
			expect((service as any).highlightDataMap.get(key)?.color).toBe("yellow");
			expect((service as any).savedHighlights).toHaveLength(1);
		} finally {
			vi.useRealTimers();
			service.destroy();
		}
	});

	it("still flashes a temporary highlight when navigating to a location without a saved excerpt", async () => {
		vi.useFakeTimers();
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const cfiRange = "epubcfi(/6/2!/4/2,/1:0,/1:9)";
			vi.spyOn((service as any).parser, "canonicalizeLocation").mockResolvedValue(cfiRange);
			vi.spyOn(service as any, "resolveNavigationRequest").mockResolvedValue({
				canonical: cfiRange,
			});

			await service.navigateAndHighlight({
				cfi: cfiRange,
				text: "Search result snippet",
				flashStyle: "highlight",
			});

			expect((service as any).temporaryHighlightDataMap.size).toBe(1);
			expect((service as any).sourceLocateFocusByCfiKey.size).toBe(0);

			await vi.advanceTimersByTimeAsync(READER_SOURCE_LOCATE_FOCUS_DURATION_MS);

			expect((service as any).temporaryHighlightDataMap.size).toBe(0);
		} finally {
			vi.useRealTimers();
			service.destroy();
		}
	});

	it("keeps source-locate overlay anchor cfis while focus ring uses persistent excerpt highlights", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const persistentHighlight = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Saved excerpt quote",
				presentation: "highlight" as const,
			};
			await service.applyHighlights([persistentHighlight]);
			(service as any).setSourceLocateFocus(persistentHighlight.cfiRange, "blue");

			expect((service as any).collectSourceLocateOverlayAnchorCfis()).toEqual([
				persistentHighlight.cfiRange,
			]);
		} finally {
			service.destroy();
		}
	});

	it("passes merged source locators through highlight click info", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const highlight = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				sourceFile: "weave/memory/deck-files/demo_01.wdeck",
				sourceRef: "card:card-a",
				sourceLocators: [
					{ sourceFile: "Notes/demo.md" },
					{ sourceFile: "weave/memory/deck-files/demo_01.wdeck", sourceRef: "card:card-a" },
				],
				presentation: "highlight" as const,
			};
			const key = getReaderHighlightIdentityKey(highlight);
			const callback = vi.fn();
			const container = document.createElement("div");
			Object.defineProperty(container, "getBoundingClientRect", {
				value: () => ({ width: 600, height: 400 }),
			});
			(service as any).renderContainer = container;
			(service as any).highlightDataMap.set(key, highlight);
			(service as any).highlightClickCallbacks.add(callback);
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([{ index: 0 }]);

			(service as any).handleShowAnnotationEvent({
				detail: {
					value: highlight.cfiRange,
					index: 0,
				},
			} as CustomEvent);

			expect(callback).toHaveBeenCalledTimes(1);
			expect(callback.mock.calls[0][0]).toMatchObject({
				sourceFile: "weave/memory/deck-files/demo_01.wdeck",
				sourceRef: "card:card-a",
				sourceLocators: [
					{ sourceFile: "Notes/demo.md" },
					{ sourceFile: "weave/memory/deck-files/demo_01.wdeck", sourceRef: "card:card-a" },
				],
			});
		} finally {
			service.destroy();
		}
	});

	it("opens the excerpt toolbar when clicking highlighted text in the frame document", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const frameDoc = document.implementation.createHTMLDocument("novel");
			const paragraph = frameDoc.createElement("p");
			paragraph.textContent = "不能要太高悬赏";
			frameDoc.body.appendChild(paragraph);

			const highlight = {
				cfiRange: "epubcfi(/6/26!/4/2/1,/1:0,/1:7)",
				color: "yellow",
				text: "不能要太高悬赏",
				chapterIndex: 12,
				excerptId: "excerpt-a",
				presentation: "highlight" as const,
			};
			const key = getReaderHighlightIdentityKey(highlight);
			const callback = vi.fn();
			const iframe = document.createElement("iframe");
			document.body.appendChild(iframe);
			const iframeRect = { left: 40, top: 80, width: 400, height: 600 };
			iframe.getBoundingClientRect = () => ({
				...iframeRect,
				right: iframeRect.left + iframeRect.width,
				bottom: iframeRect.top + iframeRect.height,
				x: iframeRect.left,
				y: iframeRect.top,
				toJSON: () => ({}),
			});
			Object.defineProperty(frameDoc, "defaultView", {
				configurable: true,
				value: {
					frameElement: iframe,
					getSelection: () => ({
						isCollapsed: true,
						rangeCount: 0,
						toString: () => "",
						removeAllRanges: vi.fn(),
					}),
				},
			});

			(service as any).highlightDataMap.set(key, highlight);
			(service as any).highlightClickCallbacks.add(callback);
			vi.spyOn((service as any).parser, "getSectionIndexForCfi").mockReturnValue(12);
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
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([
				{
					index: 12,
					frameDocument: frameDoc,
					frameElement: iframe,
					frame: {},
				},
			]);

			vi.spyOn(service as any, "getCurrentHighlightViewportGeometry").mockReturnValue({
				rect: {
					top: 110,
					left: 100,
					bottom: 150,
					right: 260,
					width: 160,
					height: 40,
				},
			});

			(service as any).handleFrameHighlightClick(
				{
					button: 0,
					clientX: 120,
					clientY: 130,
					preventDefault: vi.fn(),
					stopPropagation: vi.fn(),
					defaultPrevented: false,
				} as unknown as MouseEvent,
				frameDoc
			);

			expect(callback).toHaveBeenCalledTimes(1);
			expect(callback.mock.calls[0]?.[0]?.cfiRange).toBe(highlight.cfiRange);
			document.body.removeChild(iframe);
		} finally {
			service.destroy();
		}
	});

	it("ignores frame highlight clicks while a real text selection is active", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const frameDoc = document.implementation.createHTMLDocument("novel");
			const paragraph = frameDoc.createElement("p");
			paragraph.textContent = "不能要太高悬赏";
			frameDoc.body.appendChild(paragraph);

			const highlight = {
				cfiRange: "epubcfi(/6/26!/4/2/1,/1:0,/1:7)",
				color: "yellow",
				text: "不能要太高悬赏",
				chapterIndex: 12,
				excerptId: "excerpt-a",
				presentation: "highlight" as const,
			};
			const key = getReaderHighlightIdentityKey(highlight);
			const callback = vi.fn();
			const iframe = document.createElement("iframe");
			document.body.appendChild(iframe);
			Object.defineProperty(frameDoc, "defaultView", {
				configurable: true,
				value: {
					frameElement: iframe,
					getSelection: () => ({
						isCollapsed: false,
						rangeCount: 1,
						toString: () => "不能要太高悬赏",
						removeAllRanges: vi.fn(),
					}),
				},
			});

			(service as any).highlightDataMap.set(key, highlight);
			(service as any).highlightClickCallbacks.add(callback);
			vi.spyOn((service as any).parser, "getSectionIndexForCfi").mockReturnValue(12);
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([
				{
					index: 12,
					frameDocument: frameDoc,
					frameElement: iframe,
					frame: {},
				},
			]);
			vi.spyOn(service as any, "getCurrentHighlightViewportGeometry").mockReturnValue({
				rect: {
					top: 110,
					left: 100,
					bottom: 150,
					right: 260,
					width: 160,
					height: 40,
				},
			});

			(service as any).handleFrameHighlightClick(
				{
					button: 0,
					clientX: 120,
					clientY: 130,
					preventDefault: vi.fn(),
					stopPropagation: vi.fn(),
					defaultPrevented: false,
				} as unknown as MouseEvent,
				frameDoc
			);

			expect(callback).not.toHaveBeenCalled();
			document.body.removeChild(iframe);
		} finally {
			service.destroy();
		}
	});

	it("ignores show-annotation overlay hits while a real text selection is active", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const highlight = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				excerptId: "excerpt-a",
				presentation: "highlight" as const,
			};
			const key = getReaderHighlightIdentityKey(highlight);
			const callback = vi.fn();
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const paragraph = frameDoc.createElement("p");
			paragraph.textContent = "Selection text for testing";
			frameDoc.body.appendChild(paragraph);
			const range = frameDoc.createRange();
			range.selectNodeContents(paragraph);
			Object.defineProperty(frameDoc, "defaultView", {
				value: {
					getSelection: () => ({
						isCollapsed: false,
						rangeCount: 1,
						toString: () => "Selection text for testing",
						removeAllRanges: vi.fn(),
					}),
				},
			});
			(service as any).highlightDataMap.set(key, highlight);
			(service as any).highlightClickCallbacks.add(callback);
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([
				{ index: 0, frameDocument: frameDoc, frameElement: null, frame: {} },
			]);

			(service as any).handleShowAnnotationEvent({
				currentTarget: (service as any).foliateView,
				detail: {
					value: highlight.cfiRange,
					index: 0,
					range,
				},
			} as CustomEvent);

			expect(callback).not.toHaveBeenCalled();
		} finally {
			service.destroy();
		}
	});

	it("opens the excerpt toolbar from show-annotation overlay hits without an active selection", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const highlight = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				excerptId: "excerpt-a",
				presentation: "highlight" as const,
			};
			const key = getReaderHighlightIdentityKey(highlight);
			const callback = vi.fn();
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const paragraph = frameDoc.createElement("p");
			paragraph.textContent = "Selection text for testing";
			frameDoc.body.appendChild(paragraph);
			const range = frameDoc.createRange();
			range.selectNodeContents(paragraph);
			Object.defineProperty(frameDoc, "defaultView", {
				value: {
					getSelection: () => ({
						isCollapsed: true,
						rangeCount: 0,
						toString: () => "",
						removeAllRanges: vi.fn(),
					}),
				},
			});
			(service as any).highlightDataMap.set(key, highlight);
			(service as any).highlightClickCallbacks.add(callback);
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([
				{ index: 0, frameDocument: frameDoc, frameElement: null, frame: {} },
			]);

			(service as any).handleShowAnnotationEvent({
				currentTarget: (service as any).foliateView,
				detail: {
					value: highlight.cfiRange,
					index: 0,
					range,
				},
			} as CustomEvent);

			expect(callback).toHaveBeenCalledTimes(1);
			expect(callback.mock.calls[0]?.[0]?.cfiRange).toBe(highlight.cfiRange);
		} finally {
			service.destroy();
		}
	});

	it("ignores show-annotation highlight clicks while a real text selection is active", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const highlight = {
				cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:9)",
				color: "yellow",
				text: "Selection text for testing",
				presentation: "highlight" as const,
			};
			const key = getReaderHighlightIdentityKey(highlight);
			const callback = vi.fn();
			const frameDoc = document.implementation.createHTMLDocument("frame");
			Object.defineProperty(frameDoc, "defaultView", {
				value: {
					getSelection: () => ({
						isCollapsed: false,
						rangeCount: 1,
						toString: () => "Selection text for testing",
					}),
				},
			});
			(service as any).highlightDataMap.set(key, highlight);
			(service as any).highlightClickCallbacks.add(callback);
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([
				{ index: 0, frameDocument: frameDoc },
			]);

			(service as any).handleShowAnnotationEvent({
				detail: {
					value: highlight.cfiRange,
					index: 0,
				},
			} as CustomEvent);

			expect(callback).not.toHaveBeenCalled();
		} finally {
			service.destroy();
		}
	});

	it("resolves footnote preview text from the surrounding container when the fragment points to an empty anchor", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const anchor = frameDoc.createElement("a");
			anchor.setAttribute("href", "notes.xhtml#fn1");
			anchor.textContent = "1";
			const sup = frameDoc.createElement("sup");
			sup.appendChild(anchor);
			frameDoc.body.appendChild(sup);

			const footnoteDoc = document.implementation.createHTMLDocument("footnotes");
			footnoteDoc.body.innerHTML = `
				<section class="footnotes">
					<ol>
						<li id="entry-1"><p><a id="fn1"></a>Footnote text from external note file.</p></li>
					</ol>
				</section>
			`;

			const footnoteParagraph = footnoteDoc.querySelector("p") as HTMLParagraphElement;
			const footnoteRange = footnoteDoc.createRange();
			footnoteRange.selectNodeContents(footnoteParagraph);

			vi.spyOn((service as any).parser, "resolveNavigationTarget").mockResolvedValue({
				cfi: null,
				index: 1,
				href: "notes.xhtml#fn1",
				doc: footnoteDoc,
				range: footnoteRange,
			});
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([
				{
					index: 0,
					href: "OPS/text/chapter1.xhtml",
					frameDocument: frameDoc,
					frameElement: null,
					frame: {
						frameDocument: frameDoc,
						window,
						cfiFromRange: () => null,
					},
				},
			]);
			vi.spyOn(service as any, "createViewportRectFromElement").mockReturnValue({
				top: 12,
				left: 24,
				bottom: 36,
				right: 48,
				width: 24,
				height: 24,
			});

			const info = await (service as any).buildFootnotePreviewInfo(frameDoc, anchor);

			expect(info).toMatchObject({
				href: "notes.xhtml#fn1",
				label: "1",
				text: "Footnote text from external note file.",
			});
		} finally {
			service.destroy();
		}
	});

	it("resolves real EPUB endnote preview text through the lightweight direct target path", async () => {
		const service = new FoliateReaderService(createMockApp(await createFootnoteSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/footnote-sample.epub", "footnote-book");
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const anchor = frameDoc.createElement("a");
			anchor.setAttribute("href", "backnotes.xhtml#note-1");
			anchor.setAttribute("epub:type", "noteref");
			anchor.textContent = "[1]";
			frameDoc.body.appendChild(anchor);

			(service as any).loadedDocumentSectionIndexes.set(frameDoc, 0);
			vi.spyOn(service as any, "createViewportRectFromElement").mockReturnValue({
				top: 12,
				left: 24,
				bottom: 36,
				right: 48,
				width: 24,
				height: 24,
			});

			const info = await (service as any).buildFootnotePreviewInfo(frameDoc, anchor);

			expect(info).toMatchObject({
				href: "backnotes.xhtml#note-1",
				label: "[1]",
				text: "这是来自真实 EPUB 书末尾注的正文内容。",
			});
		} finally {
			service.destroy();
		}
	});

	it("extracts a whole-book footnotes draft from a real EPUB endnotes section", async () => {
		const service = new FoliateReaderService(createMockApp(await createFootnoteSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/footnote-sample.epub", "footnote-book");

			const draft = await service.getBookFootnotesDraft();

			expect(draft).not.toBeNull();
			expect(draft?.footnotes).toHaveLength(1);
			expect(draft?.footnotes[0]).toMatchObject({
				label: "note-1",
				href: "OPS/text/backnotes.xhtml#note-1",
				sectionHref: "OPS/text/backnotes.xhtml",
				text: "这是来自真实 EPUB 书末尾注的正文内容。",
			});
			expect(draft?.markdown).toContain("# 全部脚注");
			expect(draft?.markdown).toContain("### note-1");
			expect(draft?.markdown).toContain("这是来自真实 EPUB 书末尾注的正文内容。");
		} finally {
			service.destroy();
		}
	});

	it("extracts same-section footnotes even when they are plain paragraph targets", async () => {
		const service = new FoliateReaderService(createMockApp(await createInlineFootnoteSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/inline-footnote-sample.epub", "inline-footnote-book");

			const draft = await service.getBookFootnotesDraft();

			expect(draft).not.toBeNull();
			expect(draft?.footnotes.length).toBeGreaterThan(0);
			expect(draft?.markdown).toContain("这是同章普通段落中的脚注正文。");
		} finally {
			service.destroy();
		}
	});

	it("resolves preview text for same-section plain paragraph footnotes", async () => {
		const service = new FoliateReaderService(createMockApp(await createInlineFootnoteSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/inline-footnote-sample.epub", "inline-footnote-book");
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const anchor = frameDoc.createElement("a");
			anchor.setAttribute("href", "#note-2");
			anchor.setAttribute("epub:type", "noteref");
			anchor.textContent = "2";
			frameDoc.body.appendChild(anchor);

			(service as any).loadedDocumentSectionIndexes.set(frameDoc, 0);
			vi.spyOn(service as any, "createViewportRectFromElement").mockReturnValue({
				top: 12,
				left: 24,
				bottom: 36,
				right: 48,
				width: 24,
				height: 24,
			});

			const info = await (service as any).buildFootnotePreviewInfo(frameDoc, anchor);

			expect(info).toMatchObject({
				href: "#note-2",
				label: "2",
				text: "这是同章普通段落中的脚注正文。",
			});
		} finally {
			service.destroy();
		}
	});

	it("uses paragraph overlay rects when resolving footnote previews outside the live foliate iframe", async () => {
		const service = new FoliateReaderService(createMockApp(await createInlineFootnoteSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/inline-footnote-sample.epub", "inline-footnote-book");
			const paragraphs = await service.getParagraphsForChapter(0);
			const paragraph = paragraphs.find((item) => item.html?.includes("weave-paragraph-footnote"));
			expect(paragraph?.id).toBeTruthy();

			const callback = vi.fn();
			service.onFootnotePreview(callback);

			await service.openParagraphFootnotePreview(paragraph!.id, "#note-2", "2", {
				pinned: false,
				rect: {
					top: 18,
					left: 24,
					bottom: 34,
					right: 40,
					width: 16,
					height: 16,
				},
			});

			const previewInfo = callback.mock.calls.at(-1)?.[0];
			expect(previewInfo).toMatchObject({
				href: "#note-2",
				label: "2",
				text: "这是同章普通段落中的脚注正文。",
				rect: {
					top: 18,
					left: 24,
					bottom: 34,
					right: 40,
					width: 16,
					height: 16,
				},
			});
		} finally {
			service.destroy();
		}
	});

	it("extracts iframe-embedded chapter body instead of shell watermark in paragraph mode", async () => {
		const zip = new JSZip();
		zip.file("mimetype", "application/epub+zip");
		zip.file(
			"META-INF/container.xml",
			`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
	<rootfiles>
		<rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
	</rootfiles>
</container>`
		);
		zip.file(
			"OPS/content.opf",
			`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="BookId" xmlns="http://www.idpf.org/2007/opf">
	<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
		<dc:title>Iframe Shell Sample</dc:title>
		<dc:language>zh-CN</dc:language>
	</metadata>
	<manifest>
		<item id="shell" href="text/shell.xhtml" media-type="application/xhtml+xml" />
		<item id="body" href="text/body.xhtml" media-type="application/xhtml+xml" />
	</manifest>
	<spine>
		<itemref idref="shell" />
	</spine>
</package>`
		);
		zip.file(
			"OPS/text/shell.xhtml",
			`<html xmlns="http://www.w3.org/1999/xhtml"><body>
		<iframe src="body.xhtml"></iframe>
		<div class="watermark">© 未经授权禁止转载 获取更多电子书：https://t.me/+WwC4dCWvXRDhOTNh | ID: EPUB_20240125002648</div>
	</body></html>`
		);
		zip.file(
			"OPS/text/body.xhtml",
			`<html xmlns="http://www.w3.org/1999/xhtml"><body>
		<p>猪肠在滚水中汆烫后切段，口感弹牙而不腥。</p>
		<p>猪板油分成叶油与网油，前者清亮，后者香腻。</p>
	</body></html>`
		);
		const buffer = await zip.generateAsync({ type: "arraybuffer" });
		const service = new FoliateReaderService(createMockApp(buffer) as any);
		try {
			await service.loadEpub("Books/iframe-shell-sample.epub", "iframe-shell-book");
			const paragraphs = await service.getParagraphsForChapter(0);
			expect(paragraphs.some((item) => item.text.includes("猪肠"))).toBe(true);
			expect(paragraphs.some((item) => item.text.includes("未经授权禁止转载"))).toBe(false);
		} finally {
			service.destroy();
		}
	});

	it("segments multi-paragraph chapters instead of collapsing the whole chapter into one paragraph", async () => {
		const service = new FoliateReaderService(
			createMockApp(await createMultiParagraphChapterSampleEpubBuffer()) as any
		);
		try {
			await service.loadEpub("Books/multi-paragraph-sample.epub", "multi-paragraph-book");
			const paragraphs = await service.getParagraphsForChapter(0);
			const bodyParagraphs = paragraphs.filter((item) => item.text.includes("段："));
			expect(bodyParagraphs.length).toBeGreaterThanOrEqual(4);
			expect(bodyParagraphs.some((item) => item.text.includes("第一段"))).toBe(true);
			expect(bodyParagraphs.some((item) => item.text.includes("第四段"))).toBe(true);
		} finally {
			service.destroy();
		}
	});

	it("extracts br-layout chapter body instead of only distributor watermark in paragraph mode", async () => {
		const service = new FoliateReaderService(
			createMockApp(await createBrLayoutParagraphSampleEpubBuffer()) as any
		);
		try {
			await service.loadEpub("Books/br-layout-sample.epub", "br-layout-book");
			const paragraphs = await service.getParagraphsForChapter(0);
			const bodyParagraphs = paragraphs.filter((item) => item.text.includes("猪肠"));
			expect(bodyParagraphs.length).toBeGreaterThanOrEqual(1);
			expect(paragraphs.some((item) => item.text.includes("未经授权禁止转载"))).toBe(false);
		} finally {
			service.destroy();
		}
	});

	it("renders paragraph-mode highlight decorations for chapter paragraphs", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const initialParagraphs = await service.getParagraphsForChapter(0);
			const sourceParagraph = initialParagraphs.find((item) => item.text.includes("Selection text for testing"));
			expect(sourceParagraph?.cfiRange).toBeTruthy();

			await service.applyHighlights([
				{
					cfiRange: sourceParagraph!.cfiRange,
					color: "green",
					text: "Selection text for testing",
				},
			]);

			const paragraphs = await service.getParagraphsForChapter(0);
			const paragraph = paragraphs.find((item) => item.text.includes("Selection text for testing"));
			expect(paragraph?.html).toContain("weave-paragraph-annotation");
			expect(paragraph?.html).toContain('data-color="green"');
			expect(paragraph?.html).toContain("Selection text for testing");
		} finally {
			service.destroy();
		}
	});

	it("lazily renders paragraph html and preserves parsed paragraph cache across highlight refreshes", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const extractSpy = vi.spyOn(service as any, "extractParagraphRecordsFromDocument");
			const htmlSpy = vi.spyOn(service as any, "buildParagraphHtml");
			const paragraphRecords = await (service as any).getParagraphRecordsForChapter(0);
			const targetParagraph = paragraphRecords.find((item: any) =>
				item.text.includes("Selection text for testing")
			);
			expect(targetParagraph?.cfiRange).toBeTruthy();

			await service.goToLocation(targetParagraph.cfiRange);
			const location = await service.getCurrentParagraphLocation();

			expect(extractSpy).toHaveBeenCalledTimes(1);
			expect(htmlSpy).toHaveBeenCalledTimes(1);
			expect(location?.paragraphs.filter((item) => typeof item.html === "string")).toHaveLength(1);
			expect(location?.paragraphs[location.currentIndex]?.html).toContain("Selection text for testing");

			await service.applyHighlights([
				{
					cfiRange: targetParagraph.cfiRange,
					color: "green",
					text: "Selection text for testing",
				},
			]);

			const refreshedLocation = await service.getCurrentParagraphLocation();
			expect(extractSpy).toHaveBeenCalledTimes(1);
			expect(htmlSpy).toHaveBeenCalledTimes(2);
			expect(refreshedLocation?.paragraphs[refreshedLocation.currentIndex]?.html).toContain(
				"weave-paragraph-annotation"
			);
		} finally {
			service.destroy();
		}
	});

	it("hydrates paragraph html for the UI-selected paragraph instead of only the reader's resolved current paragraph", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const paragraphRecords = [
				{
					id: "paragraph-1",
					chapterIndex: 0,
					chapterTitle: "Chapter 1",
					chapterHref: "text/chapter1.xhtml",
					text: "First paragraph",
					cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:15)",
					elementPath: [],
					segments: [],
					charMap: [],
				},
				{
					id: "paragraph-2",
					chapterIndex: 0,
					chapterTitle: "Chapter 1",
					chapterHref: "text/chapter1.xhtml",
					text: "Second paragraph",
					cfiRange: "epubcfi(/6/2!/4/4,/1:0,/1:16)",
					elementPath: [],
					segments: [],
					charMap: [],
				},
			] as any[];
			vi.spyOn(service, "getCurrentChapterIndex").mockReturnValue(0);
			vi.spyOn(service as any, "getParagraphRecordsForChapter").mockResolvedValue(paragraphRecords);
			vi.spyOn(service as any, "resolveCurrentParagraphIndex").mockResolvedValue(0);
			vi.spyOn(service as any, "toReaderParagraph").mockImplementation(
				async (...args: unknown[]) => {
					const [paragraph, options] = args as [
						any,
						| {
								includeHtml?: boolean;
						  }
						| undefined,
					];
					return {
						id: paragraph.id,
						chapterIndex: paragraph.chapterIndex,
						chapterTitle: paragraph.chapterTitle,
						chapterHref: paragraph.chapterHref,
						text: paragraph.text,
						html: options?.includeHtml ? `<span>${paragraph.text}</span>` : undefined,
						htmlRevision: options?.includeHtml ? 42 : undefined,
						cfiRange: paragraph.cfiRange,
					};
				}
			);

			const location = await service.getCurrentParagraphLocation?.({
				preferredIndex: 1,
			});

			expect(location?.currentIndex).toBe(1);
			expect(location?.paragraphs[0]?.html).toBeUndefined();
			expect(location?.paragraphs[1]?.html).toContain("Second paragraph");
			expect(location?.paragraphs[1]?.htmlRevision).toBe(42);
		} finally {
			service.destroy();
		}
	});

	it("picks a random readable paragraph from the loaded book", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const pick = await service.pickRandomParagraph?.();
			expect(pick?.paragraph?.cfiRange).toBeTruthy();
			expect(pick?.chapterParagraphs.length).toBeGreaterThan(0);
			expect(pick?.paragraphIndex).toBeGreaterThanOrEqual(0);
			expect(
				pick?.chapterParagraphs[pick.paragraphIndex]?.id
			).toBe(pick?.paragraph.id);
		} finally {
			service.destroy();
		}
	});

	it("exposes paragraph html revisions so the overlay can force a rerender after highlight changes", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const paragraphs = await service.getParagraphsForChapter(0);
			const sourceParagraph = paragraphs.find((item) => item.text.includes("Selection text for testing"));
			expect(sourceParagraph?.cfiRange).toBeTruthy();

			await service.goToLocation(sourceParagraph!.cfiRange);
			const before = await service.getCurrentParagraphLocation?.();
			const beforeRevision = before?.paragraphs[before.currentIndex]?.htmlRevision ?? 0;

			await service.applyHighlights([
				{
					cfiRange: sourceParagraph!.cfiRange,
					color: "purple",
					style: "wavy",
					text: "Selection text for testing",
				},
			]);

			const after = await service.getCurrentParagraphLocation?.();
			const currentParagraph = after?.paragraphs[after.currentIndex];
			expect(currentParagraph?.html).toContain('data-style="wavy"');
			expect((currentParagraph?.htmlRevision ?? 0)).toBeGreaterThan(beforeRevision);
		} finally {
			service.destroy();
		}
	});

	it("allows default foliate navigation for footnote clicks when click action is navigate", async () => {
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			service.setFootnoteClickAction?.("navigate");
			await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
			const container = document.createElement("div");
			document.body.appendChild(container);

			await service.renderTo(container);

			const view = container.querySelector("foliate-view") as FakeFoliateViewElement | null;
			expect(view).toBeTruthy();

			const anchor = document.createElement("a");
			anchor.setAttribute("href", "part0115_split_000.html#zhu87");
			anchor.textContent = "[87]";
			document.body.appendChild(anchor);

			const emitSpy = vi.spyOn(service as any, "emitFootnotePreviewForAnchor");

			const linkEvent = new CustomEvent("link", {
				detail: {
					a: anchor,
					href: "part0115_split_000.html#zhu87",
				},
				cancelable: true,
			});

			view?.dispatchEvent(linkEvent);

			expect(linkEvent.defaultPrevented).toBe(false);
			expect(emitSpy).not.toHaveBeenCalled();
		} finally {
			service.destroy();
		}
	});

	it("does not depend on the heavy navigation resolver when a direct footnote target is already reachable", async () => {
		const service = new FoliateReaderService(createMockApp(await createFootnoteSampleEpubBuffer()) as any);
		try {
			await service.loadEpub("Books/footnote-sample.epub", "footnote-book");
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const anchor = frameDoc.createElement("a");
			anchor.setAttribute("href", "backnotes.xhtml#note-1");
			anchor.setAttribute("epub:type", "noteref");
			anchor.textContent = "[1]";
			frameDoc.body.appendChild(anchor);

			(service as any).loadedDocumentSectionIndexes.set(frameDoc, 0);
			vi.spyOn(service as any, "createViewportRectFromElement").mockReturnValue({
				top: 12,
				left: 24,
				bottom: 36,
				right: 48,
				width: 24,
				height: 24,
			});
			const resolveNavigationTargetSpy = vi
				.spyOn((service as any).parser, "resolveNavigationTarget")
				.mockImplementation(() => new Promise(() => undefined));

			const info = await (service as any).buildFootnotePreviewInfo(frameDoc, anchor);

			expect(resolveNavigationTargetSpy).not.toHaveBeenCalled();
			expect(info).toMatchObject({
				href: "backnotes.xhtml#note-1",
				label: "[1]",
				text: "这是来自真实 EPUB 书末尾注的正文内容。",
			});
		} finally {
			service.destroy();
		}
	});

	it("resolves relative footnote hrefs against the current section before extracting preview text", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const anchor = frameDoc.createElement("a");
			anchor.setAttribute("href", "part0115_split_000.html#zhu9");
			anchor.textContent = "[9]";
			frameDoc.body.appendChild(anchor);

			(service as any).loadedDocumentSectionIndexes.set(frameDoc, 15);
			vi.spyOn((service as any).parser, "getSectionHrefByIndex").mockImplementation((...args: unknown[]) => {
				const [index] = args as [number];
				return index === 15 ? "text/part0108.xhtml" : "";
			});

			const resolveHrefAgainstSpy = vi
				.spyOn((service as any).parser, "resolveHrefAgainst")
				.mockReturnValue("text/part0115_split_000.html#zhu9");

			const footnoteDoc = document.implementation.createHTMLDocument("footnotes");
			footnoteDoc.body.innerHTML = `
				<div class="notes">
					<p id="zhu9">这是脚注九的正文内容。</p>
				</div>
			`;
			const footnoteParagraph = footnoteDoc.querySelector("p") as HTMLParagraphElement;
			const footnoteRange = footnoteDoc.createRange();
			footnoteRange.selectNodeContents(footnoteParagraph);

			const resolveNavigationTargetSpy = vi
				.spyOn((service as any).parser, "resolveNavigationTarget")
				.mockResolvedValue({
					cfi: null,
					index: 16,
					href: "text/part0115_split_000.html#zhu9",
					doc: footnoteDoc,
					range: footnoteRange,
				});

			vi.spyOn(service as any, "createViewportRectFromElement").mockReturnValue({
				top: 12,
				left: 24,
				bottom: 36,
				right: 48,
				width: 24,
				height: 24,
			});

			const info = await (service as any).buildFootnotePreviewInfo(frameDoc, anchor);

			expect(resolveHrefAgainstSpy).toHaveBeenCalledWith(
				"text/part0108.xhtml",
				"part0115_split_000.html#zhu9"
			);
			expect(resolveNavigationTargetSpy.mock.calls.map(([target]) => target)).toEqual([
				"part0115_split_000.html#zhu9",
			]);
			expect(info).toMatchObject({
				href: "part0115_split_000.html#zhu9",
				label: "[9]",
				text: "这是脚注九的正文内容。",
			});
		} finally {
			service.destroy();
		}
	});

	it("recovers footnote targets from matching section basenames when direct href resolution fails", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const anchor = frameDoc.createElement("a");
			anchor.setAttribute("href", "part0115_split_000.html#zhu3");
			anchor.textContent = "[3]";
			frameDoc.body.appendChild(anchor);

			(service as any).loadedDocumentSectionIndexes.set(frameDoc, 8);
			vi.spyOn((service as any).parser, "getSectionHrefByIndex").mockImplementation((...args: unknown[]) => {
				const [index] = args as [number];
				if (index === 8) return "text/part0108.xhtml";
				if (index === 9) return "OPS/text/part0115_split_000.html";
				return "";
			});

			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([
				{
					index: 8,
					href: "text/part0108.xhtml",
					frameDocument: frameDoc,
					frameElement: null,
					frame: {
						frameDocument: frameDoc,
						window,
						cfiFromRange: () => null,
					},
				},
			]);

			const footnoteDoc = document.implementation.createHTMLDocument("footnotes");
			footnoteDoc.body.innerHTML = `
				<section class="notes">
					<p id="zhu3">这是通过候选路径恢复出的脚注内容。</p>
				</section>
			`;
			const footnoteParagraph = footnoteDoc.querySelector("p") as HTMLParagraphElement;
			const footnoteRange = footnoteDoc.createRange();
			footnoteRange.selectNodeContents(footnoteParagraph);

			const resolveNavigationTargetSpy = vi
				.spyOn((service as any).parser, "resolveNavigationTarget")
				.mockImplementation(async (...args: unknown[]) => {
					const [target] = args as [string];
					if (target === "part0115_split_000.html#zhu3") {
						return null;
					}
					if (target === "text/part0115_split_000.html#zhu3") {
						return null;
					}
					if (target === "OPS/text/part0115_split_000.html#zhu3") {
						return {
							cfi: null,
							index: 9,
							href: "OPS/text/part0115_split_000.html#zhu3",
							doc: footnoteDoc,
							range: footnoteRange,
						};
					}
					return null;
				});

			vi.spyOn(service as any, "createViewportRectFromElement").mockReturnValue({
				top: 12,
				left: 24,
				bottom: 36,
				right: 48,
				width: 24,
				height: 24,
			});

			const info = await (service as any).buildFootnotePreviewInfo(frameDoc, anchor);

			expect(resolveNavigationTargetSpy.mock.calls.map(([target]) => target)).toEqual([
				"part0115_split_000.html#zhu3",
				"text/part0115_split_000.html#zhu3",
				"OPS/text/part0115_split_000.html#zhu3",
			]);
			expect(info).toMatchObject({
				href: "part0115_split_000.html#zhu3",
				label: "[3]",
				text: "这是通过候选路径恢复出的脚注内容。",
			});
		} finally {
			service.destroy();
		}
	});

	it("resolves endnotes stored at book-end xml:id anchors", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const anchor = frameDoc.createElement("a");
			anchor.setAttribute("href", "backnotes.xhtml#note-42");
			anchor.textContent = "42";
			frameDoc.body.appendChild(anchor);

			(service as any).loadedDocumentSectionIndexes.set(frameDoc, 2);
			vi.spyOn((service as any).parser, "getSectionHrefByIndex").mockImplementation((...args: unknown[]) => {
				const [index] = args as [number];
				if (index === 2) return "text/chapter03.xhtml";
				if (index === 27) return "Text/backnotes.xhtml";
				return "";
			});
			vi.spyOn((service as any).parser, "resolveHrefAgainst").mockReturnValue(
				"Text/backnotes.xhtml#note-42"
			);

			const endnotesDoc = document.implementation.createHTMLDocument("endnotes");
			endnotesDoc.body.innerHTML = `
				<section class="endnotes">
					<p xml:id="note-42">这是全书末尾脚注的正文内容。</p>
				</section>
			`;
			const paragraph = endnotesDoc.querySelector("p") as HTMLParagraphElement;
			const endnoteRange = endnotesDoc.createRange();
			endnoteRange.selectNodeContents(paragraph);

			vi.spyOn((service as any).parser, "resolveNavigationTarget").mockResolvedValue({
				cfi: null,
				index: 27,
				href: "Text/backnotes.xhtml#note-42",
				doc: endnotesDoc,
				range: endnoteRange,
			});

			vi.spyOn(service as any, "createViewportRectFromElement").mockReturnValue({
				top: 12,
				left: 24,
				bottom: 36,
				right: 48,
				width: 24,
				height: 24,
			});

			const info = await (service as any).buildFootnotePreviewInfo(frameDoc, anchor);

			expect(info).toMatchObject({
				href: "backnotes.xhtml#note-42",
				label: "42",
				text: "这是全书末尾脚注的正文内容。",
			});
		} finally {
			service.destroy();
		}
	});

	it("prefers actual endnote content over number-only placeholder range text", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const anchor = frameDoc.createElement("a");
			anchor.setAttribute("href", "backnotes.xhtml#note-42");
			anchor.textContent = "42";
			frameDoc.body.appendChild(anchor);

			const endnotesDoc = document.implementation.createHTMLDocument("endnotes");
			endnotesDoc.body.innerHTML = `
				<section epub:type="endnotes" role="doc-endnotes">
					<ol>
						<li id="note-item-42">
							<p><a id="note-42"></a>这是书末尾注的真实正文。</p>
						</li>
					</ol>
				</section>
			`;
			const placeholderAnchor = endnotesDoc.querySelector("a") as HTMLAnchorElement;
			const placeholderRange = endnotesDoc.createRange();
			placeholderRange.selectNodeContents(placeholderAnchor);

			vi.spyOn((service as any).parser, "resolveNavigationTarget").mockResolvedValue({
				cfi: null,
				index: 27,
				href: "Text/backnotes.xhtml#note-42",
				doc: endnotesDoc,
				range: placeholderRange,
			});
			vi.spyOn(service as any, "createViewportRectFromElement").mockReturnValue({
				top: 12,
				left: 24,
				bottom: 36,
				right: 48,
				width: 24,
				height: 24,
			});

			const info = await (service as any).buildFootnotePreviewInfo(frameDoc, anchor);

			expect(info).toMatchObject({
				href: "backnotes.xhtml#note-42",
				label: "42",
				text: "这是书末尾注的真实正文。",
			});
		} finally {
			service.destroy();
		}
	});

	it("falls back to range geometry when the footnote reference anchor box is empty", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const anchor = frameDoc.createElement("a");
			anchor.setAttribute("href", "#fn1");
			anchor.textContent = "[1]";
			frameDoc.body.appendChild(anchor);

			const range = {
				selectNodeContents: vi.fn(),
				selectNode: vi.fn(),
				getBoundingClientRect: vi.fn(() => ({
					x: 20,
					y: 10,
					top: 10,
					left: 20,
					bottom: 34,
					right: 44,
					width: 24,
					height: 24,
					toJSON: () => ({}),
				})),
				getClientRects: vi.fn(() => []),
			} as unknown as Range;

			Object.defineProperty(anchor, "getBoundingClientRect", {
				configurable: true,
				value: vi.fn(() => ({
					top: 0,
					left: 0,
					bottom: 0,
					right: 0,
					width: 0,
					height: 0,
				})),
			});
			Object.defineProperty(anchor, "getClientRects", {
				configurable: true,
				value: vi.fn(() => []),
			});
			vi.spyOn(frameDoc, "createRange").mockReturnValue(range);
			vi.spyOn(service as any, "getVisibleFramesWithIndex").mockReturnValue([
				{
					index: 0,
					href: "OPS/text/chapter1.xhtml",
					frameDocument: frameDoc,
					frameElement: null,
					frame: {
						frameDocument: frameDoc,
						window,
						cfiFromRange: () => null,
					},
				},
			]);

			const rect = (service as any).createViewportRectFromElement(frameDoc, anchor);

			expect(rect).toMatchObject({
				top: 10,
				left: 20,
				bottom: 34,
				right: 44,
				width: 24,
				height: 24,
			});
			expect(range.selectNodeContents).toHaveBeenCalledWith(anchor);
		} finally {
			service.destroy();
		}
	});

	it("emits pending footnote preview immediately and ignores stale async results after dismissal", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const anchor = frameDoc.createElement("a");
			anchor.setAttribute("href", "notes.xhtml#fn1");
			anchor.textContent = "1";
			frameDoc.body.appendChild(anchor);

			const callback = vi.fn();
			service.onFootnotePreview(callback);

			const rect = {
				top: 12,
				left: 24,
				bottom: 36,
				right: 48,
				width: 24,
				height: 24,
			};
			vi.spyOn(service as any, "createViewportRectFromElement").mockReturnValue(rect);

			const deferred: { resolveInfo: ((value: unknown) => void) | null } = { resolveInfo: null };
			vi.spyOn(service as any, "buildFootnotePreviewInfo").mockImplementation(
				() =>
					new Promise((resolve) => {
						deferred.resolveInfo = resolve;
					})
			);

			(service as any).emitFootnotePreviewForAnchor(frameDoc, anchor);

			expect(callback).toHaveBeenCalledWith({
				href: "notes.xhtml#fn1",
				label: "1",
				text: "脚注内容加载中…",
				rect,
			});

			(service as any).dismissFootnotePreview();

			deferred.resolveInfo?.({
				href: "notes.xhtml#fn1",
				label: "1",
				text: "Resolved footnote text",
				rect,
			});
			await Promise.resolve();
			await Promise.resolve();

			expect(callback).toHaveBeenLastCalledWith(null);
			expect(
				callback.mock.calls.some(
					([info]) => info && (info as { text?: string }).text === "Resolved footnote text"
				)
			).toBe(false);
		} finally {
			service.destroy();
		}
	});

	it("deduplicates rapid pinned footnote preview activations for the same anchor", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const anchor = frameDoc.createElement("a");
			anchor.setAttribute("href", "notes.xhtml#fn1");
			anchor.textContent = "1";
			frameDoc.body.appendChild(anchor);

			const callback = vi.fn();
			service.onFootnotePreview(callback);

			const rect = {
				top: 12,
				left: 24,
				bottom: 36,
				right: 48,
				width: 24,
				height: 24,
			};
			vi.spyOn(service as any, "createViewportRectFromElement").mockReturnValue(rect);

			const deferred: { resolveInfo: ((value: unknown) => void) | null } = { resolveInfo: null };
			const buildSpy = vi.spyOn(service as any, "buildFootnotePreviewInfo").mockImplementation(
				() =>
					new Promise((resolve) => {
						deferred.resolveInfo = resolve;
					})
			);

			(service as any).emitFootnotePreviewForAnchor(frameDoc, anchor, {
				pinned: true,
				suppressRelocateMs: 1800,
			});
			(service as any).emitFootnotePreviewForAnchor(frameDoc, anchor, {
				pinned: true,
				suppressRelocateMs: 1800,
			});

			expect(buildSpy).toHaveBeenCalledTimes(1);
			expect((service as any).footnotePreviewPinned).toBe(true);
			expect(callback).toHaveBeenCalledTimes(1);
			expect(callback).toHaveBeenCalledWith({
				href: "notes.xhtml#fn1",
				label: "1",
				text: "脚注内容加载中…",
				rect,
			});

			deferred.resolveInfo?.({
				href: "notes.xhtml#fn1",
				label: "1",
				text: "Resolved footnote text",
				rect,
			});
			await vi.waitFor(() => {
				expect(callback).toHaveBeenLastCalledWith({
					href: "notes.xhtml#fn1",
					label: "1",
					text: "Resolved footnote text",
					rect,
				});
			});
		} finally {
			service.destroy();
		}
	});

	it("falls back to a terminal footnote status when preview resolution rejects", async () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const anchor = frameDoc.createElement("a");
			anchor.setAttribute("href", "notes.xhtml#fn1");
			anchor.textContent = "1";
			frameDoc.body.appendChild(anchor);

			const callback = vi.fn();
			service.onFootnotePreview(callback);

			const rect = {
				top: 12,
				left: 24,
				bottom: 36,
				right: 48,
				width: 24,
				height: 24,
			};
			vi.spyOn(service as any, "createViewportRectFromElement").mockReturnValue(rect);
			vi.spyOn(service as any, "buildFootnotePreviewInfo").mockRejectedValue(new Error("boom"));

			(service as any).emitFootnotePreviewForAnchor(frameDoc, anchor);

			expect(callback).toHaveBeenNthCalledWith(1, {
				href: "notes.xhtml#fn1",
				label: "1",
				text: "脚注内容加载中…",
				rect,
			});
			await vi.waitFor(() => {
				expect(callback).toHaveBeenLastCalledWith({
					href: "notes.xhtml#fn1",
					label: "1",
					text: "脚注内容暂时无法显示",
					rect,
				});
			});
		} finally {
			service.destroy();
		}
	});

	it("falls back to a terminal footnote status when preview resolution times out", async () => {
		vi.useFakeTimers();
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const anchor = frameDoc.createElement("a");
			anchor.setAttribute("href", "notes.xhtml#fn1");
			anchor.textContent = "1";
			frameDoc.body.appendChild(anchor);

			const callback = vi.fn();
			service.onFootnotePreview(callback);

			const rect = {
				top: 12,
				left: 24,
				bottom: 36,
				right: 48,
				width: 24,
				height: 24,
			};
			vi.spyOn(service as any, "createViewportRectFromElement").mockReturnValue(rect);
			vi.spyOn(service as any, "buildFootnotePreviewInfo").mockImplementation(
				() => new Promise(() => undefined)
			);

			(service as any).emitFootnotePreviewForAnchor(frameDoc, anchor);
			await vi.advanceTimersByTimeAsync(
				(FoliateReaderService as any).FOOTNOTE_PREVIEW_RESOLVE_TIMEOUT_MS + 1
			);

			expect(callback).toHaveBeenNthCalledWith(1, {
				href: "notes.xhtml#fn1",
				label: "1",
				text: "脚注内容加载中…",
				rect,
			});
			expect(callback).toHaveBeenLastCalledWith({
				href: "notes.xhtml#fn1",
				label: "1",
				text: "脚注内容暂时无法显示",
				rect,
			});
		} finally {
			vi.useRealTimers();
			service.destroy();
		}
	});

	it("continues to later footnote candidates when an earlier navigation candidate hangs", async () => {
		vi.useFakeTimers();
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const frameDoc = document.implementation.createHTMLDocument("frame");
			const anchor = frameDoc.createElement("a");
			anchor.setAttribute("href", "part0115_split_000.html#zhu3");
			anchor.textContent = "[3]";
			frameDoc.body.appendChild(anchor);

			(service as any).loadedDocumentSectionIndexes.set(frameDoc, 8);
			vi.spyOn((service as any).parser, "getSectionHrefByIndex").mockImplementation((...args: unknown[]) => {
				const [index] = args as [number];
				if (index === 8) return "text/part0108.xhtml";
				if (index === 9) return "OPS/text/part0115_split_000.html";
				return "";
			});
			vi.spyOn((service as any).parser, "resolveHrefAgainst").mockReturnValue(
				"text/part0115_split_000.html#zhu3"
			);

			const footnoteDoc = document.implementation.createHTMLDocument("footnotes");
			footnoteDoc.body.innerHTML = `
				<section class="notes">
					<p id="zhu3">这是通过超时候选恢复出的脚注内容。</p>
				</section>
			`;
			const footnoteParagraph = footnoteDoc.querySelector("p") as HTMLParagraphElement;
			const footnoteRange = footnoteDoc.createRange();
			footnoteRange.selectNodeContents(footnoteParagraph);

			const resolveNavigationTargetSpy = vi
				.spyOn((service as any).parser, "resolveNavigationTarget")
				.mockImplementation(async (...args: unknown[]) => {
					const [target] = args as [string];
					if (target === "part0115_split_000.html#zhu3") {
						return new Promise(() => undefined);
					}
					if (target === "text/part0115_split_000.html#zhu3") {
						return {
							cfi: null,
							index: 9,
							href: "text/part0115_split_000.html#zhu3",
							doc: footnoteDoc,
							range: footnoteRange,
						};
					}
					return null;
				});

			vi.spyOn(service as any, "createViewportRectFromElement").mockReturnValue({
				top: 12,
				left: 24,
				bottom: 36,
				right: 48,
				width: 24,
				height: 24,
			});

			const infoPromise = (service as any).buildFootnotePreviewInfo(frameDoc, anchor);
			await vi.advanceTimersByTimeAsync(
				(FoliateReaderService as any).FOOTNOTE_PREVIEW_CANDIDATE_TIMEOUT_MS + 1
			);
			const info = await infoPromise;

			expect(resolveNavigationTargetSpy.mock.calls.map(([target]) => target)).toEqual([
				"part0115_split_000.html#zhu3",
				"text/part0115_split_000.html#zhu3",
			]);
			expect(info).toMatchObject({
				href: "part0115_split_000.html#zhu3",
				label: "[3]",
				text: "这是通过超时候选恢复出的脚注内容。",
			});
		} finally {
			vi.useRealTimers();
			service.destroy();
		}
	});

	it("recognizes annotated noteref anchors even when they are not wrapped in sup", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const doc = document.implementation.createHTMLDocument("frame");
			const anchor = doc.createElement("a");
			anchor.setAttribute("href", "notes.xhtml#note-12");
			anchor.setAttribute("epub:type", "noteref");
			anchor.setAttribute("aria-label", "footnote 12");
			anchor.textContent = "12";

			expect((service as any).isFootnoteReference(anchor)).toBe(true);
		} finally {
			service.destroy();
		}
	});

	it("recognizes numeric hash links inside sup as footnote references", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const doc = document.implementation.createHTMLDocument("frame");
			const sup = doc.createElement("sup");
			const anchor = doc.createElement("a");
			anchor.setAttribute("href", "#12");
			anchor.textContent = "12";
			sup.appendChild(anchor);
			doc.body.appendChild(sup);

			expect((service as any).isFootnoteReference(anchor)).toBe(true);
		} finally {
			service.destroy();
		}
	});

	it("recognizes zhu-style external note fragments as footnote references", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const doc = document.implementation.createHTMLDocument("frame");
			const anchor = doc.createElement("a");
			anchor.setAttribute("href", "part0115_split_000.html#zhu44");
			anchor.textContent = "[44]";

			expect((service as any).isFootnoteReference(anchor)).toBe(true);
		} finally {
			service.destroy();
		}
	});

	it("recognizes bracket-number external note links as footnote references", () => {
		const service = new FoliateReaderService(createMockApp(new ArrayBuffer(0)) as any);
		try {
			const doc = document.implementation.createHTMLDocument("frame");
			const anchor = doc.createElement("a");
			anchor.setAttribute("href", "notes.xhtml#44");
			anchor.textContent = "[44]";

			expect((service as any).isFootnoteReference(anchor)).toBe(true);
		} finally {
			service.destroy();
		}
	});

	it("strips Foliate desktop iframe allow-scripts from sandbox values while keeping mobile unchanged", async () => {
		await withPlatformIsMobile(false, async () => {
			const foliateFilterFrame = document.createElement("iframe");
			foliateFilterFrame.setAttribute("part", "filter");
			expect(normalizeDesktopFoliateSandboxValue(
				"sandbox",
				"allow-same-origin allow-scripts",
				"at Frame (src/components/OtherFrame.ts:10:1)",
				foliateFilterFrame
			)).toBe("allow-same-origin");
			expect(normalizeDesktopFoliateSandboxValue(
				"sandbox",
				"allow-same-origin allow-scripts",
				"at Frame (node_modules/foliate-js/paginator.js:234:1)",
				null
			)).toBe("allow-same-origin");
			expect(normalizeDesktopFoliateSandboxValue(
				"sandbox",
				"allow-scripts allow-same-origin",
				"at Frame (node_modules/foliate-js/fixed-layout.js:87:1)",
				null
			)).toBe("allow-same-origin");
			expect(normalizeDesktopFoliateSandboxValue(
				"sandbox",
				"allow-same-origin allow-scripts",
				"at Frame (src/components/OtherFrame.ts:10:1)",
				null
			)).toBeNull();
		});

		await withPlatformIsMobile(true, async () => {
			const foliateFilterFrame = document.createElement("iframe");
			foliateFilterFrame.setAttribute("part", "filter");
			expect(normalizeDesktopFoliateSandboxValue(
				"sandbox",
				"allow-same-origin allow-scripts",
				"at Frame (node_modules/foliate-js/paginator.js:234:1)",
				foliateFilterFrame
			)).toBeNull();
		});
	});

	it("uses the mobile iframe blob fallback so foliate content can still render inside WebView", async () => {
		const originalIframeSrcDescriptor = Object.getOwnPropertyDescriptor(
			HTMLIFrameElement.prototype,
			"src"
		);
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await withPlatformIsMobile(true, async () => {
				const readBlobSpy = vi
					.spyOn(blobUrlText, "readBlobUrlAsText")
					.mockResolvedValue(
						"<html><body><p>mobile iframe fallback content</p></body></html>"
					);

				await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
				const container = document.createElement("div");
				document.body.appendChild(container);
				await service.renderTo(container);

				const iframe = document.createElement("iframe");
				iframe.setAttribute("part", "filter");
				iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
				document.body.appendChild(iframe);
				iframe.src = "blob:weave-mobile-epub";

				await vi.waitFor(() => {
					expect(iframe.srcdoc).toContain("mobile iframe fallback content");
				});
				expect(readBlobSpy).toHaveBeenCalledWith("blob:weave-mobile-epub");
			});
		} finally {
			service.destroy();
			if (originalIframeSrcDescriptor) {
				Object.defineProperty(HTMLIFrameElement.prototype, "src", originalIframeSrcDescriptor);
			}
			resetMobileBlobIframePatchStateForTests();
		}
	});

	it("avoids invoking the native iframe src setter for mobile blob documents before srcdoc fallback resolves", async () => {
		const originalIframeSrcDescriptor = Object.getOwnPropertyDescriptor(
			HTMLIFrameElement.prototype,
			"src"
		);
		let nativeSetterCalls = 0;
		Object.defineProperty(HTMLIFrameElement.prototype, "src", {
			configurable: true,
			enumerable: originalIframeSrcDescriptor?.enumerable ?? true,
			get() {
				return this.getAttribute("src") || "";
			},
			set(value: string) {
				nativeSetterCalls += 1;
				this.setAttribute("src", value);
			},
		});

		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await withPlatformIsMobile(true, async () => {
				const readBlobSpy = vi
					.spyOn(blobUrlText, "readBlobUrlAsText")
					.mockResolvedValue("<html><body><p>mobile iframe srcdoc only</p></body></html>");

				await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
				const container = document.createElement("div");
				document.body.appendChild(container);
				await service.renderTo(container);

				const iframe = document.createElement("iframe");
				document.body.appendChild(iframe);
				iframe.src = "blob:weave-mobile-srcdoc-only";

				await vi.waitFor(() => {
					expect(iframe.srcdoc).toContain("mobile iframe srcdoc only");
				});
				expect(nativeSetterCalls).toBe(0);
				expect(readBlobSpy).toHaveBeenCalledWith("blob:weave-mobile-srcdoc-only");
			});
		} finally {
			service.destroy();
			if (originalIframeSrcDescriptor) {
				Object.defineProperty(HTMLIFrameElement.prototype, "src", originalIframeSrcDescriptor);
			}
			resetMobileBlobIframePatchStateForTests();
		}
	});

	it("inlines blob stylesheets into srcdoc chapter markup to avoid CSP blocks", async () => {
		const originalIframeSrcDescriptor = Object.getOwnPropertyDescriptor(
			HTMLIFrameElement.prototype,
			"src"
		);
		const service = new FoliateReaderService(createMockApp(await createSampleEpubBuffer()) as any);
		try {
			await withPlatformIsMobile(true, async () => {
				vi.spyOn(blobUrlText, "readBlobUrlAsText").mockImplementation(async (href: string) => {
					if (href === "blob:weave-chapter-html") {
						return `<html><head>
							<meta http-equiv="Content-Security-Policy" content="style-src 'unsafe-inline' 'self' https://fonts.googleapis.com">
							<link rel="stylesheet" href="blob:weave-chapter-css"/>
						</head><body><p>chapter</p></body></html>`;
					}
					if (href === "blob:weave-chapter-css") {
						return "p { margin: 2em; }";
					}
					throw new Error(`Unexpected blob read for ${href}`);
				});

				await service.loadEpub("Books/foliate-sample.epub", "foliate-book");
				const container = document.createElement("div");
				document.body.appendChild(container);
				await service.renderTo(container);

				const iframe = document.createElement("iframe");
				document.body.appendChild(iframe);
				iframe.src = "blob:weave-chapter-html";

				await vi.waitFor(() => {
					expect(iframe.srcdoc).toContain('data-weave-inline-stylesheet="true"');
				});
				expect(iframe.srcdoc).toContain("margin: 2em");
				expect(iframe.srcdoc).not.toContain("blob:weave-chapter-css");
				expect(iframe.srcdoc).not.toContain("Content-Security-Policy");
			});
		} finally {
			service.destroy();
			if (originalIframeSrcDescriptor) {
				Object.defineProperty(HTMLIFrameElement.prototype, "src", originalIframeSrcDescriptor);
			}
			resetMobileBlobIframePatchStateForTests();
		}
	});
});
