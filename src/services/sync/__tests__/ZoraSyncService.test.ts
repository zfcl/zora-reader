import { describe, it, expect, beforeEach, vi } from "vitest";
import { ZoraSyncService } from "../ZoraSyncService";
import { runZoraSyncV2Migration } from "../zora-sync-migration";

describe("ZoraSyncService", () => {
	let memoryFs: Record<string, string> = {};
	let mockApp: any;
	let syncService: ZoraSyncService;

	beforeEach(() => {
		memoryFs = {};
		mockApp = {
			vault: {
				adapter: {
					exists: vi.fn(async (path: string) => Object.prototype.hasOwnProperty.call(memoryFs, path)),
					read: vi.fn(async (path: string) => {
						if (!Object.prototype.hasOwnProperty.call(memoryFs, path)) {
							throw new Error(`File not found: ${path}`);
						}
						return memoryFs[path];
					}),
					write: vi.fn(async (path: string, data: string) => {
						memoryFs[path] = data;
					}),
					remove: vi.fn(async (path: string) => {
						delete memoryFs[path];
					}),
					list: vi.fn(async (dir: string) => {
						const prefix = dir.endsWith("/") ? dir : `${dir}/`;
						const files = Object.keys(memoryFs).filter((k) => k.startsWith(prefix));
						return { files, folders: [] };
					}),
				},
				on: vi.fn(() => ({})),
				offref: vi.fn(),
			},
		};
		syncService = new ZoraSyncService(mockApp);
	});

	it("computes deterministic SHA-256 Book ID from bytes", async () => {
		const bytes = new TextEncoder().encode("EPUB content bytes test");
		const bookId1 = await syncService.computeBookIdFromBytes(bytes);
		const bookId2 = await syncService.computeBookIdFromBytes(bytes);
		expect(bookId1).toBe(bookId2);
		expect(bookId1.length).toBe(64); // SHA-256 hex length
	});

	it("saves and resolves latest progress across multiple devices", async () => {
		const bookId = "test-book-sha256-abc";

		// Device 1 saves progress at t=100
		await syncService.saveProgress(bookId, {
			cfi: "epubcfi(/6/2!/4/2/1:0)",
			percentage: 0.25,
			chapterIndex: 1,
			chapterTitle: "Chapter 1",
		});

		const dev1Progress = await syncService.loadLatestProgress(bookId);
		expect(dev1Progress?.percentage).toBe(0.25);
		expect(dev1Progress?.cfi).toBe("epubcfi(/6/2!/4/2/1:0)");

		// Simulate Device 2 saving progress with later timestamp
		const dev2Payload = {
			bookId,
			deviceId: "ios-phone-1234",
			cfi: "epubcfi(/6/4!/4/2/1:0)",
			percentage: 0.60,
			chapterIndex: 3,
			chapterTitle: "Chapter 3",
			updatedAt: new Date(Date.now() + 10000).toISOString(),
		};
		memoryFs[`Zora Reader/Sync/books/${bookId}/progress/ios-phone-1234.json`] = JSON.stringify(dev2Payload);

		const latestProgress = await syncService.loadLatestProgress(bookId);
		expect(latestProgress?.deviceId).toBe("ios-phone-1234");
		expect(latestProgress?.percentage).toBe(0.60);
		expect(latestProgress?.chapterIndex).toBe(3);
	});

	it("saves, loads, and deletes annotations with tombstones", async () => {
		const bookId = "test-book-ann-123";

		const ann1 = await syncService.saveAnnotation({
			id: "ann-001",
			bookId,
			cfiRange: "epubcfi(/6/2!/4/2/1:0,/6/2!/4/2/1:10)",
			type: "highlight",
			color: "yellow",
			text: "sample highlight text",
		});

		const ann2 = await syncService.saveAnnotation({
			id: "ann-002",
			bookId,
			cfiRange: "epubcfi(/6/2!/4/2/1:20,/6/2!/4/2/1:30)",
			type: "underline",
			color: "blue",
			text: "second text",
		});

		let list = await syncService.loadAnnotations(bookId);
		expect(list.length).toBe(2);

		// Delete ann1
		await syncService.deleteAnnotation(bookId, "ann-001");

		list = await syncService.loadAnnotations(bookId);
		expect(list.length).toBe(1);
		expect(list[0].id).toBe("ann-002");

		// Check tombstone exists
		expect(memoryFs[`Zora Reader/Sync/books/${bookId}/tombstones/ann-001.json`]).toBeDefined();
	});

	it("saves, loads, and deletes notes with tombstones", async () => {
		const bookId = "test-book-note-456";

		await syncService.saveNote({
			id: "note-001",
			bookId,
			cfiRange: "epubcfi(/6/2!/4/2/1:0,/6/2!/4/2/1:10)",
			type: "reading-note",
			content: "My thoughts on this passage",
			selectedText: "quote",
		});

		let notes = await syncService.loadNotes(bookId);
		expect(notes.length).toBe(1);
		expect(notes[0].content).toBe("My thoughts on this passage");

		await syncService.deleteNote(bookId, "note-001");
		notes = await syncService.loadNotes(bookId);
		expect(notes.length).toBe(0);
	});

	it("migrates legacy epub-local-state.json idempotently without modifying original", async () => {
		const legacyState = {
			books: {
				"legacy-book-id-1": {
					title: "Test Novel",
					author: "Author A",
					filePath: "Books/Test Novel.epub",
					state: {
						currentPosition: {
							cfi: "epubcfi(/6/2!/4/2/1:50)",
							percent: 0.45,
							chapterIndex: 2,
						},
					},
					directHighlights: [
						{
							cfiRange: "epubcfi(/6/2!/4/2/1:0,/6/2!/4/2/1:20)",
							color: "green",
							style: "highlight",
							text: "migrated highlight",
							createdTime: Date.now(),
						},
					],
				},
			},
		};

		memoryFs[".obsidian/plugins/zora-reader/state/epub-local-state.json"] = JSON.stringify(legacyState);

		const record = await runZoraSyncV2Migration(mockApp);
		expect(record.version).toBe(2);
		expect(record.counts.progress).toBe(1);
		expect(record.counts.highlights).toBe(1);

		// Ensure original legacy file was untouched
		expect(memoryFs[".obsidian/plugins/zora-reader/state/epub-local-state.json"]).toBe(JSON.stringify(legacyState));

		// Second run is idempotent (0 new items)
		const record2 = await runZoraSyncV2Migration(mockApp);
		expect(record2.counts.progress).toBe(1);
	});
});
