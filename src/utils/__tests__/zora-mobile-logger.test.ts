import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	getLogFilePath,
	ensureLogDirectoryExists,
	initMobileDiagnostics,
	logMobileEvent,
	logMobileError,
	flushLogWriteQueue,
} from "../zora-mobile-logger";
import type { App } from "obsidian";

describe("zora-mobile-logger", () => {
	let mockAdapter: any;
	let mockApp: App;

	beforeEach(() => {
		mockAdapter = {
			exists: vi.fn(),
			mkdir: vi.fn(),
			stat: vi.fn(),
			read: vi.fn(),
			write: vi.fn(),
			append: vi.fn(),
		};
		mockApp = {
			vault: {
				adapter: mockAdapter,
				configDir: ".obsidian",
			},
		} as unknown as App;
	});

	it("1. getLogFilePath returns Zora Reader/debug/mobile-debug.log", () => {
		expect(getLogFilePath()).toBe("Zora Reader/debug/mobile-debug.log");
	});

	it("2. creates Zora Reader and debug directory if neither exists", async () => {
		mockAdapter.exists.mockResolvedValue(false);
		mockAdapter.mkdir.mockResolvedValue(undefined);

		const result = await ensureLogDirectoryExists(mockAdapter);

		expect(result).toBe(true);
		expect(mockAdapter.exists).toHaveBeenCalledWith("Zora Reader");
		expect(mockAdapter.mkdir).toHaveBeenCalledWith("Zora Reader");
		expect(mockAdapter.exists).toHaveBeenCalledWith("Zora Reader/debug");
		expect(mockAdapter.mkdir).toHaveBeenCalledWith("Zora Reader/debug");
	});

	it("3. creates only debug directory if Zora Reader already exists", async () => {
		mockAdapter.exists.mockImplementation((path: string) => {
			if (path === "Zora Reader") return Promise.resolve(true);
			if (path === "Zora Reader/debug") return Promise.resolve(false);
			return Promise.resolve(false);
		});
		mockAdapter.mkdir.mockResolvedValue(undefined);

		const result = await ensureLogDirectoryExists(mockAdapter);

		expect(result).toBe(true);
		expect(mockAdapter.mkdir).not.toHaveBeenCalledWith("Zora Reader");
		expect(mockAdapter.mkdir).toHaveBeenCalledWith("Zora Reader/debug");
	});

	it("4. does not call mkdir if both directories already exist", async () => {
		mockAdapter.exists.mockResolvedValue(true);

		const result = await ensureLogDirectoryExists(mockAdapter);

		expect(result).toBe(true);
		expect(mockAdapter.mkdir).not.toHaveBeenCalled();
	});

	it("5. safe failover if mkdir throws error", async () => {
		mockAdapter.exists.mockResolvedValue(false);
		mockAdapter.mkdir.mockRejectedValue(new Error("Permission denied"));

		const result = await ensureLogDirectoryExists(mockAdapter);

		expect(result).toBe(false);
	});

	it("6. writeLogEntry writes to Zora Reader/debug/mobile-debug.log when file does not exist", async () => {
		mockAdapter.exists.mockImplementation((path: string) => {
			if (path === "Zora Reader" || path === "Zora Reader/debug") return Promise.resolve(true);
			if (path === "Zora Reader/debug/mobile-debug.log") return Promise.resolve(false);
			return Promise.resolve(false);
		});
		mockAdapter.write.mockResolvedValue(undefined);

		initMobileDiagnostics(mockApp);
		await flushLogWriteQueue();
		mockAdapter.write.mockClear();

		logMobileEvent("DirectSelection", "GestureClassified", { targetTag: "p", gestureKind: "text-selection" });
		await flushLogWriteQueue();

		expect(mockAdapter.write).toHaveBeenCalled();
		const writtenPath = mockAdapter.write.mock.calls[0][0];
		const writtenContent = mockAdapter.write.mock.calls[0][1];

		expect(writtenPath).toBe("Zora Reader/debug/mobile-debug.log");
		expect(writtenContent).toContain("[DirectSelection] GestureClassified");
		expect(writtenContent).toContain('"gestureKind":"text-selection"');
	});

	it("7. writeLogEntry appends to existing log file under 500KB limit", async () => {
		mockAdapter.exists.mockResolvedValue(true);
		mockAdapter.stat.mockResolvedValue({ size: 1024 });
		mockAdapter.append.mockResolvedValue(undefined);

		initMobileDiagnostics(mockApp);
		await flushLogWriteQueue();
		mockAdapter.append.mockClear();

		logMobileEvent("Reader", "PageTurn", { direction: "next" });
		await flushLogWriteQueue();

		expect(mockAdapter.append).toHaveBeenCalled();
		const appendPath = mockAdapter.append.mock.calls[0][0];
		const appendContent = mockAdapter.append.mock.calls[0][1];

		expect(appendPath).toBe("Zora Reader/debug/mobile-debug.log");
		expect(appendContent).toContain("[Reader] PageTurn");
	});

	it("8. rotates log file when size exceeds 500KB limit", async () => {
		mockAdapter.exists.mockResolvedValue(true);
		mockAdapter.stat.mockResolvedValue({ size: 600 * 1024 }); // > 500KB
		mockAdapter.read.mockResolvedValue("Previous long log content...\nLine 1\nLine 2\n");
		mockAdapter.write.mockResolvedValue(undefined);

		initMobileDiagnostics(mockApp);
		await flushLogWriteQueue();
		mockAdapter.write.mockClear();

		logMobileError("EpubEngine", new Error("Parse error"));
		await flushLogWriteQueue();

		expect(mockAdapter.write).toHaveBeenCalled();
		const writePath = mockAdapter.write.mock.calls[0][0];
		const writeContent = mockAdapter.write.mock.calls[0][1];

		expect(writePath).toBe("Zora Reader/debug/mobile-debug.log");
		expect(writeContent).toContain("--- Log rotated ---");
		expect(writeContent).toContain("Parse error");
	});

	it("9. logs VAULT_EVENT for normal vault files but completely drops VAULT_EVENT for mobile-debug.log", async () => {
		mockAdapter.exists.mockResolvedValue(true);
		mockAdapter.stat.mockResolvedValue({ size: 1024 });
		mockAdapter.append.mockResolvedValue(undefined);

		initMobileDiagnostics(mockApp);
		await flushLogWriteQueue();
		mockAdapter.append.mockClear();

		// 1) Normal vault file modify -> should write
		logMobileEvent("VAULT_EVENT", "modify", { path: "Notes/ReadingNote.md", triggeredRescan: true });
		await flushLogWriteQueue();

		expect(mockAdapter.append).toHaveBeenCalledTimes(1);
		expect(mockAdapter.append.mock.calls[0][1]).toContain("Notes/ReadingNote.md");
		mockAdapter.append.mockClear();

		// 2) Other debug directory files -> SHOULD write (only mobile-debug.log is filtered)
		logMobileEvent("VAULT_EVENT", "modify", { path: "Zora Reader/debug/test.log", triggeredRescan: false });
		await flushLogWriteQueue();

		expect(mockAdapter.append).toHaveBeenCalledTimes(1);
		expect(mockAdapter.append.mock.calls[0][1]).toContain("Zora Reader/debug/test.log");
		mockAdapter.append.mockClear();

		logMobileEvent("VAULT_EVENT", "create", { path: "Zora Reader/debug/gesture-debug.json", triggeredRescan: false });
		await flushLogWriteQueue();

		expect(mockAdapter.append).toHaveBeenCalledTimes(1);
		expect(mockAdapter.append.mock.calls[0][1]).toContain("Zora Reader/debug/gesture-debug.json");
		mockAdapter.append.mockClear();

		// 3) Exact self log file modify -> MUST BE DROPPED (0 writes)
		logMobileEvent("VAULT_EVENT", "modify", { path: "Zora Reader/debug/mobile-debug.log", triggeredRescan: false });
		await flushLogWriteQueue();

		expect(mockAdapter.append).not.toHaveBeenCalled();

		// 4) Other event on exact log path with filePath property -> MUST BE DROPPED (0 writes)
		logMobileEvent("VAULT_EVENT", "create", { filePath: "Zora Reader/debug/mobile-debug.log" });
		await flushLogWriteQueue();

		expect(mockAdapter.append).not.toHaveBeenCalled();
	});

	it("10. writing log does not trigger second append when simulated vault modify fires on debug log", async () => {
		mockAdapter.exists.mockResolvedValue(true);
		mockAdapter.stat.mockResolvedValue({ size: 1024 });

		let appendCount = 0;
		mockAdapter.append.mockImplementation(async (path: string) => {
			appendCount++;
			if (path === "Zora Reader/debug/mobile-debug.log") {
				// Simulates Obsidian vault listener firing 'modify' event when log file is written
				logMobileEvent("VAULT_EVENT", "modify", { path, triggeredRescan: false });
			}
		});

		initMobileDiagnostics(mockApp);
		await flushLogWriteQueue();
		mockAdapter.append.mockClear();
		appendCount = 0;

		// Initial user event
		logMobileEvent("DirectSelection", "TapWordSelected", { word: "hello" });
		await flushLogWriteQueue();

		// MUST ONLY BE 1 APPEND! Recursion was stopped dead at layer 2!
		expect(appendCount).toBe(1);
		expect(mockAdapter.append).toHaveBeenCalledTimes(1);
	});
});
