import { type App, normalizePath, TFile } from "obsidian";
import { getPluginPaths } from "../../config/paths";
import { generateCardUUID } from "../identifier/WeaveIDGenerator";
import { logger } from "../../utils/logger";
import { logMobileEvent } from "../../utils/zora-mobile-logger";
import { getZoraSyncService, ZoraSyncService } from "./ZoraSyncService";
import type { SyncAnnotation, SyncMigrationV2Record, SyncProgress } from "./ZoraSyncTypes";

const MIGRATION_FILE_PATH = "Zora Reader/Sync/migration-v2.json";

export async function runZoraSyncV2Migration(app: App): Promise<SyncMigrationV2Record> {
	const syncService = getZoraSyncService(app);
	const adapter = app.vault.adapter;

	let migrationRecord: SyncMigrationV2Record = {
		version: 2,
		migratedAt: new Date().toISOString(),
		deviceId: syncService.getDeviceId(),
		migratedBookIds: [],
		counts: {
			highlights: 0,
			notes: 0,
			progress: 0,
		},
	};

	if (await adapter.exists(MIGRATION_FILE_PATH)) {
		try {
			const content = await adapter.read(MIGRATION_FILE_PATH);
			const parsed = JSON.parse(content) as SyncMigrationV2Record;
			if (parsed && parsed.version === 2) {
				migrationRecord = parsed;
			}
		} catch {
			// ignore corrupted record
		}
	}

	const migratedSet = new Set(migrationRecord.migratedBookIds || []);

	// Locate candidate legacy state files
	const candidatePaths = [
		getPluginPaths(app).state.epubLocalState,
		"Zora Reader/state/epub-local-state.json",
		"weave/incremental-reading/epub-reading/epub-local-state.json",
	];

	for (const candidatePath of candidatePaths) {
		const normPath = normalizePath(candidatePath);
		if (!(await adapter.exists(normPath))) continue;

		try {
			const content = await adapter.read(normPath);
			const localData = JSON.parse(content);
			if (!localData || typeof localData.books !== "object") continue;

			for (const [rawBookId, record] of Object.entries(localData.books as Record<string, any>)) {
				if (!record) continue;

				const descriptor = record.descriptor || {};
				const filePath = String(descriptor.filePath || record.filePath || "").trim();
				const title = String(descriptor.title || record.title || "未知书籍").trim();
				const author = String(descriptor.author || record.author || "").trim();

				// Resolve canonical SHA-256 bookId
				let canonicalBookId = "";
				if (filePath) {
					canonicalBookId = await syncService.computeBookIdFromFile(filePath);
				}
				if (!canonicalBookId || canonicalBookId.startsWith("fallback-")) {
					canonicalBookId = rawBookId;
				}

				if (migratedSet.has(canonicalBookId)) {
					continue;
				}

				// 1. Save Book Meta
				await syncService.saveBookMeta({
					bookId: canonicalBookId,
					title,
					author,
					vaultPath: filePath,
					updatedAt: new Date().toISOString(),
				});

				// 2. Migrate Progress
				const position = record.state?.currentPosition || record.currentPosition;
				if (position && position.cfi) {
					await syncService.saveProgress(canonicalBookId, {
						cfi: position.cfi,
						percentage: typeof position.percent === "number" ? position.percent : 0,
						chapterIndex: typeof position.chapterIndex === "number" ? position.chapterIndex : 0,
						chapterTitle: position.chapterTitle,
					});
					migrationRecord.counts.progress += 1;
				}

				// 3. Migrate Direct Highlights
				const directHighlights = Array.isArray(record.directHighlights) ? record.directHighlights : [];
				for (const dh of directHighlights) {
					if (!dh || !dh.cfiRange) continue;
					const annotationId = generateCardUUID();
					await syncService.saveAnnotation({
						id: annotationId,
						bookId: canonicalBookId,
						cfiRange: dh.cfiRange,
						type: (dh.style as any) || "highlight",
						color: dh.color || "yellow",
						style: dh.style,
						text: dh.text || "",
						chapterIndex: dh.chapterIndex,
						chapterTitle: dh.chapterTitle,
						createdAt: dh.createdTime ? new Date(dh.createdTime).toISOString() : new Date().toISOString(),
					});
					migrationRecord.counts.highlights += 1;
				}

				migratedSet.add(canonicalBookId);
				migrationRecord.migratedBookIds.push(canonicalBookId);
			}
		} catch (error) {
			logger.warn(`[zora-sync-migration] Failed to parse legacy state file ${candidatePath}:`, error);
		}
	}

	// Update migration record file
	migrationRecord.migratedAt = new Date().toISOString();
	try {
		await adapter.write(MIGRATION_FILE_PATH, JSON.stringify(migrationRecord, null, 2));
		logMobileEvent("Sync", "MigrationCompleted", {
			migratedBookCount: migrationRecord.migratedBookIds.length,
			highlightsCount: migrationRecord.counts.highlights,
			progressCount: migrationRecord.counts.progress,
		});
	} catch (error) {
		logger.warn("[zora-sync-migration] Failed to write migration record:", error);
	}

	return migrationRecord;
}
