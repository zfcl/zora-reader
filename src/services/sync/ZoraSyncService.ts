import { type App, type EventRef, Platform, normalizePath, TFile } from "obsidian";
import { DirectoryUtils } from "../../utils/directory-utils";
import { generateCardUUID } from "../identifier/WeaveIDGenerator";
import { logger } from "../../utils/logger";
import { logMobileEvent, logMobileSyncDebug } from "../../utils/zora-mobile-logger";
import type {
	SyncAnnotation,
	SyncBookMeta,
	SyncBookmark,
	SyncDiagnostics,
	SyncMigrationV2Record,
	SyncNote,
	SyncProgress,
	SyncTombstone,
} from "./ZoraSyncTypes";

const SYNC_ROOT = "Zora Reader/Sync";
const BOOKS_DIR = `${SYNC_ROOT}/books`;
const MIGRATION_RECORD_PATH = `${SYNC_ROOT}/migration-v2.json`;

let fallbackGlobalDeviceId: string | null = null;

let syncServiceInstance: ZoraSyncService | null = null;

export class ZoraSyncService {
	private app: App;
	private deviceId: string;
	private activeBookId: string | null = null;
	private activeBookFilePath: string | null = null;
	private syncListeners = new Set<(bookId: string) => void>();
	private vaultEventRefs: EventRef[] = [];
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private periodicTimer: ReturnType<typeof setInterval> | null = null;
	private visibilityHandler: (() => void) | null = null;
	private lastScanTime: number = 0;
	private lastScanError: string | null = null;
	private knownDirFingerprint: string | null = null;

	constructor(app: App) {
		this.app = app;
		this.deviceId = this.resolveDeviceId();
		this.setupVaultWatchers();
		this.setupVisibilityWatcher();
	}

	static getInstance(app: App): ZoraSyncService {
		if (!syncServiceInstance || syncServiceInstance.app !== app) {
			syncServiceInstance = new ZoraSyncService(app);
		}
		return syncServiceInstance;
	}

	getDeviceId(): string {
		return this.deviceId;
	}

	private resolveDeviceId(): string {
		const storageKey = "zora-sync-device-id";
		try {
			if (typeof window !== "undefined" && typeof window.localStorage !== "undefined" && typeof window.localStorage.getItem === "function") {
				const existing = window.localStorage.getItem(storageKey);
				if (existing && existing.trim().length > 0) {
					return existing.trim();
				}
			}
		} catch {
			// ignore localStorage error
		}

		if (fallbackGlobalDeviceId) {
			return fallbackGlobalDeviceId;
		}

		const platformPrefix = Platform.isIosApp
			? "ios"
			: Platform.isAndroidApp
			? "android"
			: Platform.isWin
			? "windows"
			: Platform.isMacOS
			? "mac"
			: "device";
		const newId = `${platformPrefix}-${generateCardUUID().slice(0, 8)}`;
		fallbackGlobalDeviceId = newId;
		try {
			if (typeof window !== "undefined" && typeof window.localStorage !== "undefined" && typeof window.localStorage.setItem === "function") {
				window.localStorage.setItem(storageKey, newId);
			}
		} catch {
			// ignore
		}
		return newId;
	}

	// ------------------------------------------------------------------------
	// Book ID & Paths
	// ------------------------------------------------------------------------

	async computeBookIdFromFile(filePath: string): Promise<string> {
		const normalizedPath = normalizePath(filePath || "");
		if (!normalizedPath) {
			return "";
		}

		const adapter = this.app.vault.adapter as {
			readBinary?: (path: string) => Promise<ArrayBuffer | Uint8Array>;
		};
		if (typeof adapter?.readBinary === "function") {
			try {
				const binary = await adapter.readBinary(normalizedPath);
				return await this.computeBookIdFromBytes(binary);
			} catch (error) {
				logger.warn(`[ZoraSyncService] Failed to read binary for book ID computation from ${normalizedPath}:`, error);
			}
		}

		// Fallback to reading TFile
		const file = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (file instanceof TFile) {
			try {
				const binary = await this.app.vault.readBinary(file);
				return await this.computeBookIdFromBytes(binary);
			} catch (error) {
				logger.warn(`[ZoraSyncService] Failed to read TFile binary for book ID computation from ${normalizedPath}:`, error);
			}
		}

		// Deterministic string hash fallback if file cannot be read
		return `fallback-${this.hashString(normalizedPath)}`;
	}

	async computeBookIdFromBytes(bytes: Uint8Array | ArrayBuffer): Promise<string> {
		const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
		try {
			if (typeof crypto !== "undefined" && typeof crypto.subtle?.digest === "function") {
				const digest = await crypto.subtle.digest("SHA-256", input);
				return Array.from(new Uint8Array(digest))
					.map((b) => b.toString(16).padStart(2, "0"))
					.join("");
			}
		} catch (error) {
			logger.warn("[ZoraSyncService] crypto.subtle.digest failed:", error);
		}

		// Fallback simple checksum if crypto.subtle is unavailable
		let hash = 0;
		for (let i = 0; i < Math.min(input.length, 65536); i++) {
			hash = (hash * 31 + input[i]) | 0;
		}
		return `sha-fallback-${Math.abs(hash).toString(16)}`;
	}

	private hashString(input: string): string {
		let hash = 2166136261;
		for (let index = 0; index < input.length; index += 1) {
			hash ^= input.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		return (hash >>> 0).toString(36);
	}

	getBookDir(bookId: string): string {
		return normalizePath(`${BOOKS_DIR}/${bookId}`);
	}

	getProgressDir(bookId: string): string {
		return normalizePath(`${this.getBookDir(bookId)}/progress`);
	}

	getAnnotationsDir(bookId: string): string {
		return normalizePath(`${this.getBookDir(bookId)}/annotations`);
	}

	getBookmarksDir(bookId: string): string {
		return normalizePath(`${this.getBookDir(bookId)}/bookmarks`);
	}

	getNotesDir(bookId: string): string {
		return normalizePath(`${this.getBookDir(bookId)}/notes`);
	}

	getTombstonesDir(bookId: string): string {
		return normalizePath(`${this.getBookDir(bookId)}/tombstones`);
	}

	getBookMetaPath(bookId: string): string {
		return normalizePath(`${this.getBookDir(bookId)}/book.json`);
	}

	// ------------------------------------------------------------------------
	// Atomic JSON Read / Write
	// ------------------------------------------------------------------------

	private async safeAtomicWriteJson(filePath: string, data: unknown): Promise<void> {
		const adapter = this.app?.vault?.adapter;
		if (!adapter) return;

		const normalizedPath = normalizePath(filePath);
		await DirectoryUtils.ensureDirForFile(adapter, normalizedPath);

		const jsonStr = JSON.stringify(data, null, 2);
		const tempPath = `${normalizedPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;

		await adapter.write(tempPath, jsonStr);

		// Verify written JSON
		try {
			const content = await adapter.read(tempPath);
			JSON.parse(content);
		} catch (err) {
			if (await adapter.exists(tempPath)) {
				try {
					await adapter.remove(tempPath);
				} catch {}
			}
			throw new Error(`原子写入 JSON 校验失败: ${normalizedPath} (${err instanceof Error ? err.message : String(err)})`);
		}

		// Rename temp to target if supported
		if (typeof (adapter as any).rename === "function") {
			try {
				if (await adapter.exists(normalizedPath)) {
					await adapter.remove(normalizedPath);
				}
				await (adapter as any).rename(tempPath, normalizedPath);
				return;
			} catch {
				// Fallback to write + remove
			}
		}

		await adapter.write(normalizedPath, jsonStr);
		if (await adapter.exists(tempPath)) {
			try {
				await adapter.remove(tempPath);
			} catch {}
		}
	}

	private async safeReadJson<T>(filePath: string): Promise<T | null> {
		const adapter = this.app?.vault?.adapter;
		if (!adapter) return null;

		const normalizedPath = normalizePath(filePath);
		if (!(await adapter.exists(normalizedPath))) {
			return null;
		}

		try {
			const content = await adapter.read(normalizedPath);
			return JSON.parse(content) as T;
		} catch (error) {
			logger.warn(`[ZoraSyncService] Failed to read/parse JSON at ${normalizedPath}:`, error);
			return null;
		}
	}

	// ------------------------------------------------------------------------
	// Book Metadata
	// ------------------------------------------------------------------------

	async saveBookMeta(meta: SyncBookMeta): Promise<void> {
		const path = this.getBookMetaPath(meta.bookId);
		await this.safeAtomicWriteJson(path, {
			...meta,
			updatedAt: meta.updatedAt || new Date().toISOString(),
		});
	}

	async loadBookMeta(bookId: string): Promise<SyncBookMeta | null> {
		const path = this.getBookMetaPath(bookId);
		return await this.safeReadJson<SyncBookMeta>(path);
	}

	// ------------------------------------------------------------------------
	// Reading Progress (One file per device)
	// ------------------------------------------------------------------------

	async saveProgress(
		bookId: string,
		progress: {
			cfi: string;
			href?: string;
			percentage: number;
			chapterIndex?: number;
			chapterTitle?: string;
			updatedAt?: string;
		}
	): Promise<void> {
		if (!bookId || !progress.cfi) return;

		const payload: SyncProgress = {
			bookId,
			deviceId: this.deviceId,
			cfi: progress.cfi,
			href: progress.href,
			percentage: progress.percentage,
			chapterIndex: progress.chapterIndex,
			chapterTitle: progress.chapterTitle,
			updatedAt: progress.updatedAt || new Date().toISOString(),
		};

		const dir = this.getProgressDir(bookId);
		const filePath = normalizePath(`${dir}/${this.deviceId}.json`);
		await this.safeAtomicWriteJson(filePath, payload);

		logMobileEvent("Sync", "ProgressSaved", {
			bookId,
			deviceId: this.deviceId,
			percentage: progress.percentage,
			cfi: progress.cfi,
		});
	}

	async loadLatestProgress(bookId: string): Promise<SyncProgress | null> {
		if (!bookId) return null;

		const dir = this.getProgressDir(bookId);
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(dir))) {
			return null;
		}

		try {
			const files = (await adapter.list(dir))?.files || [];
			let latestProgress: SyncProgress | null = null;
			let latestTime = -1;

			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				const progress = await this.safeReadJson<SyncProgress>(file);
				if (!progress || !progress.cfi || !progress.updatedAt) continue;

				const time = new Date(progress.updatedAt).getTime();
				if (time > latestTime) {
					latestTime = time;
					latestProgress = progress;
				}
			}

			return latestProgress;
		} catch (error) {
			logger.warn(`[ZoraSyncService] Failed to list progress files for book ${bookId}:`, error);
			return null;
		}
	}

	// ------------------------------------------------------------------------
	// Annotations (One file per annotation)
	// ------------------------------------------------------------------------

	async saveAnnotation(annotation: Omit<SyncAnnotation, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): Promise<SyncAnnotation> {
		const fullAnnotation: SyncAnnotation = {
			...annotation,
			createdAt: annotation.createdAt || new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const dir = this.getAnnotationsDir(fullAnnotation.bookId);
		const filePath = normalizePath(`${dir}/${fullAnnotation.id}.json`);
		await this.safeAtomicWriteJson(filePath, fullAnnotation);

		logMobileEvent("Sync", "AnnotationSaved", {
			id: fullAnnotation.id,
			bookId: fullAnnotation.bookId,
			color: fullAnnotation.color,
			style: fullAnnotation.style,
		});

		return fullAnnotation;
	}

	async deleteAnnotation(bookId: string, annotationId: string): Promise<void> {
		if (!bookId || !annotationId) return;

		// 1. Write tombstone
		const tombstone: SyncTombstone = {
			id: annotationId,
			entityType: "annotation",
			deletedAt: new Date().toISOString(),
			deviceId: this.deviceId,
		};
		const tombstonesDir = this.getTombstonesDir(bookId);
		const tombstonePath = normalizePath(`${tombstonesDir}/${annotationId}.json`);
		await this.safeAtomicWriteJson(tombstonePath, tombstone);

		// 2. Remove annotation file
		const annotationsDir = this.getAnnotationsDir(bookId);
		const annotationPath = normalizePath(`${annotationsDir}/${annotationId}.json`);
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(annotationPath)) {
			try {
				await adapter.remove(annotationPath);
			} catch {}
		}

		logMobileEvent("Sync", "AnnotationDeleted", { bookId, annotationId });
	}

	async loadAnnotations(bookId: string): Promise<SyncAnnotation[]> {
		if (!bookId) return [];

		const adapter = this.app.vault.adapter;
		const tombstonesDir = this.getTombstonesDir(bookId);
		const annotationsDir = this.getAnnotationsDir(bookId);

		const tombstonesMap = new Map<string, number>();
		if (await adapter.exists(tombstonesDir)) {
			try {
				const files = (await adapter.list(tombstonesDir))?.files || [];
				for (const file of files) {
					if (!file.endsWith(".json")) continue;
					const tombstone = await this.safeReadJson<SyncTombstone>(file);
					if (tombstone && tombstone.id && tombstone.deletedAt) {
						tombstonesMap.set(tombstone.id, new Date(tombstone.deletedAt).getTime());
					}
				}
			} catch (err) {
				logger.warn(`[ZoraSyncService] Error reading tombstones for ${bookId}:`, err);
			}
		}

		if (!(await adapter.exists(annotationsDir))) {
			return [];
		}

		try {
			const files = (await adapter.list(annotationsDir))?.files || [];
			const annotations: SyncAnnotation[] = [];

			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				const annotation = await this.safeReadJson<SyncAnnotation>(file);
				if (!annotation || !annotation.id || !annotation.cfiRange) continue;

				const deletedAt = tombstonesMap.get(annotation.id);
				const updatedAt = new Date(annotation.updatedAt || annotation.createdAt || 0).getTime();

				if (deletedAt !== undefined && deletedAt >= updatedAt) {
					// Deleted by tombstone
					continue;
				}

				annotations.push(annotation);
			}

			return annotations;
		} catch (error) {
			logger.warn(`[ZoraSyncService] Failed to load annotations for book ${bookId}:`, error);
			return [];
		}
	}

	// ------------------------------------------------------------------------
	// Bookmarks (one file per bookmark, with deletion tombstones)
	// ------------------------------------------------------------------------

	async saveBookmark(
		bookmark: Omit<SyncBookmark, "createdAt" | "updatedAt"> & {
			createdAt?: string;
			updatedAt?: string;
		}
	): Promise<SyncBookmark> {
		const now = new Date().toISOString();
		const fullBookmark: SyncBookmark = {
			...bookmark,
			createdAt: bookmark.createdAt || now,
			updatedAt: bookmark.updatedAt || now,
		};
		const filePath = normalizePath(
			`${this.getBookmarksDir(fullBookmark.bookId)}/${fullBookmark.id}.json`
		);
		await this.safeAtomicWriteJson(filePath, fullBookmark);
		logMobileEvent("Sync", "BookmarkSaved", {
			id: fullBookmark.id,
			bookId: fullBookmark.bookId,
			cfi: fullBookmark.cfi,
		});
		return fullBookmark;
	}

	/**
	 * Imports a legacy bookmark without reviving an item that another device
	 * already deleted. Existing newer sync records also win.
	 */
	async importBookmark(bookmark: SyncBookmark): Promise<SyncBookmark | null> {
		if (!bookmark.bookId || !bookmark.id || !bookmark.cfi) {
			return null;
		}
		const tombstonePath = normalizePath(
			`${this.getTombstonesDir(bookmark.bookId)}/${bookmark.id}.json`
		);
		const tombstone = await this.safeReadJson<SyncTombstone>(tombstonePath);
		const incomingTime = new Date(bookmark.updatedAt || bookmark.createdAt || 0).getTime();
		if (
			tombstone?.entityType === "bookmark" &&
			new Date(tombstone.deletedAt || 0).getTime() >= incomingTime
		) {
			return null;
		}

		const bookmarkPath = normalizePath(
			`${this.getBookmarksDir(bookmark.bookId)}/${bookmark.id}.json`
		);
		const existing = await this.safeReadJson<SyncBookmark>(bookmarkPath);
		const existingTime = existing
			? new Date(existing.updatedAt || existing.createdAt || 0).getTime()
			: -1;
		if (existing?.cfi && existingTime >= incomingTime) {
			return existing;
		}

		await this.safeAtomicWriteJson(bookmarkPath, bookmark);
		return bookmark;
	}

	async deleteBookmark(bookId: string, bookmarkId: string): Promise<void> {
		if (!bookId || !bookmarkId) return;

		const tombstone: SyncTombstone = {
			id: bookmarkId,
			entityType: "bookmark",
			deletedAt: new Date().toISOString(),
			deviceId: this.deviceId,
		};
		const tombstonePath = normalizePath(
			`${this.getTombstonesDir(bookId)}/${bookmarkId}.json`
		);
		await this.safeAtomicWriteJson(tombstonePath, tombstone);

		const bookmarkPath = normalizePath(
			`${this.getBookmarksDir(bookId)}/${bookmarkId}.json`
		);
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(bookmarkPath)) {
			try {
				await adapter.remove(bookmarkPath);
			} catch {}
		}

		logMobileEvent("Sync", "BookmarkDeleted", { bookId, bookmarkId });
	}

	async loadBookmarkSnapshot(
		bookId: string
	): Promise<{ bookmarks: SyncBookmark[]; deletedIds: Set<string> }> {
		if (!bookId) {
			return { bookmarks: [], deletedIds: new Set<string>() };
		}

		const adapter = this.app.vault.adapter;
		const tombstonesDir = this.getTombstonesDir(bookId);
		const bookmarksDir = this.getBookmarksDir(bookId);
		const tombstonesMap = new Map<string, number>();

		if (await adapter.exists(tombstonesDir)) {
			try {
				const files = (await adapter.list(tombstonesDir))?.files || [];
				for (const file of files) {
					if (!file.endsWith(".json")) continue;
					const tombstone = await this.safeReadJson<SyncTombstone>(file);
					if (
						tombstone?.entityType === "bookmark" &&
						tombstone.id &&
						tombstone.deletedAt
					) {
						tombstonesMap.set(
							tombstone.id,
							new Date(tombstone.deletedAt).getTime()
						);
					}
				}
			} catch (error) {
				logger.warn(
					`[ZoraSyncService] Error reading bookmark tombstones for ${bookId}:`,
					error
				);
			}
		}

		if (!(await adapter.exists(bookmarksDir))) {
			return {
				bookmarks: [],
				deletedIds: new Set(tombstonesMap.keys()),
			};
		}

		try {
			const files = (await adapter.list(bookmarksDir))?.files || [];
			const bookmarks: SyncBookmark[] = [];
			const deletedIds = new Set(tombstonesMap.keys());

			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				const bookmark = await this.safeReadJson<SyncBookmark>(file);
				if (!bookmark?.id || !bookmark.cfi) continue;

				const deletedAt = tombstonesMap.get(bookmark.id);
				const updatedAt = new Date(
					bookmark.updatedAt || bookmark.createdAt || 0
				).getTime();
				if (deletedAt !== undefined && deletedAt >= updatedAt) {
					continue;
				}
				deletedIds.delete(bookmark.id);
				bookmarks.push(bookmark);
			}

			return { bookmarks, deletedIds };
		} catch (error) {
			logger.warn(
				`[ZoraSyncService] Failed to load bookmarks for book ${bookId}:`,
				error
			);
			return {
				bookmarks: [],
				deletedIds: new Set(tombstonesMap.keys()),
			};
		}
	}

	async loadBookmarks(bookId: string): Promise<SyncBookmark[]> {
		return (await this.loadBookmarkSnapshot(bookId)).bookmarks;
	}

	// ------------------------------------------------------------------------
	// Notes (One file per note)
	// ------------------------------------------------------------------------

	async saveNote(note: Omit<SyncNote, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): Promise<SyncNote> {
		const fullNote: SyncNote = {
			...note,
			createdAt: note.createdAt || new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const dir = this.getNotesDir(fullNote.bookId);
		const filePath = normalizePath(`${dir}/${fullNote.id}.json`);
		await this.safeAtomicWriteJson(filePath, fullNote);

		logMobileEvent("Sync", "NoteSaved", {
			id: fullNote.id,
			bookId: fullNote.bookId,
			type: fullNote.type,
		});

		return fullNote;
	}

	async deleteNote(bookId: string, noteId: string): Promise<void> {
		if (!bookId || !noteId) return;

		// 1. Write tombstone
		const tombstone: SyncTombstone = {
			id: noteId,
			entityType: "note",
			deletedAt: new Date().toISOString(),
			deviceId: this.deviceId,
		};
		const tombstonesDir = this.getTombstonesDir(bookId);
		const tombstonePath = normalizePath(`${tombstonesDir}/${noteId}.json`);
		await this.safeAtomicWriteJson(tombstonePath, tombstone);

		// 2. Remove note file
		const notesDir = this.getNotesDir(bookId);
		const notePath = normalizePath(`${notesDir}/${noteId}.json`);
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(notePath)) {
			try {
				await adapter.remove(notePath);
			} catch {}
		}

		logMobileEvent("Sync", "NoteDeleted", { bookId, noteId });
	}

	async loadNotes(bookId: string): Promise<SyncNote[]> {
		if (!bookId) return [];

		const adapter = this.app.vault.adapter;
		const tombstonesDir = this.getTombstonesDir(bookId);
		const notesDir = this.getNotesDir(bookId);

		const tombstonesMap = new Map<string, number>();
		if (await adapter.exists(tombstonesDir)) {
			try {
				const files = (await adapter.list(tombstonesDir))?.files || [];
				for (const file of files) {
					if (!file.endsWith(".json")) continue;
					const tombstone = await this.safeReadJson<SyncTombstone>(file);
					if (tombstone && tombstone.id && tombstone.deletedAt) {
						tombstonesMap.set(tombstone.id, new Date(tombstone.deletedAt).getTime());
					}
				}
			} catch (err) {
				logger.warn(`[ZoraSyncService] Error reading tombstones for ${bookId}:`, err);
			}
		}

		if (!(await adapter.exists(notesDir))) {
			return [];
		}

		try {
			const files = (await adapter.list(notesDir))?.files || [];
			const notes: SyncNote[] = [];

			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				const note = await this.safeReadJson<SyncNote>(file);
				if (!note || !note.id || !note.content) continue;

				const deletedAt = tombstonesMap.get(note.id);
				const updatedAt = new Date(note.updatedAt || note.createdAt || 0).getTime();

				if (deletedAt !== undefined && deletedAt >= updatedAt) {
					continue;
				}

				notes.push(note);
			}

			return notes;
		} catch (error) {
			logger.warn(`[ZoraSyncService] Failed to load notes for book ${bookId}:`, error);
			return [];
		}
	}

	// ------------------------------------------------------------------------
	// Hot Reload & Watchers
	// ------------------------------------------------------------------------

	setActiveBook(bookId: string | null, filePath?: string | null): void {
		this.activeBookId = bookId;
		this.activeBookFilePath = filePath || null;
		this.knownDirFingerprint = null;

		if (bookId) {
			this.startPeriodicScan();
		} else {
			this.stopPeriodicScan();
		}
	}

	onSyncStateChanged(listener: (bookId: string) => void): () => void {
		this.syncListeners.add(listener);
		return () => {
			this.syncListeners.delete(listener);
		};
	}

	private notifySyncChanged(bookId: string): void {
		for (const listener of this.syncListeners) {
			try {
				listener(bookId);
			} catch (e) {
				logger.warn("[ZoraSyncService] Error in sync listener:", e);
			}
		}
	}

	private setupVaultWatchers(): void {
		if (!this.app?.vault || typeof this.app.vault.on !== "function") {
			return;
		}
		const handleEvent = (path: string) => {
			if (!path || !this.activeBookId) return;
			const targetPrefix = normalizePath(`${BOOKS_DIR}/${this.activeBookId}/`);
			if (normalizePath(path).startsWith(targetPrefix)) {
				this.scheduleDebouncedReload(this.activeBookId);
			}
		};

		try {
			this.vaultEventRefs.push(
				this.app.vault.on("create", (file) => file && handleEvent(file.path)),
				this.app.vault.on("modify", (file) => file && handleEvent(file.path)),
				this.app.vault.on("delete", (file) => file && handleEvent(file.path)),
				this.app.vault.on("rename", (file, oldPath) => {
					if (file) handleEvent(file.path);
					if (oldPath) handleEvent(oldPath);
				})
			);
		} catch (err) {
			logger.warn("[ZoraSyncService] setupVaultWatchers failed:", err);
		}
	}

	private setupVisibilityWatcher(): void {
		if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
			try {
				this.visibilityHandler = () => {
					if (document.visibilityState === "visible" && this.activeBookId) {
						void this.checkActiveBookDirChanged();
					}
				};
				document.addEventListener("visibilitychange", this.visibilityHandler);
			} catch (err) {
				logger.warn("[ZoraSyncService] setupVisibilityWatcher failed:", err);
			}
		}
	}

	private startPeriodicScan(): void {
		this.stopPeriodicScan();
		// 10s lightweight directory scan
		this.periodicTimer = setInterval(() => {
			if (this.activeBookId) {
				void this.checkActiveBookDirChanged();
			}
		}, 10000);
	}

	private stopPeriodicScan(): void {
		if (this.periodicTimer !== null) {
			clearInterval(this.periodicTimer);
			this.periodicTimer = null;
		}
	}

	private scheduleDebouncedReload(bookId: string): void {
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			this.notifySyncChanged(bookId);
		}, 300);
	}

	async checkActiveBookDirChanged(): Promise<boolean> {
		if (!this.activeBookId) return false;
		const bookId = this.activeBookId;
		const dir = this.getBookDir(bookId);
		const adapter = this.app?.vault?.adapter;
		if (!adapter) return false;

		this.lastScanTime = Date.now();
		try {
			if (!(await adapter.exists(dir))) {
				return false;
			}
			const watchedDirs = [
				dir,
				this.getProgressDir(bookId),
				this.getAnnotationsDir(bookId),
				this.getBookmarksDir(bookId),
				this.getNotesDir(bookId),
				this.getTombstonesDir(bookId),
			];
			const fingerprintParts: string[] = [];
			for (const watchedDir of watchedDirs) {
				if (!(await adapter.exists(watchedDir))) continue;
				const list = await adapter.list(watchedDir);
				for (const filePath of [...(list?.files || [])].sort()) {
					let stamp = "";
					try {
						const stat = await adapter.stat?.(filePath);
						stamp = `:${stat?.mtime || 0}:${stat?.size || 0}`;
					} catch {}
					fingerprintParts.push(`${filePath}${stamp}`);
				}
				for (const folderPath of [...(list?.folders || [])].sort()) {
					fingerprintParts.push(`${folderPath}/`);
				}
			}
			const fingerprint = fingerprintParts.join(";");

			if (this.knownDirFingerprint !== null && this.knownDirFingerprint !== fingerprint) {
				this.knownDirFingerprint = fingerprint;
				this.notifySyncChanged(bookId);
				return true;
			}
			this.knownDirFingerprint = fingerprint;
			this.lastScanError = null;
			return false;
		} catch (err: any) {
			this.lastScanError = err?.message || String(err);
			return false;
		}
	}

	// ------------------------------------------------------------------------
	// Diagnostics
	// ------------------------------------------------------------------------

	async getDiagnostics(bookId?: string): Promise<SyncDiagnostics> {
		const targetBookId = bookId || this.activeBookId || undefined;
		let latestProgressDevice: string | undefined;
		let latestProgressTime: string | undefined;
		let annotationCount = 0;
		let bookmarkCount = 0;
		let readingNoteCount = 0;

		if (targetBookId) {
			const latestProgress = await this.loadLatestProgress(targetBookId);
			if (latestProgress) {
				latestProgressDevice = latestProgress.deviceId;
				latestProgressTime = latestProgress.updatedAt;
			}
			const annotations = await this.loadAnnotations(targetBookId);
			annotationCount = annotations.length;
			const bookmarks = await this.loadBookmarks(targetBookId);
			bookmarkCount = bookmarks.length;
			const notes = await this.loadNotes(targetBookId);
			readingNoteCount = notes.length;
		}

		return {
			bookId: targetBookId,
			deviceId: this.deviceId,
			latestProgressDevice,
			latestProgressTime,
			annotationCount,
			bookmarkCount,
			readingNoteCount,
			lastSyncScan: this.lastScanTime ? new Date(this.lastScanTime).toISOString() : undefined,
			lastSyncError: this.lastScanError || undefined,
		};
	}

	// ------------------------------------------------------------------------
	// Cleanup
	// ------------------------------------------------------------------------

	destroy(): void {
		this.stopPeriodicScan();
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		if (this.visibilityHandler && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
			try {
				document.removeEventListener("visibilitychange", this.visibilityHandler);
			} catch {}
			this.visibilityHandler = null;
		}
		if (this.app?.vault && typeof this.app.vault.offref === "function") {
			for (const ref of this.vaultEventRefs) {
				try {
					this.app.vault.offref(ref);
				} catch {}
			}
		}
		this.vaultEventRefs = [];
		this.syncListeners.clear();
	}
}

export function getZoraSyncService(app: App): ZoraSyncService {
	return ZoraSyncService.getInstance(app);
}
