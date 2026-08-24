import { type App, type EventRef, type TFile, normalizePath } from "obsidian";
import { getPluginPathsById, getV2PathsFromApp } from "../../config/paths";
import { CURRENT_PLUGIN_ID } from "../../config/plugin-runtime";
import { DirectoryUtils } from "../../utils/directory-utils";
import { safeReadJson } from "../../utils/safe-json-io";
import { extractBodyContent, parseYAMLFromContent, setCardProperty } from "../../utils/yaml-utils";
import { logger } from "../../utils/logger";
import { logMobileEvent } from "../../utils/zora-mobile-logger";
import { unknownPlainText } from "../../utils/unknown-plain-text";
import { getReaderHighlightIdentityKey } from "./highlight/highlight-identity";
import { EpubLinkService } from "./EpubLinkService";
import type { EpubStorageService } from "./EpubStorageService";
import { getEpubStorageService } from "./epub-storage-access";
import {
	isEphemeralEditorHighlightSourcePath,
	isPersistedExcerptStorageSourcePath,
	resolveEpubHighlightPersistenceSourcePath,
	type EpubHighlightPersistenceSourceCandidate,
} from "./epub-highlight-source-path";
import { isEpubBookmarkManagedVaultPath } from "./epub-bookmark-vault-path";
import { isSupportedBookPath } from "./book-format";
import {
	epubVaultPathsReferToSameBook,
	resolveComparableBookVaultPath,
} from "./epub-vault-path";
import { getEpubRuntime } from "./epub-runtime";
import {
	clearDeckAndAnalyticsCaches,
	invalidateCardMetadataCache,
	notifyWeaveDataSyncChange,
	rebuildWdeckCacheIfNeeded,
	removeCardIndexes,
	resolveWeaveCacheHost,
	triggerCardMutationEvents,
	type WeaveCardMutationPayload,
} from "./weave-cache-bridge";
import type { HighlightSourceLocator } from "./reader-engine-types";
import type { EpubHighlightStyle } from "./types";

export interface BacklinkHighlight {
	cfiRange: string;
	color: string;
	style?: EpubHighlightStyle;
	text: string;
	commentText?: string;
	hasCommentDivider?: boolean;
	chapterIndex?: number;
	chapterTitle?: string;
	sourceFile: string;
	sourceRef?: string;
	excerptId?: string;
	sourceLocators?: HighlightSourceLocator[];
	createdTime?: number;
}

export interface BacklinkSourceMatch {
	sourceFile: string;
	sourceRef?: string;
	excerptId?: string;
	/** Canonical locator stored in the source note/card, when it differs from the live reader CFI. */
	cfiRange?: string;
}

export interface BacklinkSourceHint {
	text?: string;
	createdTime?: number;
}

export type CardDataHighlightDeletionMode = "excerpt-only" | "delete-card";

export interface CardDataHighlightDeletionAnalysis {
	matched: boolean;
	hasAdditionalContent: boolean;
	additionalContentPreview?: string;
	recommendedMode: CardDataHighlightDeletionMode;
}

interface ParsedEpubCallout {
	color: string;
	style?: EpubHighlightStyle;
	linkMarkup: string;
	quotedText: string;
	commentText: string;
	hasCommentDivider: boolean;
	commentBlock: string;
	dividerMarker?: string;
	chapterTitle?: string;
	fullMatch: string;
	createdTime?: number;
	excerptBlockId?: string;
}

type JsonCardLike = {
	uuid?: string;
	content?: string;
	modified?: string;
	created?: string;
	sourceFile?: string;
	sourceKind?: string;
	sourceSubunitKey?: string;
	deckId?: string;
	persistenceSourcePath?: string;
	customFields?: EpubHighlightPersistenceSourceCandidate["customFields"];
};

type CanvasNodeLike = {
	id?: string;
	type?: string;
	text?: string;
	file?: string;
	subpath?: string;
};

type CardDataEntryContext = {
	card: JsonCardLike;
	container: unknown[] | Record<string, unknown>;
	key: number | string;
};

type ResolvedCalloutLink = {
	filePath: string;
	cfi: string;
	chapter?: number;
	sourceId?: string;
	excerptId?: string;
};

type EpubTargetIdentity = {
	filePath: string;
	fileName: string;
	sourceId?: string;
	sourceIds: string[];
};

type OpenMarkdownViewLike = {
	file?: { path?: string };
	editor?: {
		getValue?: () => string;
		setValue?: (value: string) => void;
	};
	save?: () => Promise<void>;
};

type HighlightSourceFileStamp = {
	path: string;
	mtime: number;
	size: number;
};

interface EpubBacklinkHighlightsCacheManifest {
	markdownSources: HighlightSourceFileStamp[];
	canvasSources: HighlightSourceFileStamp[];
	cardDataSources: HighlightSourceFileStamp[];
	boundCanvasPath?: string;
}

interface EpubBacklinkHighlightsCacheEntry {
	manifestFingerprint: string;
	manifest?: EpubBacklinkHighlightsCacheManifest;
	savedAt: string;
	highlights: BacklinkHighlight[];
}

interface EpubBacklinkHighlightsCacheStore {
	version: string;
	lastUpdated: string;
	entries: Record<string, EpubBacklinkHighlightsCacheEntry>;
	sourceIndex?: EpubBacklinkSourceIndexSnapshot;
}

type EpubBacklinkSourceIndexFileKind = "markdown" | "canvas" | "cardData";

interface IndexedBacklinkTargetIdentity {
	filePath: string;
	fileName: string;
	sourceId?: string;
}

interface IndexedBacklinkHighlightEntry {
	target: IndexedBacklinkTargetIdentity;
	highlight: BacklinkHighlight;
}

interface IndexedCanvasFileNodeBinding {
	targetPath: string;
	nodeId: string;
}

interface EpubBacklinkSourceIndexFileRecord {
	path: string;
	kind: EpubBacklinkSourceIndexFileKind;
	mtime: number;
	size: number;
	directHighlights: IndexedBacklinkHighlightEntry[];
	canvasFileNodeBindings?: IndexedCanvasFileNodeBinding[];
}

interface EpubBacklinkSourceIndexSnapshot {
	version: string;
	updatedAt: string;
	files: EpubBacklinkSourceIndexFileRecord[];
}

const STRUCTURED_CARD_DATA_FILE_EXTENSIONS = new Set(["json", "wdeck"]);
const EPUB_BACKLINK_HIGHLIGHTS_CACHE_VERSION = "1.3.0";
const EPUB_BACKLINK_SOURCE_INDEX_VERSION = "1.3.0";

const DEFAULT_HIGHLIGHT_COLOR = "yellow";

export class EpubBacklinkHighlightService {
	private app: App;
	private storageService: EpubStorageService;
	private localPluginId: string;
	private diskCacheStore: EpubBacklinkHighlightsCacheStore | null = null;
	private diskCacheLoaded = false;
	private inflightDiskCacheLoad: Promise<EpubBacklinkHighlightsCacheStore> | null = null;
	private inflightDiskCacheWrite: Promise<void> | null = null;
	private sourceIndexPrimed = false;
	private touchedSourceIndexPaths = new Set<string>();
	private sourceIndexVaultEventRefs: EventRef[] = [];

	constructor(app: App) {
		this.app = app;
		this.storageService = getEpubStorageService(app);
		this.localPluginId = getEpubRuntime().pluginDirName;
		this.setupSourceIndexFileWatchers();
	}

	destroy(): void {
		const offref = (
			this.app.vault as typeof this.app.vault & {
				offref?: (ref: EventRef) => void;
			}
		).offref;
		if (typeof offref === "function") {
			for (const ref of this.sourceIndexVaultEventRefs) {
				offref.call(this.app.vault, ref);
			}
		}
		this.sourceIndexVaultEventRefs = [];
		this.touchedSourceIndexPaths.clear();
	}

	async invalidateHighlightsCacheForEpub(
		epubFilePath: string,
		boundCanvasPath?: string | null
	): Promise<void> {
		try {
			const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
			const cacheKey = this.buildCacheKey(targetIdentity, boundCanvasPath);
			const store = this.diskCacheLoaded
				? this.diskCacheStore || this.createEmptyDiskCacheStore()
				: await this.loadDiskCacheStore();
			if (!store.entries[cacheKey]) {
				return;
			}
			const nextEntries = { ...store.entries };
			delete nextEntries[cacheKey];
			const nextStore: EpubBacklinkHighlightsCacheStore = {
				...store,
				version: EPUB_BACKLINK_HIGHLIGHTS_CACHE_VERSION,
				lastUpdated: new Date().toISOString(),
				entries: nextEntries,
			};
			const previousWrite = this.inflightDiskCacheWrite ?? Promise.resolve();
			const writePromise = previousWrite
				.catch(() => undefined)
				.then(async () => {
					await DirectoryUtils.ensureDirForFile(this.app.vault.adapter, this.getDiskCachePath());
					await this.app.vault.adapter.write(this.getDiskCachePath(), JSON.stringify(nextStore));
					this.diskCacheStore = nextStore;
					this.diskCacheLoaded = true;
				});
			this.inflightDiskCacheWrite = writePromise;
			try {
				await writePromise;
			} finally {
				if (this.inflightDiskCacheWrite === writePromise) {
					this.inflightDiskCacheWrite = null;
				}
			}
		} catch (error) {
			logger.warn("[EpubBacklinkHighlightService] Failed to invalidate highlight cache:", error);
		}
	}

	/**
	 * Clears on-disk excerpt highlight cache and source-file index.
	 * Per-book highlights are rebuilt lazily the next time a book is opened.
	 */
	async rebuildHighlightIndexes(): Promise<void> {
		if (this.inflightDiskCacheWrite) {
			await this.inflightDiskCacheWrite.catch(() => undefined);
		}
		if (this.inflightDiskCacheLoad) {
			await this.inflightDiskCacheLoad.catch(() => undefined);
		}

		const emptyStore = this.createEmptyDiskCacheStore();
		const cachePath = this.getDiskCachePath();
		await DirectoryUtils.ensureDirForFile(this.app.vault.adapter, cachePath);
		await this.app.vault.adapter.write(cachePath, JSON.stringify(emptyStore));

		this.diskCacheStore = emptyStore;
		this.diskCacheLoaded = true;
		this.inflightDiskCacheLoad = null;
		this.inflightDiskCacheWrite = null;
		this.sourceIndexPrimed = false;
		this.touchedSourceIndexPaths.clear();
	}

	async collectHighlights(
		epubFilePath: string,
		boundCanvasPath?: string | null,
		options?: { additionalSourcePaths?: string[] }
	): Promise<BacklinkHighlight[]> {
		const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
		const hasAdditionalSourcePaths =
			Array.isArray(options?.additionalSourcePaths) && options.additionalSourcePaths.length > 0;
		if (!hasAdditionalSourcePaths) {
			const fastCached = await this.tryReadValidBookCacheFast(targetIdentity, boundCanvasPath);
			if (fastCached) {
				logger.debug(
					`[EpubBacklinkHighlightService] Fast cache hit for ${epubFilePath} (${fastCached.length})`
				);
				return fastCached;
			}
		}

		const store = await this.loadDiskCacheStore();
		const cacheKey = this.buildCacheKey(targetIdentity, boundCanvasPath);
		const priorManifest = store.entries[cacheKey]?.manifest;
		const sourcePathSet = new Set(this.discoverLinkingSourcePaths(targetIdentity));
		for (const path of options?.additionalSourcePaths || []) {
			const normalizedPath = normalizePath(String(path || "").trim());
			if (normalizedPath && this.isPotentialSourceIndexPath(normalizedPath)) {
				sourcePathSet.add(normalizedPath);
			}
		}
		if (priorManifest) {
			for (const stamp of [
				...priorManifest.markdownSources,
				...priorManifest.canvasSources,
				...priorManifest.cardDataSources,
			]) {
				sourcePathSet.add(stamp.path);
			}
			if (priorManifest.boundCanvasPath) {
				sourcePathSet.add(normalizePath(priorManifest.boundCanvasPath));
			}
		}
		const normalizedBoundCanvasPath = normalizePath(String(boundCanvasPath || "").trim());
		if (normalizedBoundCanvasPath) {
			sourcePathSet.add(normalizedBoundCanvasPath);
		}

		let highlights: BacklinkHighlight[];
		let manifest: EpubBacklinkHighlightsCacheManifest;
		if (sourcePathSet.size > 0) {
			const collected = await this.collectHighlightsFromSourcePaths(
				targetIdentity,
				Array.from(sourcePathSet),
				boundCanvasPath
			);
			highlights = collected.highlights;
			manifest = collected.manifest;
		} else {
			highlights = [];
			manifest = {
				markdownSources: [],
				canvasSources: [],
				cardDataSources: [],
				...(normalizedBoundCanvasPath ? { boundCanvasPath: normalizedBoundCanvasPath } : {}),
			};
		}

		if (highlights.length === 0) {
			const validatedCache = await this.tryResolveValidBookCacheEntry(
				targetIdentity,
				boundCanvasPath,
				store
			);
			const manifestHasSources = Boolean(
				validatedCache &&
					(validatedCache.manifest.markdownSources.length > 0 ||
						validatedCache.manifest.canvasSources.length > 0 ||
						validatedCache.manifest.cardDataSources.length > 0)
			);
			if (
				validatedCache &&
				(validatedCache.highlights.length > 0 || manifestHasSources)
			) {
				highlights = validatedCache.highlights;
				manifest = validatedCache.manifest;
			} else {
				const sourceIndex = await this.ensureSourceIndexSnapshotUpToDate();
				highlights = this.collectHighlightsFromSourceIndexSnapshot(
					sourceIndex,
					targetIdentity,
					boundCanvasPath
				);
				manifest = this.buildHighlightSourceManifestFromSourceIndex(
					sourceIndex,
					targetIdentity,
					boundCanvasPath
				);
			}
		} else {
			const supplemented = await this.supplementScopedHighlightsFromSourceIndex(
				highlights,
				manifest,
				targetIdentity,
				boundCanvasPath,
				options?.additionalSourcePaths
			);
			highlights = supplemented.highlights;
			manifest = supplemented.manifest;
		}

		const normalizedHighlights = this.cloneHighlightsForCache(highlights);
		await this.persistCachedHighlights(
			targetIdentity,
			manifest,
			normalizedHighlights,
			boundCanvasPath
		);

		logMobileEvent("BOOK", "Identity", {
			relativePath: targetIdentity.filePath,
			bookId: targetIdentity.sourceId || targetIdentity.fileName,
			sourceId: targetIdentity.sourceId || "N/A",
		});
		logMobileEvent("MARKER", "Count", {
			foundCount: highlights.length,
			renderedCount: highlights.length,
		});

		logger.debug(
			`[EpubBacklinkHighlightService] Found ${highlights.length} highlights for ${epubFilePath} ` +
				`(markdown=${manifest.markdownSources.length}, canvas=${manifest.canvasSources.length}, cardData=${manifest.cardDataSources.length})`
		);
		return normalizedHighlights;
	}

	/**
	 * Rebuilds only the highlights contributed by the given source paths and merges them into the
	 * existing per-book disk cache. Avoids vault-wide rescans after excerpt CRUD in a known file.
	 */
	async refreshBookHighlightsIncremental(
		epubFilePath: string,
		changedSourcePaths: string[],
		boundCanvasPath?: string | null
	): Promise<BacklinkHighlight[]> {
		const normalizedPaths = Array.from(
			new Set(
				changedSourcePaths
					.map((path) => normalizePath(String(path || "").trim()))
					.filter((path) => path && this.isPotentialSourceIndexPath(path))
			)
		);
		if (normalizedPaths.length === 0) {
			return this.collectHighlights(epubFilePath, boundCanvasPath);
		}

		const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
		const cacheKey = this.buildCacheKey(targetIdentity, boundCanvasPath);
		const store = await this.loadDiskCacheStore();
		const entry = store.entries[cacheKey];

		if (!entry?.manifest || !Array.isArray(entry.highlights)) {
			return this.collectHighlights(epubFilePath, boundCanvasPath, {
				additionalSourcePaths: normalizedPaths,
			});
		}

		const pathSet = new Set(normalizedPaths);
		const retained = entry.highlights.filter(
			(highlight) => !this.highlightReferencesAnySourcePath(highlight, pathSet)
		);

		const collected = await this.collectHighlightsFromSourcePaths(
			targetIdentity,
			normalizedPaths,
			boundCanvasPath
		);

		const highlights = this.mergeBacklinkHighlightsByCfi(retained, collected.highlights);
		const manifest = this.mergeHighlightSourceManifests(
			this.normalizeCacheManifest(entry.manifest),
			collected.manifest
		);

		const normalizedHighlights = this.cloneHighlightsForCache(highlights);
		await this.persistCachedHighlights(
			targetIdentity,
			manifest,
			normalizedHighlights,
			boundCanvasPath
		);

		return normalizedHighlights;
	}

	private highlightReferencesAnySourcePath(
		highlight: BacklinkHighlight,
		sourcePaths: Set<string>
	): boolean {
		const candidates = new Set<string>();
		const primary = normalizePath(String(highlight.sourceFile || "").trim());
		if (primary) {
			candidates.add(primary);
		}
		for (const locator of highlight.sourceLocators || []) {
			const locatorPath = normalizePath(String(locator.sourceFile || "").trim());
			if (locatorPath) {
				candidates.add(locatorPath);
			}
		}
		for (const path of candidates) {
			if (sourcePaths.has(path)) {
				return true;
			}
		}
		return false;
	}

	async savedCardReferencesEpubFile(
		card: JsonCardLike,
		epubFilePath: string,
		bookSourceId?: string | null
	): Promise<boolean> {
		const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
		if (bookSourceId && !targetIdentity.sourceIds.includes(bookSourceId)) {
			targetIdentity.sourceIds = [...targetIdentity.sourceIds, bookSourceId];
		}
		const cardContent = typeof card?.content === "string" ? card.content : "";
		if (cardContent && this.contentMayReferenceTarget(cardContent, targetIdentity)) {
			return true;
		}
		const resolvedLink = this.resolveCardDataEpubLink(card);
		return Boolean(resolvedLink && this.isSameEpubTarget(resolvedLink, targetIdentity));
	}

	/**
	 * Read highlights from a single vault source file (card json/wdeck, md, or canvas).
	 * Avoids full-book cache invalidation and vault-wide source-index scans.
	 */
	async collectHighlightsFromSourcePath(
		epubFilePath: string,
		sourcePath: string,
		boundCanvasPath?: string | null
	): Promise<BacklinkHighlight[]> {
		const normalizedPath = normalizePath(String(sourcePath || "").trim());
		if (!normalizedPath) {
			return [];
		}
		const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
		const { highlights } = await this.collectHighlightsFromSourcePaths(
			targetIdentity,
			[normalizedPath],
			boundCanvasPath
		);
		return highlights;
	}

	async extractHighlightsFromSavedCard(
		card: JsonCardLike,
		epubFilePath: string,
		bookSourceId?: string | null
	): Promise<BacklinkHighlight[]> {
		const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
		if (bookSourceId && !targetIdentity.sourceIds.includes(bookSourceId)) {
			targetIdentity.sourceIds = [...targetIdentity.sourceIds, bookSourceId];
		}
		const explicitPersistencePath = normalizePath(
			String(card?.persistenceSourcePath || "").trim()
		);
		const persistenceSourceFile =
			(explicitPersistencePath && isPersistedExcerptStorageSourcePath(explicitPersistencePath)
				? explicitPersistencePath
				: undefined) ||
			resolveEpubHighlightPersistenceSourcePath(card) ||
			(typeof card?.sourceFile === "string" && isPersistedExcerptStorageSourcePath(card.sourceFile)
				? card.sourceFile
				: "");
		return this.parseHighlightsFromCardDataCard(card, targetIdentity, persistenceSourceFile);
	}

	private async tryReadValidBookCacheFast(
		targetIdentity: EpubTargetIdentity,
		boundCanvasPath?: string | null
	): Promise<BacklinkHighlight[] | null> {
		const resolved = await this.tryResolveValidBookCacheEntry(targetIdentity, boundCanvasPath);
		if (!resolved || resolved.highlights.length === 0) {
			return null;
		}
		return resolved.highlights;
	}

	private async checkBookNotesModifiedSince(
		targetIdentity: EpubTargetIdentity,
		savedAtIso: string,
		cachedMarkdownSources: HighlightSourceFileStamp[]
	): Promise<boolean> {
		const cachedPaths = new Set(cachedMarkdownSources.map((s) => normalizePath(s.path)));
		const savedAtTime = new Date(savedAtIso).getTime();
		const title = targetIdentity.fileName.replace(/\.epub$/i, "");
		const candidates = [
			`Notes/读书笔记/${title}.md`,
			`Notes/外文笔记/${title}.md`,
		];
		for (const candidatePath of candidates) {
			const normalizedCandidate = normalizePath(candidatePath);
			const file = this.app.vault.getAbstractFileByPath(normalizedCandidate);
			if (file && this.isTFile(file)) {
				if (!cachedPaths.has(normalizedCandidate)) {
					return true;
				}
				if (file.stat.mtime > savedAtTime) {
					return true;
				}
			}
		}
		return false;
	}

	private async tryResolveValidBookCacheEntry(
		targetIdentity: EpubTargetIdentity,
		boundCanvasPath?: string | null,
		store?: EpubBacklinkHighlightsCacheStore
	): Promise<{
		highlights: BacklinkHighlight[];
		manifest: EpubBacklinkHighlightsCacheManifest;
	} | null> {
		const cacheKey = this.buildCacheKey(targetIdentity, boundCanvasPath);
		const resolvedStore = store ?? (await this.loadDiskCacheStore());
		const entry = resolvedStore.entries[cacheKey];
		if (!entry?.manifest || !Array.isArray(entry.highlights)) {
			return null;
		}
		const notesChanged = await this.checkBookNotesModifiedSince(
			targetIdentity,
			entry.savedAt,
			entry.manifest.markdownSources
		);
		if (notesChanged) {
			return null;
		}
		const refreshedManifest = await this.refreshManifestStamps(
			this.normalizeCacheManifest(entry.manifest),
			boundCanvasPath
		);
		if (!refreshedManifest) {
			return null;
		}
		const manifestFingerprint = this.hashStableValue(refreshedManifest);
		if (entry.manifestFingerprint !== manifestFingerprint) {
			return null;
		}
		return {
			highlights: this.cloneHighlightsForCache(entry.highlights),
			manifest: refreshedManifest,
		};
	}

	private normalizeCacheManifest(
		manifest: EpubBacklinkHighlightsCacheManifest
	): EpubBacklinkHighlightsCacheManifest {
		const boundCanvasPath = normalizePath(String(manifest.boundCanvasPath || "").trim());
		return {
			markdownSources: manifest.markdownSources.map((stamp) => ({ ...stamp })),
			canvasSources: manifest.canvasSources.map((stamp) => ({ ...stamp })),
			cardDataSources: manifest.cardDataSources.map((stamp) => ({ ...stamp })),
			...(boundCanvasPath ? { boundCanvasPath } : {}),
		};
	}

	private async refreshManifestStamps(
		manifest: EpubBacklinkHighlightsCacheManifest,
		boundCanvasPath?: string | null
	): Promise<EpubBacklinkHighlightsCacheManifest | null> {
		const refreshBucket = async (
			stamps: HighlightSourceFileStamp[]
		): Promise<HighlightSourceFileStamp[] | null> => {
			const refreshed: HighlightSourceFileStamp[] = [];
			for (const stamp of stamps) {
				const current = await this.buildFileStamp(stamp.path);
				if (!current || current.mtime !== stamp.mtime || current.size !== stamp.size) {
					return null;
				}
				refreshed.push(current);
			}
			return refreshed;
		};

		const markdownSources = await refreshBucket(manifest.markdownSources);
		if (markdownSources === null) {
			return null;
		}
		const canvasSources = await refreshBucket(manifest.canvasSources);
		if (canvasSources === null) {
			return null;
		}
		const cardDataSources = await refreshBucket(manifest.cardDataSources);
		if (cardDataSources === null) {
			return null;
		}

		const normalizedBoundCanvasPath = normalizePath(
			String(boundCanvasPath || manifest.boundCanvasPath || "").trim()
		);
		return this.normalizeCacheManifest({
			markdownSources,
			canvasSources,
			cardDataSources,
			...(normalizedBoundCanvasPath ? { boundCanvasPath: normalizedBoundCanvasPath } : {}),
		});
	}

	private discoverLinkingSourcePaths(targetIdentity: EpubTargetIdentity): string[] {
		const paths = new Set<string>();
		const epubPath = targetIdentity.filePath;
		const fileName = targetIdentity.fileName;
		const resolvedLinks = this.app.metadataCache.resolvedLinks || {};
		for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
			if (!targets || typeof targets !== "object") {
				continue;
			}
			const normalizedSourcePath = normalizePath(sourcePath);
			let referencesTarget = Boolean(targets[epubPath] || (fileName && targets[fileName]));
			if (!referencesTarget) {
				for (const [targetKey, count] of Object.entries(targets)) {
					if (!count) {
						continue;
					}
					const comparableTarget = resolveComparableBookVaultPath(
						this.app,
						String(targetKey || ""),
						normalizedSourcePath
					);
					if (epubVaultPathsReferToSameBook(comparableTarget, epubPath)) {
						referencesTarget = true;
						break;
					}
				}
			}
			if (referencesTarget) {
				paths.add(normalizedSourcePath);
			}
		}

		const epubFile = this.app.vault.getAbstractFileByPath(epubPath);
		if (epubFile && this.isTFile(epubFile)) {
			const metadataCache = this.app.metadataCache as typeof this.app.metadataCache & {
				getBacklinksForFile?: (file: TFile) => { data?: Map<string, unknown> } | null;
			};
			if (typeof metadataCache.getBacklinksForFile === "function") {
				try {
					const backlinks = metadataCache.getBacklinksForFile(epubFile);
					if (backlinks?.data instanceof Map) {
						for (const key of backlinks.data.keys()) {
							paths.add(normalizePath(String(key)));
						}
					}
				} catch {
					// Obsidian backlink API is optional/undocumented.
				}
			}
		}
		const title = targetIdentity.fileName.replace(/\.epub$/i, "");
		const candidates = [
			`Notes/读书笔记/${title}.md`,
			`Notes/外文笔记/${title}.md`,
		];
		for (const candidatePath of candidates) {
			const normalizedCandidate = normalizePath(candidatePath);
			const file = this.app.vault.getAbstractFileByPath(normalizedCandidate);
			if (file && this.isTFile(file)) {
				paths.add(normalizedCandidate);
			}
		}

		return Array.from(paths).filter((path) => this.isPotentialSourceIndexPath(path));
	}

	private resolveSourcePathKind(file: TFile): EpubBacklinkSourceIndexFileKind | null {
		if (file.extension === "md") {
			return "markdown";
		}
		if (file.extension === "canvas") {
			return "canvas";
		}
		if (this.isRelevantCardDataFile(file)) {
			return "cardData";
		}
		return null;
	}

	private async supplementScopedHighlightsFromSourceIndex(
		scopedHighlights: BacklinkHighlight[],
		scopedManifest: EpubBacklinkHighlightsCacheManifest,
		targetIdentity: EpubTargetIdentity,
		boundCanvasPath?: string | null,
		prioritySourcePaths: string[] = []
	): Promise<{ highlights: BacklinkHighlight[]; manifest: EpubBacklinkHighlightsCacheManifest }> {
		const indexedCardPaths = new Set(scopedManifest.cardDataSources.map((stamp) => stamp.path));
		const missingPriorityPaths = Array.from(
			new Set(
				prioritySourcePaths
					.map((path) => normalizePath(String(path || "").trim()))
					.filter(
						(path) =>
							path &&
							this.isPotentialSourceIndexPath(path) &&
							!indexedCardPaths.has(path)
					)
			)
		);

		if (missingPriorityPaths.length > 0) {
			const collected = await this.collectHighlightsFromSourcePaths(
				targetIdentity,
				missingPriorityPaths,
				boundCanvasPath
			);
			if (collected.highlights.length > 0) {
				return {
					highlights: this.mergeBacklinkHighlightsByCfi(
						scopedHighlights,
						collected.highlights
					),
					manifest: this.mergeHighlightSourceManifests(scopedManifest, collected.manifest),
				};
			}
		}

		const sourceIndex = await this.ensureSourceIndexSnapshotUpToDate();
		const needsIndexScan = sourceIndex.files.some(
			(record) =>
				record.kind === "cardData" &&
				!indexedCardPaths.has(record.path) &&
				record.directHighlights.some((entry) =>
					this.isSameIndexedTarget(entry.target, targetIdentity, record.path)
				)
		);
		if (!needsIndexScan) {
			return { highlights: scopedHighlights, manifest: scopedManifest };
		}

		const indexHighlights = this.collectHighlightsFromSourceIndexSnapshot(
			sourceIndex,
			targetIdentity,
			boundCanvasPath
		);
		return {
			highlights: this.mergeBacklinkHighlightsByCfi(scopedHighlights, indexHighlights),
			manifest: this.buildHighlightSourceManifestFromSourceIndex(
				sourceIndex,
				targetIdentity,
				boundCanvasPath
			),
		};
	}

	private mergeHighlightSourceManifests(
		primary: EpubBacklinkHighlightsCacheManifest,
		secondary: EpubBacklinkHighlightsCacheManifest
	): EpubBacklinkHighlightsCacheManifest {
		const mergeBucket = (
			left: HighlightSourceFileStamp[],
			right: HighlightSourceFileStamp[]
		): HighlightSourceFileStamp[] => {
			const merged = new Map(left.map((stamp) => [stamp.path, stamp] as const));
			for (const stamp of right) {
				merged.set(stamp.path, stamp);
			}
			return Array.from(merged.values()).sort((leftStamp, rightStamp) =>
				leftStamp.path.localeCompare(rightStamp.path, "zh-CN")
			);
		};

		const boundCanvasPath = normalizePath(
			String(primary.boundCanvasPath || secondary.boundCanvasPath || "").trim()
		);
		return this.normalizeCacheManifest({
			markdownSources: mergeBucket(primary.markdownSources, secondary.markdownSources),
			canvasSources: mergeBucket(primary.canvasSources, secondary.canvasSources),
			cardDataSources: mergeBucket(primary.cardDataSources, secondary.cardDataSources),
			...(boundCanvasPath ? { boundCanvasPath } : {}),
		});
	}

	private mergeBacklinkHighlightsByCfi(
		existing: BacklinkHighlight[],
		incoming: BacklinkHighlight[]
	): BacklinkHighlight[] {
		const merged = new Map<string, BacklinkHighlight>();
		for (const highlight of [...existing, ...incoming]) {
			const key = getReaderHighlightIdentityKey(highlight);
			if (!key) {
				continue;
			}
			const prior = merged.get(key);
			merged.set(key, prior ? { ...prior, ...highlight } : { ...highlight });
		}
		return Array.from(merged.values());
	}

	private async collectHighlightsFromSourcePaths(
		targetIdentity: EpubTargetIdentity,
		sourcePaths: string[],
		boundCanvasPath?: string | null
	): Promise<{ highlights: BacklinkHighlight[]; manifest: EpubBacklinkHighlightsCacheManifest }> {
		const recordsByPath = new Map<string, EpubBacklinkSourceIndexFileRecord>();
		for (const path of sourcePaths) {
			const normalizedPath = normalizePath(String(path || "").trim());
			if (!normalizedPath || !this.isPotentialSourceIndexPath(normalizedPath)) {
				continue;
			}
			const file = this.app.vault.getAbstractFileByPath(normalizedPath);
			if (!(file && this.isTFile(file))) {
				continue;
			}
			const kind = this.resolveSourcePathKind(file);
			if (!kind) {
				continue;
			}
			const stamp = await this.buildFileStamp(normalizedPath);
			if (!stamp) {
				continue;
			}
			const record = await this.readSourceIndexFileRecord(
				file,
				kind,
				stamp.mtime,
				stamp.size
			);
			recordsByPath.set(normalizedPath, record);
		}

		const scopedIndex: EpubBacklinkSourceIndexSnapshot = {
			version: EPUB_BACKLINK_SOURCE_INDEX_VERSION,
			updatedAt: new Date().toISOString(),
			files: Array.from(recordsByPath.values()).sort((left, right) =>
				left.path.localeCompare(right.path, "zh-CN")
			),
		};
		return {
			highlights: this.collectHighlightsFromSourceIndexSnapshot(
				scopedIndex,
				targetIdentity,
				boundCanvasPath
			),
			manifest: this.buildHighlightSourceManifestFromSourceIndex(
				scopedIndex,
				targetIdentity,
				boundCanvasPath
			),
		};
	}

	async mayFileAffectHighlights(
		sourcePath: string,
		epubFilePath: string,
		boundCanvasPath?: string | null
	): Promise<boolean> {
		const normalizedSourcePath = normalizePath(String(sourcePath || "").trim());
		if (!normalizedSourcePath) {
			return false;
		}
		if (isEphemeralEditorHighlightSourcePath(this.app, normalizedSourcePath)) {
			return false;
		}
		if (isEpubBookmarkManagedVaultPath(this.app, normalizedSourcePath)) {
			return false;
		}
		const normalizedBoundCanvasPath = normalizePath(String(boundCanvasPath || "").trim());
		if (normalizedBoundCanvasPath && normalizedSourcePath === normalizedBoundCanvasPath) {
			return true;
		}
		if (!this.isPotentialSourceIndexPath(normalizedSourcePath)) {
			return false;
		}

		const file = this.app.vault.getAbstractFileByPath(normalizedSourcePath);
		if (!(file && this.isTFile(file))) {
			return false;
		}

		if (file.extension === "canvas") {
			const content = await this.app.vault.cachedRead(file);
			const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
			return this.contentMayReferenceTarget(content, targetIdentity);
		}

		if (file.extension === "md") {
			let content = await this.app.vault.cachedRead(file);
			if (!content || !content.includes("[!EPUB")) {
				try {
					content = await this.app.vault.read(file);
				} catch {
					/* ignore */
				}
			}
			if (!content || !content.includes("[!EPUB")) {
				return false;
			}
			const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
			return this.contentMayReferenceTarget(content, targetIdentity);
		}

		if (this.isRelevantCardDataFile(file)) {
			const content = await this.readStructuredCardDataText(file);
			if (!content) {
				return false;
			}
			const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
			return this.contentMayReferenceTarget(content, targetIdentity);
		}

		return false;
	}

	private async ensureSourceIndexSnapshotUpToDate(): Promise<EpubBacklinkSourceIndexSnapshot> {
		this.setupSourceIndexFileWatchers();
		const store = this.diskCacheLoaded
			? this.diskCacheStore || this.createEmptyDiskCacheStore()
			: await this.loadDiskCacheStore();
		const cachedSnapshot = store.sourceIndex;
		if (
			cachedSnapshot?.version === EPUB_BACKLINK_SOURCE_INDEX_VERSION &&
			this.sourceIndexVaultEventRefs.length > 0
		) {
			const incrementallyUpdated =
				await this.updateSourceIndexSnapshotIncrementally(cachedSnapshot);
			if (incrementallyUpdated) {
				this.sourceIndexPrimed = true;
				return incrementallyUpdated;
			}
		}
		const candidates = this.getSourceIndexCandidateFiles();
		const cachedByPath = new Map(
			(cachedSnapshot?.files || []).map((file) => [file.path, file] as const)
		);
		const nextFiles: EpubBacklinkSourceIndexFileRecord[] = [];
		let changed = !cachedSnapshot;

		for (const candidate of candidates) {
			const currentStamp = await this.buildFileStamp(candidate.file.path);
			const currentMTime = currentStamp?.mtime ?? 0;
			const currentSize = currentStamp?.size ?? 0;
			const cachedRecord = cachedByPath.get(candidate.file.path);
			if (
				cachedRecord &&
				cachedRecord.kind === candidate.kind &&
				cachedRecord.mtime === currentMTime &&
				cachedRecord.size === currentSize
			) {
				nextFiles.push(cachedRecord);
				continue;
			}

			changed = true;
			nextFiles.push(
				await this.readSourceIndexFileRecord(
					candidate.file,
					candidate.kind,
					currentMTime,
					currentSize
				)
			);
		}

		if (!changed && cachedSnapshot && cachedSnapshot.files.length !== candidates.length) {
			changed = true;
		}

		if (!changed && cachedSnapshot) {
			this.sourceIndexPrimed = true;
			this.touchedSourceIndexPaths.clear();
			return cachedSnapshot;
		}

		const snapshot: EpubBacklinkSourceIndexSnapshot = {
			version: EPUB_BACKLINK_SOURCE_INDEX_VERSION,
			updatedAt: new Date().toISOString(),
			files: nextFiles.sort((left, right) => left.path.localeCompare(right.path, "zh-CN")),
		};
		await this.persistSourceIndexSnapshot(snapshot);
		this.sourceIndexPrimed = true;
		this.touchedSourceIndexPaths.clear();
		return snapshot;
	}

	private async updateSourceIndexSnapshotIncrementally(
		cachedSnapshot: EpubBacklinkSourceIndexSnapshot
	): Promise<EpubBacklinkSourceIndexSnapshot | null> {
		const currentCandidates = this.getSourceIndexCandidateFiles();
		const touchedPaths = Array.from(this.touchedSourceIndexPaths).filter((path) =>
			this.isPotentialSourceIndexPath(path)
		);
		if (touchedPaths.length === 0) {
			const hasCardDataDrift = await this.hasCardDataSnapshotDrift(
				cachedSnapshot,
				currentCandidates
			);
			if (hasCardDataDrift) {
				return null;
			}
			return cachedSnapshot;
		}

		const currentByPath = new Map(
			currentCandidates.map((candidate) => [candidate.file.path, candidate] as const)
		);
		const cachedPaths = new Set(cachedSnapshot.files.map((file) => file.path));
		const touchedSet = new Set(touchedPaths);
		const nextFiles: EpubBacklinkSourceIndexFileRecord[] = [];

		for (const cachedRecord of cachedSnapshot.files) {
			const currentCandidate = currentByPath.get(cachedRecord.path);
			if (!currentCandidate) {
				if (!touchedSet.has(cachedRecord.path)) {
					return null;
				}
				continue;
			}

			if (touchedSet.has(cachedRecord.path)) {
				continue;
			}

			const currentStamp = await this.buildFileStamp(currentCandidate.file.path);
			if (!currentStamp) {
				return null;
			}

			if (
				cachedRecord.kind === currentCandidate.kind &&
				cachedRecord.mtime === currentStamp.mtime &&
				cachedRecord.size === currentStamp.size
			) {
				nextFiles.push(cachedRecord);
				continue;
			}

			nextFiles.push(
				await this.readSourceIndexFileRecord(
					currentCandidate.file,
					currentCandidate.kind,
					currentStamp.mtime,
					currentStamp.size
				)
			);
		}

		for (const touchedPath of touchedSet) {
			const currentCandidate = currentByPath.get(touchedPath);
			if (!currentCandidate) {
				continue;
			}
			const currentStamp = await this.buildFileStamp(currentCandidate.file.path);
			if (!currentStamp) {
				return null;
			}
			nextFiles.push(
				await this.readSourceIndexFileRecord(
					currentCandidate.file,
					currentCandidate.kind,
					currentStamp.mtime,
					currentStamp.size
				)
			);
		}

		for (const candidate of currentCandidates) {
			if (cachedPaths.has(candidate.file.path) || touchedSet.has(candidate.file.path)) {
				continue;
			}
			const currentStamp = await this.buildFileStamp(candidate.file.path);
			if (!currentStamp) {
				continue;
			}
			nextFiles.push(
				await this.readSourceIndexFileRecord(
					candidate.file,
					candidate.kind,
					currentStamp.mtime,
					currentStamp.size
				)
			);
		}

		nextFiles.sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
		const snapshot: EpubBacklinkSourceIndexSnapshot = {
			version: EPUB_BACKLINK_SOURCE_INDEX_VERSION,
			updatedAt: new Date().toISOString(),
			files: nextFiles,
		};
		await this.persistSourceIndexSnapshot(snapshot);
		this.touchedSourceIndexPaths.clear();
		return snapshot;
	}

	private async hasCardDataSnapshotDrift(
		cachedSnapshot: EpubBacklinkSourceIndexSnapshot,
		currentCandidates: Array<{
			file: TFile;
			kind: EpubBacklinkSourceIndexFileKind;
		}>
	): Promise<boolean> {
		const currentCardDataCandidates = currentCandidates.filter(
			(candidate) => candidate.kind === "cardData"
		);
		const cachedCardDataRecords = cachedSnapshot.files.filter(
			(record) => record.kind === "cardData"
		);

		if (currentCardDataCandidates.length !== cachedCardDataRecords.length) {
			return true;
		}

		const cachedByPath = new Map(
			cachedCardDataRecords.map((record) => [record.path, record] as const)
		);
		for (const candidate of currentCardDataCandidates) {
			const cachedRecord = cachedByPath.get(candidate.file.path);
			if (!cachedRecord) {
				return true;
			}

			const currentStamp = await this.buildFileStamp(candidate.file.path);
			if (!currentStamp) {
				return true;
			}

			if (
				cachedRecord.kind !== candidate.kind ||
				cachedRecord.mtime !== currentStamp.mtime ||
				cachedRecord.size !== currentStamp.size
			) {
				return true;
			}
		}

		return false;
	}

	private setupSourceIndexFileWatchers(): void {
		if (this.sourceIndexVaultEventRefs.length > 0) {
			return;
		}
		const on = (
			this.app.vault as typeof this.app.vault & {
				on?: (event: string, callback: (...args: unknown[]) => void) => EventRef;
			}
		).on;
		if (typeof on !== "function") {
			return;
		}
		this.sourceIndexVaultEventRefs = [
			on.call(this.app.vault, "modify", (file: TFile) => {
				this.markSourceIndexPathTouched(file?.path);
			}),
			on.call(this.app.vault, "create", (file: TFile) => {
				this.markSourceIndexPathTouched(file?.path);
			}),
			on.call(this.app.vault, "delete", (file: TFile) => {
				this.markSourceIndexPathTouched(file?.path);
			}),
			on.call(this.app.vault, "rename", (file: TFile, oldPath: string) => {
				this.markSourceIndexPathTouched(oldPath);
				this.markSourceIndexPathTouched(file?.path);
			}),
		].filter(Boolean);
	}

	private markSourceIndexPathTouched(path?: string | null): void {
		const normalizedPath = normalizePath(String(path || "").trim());
		if (!normalizedPath || !this.isPotentialSourceIndexPath(normalizedPath)) {
			return;
		}
		this.touchedSourceIndexPaths.add(normalizedPath);
	}

	isPotentialHighlightSourcePath(path: string): boolean {
		return this.isPotentialSourceIndexPath(path);
	}

	private isPotentialSourceIndexPath(path: string): boolean {
		const normalizedPath = normalizePath(String(path || "").trim());
		if (!normalizedPath) {
			return false;
		}
		if (isEphemeralEditorHighlightSourcePath(this.app, normalizedPath)) {
			return false;
		}
		if (this.isPluginInternalPath(normalizedPath)) {
			return false;
		}
		if (normalizedPath.endsWith(".md") || normalizedPath.endsWith(".canvas")) {
			return true;
		}
		const extension = normalizedPath.split(".").pop();
		if (!this.isStructuredCardDataExtension(extension)) {
			return false;
		}
		if (String(extension || "").toLowerCase() === "wdeck") {
			return true;
		}
		const v2Paths = getV2PathsFromApp(this.app);
		return normalizedPath.startsWith(`${v2Paths.memory.cards}/`);
	}

	private getSourceIndexCandidateFiles(): Array<{
		file: TFile;
		kind: EpubBacklinkSourceIndexFileKind;
	}> {
		const candidates = new Map<string, { file: TFile; kind: EpubBacklinkSourceIndexFileKind }>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (this.isPluginInternalPath(file.path)) {
				continue;
			}
			candidates.set(file.path, { file, kind: "markdown" });
		}
		for (const file of this.app.vault.getFiles()) {
			if (this.isPluginInternalPath(file.path)) {
				continue;
			}
			if (file.extension === "canvas") {
				candidates.set(file.path, { file, kind: "canvas" });
				continue;
			}
			if (this.isRelevantCardDataFile(file)) {
				candidates.set(file.path, { file, kind: "cardData" });
			}
		}
		return Array.from(candidates.values()).sort((left, right) =>
			left.file.path.localeCompare(right.file.path, "zh-CN")
		);
	}

	private isPluginInternalPath(path: string): boolean {
		const normalizedPath = normalizePath(String(path || "").trim());
		if (!normalizedPath) {
			return false;
		}
		const pluginRoots = Array.from(
			new Set(
				[this.localPluginId, CURRENT_PLUGIN_ID]
					.map((pluginId) =>
						normalizePath(String(getPluginPathsById(this.app as unknown, pluginId).root || "").trim())
					)
					.filter(Boolean)
			)
		);
		return pluginRoots.some(
			(pluginRoot) =>
				normalizedPath === pluginRoot || normalizedPath.startsWith(`${pluginRoot}/`)
		);
	}

	private async readSourceIndexFileRecord(
		file: TFile,
		kind: EpubBacklinkSourceIndexFileKind,
		mtime: number,
		size: number
	): Promise<EpubBacklinkSourceIndexFileRecord> {
		let directHighlights: IndexedBacklinkHighlightEntry[] = [];
		let canvasFileNodeBindings: IndexedCanvasFileNodeBinding[] | undefined;
		try {
			if (kind === "markdown") {
				let content = await this.app.vault.cachedRead(file);
				if (!content || !content.includes("[!EPUB")) {
					try {
						content = await this.app.vault.read(file);
					} catch {
						/* ignore */
					}
				}
				directHighlights = this.parseIndexedHighlightsFromTextContent(content, file.path);
				for (const item of directHighlights) {
					if (item.highlight.style === "reading-note") {
						logMobileEvent("READING_NOTE", "Parsed", {
							markdownPath: file.path,
							blockId: item.highlight.excerptId || "N/A",
							cfi: item.highlight.cfiRange,
							parsed: true,
						});
					}
				}
			} else if (kind === "cardData") {
				const content = await this.readStructuredCardDataText(file);
				if (!content) {
					return {
						path: file.path,
						kind,
						mtime,
						size,
						directHighlights: [],
					};
				}
				directHighlights = this.parseIndexedHighlightsFromCardDataContent(content, file.path);
			} else {
				const content = await this.app.vault.cachedRead(file);
				const parsed = this.parseIndexedCanvasContent(content, file.path);
				directHighlights = parsed.directHighlights;
				canvasFileNodeBindings = parsed.canvasFileNodeBindings;
			}
		} catch (error) {
			logger.debug("[EpubBacklinkHighlightService] Failed to index source file:", {
				path: file.path,
				kind,
				error,
			});
		}

		return {
			path: file.path,
			kind,
			mtime,
			size,
			directHighlights,
			...(canvasFileNodeBindings?.length ? { canvasFileNodeBindings } : {}),
		};
	}

	private parseIndexedHighlightsFromTextContent(
		content: string,
		sourceFile: string,
		sourceRef?: string
	): IndexedBacklinkHighlightEntry[] {
		if (!String(content || "").includes("[!EPUB")) {
			return [];
		}
		const results: IndexedBacklinkHighlightEntry[] = [];
		for (const callout of this.extractEpubCallouts(content)) {
			const resolvedLink = this.resolveCalloutLink(callout, sourceFile);
			if (!resolvedLink) continue;
			const text = this.normalizeQuotedHighlightText(
				callout.quotedText
					.split("\n")
					.map((line) => line.replace(/^>\s?/, ""))
					.join("\n"),
				callout.style
			);
			results.push({
				target: this.toIndexedTargetIdentity(resolvedLink),
				highlight: {
					cfiRange: resolvedLink.cfi,
					color: callout.color,
					style: callout.style,
					text,
					commentText: callout.commentText || undefined,
					hasCommentDivider: callout.hasCommentDivider,
					chapterIndex: resolvedLink.chapter,
					chapterTitle: callout.chapterTitle,
					sourceFile,
					sourceRef,
					excerptId: resolvedLink.excerptId,
					createdTime: callout.createdTime,
				},
			});
		}
		return results;
	}

	private parseIndexedHighlightsFromCardDataContent(
		content: string,
		sourceFile: string
	): IndexedBacklinkHighlightEntry[] {
		try {
			const parsed: unknown = JSON.parse(content);
			const results: IndexedBacklinkHighlightEntry[] = [];
			for (const card of this.extractCardsFromJson(parsed)) {
				results.push(...this.parseIndexedHighlightsFromCardDataCard(card, sourceFile));
			}
			return results;
		} catch {
			return [];
		}
	}

	private parseIndexedCanvasContent(
		content: string,
		sourceFile: string
	): {
		directHighlights: IndexedBacklinkHighlightEntry[];
		canvasFileNodeBindings: IndexedCanvasFileNodeBinding[];
	} {
		try {
			const parsed = JSON.parse(content) as { nodes?: CanvasNodeLike[] };
			const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
			const directHighlights: IndexedBacklinkHighlightEntry[] = [];
			const bindingMap = new Map<string, IndexedCanvasFileNodeBinding>();
			for (const node of nodes) {
				if (node?.type === "text" && typeof node.text === "string" && node.text.length > 0) {
					directHighlights.push(
						...this.parseIndexedHighlightsFromTextContent(node.text, sourceFile, node.id)
					);
					continue;
				}
				if (
					node?.type !== "file" ||
					typeof node.file !== "string" ||
					node.file.length === 0 ||
					typeof node.id !== "string" ||
					node.id.length === 0
				) {
					continue;
				}
				const normalizedTargetPath = normalizePath(node.file);
				if (!normalizedTargetPath) {
					continue;
				}
				const key = `${normalizedTargetPath}::${node.id}`;
				if (!bindingMap.has(key)) {
					bindingMap.set(key, {
						targetPath: normalizedTargetPath,
						nodeId: node.id,
					});
				}
			}
			return {
				directHighlights,
				canvasFileNodeBindings: Array.from(bindingMap.values()),
			};
		} catch {
			return {
				directHighlights: [],
				canvasFileNodeBindings: [],
			};
		}
	}

	private toIndexedTargetIdentity(
		resolvedLink: ResolvedCalloutLink
	): IndexedBacklinkTargetIdentity {
		const filePath = normalizePath(String(resolvedLink.filePath || ""));
		return {
			filePath,
			fileName: filePath.split("/").pop() || "",
			...(resolvedLink.sourceId ? { sourceId: resolvedLink.sourceId } : {}),
		};
	}

	private isSameIndexedTarget(
		target: IndexedBacklinkTargetIdentity,
		targetIdentity: EpubTargetIdentity,
		sourceMarkdownPath?: string
	): boolean {
		if (
			target.sourceId &&
			targetIdentity.sourceIds.some((sourceId) => sourceId === target.sourceId)
		) {
			return true;
		}
		const left = resolveComparableBookVaultPath(
			this.app,
			target.filePath,
			sourceMarkdownPath
		);
		const right = resolveComparableBookVaultPath(this.app, targetIdentity.filePath);
		return epubVaultPathsReferToSameBook(left, right);
	}

	private collectHighlightsFromSourceIndexSnapshot(
		sourceIndex: EpubBacklinkSourceIndexSnapshot,
		targetIdentity: EpubTargetIdentity,
		boundCanvasPath?: string | null
	): BacklinkHighlight[] {
		const normalizedBoundCanvasPath = normalizePath(String(boundCanvasPath || ""));
		const recordsByPath = new Map(
			sourceIndex.files.map((record) => [record.path, record] as const)
		);
		const results: BacklinkHighlight[] = [];

		for (const record of sourceIndex.files) {
			for (const entry of record.directHighlights) {
				if (this.isSameIndexedTarget(entry.target, targetIdentity, record.path)) {
					results.push(this.cloneHighlightsForCache([entry.highlight])[0]);
				}
			}
		}

		if (normalizedBoundCanvasPath) {
			const boundCanvasRecord = recordsByPath.get(normalizedBoundCanvasPath);
			if (boundCanvasRecord?.kind === "canvas") {
				for (const binding of boundCanvasRecord.canvasFileNodeBindings || []) {
					const boundSourceRecord = recordsByPath.get(binding.targetPath);
					if (!boundSourceRecord) {
						continue;
					}
					const locator = this.buildCanvasFileNodeLocator(boundCanvasRecord.path, binding.nodeId);
					for (const entry of boundSourceRecord.directHighlights) {
						if (!this.isSameIndexedTarget(entry.target, targetIdentity, boundSourceRecord.path)) {
							continue;
						}
						results.push(
							this.withAdditionalSourceLocator(
								this.cloneHighlightsForCache([entry.highlight])[0],
								locator
							)
						);
					}
				}
			}
		}

		return results;
	}

	private buildHighlightSourceManifestFromSourceIndex(
		sourceIndex: EpubBacklinkSourceIndexSnapshot,
		targetIdentity: EpubTargetIdentity,
		boundCanvasPath?: string | null
	): EpubBacklinkHighlightsCacheManifest {
		const normalizedBoundCanvasPath = normalizePath(String(boundCanvasPath || ""));
		const recordsByPath = new Map(
			sourceIndex.files.map((record) => [record.path, record] as const)
		);
		const markdownSources = new Map<string, HighlightSourceFileStamp>();
		const canvasSources = new Map<string, HighlightSourceFileStamp>();
		const cardDataSources = new Map<string, HighlightSourceFileStamp>();

		for (const record of sourceIndex.files) {
			const hasDirectMatch = record.directHighlights.some((entry) =>
				this.isSameIndexedTarget(entry.target, targetIdentity, record.path)
			);
			if (!hasDirectMatch) {
				continue;
			}
			this.addRecordToHighlightManifestBucket(
				record,
				markdownSources,
				canvasSources,
				cardDataSources
			);
		}

		if (normalizedBoundCanvasPath) {
			const boundCanvasRecord = recordsByPath.get(normalizedBoundCanvasPath);
			if (boundCanvasRecord?.kind === "canvas") {
				this.addRecordToHighlightManifestBucket(
					boundCanvasRecord,
					markdownSources,
					canvasSources,
					cardDataSources
				);
				for (const binding of boundCanvasRecord.canvasFileNodeBindings || []) {
					const sourceRecord = recordsByPath.get(binding.targetPath);
					if (!sourceRecord) {
						continue;
					}
					const hasBoundMatch = sourceRecord.directHighlights.some((entry) =>
						this.isSameIndexedTarget(entry.target, targetIdentity, sourceRecord.path)
					);
					if (!hasBoundMatch) {
						continue;
					}
					this.addRecordToHighlightManifestBucket(
						sourceRecord,
						markdownSources,
						canvasSources,
						cardDataSources
					);
				}
			}
		}

		return this.normalizeCacheManifest({
			markdownSources: Array.from(markdownSources.values()).sort((left, right) =>
				left.path.localeCompare(right.path)
			),
			canvasSources: Array.from(canvasSources.values()).sort((left, right) =>
				left.path.localeCompare(right.path)
			),
			cardDataSources: Array.from(cardDataSources.values()).sort((left, right) =>
				left.path.localeCompare(right.path)
			),
			...(normalizedBoundCanvasPath ? { boundCanvasPath: normalizedBoundCanvasPath } : {}),
		});
	}

	private addRecordToHighlightManifestBucket(
		record: EpubBacklinkSourceIndexFileRecord,
		markdownSources: Map<string, HighlightSourceFileStamp>,
		canvasSources: Map<string, HighlightSourceFileStamp>,
		cardDataSources: Map<string, HighlightSourceFileStamp>
	): void {
		const stamp: HighlightSourceFileStamp = {
			path: record.path,
			mtime: record.mtime,
			size: record.size,
		};
		if (record.kind === "markdown") {
			markdownSources.set(record.path, stamp);
			return;
		}
		if (record.kind === "canvas") {
			canvasSources.set(record.path, stamp);
			return;
		}
		cardDataSources.set(record.path, stamp);
	}

	private normalizeSourceIndexSnapshot(raw: unknown): EpubBacklinkSourceIndexSnapshot | undefined {
		if (!raw || typeof raw !== "object") {
			return undefined;
		}
		const candidate = raw as Partial<EpubBacklinkSourceIndexSnapshot>;
		if (candidate.version !== EPUB_BACKLINK_SOURCE_INDEX_VERSION) {
			return undefined;
		}
		if (!Array.isArray(candidate.files)) {
			return undefined;
		}
		const files = candidate.files
			.filter((record): record is EpubBacklinkSourceIndexFileRecord => {
				return (
					!!record &&
					typeof record === "object" &&
					typeof record.path === "string" &&
					typeof record.kind === "string" &&
					Array.isArray(record.directHighlights)
				);
			})
			.map((record) => ({
				path: normalizePath(String(record.path || "")),
				kind: record.kind,
				mtime: typeof record.mtime === "number" ? record.mtime : 0,
				size: typeof record.size === "number" ? record.size : 0,
				directHighlights: record.directHighlights
					.filter(
						(entry): entry is IndexedBacklinkHighlightEntry =>
							!!entry && typeof entry === "object" && !!entry.target && !!entry.highlight
					)
					.map((entry) => ({
						target: {
							filePath: normalizePath(String(entry.target.filePath || "")),
							fileName: String(entry.target.fileName || ""),
							...(entry.target.sourceId ? { sourceId: String(entry.target.sourceId) } : {}),
						},
						highlight: this.cloneHighlightsForCache([entry.highlight])[0],
					})),
				...(Array.isArray(record.canvasFileNodeBindings)
					? {
							canvasFileNodeBindings: record.canvasFileNodeBindings
								.filter(
									(binding): binding is IndexedCanvasFileNodeBinding =>
										!!binding && typeof binding === "object"
								)
								.map((binding) => ({
									targetPath: normalizePath(String(binding.targetPath || "")),
									nodeId: String(binding.nodeId || ""),
								}))
								.filter((binding) => binding.targetPath && binding.nodeId),
					  }
					: {}),
			}))
			.filter((record) => record.path.length > 0);
		return {
			version:
				typeof candidate.version === "string" && candidate.version.trim()
					? candidate.version
					: EPUB_BACKLINK_SOURCE_INDEX_VERSION,
			updatedAt:
				typeof candidate.updatedAt === "string" && candidate.updatedAt.trim()
					? candidate.updatedAt
					: new Date(0).toISOString(),
			files,
		};
	}

	private async persistSourceIndexSnapshot(
		sourceIndex: EpubBacklinkSourceIndexSnapshot
	): Promise<void> {
		const store = this.diskCacheLoaded
			? this.diskCacheStore || this.createEmptyDiskCacheStore()
			: await this.loadDiskCacheStore();
		const nextStore: EpubBacklinkHighlightsCacheStore = {
			...store,
			version: EPUB_BACKLINK_HIGHLIGHTS_CACHE_VERSION,
			lastUpdated: new Date().toISOString(),
			sourceIndex,
		};
		const previousWrite = this.inflightDiskCacheWrite ?? Promise.resolve();
		const writePromise = previousWrite
			.catch(() => undefined)
			.then(async () => {
				await DirectoryUtils.ensureDirForFile(this.app.vault.adapter, this.getDiskCachePath());
				await this.app.vault.adapter.write(this.getDiskCachePath(), JSON.stringify(nextStore));
				this.diskCacheStore = nextStore;
				this.diskCacheLoaded = true;
			});
		this.inflightDiskCacheWrite = writePromise;
		try {
			await writePromise;
		} finally {
			if (this.inflightDiskCacheWrite === writePromise) {
				this.inflightDiskCacheWrite = null;
			}
		}
	}

	async findSourceForCfi(
		cfiRange: string,
		epubFilePath: string,
		preferredSourceFile?: string,
		hint?: BacklinkSourceHint
	): Promise<BacklinkSourceMatch | null> {
		const normalizedTargetCfi = EpubLinkService.normalizeCfi(cfiRange);
		const allHighlights = await this.collectHighlights(epubFilePath);
		let matchedHighlights = allHighlights.filter(
			(highlight) => EpubLinkService.normalizeCfi(highlight.cfiRange) === normalizedTargetCfi
		);
		if (matchedHighlights.length === 0) {
			matchedHighlights = this.findHighlightsByHint(allHighlights, hint);
		}
		if (matchedHighlights.length === 0) {
			return null;
		}

		const normalizedPreferredPath = preferredSourceFile ? normalizePath(preferredSourceFile) : "";
		if (normalizedPreferredPath) {
			const sameSourceMatches = matchedHighlights.filter(
				(highlight) => normalizePath(highlight.sourceFile || "") === normalizedPreferredPath
			);
			const preferredMatch = this.pickPreferredSourceMatch(sameSourceMatches);
			if (preferredMatch) {
				return {
					sourceFile: preferredMatch.sourceFile,
					sourceRef: preferredMatch.sourceRef,
					excerptId: preferredMatch.excerptId,
					cfiRange: preferredMatch.cfiRange,
				};
			}
		}

		const matched = this.pickPreferredSourceMatch(matchedHighlights);
		if (!matched) {
			return null;
		}

		return {
			sourceFile: matched.sourceFile,
			sourceRef: matched.sourceRef,
			excerptId: matched.excerptId,
			cfiRange: matched.cfiRange,
		};
	}

	private findHighlightsByHint(
		highlights: BacklinkHighlight[],
		hint?: BacklinkSourceHint
	): BacklinkHighlight[] {
		const normalizedTargetText = this.normalizeHighlightText(hint?.text);
		if (!normalizedTargetText) {
			return [];
		}

		const textMatches = highlights.filter(
			(highlight) => this.normalizeHighlightText(highlight.text) === normalizedTargetText
		);
		if (textMatches.length <= 1) {
			return textMatches;
		}

		if (
			typeof hint?.createdTime === "number" &&
			Number.isFinite(hint.createdTime) &&
			hint.createdTime > 0
		) {
			const sameTimestampMatches = textMatches.filter((highlight) =>
				this.isSameHighlightTimestamp(highlight.createdTime, hint.createdTime)
			);
			if (sameTimestampMatches.length > 0) {
				return sameTimestampMatches;
			}
		}

		return textMatches;
	}

	private normalizeHighlightText(text?: string): string {
		return String(text || "")
			.replace(/\r\n/g, "\n")
			.replace(/\u00a0/g, " ")
			.replace(/[ \t]+/g, " ")
			.replace(/\n{2,}/g, "\n")
			.trim();
	}

	private stripQuotedLinePrefix(line: string): string {
		return line.replace(/^>\s?/, "");
	}

	private stripQuotedBlockLines(lines: string[]): string[] {
		return lines.map((line) => this.stripQuotedLinePrefix(line));
	}

	private toQuotedBlockLines(text: string): string[] {
		const normalized = String(text || "").replace(/\r\n?/g, "\n");
		if (!normalized) {
			return [];
		}
		return normalized.split("\n").map((line) => `> ${line}`);
	}

	private isCommentDividerLine(line: string): boolean {
		return /^>\s*(?:---div---|<!--\s*div\s*-->|<!--\s*divider\s*-->)\s*$/.test(
			String(line || "")
		);
	}

	private normalizeQuotedHighlightText(text: string, style?: EpubHighlightStyle): string {
		const filteredLines = String(text || "")
			.split("\n")
			.filter((line) => !/^\s*\[↗\s*回到原文\]\(.*?\)\s*$/.test(line));
		const rawText = filteredLines.join("\n");
		const normalizedText =
			style === "strikethrough"
				? rawText
						.split("\n")
						.map((line) => {
							const trimmed = line.trim();
							const match = trimmed.match(/^~~([\s\S]*)~~$/);
							if (!match) {
								return line;
							}
							const leadingWhitespace = line.match(/^\s*/)?.[0] || "";
							const trailingWhitespace = line.match(/\s*$/)?.[0] || "";
							return `${leadingWhitespace}${match[1]}${trailingWhitespace}`;
						})
						.join("\n")
				: rawText;

		return normalizedText.trim();
	}

	private reformatQuotedHighlightTextForStyle(
		quotedText: string,
		currentStyle?: EpubHighlightStyle,
		nextStyle?: EpubHighlightStyle
	): string {
		if (!quotedText) {
			return quotedText;
		}

		const normalizedText = this.normalizeQuotedHighlightText(
			quotedText
				.split("\n")
				.map((line) => line.replace(/^>\s?/, ""))
				.join("\n"),
			currentStyle
		);
		const formattedText = EpubLinkService.formatQuotedExcerptText(normalizedText, nextStyle);
		return formattedText
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n");
	}

	private isSameHighlightTimestamp(left?: number, right?: number): boolean {
		if (
			typeof left !== "number" ||
			!Number.isFinite(left) ||
			left <= 0 ||
			typeof right !== "number" ||
			!Number.isFinite(right) ||
			right <= 0
		) {
			return false;
		}

		return Math.abs(left - right) < 60_000;
	}

	async findSourceFileForCfi(cfiRange: string, epubFilePath: string): Promise<string | null> {
		const matchedSource = await this.findSourceForCfi(cfiRange, epubFilePath);
		if (matchedSource?.sourceFile) {
			return matchedSource.sourceFile;
		}

		const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
		const encodedCfi = EpubLinkService.encodeCfiForWikilink(cfiRange);
		const normalizedCfi = EpubLinkService.normalizeCfi(cfiRange);

		const allFiles = this.app.vault.getMarkdownFiles();
		for (const file of allFiles) {
			try {
				const content = await this.app.vault.cachedRead(file);
				if (!this.contentMayReferenceTarget(content, targetIdentity)) continue;
				if (content.includes(encodedCfi) || content.includes(cfiRange)) {
					return file.path;
				}
				const parsed = this.parseEpubCallouts(content, targetIdentity, file.path);
				for (const p of parsed) {
					if (EpubLinkService.normalizeCfi(p.cfiRange) === normalizedCfi) {
						return file.path;
					}
				}
			} catch {
				/* skip */
			}
		}

		const canvasFiles = this.app.vault.getFiles().filter((f) => f.extension === "canvas");
		for (const file of canvasFiles) {
			try {
				const content = await this.app.vault.cachedRead(file);
				if (!this.contentMayReferenceTarget(content, targetIdentity)) continue;
				if (content.includes(encodedCfi) || content.includes(cfiRange)) {
					return file.path;
				}

				const parsed = await this.parseHighlightsFromCanvasContent(
					content,
					targetIdentity,
					file.path,
					false
				);
				for (const p of parsed) {
					if (EpubLinkService.normalizeCfi(p.cfiRange) === normalizedCfi) {
						return p.sourceFile || file.path;
					}
				}
			} catch {
				/* skip */
			}
		}

		const cardDataFiles = this.getRelevantCardDataFiles();
		for (const file of cardDataFiles) {
			try {
				const content = await this.readStructuredCardDataText(file);
				if (!content) {
					continue;
				}
				if (!this.contentMayReferenceTarget(content, targetIdentity)) continue;
				const parsed = this.parseHighlightsFromCardJsonContent(content, targetIdentity, file.path);
				for (const highlight of parsed) {
					if (EpubLinkService.normalizeCfi(highlight.cfiRange) === normalizedCfi) {
						return file.path;
					}
				}
			} catch {
				/* skip */
			}
		}

		return null;
	}

	private pickPreferredSourceMatch(highlights: BacklinkHighlight[]): BacklinkHighlight | null {
		if (highlights.length === 0) {
			return null;
		}

		const cardMatch = highlights.find(
			(highlight) =>
				typeof highlight.sourceRef === "string" && highlight.sourceRef.startsWith("card:")
		);
		if (cardMatch) {
			return cardMatch;
		}

		const referencedMatch = highlights.find(
			(highlight) =>
				typeof highlight.sourceRef === "string" && highlight.sourceRef.trim().length > 0
		);
		if (referencedMatch) {
			return referencedMatch;
		}

		const markdownMatch = highlights.find((highlight) => highlight.sourceFile.endsWith(".md"));
		if (markdownMatch) {
			return markdownMatch;
		}

		const canvasMatch = highlights.find((highlight) => highlight.sourceFile.endsWith(".canvas"));
		if (canvasMatch) {
			return canvasMatch;
		}

		const wdeckMatch = highlights.find((highlight) => highlight.sourceFile.endsWith(".wdeck"));
		if (wdeckMatch) {
			return wdeckMatch;
		}

		const jsonMatch = highlights.find((highlight) => highlight.sourceFile.endsWith(".json"));
		if (jsonMatch) {
			return jsonMatch;
		}

		return highlights[0] || null;
	}

	async deleteHighlight(
		sourceFile: string,
		cfiRange: string,
		epubFilePath: string,
		sourceRef?: string,
		excerptId?: string,
		cardDeletionMode?: CardDataHighlightDeletionMode
	): Promise<boolean> {
		if (sourceFile.endsWith(".canvas")) {
			return this.deleteHighlightFromCanvas(
				sourceFile,
				cfiRange,
				epubFilePath,
				sourceRef,
				excerptId
			);
		}

		if (this.isStructuredCardDataSourcePath(sourceFile)) {
			return this.deleteHighlightFromCardData(
				sourceFile,
				cfiRange,
				epubFilePath,
				sourceRef,
				excerptId,
				cardDeletionMode
			);
		}

		try {
			const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
			const mutationLocator = await this.resolveMutationLocator(
				sourceFile,
				cfiRange,
				epubFilePath,
				excerptId
			);
			const changed = await this.processVaultTextFile(sourceFile, (content) =>
				this.removeCalloutForDeletion(
					content,
					mutationLocator.cfiRange,
					targetIdentity,
					mutationLocator.excerptId,
					sourceFile
				)
			);
			if (changed) {
				await this.notifyLinkedSourceMutation(sourceFile, "update", sourceRef);
			}
			return changed;
		} catch (error) {
logger.debug("[EpubBacklinkHighlightService] deleteHighlight failed:", error);
			return false;
		}
	}

	async inspectCardDataHighlightDeletion(
		sourceFile: string,
		cfiRange: string,
		epubFilePath: string,
		sourceRef?: string,
		excerptId?: string
	): Promise<CardDataHighlightDeletionAnalysis | null> {
		if (!this.isStructuredCardDataSourcePath(sourceFile)) {
			return null;
		}

		const file = this.app.vault.getAbstractFileByPath(sourceFile);
		if (!(file && this.isTFile(file))) {
			return null;
		}

		const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
		const content = await this.readStructuredCardDataText(file);
		if (!content) {
			return null;
		}

		try {
			const parsed: unknown = JSON.parse(content);
			const targetCardUuid = sourceRef?.startsWith("card:") ? sourceRef.slice(5) : null;

			for (const entry of this.extractCardEntriesFromJson(parsed)) {
				if (targetCardUuid && entry.card.uuid !== targetCardUuid) {
					continue;
				}

				const analysis = this.analyzeCardDataHighlightDeletionForContent(
					String(entry.card.content || ""),
					targetIdentity,
					cfiRange,
					excerptId
				);
				if (!analysis.matched) {
					continue;
				}
				return analysis;
			}
		} catch {
			return null;
		}

		return null;
	}

	async analyzeCardContentHighlightDeletion(
		content: string,
		cfiRange: string,
		epubFilePath: string,
		excerptId?: string
	): Promise<CardDataHighlightDeletionAnalysis & { remainingContent: string }> {
		const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
		return this.analyzeCardDataHighlightDeletionForContent(
			String(content || ""),
			targetIdentity,
			cfiRange,
			excerptId
		);
	}

	async changeHighlightColor(
		sourceFile: string,
		cfiRange: string,
		epubFilePath: string,
		newColor: string,
		sourceRef?: string,
		excerptId?: string
	): Promise<boolean> {
		if (sourceFile.endsWith(".canvas")) {
			return this.changeCanvasHighlightColor(
				sourceFile,
				cfiRange,
				epubFilePath,
				newColor,
				sourceRef,
				excerptId
			);
		}

		if (this.isStructuredCardDataSourcePath(sourceFile)) {
			return this.changeCardDataHighlightColor(
				sourceFile,
				cfiRange,
				epubFilePath,
				newColor,
				sourceRef,
				excerptId
			);
		}

		try {
			const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
			const mutationLocator = await this.resolveMutationLocator(
				sourceFile,
				cfiRange,
				epubFilePath,
				excerptId
			);
			const changed = await this.processVaultTextFile(sourceFile, (content) =>
				this.updateCalloutColor(
					content,
					mutationLocator.cfiRange,
					targetIdentity,
					newColor,
					mutationLocator.excerptId,
					sourceFile
				)
			);
			if (changed) {
				await this.notifyLinkedSourceMutation(sourceFile, "update", sourceRef);
			}
			return changed;
		} catch (error) {
logger.debug("[EpubBacklinkHighlightService] changeHighlightColor failed:", error);
			return false;
		}
	}

	async changeHighlightStyle(
		sourceFile: string,
		cfiRange: string,
		epubFilePath: string,
		newStyle: EpubHighlightStyle | undefined,
		sourceRef?: string,
		excerptId?: string
	): Promise<boolean> {
		if (sourceFile.endsWith(".canvas")) {
			return this.changeCanvasHighlightStyle(
				sourceFile,
				cfiRange,
				epubFilePath,
				newStyle,
				sourceRef,
				excerptId
			);
		}

		if (this.isStructuredCardDataSourcePath(sourceFile)) {
			return this.changeCardDataHighlightStyle(
				sourceFile,
				cfiRange,
				epubFilePath,
				newStyle,
				sourceRef,
				excerptId
			);
		}

		try {
			const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
			const mutationLocator = await this.resolveMutationLocator(
				sourceFile,
				cfiRange,
				epubFilePath,
				excerptId
			);
			const changed = await this.processVaultTextFile(sourceFile, (content) =>
				this.updateCalloutAppearance(
					content,
					mutationLocator.cfiRange,
					targetIdentity,
					undefined,
					newStyle,
					mutationLocator.excerptId,
					true,
					sourceFile
				)
			);
			if (changed) {
				await this.notifyLinkedSourceMutation(sourceFile, "update", sourceRef);
			}
			return changed;
		} catch (error) {
logger.debug("[EpubBacklinkHighlightService] changeHighlightStyle failed:", error);
			return false;
		}
	}

	async updateHighlightComment(
		sourceFile: string,
		cfiRange: string,
		epubFilePath: string,
		commentText: string,
		sourceRef?: string,
		excerptId?: string,
		hasCommentDivider = true
	): Promise<boolean> {
		if (sourceFile.endsWith(".canvas")) {
			return this.changeCanvasHighlightComment(
				sourceFile,
				cfiRange,
				epubFilePath,
				commentText,
				sourceRef,
				excerptId,
				hasCommentDivider
			);
		}

		if (this.isStructuredCardDataSourcePath(sourceFile)) {
			return this.changeCardDataHighlightComment(
				sourceFile,
				cfiRange,
				epubFilePath,
				commentText,
				sourceRef,
				excerptId,
				hasCommentDivider
			);
		}

		try {
			const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
			const mutationLocator = await this.resolveMutationLocator(
				sourceFile,
				cfiRange,
				epubFilePath,
				excerptId
			);
			const changed = await this.processVaultTextFile(sourceFile, (content) =>
				this.updateCalloutComment(
					content,
					mutationLocator.cfiRange,
					targetIdentity,
					commentText,
					mutationLocator.excerptId,
					hasCommentDivider,
					sourceFile
				)
			);
			if (changed) {
				await this.notifyLinkedSourceMutation(sourceFile, "update", sourceRef);
			}
			return changed;
		} catch (error) {
logger.debug("[EpubBacklinkHighlightService] updateHighlightComment failed:", error);
			return false;
		}
	}

	private getRelevantCardDataFiles() {
		return this.app.vault.getFiles().filter((file) => this.isRelevantCardDataFile(file));
	}

	private isRelevantCardDataFile(file: TFile): boolean {
		const v2Paths = getV2PathsFromApp(this.app);
		const extension = String(file.extension || "").toLowerCase();
		if (
			extension === "json" &&
			file.path.startsWith(`${v2Paths.memory.cards}/`) &&
			file.name !== "card-files-index.json"
		) {
			return true;
		}
		if (extension === "wdeck") {
			return true;
		}
		return false;
	}

	private isStructuredCardDataExtension(extension?: string): boolean {
		return STRUCTURED_CARD_DATA_FILE_EXTENSIONS.has(String(extension || "").toLowerCase());
	}

	private isStructuredCardDataSourcePath(sourcePath: string): boolean {
		const normalizedPath = normalizePath(String(sourcePath || ""));
		const extension = normalizedPath.split(".").pop();
		return this.isStructuredCardDataExtension(extension);
	}

	private async mutateCardDataHighlights(
		sourceFile: string,
		sourceRef: string | undefined,
		mutator: (content: string) => string
	): Promise<boolean> {
		try {
			const affectedCardUuids = new Set<string>();
			const changed = await this.processVaultJsonFile(sourceFile, (parsed) => {
				const cards = this.extractCardsFromJson(parsed);
				const targetCardUuid = sourceRef?.startsWith("card:") ? sourceRef.slice(5) : null;
				let hasChanges = false;

				for (const card of cards) {
					if (!card || typeof card.content !== "string") continue;
					if (targetCardUuid && card.uuid !== targetCardUuid) continue;

					const updatedContent = mutator(card.content);
					if (updatedContent !== card.content) {
						card.content = updatedContent;
						card.modified = new Date().toISOString();
						if (typeof card.uuid === "string" && card.uuid.trim().length > 0) {
							affectedCardUuids.add(card.uuid);
						}
						hasChanges = true;
						if (targetCardUuid) break;
					}
				}

				return hasChanges ? parsed : null;
			});
			if (!changed) {
				return false;
			}
			await this.notifyStructuredCardDataMutation(sourceFile, "update", affectedCardUuids);
			return true;
		} catch (error) {
logger.debug("[EpubBacklinkHighlightService] mutateCardDataHighlights failed:", error);
			return false;
		}
	}

	private async parseHighlightsFromCanvasContent(
		content: string,
		targetIdentity: EpubTargetIdentity,
		sourceFile: string,
		includeFileNodes: boolean
	): Promise<BacklinkHighlight[]> {
		try {
			const parsed = JSON.parse(content) as { nodes?: CanvasNodeLike[] };
			const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
			const results: BacklinkHighlight[] = [];

			for (const node of nodes) {
				if (node?.type === "text" && typeof node.text === "string" && node.text.length > 0) {
					results.push(...this.parseEpubCallouts(node.text, targetIdentity, sourceFile, node.id));
					continue;
				}

				if (
					!includeFileNodes ||
					node?.type !== "file" ||
					typeof node.file !== "string" ||
					node.file.length === 0
				) {
					continue;
				}

				results.push(
					...(await this.collectHighlightsFromCanvasFileNode(node, targetIdentity, sourceFile))
				);
			}

			return results;
		} catch (error) {
			void error;
			logger.debug("[EpubBacklinkHighlightService] Failed to parse canvas json:", sourceFile);
			return [];
		}
	}

	private async collectHighlightsFromCanvasFileNode(
		node: CanvasNodeLike,
		targetIdentity: EpubTargetIdentity,
		canvasPath: string
	): Promise<BacklinkHighlight[]> {
		const target = this.app.vault.getAbstractFileByPath(node.file!);
		if (!(target && this.isTFile(target))) {
			return [];
		}

		try {
			const canvasLocator = this.buildCanvasFileNodeLocator(canvasPath, node.id);
			if (target.extension === "md") {
				const content = await this.app.vault.cachedRead(target);
				return this.parseEpubCallouts(content, targetIdentity, target.path).map((highlight) =>
					this.withAdditionalSourceLocator(highlight, canvasLocator)
				);
			}
			if (this.isStructuredCardDataExtension(target.extension)) {
				const content = await this.readStructuredCardDataText(target);
				if (!content) {
					return [];
				}
				return this.parseHighlightsFromCardJsonContent(content, targetIdentity, target.path).map(
					(highlight) => this.withAdditionalSourceLocator(highlight, canvasLocator)
				);
			}
		} catch (error) {
			void error;
			logger.debug(
				"[EpubBacklinkHighlightService] Failed to read canvas file node target:",
				node.file
			);
		}

		return [];
	}

	private buildCanvasFileNodeLocator(
		canvasPath: string,
		nodeId?: string
	): HighlightSourceLocator | null {
		const normalizedCanvasPath = String(canvasPath || "").trim();
		const normalizedNodeId = String(nodeId || "").trim();
		if (!normalizedCanvasPath || !normalizedNodeId) {
			return null;
		}
		return {
			sourceFile: normalizedCanvasPath,
			sourceRef: `canvas-file-node:${normalizedNodeId}`,
		};
	}

	private withAdditionalSourceLocator(
		highlight: BacklinkHighlight,
		locator: HighlightSourceLocator | null
	): BacklinkHighlight {
		if (!locator) {
			return highlight;
		}

		const sourceLocators = this.mergeSourceLocators(highlight.sourceLocators || [], [
			{
				...locator,
				excerptId: highlight.excerptId || locator.excerptId,
			},
		]);
		return {
			...highlight,
			sourceLocators,
		};
	}

	private mergeSourceLocators(
		existing: HighlightSourceLocator[],
		incoming: HighlightSourceLocator[]
	): HighlightSourceLocator[] {
		const merged = new Map<string, HighlightSourceLocator>();
		for (const locator of [...existing, ...incoming]) {
			const sourceFile = String(locator?.sourceFile || "").trim();
			if (!sourceFile) {
				continue;
			}
			const sourceRef = String(locator?.sourceRef || "").trim();
			const excerptId = String(locator?.excerptId || "").trim();
			const key = `${sourceFile}::${sourceRef}::${excerptId}`;
			if (!merged.has(key)) {
				merged.set(key, {
					sourceFile,
					sourceRef: sourceRef || undefined,
					...(excerptId ? { excerptId } : {}),
				});
			}
		}
		return Array.from(merged.values());
	}

	private async deleteHighlightFromCanvas(
		sourceFile: string,
		cfiRange: string,
		epubFilePath: string,
		sourceRef?: string,
		excerptId?: string
	): Promise<boolean> {
		try {
			const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
			const targetNodeId = this.normalizeCanvasSourceRef(sourceRef);
			const changed = await this.processVaultJsonFile(sourceFile, (parsed) => {
				if (!parsed || typeof parsed !== "object") {
					return null;
				}
				const nodes = Array.isArray((parsed as { nodes?: unknown }).nodes)
					? ((parsed as { nodes: CanvasNodeLike[] }).nodes)
					: [];
				let changed = false;

				for (const node of nodes) {
					if (node?.type !== "text" || typeof node.text !== "string") continue;
					if (targetNodeId && node.id !== targetNodeId) continue;

					const updatedText = this.removeCallout(node.text, cfiRange, targetIdentity, excerptId);
					if (updatedText !== node.text) {
						node.text = updatedText;
						changed = true;
						if (targetNodeId) break;
					}
				}

				return changed ? parsed : null;
			});
			if (changed) {
				await this.notifyLinkedSourceMutation(sourceFile, "update", sourceRef);
			}
			return changed;
		} catch (error) {
logger.debug("[EpubBacklinkHighlightService] deleteHighlightFromCanvas failed:", error);
			return false;
		}
	}

	private async changeCanvasHighlightColor(
		sourceFile: string,
		cfiRange: string,
		epubFilePath: string,
		newColor: string,
		sourceRef?: string,
		excerptId?: string
	): Promise<boolean> {
		try {
			const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
			const targetNodeId = this.normalizeCanvasSourceRef(sourceRef);
			const changed = await this.processVaultJsonFile(sourceFile, (parsed) => {
				if (!parsed || typeof parsed !== "object") {
					return null;
				}
				const nodes = Array.isArray((parsed as { nodes?: unknown }).nodes)
					? ((parsed as { nodes: CanvasNodeLike[] }).nodes)
					: [];
				let changed = false;

				for (const node of nodes) {
					if (node?.type !== "text" || typeof node.text !== "string") continue;
					if (targetNodeId && node.id !== targetNodeId) continue;

					const updatedText = this.updateCalloutColor(
						node.text,
						cfiRange,
						targetIdentity,
						newColor,
						excerptId
					);
					if (updatedText !== node.text) {
						node.text = updatedText;
						changed = true;
						if (targetNodeId) break;
					}
				}

				return changed ? parsed : null;
			});
			if (changed) {
				await this.notifyLinkedSourceMutation(sourceFile, "update", sourceRef);
			}
			return changed;
		} catch (error) {
logger.debug("[EpubBacklinkHighlightService] changeCanvasHighlightColor failed:", error);
			return false;
		}
	}

	private async changeCanvasHighlightStyle(
		sourceFile: string,
		cfiRange: string,
		epubFilePath: string,
		newStyle: EpubHighlightStyle | undefined,
		sourceRef?: string,
		excerptId?: string
	): Promise<boolean> {
		try {
			const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
			const targetNodeId = this.normalizeCanvasSourceRef(sourceRef);
			const changed = await this.processVaultJsonFile(sourceFile, (parsed) => {
				if (!parsed || typeof parsed !== "object") {
					return null;
				}
				const nodes = Array.isArray((parsed as { nodes?: unknown }).nodes)
					? ((parsed as { nodes: CanvasNodeLike[] }).nodes)
					: [];
				let changed = false;

				for (const node of nodes) {
					if (node?.type !== "text" || typeof node.text !== "string") continue;
					if (targetNodeId && node.id !== targetNodeId) continue;

					const updatedText = this.updateCalloutAppearance(
						node.text,
						cfiRange,
						targetIdentity,
						undefined,
						newStyle,
						excerptId,
						true
					);
					if (updatedText !== node.text) {
						node.text = updatedText;
						changed = true;
						if (targetNodeId) break;
					}
				}

				return changed ? parsed : null;
			});
			if (changed) {
				await this.notifyLinkedSourceMutation(sourceFile, "update", sourceRef);
			}
			return changed;
		} catch (error) {
logger.debug("[EpubBacklinkHighlightService] changeCanvasHighlightStyle failed:", error);
			return false;
		}
	}

	private async changeCanvasHighlightComment(
		sourceFile: string,
		cfiRange: string,
		epubFilePath: string,
		commentText: string,
		sourceRef?: string,
		excerptId?: string,
		hasCommentDivider = true
	): Promise<boolean> {
		try {
			const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
			const targetNodeId = this.normalizeCanvasSourceRef(sourceRef);
			const changed = await this.processVaultJsonFile(sourceFile, (parsed) => {
				if (!parsed || typeof parsed !== "object") {
					return null;
				}
				const nodes = Array.isArray((parsed as { nodes?: unknown }).nodes)
					? ((parsed as { nodes: CanvasNodeLike[] }).nodes)
					: [];
				let changed = false;

				for (const node of nodes) {
					if (node?.type !== "text" || typeof node.text !== "string") continue;
					if (targetNodeId && node.id !== targetNodeId) continue;

					const updatedText = this.updateCalloutComment(
						node.text,
						cfiRange,
						targetIdentity,
						commentText,
						excerptId,
						hasCommentDivider
					);
					if (updatedText !== node.text) {
						node.text = updatedText;
						changed = true;
						if (targetNodeId) break;
					}
				}

				return changed ? parsed : null;
			});
			if (changed) {
				await this.notifyLinkedSourceMutation(sourceFile, "update", sourceRef);
			}
			return changed;
		} catch (error) {
logger.debug("[EpubBacklinkHighlightService] changeCanvasHighlightComment failed:", error);
			return false;
		}
	}

	private async deleteHighlightFromCardData(
		sourceFile: string,
		cfiRange: string,
		epubFilePath: string,
		sourceRef?: string,
		excerptId?: string,
		cardDeletionMode?: CardDataHighlightDeletionMode
	): Promise<boolean> {
		const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
		try {
			let mutationAction: "update" | "delete" | null = null;
			const affectedCardUuids = new Set<string>();
			const changed = await this.processVaultJsonFile(sourceFile, (parsed) => {
				const targetCardUuid = sourceRef?.startsWith("card:") ? sourceRef.slice(5) : null;
				const cardEntries = this.extractCardEntriesFromJson(parsed);
				let hasChanges = false;

				for (const entry of cardEntries) {
					if (targetCardUuid && entry.card.uuid !== targetCardUuid) {
						continue;
					}

					if (cardDeletionMode === "delete-card" && targetCardUuid) {
						hasChanges = this.removeCardDataEntry(entry);
						if (hasChanges) {
							if (typeof entry.card.uuid === "string" && entry.card.uuid.trim().length > 0) {
								affectedCardUuids.add(entry.card.uuid);
							}
							mutationAction = "delete";
							break;
						}
						continue;
					}

					const currentContent = typeof entry.card.content === "string" ? entry.card.content : "";
					const analysis = this.analyzeCardDataHighlightDeletionForContent(
						currentContent,
						targetIdentity,
						cfiRange,
						excerptId
					);
					if (!analysis.matched) {
						continue;
					}

					const effectiveMode = cardDeletionMode || analysis.recommendedMode;
					if (effectiveMode === "delete-card") {
						hasChanges = this.removeCardDataEntry(entry);
						mutationAction = "delete";
					} else if (analysis.remainingContent !== currentContent) {
						entry.card.content = analysis.remainingContent;
						entry.card.modified = new Date().toISOString();
						hasChanges = true;
						mutationAction = "update";
					}

					if (hasChanges) {
						if (typeof entry.card.uuid === "string" && entry.card.uuid.trim().length > 0) {
							affectedCardUuids.add(entry.card.uuid);
						}
						break;
					}
				}

				return hasChanges ? parsed : null;
			});
			if (!changed) {
				return false;
			}
			await this.notifyStructuredCardDataMutation(
				sourceFile,
				mutationAction || "update",
				affectedCardUuids
			);
			return true;
		} catch (error) {
logger.debug("[EpubBacklinkHighlightService] deleteHighlightFromCardData failed:", error);
			return false;
		}
	}

	private async notifyStructuredCardDataMutation(
		sourcePath: string,
		action: "update" | "delete",
		cardUuids?: Iterable<string>
	): Promise<void> {
		const normalizedSourcePath = normalizePath(String(sourcePath || "").trim());
		const normalizedCardUuids = Array.from(
			new Set(
				Array.from(cardUuids || [])
					.map((uuid) => String(uuid || "").trim())
					.filter(Boolean)
			)
		);
		const cacheHost = resolveWeaveCacheHost(this.app);

		try {
			await rebuildWdeckCacheIfNeeded(cacheHost.wdeckService, normalizedSourcePath);
			invalidateCardMetadataCache(cacheHost.cardMetadataCache, normalizedCardUuids);

			if (action === "delete") {
				removeCardIndexes(cacheHost.cardIndexService, normalizedCardUuids);
			}

			clearDeckAndAnalyticsCaches(cacheHost);
			triggerCardMutationEvents(
				cacheHost.workspace,
				action,
				normalizedCardUuids,
				normalizedSourcePath
			);

			const payload: WeaveCardMutationPayload = {
				type: "cards",
				action,
				ids: normalizedCardUuids,
				source: "epub-backlink-highlight",
				sourcePath: normalizedSourcePath,
			};
			await notifyWeaveDataSyncChange(cacheHost.dataSyncService, payload);
		} catch (error) {
			logger.warn("[EpubBacklinkHighlightService] Failed to notify card-data mutation:", {
				sourcePath: normalizedSourcePath,
				action,
				cardUuids: normalizedCardUuids,
				error,
			});
		}
	}

	private async notifyLinkedSourceMutation(
		sourcePath: string,
		action: "update" | "delete",
		sourceRef?: string
	): Promise<void> {
		const normalizedSourcePath = normalizePath(String(sourcePath || "").trim());
		if (!normalizedSourcePath) {
			return;
		}

		const normalizedCardUuid =
			typeof sourceRef === "string" && sourceRef.startsWith("card:")
				? sourceRef.slice(5).trim()
				: "";
		const ids = normalizedCardUuid ? [normalizedCardUuid] : [];
		const cacheHost = resolveWeaveCacheHost(this.app);

		try {
			await rebuildWdeckCacheIfNeeded(cacheHost.wdeckService, normalizedSourcePath);
			invalidateCardMetadataCache(cacheHost.cardMetadataCache, ids);
			clearDeckAndAnalyticsCaches(cacheHost);
			triggerCardMutationEvents(
				cacheHost.workspace,
				action,
				ids,
				normalizedSourcePath,
				true
			);

			const payload: WeaveCardMutationPayload = {
				type: "cards",
				action,
				ids,
				source: "epub-backlink-highlight",
				sourcePath: normalizedSourcePath,
			};
			await notifyWeaveDataSyncChange(cacheHost.dataSyncService, payload);
		} catch (error) {
			logger.warn("[EpubBacklinkHighlightService] Failed to notify linked-source mutation:", {
				sourcePath: normalizedSourcePath,
				action,
				sourceRef,
				error,
			});
		}
	}

	private async changeCardDataHighlightColor(
		sourceFile: string,
		cfiRange: string,
		epubFilePath: string,
		newColor: string,
		sourceRef?: string,
		excerptId?: string
	): Promise<boolean> {
		const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
		return this.mutateCardDataHighlights(sourceFile, sourceRef, (content) =>
			this.updateCalloutColor(content, cfiRange, targetIdentity, newColor, excerptId)
		);
	}

	private async changeCardDataHighlightStyle(
		sourceFile: string,
		cfiRange: string,
		epubFilePath: string,
		newStyle: EpubHighlightStyle | undefined,
		sourceRef?: string,
		excerptId?: string
	): Promise<boolean> {
		const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
		return this.mutateCardDataHighlights(sourceFile, sourceRef, (content) =>
			this.updateCalloutAppearance(
				content,
				cfiRange,
				targetIdentity,
				undefined,
				newStyle,
				excerptId,
				true
			)
		);
	}

	private async changeCardDataHighlightComment(
		sourceFile: string,
		cfiRange: string,
		epubFilePath: string,
		commentText: string,
		sourceRef?: string,
		excerptId?: string,
		hasCommentDivider = true
	): Promise<boolean> {
		const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
		return this.mutateCardDataHighlights(sourceFile, sourceRef, (content) =>
			this.updateCalloutComment(
				content,
				cfiRange,
				targetIdentity,
				commentText,
				excerptId,
				hasCommentDivider
			)
		);
	}

	private parseHighlightsFromCardJsonContent(
		content: string,
		targetIdentity: EpubTargetIdentity,
		sourceFile: string
	): BacklinkHighlight[] {
		try {
			const parsed: unknown = JSON.parse(content);
			const results: BacklinkHighlight[] = [];

			for (const card of this.extractCardsFromJson(parsed)) {
				results.push(...this.parseHighlightsFromCardDataCard(card, targetIdentity, sourceFile));
			}

			return results;
		} catch (error) {
			void error;
			logger.debug("[EpubBacklinkHighlightService] Failed to parse card json:", sourceFile);
			return [];
		}
	}

	private parseIndexedHighlightsFromCardDataCard(
		card: JsonCardLike,
		sourceFile: string
	): IndexedBacklinkHighlightEntry[] {
		const sourceRef = this.getCardDataSourceRef(card);
		const cardContent = typeof card?.content === "string" ? card.content : "";
		const calloutHighlights = cardContent
			? this.parseIndexedHighlightsFromTextContent(cardContent, sourceFile, sourceRef)
			: [];
		if (calloutHighlights.length > 0) {
			return calloutHighlights;
		}

		const resolvedLink = this.resolveCardDataEpubLink(card);
		if (!resolvedLink) {
			return [];
		}

		const bodySegments = this.extractCardDataBodySegments(cardContent, resolvedLink.cfi);
		return [
			{
				target: this.toIndexedTargetIdentity(resolvedLink),
				highlight: {
					cfiRange: resolvedLink.cfi,
					color: DEFAULT_HIGHLIGHT_COLOR,
					text: bodySegments.text,
					commentText: bodySegments.commentText,
					hasCommentDivider: bodySegments.hasCommentDivider,
					chapterIndex: resolvedLink.chapter,
					sourceFile,
					sourceRef,
					excerptId: resolvedLink.excerptId,
					createdTime: this.parseCardDataTimestamp(card),
				},
			},
		];
	}

	private parseHighlightsFromCardDataCard(
		card: JsonCardLike,
		targetIdentity: EpubTargetIdentity,
		sourceFile: string
	): BacklinkHighlight[] {
		const sourceRef = this.getCardDataSourceRef(card);
		const cardContent = typeof card?.content === "string" ? card.content : "";
		const calloutHighlights = cardContent
			? this.parseEpubCallouts(cardContent, targetIdentity, sourceFile, sourceRef)
			: [];
		if (calloutHighlights.length > 0) {
			return calloutHighlights;
		}

		const resolvedLink = this.resolveCardDataEpubLink(card);
		if (!resolvedLink || !this.isSameEpubTarget(resolvedLink, targetIdentity)) {
			return [];
		}

		const bodySegments = this.extractCardDataBodySegments(cardContent, resolvedLink.cfi);
		return [
			{
				cfiRange: resolvedLink.cfi,
				color: DEFAULT_HIGHLIGHT_COLOR,
				text: bodySegments.text,
				commentText: bodySegments.commentText,
				hasCommentDivider: bodySegments.hasCommentDivider,
				chapterIndex: resolvedLink.chapter,
				sourceFile,
				sourceRef,
				excerptId: resolvedLink.excerptId,
				createdTime: this.parseCardDataTimestamp(card),
			},
		];
	}

	private getCardDataSourceRef(card: JsonCardLike): string | undefined {
		return typeof card?.uuid === "string" && card.uuid.length > 0 ? `card:${card.uuid}` : undefined;
	}

	private analyzeCardDataHighlightDeletionForContent(
		content: string,
		targetIdentity: EpubTargetIdentity,
		cfiRange: string,
		excerptId?: string
	): CardDataHighlightDeletionAnalysis & { remainingContent: string } {
		const removedCalloutContent = this.removeCallout(content, cfiRange, targetIdentity, excerptId);
		if (removedCalloutContent !== content) {
			return this.buildCardDataHighlightDeletionAnalysis(true, removedCalloutContent);
		}

		const removedYamlSourceContent = this.removeMatchingCardDataYamlSource(
			content,
			targetIdentity,
			cfiRange,
			excerptId
		);
		if (removedYamlSourceContent !== content) {
			return this.buildCardDataHighlightDeletionAnalysis(true, removedYamlSourceContent);
		}

		const removedCalloutByLocatorContent = this.removeCalloutByLocator(content, cfiRange, excerptId);
		if (removedCalloutByLocatorContent !== content) {
			return this.buildCardDataHighlightDeletionAnalysis(true, removedCalloutByLocatorContent);
		}

		const removedYamlSourceByLocatorContent = this.removeCardDataYamlSourceByLocator(
			content,
			cfiRange,
			excerptId
		);
		if (removedYamlSourceByLocatorContent !== content) {
			return this.buildCardDataHighlightDeletionAnalysis(true, removedYamlSourceByLocatorContent);
		}

		return {
			matched: false,
			hasAdditionalContent: false,
			recommendedMode: "delete-card",
			remainingContent: content,
		};
	}

	private buildCardDataHighlightDeletionAnalysis(
		matched: boolean,
		remainingContent: string
	): CardDataHighlightDeletionAnalysis & { remainingContent: string } {
		const preview = this.extractCardDataAdditionalContentPreview(remainingContent);
		const hasAdditionalContent = preview.length > 0;
		return {
			matched,
			hasAdditionalContent,
			...(hasAdditionalContent ? { additionalContentPreview: preview } : {}),
			recommendedMode: hasAdditionalContent ? "excerpt-only" : "delete-card",
			remainingContent,
		};
	}

	private extractCardDataAdditionalContentPreview(content: string): string {
		const body = extractBodyContent(content).replace(/\r\n?/g, "\n").trim();
		if (!body) {
			return "";
		}

		const compact = body.replace(/\n{3,}/g, "\n\n");
		return compact.length > 180 ? `${compact.slice(0, 180).trim()}...` : compact;
	}

	private removeMatchingCardDataYamlSource(
		content: string,
		targetIdentity: EpubTargetIdentity,
		cfiRange: string,
		excerptId?: string
	): string {
		const yaml = parseYAMLFromContent(content);
		if (!yaml?.we_source) {
			return content;
		}

		const sourceValues = Array.isArray(yaml.we_source) ? yaml.we_source : [yaml.we_source];
		let removed = false;
		const remainingValues = sourceValues.filter((sourceValue) => {
			if (typeof sourceValue !== "string" || !sourceValue.trim()) {
				return true;
			}

			const parsedLink = EpubLinkService.parseLinkMarkup(sourceValue);
			if (!parsedLink?.cfi) {
				return true;
			}

			const resolvedLink: ResolvedCalloutLink = {
				filePath: normalizePath(String(parsedLink.filePath || "").trim()),
				cfi: parsedLink.cfi,
				chapter: parsedLink.chapter,
				sourceId: parsedLink.sourceId,
				excerptId: parsedLink.excerptId,
			};

			if (!this.isSameEpubTarget(resolvedLink, targetIdentity)) {
				return true;
			}
			if (!this.isSameExcerptTarget(resolvedLink, EpubLinkService.normalizeCfi(cfiRange), excerptId)) {
				return true;
			}

			removed = true;
			return false;
		});

		if (!removed) {
			return content;
		}

		if (remainingValues.length === 0) {
			return setCardProperty(content, "we_source", undefined);
		}

		return setCardProperty(
			content,
			"we_source",
			remainingValues.length === 1 ? remainingValues[0] : remainingValues
		);
	}

	private removeCalloutByLocator(
		content: string,
		cfiRange: string,
		excerptId?: string,
		sourceMarkdownPath?: string
	): string {
		const normalizedTargetCfi = EpubLinkService.normalizeCfi(cfiRange);
		for (const callout of this.extractEpubCallouts(content)) {
			const resolvedLink = this.resolveCalloutLink(callout, sourceMarkdownPath);
			if (!resolvedLink) {
				continue;
			}
			if (this.isSameExcerptTarget(resolvedLink, normalizedTargetCfi, excerptId)) {
				let result = content.replace(callout.fullMatch, "");
				if (result.startsWith("\n")) {
					result = result.replace(/^\n+/, "");
				}
				return result;
			}
		}
		return content;
	}

	private removeCardDataYamlSourceByLocator(
		content: string,
		cfiRange: string,
		excerptId?: string
	): string {
		const yaml = parseYAMLFromContent(content);
		if (!yaml?.we_source) {
			return content;
		}

		const normalizedTargetCfi = EpubLinkService.normalizeCfi(cfiRange);
		const sourceValues = Array.isArray(yaml.we_source) ? yaml.we_source : [yaml.we_source];
		let removed = false;
		const remainingValues = sourceValues.filter((sourceValue) => {
			if (typeof sourceValue !== "string" || !sourceValue.trim()) {
				return true;
			}

			const parsedLink = EpubLinkService.parseLinkMarkup(sourceValue);
			if (!parsedLink?.cfi) {
				return true;
			}

			const resolvedLink: ResolvedCalloutLink = {
				filePath: normalizePath(String(parsedLink.filePath || "").trim()),
				cfi: parsedLink.cfi,
				chapter: parsedLink.chapter,
				sourceId: parsedLink.sourceId,
				excerptId: parsedLink.excerptId,
			};

			if (!this.isSameExcerptTarget(resolvedLink, normalizedTargetCfi, excerptId)) {
				return true;
			}

			removed = true;
			return false;
		});

		if (!removed) {
			return content;
		}

		if (remainingValues.length === 0) {
			return setCardProperty(content, "we_source", undefined);
		}

		return setCardProperty(
			content,
			"we_source",
			remainingValues.length === 1 ? remainingValues[0] : remainingValues
		);
	}

	private parseCardDataTimestamp(card: JsonCardLike): number | undefined {
		for (const rawValue of [card?.modified, card?.created]) {
			const normalizedValue = String(rawValue || "").trim();
			if (!normalizedValue) {
				continue;
			}
			const parsed = new Date(normalizedValue).getTime();
			if (Number.isFinite(parsed)) {
				return parsed;
			}
		}
		return undefined;
	}

	private extractCardDataBodySegments(
		content: string,
		fallbackText: string
	): {
		text: string;
		commentText?: string;
		hasCommentDivider: boolean;
	} {
		const body = extractBodyContent(content || "").replace(/\r\n?/g, "\n").trim();
		if (!body) {
			return {
				text: String(fallbackText || "").trim(),
				hasCommentDivider: false,
			};
		}

		const parts = body.split(/(?:---div---|<!--\s*div\s*-->|<!--\s*divider\s*-->)/);
		const text = String(parts[0] || "").trim() || String(fallbackText || "").trim();
		const commentText =
			parts.length > 1 ? parts.slice(1).join("\n\n").trim() || undefined : undefined;
		return {
			text,
			commentText,
			hasCommentDivider: Boolean(commentText),
		};
	}

	private resolveCardDataEpubLink(card: JsonCardLike): ResolvedCalloutLink | null {
		const cardContent = typeof card?.content === "string" ? card.content : "";
		if (cardContent) {
			const yaml = parseYAMLFromContent(cardContent);
			const sourceValues = Array.isArray(yaml.we_source) ? yaml.we_source : [yaml.we_source];
			for (const sourceValue of sourceValues) {
				if (typeof sourceValue !== "string" || !sourceValue.trim()) {
					continue;
				}
				const parsedLink = EpubLinkService.parseLinkMarkup(sourceValue);
				if (!parsedLink?.cfi) {
					continue;
				}
				const normalizedFilePath = normalizePath(String(parsedLink.filePath || "").trim());
				if (!normalizedFilePath && !parsedLink.sourceId) {
					continue;
				}
				if (normalizedFilePath && !isSupportedBookPath(normalizedFilePath)) {
					continue;
				}
				return {
					filePath: normalizedFilePath,
					cfi: parsedLink.cfi,
					chapter: parsedLink.chapter,
					sourceId: parsedLink.sourceId,
					excerptId: parsedLink.excerptId,
				};
			}
		}

		const legacySourceFile = normalizePath(String(card?.sourceFile || "").trim());
		const legacySourceKind = String(card?.sourceKind || "").trim().toLowerCase();
		const legacySubunitKey = String(card?.sourceSubunitKey || "").trim();
		if (
			(!legacySourceFile || !isSupportedBookPath(legacySourceFile)) &&
			legacySourceKind !== "epub" &&
			legacySourceKind !== "book"
		) {
			return null;
		}
		if (!legacySubunitKey) {
			return null;
		}

		const parsedLegacyLink = EpubLinkService.parseLinkMarkup(legacySubunitKey);
		if (parsedLegacyLink?.cfi) {
			return {
				filePath: normalizePath(String(parsedLegacyLink.filePath || legacySourceFile || "").trim()),
				cfi: parsedLegacyLink.cfi,
				chapter: parsedLegacyLink.chapter,
				sourceId: parsedLegacyLink.sourceId,
				excerptId: parsedLegacyLink.excerptId,
			};
		}

		if (!/^readium:/i.test(legacySubunitKey) && !legacySubunitKey.includes("epubcfi(")) {
			return null;
		}

		const normalizedCfi = EpubLinkService.normalizeCfi(legacySubunitKey);
		return normalizedCfi
			? {
					filePath: legacySourceFile,
					cfi: normalizedCfi,
				}
			: null;
	}

	private extractCardArraysFromJson(parsed: unknown): JsonCardLike[][] {
		const extractedCards = this.extractCardsFromJson(parsed);
		return extractedCards.length > 0 ? [extractedCards] : [];
	}

	private extractCardsFromJson(parsed: unknown): JsonCardLike[] {
		if (!parsed || typeof parsed !== "object") {
			return [];
		}

		const cards: JsonCardLike[] = [];
		const queue: unknown[] = [parsed];
		const visited = new Set<unknown>();

		while (queue.length > 0) {
			const current = queue.shift();
			if (!current || typeof current !== "object") {
				continue;
			}
			if (visited.has(current)) {
				continue;
			}
			visited.add(current);

			if (Array.isArray(current)) {
				for (const item of current) {
					if (item && typeof item === "object") {
						queue.push(item);
					}
				}
				continue;
			}

			if (this.isJsonCardLikeObject(current)) {
				cards.push(current);
			}

			for (const value of Object.values(current)) {
				if (value && typeof value === "object") {
					queue.push(value);
				}
			}
		}

		return cards;
	}

	private extractCardEntriesFromJson(parsed: unknown): CardDataEntryContext[] {
		const entries: CardDataEntryContext[] = [];
		const visited = new Set<unknown>();

		const walk = (current: unknown, container?: unknown[] | Record<string, unknown>, key?: number | string) => {
			if (!current || typeof current !== "object") {
				return;
			}
			if (visited.has(current)) {
				return;
			}
			visited.add(current);

			if (
				container &&
				key !== undefined &&
				this.isJsonCardLikeObject(current)
			) {
				entries.push({
					card: current,
					container,
					key,
				});
			}

			if (Array.isArray(current)) {
				current.forEach((item, index) => walk(item, current, index));
				return;
			}

			for (const [childKey, childValue] of Object.entries(current)) {
				if (childValue && typeof childValue === "object") {
					walk(childValue, current, childKey);
				}
			}
		};

		walk(parsed);
		return entries;
	}

	private removeCardDataEntry(entry: CardDataEntryContext): boolean {
		if (Array.isArray(entry.container)) {
			const index = typeof entry.key === "number" ? entry.key : Number.parseInt(String(entry.key), 10);
			if (!Number.isInteger(index) || index < 0 || index >= entry.container.length) {
				return false;
			}
			entry.container.splice(index, 1);
			return true;
		}

		if (typeof entry.key !== "string") {
			return false;
		}

		if (!Object.prototype.hasOwnProperty.call(entry.container, entry.key)) {
			return false;
		}
		delete entry.container[entry.key];
		return true;
	}

	private isJsonCardLikeArray(value: unknown[]): boolean {
		return value.some((item) => this.isJsonCardLikeObject(item));
	}

	private isJsonCardLikeObject(value: unknown): value is JsonCardLike {
		return !!(
			value &&
			typeof value === "object" &&
			("content" in value ||
				"uuid" in value ||
				"sourceFile" in value ||
				"sourceSubunitKey" in value ||
				"sourceKind" in value)
		);
	}

	private isTFile(file: unknown): file is TFile {
		return !!file && typeof file === "object" && "path" in file && "extension" in file;
	}

	private getDiskCachePath(): string {
		return getPluginPathsById(this.app as unknown, this.localPluginId).cache.incrementalReading
			.epubBacklinkHighlightsCache;
	}

	private createEmptyDiskCacheStore(): EpubBacklinkHighlightsCacheStore {
		return {
			version: EPUB_BACKLINK_HIGHLIGHTS_CACHE_VERSION,
			lastUpdated: new Date(0).toISOString(),
			entries: {},
		};
	}

	private normalizeDiskCacheStore(raw: unknown): EpubBacklinkHighlightsCacheStore {
		if (!raw || typeof raw !== "object") {
			return this.createEmptyDiskCacheStore();
		}
		const candidate = raw as Partial<EpubBacklinkHighlightsCacheStore>;
		if (candidate.version !== EPUB_BACKLINK_HIGHLIGHTS_CACHE_VERSION) {
			return this.createEmptyDiskCacheStore();
		}
		const normalizedSourceIndex = this.normalizeSourceIndexSnapshot(candidate.sourceIndex);
		return {
			version:
				typeof candidate.version === "string" && candidate.version.trim()
					? candidate.version
					: EPUB_BACKLINK_HIGHLIGHTS_CACHE_VERSION,
			lastUpdated:
				typeof candidate.lastUpdated === "string" && candidate.lastUpdated.trim()
					? candidate.lastUpdated
					: new Date().toISOString(),
			entries:
				candidate.entries &&
				typeof candidate.entries === "object" &&
				!Array.isArray(candidate.entries)
					? candidate.entries
					: {},
			...(normalizedSourceIndex ? { sourceIndex: normalizedSourceIndex } : {}),
		};
	}

	private async loadDiskCacheStore(): Promise<EpubBacklinkHighlightsCacheStore> {
		if (this.diskCacheStore) {
			return this.diskCacheStore;
		}
		if (this.inflightDiskCacheLoad) {
			return this.inflightDiskCacheLoad;
		}
		const loadPromise = (async () => {
			const adapter = this.app.vault.adapter;
			const cachePath = this.getDiskCachePath();
			try {
				if (!(await adapter.exists(cachePath))) {
					const emptyStore = this.createEmptyDiskCacheStore();
					this.diskCacheStore = emptyStore;
					this.diskCacheLoaded = true;
					return emptyStore;
				}
				const content = await adapter.read(cachePath);
				const store = this.normalizeDiskCacheStore(JSON.parse(content));
				this.diskCacheStore = store;
				this.diskCacheLoaded = true;
				if (store.sourceIndex?.version === EPUB_BACKLINK_SOURCE_INDEX_VERSION) {
					this.sourceIndexPrimed = true;
				}
				return store;
			} catch (error) {
				logger.warn("[EpubBacklinkHighlightService] 读取高亮汇总缓存失败", error);
				const emptyStore = this.createEmptyDiskCacheStore();
				this.diskCacheStore = emptyStore;
				this.diskCacheLoaded = true;
				return emptyStore;
			}
		})();
		this.inflightDiskCacheLoad = loadPromise;
		try {
			return await loadPromise;
		} finally {
			if (this.inflightDiskCacheLoad === loadPromise) {
				this.inflightDiskCacheLoad = null;
			}
		}
	}

	private async readCachedHighlights(
		targetIdentity: EpubTargetIdentity,
		manifest: EpubBacklinkHighlightsCacheManifest,
		boundCanvasPath?: string | null
	): Promise<BacklinkHighlight[] | null> {
		const cacheKey = this.buildCacheKey(targetIdentity, boundCanvasPath);
		const manifestFingerprint = this.hashStableValue(manifest);
		const store = this.diskCacheLoaded
			? this.diskCacheStore || this.createEmptyDiskCacheStore()
			: await this.loadDiskCacheStore();
		const entry = store.entries[cacheKey];
		if (!entry || entry.manifestFingerprint !== manifestFingerprint) {
			return null;
		}
		return this.cloneHighlightsForCache(entry.highlights || []);
	}

	private async persistCachedHighlights(
		targetIdentity: EpubTargetIdentity,
		manifest: EpubBacklinkHighlightsCacheManifest,
		highlights: BacklinkHighlight[],
		boundCanvasPath?: string | null
	): Promise<void> {
		try {
			const cacheKey = this.buildCacheKey(targetIdentity, boundCanvasPath);
			const normalizedManifest = this.normalizeCacheManifest(manifest);
			const store = this.diskCacheLoaded
				? this.diskCacheStore || this.createEmptyDiskCacheStore()
				: await this.loadDiskCacheStore();
			const nextStore: EpubBacklinkHighlightsCacheStore = {
				...store,
				version: EPUB_BACKLINK_HIGHLIGHTS_CACHE_VERSION,
				lastUpdated: new Date().toISOString(),
				entries: {
					...store.entries,
					[cacheKey]: {
						manifestFingerprint: this.hashStableValue(normalizedManifest),
						manifest: normalizedManifest,
						savedAt: new Date().toISOString(),
						highlights: this.cloneHighlightsForCache(highlights),
					},
				},
			};
			const previousWrite = this.inflightDiskCacheWrite ?? Promise.resolve();
			const writePromise = previousWrite
				.catch(() => undefined)
				.then(async () => {
					await DirectoryUtils.ensureDirForFile(this.app.vault.adapter, this.getDiskCachePath());
					await this.app.vault.adapter.write(this.getDiskCachePath(), JSON.stringify(nextStore));
					this.diskCacheStore = nextStore;
					this.diskCacheLoaded = true;
				});
			this.inflightDiskCacheWrite = writePromise;
			try {
				await writePromise;
			} finally {
				if (this.inflightDiskCacheWrite === writePromise) {
					this.inflightDiskCacheWrite = null;
				}
			}
		} catch (error) {
			logger.warn("[EpubBacklinkHighlightService] 写入高亮汇总缓存失败", error);
		}
	}

	private async buildFileStamp(path: string): Promise<HighlightSourceFileStamp | null> {
		const normalizedPath = normalizePath(String(path || "").trim());
		if (!normalizedPath) {
			return null;
		}
		try {
			const adapter = this.app.vault.adapter as typeof this.app.vault.adapter & {
				stat?: (path: string) => Promise<{ mtime?: number; size?: number }>;
			};
			if (typeof adapter.stat === "function") {
				const stat = await adapter.stat(normalizedPath);
				return {
					path: normalizedPath,
					mtime: typeof stat?.mtime === "number" ? stat.mtime : 0,
					size: typeof stat?.size === "number" ? stat.size : 0,
				};
			}
			const file = this.app.vault.getAbstractFileByPath(normalizedPath);
			if (!(file && this.isTFile(file))) {
				return null;
			}
			return {
				path: file.path,
				mtime: typeof file.stat?.mtime === "number" ? file.stat.mtime : 0,
				size: typeof file.stat?.size === "number" ? file.stat.size : 0,
			};
		} catch {
			return null;
		}
	}

	private buildCacheKey(
		targetIdentity: EpubTargetIdentity,
		boundCanvasPath?: string | null
	): string {
		return this.hashStableValue({
			filePath: targetIdentity.filePath,
			sourceId: targetIdentity.sourceId || null,
			boundCanvasPath: normalizePath(String(boundCanvasPath || "").trim()),
		});
	}

	private cloneHighlightsForCache(highlights: BacklinkHighlight[]): BacklinkHighlight[] {
		return highlights.map((highlight) => {
			const sourceLocators = (highlight.sourceLocators || []).map((locator) => ({ ...locator }));
			return {
				...highlight,
				...(sourceLocators.length > 0 ? { sourceLocators } : {}),
			};
		});
	}

	private hashStableValue(value: unknown): string {
		return this.hashString(this.stableStringify(value));
	}

	private stableStringify(value: unknown): string {
		if (value === null || value === undefined) {
			return "null";
		}
		if (typeof value === "number") {
			return Number.isFinite(value) ? String(value) : "null";
		}
		if (typeof value === "boolean") {
			return value ? "true" : "false";
		}
		if (typeof value === "string") {
			return JSON.stringify(value);
		}
		if (Array.isArray(value)) {
			return `[${value.map((entry) => this.stableStringify(entry)).join(",")}]`;
		}
		if (value instanceof Date) {
			return JSON.stringify(value.toISOString());
		}
		if (typeof value === "object") {
			const record = value as Record<string, unknown>;
			return `{${Object.keys(record)
				.sort((left, right) => left.localeCompare(right))
				.map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`)
				.join(",")}}`;
		}
		return JSON.stringify(unknownPlainText(value));
	}

	private hashString(input: string): string {
		let hash = 2166136261;
		for (let index = 0; index < input.length; index += 1) {
			hash ^= input.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
	}

	private async resolveMutationLocator(
		sourceFile: string,
		cfiRange: string,
		epubFilePath: string,
		excerptId?: string
	): Promise<{ cfiRange: string; excerptId?: string }> {
		const indexedLocator = await this.findSourceForCfi(cfiRange, epubFilePath, sourceFile);
		if (indexedLocator?.cfiRange) {
			return {
				cfiRange: indexedLocator.cfiRange,
				excerptId: excerptId || indexedLocator.excerptId,
			};
		}

		const targetIdentity = await this.resolveTargetIdentity(epubFilePath);
		const file = this.app.vault.getAbstractFileByPath(sourceFile);
		if (!(file && this.isTFile(file))) {
			return { cfiRange, excerptId };
		}

		const content = await this.app.vault.cachedRead(file);
		const callouts = this.parseEpubCallouts(content, targetIdentity, sourceFile);
		const normalizedTargetCfi = EpubLinkService.normalizeCfi(cfiRange);
		let matches = callouts.filter(
			(callout) => EpubLinkService.normalizeCfi(callout.cfiRange) === normalizedTargetCfi
		);
		if (matches.length === 0) {
			matches = callouts.filter((callout) =>
				this.cfisReferToSameHighlightRegion(callout.cfiRange, cfiRange)
			);
		}
		if (excerptId) {
			const excerptMatches = callouts.filter((callout) => callout.excerptId === excerptId);
			if (excerptMatches.length === 1) {
				matches = excerptMatches;
			}
		}
		if (matches.length === 1) {
			return {
				cfiRange: matches[0].cfiRange,
				excerptId: excerptId || matches[0].excerptId,
			};
		}

		return { cfiRange, excerptId };
	}

	private cfisReferToSameHighlightRegion(storedCfi: string, liveCfi: string): boolean {
		const stored = EpubLinkService.normalizeCfi(storedCfi);
		const live = EpubLinkService.normalizeCfi(liveCfi);
		if (!stored || !live || stored === live) {
			return stored === live;
		}

		const stripTerminalRange = (cfi: string): string =>
			cfi.replace(/,\/\d+:\d+,\/\d+:\d+(?=\)$)/, "");
		const storedBase = stripTerminalRange(stored);
		const liveBase = stripTerminalRange(live);
		return storedBase.length > 0 && storedBase === liveBase;
	}

	private removeCalloutForDeletion(
		content: string,
		cfiRange: string,
		targetIdentity: EpubTargetIdentity,
		excerptId?: string,
		sourceMarkdownPath?: string
	): string {
		const removed = this.removeCallout(
			content,
			cfiRange,
			targetIdentity,
			excerptId,
			sourceMarkdownPath
		);
		if (removed !== content) {
			return removed;
		}
		return this.removeCalloutByLocator(content, cfiRange, excerptId, sourceMarkdownPath);
	}

	private removeCallout(
		content: string,
		cfiRange: string,
		targetIdentity: EpubTargetIdentity,
		excerptId?: string,
		sourceMarkdownPath?: string
	): string {
		let result = content;
		const normalizedTargetCfi = EpubLinkService.normalizeCfi(cfiRange);
		for (const callout of this.extractEpubCallouts(content)) {
			const resolvedLink = this.resolveCalloutLink(callout, sourceMarkdownPath);
			if (
				!resolvedLink ||
				!this.isSameEpubTarget(resolvedLink, targetIdentity, sourceMarkdownPath)
			) {
				continue;
			}
			if (this.isSameExcerptTarget(resolvedLink, normalizedTargetCfi, excerptId)) {
				result = result.replace(callout.fullMatch, "");
				if (result.startsWith("\n")) {
					result = result.replace(/^\n+/, "");
				}
				break;
			}
		}
		return result;
	}

	private updateCalloutColor(
		content: string,
		cfiRange: string,
		targetIdentity: EpubTargetIdentity,
		newColor: string,
		excerptId?: string,
		sourceMarkdownPath?: string
	): string {
		return this.updateCalloutAppearance(
			content,
			cfiRange,
			targetIdentity,
			newColor,
			undefined,
			excerptId,
			false,
			sourceMarkdownPath
		);
	}

	private updateCalloutAppearance(
		content: string,
		cfiRange: string,
		targetIdentity: EpubTargetIdentity,
		newColor?: string,
		newStyle?: EpubHighlightStyle,
		excerptId?: string,
		applyStyle = false,
		sourceMarkdownPath?: string
	): string {
		const normalizedTargetCfi = EpubLinkService.normalizeCfi(cfiRange);
		for (const callout of this.extractEpubCallouts(content)) {
			const resolvedLink = this.resolveCalloutLink(callout, sourceMarkdownPath);
			if (
				!resolvedLink ||
				!this.isSameEpubTarget(resolvedLink, targetIdentity, sourceMarkdownPath)
			) {
				continue;
			}
			if (this.isSameExcerptTarget(resolvedLink, normalizedTargetCfi, excerptId)) {
				const oldCalloutBlock = callout.fullMatch;
				const oldCalloutHeader = oldCalloutBlock.split("\n")[0];
				const nextStyle = applyStyle ? newStyle : callout.style;
				const metaValue = EpubLinkService.buildHighlightCalloutMeta(
					newColor ?? callout.color,
					nextStyle
				);
				const newCalloutHeader = oldCalloutHeader.replace(
					/> \[!EPUB(?:\|[^\]]+)?\]/,
					metaValue ? `> [!EPUB|${metaValue}]` : "> [!EPUB]"
				);
				const newQuotedText = applyStyle
					? this.reformatQuotedHighlightTextForStyle(callout.quotedText, callout.style, nextStyle)
					: callout.quotedText;
				const newCalloutBlock = [newCalloutHeader, newQuotedText, callout.commentBlock]
					.filter((part) => part.length > 0)
					.join("\n");
				return content.replace(
					oldCalloutBlock,
					`${newCalloutBlock}${oldCalloutBlock.endsWith("\n") ? "\n" : ""}`
				);
			}
		}
		return content;
	}

	private updateCalloutComment(
		content: string,
		cfiRange: string,
		targetIdentity: EpubTargetIdentity,
		commentText: string,
		excerptId?: string,
		hasCommentDivider = true,
		sourceMarkdownPath?: string
	): string {
		const normalizedTargetCfi = EpubLinkService.normalizeCfi(cfiRange);
		for (const callout of this.extractEpubCallouts(content)) {
			const resolvedLink = this.resolveCalloutLink(callout, sourceMarkdownPath);
			if (
				!resolvedLink ||
				!this.isSameEpubTarget(resolvedLink, targetIdentity, sourceMarkdownPath)
			) {
				continue;
			}
			if (this.isSameExcerptTarget(resolvedLink, normalizedTargetCfi, excerptId)) {
				const oldCalloutBlock = callout.fullMatch;
				const oldCalloutHeader = oldCalloutBlock.split("\n")[0];
				const normalizedComment = String(commentText || "").replace(/\r\n?/g, "\n");
				const dividerMarker = callout.dividerMarker || "> ---div---";
				const nextCommentBlock = hasCommentDivider
					? [dividerMarker, ...this.toQuotedBlockLines(normalizedComment)].join("\n")
					: "";
				const newCalloutBlock = [oldCalloutHeader, callout.quotedText, nextCommentBlock]
					.filter((part) => part.length > 0)
					.join("\n");
				return content.replace(
					oldCalloutBlock,
					`${newCalloutBlock}${oldCalloutBlock.endsWith("\n") ? "\n" : ""}`
				);
			}
		}
		return content;
	}

	private isSameExcerptTarget(
		resolvedLink: ResolvedCalloutLink,
		normalizedTargetCfi: string,
		excerptId?: string
	): boolean {
		if (excerptId && resolvedLink.excerptId) {
			return resolvedLink.excerptId === excerptId;
		}
		const normalizedStoredCfi = EpubLinkService.normalizeCfi(resolvedLink.cfi);
		if (normalizedStoredCfi === normalizedTargetCfi) {
			return true;
		}
		return this.cfisReferToSameHighlightRegion(resolvedLink.cfi, normalizedTargetCfi);
	}

	private normalizeCanvasSourceRef(sourceRef?: string): string | undefined {
		if (!sourceRef) return undefined;
		return sourceRef.startsWith("canvas:") ? sourceRef.slice(7) : sourceRef;
	}

	private async processVaultTextFile(
		sourcePath: string,
		mutator: (content: string) => string
	): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file && this.isTFile(file))) {
			return false;
		}

		const updatedInOpenEditor = await this.tryProcessOpenMarkdownFile(sourcePath, mutator);
		if (updatedInOpenEditor !== null) {
			return updatedInOpenEditor;
		}

		const current = await this.readVaultFileText(file);
		const updated = mutator(current);
		if (updated === current) {
			return false;
		}

		await this.writeVaultFileText(file, updated);
		return true;
	}

	private async processVaultJsonFile(
		sourcePath: string,
		mutator: (parsed: unknown) => object | null
	): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file && this.isTFile(file))) {
			return false;
		}

		const content = await this.readVaultFileText(file);
		const parsed: unknown = JSON.parse(content);
		const updatedParsed = mutator(parsed);
		if (!updatedParsed) {
			return false;
		}
		const updated = JSON.stringify(updatedParsed);
		if (updated === content) {
			return false;
		}

		await this.writeVaultFileText(file, updated);
		return true;
	}

	private async tryProcessOpenMarkdownFile(
		sourcePath: string,
		mutator: (content: string) => string
	): Promise<boolean | null> {
		const views = this.getOpenMarkdownViewsForPath(sourcePath);
		if (views.length === 0) {
			return null;
		}

		let changed = false;
		for (const view of views) {
			const editor = view.editor;
			const current = editor?.getValue?.();
			if (typeof current !== "string") {
				continue;
			}

			const updated = mutator(current);
			if (updated === current) {
				continue;
			}

			editor?.setValue?.(updated);
			changed = true;
		}

		if (!changed) {
			return false;
		}

		for (const view of views) {
			if (typeof view.save === "function") {
				await view.save();
			}
		}

		return true;
	}

	private getOpenMarkdownViewsForPath(sourcePath: string): OpenMarkdownViewLike[] {
		const normalizedSourcePath = normalizePath(sourcePath);
		return this.app.workspace
			.getLeavesOfType("markdown")
			.map((leaf) => leaf.view)
			.filter((view): view is OpenMarkdownViewLike => {
				if (!view || typeof view !== "object") {
					return false;
				}
				const path =
					"file" in view &&
					view.file &&
					typeof view.file === "object" &&
					"path" in view.file &&
					typeof view.file.path === "string"
						? normalizePath(view.file.path)
						: "";
				return (
					path === normalizedSourcePath &&
					"editor" in view &&
					view.editor &&
					typeof view.editor === "object" &&
					"getValue" in view.editor &&
					typeof view.editor.getValue === "function" &&
					"setValue" in view.editor &&
					typeof view.editor.setValue === "function"
				);
			});
	}

	private async readVaultFileText(file: TFile): Promise<string> {
		const adapter = this.app.vault.adapter;
		if (adapter && typeof adapter.read === "function") {
			return await adapter.read(file.path);
		}
		return await this.app.vault.cachedRead(file);
	}

	private async writeVaultFileText(file: TFile, updated: string): Promise<void> {
		const vault = this.app.vault as typeof this.app.vault & {
			modify?: (file: TFile, data: string) => Promise<void>;
			process?: (file: TFile, fn: () => string) => Promise<void>;
		};
		if (typeof vault.modify === "function") {
			await vault.modify(file, updated);
			return;
		}

		if (typeof vault.process === "function") {
			await vault.process(file, () => updated);
			return;
		}

		const adapter = this.app.vault.adapter;
		if (adapter && typeof adapter.write === "function") {
			await adapter.write(file.path, updated);
			return;
		}

		throw new Error(`Unable to write vault file: ${file.path}`);
	}

	private async readStructuredCardDataText(file: TFile): Promise<string | null> {
		try {
			const raw = await this.readVaultFileText(file);
			JSON.parse(raw);
			return raw;
		} catch (error) {
			const recovered = await safeReadJson<unknown>(
				this.app.vault.adapter as {
					read: (path: string) => Promise<string>;
					exists: (path: string) => Promise<boolean>;
					write: (path: string, data: string) => Promise<void>;
				},
				file.path,
				this.app as { vault: { configDir: string } }
			);
			if (recovered !== null) {
				return JSON.stringify(recovered);
			}
			logger.debug("[EpubBacklinkHighlightService] Failed to recover card data json:", {
				path: file.path,
				error,
			});
			return null;
		}
	}

	private parseEpubCallouts(
		content: string,
		targetIdentity: EpubTargetIdentity,
		sourceFile: string,
		sourceRef?: string
	): BacklinkHighlight[] {
		const results: BacklinkHighlight[] = [];
		for (const callout of this.extractEpubCallouts(content)) {
			const quotedBody = callout.quotedText;
			const resolvedLink = this.resolveCalloutLink(callout, sourceFile);
			if (!resolvedLink || !this.isSameEpubTarget(resolvedLink, targetIdentity, sourceFile)) {
				continue;
			}

			const text = quotedBody
				.split("\n")
				.map((line: string) => line.replace(/^>\s?/, ""))
				.join("\n");

			results.push({
				cfiRange: resolvedLink.cfi,
				color: callout.color,
				style: callout.style,
				text: this.normalizeQuotedHighlightText(text, callout.style),
				commentText: callout.commentText || undefined,
				hasCommentDivider: callout.hasCommentDivider,
				chapterIndex: resolvedLink.chapter,
				chapterTitle: callout.chapterTitle,
				sourceFile,
				sourceRef,
				excerptId: resolvedLink.excerptId || callout.excerptBlockId,
				createdTime: callout.createdTime,
			});
		}

		return results;
	}

	private normalizeHighlightColor(color?: string): string {
		return EpubLinkService.normalizeHighlightColorToken(color) || "yellow";
	}

	private extractEpubCallouts(content: string): ParsedEpubCallout[] {
		const results: ParsedEpubCallout[] = [];
		const normalized = content.replace(/\r\n/g, "\n");
		const lines = normalized.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const header = lines[i];
			const headerMatch = header.match(/^> \[!EPUB(?:\|([^\]]+))?\][-+]?\s*(.*)$/);
			if (!headerMatch) continue;

			const rest = headerMatch[2] || "";
			const linkMarkup = EpubLinkService.extractFirstEpubLinkMarkup(rest);
			if (!linkMarkup) continue;
			const linkStart = rest.indexOf(linkMarkup);
			if (linkStart === -1) continue;
			const linkEnd = linkStart + linkMarkup.length;

			const bodyLines: string[] = [];
			let j = i + 1;
			while (j < lines.length && lines[j].startsWith(">")) {
				bodyLines.push(lines[j]);
				j++;
			}

			let excerptBlockId: string | undefined;
			if (j < lines.length) {
				const blockRefMatch = lines[j].match(/^\^([A-Za-z0-9-]+)\s*$/);
				if (blockRefMatch?.[1]) {
					excerptBlockId = blockRefMatch[1];
					j++;
				}
			}

			const dividerIndex = bodyLines.findIndex((line) => this.isCommentDividerLine(line));
			const quoteLines = dividerIndex >= 0 ? bodyLines.slice(0, dividerIndex) : bodyLines;
			const commentLines = dividerIndex >= 0 ? bodyLines.slice(dividerIndex + 1) : [];
			const commentBlock = dividerIndex >= 0 ? bodyLines.slice(dividerIndex).join("\n") : "";
			const blockLines = [header, ...bodyLines];
			if (excerptBlockId) {
				blockLines.push(`^${excerptBlockId}`);
			}
			const fullMatch = `${blockLines.join("\n")}${j < lines.length ? "\n" : ""}`;
			const appearance = EpubLinkService.parseHighlightCalloutMeta(headerMatch[1] || "");
			results.push({
				color: this.normalizeHighlightColor(appearance.color),
				style: appearance.style,
				linkMarkup,
				quotedText: quoteLines.join("\n"),
				commentText: this.stripQuotedBlockLines(commentLines).join("\n").trim(),
				hasCommentDivider: dividerIndex >= 0,
				commentBlock,
				dividerMarker: dividerIndex >= 0 ? bodyLines[dividerIndex].trim() : undefined,
				chapterTitle: this.parseCalloutChapterTitle(rest.slice(linkEnd).trim()),
				fullMatch,
				createdTime: this.parseCalloutTimestamp(rest.slice(linkEnd).trim()),
				excerptBlockId,
			});
			i = j - 1;
		}

		return results;
	}

	private parseCalloutTimestamp(raw: string): number | undefined {
		if (!raw) return undefined;
		const match = raw.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})(?::\d{2})?$/);
		if (!match) return undefined;
		const parsed = new Date(match[1].replace(" ", "T"));
		const time = parsed.getTime();
		return Number.isFinite(time) ? time : undefined;
	}

	private parseCalloutChapterTitle(raw: string): string | undefined {
		if (!raw) return undefined;
		const match = raw.match(/\[([^\]]+)\](?:\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)?$/);
		const title = String(match?.[1] || "").trim();
		return title || undefined;
	}

	private resolveCalloutLink(
		callout: ParsedEpubCallout,
		sourceMarkdownPath?: string
	): ResolvedCalloutLink | null {
		const parsed = EpubLinkService.parseLinkMarkup(callout.linkMarkup);
		if (!parsed?.cfi) {
			return null;
		}
		const rawFilePath = String(parsed.filePath || "").trim();
		const resolvedFilePath =
			resolveComparableBookVaultPath(this.app, rawFilePath, sourceMarkdownPath) || rawFilePath;
		return {
			filePath: resolvedFilePath,
			cfi: parsed.cfi,
			chapter: parsed.chapter,
			sourceId: parsed.sourceId,
			excerptId: parsed.excerptId || callout.excerptBlockId,
		};
	}

	private isSameEpubTarget(
		link: ResolvedCalloutLink,
		targetIdentity: EpubTargetIdentity,
		sourceMarkdownPath?: string
	): boolean {
		if (link.sourceId && targetIdentity.sourceIds.includes(link.sourceId)) {
			return true;
		}

		const left = resolveComparableBookVaultPath(this.app, link.filePath, sourceMarkdownPath);
		const right = resolveComparableBookVaultPath(this.app, targetIdentity.filePath);
		return epubVaultPathsReferToSameBook(left, right);
	}

	private textMayReferenceTarget(text: string, targetIdentity: EpubTargetIdentity): boolean {
		const normalizedText = String(text || "");
		if (!normalizedText) {
			return false;
		}

		if (targetIdentity.fileName && normalizedText.includes(targetIdentity.fileName)) {
			return true;
		}

		return targetIdentity.sourceIds.some((sourceId) => normalizedText.includes(`sid=${sourceId}`));
	}

	private contentMayReferenceTarget(content: string, targetIdentity: EpubTargetIdentity): boolean {
		if (this.textMayReferenceTarget(content, targetIdentity)) {
			return true;
		}

		try {
			const parsed: unknown = JSON.parse(content);
			for (const card of this.extractCardsFromJson(parsed)) {
				if (this.textMayReferenceTarget(String(card.content || ""), targetIdentity)) {
					return true;
				}
				const resolvedLink = this.resolveCardDataEpubLink(card);
				if (resolvedLink && this.isSameEpubTarget(resolvedLink, targetIdentity)) {
					return true;
				}
			}
		} catch {
			/* non-json content */
		}

		return false;
	}

	private async resolveTargetIdentity(epubFilePath: string): Promise<EpubTargetIdentity> {
		const normalizedPath = normalizePath(epubFilePath || "");
		let sourceId: string | undefined;
		let sourceIds: string[] = [];

		if (normalizedPath) {
			try {
				const sourceEntry = await this.storageService.ensureSourceIdentity(normalizedPath);
				sourceId = sourceEntry?.sourceId;
				sourceIds = Array.from(
					new Set(
						[sourceEntry?.sourceId, ...(sourceEntry?.legacySourceIds || [])].filter(
							(value): value is string => Boolean(String(value || "").trim())
						)
					)
				);
			} catch (error) {
				logger.debug("[EpubBacklinkHighlightService] Failed to resolve EPUB source identity:", {
					epubFilePath: normalizedPath,
					error,
				});
			}
		}

		return {
			filePath: normalizedPath,
			fileName: normalizedPath.split("/").pop() || "",
			sourceId,
			sourceIds,
		};
	}
}
