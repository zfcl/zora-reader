import type { ReadingPosition } from "../epub/types";
import type { SyncProgress } from "./ZoraSyncTypes";

export type ReadingProgressSource = "local" | "sync" | "none";

export interface ReadingProgressResolution {
	position: ReadingPosition | null;
	source: ReadingProgressSource;
}

function finiteNumber(value: unknown, fallback = 0): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function syncedProgressTimestamp(progress: SyncProgress | null | undefined): number {
	if (!progress?.updatedAt) return 0;
	const timestamp = Date.parse(progress.updatedAt);
	return Number.isFinite(timestamp) ? timestamp : 0;
}

export function syncedProgressToReadingPosition(
	progress: SyncProgress | null | undefined
): ReadingPosition | null {
	const cfi = String(progress?.cfi || "").trim();
	if (!cfi) return null;
	return {
		chapterIndex: Math.max(0, Math.trunc(finiteNumber(progress?.chapterIndex, 0))),
		cfi,
		percent: Math.min(1, Math.max(0, finiteNumber(progress?.percentage, 0))),
	};
}

export function resolveLatestReadingPosition(
	localPosition: ReadingPosition | null | undefined,
	localUpdatedAt: number | null | undefined,
	syncedProgress: SyncProgress | null | undefined
): ReadingProgressResolution {
	const normalizedLocal = localPosition?.cfi
		? {
			chapterIndex: Math.max(0, Math.trunc(finiteNumber(localPosition.chapterIndex, 0))),
			cfi: String(localPosition.cfi).trim(),
			percent: Math.min(1, Math.max(0, finiteNumber(localPosition.percent, 0))),
		}
		: null;
	const normalizedSync = syncedProgressToReadingPosition(syncedProgress);
	const localTime = finiteNumber(localUpdatedAt, 0);
	const syncTime = syncedProgressTimestamp(syncedProgress);

	if (normalizedSync && (!normalizedLocal || (syncTime > 0 && syncTime >= localTime))) {
		return { position: normalizedSync, source: "sync" };
	}
	if (normalizedLocal) {
		return { position: normalizedLocal, source: "local" };
	}
	if (normalizedSync) {
		return { position: normalizedSync, source: "sync" };
	}
	return { position: null, source: "none" };
}
