import { t } from "../../utils/i18n";
import { generateCardUUID } from "../identifier/WeaveIDGenerator";
import type { EpubBacklinkHighlightService } from "./EpubBacklinkHighlightService";
import { EpubLinkService } from "./EpubLinkService";
import { getReaderHighlightIdentityKey } from "./highlight/highlight-identity";
import type { EpubStorageService } from "./EpubStorageService";
import type { HighlightSourceLocator, ReaderHighlight } from "./reader-engine-types";
import { resolveDisplayProgress } from "./book-progress";
import type { ConcealedText, HighlightColor } from "./types";
import { logger } from "../../utils/logger";

export class EpubAnnotationService {
	private storageService: EpubStorageService;
	private clearedLegacyHighlightBooks = new Set<string>();
	private collectedHighlightsCache = new Map<string, ReaderHighlight[]>();
	private inflightCollectedHighlights = new Map<string, Promise<ReaderHighlight[]>>();

	constructor(storageService: EpubStorageService) {
		this.storageService = storageService;
	}

	invalidateCollectedHighlightsCache(bookId?: string, filePath?: string): void {
		const normalizedBookId = String(bookId || "").trim();
		const normalizedFilePath = String(filePath || "").trim();
		if (!normalizedBookId && !normalizedFilePath) {
			this.collectedHighlightsCache.clear();
			this.inflightCollectedHighlights.clear();
			return;
		}

		for (const key of Array.from(this.collectedHighlightsCache.keys())) {
			if (this.matchesCollectedHighlightsCacheKey(key, normalizedBookId, normalizedFilePath)) {
				this.collectedHighlightsCache.delete(key);
			}
		}
		for (const key of Array.from(this.inflightCollectedHighlights.keys())) {
			if (this.matchesCollectedHighlightsCacheKey(key, normalizedBookId, normalizedFilePath)) {
				this.inflightCollectedHighlights.delete(key);
			}
		}
	}

	async createConcealedText(
		bookId: string,
		text: string,
		chapterIndex: number,
		cfiRange: string,
		mode: ConcealedText["mode"] = "mask"
	): Promise<ConcealedText> {
		const concealedText: ConcealedText = {
			id: generateCardUUID(),
			text,
			mode,
			chapterIndex,
			cfiRange,
			createdTime: Date.now(),
		};

		await this.storageService.addConcealedText(bookId, concealedText);
		return concealedText;
	}

	async createDirectHighlight(
		bookId: string,
		highlight: {
			cfiRange: string;
			color: string;
			style?: EpubHighlightStyle;
			text: string;
			chapterIndex?: number;
			chapterTitle?: string;
			createdTime?: number;
		}
	): Promise<void> {
		logger.logHighlightDebugToFile('ENTER: EpubAnnotationService.createDirectHighlight', { bookId, cfiRange: highlight.cfiRange, color: highlight.color, style: highlight.style });
		try {
			await this.storageService.addDirectHighlight(bookId, {
				cfiRange: highlight.cfiRange,
				color: highlight.color,
				style: highlight.style,
				text: highlight.text,
				chapterIndex: highlight.chapterIndex,
				chapterTitle: highlight.chapterTitle,
				createdTime: highlight.createdTime || Date.now(),
			});
			logger.logHighlightDebugToFile('SUCCESS: EpubAnnotationService.createDirectHighlight completed', { bookId });
			this.invalidateCollectedHighlightsCache(bookId);
		} catch (err: any) {
			logger.logHighlightDebugToFile('ERROR: EpubAnnotationService.createDirectHighlight failed', { error: err?.message || err });
			throw err;
		}
	}

	async deleteDirectHighlightByCfi(bookId: string, cfiRange: string): Promise<void> {
		await this.storageService.deleteDirectHighlightByCfi(bookId, cfiRange);
		this.invalidateCollectedHighlightsCache(bookId);
	}

	async updateDirectHighlight(
		bookId: string,
		cfiRange: string,
		updates: { color?: string; style?: EpubHighlightStyle }
	): Promise<void> {
		await this.storageService.updateDirectHighlight(bookId, cfiRange, updates);
		this.invalidateCollectedHighlightsCache(bookId);
	}

	async deleteConcealedTextByCfi(bookId: string, cfiRange: string): Promise<void> {
		const normalizedTarget = EpubLinkService.normalizeCfi(cfiRange);
		const concealedTexts = await this.storageService.loadConcealedTexts(bookId);
		const filtered = concealedTexts.filter(
			(item) => EpubLinkService.normalizeCfi(item.cfiRange) !== normalizedTarget
		);
		await this.storageService.saveConcealedTexts(bookId, filtered);
	}

	async getConcealedTexts(bookId: string): Promise<ConcealedText[]> {
		return await this.storageService.loadConcealedTexts(bookId);
	}

	async exportToMarkdown(
		bookId: string,
		options: {
			filePath?: string;
			backlinkService?: EpubBacklinkHighlightService;
		} = {}
	): Promise<string> {
		const book = await this.storageService.getBook(bookId);
		if (!book) {
			throw new Error("Book not found");
		}

		const liveHighlights =
			options.backlinkService && (options.filePath || book.filePath)
				? await this.collectAllHighlights(
						bookId,
						options.filePath || book.filePath,
						options.backlinkService
				  )
				: [];
		const highlights = liveHighlights.filter(
			(item): item is ReaderHighlight & { color: HighlightColor; text: string } =>
				item.presentation === "highlight" && item.color !== "mask" && typeof item.text === "string"
		);
		const linkService = new EpubLinkService(this.storageService.getApp());

		let markdown = `# ${book.metadata.title} - ${t("epub.export.readingNotes")}\n\n`;
		markdown += `## ${t("epub.export.bookInfo")}\n\n`;
		markdown += `- **${t("epub.export.author")}**: ${book.metadata.author}\n`;
		if (book.metadata.publisher) {
			markdown += `- **${t("epub.export.publisher")}**: ${book.metadata.publisher}\n`;
		}
		if (book.metadata.isbn) {
			markdown += `- **ISBN**: ${book.metadata.isbn}\n`;
		}
		markdown += `- **${t("epub.export.readingProgress")}**: ${resolveDisplayProgress(book)}%\n`;
		markdown += "\n";

		if (highlights.length > 0) {
			markdown += `## ${t("epub.export.highlights")}\n\n`;
			const sortedHighlights = [...highlights].sort((a, b) => {
				const timeA = typeof a.createdTime === "number" ? a.createdTime : 0;
				const timeB = typeof b.createdTime === "number" ? b.createdTime : 0;
				if (timeA !== timeB) {
					return timeA - timeB;
				}
				const chapterA =
					typeof a.chapterIndex === "number" ? a.chapterIndex : Number.MAX_SAFE_INTEGER;
				const chapterB =
					typeof b.chapterIndex === "number" ? b.chapterIndex : Number.MAX_SAFE_INTEGER;
				if (chapterA !== chapterB) {
					return chapterA - chapterB;
				}
				return a.text.localeCompare(b.text, "zh-CN");
			});

			for (const highlight of sortedHighlights) {
				markdown += linkService.buildQuoteBlock(
					options.filePath || book.filePath,
					highlight.cfiRange,
					highlight.text,
					highlight.chapterIndex,
					highlight.color,
					highlight.chapterTitle,
					this.formatHighlightTimestamp(highlight.createdTime),
					undefined,
					book.sourceId,
					highlight.excerptId,
					highlight.style
				);
				markdown += "\n";
			}
		}

		return markdown;
	}

	private formatHighlightTimestamp(timestamp?: number): string | undefined {
		if (!timestamp || !Number.isFinite(timestamp)) {
			return undefined;
		}
		const date = new Date(timestamp);
		if (Number.isNaN(date.getTime())) {
			return undefined;
		}
		const y = date.getFullYear();
		const mo = String(date.getMonth() + 1).padStart(2, "0");
		const d = String(date.getDate()).padStart(2, "0");
		const h = String(date.getHours()).padStart(2, "0");
		const mi = String(date.getMinutes()).padStart(2, "0");
		return `${y}-${mo}-${d} ${h}:${mi}`;
	}

	private buildCollectedHighlightsCacheKey(
		bookId: string,
		filePath: string,
		boundCanvasPath?: string | null
	): string {
		return [
			String(bookId || "").trim(),
			String(filePath || "").trim(),
			String(boundCanvasPath || "").trim(),
		].join("::");
	}

	private matchesCollectedHighlightsCacheKey(
		key: string,
		bookId?: string,
		filePath?: string
	): boolean {
		const [cachedBookId = "", cachedFilePath = ""] = key.split("::");
		if (bookId && cachedBookId !== bookId) {
			return false;
		}
		if (filePath && cachedFilePath !== filePath) {
			return false;
		}
		return true;
	}

	private cloneCollectedHighlights(highlights: ReaderHighlight[]): ReaderHighlight[] {
		return highlights.map((highlight) => {
			const sourceLocators = Array.isArray(highlight.sourceLocators)
				? highlight.sourceLocators.map((locator) => ({ ...locator }))
				: undefined;
			return {
				...highlight,
				...(sourceLocators ? { sourceLocators } : {}),
			};
		});
	}

	private async clearLegacyHighlightCache(bookId: string): Promise<void> {
		if (this.clearedLegacyHighlightBooks.has(bookId)) {
			return;
		}
		await this.storageService.removeLegacyHighlights(bookId);
		this.clearedLegacyHighlightBooks.add(bookId);
	}

	private collectHighlightSourceLocators(highlight: {
		sourceFile?: string;
		sourceRef?: string;
		excerptId?: string;
		sourceLocators?: HighlightSourceLocator[];
	}): HighlightSourceLocator[] {
		const locators: HighlightSourceLocator[] = [];
		const primarySourceFile = String(highlight.sourceFile || "").trim();
		if (primarySourceFile) {
			locators.push({
				sourceFile: primarySourceFile,
				sourceRef: highlight.sourceRef,
				...(highlight.excerptId ? { excerptId: highlight.excerptId } : {}),
			});
		}
		for (const locator of highlight.sourceLocators || []) {
			const sourceFile = String(locator?.sourceFile || "").trim();
			if (!sourceFile) continue;
			locators.push({
				sourceFile,
				sourceRef: locator.sourceRef,
				...(locator.excerptId ? { excerptId: locator.excerptId } : {}),
			});
		}
		return this.mergeHighlightSourceLocators([], locators);
	}

	private mergeHighlightSourceLocators(
		existing: HighlightSourceLocator[],
		incoming: HighlightSourceLocator[]
	): HighlightSourceLocator[] {
		const merged = new Map<string, HighlightSourceLocator>();
		for (const locator of [...existing, ...incoming]) {
			const sourceFile = String(locator?.sourceFile || "").trim();
			if (!sourceFile) continue;
			const normalizedRef = String(locator?.sourceRef || "").trim();
			const normalizedExcerptId = String(locator?.excerptId || "").trim();
			const key = `${sourceFile}::${normalizedRef}::${normalizedExcerptId}`;
			if (!merged.has(key)) {
				merged.set(key, {
					sourceFile,
					sourceRef: normalizedRef || undefined,
					...(normalizedExcerptId ? { excerptId: normalizedExcerptId } : {}),
				});
			}
		}
		return Array.from(merged.values());
	}

	private selectPrimarySourceLocator(
		locators: HighlightSourceLocator[]
	): HighlightSourceLocator | null {
		if (locators.length === 0) {
			return null;
		}

		const cardLocator = locators.find(
			(locator) => typeof locator.sourceRef === "string" && locator.sourceRef.startsWith("card:")
		);
		if (cardLocator) {
			return cardLocator;
		}

		const referencedLocator = locators.find(
			(locator) => typeof locator.sourceRef === "string" && locator.sourceRef.trim().length > 0
		);
		if (referencedLocator) {
			return referencedLocator;
		}

		const markdownLocator = locators.find((locator) => locator.sourceFile.endsWith(".md"));
		if (markdownLocator) {
			return markdownLocator;
		}

		const canvasLocator = locators.find((locator) => locator.sourceFile.endsWith(".canvas"));
		if (canvasLocator) {
			return canvasLocator;
		}

		const wdeckLocator = locators.find((locator) => locator.sourceFile.endsWith(".wdeck"));
		if (wdeckLocator) {
			return wdeckLocator;
		}

		const jsonLocator = locators.find((locator) => locator.sourceFile.endsWith(".json"));
		if (jsonLocator) {
			return jsonLocator;
		}

		return locators[0] || null;
	}

	async collectAllHighlights(
		bookId: string,
		filePath: string,
		backlinkService: EpubBacklinkHighlightService,
		options?: { additionalSourcePaths?: string[]; diskIncremental?: boolean }
	): Promise<ReaderHighlight[]> {
		const boundCanvasPath = await this.storageService.getCanvasBinding(bookId);
		const hasAdditionalSourcePaths =
			Array.isArray(options?.additionalSourcePaths) && options.additionalSourcePaths.length > 0;
		const additionalSourcePaths = options?.additionalSourcePaths || [];
		const useDiskIncremental =
			options?.diskIncremental === true && additionalSourcePaths.length > 0;
		const cacheKey = this.buildCollectedHighlightsCacheKey(bookId, filePath, boundCanvasPath);
		if (!hasAdditionalSourcePaths) {
			const cached = this.collectedHighlightsCache.get(cacheKey);
			if (cached) {
				return this.cloneCollectedHighlights(cached);
			}

			const inflight = this.inflightCollectedHighlights.get(cacheKey);
			if (inflight) {
				return this.cloneCollectedHighlights(await inflight);
			}
		}

		const loadPromise = (async () => {
			const allHighlightsByKey = new Map<string, ReaderHighlight>();
			// 历史版本会把 EPUB 高亮重复写入本地 highlights.json，导致源摘录删除后界面仍残留。
			// 现在统一以 md/canvas/卡片中的真实摘录为准，因此这里直接移除遗留缓存文件。
			await this.clearLegacyHighlightCache(bookId);

			const backlinkHighlights = useDiskIncremental
				? await backlinkService.refreshBookHighlightsIncremental(
						filePath,
						additionalSourcePaths,
						boundCanvasPath
				  )
				: await backlinkService.collectHighlights(
						filePath,
						boundCanvasPath,
						hasAdditionalSourcePaths ? options : undefined
				  );
			for (const bh of backlinkHighlights) {
				const incomingLocators = this.collectHighlightSourceLocators(bh);
				const incomingIdentity = getReaderHighlightIdentityKey(bh);
				const existing = allHighlightsByKey.get(incomingIdentity);
				if (existing) {
					existing.sourceLocators = this.mergeHighlightSourceLocators(
						existing.sourceLocators || [],
						incomingLocators
					);
					if (existing.chapterIndex === undefined && bh.chapterIndex !== undefined) {
						existing.chapterIndex = bh.chapterIndex;
					}
					if (!existing.chapterTitle && bh.chapterTitle) {
						existing.chapterTitle = bh.chapterTitle;
					}
					if (existing.style === undefined && bh.style !== undefined) {
						existing.style = bh.style;
					}
					if (bh.commentText !== undefined) {
						existing.commentText = bh.commentText;
					}
					if (bh.hasCommentDivider !== undefined) {
						existing.hasCommentDivider = bh.hasCommentDivider;
					}
					if (existing.createdTime === undefined && bh.createdTime !== undefined) {
						existing.createdTime = bh.createdTime;
					}
					const primaryLocator = this.selectPrimarySourceLocator(existing.sourceLocators);
					if (primaryLocator) {
						existing.sourceFile = primaryLocator.sourceFile;
						existing.sourceRef = primaryLocator.sourceRef;
						existing.excerptId = primaryLocator.excerptId;
					}
				} else {
					const primaryLocator = this.selectPrimarySourceLocator(incomingLocators);
					allHighlightsByKey.set(incomingIdentity, {
						cfiRange: bh.cfiRange,
						color: bh.color,
						style: bh.style,
						text: bh.text,
						commentText: bh.commentText,
						hasCommentDivider: bh.hasCommentDivider,
						chapterIndex: bh.chapterIndex,
						chapterTitle: bh.chapterTitle,
						sourceFile: primaryLocator?.sourceFile || bh.sourceFile,
						sourceRef: primaryLocator?.sourceRef || bh.sourceRef,
						excerptId: primaryLocator?.excerptId || bh.excerptId,
						sourceLocators: incomingLocators,
						createdTime: bh.createdTime,
						presentation: "highlight",
					});
				}
			}

			const directHighlights =
				typeof this.storageService.loadDirectHighlights === "function"
					? await this.storageService.loadDirectHighlights(bookId)
					: [];
			for (const dh of directHighlights) {
				const identity = getReaderHighlightIdentityKey(dh);
				if (!allHighlightsByKey.has(identity)) {
					allHighlightsByKey.set(identity, {
						cfiRange: dh.cfiRange,
						color: dh.color as HighlightColor,
						style: dh.style,
						text: dh.text,
						chapterIndex: dh.chapterIndex,
						chapterTitle: dh.chapterTitle,
						createdTime: dh.createdTime,
						presentation: "highlight",
					});
				}
			}

			const allHighlights = Array.from(allHighlightsByKey.values());
			for (const concealedText of await this.getConcealedTexts(bookId)) {
				allHighlights.push({
					cfiRange: concealedText.cfiRange,
					color: "mask",
					text: concealedText.text,
					createdTime: concealedText.createdTime,
					presentation: "conceal",
				});
			}

			const snapshot = this.cloneCollectedHighlights(allHighlights);
			if (!hasAdditionalSourcePaths) {
				this.collectedHighlightsCache.set(cacheKey, snapshot);
			}
			return snapshot;
		})();

		if (!hasAdditionalSourcePaths) {
			this.inflightCollectedHighlights.set(cacheKey, loadPromise);
		}
		try {
			return this.cloneCollectedHighlights(await loadPromise);
		} finally {
			if (this.inflightCollectedHighlights.get(cacheKey) === loadPromise) {
				this.inflightCollectedHighlights.delete(cacheKey);
			}
		}
	}
}
