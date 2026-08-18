import { Platform, TFile } from 'obsidian';
import { EpubStorageService, flushEpubStoragePendingProgress } from '../EpubStorageService';
import type { EpubBook } from '../types';

const SYNC_EPUB_ROOT = 'weave/incremental-reading/epub-reading';
const LOCAL_EPUB_DATA_PATH = '.obsidian/plugins/weave/state/epub-local-state.json';
const LEGACY_LOCAL_EPUB_DATA_PATH = '.obsidian/plugins/weave/state/incremental-reading/epub-reader-data.json';
const LOCAL_EPUB_SCAN_INDEX_PATH = '.obsidian/plugins/weave/cache/epub-scan-index.json';
const LOCAL_EPUB_STATE_ROOT = '.obsidian/plugins/weave/state/incremental-reading/reader-state/epub';
const LOCAL_EPUB_PARAGRAPH_MODE_POSITIONS_PATH =
	'.obsidian/plugins/weave/cache/epub-paragraph-mode-positions.json';
const LOCAL_EPUB_ARTIFACTS_ROOT = '.obsidian/plugins/weave/cache/incremental-reading/reader-artifacts/epub';

function resolveLocalEpubDataPath(files: Map<string, string>): string {
  return (
    Array.from(files.keys()).find((path) => path.endsWith('/epub-local-state.json')) ||
    LOCAL_EPUB_DATA_PATH
  );
}

function readLocalEpubData(files: Map<string, string>) {
  return JSON.parse(files.get(resolveLocalEpubDataPath(files)) || '{}');
}

function readLocalScanIndex(files: Map<string, string>) {
  return JSON.parse(files.get(LOCAL_EPUB_SCAN_INDEX_PATH) || '[]');
}

function createMemoryApp(
  initialFiles: Record<string, string> = {},
  vaultFiles: string[] = [],
  binaryFiles: Record<string, string | Uint8Array> = {}
) {
  const files = new Map<string, string>(Object.entries(initialFiles));
  const writes: string[] = [];
  const normalizedVaultFiles = new Set(vaultFiles.map((path) => path.replace(/\\/g, '/')));
  const normalizedBinaryFiles = new Map(
    Object.entries(binaryFiles).map(([path, value]) => [path.replace(/\\/g, '/'), value] as const)
  );

  const ensureParentDirs = (path: string) => {
    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    let current = '';
    for (let i = 0; i < parts.length - 1; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i];
    }
  };

  const list = (dir: string) => {
    const normalizedDir = dir.replace(/\\/g, '/').replace(/\/+$/, '');
    const prefix = normalizedDir ? `${normalizedDir}/` : '';
    const folders = new Set<string>();
    const directFiles: string[] = [];
    const allPaths = new Set<string>([
      ...Array.from(files.keys()),
      ...Array.from(normalizedVaultFiles),
    ]);

    for (const path of allPaths) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (!rest) continue;
      if (!rest.includes('/')) {
        directFiles.push(path);
        continue;
      }
      const folder = rest.split('/')[0];
      folders.add(prefix ? `${prefix}${folder}` : folder);
    }

    return { files: directFiles, folders: Array.from(folders) };
  };

  const createVaultFile = (path: string) => {
    const normalized = path.replace(/\\/g, '/');
    const extension = normalized.split('.').pop() || '';
    const basename = normalized.split('/').pop()?.replace(/\.[^.]+$/, '') || normalized;
    const folder = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    return Object.assign(Object.create(TFile.prototype), {
      path: normalized,
      extension,
      basename,
      name: normalized.split('/').pop() || normalized,
      stat: { size: 1024 },
      parent: folder ? { path: folder } : null,
    });
  };

  const adapter = {
    exists: vi.fn(async (path: string) => {
      const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
      if (files.has(normalized) || normalizedVaultFiles.has(normalized)) return true;
      const prefix = normalized ? `${normalized}/` : '';
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          return true;
        }
      }
      for (const vaultFilePath of normalizedVaultFiles) {
        if (vaultFilePath.startsWith(prefix)) {
          return true;
        }
      }
      return false;
    }),
    read: vi.fn(async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`Missing file: ${path}`);
      return value;
    }),
    write: vi.fn(async (path: string, content: string) => {
      ensureParentDirs(path);
      files.set(path, content);
      writes.push(path);
    }),
    remove: vi.fn(async (path: string) => {
      files.delete(path.replace(/\\/g, '/'));
    }),
    mkdir: vi.fn(async () => {}),
    list: vi.fn(async (dir: string) => list(dir)),
    stat: vi.fn(async (path: string) => {
      const normalized = path.replace(/\\/g, '/');
      if (!normalizedVaultFiles.has(normalized)) {
        throw new Error(`Missing file: ${normalized}`);
      }
      return { size: 1024, mtime: 1710000000000 };
    }),
    readBinary: vi.fn(async (path: string) => {
      const normalized = path.replace(/\\/g, '/');
      const value = normalizedBinaryFiles.get(normalized) ?? normalized;
      return value instanceof Uint8Array ? value : new TextEncoder().encode(value);
    }),
    rmdir: vi.fn(async (dir: string) => {
      const prefix = `${dir.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
      for (const key of Array.from(files.keys())) {
        if (key.startsWith(prefix)) files.delete(key);
      }
    }),
  };

  const app: any = {
    vault: {
      adapter,
      configDir: '.obsidian',
      getAbstractFileByPath: vi.fn((path: string) => {
        const normalized = path.replace(/\\/g, '/');
        if (files.has(normalized)) {
          return createVaultFile(normalized);
        }
        return normalizedVaultFiles.has(normalized) ? createVaultFile(normalized) : null;
      }),
      getFiles: vi.fn(() => {
        const paths = new Set<string>([
          ...Array.from(normalizedVaultFiles),
          ...Array.from(files.keys()).filter((path) => path.endsWith('.md')),
        ]);
        return Array.from(paths).map((path) => createVaultFile(path));
      }),
      read: vi.fn(async (file: TFile) => {
        const normalized = file.path.replace(/\\/g, '/');
        const value = files.get(normalized);
        if (value === undefined) {
          throw new Error(`Missing file: ${normalized}`);
        }
        return value;
      }),
      modify: vi.fn(async (file: TFile, content: string) => {
        const normalized = file.path.replace(/\\/g, '/');
        files.set(normalized, content);
        writes.push(normalized);
      }),
      create: vi.fn(async (path: string, content = '') => {
        const normalized = path.replace(/\\/g, '/');
        normalizedVaultFiles.add(normalized);
        if (content) {
          files.set(normalized, content);
        }
        writes.push(normalized);
        return createVaultFile(normalized);
      }),
    },
    fileManager: {
      trashFile: vi.fn(async (file: TFile) => {
        const normalized = file.path.replace(/\\/g, '/');
        normalizedVaultFiles.delete(normalized);
        normalizedBinaryFiles.delete(normalized);
        files.delete(normalized);
      }),
    },
    plugins: {
      getPlugin: vi.fn(() => ({
        settings: { weaveParentFolder: '' },
      })),
    },
  };

  return { app, files, writes, vaultFiles: normalizedVaultFiles };
}

function createBook(overrides: Partial<EpubBook> = {}): EpubBook {
  return {
    id: 'book-1',
    filePath: 'Books/demo.epub',
    metadata: {
      title: 'Demo',
      author: 'Author',
      chapterCount: 3,
      coverImage: 'data:image/jpeg;base64,AAAA',
    },
    currentPosition: {
      chapterIndex: 0,
      cfi: '/6/2',
      percent: 10,
    },
    readingStats: {
      totalReadTime: 0,
      lastReadTime: 100,
      createdTime: 50,
    },
    ...overrides,
  };
}

async function withPlatformIsMobile<T>(value: boolean, run: () => Promise<T>): Promise<T> {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Platform, 'isMobile');
  Object.defineProperty(Platform, 'isMobile', {
    configurable: true,
    value,
  });
  try {
    return await run();
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(Platform, 'isMobile', originalDescriptor);
    } else {
      (Platform as { isMobile?: boolean }).isMobile = undefined;
    }
  }
}

describe('EpubStorageService', () => {
  it('returns the updated comfortable reading defaults when no reader settings were saved', async () => {
    const { app } = createMemoryApp();

    const service = new EpubStorageService(app);
    const settings = await service.loadReaderSettings();

    expect(settings.lineHeight).toBe(1.72);
    expect(settings.viewportSidePadding).toBe(24);
    expect(settings.widthMode).toBe('standard');
    expect(settings.layoutMode).toBe('paginated');
    expect(settings.flowMode).toBe('paginated');
    expect(settings.footnoteClickAction).toBe('preview');
  });

  it('returns scrolled reader defaults on mobile when no reader settings were saved', async () => {
    const { app } = createMemoryApp();

    await withPlatformIsMobile(true, async () => {
      const service = new EpubStorageService(app);
      const settings = await service.loadReaderSettings();

      expect(settings.lineHeight).toBe(1.66);
      expect(settings.viewportSidePadding).toBe(18);
      expect(settings.widthMode).toBe('full');
      expect(settings.layoutMode).toBe('paginated');
      expect(settings.flowMode).toBe('scrolled');
    });
  });

  it('stores reader settings in the unified local epub data file on mobile', async () => {
    const { app, files } = createMemoryApp({
      [`${SYNC_EPUB_ROOT}/reader-settings.json`]: JSON.stringify({
        flowMode: 'paginated',
        layoutMode: 'paginated',
      }),
    });

    await withPlatformIsMobile(true, async () => {
      const service = new EpubStorageService(app);
      await service.saveReaderSettings({
        lineHeight: 1.9,
        letterSpacing: 0.02,
        pageMargin: 40,
        viewportSidePadding: 22,
        widthMode: 'full',
        layoutMode: 'paginated',
        flowMode: 'scrolled',
        showScrolledSideNav: true,
        footnoteClickAction: 'navigate',
		showTopSticker: true,
        topStickerLayout: 'auto',
        paragraphModeEnabled: false,
        paragraphModeFontSize: 'medium',
        paragraphModeFontScale: 100,
        paragraphModeSurfaceStyle: 'spotlight',
        paragraphModeTransitionStyle: 'settle',
      });
    });

    expect(files.has(LOCAL_EPUB_DATA_PATH)).toBe(true);
    expect(files.has(`${SYNC_EPUB_ROOT}/reader-settings.json`)).toBe(true);
    expect(files.has(`${SYNC_EPUB_ROOT}/reader-settings.mobile.json`)).toBe(false);
    expect(readLocalEpubData(files).readerSettings.mobile.flowMode).toBe('scrolled');
    expect(readLocalEpubData(files).readerSettings.mobile.viewportSidePadding).toBe(22);
    expect(JSON.parse(files.get(`${SYNC_EPUB_ROOT}/reader-settings.json`) || '{}').flowMode).toBe('paginated');
  });

  it('preserves legacy mobile paginated default on mobile', async () => {
    const { app } = createMemoryApp({
      [`${SYNC_EPUB_ROOT}/reader-settings.mobile.json`]: JSON.stringify({
        lineHeight: 1.66,
        widthMode: 'full',
        layoutMode: 'paginated',
        flowMode: 'paginated',
        showScrolledSideNav: true,
        footnoteClickAction: 'preview',
        showTopSticker: true,
        topStickerLayout: 'auto',
      }),
    });

    await withPlatformIsMobile(true, async () => {
      const service = new EpubStorageService(app);
      const settings = await service.loadReaderSettings();

      expect(settings.layoutMode).toBe('paginated');
      expect(settings.flowMode).toBe('paginated');
    });
  });

  it('preserves explicit mobile paginated settings', async () => {
    const { app } = createMemoryApp({
      [`${SYNC_EPUB_ROOT}/reader-settings.mobile.json`]: JSON.stringify({
        lineHeight: 1.82,
        widthMode: 'full',
        layoutMode: 'paginated',
        flowMode: 'paginated',
        showScrolledSideNav: false,
        footnoteClickAction: 'navigate',
		showTopSticker: false,
        topStickerLayout: 'sidebar',
      }),
    });

    await withPlatformIsMobile(true, async () => {
      const service = new EpubStorageService(app);
      const settings = await service.loadReaderSettings();

      expect(settings.lineHeight).toBe(1.82);
      expect(settings.layoutMode).toBe('paginated');
      expect(settings.flowMode).toBe('paginated');
      expect(settings.showScrolledSideNav).toBe(false);
      expect(settings.footnoteClickAction).toBe('navigate');
    });
  });

  it('upgrades untouched legacy desktop reader settings to the new comfortable defaults', async () => {
    const { app } = createMemoryApp({
      [`${SYNC_EPUB_ROOT}/reader-settings.desktop.json`]: JSON.stringify({
        lineHeight: 1.9,
        widthMode: 'full',
        layoutMode: 'paginated',
        flowMode: 'paginated',
        showScrolledSideNav: true,
        footnoteClickAction: 'preview',
		showTopSticker: true,
        topStickerLayout: 'auto',
      }),
    });

    const service = new EpubStorageService(app);
    const settings = await service.loadReaderSettings();

    expect(settings.lineHeight).toBe(1.72);
    expect(settings.widthMode).toBe('standard');
    expect(settings.layoutMode).toBe('paginated');
    expect(settings.flowMode).toBe('paginated');
  });

  it('migrates retired container width mode to fit in desktop reader settings', async () => {
    const { app } = createMemoryApp({
      [`${SYNC_EPUB_ROOT}/reader-settings.desktop.json`]: JSON.stringify({
        lineHeight: 1.78,
        letterSpacing: 0.01,
        pageMargin: 36,
        viewportSidePadding: 24,
        widthMode: 'container',
        layoutMode: 'paginated',
        flowMode: 'paginated',
        showScrolledSideNav: true,
        footnoteClickAction: 'preview',
		showTopSticker: true,
        topStickerLayout: 'inline',
      }),
    });

    const service = new EpubStorageService(app);

    const settings = await service.loadReaderSettings();

    expect(settings.widthMode).toBe('fit');
    expect(settings.pageMargin).toBe(36);
    expect(settings.lineHeight).toBe(1.78);
    expect(settings.topStickerLayout).toBe('inline');
  });

  it('migrates legacy epub-reading data into incremental-reading on first access', async () => {
    const { app, files } = createMemoryApp({
      'weave/epub-reading/books.json': JSON.stringify({
        'book-1': createBook(),
      }),
      'weave/epub-reading/book-1/state.json': JSON.stringify({
        currentPosition: {
          chapterIndex: 1,
          cfi: '/6/6',
          percent: 42,
        },
        readingStats: {
          totalReadTime: 10,
          lastReadTime: 999,
          createdTime: 50,
        },
      }),
    });

    const service = new EpubStorageService(app);
    const books = await service.loadBooks({ hydrateStates: true });
    const book = books['book-1'];

    expect(book?.currentPosition.percent).toBe(42);
    expect(files.has(`${SYNC_EPUB_ROOT}/books.json`)).toBe(true);
    expect(files.has(LOCAL_EPUB_DATA_PATH)).toBe(false);
  });

  it('stores reading progress in the per-book bookmark markdown file without rewriting books.json', async () => {
    const booksPath = `${SYNC_EPUB_ROOT}/books.json`;
    const { app, files, writes } = createMemoryApp(
      {
        [booksPath]: JSON.stringify({
          'book-1': createBook(),
        }),
      },
      ['Books/demo.epub']
    );

    const service = new EpubStorageService(app);

    await service.saveProgress('book-1', {
      chapterIndex: 2,
      cfi: '/6/8',
      percent: 66,
    });
    await service.flushPendingProgress();

    expect(writes).not.toContain(booksPath);
    const progress = await service.loadProgress('book-1');

    expect(files.has(booksPath)).toBe(false);
    expect(progress?.percent).toBe(66);
    expect(writes).not.toContain(booksPath);
    const bookmarkFile = Array.from(files.keys()).find((path) =>
      path.includes('Zora Reader/') && path.endsWith('.md')
    );
    expect(bookmarkFile).toBeTruthy();
    expect(files.get(bookmarkFile || '') || '').toContain('readingState:');
    expect(files.get(bookmarkFile || '') || '').toContain('percent: 66');
  });

  it('flushes debounced progress when flushPendingProgress is missing on a legacy instance', async () => {
    const { app, files } = createMemoryApp(
      {
        [`${SYNC_EPUB_ROOT}/books.json`]: JSON.stringify({
          'book-1': createBook(),
        }),
      },
      ['Books/demo.epub']
    );

    const service = new EpubStorageService(app);
    await service.saveProgress('book-1', {
      chapterIndex: 1,
      cfi: '/6/4',
      percent: 33,
    });

    const legacyService = service as EpubStorageService & {
      flushPendingProgress?: EpubStorageService['flushPendingProgress'];
    };
    delete legacyService.flushPendingProgress;

    await flushEpubStoragePendingProgress(service);

    const progress = await service.loadProgress('book-1');
    expect(progress?.percent).toBe(33);
    expect(Array.from(files.keys()).some((path) => path.includes('Zora Reader/'))).toBe(true);
  });

  it('ignores flush when the storage service reference is missing', async () => {
    await expect(
      flushEpubStoragePendingProgress(undefined as unknown as EpubStorageService)
    ).resolves.toBeUndefined();
  });

  it('marks and clears book completion without rewriting locator percent', async () => {
    const { app } = createMemoryApp(
      {
        [`${SYNC_EPUB_ROOT}/books.json`]: JSON.stringify({
          'book-1': createBook(),
        }),
      },
      ['Books/demo.epub']
    );

    const service = new EpubStorageService(app);
    await service.saveProgress('book-1', {
      chapterIndex: 8,
      cfi: '/6/80',
      percent: 96,
    });
    await service.flushPendingProgress();

    const completed = await service.markBookCompleted('book-1', 12345);
    expect(completed?.readingStats.completedTime).toBe(12345);

    const afterComplete = await service.getBook('book-1');
    expect(afterComplete?.currentPosition.percent).toBe(96);
    expect(afterComplete?.readingStats.completedTime).toBe(12345);

    const cleared = await service.clearBookCompletion('book-1');
    expect(cleared?.readingStats.completedTime).toBeUndefined();
    expect(cleared?.currentPosition.percent).toBe(96);
  });

  it('hydrates persisted per-book state on reload', async () => {
    const { app } = createMemoryApp({
      [`${SYNC_EPUB_ROOT}/books.json`]: JSON.stringify({
        'book-1': createBook(),
      }),
      [`${LOCAL_EPUB_STATE_ROOT}/book-1/state.json`]: JSON.stringify({
        currentPosition: {
          chapterIndex: 1,
          cfi: '/6/6',
          percent: 42,
        },
        readingStats: {
          totalReadTime: 10,
          lastReadTime: 999,
          createdTime: 50,
        },
      }),
    });

    const service = new EpubStorageService(app);
    const book = await service.findBookByFilePath('Books/demo.epub');

    expect(book?.currentPosition.percent).toBe(42);
    expect(book?.readingStats.lastReadTime).toBe(999);
  });

  it('stores and loads the manual last-open bookmark in the per-book bookmark markdown file', async () => {
    const { app, files } = createMemoryApp(
      {
        [`${SYNC_EPUB_ROOT}/books.json`]: JSON.stringify({
          'book-1': createBook(),
        }),
      },
      ['Books/demo.epub']
    );
    const service = new EpubStorageService(app);

    await service.saveLastOpenBookmark('book-1', {
      chapterIndex: 2,
      cfi: '/6/10',
      percent: 61.5,
      title: '第三章',
      preview: '第三章',
      savedAt: 1710000000000,
    });

    const bookmarkFile = Array.from(files.keys()).find((path) =>
      path.includes('Zora Reader/') && path.endsWith('.md')
    );
    expect(bookmarkFile).toBeTruthy();
    const bookmarkContent = files.get(bookmarkFile || '') || '';
    expect(bookmarkContent).toContain('readingState:');
    expect(bookmarkContent).toContain('/6/10');
    expect(readLocalEpubData(files).books?.['book-1']?.lastOpenBookmark).toBeUndefined();

    const restored = await service.loadLastOpenBookmark('book-1');
    expect(restored?.cfi).toBe('/6/10');
    expect(restored?.percent).toBe(61.5);
    expect(restored?.chapterIndex).toBe(2);
    expect(restored?.savedAt).toBe(1710000000000);
  });

  it('loads the manual last-open bookmark from the legacy sync path when local state is absent', async () => {
    const { app } = createMemoryApp({
      [`${SYNC_EPUB_ROOT}/book-1/last-open-bookmark.json`]: JSON.stringify({
        chapterIndex: 1,
        cfi: 'epubcfi(/6/8!/4/2/4)',
        percent: 33.3,
        title: 'legacy',
        preview: 'legacy',
        savedAt: 1710000000001,
      }),
    });
    const service = new EpubStorageService(app);

    await expect(service.loadLastOpenBookmark('book-1')).resolves.toEqual({
      chapterIndex: 1,
      cfi: 'epubcfi(/6/8!/4/2/4)',
      percent: 33.3,
      title: 'legacy',
      preview: 'legacy',
      savedAt: 1710000000001,
    });
  });

  it('stores, loads, and clears the reading reference point in the unified local epub data file', async () => {
    const { app, files } = createMemoryApp();
    const service = new EpubStorageService(app);

    await service.saveReadingReferencePoint('book-1', {
      chapterIndex: 3,
      cfi: 'epubcfi(/6/14!/4/2/8)',
      percent: 48.2,
      title: '第四章',
      savedAt: 1710000001000,
    });

    expect(readLocalEpubData(files).books['book-1'].readingReferencePoint).toEqual({
      chapterIndex: 3,
      cfi: 'epubcfi(/6/14!/4/2/8)',
      percent: 48.2,
      title: '第四章',
      savedAt: 1710000001000,
    });

    await expect(service.loadReadingReferencePoint('book-1')).resolves.toEqual({
      chapterIndex: 3,
      cfi: 'epubcfi(/6/14!/4/2/8)',
      percent: 48.2,
      title: '第四章',
      savedAt: 1710000001000,
    });

    await service.deleteReadingReferencePoint('book-1');

    expect(readLocalEpubData(files).books['book-1'].readingReferencePoint).toBeNull();
    await expect(service.loadReadingReferencePoint('book-1')).resolves.toBeNull();
  });

  it('stores concealed text fragments in the unified local epub data file', async () => {
    const { app, files } = createMemoryApp();
    const service = new EpubStorageService(app);

    await service.saveConcealedTexts('book-1', [
      {
        id: 'conceal-1',
        text: '低价值片段',
        mode: 'mask',
        chapterIndex: 1,
        cfiRange: '/6/4',
        createdTime: 123,
      },
    ]);

    expect(readLocalEpubData(files).books['book-1'].concealedTexts).toEqual([
      {
        id: 'conceal-1',
        text: '低价值片段',
        mode: 'mask',
        chapterIndex: 1,
        cfiRange: '/6/4',
        createdTime: 123,
      },
    ]);
  });

  it('loads concealed text fragments from the legacy sync path when local artifacts are absent', async () => {
    const { app } = createMemoryApp({
      [`${SYNC_EPUB_ROOT}/book-1/concealed-texts.json`]: JSON.stringify([
        {
          id: 'conceal-legacy',
          text: 'legacy text',
          mode: 'mask',
          chapterIndex: 2,
          cfiRange: '/6/8',
          createdTime: 456,
        },
      ]),
    });
    const service = new EpubStorageService(app);

    await expect(service.loadConcealedTexts('book-1')).resolves.toEqual([
      {
        id: 'conceal-legacy',
        text: 'legacy text',
        mode: 'mask',
        chapterIndex: 2,
        cfiRange: '/6/8',
        createdTime: 456,
      },
    ]);
  });

  it('can consolidate legacy epub local data into one plugin-local file and remove the legacy files', async () => {
    const { app, files } = createMemoryApp({
      [`${SYNC_EPUB_ROOT}/books.json`]: JSON.stringify({
        'book-1': createBook(),
      }),
      [`${SYNC_EPUB_ROOT}/book-1/bookmarks.json`]: JSON.stringify([
        {
          id: 'bookmark-1',
          title: 'Legacy bookmark',
          chapterIndex: 1,
          cfi: 'epubcfi(/6/4!/4/2/2)',
          preview: 'Legacy bookmark',
          createdTime: 1710000000000,
        },
      ]),
      [`${SYNC_EPUB_ROOT}/book-1/state.json`]: JSON.stringify({
        currentPosition: {
          chapterIndex: 2,
          cfi: '/6/8',
          percent: 66,
        },
        readingStats: {
          totalReadTime: 12,
          lastReadTime: 222,
          createdTime: 111,
        },
      }),
      [`${SYNC_EPUB_ROOT}/reader-settings.desktop.json`]: JSON.stringify({
        lineHeight: 1.8,
        widthMode: 'standard',
        layoutMode: 'paginated',
        flowMode: 'paginated',
        showScrolledSideNav: true,
        footnoteClickAction: 'preview',
      }),
      [`${SYNC_EPUB_ROOT}/canvas-bindings.json`]: JSON.stringify({
        'book-1': 'Canvas/demo.canvas',
      }),
      [`${SYNC_EPUB_ROOT}/epub-source-registry.json`]: JSON.stringify([
        {
          sourceId: 'epubsrc-1',
          filePath: 'Books/demo.epub',
          lastSeenAt: 1710000000000,
        },
      ]),
      [`${SYNC_EPUB_ROOT}/epub-scan-index.json`]: JSON.stringify([
        {
          path: 'Books/demo.epub',
          name: 'demo',
          folder: 'Books',
          size: 1024,
          mtime: 1710000000000,
        },
      ]),
      [`${LOCAL_EPUB_ARTIFACTS_ROOT}/book-1/concealed-texts.json`]: JSON.stringify([
        {
          id: 'conceal-1',
          text: 'legacy conceal',
          mode: 'mask',
          chapterIndex: 1,
          cfiRange: '/6/4',
          createdTime: 333,
        },
      ]),
      [`${SYNC_EPUB_ROOT}/book-1/highlights.json`]: JSON.stringify([
        {
          id: 'highlight-legacy',
          text: 'legacy highlight',
          color: 'yellow',
          chapterIndex: 1,
          cfiRange: 'epubcfi(/6/4!/4/2/2)',
          createdTime: 444,
        },
      ]),
      [`${SYNC_EPUB_ROOT}/book-1/notes.json`]: JSON.stringify([
        {
          id: 'note-legacy',
          content: 'legacy note',
          quotedText: 'legacy quote',
          chapterIndex: 1,
          cfi: 'epubcfi(/6/4!/4/2/2)',
          createdTime: 555,
          modifiedTime: 555,
        },
      ]),
    });
    const service = new EpubStorageService(app);

    const report = await service.migrateLegacyLocalData({ cleanupLegacyFiles: true });
    const localData = readLocalEpubData(files);

    expect(report.failures).toEqual([]);
    expect(report.remainingLegacyFiles).toEqual([]);
    expect(readLocalScanIndex(files)).toEqual([
      {
        path: 'Books/demo.epub',
        name: 'demo',
        folder: 'Books',
        size: 1024,
        mtime: 1710000000000,
      },
    ]);
    expect(localData).toMatchObject({
      bookCatalogStoredLocally: true,
      books: {
        'book-1': {
          descriptor: {
            id: 'book-1',
            filePath: 'Books/demo.epub',
            metadata: {
              title: 'Demo',
              author: 'Author',
            },
          },
          state: {
            currentPosition: {
              chapterIndex: 2,
              cfi: '/6/8',
              percent: 66,
            },
          },
          concealedTexts: [
            {
              id: 'conceal-1',
              cfiRange: '/6/4',
            },
          ],
        },
      },
      readerSettings: {
        desktop: {
          lineHeight: 1.8,
        },
      },
      canvasBindings: {
        'book-1': 'Canvas/demo.canvas',
      },
      sourceRegistry: [
        {
          sourceId: 'epubsrc-1',
          filePath: 'Books/demo.epub',
        },
      ],
    });
    expect(files.has(`${SYNC_EPUB_ROOT}/books.json`)).toBe(false);
    expect(files.has(`${SYNC_EPUB_ROOT}/book-1/bookmarks.json`)).toBe(false);
    expect(files.has(`${SYNC_EPUB_ROOT}/book-1/state.json`)).toBe(false);
    expect(files.has(`${SYNC_EPUB_ROOT}/book-1/highlights.json`)).toBe(false);
    expect(files.has(`${SYNC_EPUB_ROOT}/book-1/notes.json`)).toBe(false);
    expect(files.has(`${SYNC_EPUB_ROOT}/reader-settings.desktop.json`)).toBe(false);
    expect(files.has(`${SYNC_EPUB_ROOT}/canvas-bindings.json`)).toBe(false);
    expect(files.has(`${SYNC_EPUB_ROOT}/epub-source-registry.json`)).toBe(false);
    expect(files.has(`${SYNC_EPUB_ROOT}/epub-scan-index.json`)).toBe(false);
    expect(files.has(`${LOCAL_EPUB_ARTIFACTS_ROOT}/book-1/concealed-texts.json`)).toBe(false);
  });

  it('migrates the legacy unified local state file into the new root state path on first read', async () => {
    const { app, files } = createMemoryApp({
      [LEGACY_LOCAL_EPUB_DATA_PATH]: JSON.stringify({
        version: 1,
        updatedAt: 1710000000000,
        bookshelfMembership: [
          {
            path: 'Books/demo.epub',
            addedAt: 100,
          },
        ],
      }),
    }, ['Books/demo.epub']);

    const service = new EpubStorageService(app);

    await expect(service.loadBookshelfMembership()).resolves.toEqual([
      {
        path: 'Books/demo.epub',
        addedAt: 100,
      },
    ]);
    expect(files.has(LEGACY_LOCAL_EPUB_DATA_PATH)).toBe(false);
    expect(readLocalEpubData(files).bookshelfMembership).toEqual([
      {
        path: 'Books/demo.epub',
        addedAt: 100,
      },
    ]);
  });

  it('recovers from a transient parse failure when reading unified local state on startup', async () => {
    const { app } = createMemoryApp({
      [LOCAL_EPUB_DATA_PATH]: JSON.stringify({
        version: 1,
        updatedAt: 1710000000000,
        bookshelfMembership: [
          {
            path: 'Books/demo.epub',
            addedAt: 100,
          },
        ],
      }),
    }, ['Books/demo.epub']);

    const adapterRead = app.vault.adapter.read as ReturnType<typeof vi.fn>;
    const baseReadImpl = adapterRead.getMockImplementation();
    let shouldFailFirstRead = true;
    adapterRead.mockImplementation(async (path: string) => {
      if (path === LOCAL_EPUB_DATA_PATH && shouldFailFirstRead) {
        shouldFailFirstRead = false;
        return '{"version":1,"updatedAt":1710000000000,';
      }
      if (baseReadImpl) {
        return baseReadImpl(path);
      }
      throw new Error(`Missing file: ${path}`);
    });

    const service = new EpubStorageService(app);
    await expect(service.loadBookshelfMembership()).resolves.toEqual([
      {
        path: 'Books/demo.epub',
        addedAt: 100,
      },
    ]);
  });

  it('moves legacy local scanIndex into the root cache file and clears it from local state', async () => {
    const { app, files } = createMemoryApp({
      [LEGACY_LOCAL_EPUB_DATA_PATH]: JSON.stringify({
        version: 1,
        updatedAt: 1710000000000,
        scanIndex: [
          {
            path: 'Books/demo.epub',
            name: 'demo',
            folder: 'Books',
            size: 1024,
            mtime: 1710000000000,
          },
        ],
      }),
    }, ['Books/demo.epub']);

    const service = new EpubStorageService(app);

    await expect(service.loadScanIndex()).resolves.toEqual([
      {
        path: 'Books/demo.epub',
        name: 'demo',
        folder: 'Books',
        size: 1024,
        mtime: 1710000000000,
      },
    ]);
    expect(files.has(LEGACY_LOCAL_EPUB_DATA_PATH)).toBe(false);
    expect(readLocalScanIndex(files)).toEqual([
      {
        path: 'Books/demo.epub',
        name: 'demo',
        folder: 'Books',
        size: 1024,
        mtime: 1710000000000,
      },
    ]);
    expect([undefined, []]).toContainEqual(readLocalEpubData(files).scanIndex);
  });

  it('persists canvas bindings into unified local data without recreating legacy sync files', async () => {
    const { app, files } = createMemoryApp();
    const service = new EpubStorageService(app);

    await service.setCanvasBinding('book-1', 'Canvas/demo.canvas');

    expect(await service.getCanvasBinding('book-1')).toBe('Canvas/demo.canvas');
    expect(readLocalEpubData(files).canvasBindings).toEqual({
      'book-1': 'Canvas/demo.canvas',
    });
    expect(files.has(`${SYNC_EPUB_ROOT}/canvas-bindings.json`)).toBe(false);
  });

  it('deduplicates concealed text fragments by cfi range when adding repeatedly', async () => {
    const { app } = createMemoryApp();
    const service = new EpubStorageService(app);

    await service.addConcealedText('book-1', {
      id: 'conceal-1',
      text: '第一次',
      mode: 'mask',
      chapterIndex: 1,
      cfiRange: '/6/4',
      createdTime: 123,
    });
    await service.addConcealedText('book-1', {
      id: 'conceal-2',
      text: '第二次',
      mode: 'mask',
      chapterIndex: 1,
      cfiRange: '/6/4',
      createdTime: 456,
    });

    expect(await service.loadConcealedTexts('book-1')).toEqual([
      {
        id: 'conceal-2',
        text: '第二次',
        mode: 'mask',
        chapterIndex: 1,
        cfiRange: '/6/4',
        createdTime: 456,
      },
    ]);
  });

  it('refreshes folder bookshelf entries when cached folder data misses new epub files', async () => {
    const indexPath = 'weave/incremental-reading/epub-reading/epub-scan-index.json';
    const { app, files } = createMemoryApp({
      [indexPath]: JSON.stringify([
        {
          path: 'Books/old.epub',
          name: 'old',
          folder: 'Books',
          size: 1024,
          mtime: 0,
        },
        {
          path: 'Other/outside.epub',
          name: 'outside',
          folder: 'Other',
          size: 1024,
          mtime: 0,
        },
      ]),
    }, ['Books/old.epub', 'Books/new.epub', 'Other/outside.epub']);

    const service = new EpubStorageService(app);
    const entries = await service.loadBookshelfEntriesForFolder('Books');
    const scanIndex = readLocalScanIndex(files);

    expect(entries.map((entry) => entry.path)).toEqual([
      'Books/new.epub',
      'Books/old.epub',
    ]);

    expect(scanIndex).toEqual([
      {
        path: 'Books/new.epub',
        name: 'new',
        folder: 'Books',
        size: 1024,
        mtime: 0,
      },
      {
        path: 'Books/old.epub',
        name: 'old',
        folder: 'Books',
        size: 1024,
        mtime: 0,
      },
      {
        path: 'Other/outside.epub',
        name: 'outside',
        folder: 'Other',
        size: 1024,
        mtime: 0,
      },
    ]);
  });

  it('does not resurrect bookshelf entries from books cache when stored index is explicitly empty', async () => {
    const booksPath = `${SYNC_EPUB_ROOT}/books.json`;
    const indexPath = 'weave/incremental-reading/epub-reading/bookshelf-index.json';
    const { app } = createMemoryApp({
      [booksPath]: JSON.stringify({
        'book-1': createBook(),
      }),
      [indexPath]: JSON.stringify([]),
    }, ['Books/demo.epub']);

    const service = new EpubStorageService(app);
    const entries = await service.loadBookshelfIndex();

    expect(entries).toEqual([]);
  });

  it('keeps scanned EPUB files out of the bookshelf until the user adds membership', async () => {
    const { app, files } = createMemoryApp({}, ['Books/demo.epub', 'Books/other.epub']);

    const service = new EpubStorageService(app);
    const scanEntries = await service.scanVaultEpubs();
    const bookshelfEntries = await service.listBookshelfEntries();

    expect(scanEntries.map((entry) => entry.path)).toEqual(['Books/demo.epub', 'Books/other.epub']);
    expect(bookshelfEntries).toEqual([]);
    expect(readLocalEpubData(files).bookshelfMembership).toBeUndefined();
  });

  it('adds selected scanned EPUB files into bookshelf membership only once', async () => {
    const { app, files } = createMemoryApp({}, ['Books/demo.epub', 'Books/other.epub']);

    const service = new EpubStorageService(app);
    await service.scanVaultEpubs();
    await service.addBooksToBookshelf(['Books/demo.epub', 'Books/demo.epub']);
    const bookshelfEntries = await service.listBookshelfEntries();

    expect(bookshelfEntries.map((entry) => entry.path)).toEqual(['Books/demo.epub']);
    expect(readLocalEpubData(files).bookshelfMembership).toEqual([
      {
        path: 'Books/demo.epub',
        addedAt: expect.any(Number),
      },
    ]);
  });

  it('only keeps scan results that resolve to a vault book file', async () => {
    const { app } = createMemoryApp({}, ['Books/demo.epub', 'Archive/demo.epub']);

    const service = new EpubStorageService(app);
    const entries = await service.scanVaultBooks();

    expect(entries.map((entry) => entry.path).sort()).toEqual(
      ['Archive/demo.epub', 'Books/demo.epub'].sort()
    );
  });

  it('adds books to bookshelf using canonical vault paths', async () => {
    const { app, files } = createMemoryApp({}, ['Books/demo.epub']);

    const service = new EpubStorageService(app);
    const added = await service.addBooksToBookshelf(['demo.epub']);

    expect(added).toEqual([{ path: 'Books/demo.epub', addedAt: expect.any(Number) }]);
    expect(readLocalEpubData(files).bookshelfMembership).toEqual([
      { path: 'Books/demo.epub', addedAt: expect.any(Number) },
    ]);
    await expect(service.listBookshelfEntries()).resolves.toEqual([
      expect.objectContaining({ path: 'Books/demo.epub' }),
    ]);
  });

  it('scans only visible vault-indexed books and ignores trash paths', async () => {
    const { app } = createMemoryApp({}, ['Books/visible.epub', '.trash/deleted.epub']);

    const service = new EpubStorageService(app);
    const entries = await service.scanVaultBooks();

    expect(entries.map((entry) => entry.path)).toEqual(['Books/visible.epub']);
  });

  it('falls back to direct local data write when adapter rename cannot overwrite existing file', async () => {
    const { app, files } = createMemoryApp({
      [LOCAL_EPUB_DATA_PATH]: JSON.stringify({
        version: 1,
        updatedAt: 1,
        bookshelfMembership: [],
      }),
    }, ['Books/visible.epub']);

    (app.vault.adapter as { rename?: (oldPath: string, newPath: string) => Promise<void> }).rename = vi.fn(
      async () => {
        throw new Error('Destination file already exists!');
      }
    );

    const service = new EpubStorageService(app);
    const entries = await service.scanVaultBooks();

    expect(entries.map((entry) => entry.path)).toEqual(['Books/visible.epub']);
    expect(readLocalScanIndex(files).map((entry: { path: string }) => entry.path)).toEqual([
      'Books/visible.epub',
    ]);
    expect(readLocalEpubData(files).version).toBe(1);
  });

  it('drops trashed paths from cached scan index on load', async () => {
    const indexPath = LOCAL_EPUB_SCAN_INDEX_PATH;
    const { app, files } = createMemoryApp({
      [indexPath]: JSON.stringify([
        {
          path: 'Books/visible.epub',
          name: 'visible',
          folder: 'Books',
          size: 1024,
          mtime: 0,
        },
        {
          path: '.trash/deleted.epub',
          name: 'deleted',
          folder: '.trash',
          size: 1024,
          mtime: 0,
        },
      ]),
    }, ['Books/visible.epub']);

    const service = new EpubStorageService(app);
    const scanIndex = await service.loadScanIndex();

    expect(scanIndex.map((entry) => entry.path)).toEqual(['Books/visible.epub']);
    expect(readLocalScanIndex(files).map((entry: { path: string }) => entry.path)).toEqual([
      'Books/visible.epub',
    ]);
  });

  it('repairs basename-only bookshelf membership when listing entries', async () => {
    const { app, files } = createMemoryApp({
      [LOCAL_EPUB_DATA_PATH]: JSON.stringify({
        version: 1,
        updatedAt: 1,
        bookshelfMembership: [{ path: 'demo.epub', addedAt: 10 }],
      }),
      [LOCAL_EPUB_SCAN_INDEX_PATH]: JSON.stringify([
        {
          path: 'demo.epub',
          name: 'demo',
          folder: '',
          size: 1024,
          mtime: 0,
        },
      ]),
    }, ['Books/demo.epub']);

    const service = new EpubStorageService(app);
    const entries = await service.listBookshelfEntries();

    expect(entries.map((entry) => entry.path)).toEqual(['Books/demo.epub']);
    expect(readLocalEpubData(files).bookshelfMembership).toEqual([
      { path: 'Books/demo.epub', addedAt: 10 },
    ]);
  });

  it('lists missing bookshelf entries as empty without mutating stored membership', async () => {
    const { app, files } = createMemoryApp({
      [LOCAL_EPUB_DATA_PATH]: JSON.stringify({
        version: 1,
        updatedAt: 1,
        bookshelfMembership: [
          { path: 'Books/missing.epub', addedAt: 10 },
        ],
      }),
      [LOCAL_EPUB_SCAN_INDEX_PATH]: JSON.stringify([
        {
          path: 'Books/missing.epub',
          name: 'missing',
          folder: 'Books',
          size: 1024,
          mtime: 0,
        },
      ]),
    });

    const service = new EpubStorageService(app);
    await expect(service.listBookshelfEntries()).resolves.toEqual([]);

    const localData = readLocalEpubData(files);
    expect(localData.bookshelfMembership).toEqual([
      { path: 'Books/missing.epub', addedAt: 10 },
    ]);
  });

  it('prunes stale bookshelf membership when missing files are explicitly cleaned up', async () => {
    const { app, files } = createMemoryApp({
      [LOCAL_EPUB_DATA_PATH]: JSON.stringify({
        version: 1,
        updatedAt: 1,
        bookshelfMembership: [
          { path: 'Books/missing.epub', addedAt: 10 },
        ],
      }),
      [LOCAL_EPUB_SCAN_INDEX_PATH]: JSON.stringify([
        {
          path: 'Books/missing.epub',
          name: 'missing',
          folder: 'Books',
          size: 1024,
          mtime: 0,
        },
      ]),
    });

    const service = new EpubStorageService(app);
    await service.pruneMissingBooks();

    expect(readLocalEpubData(files).bookshelfMembership).toEqual([]);
    expect(readLocalScanIndex(files)).toEqual([]);
  });

  it('removeMissingBookshelfEntry clears membership and scan cache for a missing file', async () => {
    const { app, files } = createMemoryApp({
      [LOCAL_EPUB_DATA_PATH]: JSON.stringify({
        version: 1,
        updatedAt: 1,
        bookshelfMembership: [
          { path: 'Books/missing.epub', addedAt: 10 },
        ],
      }),
      [LOCAL_EPUB_SCAN_INDEX_PATH]: JSON.stringify([
        {
          path: 'Books/missing.epub',
          name: 'missing',
          folder: 'Books',
          size: 1024,
          mtime: 0,
        },
      ]),
    });

    const service = new EpubStorageService(app);
    await service.removeMissingBookshelfEntry('Books/missing.epub');

    expect(readLocalEpubData(files).bookshelfMembership).toEqual([]);
    expect(readLocalScanIndex(files)).toEqual([]);
  });

  it('updateBookDisplayTitle persists renamed metadata for later loads', async () => {
    const { app } = createMemoryApp({}, ['Books/demo.epub']);
    const service = new EpubStorageService(app);
    const book = createBook({
      id: 'book-rename',
      filePath: 'Books/demo.epub',
      metadata: {
        title: '旧书名',
        author: '作者',
        chapterCount: 3,
      },
    });

    await service.saveBook(book);
    const renamed = await service.updateBookDisplayTitle({
      ...book,
      metadata: {
        ...book.metadata,
        title: '新书名',
      },
    });

    expect(renamed.metadata.title).toBe('新书名');
    const reloaded = await service.findBookByFilePath('Books/demo.epub');
    expect(reloaded?.metadata.title).toBe('新书名');
  });

  it('does not restore bookshelf membership when saving book state after removing it from the bookshelf', async () => {
    const { app, files } = createMemoryApp({}, ['Books/demo.epub']);

    const service = new EpubStorageService(app);
    await service.scanVaultBooks();
    await service.addBooksToBookshelf(['Books/demo.epub']);
    await service.removeFromBookshelfByFilePath('Books/demo.epub', { purgeCache: true });

    await service.saveBook(createBook({
      id: 'book-2',
      filePath: 'Books/demo.epub',
    }));

    const localData = readLocalEpubData(files);

    await expect(service.loadBookshelfMembership()).resolves.toEqual([]);
    await expect(service.listBookshelfEntries()).resolves.toEqual([]);
    expect(localData.bookshelfMembership).toEqual([]);
    expect(await service.loadScanIndex()).toEqual([
      expect.objectContaining({
        path: 'Books/demo.epub',
      }),
    ]);
    const books = await service.loadBooks({ hydrateStates: false });
    expect(Object.keys(books)).toContain('book-2');
    expect(books['book-2']?.filePath).toBe('Books/demo.epub');
  });

  it('does not let another storage instance rewrite stale bookshelf membership back into unified local data', async () => {
    const { app, files } = createMemoryApp({}, ['Books/demo.epub']);

    const serviceA = new EpubStorageService(app);
    const serviceB = new EpubStorageService(app);

    await serviceA.scanVaultBooks();
    await serviceA.addBooksToBookshelf(['Books/demo.epub']);
    await expect(serviceB.loadBookshelfMembership()).resolves.toEqual([
      expect.objectContaining({ path: 'Books/demo.epub' }),
    ]);

    await serviceA.removeFromBookshelfByFilePath('Books/demo.epub', { purgeCache: true });
    await serviceB.scanVaultBooks();

    const reloadedService = new EpubStorageService(app);
    const localData = readLocalEpubData(files);

    await expect(reloadedService.loadBookshelfMembership()).resolves.toEqual([]);
    await expect(reloadedService.listBookshelfEntries()).resolves.toEqual([]);
    expect(localData.bookshelfMembership).toEqual([]);
  });

  it('persists bookshelf custom cover paths across reload', async () => {
    const { app, files } = createMemoryApp({}, ['Books/demo.epub', 'Assets/cover.png']);
    const service = new EpubStorageService(app);

    await service.addBooksToBookshelf(['Books/demo.epub']);
    await expect(service.setBookshelfCustomCover('Books/demo.epub', 'Assets/cover.png')).resolves.toBe(true);

    await expect(service.loadBookshelfMembership()).resolves.toEqual([
      expect.objectContaining({
        path: 'Books/demo.epub',
        customCoverPath: 'Assets/cover.png',
      }),
    ]);

    const reloadedService = new EpubStorageService(app);
    await expect(reloadedService.loadBookshelfMembership()).resolves.toEqual([
      expect.objectContaining({
        path: 'Books/demo.epub',
        customCoverPath: 'Assets/cover.png',
      }),
    ]);
    expect(readLocalEpubData(files).bookshelfMembership).toEqual([
      expect.objectContaining({
        path: 'Books/demo.epub',
        customCoverPath: 'Assets/cover.png',
      }),
    ]);
  });

  it('merges duplicate bookshelf membership rows without dropping custom cover paths', async () => {
    const { app } = createMemoryApp({
      [LOCAL_EPUB_DATA_PATH]: JSON.stringify({
        version: 1,
        updatedAt: 1710000000000,
        bookshelfMembership: [
          {
            path: 'Books/demo.epub',
            addedAt: 200,
          },
          {
            path: 'Books/demo.epub',
            addedAt: 100,
            customCoverPath: 'Assets/cover.png',
          },
        ],
      }),
    }, ['Books/demo.epub', 'Assets/cover.png']);

    const service = new EpubStorageService(app);
    await expect(service.loadBookshelfMembership()).resolves.toEqual([
      {
        path: 'Books/demo.epub',
        addedAt: 100,
        customCoverPath: 'Assets/cover.png',
      },
    ]);
  });

  it('removes stale legacy membership file and keeps explicit empty unified membership authoritative on migration', async () => {
    const membershipPath = `${SYNC_EPUB_ROOT}/bookshelf-membership.json`;
    const { app, files } = createMemoryApp({
      [membershipPath]: JSON.stringify([
        {
          path: 'Books/demo.epub',
          addedAt: 100,
        },
      ]),
    }, ['Books/demo.epub']);

    const service = new EpubStorageService(app);
    await expect(service.loadBookshelfMembership()).resolves.toEqual([
      expect.objectContaining({ path: 'Books/demo.epub' }),
    ]);

    await service.saveBookshelfMembership([]);

    expect(files.has(membershipPath)).toBe(false);

    const reloadedService = new EpubStorageService(app);
    await reloadedService.migrateLegacyLocalData();

    await expect(reloadedService.loadBookshelfMembership()).resolves.toEqual([]);
    await expect(reloadedService.listBookshelfEntries()).resolves.toEqual([]);
    expect(readLocalEpubData(files).bookshelfMembership).toEqual([]);
  });

  it('updates scan index and membership paths when an EPUB file is renamed', async () => {
    const scanIndexPath = `${SYNC_EPUB_ROOT}/epub-scan-index.json`;
    const membershipPath = `${SYNC_EPUB_ROOT}/bookshelf-membership.json`;
    const booksPath = `${SYNC_EPUB_ROOT}/books.json`;
    const { app, files } = createMemoryApp({
      [scanIndexPath]: JSON.stringify([
        {
          path: 'Books/old.epub',
          name: 'old',
          folder: 'Books',
          size: 1024,
          mtime: 0,
        },
      ]),
      [membershipPath]: JSON.stringify([
        {
          path: 'Books/old.epub',
          addedAt: 10,
        },
      ]),
      [booksPath]: JSON.stringify({
        'book-1': createBook({ filePath: 'Books/old.epub' }),
      }),
    }, ['Books/new.epub']);

    const service = new EpubStorageService(app);
    const updated = await service.updateBookFileReferences('Books/old.epub', 'Books/new.epub');
    const localData = readLocalEpubData(files);
    const scanIndex = readLocalScanIndex(files);

    expect(updated).toBe(1);
    expect(scanIndex).toEqual([
      {
        path: 'Books/new.epub',
        name: 'new',
        folder: 'Books',
        size: 1024,
        mtime: 0,
      },
    ]);
    expect(localData.bookshelfMembership).toEqual([
      {
        path: 'Books/new.epub',
        addedAt: 10,
      },
    ]);
    const book = await service.findBookByFilePath('Books/new.epub');
    expect(book?.filePath).toBe('Books/new.epub');
    expect(book?.id).toBeTruthy();
  });

  it('removes book cache and bookshelf index by file path for reimport', async () => {
    const booksPath = `${SYNC_EPUB_ROOT}/books.json`;
    const scanIndexPath = `${SYNC_EPUB_ROOT}/epub-scan-index.json`;
    const membershipPath = `${SYNC_EPUB_ROOT}/bookshelf-membership.json`;
    const { app, files } = createMemoryApp({
      [booksPath]: JSON.stringify({
        'book-1': createBook(),
      }),
      [scanIndexPath]: JSON.stringify([
        {
          path: 'Books/demo.epub',
          name: 'demo',
          folder: 'Books',
          size: 1024,
          mtime: 0,
        },
      ]),
      [membershipPath]: JSON.stringify([
        {
          path: 'Books/demo.epub',
          addedAt: 100,
        },
      ]),
      [`${LOCAL_EPUB_STATE_ROOT}/book-1/state.json`]: JSON.stringify({
        currentPosition: {
          chapterIndex: 2,
          cfi: '/6/8',
          percent: 66,
        },
        readingStats: {
          totalReadTime: 10,
          lastReadTime: 999,
          createdTime: 50,
        },
      }),
    }, ['Books/demo.epub']);

    const service = new EpubStorageService(app);
    const result = await service.removeBookByFilePath('Books/demo.epub');
    const localData = readLocalEpubData(files);
    const reloadedService = new EpubStorageService(app);

    expect(result.removedBookId).toMatch(/^epub-book-/);
    expect(files.has(booksPath)).toBe(false);
    expect(files.has(scanIndexPath)).toBe(false);
    expect(readLocalScanIndex(files)).toEqual([
      {
        path: 'Books/demo.epub',
        name: 'demo',
        folder: 'Books',
        size: 1024,
        mtime: 0,
      },
    ]);
    expect(localData.bookCatalogStoredLocally).toBe(true);
    expect(localData.books || {}).toEqual({});
    expect(localData.bookshelfMembership).toEqual([]);
    expect(files.has(`${LOCAL_EPUB_STATE_ROOT}/book-1/state.json`)).toBe(false);
    await expect(reloadedService.getBook('book-1')).resolves.toBeNull();
  });

  it('deletes the tracked book file and cleans associated epub state', async () => {
    const booksPath = `${SYNC_EPUB_ROOT}/books.json`;
    const scanIndexPath = `${SYNC_EPUB_ROOT}/epub-scan-index.json`;
    const membershipPath = `${SYNC_EPUB_ROOT}/bookshelf-membership.json`;
    const sourceRegistryPath = `${SYNC_EPUB_ROOT}/epub-source-registry.json`;
    const { app, files, vaultFiles } = createMemoryApp({
      [booksPath]: JSON.stringify({
        'book-1': createBook({ sourceId: 'epubsrc-demo' }),
      }),
      [scanIndexPath]: JSON.stringify([
        {
          path: 'Books/demo.epub',
          name: 'demo',
          folder: 'Books',
          size: 1024,
          mtime: 0,
        },
      ]),
      [membershipPath]: JSON.stringify([
        {
          path: 'Books/demo.epub',
          addedAt: 100,
        },
      ]),
      [sourceRegistryPath]: JSON.stringify([
        {
          sourceId: 'epubsrc-demo',
          filePath: 'Books/demo.epub',
          sourceFingerprint: 'fingerprint-demo',
          sourceSize: 1024,
          sourceMtime: 1710000000000,
          lastSeenAt: 1710000000000,
        },
      ]),
      [`${LOCAL_EPUB_STATE_ROOT}/book-1/state.json`]: JSON.stringify({
        currentPosition: {
          chapterIndex: 2,
          cfi: '/6/8',
          percent: 66,
        },
        readingStats: {
          totalReadTime: 10,
          lastReadTime: 999,
          createdTime: 50,
        },
      }),
    }, ['Books/demo.epub'], {
      'Books/demo.epub': 'binary-epub',
    });

    const service = new EpubStorageService(app);
    const result = await service.deleteTrackedBookFile('Books/demo.epub');
    const localData = readLocalEpubData(files);
    const reloadedService = new EpubStorageService(app);

    expect(result.fileDeleted).toBe(true);
    expect(result.deletedFilePath).toBe('Books/demo.epub');
    expect(result.removedBookIds).toHaveLength(1);
    expect(result.removedBookIds[0]).toMatch(/^epub-book-/);
    expect(app.fileManager.trashFile).toHaveBeenCalledTimes(1);
    expect(vaultFiles.has('Books/demo.epub')).toBe(false);
    expect(files.has(scanIndexPath)).toBe(false);
    expect(readLocalScanIndex(files)).toEqual([]);
    expect(await reloadedService.listBookshelfEntries()).toEqual([]);
    expect(localData.books || {}).toEqual({});
    expect(localData.bookshelfMembership).toEqual([]);
    expect(localData.sourceRegistry).toEqual([
      expect.objectContaining({
        sourceId: expect.stringMatching(/^epubsrc-/),
        filePath: '',
        lastKnownPath: 'Books/demo.epub',
      }),
    ]);
    expect(files.has(`${LOCAL_EPUB_STATE_ROOT}/book-1/state.json`)).toBe(false);
    expect(
      Array.from(files.keys()).some((path) => path.startsWith(`${LOCAL_EPUB_STATE_ROOT}/`))
    ).toBe(false);
    await expect(reloadedService.findBookByFilePath('Books/demo.epub')).resolves.toBeNull();
    await expect(reloadedService.listBookshelfEntries()).resolves.toEqual([]);
  });

  it('reuses the same source identity after the same epub is re-added under a new path', async () => {
    const { app, files, vaultFiles } = createMemoryApp({}, ['Books/demo.epub'], {
      'Books/demo.epub': 'same-binary-epub',
      'Library/demo-renamed.epub': 'same-binary-epub',
    });

    const service = new EpubStorageService(app);
    const firstBook = createBook({ filePath: 'Books/demo.epub' });
    await service.saveBook(firstBook);

    const firstSourceId = (await service.findBookByFilePath('Books/demo.epub'))?.sourceId;
    expect(firstSourceId).toBeTruthy();

    vaultFiles.delete('Books/demo.epub');
    vaultFiles.add('Library/demo-renamed.epub');

    await service.pruneMissingBooks();

    const reimportedBook = createBook({
      id: 'book-2',
      filePath: 'Library/demo-renamed.epub',
      readingStats: {
        totalReadTime: 0,
        lastReadTime: 200,
        createdTime: 200,
      },
    });
    await service.saveBook(reimportedBook);

    const reimported = await service.findBookByFilePath('Library/demo-renamed.epub');
    expect(reimported?.sourceId).toBe(firstSourceId);
    await expect(service.resolveSourceFilePath(firstSourceId || '')).resolves.toBe(
      'Library/demo-renamed.epub'
    );
  });

  it('generates a deterministic sourceId from sourceFingerprint for the same epub binary', async () => {
    const binaryContent = 'same-binary-epub';
    const { app } = createMemoryApp({}, ['Books/demo.epub'], {
      'Books/demo.epub': binaryContent,
    });
    const service = new EpubStorageService(app);

    await service.saveBook(createBook({ id: 'book-a' }));

    const savedBook = await service.findBookByFilePath('Books/demo.epub');
    const fingerprintBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(binaryContent)
    );
    const fingerprint = Array.from(new Uint8Array(fingerprintBuffer))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');

    expect(savedBook?.sourceFingerprint).toBe(fingerprint);
    expect(savedBook?.sourceId).toBe(`epubsrc-${fingerprint.slice(0, 24)}`);
  });

  it('replaces ephemeral runtime book ids with a stable book id and reuses it for the same source', async () => {
    const binaryContent = 'same-binary-epub';
    const { app, files } = createMemoryApp({}, ['Books/demo.epub'], {
      'Books/demo.epub': binaryContent,
    });
    const service = new EpubStorageService(app);

    await service.saveBook(createBook({ id: 'epub-ab12cd' }));
    const firstSavedBook = await service.findBookByFilePath('Books/demo.epub');

    await service.saveBook(createBook({ id: 'epub-ef34gh', readingStats: {
      totalReadTime: 0,
      lastReadTime: 200,
      createdTime: 200,
    } }));
    const secondSavedBook = await service.findBookByFilePath('Books/demo.epub');
    const books = await service.loadBooks({ hydrateStates: false });

    expect(firstSavedBook?.id).toMatch(/^epub-book-/);
    expect(secondSavedBook?.id).toBe(firstSavedBook?.id);
    expect(Object.keys(books)).toEqual([firstSavedBook?.id]);
  });

  it('automatically canonicalizes old unified book identities and source registry entries on load', async () => {
    const sourceFingerprint = '4a9ad58db18a2176c9c0f16335a0a7502a4f3a7eaab3af39';
    const legacySourceId = 'epubsrc-randomlegacy';
    const { app, files } = createMemoryApp({
      [LOCAL_EPUB_DATA_PATH]: JSON.stringify({
        version: 1,
        updatedAt: 1,
        bookCatalogStoredLocally: true,
        books: {
          'epub-old-runtime': {
            descriptor: {
              id: 'epub-old-runtime',
              filePath: 'Books/demo.epub',
              sourceId: legacySourceId,
              sourceFingerprint,
              metadata: {
                title: 'Demo',
                author: 'Author',
                chapterCount: 3,
              },
            },
            state: {
              currentPosition: {
                chapterIndex: 1,
                cfi: '/6/4',
                percent: 50,
              },
              readingStats: {
                totalReadTime: 0,
                lastReadTime: 123,
                createdTime: 100,
              },
            },
          },
        },
        canvasBindings: {
          'epub-old-runtime': 'Canvas/demo.canvas',
        },
        sourceRegistry: [
          {
            sourceId: legacySourceId,
            filePath: 'Books/demo.epub',
            sourceFingerprint,
            lastSeenAt: 10,
            lastKnownPath: 'Books/demo.epub',
          },
        ],
      }),
    }, ['Books/demo.epub'], {
      'Books/demo.epub': 'same-binary-epub',
    });

    const service = new EpubStorageService(app);
    const books = await service.loadBooks();
    const canonicalSourceId = `epubsrc-${sourceFingerprint.slice(0, 24)}`;
    const canonicalBookId = Object.keys(books)[0];
    const localData = readLocalEpubData(files);

    expect(canonicalBookId).toMatch(/^epub-book-/);
    expect(books[canonicalBookId]?.sourceId).toBe(canonicalSourceId);
    expect(books[canonicalBookId]?.sourceFingerprint).toBe(sourceFingerprint);
    expect(localData.books?.[canonicalBookId]?.descriptor?.id).toBe(canonicalBookId);
    expect(localData.books?.[canonicalBookId]?.descriptor?.sourceId).toBe(canonicalSourceId);
    expect(localData.books?.['epub-old-runtime']).toBeUndefined();
    expect(localData.canvasBindings).toEqual({
      [canonicalBookId]: 'Canvas/demo.canvas',
    });
    expect(localData.sourceRegistry).toEqual([
      expect.objectContaining({
        sourceId: canonicalSourceId,
        sourceFingerprint,
      }),
    ]);
  });

  it('findBookByFilePath avoids eager batch catalog hydration', async () => {
    const { app, files } = createMemoryApp(
      {
        'Books/demo.epub': 'demo-epub-binary',
      },
      ['Books/demo.epub']
    );
    const service = new EpubStorageService(app);
    await service.addBooksToBookshelf(['Books/demo.epub']);
    const hydrateSpy = vi.spyOn(service as any, 'hydrateBookStates');

    const book = await service.findBookByFilePath('Books/demo.epub');

    expect(book?.filePath).toBe('Books/demo.epub');
    expect(hydrateSpy).not.toHaveBeenCalled();
    hydrateSpy.mockRestore();
    const membership =
      readLocalEpubData(files).bookshelfMembership ||
      (await service.loadBookshelfMembership());
    expect(membership?.length).toBeGreaterThan(0);
  });

  it('persists bookshelf cover image in scan index', async () => {
    const { app } = createMemoryApp(
      {
        'Books/demo.epub': 'demo-epub-binary',
      },
      ['Books/demo.epub']
    );
    const service = new EpubStorageService(app);

    await service.addBooksToBookshelf(['Books/demo.epub']);
    await service.cacheBookshelfCoverImage('Books/demo.epub', 'blob:cached-cover');

    const scanEntries = await service.loadScanIndex();
    expect(scanEntries.find((entry) => entry.path === 'Books/demo.epub')?.coverImage).toBe(
      'blob:cached-cover'
    );
  });

  it('persists bookshelf search query in plugin ui memory across reloads', async () => {
    const { app, files } = createMemoryApp();
    const service = new EpubStorageService(app);

    await service.saveBookshelfSearchQuery('author:"鲍曼"');
    expect(readLocalEpubData(files).uiMemory?.bookshelfSearchQuery).toBe('author:"鲍曼"');

    const reloaded = new EpubStorageService(app);
    await expect(reloaded.loadBookshelfSearchQuery()).resolves.toBe('author:"鲍曼"');

    await reloaded.saveBookshelfSearchQuery('   ');
    expect(readLocalEpubData(files).uiMemory?.bookshelfSearchQuery).toBe('');
    await expect(reloaded.loadBookshelfSearchQuery()).resolves.toBe('');
  });

  it('waits for in-flight automatic migrations before concurrent loadBooks calls proceed', async () => {
    const { app } = createMemoryApp(
      {
        [LOCAL_EPUB_DATA_PATH]: JSON.stringify({
          version: 1,
          updatedAt: 1,
          bookCatalogStoredLocally: true,
          bookshelfMembership: [{ path: 'Books/demo.epub', addedAt: 1 }],
          books: {},
        }),
      },
      ['Books/demo.epub'],
      { 'Books/demo.epub': 'demo-epub-binary' }
    );
    const service = new EpubStorageService(app);
    let releaseMigration!: () => void;
    const migrationGate = new Promise<void>((resolve) => {
      releaseMigration = resolve;
    });
    const reconcileSpy = vi
      .spyOn(service as unknown as { reconcileMissingBookshelfDescriptors: () => Promise<void> }, 'reconcileMissingBookshelfDescriptors')
      .mockImplementationOnce(async () => {
        await migrationGate;
      });

    const firstLoad = service.loadBooks({ hydrateStates: false });
    await Promise.resolve();
    const secondLoad = service.loadBooks({ hydrateStates: false });

    expect((service as unknown as { automaticMigrationCompleted: boolean }).automaticMigrationCompleted).toBe(
      false
    );

    releaseMigration();
    await Promise.all([firstLoad, secondLoad]);

    expect(reconcileSpy).toHaveBeenCalledTimes(1);
    expect((service as unknown as { automaticMigrationCompleted: boolean }).automaticMigrationCompleted).toBe(
      true
    );
    reconcileSpy.mockRestore();
  });

  it('reconciles missing bookshelf descriptors from bookmark files without mass writeBookState', async () => {
    const bookPath = 'Books/shelf-only.epub';
    const orphanId = 'epub-abc123';
    const { app, files } = createMemoryApp(
      {
        [LOCAL_EPUB_DATA_PATH]: JSON.stringify({
          version: 1,
          updatedAt: 1,
          bookCatalogStoredLocally: true,
          bookshelfMembership: [{ path: bookPath, addedAt: 1 }],
          books: {
            [orphanId]: {
              readingReferencePoint: {
                chapterIndex: 2,
                cfi: '/6/4',
                percent: 33,
                title: 'Ch2',
                savedAt: 1000,
              },
            },
          },
        }),
      },
      [bookPath],
      { [bookPath]: 'epub-binary-content' }
    );
    const service = new EpubStorageService(app);
    const bookmarkService = (service as unknown as { getBookmarkService: () => unknown }).getBookmarkService() as {
      findBookmarkSnapshotByBookPath: (path: string) => Promise<Record<string, unknown> | null>;
      readBookmarkSnapshotForBook: () => Promise<null>;
    };
    vi.spyOn(bookmarkService, 'readBookmarkSnapshotForBook').mockResolvedValue(null);
    vi.spyOn(bookmarkService, 'findBookmarkSnapshotByBookPath').mockImplementation(async (path) => {
      if (path !== bookPath) {
        return null;
      }
      return {
        format: 'weave-epub-bookmarks/v2',
        stableKey: 'epub-orphan01',
        bookId: orphanId,
        bookPath,
        bookTitle: 'Shelf Book',
        bookAuthor: 'Author',
        readingState: {
          currentPosition: {
            chapterIndex: 2,
            cfi: '/6/4',
            percent: 33,
          },
          readingStats: {
            totalReadTime: 0,
            lastReadTime: 1000,
            createdTime: 500,
          },
        },
      };
    });
    const writeBookStateSpy = vi.spyOn(
      service as unknown as { writeBookState: (...args: unknown[]) => Promise<void> },
      'writeBookState'
    );
    const writeBooksWithLockSpy = vi.spyOn(
      service as unknown as { writeBooksWithLock: (...args: unknown[]) => Promise<void> },
      'writeBooksWithLock'
    );

    const books = await service.loadBooks({ hydrateStates: true });
    const localData = readLocalEpubData(files);
    const catalogIds = Object.keys(books);

    expect(catalogIds).toHaveLength(1);
    expect(localData.books?.[orphanId]).toBeUndefined();
    expect(books[catalogIds[0]]?.filePath).toBe(bookPath);
    expect(books[catalogIds[0]]?.currentPosition.percent).toBe(33);
    expect(writeBooksWithLockSpy).not.toHaveBeenCalled();
    expect(writeBookStateSpy).not.toHaveBeenCalled();

    writeBookStateSpy.mockRestore();
    writeBooksWithLockSpy.mockRestore();
  });

  it('loads reading progress from bookmark files via book hint before catalog materialization', async () => {
    const bookPath = 'Books/demo.epub';
    const { app } = createMemoryApp({}, [bookPath]);
    const service = new EpubStorageService(app);
    const bookmarkService = (service as unknown as { getBookmarkService: () => unknown }).getBookmarkService() as {
      readReadingStateByBookPath: (path: string) => Promise<{
        currentPosition: { chapterIndex: number; cfi: string; percent: number };
        readingStats: { totalReadTime: number; lastReadTime: number; createdTime: number };
      } | null>;
    };
    vi.spyOn(bookmarkService, 'readReadingStateByBookPath').mockImplementation(async (path) => {
      if (path !== bookPath) {
        return null;
      }
      return {
        currentPosition: {
          chapterIndex: 1,
          cfi: '/6/6',
          percent: 42,
        },
        readingStats: {
          totalReadTime: 0,
          lastReadTime: 100,
          createdTime: 50,
        },
      };
    });
    const bookHint = createBook({
      id: 'epub-temp01',
      filePath: bookPath,
      currentPosition: { chapterIndex: 0, cfi: '', percent: 0 },
    });

    const progress = await service.loadProgress('epub-temp01', bookHint);

    expect(progress?.percent).toBe(42);
    expect(progress?.cfi).toBe('/6/6');
  });

  it('stores paragraph mode positions in plugin cache and migrates legacy vault markdown', async () => {
    const legacyPath = `${SYNC_EPUB_ROOT}/paragraph-mode-positions.md`;
    const legacyMarkdown = [
      '# EPUB Paragraph Mode Positions',
      '',
      '<!-- weave-epub-paragraph-mode-v1 -->',
      '',
      '## book-1',
      '```json',
      JSON.stringify(
        {
          bookId: 'book-1',
          filePath: 'Books/demo.epub',
          bookTitle: 'Demo',
          chapterTitle: 'Chapter 1',
          chapterHref: 'chapter-1.xhtml',
          chapterIndex: 1,
          cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:10)',
          percent: 12,
          paragraphId: '1:0:abc',
          paragraphIndex: 0,
          paragraphTextPreview: 'Preview text',
          savedAt: 1234567890,
        },
        null,
        2
      ),
      '```',
      '',
    ].join('\n');

    const { app, files } = createMemoryApp({
      [legacyPath]: legacyMarkdown,
    });
    const service = new EpubStorageService(app);

    const loaded = await service.loadParagraphModeReadingPosition('book-1');

    expect(loaded?.cfi).toBe('epubcfi(/6/4!/4/2,/1:0,/1:10)');
    expect(files.has(LOCAL_EPUB_PARAGRAPH_MODE_POSITIONS_PATH)).toBe(true);
    expect(files.has(legacyPath)).toBe(false);

    await service.saveParagraphModeReadingPosition({
      bookId: 'book-1',
      filePath: 'Books/demo.epub',
      bookTitle: 'Demo',
      chapterTitle: 'Chapter 2',
      chapterHref: 'chapter-2.xhtml',
      chapterIndex: 2,
      cfi: 'epubcfi(/6/6!/4/2,/1:0,/1:10)',
      percent: 24,
      paragraphId: '2:0:def',
      paragraphIndex: 0,
      paragraphTextPreview: 'Updated preview',
      savedAt: 2234567890,
    });

    const updated = await service.loadParagraphModeReadingPosition('book-1');
    expect(updated?.chapterTitle).toBe('Chapter 2');
    expect(JSON.parse(files.get(LOCAL_EPUB_PARAGRAPH_MODE_POSITIONS_PATH) || '{}').version).toBe(1);
  });

  it('stores paragraph mode positions when configDir is an absolute Windows path', async () => {
    const legacyPath = `${SYNC_EPUB_ROOT}/paragraph-mode-positions.md`;
    const legacyMarkdown = [
      '## book-absolute',
      '```json',
      JSON.stringify(
        {
          bookId: 'book-absolute',
          filePath: 'Books/demo.epub',
          bookTitle: 'Demo',
          chapterTitle: 'Chapter 1',
          chapterHref: 'chapter-1.xhtml',
          chapterIndex: 1,
          cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:10)',
          percent: 12,
          paragraphId: '1:0:abc',
          paragraphIndex: 0,
          paragraphTextPreview: 'Preview text',
          savedAt: 1234567890,
        },
        null,
        2
      ),
      '```',
      '',
    ].join('\n');

    const { app, files } = createMemoryApp({
      [legacyPath]: legacyMarkdown,
    });
    app.vault.configDir = 'C:/Users/test/vault/.obsidian';

    const service = new EpubStorageService(app);
    const loaded = await service.loadParagraphModeReadingPosition('book-absolute');

    expect(loaded?.cfi).toBe('epubcfi(/6/4!/4/2,/1:0,/1:10)');
    expect(files.has(LOCAL_EPUB_PARAGRAPH_MODE_POSITIONS_PATH)).toBe(true);
    expect(files.has(legacyPath)).toBe(false);
  });
});
