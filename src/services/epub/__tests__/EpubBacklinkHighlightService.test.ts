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

import { TFile } from 'obsidian';
import { CURRENT_PLUGIN_ID } from '../../../config/plugin-runtime';
import { EpubBacklinkHighlightService } from '../EpubBacklinkHighlightService';
import { EpubExcerptOfficialApiService } from '../EpubExcerptOfficialApiService';

type MockFile = {
	path: string;
	name: string;
	extension: string;
};

type OpenMarkdownViewMock = {
	file: MockFile;
	editor: {
		getValue: () => string;
		setValue: (value: string) => void;
	};
	save: () => Promise<void>;
};

function createFile(path: string): MockFile {
	const normalized = path.replace(/\\/g, '/');
	return Object.assign(new TFile(), {
		path: normalized,
		name: normalized.split('/').pop() || normalized,
		extension: normalized.split('.').pop() || '',
		basename: (normalized.split('/').pop() || normalized).replace(/\.[^.]+$/, ''),
		parent: {
			path: normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '/',
		},
		stat: {
			size: 0,
			mtime: 1710000000000,
		},
	});
}

function createMockApp(
	initialFiles: Record<string, string>,
	options?: {
		openMarkdownPaths?: string[];
		runtimePlugin?: Record<string, any>;
	}
) {
	const files = new Map<string, string>(Object.entries(initialFiles));
	const vaultEventHandlers = new Map<string, Array<(...args: any[]) => void>>();
	const openMarkdownViews: OpenMarkdownViewMock[] = (options?.openMarkdownPaths || []).map((path) => {
		const normalizedPath = path.replace(/\\/g, '/');
		let value = files.get(normalizedPath) || '';
		return {
			file: createFile(normalizedPath),
			editor: {
				getValue: () => value,
				setValue: (nextValue: string) => {
					value = nextValue;
					files.set(normalizedPath, nextValue);
				},
			},
			save: vi.fn(async () => undefined),
		};
	});

	const app: any = {
		vault: {
			adapter: {
				exists: vi.fn(async (path: string) => files.has(path.replace(/\\/g, '/'))),
				mkdir: vi.fn(async (_path: string) => undefined),
				read: vi.fn(async (path: string) => {
					const normalizedPath = path.replace(/\\/g, '/');
					const value = files.get(normalizedPath);
					if (value === undefined) {
						throw new Error(`Missing file: ${normalizedPath}`);
					}
					return value;
				}),
				write: vi.fn(async (path: string, value: string) => {
					files.set(path.replace(/\\/g, '/'), value);
				}),
				stat: vi.fn(async (path: string) => {
					const normalizedPath = path.replace(/\\/g, '/');
					if (!files.has(normalizedPath)) {
						throw new Error(`Missing file: ${normalizedPath}`);
					}
					return {
						size: (files.get(normalizedPath) || '').length,
						mtime: 1710000000000,
					};
				}),
				readBinary: vi.fn(async (path: string) => {
					const normalizedPath = path.replace(/\\/g, '/');
					const value = files.get(normalizedPath);
					if (value === undefined) {
						throw new Error(`Missing file: ${normalizedPath}`);
					}
					return new TextEncoder().encode(value);
				}),
			},
			cachedRead: vi.fn(async (file: MockFile) => files.get(file.path) || ''),
			modify: vi.fn(async (file: MockFile, updated: string) => {
				files.set(file.path, updated);
			}),
			getMarkdownFiles: vi.fn(() =>
				Array.from(files.keys())
					.filter((path) => path.endsWith('.md'))
					.map((path) => createFile(path))
			),
			getFiles: vi.fn(() =>
				Array.from(files.keys()).map((path) => createFile(path))
			),
			getAbstractFileByPath: vi.fn((path: string) => {
				const normalized = path.replace(/\\/g, '/');
				return files.has(normalized) ? createFile(normalized) : null;
			}),
			process: vi.fn(async (file: MockFile, mutator: (content: string) => string) => {
				const current = files.get(file.path);
				if (current === undefined) {
					throw new Error(`Missing file: ${file.path}`);
				}
				files.set(file.path, mutator(current));
			}),
			on: vi.fn((event: string, callback: (...args: any[]) => void) => {
				const handlers = vaultEventHandlers.get(event) || [];
				handlers.push(callback);
				vaultEventHandlers.set(event, handlers);
				return { event, callback };
			}),
			offref: vi.fn((ref: { event?: string; callback?: (...args: any[]) => void }) => {
				const event = String(ref?.event || '');
				const callback = ref?.callback;
				if (!event || typeof callback !== 'function') {
					return;
				}
				const handlers = vaultEventHandlers.get(event) || [];
				vaultEventHandlers.set(
					event,
					handlers.filter((handler) => handler !== callback)
				);
			}),
		},
		workspace: {
			getLeavesOfType: vi.fn((type: string) => {
				if (type !== 'markdown') {
					return [];
				}
				return openMarkdownViews.map((view) => ({ view }));
			}),
			trigger: vi.fn(),
		},
		metadataCache: {
			resolvedLinks: {
				'Notes/demo.md': {
					'Books/demo.epub': 1,
				},
			},
			getFileCache: vi.fn(() => null),
			getBacklinksForFile: vi.fn(() => null),
			on: vi.fn(),
			off: vi.fn(),
		},
		plugins: {
			getPlugin: vi.fn(() => options?.runtimePlugin || ({
				settings: { weaveParentFolder: '' },
			})),
		},
	};

	return { app, files, openMarkdownViews, vaultEventHandlers };
}

describe('EpubBacklinkHighlightService', () => {
	it('collects current and legacy epub callouts while ignoring same-name books in other folders', async () => {
		const noteContent = [
			'> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]] 2026-03-28 12:00',
			'> Current quote',
			'',
			'> [!EPUB|red] [[Archive/demo.epub#weave-cfi=readium%3Aother|Other]]',
			'> Wrong book',
			'',
			'> [!EPUB|blue] [Legacy](obsidian://weave-epub?vault=Vault&file=Books%2Fdemo.epub&cfi=epubcfi(/6/8)&text=Legacy)',
			'> Legacy quote',
			'',
		].join('\n');
		const { app } = createMockApp({
			'Notes/demo.md': noteContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const highlights = await service.collectHighlights('Books/demo.epub');

		expect(highlights).toHaveLength(2);
		expect(highlights).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					cfiRange: 'readium:alpha',
					color: 'green',
					text: 'Current quote',
					sourceFile: 'Notes/demo.md',
					createdTime: new Date('2026-03-28T12:00').getTime(),
					hasCommentDivider: false,
				}),
				expect.objectContaining({
					cfiRange: 'epubcfi(/6/8)',
					color: 'blue',
					text: 'Legacy quote',
					sourceFile: 'Notes/demo.md',
					hasCommentDivider: false,
				}),
			])
		);
	});

	it('parses strikethrough markdown source back into clean display text', async () => {
		const noteContent = [
			'> [!EPUB|purple+strikethrough] [[Books/demo.epub#weave-cfi=readium%3Ahidden|Demo]]',
			'> ~~Hidden quote~~',
			'',
		].join('\n');
		const { app } = createMockApp({
			'Notes/hidden.md': noteContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		await expect(service.collectHighlights('Books/demo.epub')).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'readium:hidden',
				color: 'purple',
				style: 'strikethrough',
				text: 'Hidden quote',
				sourceFile: 'Notes/hidden.md',
				hasCommentDivider: false,
			}),
		]);
	});

	it('recovers a translation study note as a purple reading-note Marker', async () => {
		const noteContent = [
			'> [!EPUB|purple+reading-note]- [[Books/demo.epub#weave-cfi=readium%3Avocabulary&eid=vocab01|📖 old · adjective]]',
			'> old',
			'> <!-- div -->',
			'> **语境义**：最古老的',
			'^vocab01',
			'',
		].join('\n');
		const { app } = createMockApp({
			'Notes/外文笔记/demo.md': noteContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		await expect(service.collectHighlights('Books/demo.epub')).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'readium:vocabulary',
				color: 'purple',
				style: 'reading-note',
				text: 'old',
				commentText: '**语境义**：最古老的',
				excerptId: 'vocab01',
				sourceFile: 'Notes/外文笔记/demo.md',
			}),
		]);
	});

	it('deletes a persisted reading-note callout by its excerpt id', async () => {
		const notePath = 'Notes/读书笔记/demo.md';
		const noteContent = [
			'# Demo · 读书笔记',
			'',
			'## 读书笔记',
			'',
			'> [!EPUB|purple+reading-note] [[Books/demo.epub#weave-cfi=readium%3Areading-note&eid=note01|Demo]]',
			'> A note-backed excerpt',
			'> <!-- div -->',
			'> [↗ 回到原文](obsidian://zora-reader?file=Books%2Fdemo.epub&cfi=readium%3Areading-note)',
			'>',
			'> My comment',
			'^note01',
			'',
		].join('\n');
		const { app, files } = createMockApp({
			[notePath]: noteContent,
			'Books/demo.epub': 'binary',
		});
		const service = new EpubBacklinkHighlightService(app);

		const deleted = await service.deleteHighlight(
			notePath,
			'readium:reading-note',
			'Books/demo.epub',
			undefined,
			'note01'
		);

		expect(deleted).toBe(true);
		expect(files.get(notePath)).not.toContain('reading-note');
		expect(files.get(notePath)).not.toContain('^note01');
		expect(files.get(notePath)).toContain('# Demo · 读书笔记');
	});

	it('collects excerpts that use shortest wikilink paths from the source note context', async () => {
		const notePath = 'Notes/short-link.md';
		const noteContent = [
			'> [!EPUB|yellow] [[demo.epub#weave-cfi=readium%3Ashort-link|Demo]]',
			'> Short link quote',
			'',
		].join('\n');
		const { app } = createMockApp({
			[notePath]: noteContent,
			'Books/demo.epub': 'binary',
		});
		app.metadataCache.getFirstLinkpathDest = vi.fn((linkpath: string, sourcePath: string) => {
			if (linkpath === 'demo.epub' && sourcePath === notePath) {
				return createFile('Books/demo.epub');
			}
			return null;
		});
		const service = new EpubBacklinkHighlightService(app);

		await expect(service.collectHighlights('Books/demo.epub')).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'readium:short-link',
				color: 'yellow',
				text: 'Short link quote',
				sourceFile: notePath,
			}),
		]);
	});

	it('reuses the single-file disk cache when the highlight source manifest is unchanged', async () => {
		const notePath = 'Notes/cache-hit.md';
		const noteContent = [
			'> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Acached|Demo]]',
			'> Cached quote',
			'',
		].join('\n');
		const { app } = createMockApp({
			[notePath]: noteContent,
		});
		app.metadataCache.resolvedLinks = {
			[notePath]: {
				'Books/demo.epub': 1,
			},
		};
		const service = new EpubBacklinkHighlightService(app);

		const firstHighlights = await service.collectHighlights('Books/demo.epub');
		const readCallsAfterFirstLoad = (app.vault.cachedRead as any).mock.calls.filter(
			([file]: [MockFile]) => file.path.replace(/\\/g, '/') === notePath
		).length;
		const secondHighlights = await service.collectHighlights('Books/demo.epub');
		const readCallsAfterSecondLoad = (app.vault.cachedRead as any).mock.calls.filter(
			([file]: [MockFile]) => file.path.replace(/\\/g, '/') === notePath
		).length;

		expect(firstHighlights).toEqual(secondHighlights);
		expect(readCallsAfterFirstLoad).toBeGreaterThanOrEqual(1);
		expect(readCallsAfterSecondLoad).toBeLessThanOrEqual(readCallsAfterFirstLoad);
		expect(app.vault.adapter.write).toHaveBeenCalledWith(
			expect.stringContaining('epub-backlink-highlights-cache.json'),
			expect.any(String)
		);
	});

	it('refreshBookHighlightsIncremental patches disk cache from changed sources only', async () => {
		const notePath = 'Notes/incremental-patch.md';
		const initialContent = [
			'> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Akeep|Demo]]',
			'> Keep me',
			'',
			'> [!EPUB|yellow] [[Books/demo.epub#weave-cfi=readium%3Aupdate|Demo]]',
			'> Old quote',
			'',
		].join('\n');
		const { app, files } = createMockApp({
			[notePath]: initialContent,
		});
		app.metadataCache.resolvedLinks = {
			[notePath]: {
				'Books/demo.epub': 1,
			},
		};
		const service = new EpubBacklinkHighlightService(app);

		await service.collectHighlights('Books/demo.epub');
		files.set(
			notePath,
			[
				'> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Akeep|Demo]]',
				'> Keep me',
				'',
				'> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Aupdate|Demo]]',
				'> New quote',
				'',
			].join('\n')
		);

		const patched = await service.refreshBookHighlightsIncremental('Books/demo.epub', [notePath]);
		expect(patched).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					cfiRange: 'readium:keep',
					text: 'Keep me',
				}),
				expect.objectContaining({
					cfiRange: 'readium:update',
					color: 'blue',
					text: 'New quote',
				}),
			])
		);
		expect(patched).toHaveLength(2);
	});

	it('invalidates cached highlights when the source excerpt is removed', async () => {
		const notePath = 'Notes/cache-invalidation.md';
		const noteContent = [
			'> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aremove-me|Demo]]',
			'> Remove me',
			'',
		].join('\n');
		const { app, files, vaultEventHandlers } = createMockApp({
			[notePath]: noteContent,
		});
		app.metadataCache.resolvedLinks = {
			[notePath]: {
				'Books/demo.epub': 1,
			},
		};
		const service = new EpubBacklinkHighlightService(app);

		await expect(service.collectHighlights('Books/demo.epub')).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'readium:remove-me',
				color: 'green',
				text: 'Remove me',
				sourceFile: notePath,
				hasCommentDivider: false,
			}),
		]);

		files.set(notePath, 'Plain tail');
		for (const handler of vaultEventHandlers.get('modify') || []) {
			handler(createFile(notePath));
		}

		await expect(service.collectHighlights('Books/demo.epub')).resolves.toEqual([]);
	});

	it('detects whether a newly changed markdown file may affect the current epub highlights', async () => {
		const notePath = 'Notes/potential-source.md';
		const unrelatedPath = 'Notes/unrelated.md';
		const { app } = createMockApp({
			[notePath]: [
				'> [!EPUB|purple] [[Books/demo.epub#weave-cfi=readium%3Anew-source|Demo]]',
				'> New source quote',
				'',
			].join('\n'),
			[unrelatedPath]: '# plain note',
		});
		const service = new EpubBacklinkHighlightService(app);

		await expect(service.mayFileAffectHighlights(notePath, 'Books/demo.epub')).resolves.toBe(true);
		await expect(service.mayFileAffectHighlights(unrelatedPath, 'Books/demo.epub')).resolves.toBe(false);
	});

	it('detects nested wdeck card data as affecting current epub highlights', async () => {
		const wdeckPath = 'weave/memory/deck-files/nested-demo_01.wdeck';
		const wdeckContent = JSON.stringify({
			fileType: 'wdeck',
			logicalDeckId: 'nested-demo',
			logicalDeckName: '嵌套牌组',
			segments: [
				{
					cards: [
						{
							uuid: 'card-nested-affect',
							content: [
								'---',
								'we_source: "[[Books/demo.epub#weave-cfi=readium%3Anested-affect&sid=epubsrc-demo|Demo]]"',
								'---',
								'Nested affect quote',
							].join('\n'),
						},
					],
				},
			],
		});
		const { app } = createMockApp({
			[wdeckPath]: wdeckContent,
		});
		const service = new EpubBacklinkHighlightService(app);
		(service as any).storageService.ensureSourceIdentity = vi.fn(async () => ({ sourceId: 'epubsrc-demo' }));

		await expect(service.mayFileAffectHighlights(wdeckPath, 'Books/demo.epub')).resolves.toBe(true);
	});

	it('detects moved wdeck files outside the default deck-files directory as affecting current epub highlights', async () => {
		const wdeckPath = 'vault/study/renamed-deck_03.wdeck';
		const wdeckContent = JSON.stringify({
			fileType: 'wdeck',
			logicalDeckId: 'deck-moved',
			logicalDeckName: '移动牌组',
			segmentIndex: 3,
			cards: [
				{
					uuid: 'card-moved-affect',
					content: [
						'---',
						'we_source: "[[Books/demo.epub#weave-cfi=readium%3Amoved-affect&sid=epubsrc-demo|Demo]]"',
						'---',
						'Moved affect quote',
					].join('\n'),
				},
			],
		});
		const { app } = createMockApp({
			[wdeckPath]: wdeckContent,
		});
		const service = new EpubBacklinkHighlightService(app);
		(service as any).storageService.ensureSourceIdentity = vi.fn(async () => ({ sourceId: 'epubsrc-demo' }));

		await expect(service.mayFileAffectHighlights(wdeckPath, 'Books/demo.epub')).resolves.toBe(true);
	});

	it('collects sid-bound highlights after the epub file is renamed to a new path', async () => {
		const notePath = 'Notes/renamed.md';
		const noteContent = [
			'> [!EPUB|green] [[Archive/old-demo.epub#weave-cfi=readium%3Aalpha&sid=epubsrc-stable|Demo]] 2026-03-28 12:00',
			'> Renamed quote',
			'',
		].join('\n');
		const { app } = createMockApp({
			[notePath]: noteContent,
			'Books/new-demo.epub': 'same-binary',
			'weave/incremental-reading/epub-reading/epub-source-registry.json': JSON.stringify([
				{
					sourceId: 'epubsrc-stable',
					filePath: 'Books/new-demo.epub',
					lastSeenAt: 1710000000000,
					lastKnownPath: 'Books/new-demo.epub',
				},
			]),
		});
		app.metadataCache.resolvedLinks = {};
		const service = new EpubBacklinkHighlightService(app);

		const highlights = await service.collectHighlights('Books/new-demo.epub');

		expect(highlights).toEqual([
			expect.objectContaining({
				cfiRange: 'readium:alpha',
				color: 'green',
				text: 'Renamed quote',
				sourceFile: notePath,
				createdTime: new Date('2026-03-28T12:00').getTime(),
				hasCommentDivider: false,
			}),
		]);
	});

	it('deletes sid-bound highlights even when the stored callout still points at the old epub path', async () => {
		const notePath = 'Notes/renamed-delete.md';
		const noteContent = [
			'> [!EPUB|blue] [[Archive/old-demo.epub#weave-cfi=epubcfi(/6/8)&sid=epubsrc-stable|Demo]]',
			'> Legacy quote',
			'',
			'Plain tail',
		].join('\n');
		const { app, files } = createMockApp({
			[notePath]: noteContent,
			'Books/new-demo.epub': 'same-binary',
			'weave/incremental-reading/epub-reading/epub-source-registry.json': JSON.stringify([
				{
					sourceId: 'epubsrc-stable',
					filePath: 'Books/new-demo.epub',
					lastSeenAt: 1710000000000,
					lastKnownPath: 'Books/new-demo.epub',
				},
			]),
		});
		const service = new EpubBacklinkHighlightService(app);

		const deleted = await service.deleteHighlight(notePath, 'epubcfi(/6/8)', 'Books/new-demo.epub');

		expect(deleted).toBe(true);
		expect(files.get(notePath)).toBe('Plain tail');
	});

	it('notifies workspace and data sync after deleting a markdown-backed excerpt', async () => {
		const notePath = 'Notes/delete-notify.md';
		const notifyChange = vi.fn(async () => undefined);
		const clearDeckAggregationCache = vi.fn();
		const clearAnalyticsCache = vi.fn();
		const runtimePlugin = {
			settings: { weaveParentFolder: '' },
			dataSyncService: { notifyChange },
			deckAggregationService: { clearCache: clearDeckAggregationCache },
			analyticsService: { clearCache: clearAnalyticsCache },
		};
		const { app } = createMockApp(
			{
				[notePath]: [
					'> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Adelete-notify|Demo]]',
					'> Quote to remove',
					'',
					'Plain tail',
				].join('\n'),
			},
			{ runtimePlugin }
		);
		const service = new EpubBacklinkHighlightService(app);

		const deleted = await service.deleteHighlight(
			notePath,
			'readium:delete-notify',
			'Books/demo.epub'
		);

		expect(deleted).toBe(true);
		expect(clearDeckAggregationCache).toHaveBeenCalled();
		expect(clearAnalyticsCache).toHaveBeenCalled();
		expect(app.workspace.trigger).toHaveBeenCalledWith(
			'Weave:card-updated',
			expect.objectContaining({
				type: 'cards',
				action: 'update',
				ids: [],
				sourcePath: notePath,
			})
		);
		expect(app.workspace.trigger).toHaveBeenCalledWith('Weave:data-changed');
		expect(notifyChange).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'cards',
				action: 'update',
				ids: [],
				sourcePath: notePath,
			})
		);
	});

	it('resolves json card source with card reference when locating by cfi', async () => {
		const jsonPath = 'weave/memory/cards/cards-0.json';
		const jsonContent = JSON.stringify({
			cards: [
				{
					uuid: 'card-a',
					content: '> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]\n> Quote A\n',
				},
				{
					uuid: 'card-b',
					content: '> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Abeta|Demo]]\n> Quote B\n',
				},
			],
		});
		const { app } = createMockApp({
			[jsonPath]: jsonContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const match = await service.findSourceForCfi('readium:beta', 'Books/demo.epub');

		expect(match).toEqual({
			sourceFile: jsonPath,
			sourceRef: 'card:card-b',
			cfiRange: 'readium:beta',
		});
	});

	it('falls back to highlight text when a temporary canonical cfi no longer matches the stored card locator', async () => {
		const jsonPath = 'weave/memory/cards/cards-0.json';
		const jsonContent = JSON.stringify({
			cards: [
				{
					uuid: 'card-a',
					content: '> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Alegacy-alpha|Demo]]\n> Quote A\n',
				},
				{
					uuid: 'card-b',
					content: '> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Alegacy-beta|Demo]] 2026-03-28 12:00\n> Quote B\n',
				},
			],
		});
		const { app } = createMockApp({
			[jsonPath]: jsonContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const match = await service.findSourceForCfi('epubcfi(/6/8!/4/2)', 'Books/demo.epub', undefined, {
			text: 'Quote B',
			createdTime: new Date('2026-03-28T12:00').getTime(),
		});

		expect(match).toEqual({
			sourceFile: jsonPath,
			sourceRef: 'card:card-b',
			cfiRange: 'readium:legacy-beta',
		});
	});

	it('collects card-data highlights from a custom Weave parent folder', async () => {
		const jsonPath = 'custom-weave/weave/memory/cards/cards-0.json';
		const jsonContent = JSON.stringify({
			cards: [
				{
					uuid: 'card-custom',
					content: '> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Acustom|Demo]]\n> Custom root quote\n',
				},
			],
		});
		const { app } = createMockApp({
			[jsonPath]: jsonContent,
		});
		app.plugins.getPlugin = vi.fn(() => ({
			settings: { weaveParentFolder: 'custom-weave' },
		}));
		const service = new EpubBacklinkHighlightService(app);

		await expect(service.collectHighlights('Books/demo.epub')).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'readium:custom',
				color: 'green',
				text: 'Custom root quote',
				sourceFile: jsonPath,
				sourceRef: 'card:card-custom',
				hasCommentDivider: false,
			}),
		]);
	});

	it('collects FB2 highlights from markdown callouts with relative attachment paths', async () => {
		const bookPath =
			'附件/史蒂夫 · 乔布斯传 (修订版) = Steve Jobs A Biography ([美] 沃尔特 · 艾萨克森 (Walter Isaacson) 著 管延圻 etc.) (z-library.sk, 1lib.sk, z-lib.sk).fb2';
		const notePath = '笔记/乔布斯摘录.md';
		const linkMarkup =
			'[[../../附件/史蒂夫 · 乔布斯传 (修订版) = Steve Jobs A Biography ([美] 沃尔特 · 艾萨克森 (Walter Isaacson) 著 管延圻 etc.) (z-library.sk, 1lib.sk, z-lib.sk).fb2#weave-cfi=epubcfi(/6/22!/4/2/18,/1:0,/1:18)&text=1972%E5%B9%B4%E6%98%A5%E5%A4%A9%EF%BC%8C%E4%B9%94%E5%B8%83%E6%96%AF%E5%8D%B3%E5%B0%86%E9%AB%98%E4%B8%AD%E6%AF%95%E4%B8%9A%E6%97%B6&chapter=10|史蒂夫 · 乔布斯传]]';
		const noteContent = [
			`> [!EPUB|green] ${linkMarkup} [3 出离] 2026-05-26 20:46`,
			'> 1972年春天，乔布斯即将高中毕业时',
		].join('\n');
		const { app } = createMockApp({
			[notePath]: noteContent,
			[bookPath]: 'binary',
		});
		app.metadataCache.resolvedLinks = {
			[notePath]: {
				[`../../${bookPath}`]: 1,
			},
		};
		const service = new EpubBacklinkHighlightService(app);
		(service as any).storageService.ensureSourceIdentity = vi.fn(async () => ({
			sourceId: 'epubsrc-jobs',
		}));

		await expect(service.collectHighlights(bookPath)).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'epubcfi(/6/22!/4/2/18,/1:0,/1:18)',
				text: '1972年春天，乔布斯即将高中毕业时',
				chapterIndex: 10,
				sourceFile: notePath,
			}),
		]);
	});

	it('deletes MOBI markdown excerpts linked through relative attachment paths', async () => {
		const bookPath =
			'附件/史蒂夫•乔布斯传(Steve JobsA Biography) (沃尔特•艾萨克森 (Walter Isaacson)) (z-library.sk, 1lib.sk, z-lib.sk).mobi';
		const notePath = '笔记/乔布斯摘录.md';
		const linkMarkup =
			'[[../../附件/史蒂夫•乔布斯传(Steve JobsA Biography) (沃尔特•艾萨克森 (Walter Isaacson)) (z-library.sk, 1lib.sk, z-lib.sk).mobi#weave-cfi=epubcfi(/6/14!/4/12,/1:0,/1:11)&text=%E6%88%91%E8%AE%A4%E8%AF%86%E4%BB%96%E6%98%AF%E5%9C%A81984%E5%B9%B4&chapter=6|史蒂夫•乔布斯传]]';
		const noteContent = [
			`> [!EPUB|green] ${linkMarkup} [Introduction 前言] 2026-05-26 21:23`,
			'> 我认识他是在1984年',
			'',
			'Plain tail',
		].join('\n');
		const { app, files } = createMockApp({
			[notePath]: noteContent,
			[bookPath]: 'binary',
		});
		app.metadataCache.resolvedLinks = {
			[notePath]: {
				[`../../${bookPath}`]: 1,
			},
		};
		const service = new EpubBacklinkHighlightService(app);
		(service as any).storageService.ensureSourceIdentity = vi.fn(async () => ({
			sourceId: 'epubsrc-jobs-mobi',
		}));

		const deleted = await service.deleteHighlight(
			notePath,
			'epubcfi(/6/14!/4/12,/1:0,/1:11)',
			bookPath
		);

		expect(deleted).toBe(true);
		expect(files.get(notePath)).toBe('Plain tail');
	});

	it('deletes MOBI markdown excerpts when the live reader CFI drifts from the stored callout locator', async () => {
		const bookPath = '附件/demo.mobi';
		const notePath = '笔记/demo.md';
		const noteContent = [
			'> [!EPUB|green] [[../../附件/demo.mobi#weave-cfi=epubcfi(/6/14!/4/12,/1:0,/1:11)&text=hello&chapter=6|demo]]',
			'> 我认识他是在1984年',
			'',
			'Plain tail',
		].join('\n');
		const { app, files } = createMockApp({
			[notePath]: noteContent,
			[bookPath]: 'binary',
		});
		const service = new EpubBacklinkHighlightService(app);

		const deleted = await service.deleteHighlight(
			notePath,
			'epubcfi(/6/14!/4/12,/1:0,/1:12)',
			bookPath
		);

		expect(deleted).toBe(true);
		expect(files.get(notePath)).toBe('Plain tail');
	});

	it('returns stored cfiRange from findSourceForCfi when the live reader CFI drifts', async () => {
		const bookPath = '附件/demo.mobi';
		const notePath = '笔记/demo.md';
		const noteContent = [
			'> [!EPUB|green] [[../../附件/demo.mobi#weave-cfi=epubcfi(/6/14!/4/12,/1:0,/1:11)&text=hello&chapter=6|demo]]',
			'> 我认识他是在1984年',
		].join('\n');
		const { app } = createMockApp({
			[notePath]: noteContent,
			[bookPath]: 'binary',
		});
		const service = new EpubBacklinkHighlightService(app);

		await expect(
			service.findSourceForCfi('epubcfi(/6/14!/4/12,/1:0,/1:12)', bookPath, notePath, {
				text: '我认识他是在1984年',
			})
		).resolves.toEqual(
			expect.objectContaining({
				sourceFile: notePath,
				cfiRange: 'epubcfi(/6/14!/4/12,/1:0,/1:11)',
			})
		);
	});

	it('collects FB2 highlights from markdown callouts and wdeck we_source cards', async () => {
		const notePath = 'Notes/fb2-excerpts.md';
		const wdeckPath = 'weave/memory/deck-files/fb2-deck_01.wdeck';
		const noteContent = [
			'> [!EPUB|yellow] [[Books/novel.fb2#weave-cfi=epubcfi(/6/4!/4/2,/1:0,/1:8)&text=FB2%20quote&sid=epubsrc-fb2|novel]] [第一章]',
			'> FB2 quote',
		].join('\n');
		const wdeckContent = JSON.stringify({
			fileType: 'wdeck',
			logicalDeckId: 'deck-fb2',
			cards: [
				{
					uuid: 'card-fb2',
					modified: '2026-05-20T10:00:00.000Z',
					content: [
						'---',
						'we_source: "[[Books/novel.fb2#weave-cfi=readium%3Afb2-card&sid=epubsrc-fb2|novel]]"',
						'---',
						'Card FB2 quote',
					].join('\n'),
				},
			],
		});
		const { app } = createMockApp({
			[notePath]: noteContent,
			[wdeckPath]: wdeckContent,
			'Books/novel.fb2': 'binary',
		});
		app.metadataCache.resolvedLinks = {
			[notePath]: { 'Books/novel.fb2': 1 },
		};
		const service = new EpubBacklinkHighlightService(app);
		(service as any).storageService.ensureSourceIdentity = vi.fn(async () => ({
			sourceId: 'epubsrc-fb2',
		}));

		const highlights = await service.collectHighlights('Books/novel.fb2');
		expect(highlights).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:8)',
					text: 'FB2 quote',
					sourceFile: notePath,
				}),
				expect.objectContaining({
					cfiRange: 'readium:fb2-card',
					text: 'Card FB2 quote',
					sourceFile: wdeckPath,
					sourceRef: 'card:card-fb2',
				}),
			])
		);
	});

	it('collects wdeck highlights from YAML we_source cards when no EPUB callout block exists', async () => {
		const wdeckPath = 'weave/memory/deck-files/示例牌组_01.wdeck';
		const wdeckContent = JSON.stringify({
			fileType: 'wdeck',
			logicalDeckId: 'deck-demo',
			logicalDeckName: '示例牌组',
			segmentIndex: 1,
			cards: [
				{
					uuid: 'card-yaml',
					modified: '2026-04-27T13:32:00.000Z',
					content: [
						'---',
						'we_source: "[[Books/demo.epub#weave-cfi=readium%3Ayaml-only&sid=epubsrc-demo|Demo]]"',
						'---',
						'YAML quote text',
						'---div---',
						'YAML comment text',
					].join('\n'),
				},
			],
		});
		const { app } = createMockApp({
			[wdeckPath]: wdeckContent,
		});
		app.plugins.getPlugin = vi.fn(() => ({
			settings: { weaveParentFolder: '' },
		}));
		const service = new EpubBacklinkHighlightService(app);
		(service as any).storageService.ensureSourceIdentity = vi.fn(async () => ({ sourceId: 'epubsrc-demo' }));

		await expect(service.collectHighlights('Books/demo.epub')).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'readium:yaml-only',
				color: 'yellow',
				text: 'YAML quote text',
				commentText: 'YAML comment text',
				hasCommentDivider: true,
				sourceFile: wdeckPath,
				sourceRef: 'card:card-yaml',
				createdTime: new Date('2026-04-27T13:32:00.000Z').getTime(),
			}),
		]);
	});

	it('collects wdeck highlights from arbitrary wdeck file paths outside the default deck-files directory', async () => {
		const wdeckPath = 'vault/study/renamed-deck_03.wdeck';
		const wdeckContent = JSON.stringify({
			fileType: 'wdeck',
			logicalDeckId: 'deck-moved',
			logicalDeckName: '移动牌组',
			segmentIndex: 3,
			cards: [
				{
					uuid: 'card-moved',
					modified: '2026-05-12T00:16:00.000Z',
					content: [
						'---',
						'we_source: "[[Books/demo.epub#weave-cfi=readium%3Amoved-highlight&sid=epubsrc-demo|Demo]]"',
						'---',
						'Moved WDeck quote',
					].join('\n'),
				},
			],
		});
		const { app } = createMockApp({
			[wdeckPath]: wdeckContent,
		});
		const service = new EpubBacklinkHighlightService(app);
		(service as any).storageService.ensureSourceIdentity = vi.fn(async () => ({ sourceId: 'epubsrc-demo' }));

		await expect(service.collectHighlights('Books/demo.epub')).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'readium:moved-highlight',
				color: 'yellow',
				text: 'Moved WDeck quote',
				sourceFile: wdeckPath,
				sourceRef: 'card:card-moved',
				createdTime: new Date('2026-05-12T00:16:00.000Z').getTime(),
				hasCommentDivider: false,
			}),
		]);
	});

	it('collects wdeck highlights from nested card arrays when content is authoritative', async () => {
		const wdeckPath = 'weave/memory/deck-files/嵌套牌组_01.wdeck';
		const wdeckContent = JSON.stringify({
			fileType: 'wdeck',
			logicalDeckId: 'deck-nested',
			logicalDeckName: '嵌套牌组',
			segmentIndex: 1,
			payload: {
				segments: [
					{
						cards: [
							{
								uuid: 'card-nested',
								modified: '2026-05-11T23:59:50.598Z',
								content: [
									'---',
									'we_source: "[[(米歇尔·德·蒙田) (Z-Library) 1.epub#weave-cfi=epubcfi(/6/42!/4/6,/1:0,/1:108)&sid=epubsrc-montaigne|蒙田随笔全集]]"',
									'---',
									'而我常常会忘记这个忒那个无谓的规矩，我在家里取消了所有的虚礼。',
									'---div---',
									'',
								].join('\n'),
							},
						],
					},
				],
			},
		});
		const { app } = createMockApp({
			[wdeckPath]: wdeckContent,
		});
		const service = new EpubBacklinkHighlightService(app);
		(service as any).storageService.ensureSourceIdentity = vi.fn(async () => ({ sourceId: 'epubsrc-montaigne' }));

		await expect(service.collectHighlights('(米歇尔·德·蒙田) (Z-Library) 1.epub')).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'epubcfi(/6/42!/4/6,/1:0,/1:108)',
				color: 'yellow',
				text: '而我常常会忘记这个忒那个无谓的规矩，我在家里取消了所有的虚礼。',
				hasCommentDivider: false,
				sourceFile: wdeckPath,
				sourceRef: 'card:card-nested',
				createdTime: new Date('2026-05-11T23:59:50.598Z').getTime(),
			}),
		]);
	});

	it('collects wdeck highlights from card maps keyed by uuid after sync reshapes the json container', async () => {
		const wdeckPath = 'weave/memory/deck-files/映射牌组_01.wdeck';
		const wdeckContent = JSON.stringify({
			fileType: 'wdeck',
			logicalDeckId: 'deck-map',
			logicalDeckName: '映射牌组',
			segmentIndex: 1,
			payload: {
				cardMap: {
					'card-map-a': {
						uuid: 'card-map-a',
						modified: '2026-05-12T08:00:00.000Z',
						content: [
							'---',
							'we_source: "[[Books/demo.epub#weave-cfi=readium%3Amap-highlight&sid=epubsrc-demo|Demo]]"',
							'---',
							'Mapped WDeck quote',
						].join('\n'),
					},
				},
			},
		});
		const { app } = createMockApp({
			[wdeckPath]: wdeckContent,
		});
		const service = new EpubBacklinkHighlightService(app);
		(service as any).storageService.ensureSourceIdentity = vi.fn(async () => ({ sourceId: 'epubsrc-demo' }));

		await expect(service.collectHighlights('Books/demo.epub')).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'readium:map-highlight',
				color: 'yellow',
				text: 'Mapped WDeck quote',
				sourceFile: wdeckPath,
				sourceRef: 'card:card-map-a',
				createdTime: new Date('2026-05-12T08:00:00.000Z').getTime(),
				hasCommentDivider: false,
			}),
		]);
	});

	it('updates only the targeted mapped wdeck card entry when the card is stored outside an array', async () => {
		const wdeckPath = 'weave/memory/deck-files/映射牌组_01.wdeck';
		const wdeckContent = JSON.stringify({
			fileType: 'wdeck',
			logicalDeckId: 'deck-map',
			logicalDeckName: '映射牌组',
			payload: {
				cardMap: {
					'card-map-a': {
						uuid: 'card-map-a',
						content: '> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Amap-edit|Demo]]\n> Keep me\n',
					},
					'card-map-b': {
						uuid: 'card-map-b',
						content: '> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Amap-edit|Demo]]\n> Change me\n',
					},
				},
			},
		});
		const { app, files } = createMockApp({
			[wdeckPath]: wdeckContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const changed = await service.changeHighlightColor(
			wdeckPath,
			'readium:map-edit',
			'Books/demo.epub',
			'purple',
			'card:card-map-b'
		);

		expect(changed).toBe(true);
		const parsed = JSON.parse(files.get(wdeckPath) || '{}');
		expect(parsed.payload.cardMap['card-map-a'].content).toContain('[!EPUB|green]');
		expect(parsed.payload.cardMap['card-map-b'].content).toContain('[!EPUB|purple]');
	});

	it('rebuildHighlightIndexes clears cached highlights and source index on disk', async () => {
		const cachePath =
			'.obsidian/plugins/weave/cache/incremental-reading/epub-backlink-highlights-cache.json';
		const cacheContent = JSON.stringify({
			version: '1.3.0',
			lastUpdated: '2026-01-01T00:00:00.000Z',
			entries: {
				'Books/demo.epub::': {
					manifest: { markdownSources: [], canvasSources: [], cardDataSources: [] },
					highlights: [
						{
							cfiRange: 'epubcfi(/6/2)',
							color: 'yellow',
							text: 'cached',
							sourceFile: 'Notes/a.md',
						},
					],
				},
			},
			sourceIndex: {
				version: '1.3.0',
				updatedAt: '2026-01-01T00:00:00.000Z',
				files: [{ path: 'Notes/a.md', kind: 'markdown', mtime: 1, size: 2, targets: [] }],
			},
		});
		const { app, files } = createMockApp({
			[cachePath]: cacheContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		await service.rebuildHighlightIndexes();

		const next = JSON.parse(files.get(cachePath) || '{}');
		expect(next.entries).toEqual({});
		expect(next.sourceIndex).toBeUndefined();
	});

	it('rebuilds stale disk source index caches so wdeck highlights are collected after upgrade', async () => {
		const wdeckPath = 'weave/memory/deck-files/示例牌组_01.wdeck';
		const staleCachePath = '.obsidian/plugins/weave/.cache/incremental-reading/epub-backlink-highlights-cache.json';
		const wdeckContent = JSON.stringify({
			fileType: 'wdeck',
			logicalDeckId: 'deck-demo',
			logicalDeckName: '示例牌组',
			segmentIndex: 1,
			cards: [
				{
					uuid: 'card-a',
					content: '> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Awdeck-cached|Demo]]\n> WDeck quote\n',
				},
			],
		});
		const staleCache = JSON.stringify({
			version: '1.0.0',
			lastUpdated: '2026-03-01T00:00:00.000Z',
			entries: {},
			sourceIndex: {
				version: '1.0.0',
				updatedAt: '2026-03-01T00:00:00.000Z',
				files: [],
			},
		});
		const { app } = createMockApp({
			[wdeckPath]: wdeckContent,
			[staleCachePath]: staleCache,
		});
		const service = new EpubBacklinkHighlightService(app);

		await expect(service.collectHighlights('Books/demo.epub')).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'readium:wdeck-cached',
				color: 'green',
				text: 'WDeck quote',
				sourceFile: wdeckPath,
				sourceRef: 'card:card-a',
			}),
		]);
	});

	it('detects externally synced wdeck files even when no vault modify event is emitted', async () => {
		const wdeckPath = 'weave/memory/deck-files/synced-mobile_01.wdeck';
		const { app, files } = createMockApp({
			'Notes/existing.md': '# Existing note',
		});
		const service = new EpubBacklinkHighlightService(app);
		(service as any).storageService.ensureSourceIdentity = vi.fn(async () => ({ sourceId: 'epubsrc-demo' }));

		await expect(service.collectHighlights('Books/demo.epub')).resolves.toEqual([]);

		files.set(
			wdeckPath,
			JSON.stringify({
				fileType: 'wdeck',
				logicalDeckId: 'deck-synced',
				logicalDeckName: '同步牌组',
				segmentIndex: 1,
				cards: [
					{
						uuid: 'card-synced',
						modified: '2026-05-17T09:18:00.000Z',
						content: [
							'---',
							'we_source: "[[Books/demo.epub#weave-cfi=readium%3Asynced-card&sid=epubsrc-demo|Demo]]"',
							'---',
							'Synced from external mobile card',
						].join('\n'),
					},
				],
			})
		);

		await expect(service.collectHighlights('Books/demo.epub')).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'readium:synced-card',
				color: 'yellow',
				text: 'Synced from external mobile card',
				sourceFile: wdeckPath,
				sourceRef: 'card:card-synced',
				createdTime: new Date('2026-05-17T09:18:00.000Z').getTime(),
			}),
		]);
	});

	it('collects wdeck highlights when stored sid drifts but the epub path is still the same', async () => {
		const wdeckPath = 'weave/memory/deck-files/sid-drift_01.wdeck';
		const { app } = createMockApp({
			[wdeckPath]: JSON.stringify({
				fileType: 'wdeck',
				logicalDeckId: 'deck-sid-drift',
				logicalDeckName: 'SID 漂移牌组',
				segmentIndex: 1,
				cards: [
					{
						uuid: 'card-sid-drift',
						modified: '2026-05-17T10:00:00.000Z',
						content: [
							'---',
							'we_source: "[[Books/demo.epub#weave-cfi=readium%3Asid-drift&sid=epubsrc-stale|Demo]]"',
							'---',
							'Same path despite sid drift',
						].join('\n'),
					},
				],
			}),
		});
		const service = new EpubBacklinkHighlightService(app);
		(service as any).storageService.ensureSourceIdentity = vi.fn(async () => ({ sourceId: 'epubsrc-current' }));

		await expect(service.collectHighlights('Books/demo.epub')).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'readium:sid-drift',
				text: 'Same path despite sid drift',
				sourceFile: wdeckPath,
				sourceRef: 'card:card-sid-drift',
			}),
		]);
	});

	it('recovers malformed wdeck files from safe json backup when collecting epub highlights', async () => {
		const wdeckPath = 'weave/memory/deck-files/recoverable_01.wdeck';
		const backupPath = `.obsidian/plugins/${CURRENT_PLUGIN_ID}/backups/json-recovery/weave__memory__deck-files__recoverable_01.wdeck`;
		const { app } = createMockApp({
			[wdeckPath]: '{"broken": ',
			[backupPath]: JSON.stringify({
				fileType: 'wdeck',
				logicalDeckId: 'deck-recovered',
				logicalDeckName: '恢复牌组',
				segmentIndex: 1,
				cards: [
					{
						uuid: 'card-recovered',
						modified: '2026-05-17T10:20:00.000Z',
						content: [
							'---',
							'we_source: "[[Books/demo.epub#weave-cfi=readium%3Arecovered-from-backup&sid=epubsrc-demo|Demo]]"',
							'---',
							'Recovered WDeck quote',
						].join('\n'),
					},
				],
			}),
		});
		const service = new EpubBacklinkHighlightService(app);
		(service as any).storageService.ensureSourceIdentity = vi.fn(async () => ({ sourceId: 'epubsrc-demo' }));

		await expect(service.collectHighlights('Books/demo.epub')).resolves.toEqual([
			expect.objectContaining({
				cfiRange: 'readium:recovered-from-backup',
				text: 'Recovered WDeck quote',
				sourceFile: wdeckPath,
				sourceRef: 'card:card-recovered',
			}),
		]);
		expect(app.vault.adapter.write).toHaveBeenCalledWith(
			wdeckPath,
			expect.stringContaining('Recovered WDeck quote')
		);
	});

	it('updates markdown highlight colors through an already-open note editor', async () => {
		const notePath = 'Notes/demo.md';
		const noteContent = [
			'> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]',
			'> Current quote',
			'',
		].join('\n');
		const { app, files, openMarkdownViews } = createMockApp(
			{ [notePath]: noteContent },
			{ openMarkdownPaths: [notePath] },
		);
		const service = new EpubBacklinkHighlightService(app);

		const changed = await service.changeHighlightColor(notePath, 'readium:alpha', 'Books/demo.epub', 'purple');

		expect(changed).toBe(true);
		expect(files.get(notePath)).toContain('> [!EPUB|purple] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]');
		expect(openMarkdownViews[0]?.save).toHaveBeenCalledTimes(1);
		expect(app.vault.modify).not.toHaveBeenCalled();
		expect(app.vault.process).not.toHaveBeenCalled();
	});

	it('updates markdown highlight styles and can clear style metadata back to normal highlight', async () => {
		const notePath = 'Notes/demo-style.md';
		const noteContent = [
			'> [!EPUB|green+underline] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]',
			'> Current quote',
			'',
		].join('\n');
		const { app, files } = createMockApp({
			[notePath]: noteContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const changedToWavy = await service.changeHighlightStyle(
			notePath,
			'readium:alpha',
			'Books/demo.epub',
			'wavy'
		);

		expect(changedToWavy).toBe(true);
		expect(files.get(notePath)).toContain('> [!EPUB|green+wavy] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]');

		const cleared = await service.changeHighlightStyle(
			notePath,
			'readium:alpha',
			'Books/demo.epub',
			undefined
		);

		expect(cleared).toBe(true);
		expect(files.get(notePath)).toContain('> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]');
	});

	it('rewrites markdown quote text when highlight style switches to and from strikethrough', async () => {
		const notePath = 'Notes/demo-strikethrough-style.md';
		const noteContent = [
			'> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]',
			'> Current quote',
			'',
		].join('\n');
		const { app, files } = createMockApp({
			[notePath]: noteContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const changedToStrikethrough = await service.changeHighlightStyle(
			notePath,
			'readium:alpha',
			'Books/demo.epub',
			'strikethrough'
		);

		expect(changedToStrikethrough).toBe(true);
		expect(files.get(notePath)).toContain('> [!EPUB|green+strikethrough] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]');
		expect(files.get(notePath)).toContain('> ~~Current quote~~');

		const changedBackToNormal = await service.changeHighlightStyle(
			notePath,
			'readium:alpha',
			'Books/demo.epub',
			undefined
		);

		expect(changedBackToNormal).toBe(true);
		expect(files.get(notePath)).toContain('> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]');
		expect(files.get(notePath)).toContain('> Current quote');
		expect(files.get(notePath)).not.toContain('~~Current quote~~');
	});

	it('preserves the current note body text when changing styles instead of restoring source excerpt text', async () => {
		const notePath = 'Notes/demo-preserve-body.md';
		const noteContent = [
			'> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Aedited|Demo]]',
			'> 我自己改写过的摘录正文',
			'',
		].join('\n');
		const { app, files } = createMockApp({
			[notePath]: noteContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const changedToUnderline = await service.changeHighlightStyle(
			notePath,
			'readium:edited',
			'Books/demo.epub',
			'underline'
		);

		expect(changedToUnderline).toBe(true);
		expect(files.get(notePath)).toContain('> [!EPUB|blue+underline] [[Books/demo.epub#weave-cfi=readium%3Aedited|Demo]]');
		expect(files.get(notePath)).toContain('> 我自己改写过的摘录正文');

		const changedToStrikethrough = await service.changeHighlightStyle(
			notePath,
			'readium:edited',
			'Books/demo.epub',
			'strikethrough'
		);

		expect(changedToStrikethrough).toBe(true);
		expect(files.get(notePath)).toContain('> [!EPUB|blue+strikethrough] [[Books/demo.epub#weave-cfi=readium%3Aedited|Demo]]');
		expect(files.get(notePath)).toContain('> ~~我自己改写过的摘录正文~~');
		expect(files.get(notePath)).not.toContain('Current quote');
	});

	it('parses divider comments and preserves the comment block when changing markdown styles', async () => {
		const notePath = 'Notes/demo-comment-style.md';
		const noteContent = [
			'> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Acommented|Demo]]',
			'> 我自己改写过的摘录正文',
			'> ---div---',
			'> 这是想法正文',
			'',
		].join('\n');
		const { app, files } = createMockApp({
			[notePath]: noteContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		await expect(service.collectHighlights('Books/demo.epub')).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					cfiRange: 'readium:commented',
					text: '我自己改写过的摘录正文',
					commentText: '这是想法正文',
					hasCommentDivider: true,
				}),
			])
		);

		const changed = await service.changeHighlightStyle(
			notePath,
			'readium:commented',
			'Books/demo.epub',
			'underline'
		);

		expect(changed).toBe(true);
		expect(files.get(notePath)).toContain('> [!EPUB|blue+underline] [[Books/demo.epub#weave-cfi=readium%3Acommented|Demo]]');
		expect(files.get(notePath)).toContain('> 我自己改写过的摘录正文');
		expect(files.get(notePath)).toContain('> ---div---');
		expect(files.get(notePath)).toContain('> 这是想法正文');
	});

	it('writes divider comments back to markdown excerpts', async () => {
		const notePath = 'Notes/demo-comment-update.md';
		const noteContent = [
			'> [!EPUB|yellow] [[Books/demo.epub#weave-cfi=readium%3Acomment-edit|Demo]]',
			'> 原摘录正文',
			'',
		].join('\n');
		const { app, files } = createMockApp({
			[notePath]: noteContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const changed = await service.updateHighlightComment(
			notePath,
			'readium:comment-edit',
			'Books/demo.epub',
			'第一行想法\n第二行想法'
		);

		expect(changed).toBe(true);
		expect(files.get(notePath)).toContain('> 原摘录正文');
		expect(files.get(notePath)).toContain('> ---div---');
		expect(files.get(notePath)).toContain('> 第一行想法');
		expect(files.get(notePath)).toContain('> 第二行想法');
	});

	it('writes divider comments back when the live reader CFI drifts from the stored callout locator', async () => {
		const bookPath = '附件/demo.mobi';
		const notePath = '笔记/demo-comment-drift.md';
		const noteContent = [
			'> [!EPUB|green] [[../../附件/demo.mobi#weave-cfi=epubcfi(/6/14!/4/12,/1:0,/1:11)&text=hello&chapter=6|demo]]',
			'> 我认识他是在1984年',
			'',
		].join('\n');
		const { app, files } = createMockApp({
			[notePath]: noteContent,
			[bookPath]: 'binary',
		});
		const service = new EpubBacklinkHighlightService(app);

		const changed = await service.updateHighlightComment(
			notePath,
			'epubcfi(/6/14!/4/12,/1:0,/1:12)',
			bookPath,
			'漂移后的想法'
		);

		expect(changed).toBe(true);
		expect(files.get(notePath)).toContain('> 我认识他是在1984年');
		expect(files.get(notePath)).toContain('> ---div---');
		expect(files.get(notePath)).toContain('> 漂移后的想法');
	});

	it('updates only the targeted canvas node highlight color when sourceRef is provided', async () => {
		const canvasPath = 'Canvas/demo.canvas';
		const canvasContent = JSON.stringify({
			nodes: [
				{
					id: 'node-1',
					type: 'text',
					text: '> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]\n> Quote A\n',
				},
				{
					id: 'node-2',
					type: 'text',
					text: '> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Abeta|Demo]]\n> Quote B\n',
				},
			],
		});
		const { app, files } = createMockApp({
			[canvasPath]: canvasContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const changed = await service.changeHighlightColor(canvasPath, 'readium:beta', 'Books/demo.epub', 'red', 'canvas:node-2');

		expect(changed).toBe(true);
		const parsed = JSON.parse(files.get(canvasPath) || '{}');
		expect(parsed.nodes[0].text).toContain('> [!EPUB|green]');
		expect(parsed.nodes[1].text).toContain('> [!EPUB|red]');
	});

	it('writes divider comments back only to the targeted canvas node', async () => {
		const canvasPath = 'Canvas/demo-comment.canvas';
		const canvasContent = JSON.stringify({
			nodes: [
				{
					id: 'node-1',
					type: 'text',
					text: '> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]\n> Quote A\n',
				},
				{
					id: 'node-2',
					type: 'text',
					text: '> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Abeta|Demo]]\n> Quote B\n',
				},
			],
		});
		const { app, files } = createMockApp({
			[canvasPath]: canvasContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const changed = await service.updateHighlightComment(
			canvasPath,
			'readium:beta',
			'Books/demo.epub',
			'Canvas comment',
			'canvas:node-2'
		);

		expect(changed).toBe(true);
		const parsed = JSON.parse(files.get(canvasPath) || '{}');
		expect(parsed.nodes[0].text).not.toContain('---div---');
		expect(parsed.nodes[1].text).toContain('> ---div---');
		expect(parsed.nodes[1].text).toContain('> Canvas comment');
	});

	it('notifies workspace and data sync after deleting a canvas-backed excerpt', async () => {
		const canvasPath = 'Canvas/delete-notify.canvas';
		const notifyChange = vi.fn(async () => undefined);
		const clearDeckAggregationCache = vi.fn();
		const clearAnalyticsCache = vi.fn();
		const runtimePlugin = {
			settings: { weaveParentFolder: '' },
			dataSyncService: { notifyChange },
			deckAggregationService: { clearCache: clearDeckAggregationCache },
			analyticsService: { clearCache: clearAnalyticsCache },
		};
		const { app } = createMockApp(
			{
				[canvasPath]: JSON.stringify({
					nodes: [
						{
							id: 'node-1',
							type: 'text',
							text: '> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Acanvas-delete|Demo]]\n> Canvas quote\n',
						},
					],
				}),
			},
			{ runtimePlugin }
		);
		const service = new EpubBacklinkHighlightService(app);

		const deleted = await service.deleteHighlight(
			canvasPath,
			'readium:canvas-delete',
			'Books/demo.epub',
			'canvas:node-1'
		);

		expect(deleted).toBe(true);
		expect(clearDeckAggregationCache).toHaveBeenCalled();
		expect(clearAnalyticsCache).toHaveBeenCalled();
		expect(app.workspace.trigger).toHaveBeenCalledWith(
			'Weave:card-updated',
			expect.objectContaining({
				type: 'cards',
				action: 'update',
				ids: [],
				sourcePath: canvasPath,
			})
		);
		expect(app.workspace.trigger).toHaveBeenCalledWith('Weave:data-changed');
		expect(notifyChange).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'cards',
				action: 'update',
				ids: [],
				sourcePath: canvasPath,
			})
		);
	});

	it('updates only the targeted card shard entry highlight color when sourceRef is provided', async () => {
		const jsonPath = 'weave/memory/cards/cards-0.json';
		const jsonContent = JSON.stringify({
			cards: [
				{
					uuid: 'card-a',
					content: '> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]\n> Quote A\n',
				},
				{
					uuid: 'card-b',
					content: '> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Abeta|Demo]]\n> Quote B\n',
				},
			],
		});
		const { app, files } = createMockApp({
			[jsonPath]: jsonContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const changed = await service.changeHighlightColor(jsonPath, 'readium:beta', 'Books/demo.epub', 'red', 'card:card-b');

		expect(changed).toBe(true);
		const parsed = JSON.parse(files.get(jsonPath) || '{}');
		expect(parsed.cards[0].content).toContain('> [!EPUB|green]');
		expect(parsed.cards[1].content).toContain('> [!EPUB|red]');
		expect(typeof parsed.cards[1].modified).toBe('string');
	});

	it('writes divider comments back only to the targeted card shard entry', async () => {
		const jsonPath = 'weave/memory/cards/cards-comment.json';
		const jsonContent = JSON.stringify({
			cards: [
				{
					uuid: 'card-a',
					content: '> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]\n> Quote A\n',
				},
				{
					uuid: 'card-b',
					content: '> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Abeta|Demo]]\n> Quote B\n',
				},
			],
		});
		const { app, files } = createMockApp({
			[jsonPath]: jsonContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const changed = await service.updateHighlightComment(
			jsonPath,
			'readium:beta',
			'Books/demo.epub',
			'Card comment',
			'card:card-b'
		);

		expect(changed).toBe(true);
		const parsed = JSON.parse(files.get(jsonPath) || '{}');
		expect(parsed.cards[0].content).not.toContain('---div---');
		expect(parsed.cards[1].content).toContain('> ---div---');
		expect(parsed.cards[1].content).toContain('> Card comment');
		expect(typeof parsed.cards[1].modified).toBe('string');
	});

	it('resolves wdeck card source with card reference when locating by cfi', async () => {
		const wdeckPath = 'weave/memory/deck-files/示例牌组_01.wdeck';
		const wdeckContent = JSON.stringify({
			fileType: 'wdeck',
			logicalDeckId: 'deck-demo',
			logicalDeckName: '示例牌组',
			segmentIndex: 1,
			cards: [
				{
					uuid: 'card-a',
					content: '> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]\n> Quote A\n',
				},
				{
					uuid: 'card-b',
					content: '> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Abeta|Demo]]\n> Quote B\n',
				},
			],
		});
		const { app } = createMockApp({
			[wdeckPath]: wdeckContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const match = await service.findSourceForCfi('readium:beta', 'Books/demo.epub');

		expect(match).toEqual({
			sourceFile: wdeckPath,
			sourceRef: 'card:card-b',
			cfiRange: 'readium:beta',
		});
	});

	it('updates only the targeted wdeck card entry highlight color when sourceRef is provided', async () => {
		const wdeckPath = 'weave/memory/deck-files/示例牌组_01.wdeck';
		const wdeckContent = JSON.stringify({
			fileType: 'wdeck',
			logicalDeckId: 'deck-demo',
			logicalDeckName: '示例牌组',
			segmentIndex: 1,
			cards: [
				{
					uuid: 'card-a',
					content: '> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]\n> Quote A\n',
				},
				{
					uuid: 'card-b',
					content: '> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Abeta|Demo]]\n> Quote B\n',
				},
			],
		});
		const { app, files } = createMockApp({
			[wdeckPath]: wdeckContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const changed = await service.changeHighlightColor(wdeckPath, 'readium:beta', 'Books/demo.epub', 'purple', 'card:card-b');

		expect(changed).toBe(true);
		const parsed = JSON.parse(files.get(wdeckPath) || '{}');
		expect(parsed.cards[0].content).toContain('> [!EPUB|green]');
		expect(parsed.cards[1].content).toContain('> [!EPUB|purple]');
		expect(typeof parsed.cards[1].modified).toBe('string');
	});

	it('deletes the whole json card when the card only contains the EPUB excerpt', async () => {
		const jsonPath = 'weave/memory/cards/cards-delete.json';
		const jsonContent = JSON.stringify({
			cards: [
				{
					uuid: 'card-a',
					content: '> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]\n> Quote A\n',
				},
				{
					uuid: 'card-b',
					content: '> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Abeta|Demo]]\n> Quote B\n',
				},
			],
		});
		const { app, files } = createMockApp({
			[jsonPath]: jsonContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const deleted = await service.deleteHighlight(
			jsonPath,
			'readium:beta',
			'Books/demo.epub',
			'card:card-b'
		);

		expect(deleted).toBe(true);
		const parsed = JSON.parse(files.get(jsonPath) || '{}');
		expect(parsed.cards).toHaveLength(1);
		expect(parsed.cards[0].uuid).toBe('card-a');
	});

	it('notifies host caches and card deletion events after deleting a structured card-data entry', async () => {
		const jsonPath = 'weave/memory/cards/cards-delete-notify.json';
		const notifyChange = vi.fn(async () => undefined);
		const invalidate = vi.fn();
		const removeCardIndex = vi.fn();
		const clearDeckAggregationCache = vi.fn();
		const clearAnalyticsCache = vi.fn();
		const rebuildCache = vi.fn(async () => undefined);
		const runtimePlugin = {
			settings: { weaveParentFolder: '' },
			cardMetadataCache: { invalidate },
			cardIndexService: { removeCardIndex },
			deckAggregationService: { clearCache: clearDeckAggregationCache },
			analyticsService: { clearCache: clearAnalyticsCache },
			wdeckService: { rebuildCache },
			dataSyncService: { notifyChange },
			app: {
				workspace: {
					trigger: vi.fn(),
				},
			},
		};
		const { app } = createMockApp(
			{
				[jsonPath]: JSON.stringify({
					cards: [
						{
							uuid: 'card-a',
							content: '> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]\n> Quote A\n',
						},
						{
							uuid: 'card-b',
							content: '> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Abeta|Demo]]\n> Quote B\n',
						},
					],
				}),
			},
			{ runtimePlugin }
		);
		const service = new EpubBacklinkHighlightService(app);

		const deleted = await service.deleteHighlight(
			jsonPath,
			'readium:beta',
			'Books/demo.epub',
			'card:card-b'
		);

		expect(deleted).toBe(true);
		expect(invalidate).toHaveBeenCalledWith('card-b');
		expect(removeCardIndex).toHaveBeenCalledWith('card-b');
		expect(clearDeckAggregationCache).toHaveBeenCalled();
		expect(clearAnalyticsCache).toHaveBeenCalled();
		expect(rebuildCache).not.toHaveBeenCalled();
		expect(app.workspace.trigger).toHaveBeenCalledWith('Weave:card-deleted', 'card-b');
		expect(app.workspace.trigger).toHaveBeenCalledWith(
			'Weave:card-updated',
			expect.objectContaining({
				type: 'cards',
				action: 'delete',
				ids: ['card-b'],
				sourcePath: jsonPath,
			})
		);
		expect(notifyChange).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'cards',
				action: 'delete',
				ids: ['card-b'],
				sourcePath: jsonPath,
			})
		);
	});

	it('inspects card-data deletion and preserves extra content when deleting excerpt only', async () => {
		const wdeckPath = 'weave/memory/deck-files/delete-choice_01.wdeck';
		const notifyChange = vi.fn(async () => undefined);
		const invalidate = vi.fn();
		const rebuildCache = vi.fn(async () => undefined);
		const runtimePlugin = {
			settings: { weaveParentFolder: '' },
			cardMetadataCache: { invalidate },
			wdeckService: { rebuildCache },
			dataSyncService: { notifyChange },
		};
		const wdeckContent = JSON.stringify({
			fileType: 'wdeck',
			logicalDeckId: 'deck-delete-choice',
			logicalDeckName: '删除策略牌组',
			segmentIndex: 1,
			cards: [
				{
					uuid: 'card-extra',
					content: [
						'> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aextra|Demo]]',
						'> Quote with extra notes',
						'',
						'我后来补充的延伸笔记',
					].join('\n'),
				},
			],
		});
		const { app, files } = createMockApp(
			{
				[wdeckPath]: wdeckContent,
			},
			{ runtimePlugin }
		);
		const service = new EpubBacklinkHighlightService(app);

		const analysis = await service.inspectCardDataHighlightDeletion(
			wdeckPath,
			'readium:extra',
			'Books/demo.epub',
			'card:card-extra'
		);
		expect(analysis).toEqual(
			expect.objectContaining({
				matched: true,
				hasAdditionalContent: true,
				recommendedMode: 'excerpt-only',
				additionalContentPreview: expect.stringContaining('我后来补充的延伸笔记'),
			})
		);

		const deleted = await service.deleteHighlight(
			wdeckPath,
			'readium:extra',
			'Books/demo.epub',
			'card:card-extra',
			undefined,
			'excerpt-only'
		);

		expect(deleted).toBe(true);
		const parsed = JSON.parse(files.get(wdeckPath) || '{}');
		expect(parsed.cards).toHaveLength(1);
		expect(parsed.cards[0].content).toBe('我后来补充的延伸笔记');
		expect(invalidate).toHaveBeenCalledWith('card-extra');
		expect(rebuildCache).toHaveBeenCalledTimes(1);
		expect(app.workspace.trigger).toHaveBeenCalledWith(
			'Weave:card-updated',
			expect.objectContaining({
				type: 'cards',
				action: 'update',
				ids: ['card-extra'],
				sourcePath: wdeckPath,
			})
		);
		expect(notifyChange).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'cards',
				action: 'update',
				ids: ['card-extra'],
				sourcePath: wdeckPath,
			})
		);
	});

	it('official excerpt api deletes a pure wdeck excerpt through weave dataStorage.deleteCard', async () => {
		const wdeckPath = 'weave/memory/deck-files/official-delete_01.wdeck';
		const deleteCard = vi.fn(async () => ({ success: true }));
		const saveCard = vi.fn(async (_card: any) => ({ success: true }));
		const getCardByUUID = vi.fn(async () => null);
		const runtimePlugin = {
			settings: { weaveParentFolder: '' },
			dataStorage: {
				deleteCard,
				saveCard,
				getCardByUUID,
			},
		};
		const { app, files } = createMockApp(
			{
				[wdeckPath]: JSON.stringify({
					fileType: 'wdeck',
					logicalDeckId: 'deck-official-delete',
					logicalDeckName: '官方删除牌组',
					segmentIndex: 1,
					cards: [
						{
							uuid: 'card-official-delete',
							content: '> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aofficial-delete|Demo]]\n> Quote only\n',
						},
					],
				}),
			},
			{ runtimePlugin }
		);
		const api = new EpubExcerptOfficialApiService(app);

		const result = await api.removeExcerpt({
			sourceType: 'epub',
			epubFilePath: 'Books/demo.epub',
			cfiRange: 'readium:official-delete',
			cardId: 'card-official-delete',
			sourceFile: wdeckPath,
			sourceRef: 'card:card-official-delete',
			mode: 'auto',
		});

		expect(result).toEqual(
			expect.objectContaining({
				success: true,
				action: 'card-deleted',
				affectedCardIds: ['card-official-delete'],
			})
		);
		expect(deleteCard).toHaveBeenCalledWith('card-official-delete');
		expect(saveCard).not.toHaveBeenCalled();
		expect(files.get(wdeckPath)).toContain('card-official-delete');
	});

	it('official excerpt api updates a wdeck card through weave dataStorage.saveCard when extra content must be preserved', async () => {
		const wdeckPath = 'weave/memory/deck-files/official-update_01.wdeck';
		const existingCard = {
			uuid: 'card-official-update',
			deckId: 'wdeck:deck-official-update',
			content: [
				'> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aofficial-update|Demo]]',
				'> Quote with extra notes',
				'',
				'我后来补充的延伸笔记',
			].join('\n'),
		};
		const deleteCard = vi.fn(async () => ({ success: true }));
		const saveCard = vi.fn(async (_card: any) => ({ success: true }));
		const getCardByUUID = vi.fn(async () => existingCard);
		const runtimePlugin = {
			settings: { weaveParentFolder: '' },
			dataStorage: {
				deleteCard,
				saveCard,
				getCardByUUID,
			},
		};
		const { app, files } = createMockApp(
			{
				[wdeckPath]: JSON.stringify({
					fileType: 'wdeck',
					logicalDeckId: 'deck-official-update',
					logicalDeckName: '官方更新牌组',
					segmentIndex: 1,
					cards: [existingCard],
				}),
			},
			{ runtimePlugin }
		);
		const api = new EpubExcerptOfficialApiService(app);

		const result = await api.removeExcerpt({
			sourceType: 'epub',
			epubFilePath: 'Books/demo.epub',
			cfiRange: 'readium:official-update',
			cardId: 'card-official-update',
			sourceFile: wdeckPath,
			sourceRef: 'card:card-official-update',
			mode: 'excerpt-only',
		});

		expect(result).toEqual(
			expect.objectContaining({
				success: true,
				action: 'excerpt-removed',
				affectedCardIds: ['card-official-update'],
			})
		);
		expect(getCardByUUID).toHaveBeenCalledWith('card-official-update');
		expect(saveCard).toHaveBeenCalledWith(
			expect.objectContaining({
				uuid: 'card-official-update',
				content: '我后来补充的延伸笔记',
			})
		);
		expect(deleteCard).not.toHaveBeenCalled();
		expect(files.get(wdeckPath)).toContain('card-official-update');
	});

	it('deletes mapped wdeck card entries when whole-card deletion is requested', async () => {
		const wdeckPath = 'weave/memory/deck-files/delete-map_01.wdeck';
		const wdeckContent = JSON.stringify({
			fileType: 'wdeck',
			logicalDeckId: 'deck-delete-map',
			logicalDeckName: '映射删除牌组',
			segmentIndex: 1,
			cardsById: {
				'card-a': {
					uuid: 'card-a',
					content: '> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Aalpha|Demo]]\n> Quote A\n',
				},
				'card-b': {
					uuid: 'card-b',
					content: '> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Abeta|Demo]]\n> Quote B\n',
				},
			},
		});
		const { app, files } = createMockApp({
			[wdeckPath]: wdeckContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const deleted = await service.deleteHighlight(
			wdeckPath,
			'readium:beta',
			'Books/demo.epub',
			'card:card-b',
			undefined,
			'delete-card'
		);

		expect(deleted).toBe(true);
		const parsed = JSON.parse(files.get(wdeckPath) || '{}');
		expect(parsed.cardsById['card-b']).toBeUndefined();
		expect(parsed.cardsById['card-a']).toBeDefined();
	});

	it('deletes the targeted card even when stored sid drifts and whole-card deletion is requested', async () => {
		const wdeckPath = 'weave/memory/deck-files/delete-sid-drift_01.wdeck';
		const wdeckContent = JSON.stringify({
			fileType: 'wdeck',
			logicalDeckId: 'deck-delete-sid-drift',
			logicalDeckName: '删除 SID 漂移牌组',
			segmentIndex: 1,
			cards: [
				{
					uuid: 'card-stale',
					content: [
						'---',
						'we_source: "[[Archive/old-demo.epub#weave-cfi=readium%3Astale-delete&sid=epubsrc-stale|Demo]]"',
						'---',
						'Stale sid card',
					].join('\n'),
				},
			],
		});
		const { app, files } = createMockApp({
			[wdeckPath]: wdeckContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const deleted = await service.deleteHighlight(
			wdeckPath,
			'readium:stale-delete',
			'Books/demo.epub',
			'card:card-stale',
			undefined,
			'delete-card'
		);

		expect(deleted).toBe(true);
		const parsed = JSON.parse(files.get(wdeckPath) || '{}');
		expect(parsed.cards).toHaveLength(0);
	});

	it('updates only the targeted markdown excerpt when duplicate callouts share the same cfi but have different excerpt ids', async () => {
		const notePath = 'Notes/duplicate-excerpts.md';
		const noteContent = [
			'> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Ashared&eid=excerpt-a|Demo]]',
			'> Quote A',
			'',
			'> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Ashared&eid=excerpt-b|Demo]]',
			'> Quote B',
			'',
		].join('\n');
		const { app, files } = createMockApp({
			[notePath]: noteContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const changed = await service.changeHighlightColor(
			notePath,
			'readium:shared',
			'Books/demo.epub',
			'purple',
			undefined,
			'excerpt-b'
		);

		expect(changed).toBe(true);
		expect(files.get(notePath)).toContain('> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Ashared&eid=excerpt-a|Demo]]');
		expect(files.get(notePath)).toContain('> [!EPUB|purple] [[Books/demo.epub#weave-cfi=readium%3Ashared&eid=excerpt-b|Demo]]');
	});

	it('adds a canvas file-node locator while keeping the underlying markdown note as the mutable source', async () => {
		const notePath = 'Notes/epub-excerpt.md';
		const canvasPath = 'Canvas/epub-notes.canvas';
		const noteContent = [
			'> [!EPUB|purple] [[Books/demo.epub#weave-cfi=readium%3Aalpha&eid=excerpt-fixed|Demo]] 2026-04-27 14:44',
			'> 紧挨车门旁有个空座，我将书包轻轻地放在座上。',
			'',
		].join('\n');
		const canvasContent = JSON.stringify({
			nodes: [
				{
					id: 'file-node-1',
					type: 'file',
					file: notePath,
				},
			],
		});
		const { app } = createMockApp({
			[notePath]: noteContent,
			[canvasPath]: canvasContent,
		});
		app.metadataCache.resolvedLinks = {};
		const service = new EpubBacklinkHighlightService(app);

		const highlights = await service.collectHighlights('Books/demo.epub', canvasPath);

		expect(highlights).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					sourceFile: notePath,
					excerptId: 'excerpt-fixed',
					sourceLocators: expect.arrayContaining([
						expect.objectContaining({
							sourceFile: canvasPath,
							sourceRef: 'canvas-file-node:file-node-1',
							excerptId: 'excerpt-fixed',
						}),
					]),
				}),
			]),
		);
	});

	it('deletes only the targeted markdown excerpt when duplicate callouts share the same cfi but have different excerpt ids', async () => {
		const notePath = 'Notes/duplicate-delete.md';
		const noteContent = [
			'> [!EPUB|green] [[Books/demo.epub#weave-cfi=readium%3Ashared&eid=excerpt-a|Demo]]',
			'> Quote A',
			'',
			'> [!EPUB|blue] [[Books/demo.epub#weave-cfi=readium%3Ashared&eid=excerpt-b|Demo]]',
			'> Quote B',
			'',
			'Plain tail',
		].join('\n');
		const { app, files } = createMockApp({
			[notePath]: noteContent,
		});
		const service = new EpubBacklinkHighlightService(app);

		const deleted = await service.deleteHighlight(
			notePath,
			'readium:shared',
			'Books/demo.epub',
			undefined,
			'excerpt-a'
		);

		expect(deleted).toBe(true);
		expect(files.get(notePath)).not.toContain('excerpt-a');
		expect(files.get(notePath)).toContain('excerpt-b');
		expect(files.get(notePath)).toContain('Plain tail');
	});
});
