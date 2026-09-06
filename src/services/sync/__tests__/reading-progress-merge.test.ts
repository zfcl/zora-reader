import { describe, expect, it } from "vitest";
import {
	resolveLatestReadingPosition,
	syncedProgressTimestamp,
} from "../reading-progress-merge";
import type { SyncProgress } from "../ZoraSyncTypes";

function remote(updatedAt: string, cfi = "epubcfi(/6/4!/4/2/1:0)"): SyncProgress {
	return {
		bookId: "book",
		deviceId: "ios-device",
		cfi,
		percentage: 0.72,
		chapterIndex: 4,
		updatedAt,
	};
}

describe("reading-progress-merge", () => {
	it("restores a newer synced device position over stale local progress", () => {
		const localTime = Date.parse("2026-09-06T08:00:00.000Z");
		const result = resolveLatestReadingPosition(
			{ chapterIndex: 2, cfi: "epubcfi(/6/2!/4/2/1:0)", percent: 0.31 },
			localTime,
			remote("2026-09-06T09:00:00.000Z")
		);
		expect(result.source).toBe("sync");
		expect(result.position).toEqual({
			chapterIndex: 4,
			cfi: "epubcfi(/6/4!/4/2/1:0)",
			percent: 0.72,
		});
	});

	it("keeps newer local progress so it can be published to the other devices", () => {
		const localTime = Date.parse("2026-09-06T10:00:00.000Z");
		const result = resolveLatestReadingPosition(
			{ chapterIndex: 7, cfi: "epubcfi(/6/8!/4/2/1:0)", percent: 0.81 },
			localTime,
			remote("2026-09-06T09:00:00.000Z")
		);
		expect(result.source).toBe("local");
		expect(result.position?.percent).toBe(0.81);
	});

	it("uses synced progress when a new device has no local reading state", () => {
		const result = resolveLatestReadingPosition(
			null,
			0,
			remote("2026-09-06T09:00:00.000Z")
		);
		expect(result.source).toBe("sync");
		expect(result.position?.chapterIndex).toBe(4);
	});

	it("does not let an invalid sync timestamp overwrite valid local state", () => {
		const result = resolveLatestReadingPosition(
			{ chapterIndex: 3, cfi: "local-cfi", percent: 0.5 },
			1000,
			remote("not-a-date", "remote-cfi")
		);
		expect(syncedProgressTimestamp(remote("not-a-date"))).toBe(0);
		expect(result.source).toBe("local");
		expect(result.position?.cfi).toBe("local-cfi");
	});
});
