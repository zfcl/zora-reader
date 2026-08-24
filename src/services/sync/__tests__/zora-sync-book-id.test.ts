import { describe, expect, it } from "vitest";
import { computeBookIdFromBinary } from "../zora-sync-book-id";

describe("zora-sync-book-id", () => {
	it("computes identical SHA-256 hash for identical binary content", async () => {
		const sampleData1 = new TextEncoder().encode("EPUB TEST CONTENT 123456");
		const sampleData2 = new TextEncoder().encode("EPUB TEST CONTENT 123456");

		const hash1 = await computeBookIdFromBinary(sampleData1);
		const hash2 = await computeBookIdFromBinary(sampleData2);

		expect(hash1).toBe(hash2);
		expect(hash1.length).toBe(64);
		expect(hash1).toMatch(/^[0-9a-f]{64}$/);
	});

	it("computes different hashes for different binary content", async () => {
		const sampleData1 = new TextEncoder().encode("EPUB TEST CONTENT A");
		const sampleData2 = new TextEncoder().encode("EPUB TEST CONTENT B");

		const hash1 = await computeBookIdFromBinary(sampleData1);
		const hash2 = await computeBookIdFromBinary(sampleData2);

		expect(hash1).not.toBe(hash2);
	});

	it("works uniformly with ArrayBuffer and Uint8Array", async () => {
		const uint8 = new TextEncoder().encode("Cross platform uniform test");
		const buffer = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);

		const hashFromUint8 = await computeBookIdFromBinary(uint8);
		const hashFromBuffer = await computeBookIdFromBinary(buffer);

		expect(hashFromUint8).toBe(hashFromBuffer);
	});
});
