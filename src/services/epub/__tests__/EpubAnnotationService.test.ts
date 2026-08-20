vi.mock('obsidian', () => ({
	App: class MockApp {},
	TFile: class MockTFile {},
	ItemView: class MockItemView {},
	WorkspaceLeaf: class MockWorkspaceLeaf {},
	MarkdownView: class MockMarkdownView {},
	Notice: class MockNotice {
		constructor(_message?: string) {}
	},
	Menu: class MockMenu {},
	Modal: class MockModal {},
	Plugin: class MockPlugin {},
	PluginSettingTab: class MockPluginSettingTab {},
	Platform: { isMobile: false },
	setIcon: vi.fn(),
	normalizePath: (value: string) => String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, ''),
}));

import { EpubAnnotationService } from '../EpubAnnotationService';

describe('EpubAnnotationService', () => {
	it('clears legacy stored highlights at most once per book and keeps backlink highlights as the live source', async () => {
		let concealedTexts: any[] = [];

		const storageService = {
			removeLegacyHighlights: vi.fn(async () => {}),
			loadConcealedTexts: vi.fn(async () => concealedTexts),
			saveConcealedTexts: vi.fn(async (_bookId: string, nextConcealedTexts: typeof concealedTexts) => {
				concealedTexts = nextConcealedTexts;
			}),
			getCanvasBinding: vi.fn(async () => null),
		} as any;

		const backlinkHighlights = [
			{
				cfiRange: 'epubcfi(/6/2[chapter-1]!/4/2)',
				color: 'green',
				text: 'Live highlight',
				sourceFile: 'Notes/demo.md',
				sourceRef: 'block-ref',
				createdTime: 2,
				presentation: 'highlight',
			},
		];
		const backlinkService = {
			collectHighlights: vi.fn(async () => backlinkHighlights),
		} as any;

		const service = new EpubAnnotationService(storageService);

		await expect(service.collectAllHighlights('book-1', 'Books/demo.epub', backlinkService)).resolves.toEqual([
			{
				...backlinkHighlights[0],
				sourceLocators: [
					{
						sourceFile: 'Notes/demo.md',
						sourceRef: 'block-ref',
					},
				],
			},
		]);
		expect(storageService.removeLegacyHighlights).toHaveBeenCalledTimes(1);

		await expect(service.collectAllHighlights('book-1', 'Books/demo.epub', backlinkService)).resolves.toEqual([
			{
				...backlinkHighlights[0],
				sourceLocators: [
					{
						sourceFile: 'Notes/demo.md',
						sourceRef: 'block-ref',
					},
				],
			},
		]);
		expect(backlinkService.collectHighlights).toHaveBeenCalledTimes(1);

		service.invalidateCollectedHighlightsCache('book-1', 'Books/demo.epub');

		await expect(service.collectAllHighlights('book-1', 'Books/demo.epub', backlinkService)).resolves.toEqual([
			{
				...backlinkHighlights[0],
				sourceLocators: [
					{
						sourceFile: 'Notes/demo.md',
						sourceRef: 'block-ref',
					},
				],
			},
		]);
		expect(backlinkService.collectHighlights).toHaveBeenCalledTimes(2);
	});

	it('keeps separate highlights for the same coarse cfi when excerpt ids differ', async () => {
		const storageService = {
			removeLegacyHighlights: vi.fn(async () => {}),
			loadConcealedTexts: vi.fn(async () => []),
			getCanvasBinding: vi.fn(async () => null),
		} as any;

		const backlinkService = {
			collectHighlights: vi.fn(async () => [
				{
					cfiRange: 'epubcfi(/6/26)',
					color: 'yellow',
					text: '第一段摘录',
					excerptId: 'excerpt-a',
					sourceFile: 'Notes/demo.md',
					createdTime: 1,
				},
				{
					cfiRange: 'epubcfi(/6/26)',
					color: 'green',
					text: '第二段摘录',
					excerptId: 'excerpt-b',
					sourceFile: 'Notes/demo.md',
					createdTime: 2,
				},
			]),
		} as any;

		const service = new EpubAnnotationService(storageService);

		await expect(service.collectAllHighlights('book-1', 'Books/demo.txt', backlinkService)).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'epubcfi(/6/26)',
				text: '第一段摘录',
				excerptId: 'excerpt-a',
			}),
			expect.objectContaining({
				cfiRange: 'epubcfi(/6/26)',
				text: '第二段摘录',
				excerptId: 'excerpt-b',
			}),
		]);
	});

	it('merges all source locators for the same cfi and preserves the preferred primary source', async () => {
		const storageService = {
			removeLegacyHighlights: vi.fn(async () => {}),
			loadConcealedTexts: vi.fn(async () => []),
			getCanvasBinding: vi.fn(async () => null),
		} as any;

		const backlinkService = {
			collectHighlights: vi.fn(async () => [
				{
					cfiRange: 'readium:shared',
					color: 'green',
					text: 'Shared highlight',
					sourceFile: 'Notes/demo.md',
					createdTime: 2,
				},
				{
					cfiRange: 'readium:shared',
					color: 'green',
					style: 'wavy',
					text: 'Shared highlight',
					commentText: '想法正文',
					hasCommentDivider: true,
					sourceFile: 'weave/memory/deck-files/demo_01.wdeck',
					sourceRef: 'card:card-a',
					createdTime: 2,
				},
			]),
		} as any;

		const service = new EpubAnnotationService(storageService);

		await expect(service.collectAllHighlights('book-1', 'Books/demo.epub', backlinkService)).resolves.toEqual([
			{
				cfiRange: 'readium:shared',
				color: 'green',
				style: 'wavy',
				text: 'Shared highlight',
				commentText: '想法正文',
				hasCommentDivider: true,
				sourceFile: 'weave/memory/deck-files/demo_01.wdeck',
				sourceRef: 'card:card-a',
				sourceLocators: [
					{
						sourceFile: 'Notes/demo.md',
						sourceRef: undefined,
					},
					{
						sourceFile: 'weave/memory/deck-files/demo_01.wdeck',
						sourceRef: 'card:card-a',
					},
				],
				createdTime: 2,
				presentation: 'highlight',
			},
		]);
	});

	it('prefers canvas file-node locators as the primary backlink target when present alongside a markdown excerpt source', async () => {
		const storageService = {
			removeLegacyHighlights: vi.fn(async () => {}),
			loadConcealedTexts: vi.fn(async () => []),
			getCanvasBinding: vi.fn(async () => null),
		} as any;

		const backlinkService = {
			collectHighlights: vi.fn(async () => [
				{
					cfiRange: 'readium:canvas-shared',
					color: 'purple',
					text: 'Canvas shared highlight',
					sourceFile: 'Notes/demo.md',
					excerptId: 'excerpt-fixed',
					sourceLocators: [
						{
							sourceFile: 'Canvas/demo.canvas',
							sourceRef: 'canvas-file-node:file-node-1',
							excerptId: 'excerpt-fixed',
						},
					],
					createdTime: 3,
				},
			]),
		} as any;

		const service = new EpubAnnotationService(storageService);

		await expect(service.collectAllHighlights('book-1', 'Books/demo.epub', backlinkService)).resolves.toEqual([
			{
				cfiRange: 'readium:canvas-shared',
				color: 'purple',
				text: 'Canvas shared highlight',
				sourceFile: 'Canvas/demo.canvas',
				sourceRef: 'canvas-file-node:file-node-1',
				excerptId: 'excerpt-fixed',
				sourceLocators: [
					{
						sourceFile: 'Notes/demo.md',
						sourceRef: undefined,
						excerptId: 'excerpt-fixed',
					},
					{
						sourceFile: 'Canvas/demo.canvas',
						sourceRef: 'canvas-file-node:file-node-1',
						excerptId: 'excerpt-fixed',
					},
				],
				createdTime: 3,
				presentation: 'highlight',
			},
		]);
	});

	it('exports book highlights to markdown as complete epub quote blocks with metadata', async () => {
		const storageService = {
			getApp: vi.fn(() => ({
				vault: {
					getAbstractFileByPath: vi.fn(() => null),
				},
				fileManager: {
					generateMarkdownLink: vi.fn(),
				},
			})),
			getBook: vi.fn(async () => ({
				id: 'book-1',
				filePath: 'Books/demo.epub',
				sourceId: 'epubsrc-demo',
				metadata: {
					title: '示例 EPUB',
					author: '张三',
					publisher: '测试出版社',
				},
				currentPosition: {
					percent: 42,
				},
			})),
			removeLegacyHighlights: vi.fn(async () => {}),
			loadConcealedTexts: vi.fn(async () => []),
			getCanvasBinding: vi.fn(async () => null),
		} as any;

		const backlinkService = {
			collectHighlights: vi.fn(async () => [
				{
					cfiRange: 'epubcfi(/6/4)',
					color: 'yellow',
					text: '第一条高亮',
					chapterIndex: 2,
					chapterTitle: '雪夜的故事',
					sourceFile: 'Notes/demo.md',
					excerptId: 'excerpt-a',
					createdTime: new Date('2026-04-27T13:32:00').getTime(),
					presentation: 'highlight',
				},
				{
					cfiRange: 'epubcfi(/6/6)',
					color: 'blue',
					text: '第二条高亮',
					chapterIndex: 3,
					chapterTitle: '晨光',
					sourceFile: 'Notes/demo.md',
					excerptId: 'excerpt-b',
					createdTime: new Date('2026-04-28T09:15:00').getTime(),
					presentation: 'highlight',
				},
			]),
		} as any;

		const service = new EpubAnnotationService(storageService);

		const markdown = await service.exportToMarkdown('book-1', {
			filePath: 'Books/demo.epub',
			backlinkService,
		});

		expect(markdown).toContain('# 示例 EPUB - 阅读笔记');
		expect(markdown).toContain('- **作者**: 张三');
		expect(markdown).toContain('- **出版社**: 测试出版社');
		expect(markdown).toContain('- **阅读进度**: 42%');
		expect(markdown).toContain('## 高亮');
		expect(markdown).toMatch(
			/> \[!EPUB\|yellow\] \[\[Books\/demo\.epub#weave-cfi=epubcfi\(\/6\/4\).*&sid=epubsrc-demo&eid=excerpt-a\|demo\]\] \[雪夜的故事\] 2026-04-27 13:32\n> 第一条高亮\n/
		);
		expect(markdown).toMatch(
			/> \[!EPUB\|blue\] \[\[Books\/demo\.epub#weave-cfi=epubcfi\(\/6\/6\).*&sid=epubsrc-demo&eid=excerpt-b\|demo\]\] \[晨光\] 2026-04-28 09:15\n> 第二条高亮\n/
		);
		expect(markdown).not.toContain('&text=');
		expect(markdown).toContain('> 第一条高亮');
		expect(markdown).toContain('> 第二条高亮');
	});

	it('persists and loads direct reader highlights including underlines and wavy lines', async () => {
		let directHighlights: any[] = [];
		const storageService = {
			removeLegacyHighlights: vi.fn(async () => {}),
			loadConcealedTexts: vi.fn(async () => []),
			loadDirectHighlights: vi.fn(async () => directHighlights),
			addDirectHighlight: vi.fn(async (_bookId: string, item: any) => {
				directHighlights.push(item);
			}),
			deleteDirectHighlightByCfi: vi.fn(async (_bookId: string, cfi: string) => {
				directHighlights = directHighlights.filter((d) => d.cfiRange !== cfi);
			}),
			updateDirectHighlight: vi.fn(async (_bookId: string, cfi: string, updates: any) => {
				const item = directHighlights.find((d) => d.cfiRange === cfi);
				if (item) {
					if (updates.color) item.color = updates.color;
					if (updates.style !== undefined) item.style = updates.style;
				}
			}),
			getCanvasBinding: vi.fn(async () => null),
		} as any;

		const backlinkService = {
			collectHighlights: vi.fn(async () => []),
		} as any;

		const service = new EpubAnnotationService(storageService);

		// Add direct underline
		await service.createDirectHighlight('book-1', {
			cfiRange: 'epubcfi(/6/2!/4/10)',
			color: 'yellow',
			style: 'underline',
			text: 'Underlined text',
		});

		// Add direct wavy line
		await service.createDirectHighlight('book-1', {
			cfiRange: 'epubcfi(/6/2!/4/12)',
			color: 'purple',
			style: 'wavy',
			text: 'Wavy text',
		});

		// Add direct color highlight
		await service.createDirectHighlight('book-1', {
			cfiRange: 'epubcfi(/6/2!/4/14)',
			color: 'green',
			text: 'Green highlight',
		});

		const highlights = await service.collectAllHighlights('book-1', 'Books/test.epub', backlinkService);
		expect(highlights.length).toBe(3);
		expect(highlights[0]).toMatchObject({
			cfiRange: 'epubcfi(/6/2!/4/10)',
			color: 'yellow',
			style: 'underline',
			text: 'Underlined text',
		});
		expect(highlights[1]).toMatchObject({
			cfiRange: 'epubcfi(/6/2!/4/12)',
			color: 'purple',
			style: 'wavy',
			text: 'Wavy text',
		});
		expect(highlights[2]).toMatchObject({
			cfiRange: 'epubcfi(/6/2!/4/14)',
			color: 'green',
			text: 'Green highlight',
		});

		// Update style
		await service.updateDirectHighlight('book-1', 'epubcfi(/6/2!/4/14)', { style: 'strikethrough', color: 'red' });
		const updated = await service.collectAllHighlights('book-1', 'Books/test.epub', backlinkService);
		expect(updated[2]).toMatchObject({
			cfiRange: 'epubcfi(/6/2!/4/14)',
			color: 'red',
			style: 'strikethrough',
			text: 'Green highlight',
		});

		// Delete one -> reload does not resurrect
		await service.deleteDirectHighlightByCfi('book-1', 'epubcfi(/6/2!/4/10)');
		const remaining = await service.collectAllHighlights('book-1', 'Books/test.epub', backlinkService);
		expect(remaining.length).toBe(2);
		expect(remaining.find(h => h.cfiRange === 'epubcfi(/6/2!/4/10)')).toBeUndefined();
	});

	it('persists and restores annotations across serialization roundtrip', async () => {
		const { normalizeLocalReaderData } = await import('../epub-local-data-normalize');

		const storedData = {
			version: 1,
			updatedAt: Date.now(),
			books: {
				'book-abc': {
					directHighlights: [
						{
							cfiRange: 'epubcfi(/6/4!/4/2)',
							color: 'blue',
							style: 'underline',
							text: 'Saved underline',
							createdTime: 1000,
						},
						{
							cfiRange: 'epubcfi(/6/4!/4/8)',
							color: 'yellow',
							style: 'wavy',
							text: 'Saved wavy line',
							createdTime: 2000,
						},
						{
							cfiRange: 'epubcfi(/6/4!/4/16)',
							color: 'green',
							text: 'Saved green mark',
							createdTime: 3000,
						},
					],
				},
			},
		};

		// Normalize (simulates disk read/write serialization cycle)
		const normalized = normalizeLocalReaderData(storedData);
		expect(normalized.books['book-abc']?.directHighlights).toHaveLength(3);
		expect(normalized.books['book-abc']?.directHighlights?.[0]).toEqual({
			id: undefined,
			cfiRange: 'epubcfi(/6/4!/4/2)',
			color: 'blue',
			style: 'underline',
			text: 'Saved underline',
			chapterIndex: undefined,
			chapterTitle: undefined,
			createdTime: 1000,
		});
		expect(normalized.books['book-abc']?.directHighlights?.[1]).toEqual({
			id: undefined,
			cfiRange: 'epubcfi(/6/4!/4/8)',
			color: 'yellow',
			style: 'wavy',
			text: 'Saved wavy line',
			chapterIndex: undefined,
			chapterTitle: undefined,
			createdTime: 2000,
		});
		expect(normalized.books['book-abc']?.directHighlights?.[2]).toEqual({
			id: undefined,
			cfiRange: 'epubcfi(/6/4!/4/16)',
			color: 'green',
			style: undefined,
			text: 'Saved green mark',
			chapterIndex: undefined,
			chapterTitle: undefined,
			createdTime: 3000,
		});
	});

	it('unconditionally creates, saves, and restores directHighlights even without excerpt notes capability', async () => {
		const directStorage: Record<string, any[]> = {};
		const storageService = {
			removeLegacyHighlights: vi.fn(async () => {}),
			loadConcealedTexts: vi.fn(async () => []),
			getCanvasBinding: vi.fn(async () => null),
			loadDirectHighlights: vi.fn(async (bookId: string) => directStorage[bookId] || []),
			addDirectHighlight: vi.fn(async (bookId: string, item: any) => {
				directStorage[bookId] = directStorage[bookId] || [];
				directStorage[bookId].push(item);
			}),
		} as any;

		const service = new EpubAnnotationService(storageService);
		const bookId = 'epub-book-flowers';

		// 1. Create a yellow highlight directly
		await service.createDirectHighlight(bookId, {
			cfiRange: 'epubcfi(/6/12!/4/2)',
			color: 'yellow',
			style: undefined,
			text: 'Charlie Gordon',
			chapterIndex: 5,
			chapterTitle: 'Progress Report 8',
		});

		// 2. Create a strikethrough line
		await service.createDirectHighlight(bookId, {
			cfiRange: 'epubcfi(/6/12!/4/8)',
			color: 'yellow',
			style: 'strikethrough',
			text: 'crossed out text',
			chapterIndex: 5,
			chapterTitle: 'Progress Report 8',
		});

		// 3. Create a wavy line
		await service.createDirectHighlight(bookId, {
			cfiRange: 'epubcfi(/6/12!/4/14)',
			color: 'yellow',
			style: 'wavy',
			text: 'wavy text',
			chapterIndex: 5,
			chapterTitle: 'Progress Report 8',
		});

		// Verify storage has 3 direct highlights
		expect(directStorage[bookId]).toHaveLength(3);
		expect(directStorage[bookId][0].color).toBe('yellow');
		expect(directStorage[bookId][1].style).toBe('strikethrough');
		expect(directStorage[bookId][2].style).toBe('wavy');

		// 4. Simulate re-opening the book (backlinkService is empty / no markdown notes capability)
		const backlinkService = {
			collectHighlights: vi.fn(async () => []),
		} as any;

		const restoredHighlights = await service.collectAllHighlights(
			bookId,
			'Books/Flowers for Algernon.epub',
			backlinkService
		);

		expect(restoredHighlights).toHaveLength(3);
		expect(restoredHighlights[0].cfiRange).toBe('epubcfi(/6/12!/4/2)');
		expect(restoredHighlights[0].color).toBe('yellow');
		expect(restoredHighlights[1].style).toBe('strikethrough');
		expect(restoredHighlights[2].style).toBe('wavy');
	});
});
