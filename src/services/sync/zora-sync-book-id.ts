import type { App } from "obsidian";
import { normalizePath } from "obsidian";

/**
 * Computes SHA-256 fingerprint from EPUB binary data as a 64-character lowercase hex string.
 */
export async function computeBookIdFromBinary(data: ArrayBuffer | Uint8Array): Promise<string> {
	const input = data instanceof Uint8Array ? data : new Uint8Array(data);

	if (typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.digest === "function") {
		const digest = await crypto.subtle.digest("SHA-256", input);
		return Array.from(new Uint8Array(digest))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}

	// Fallback for environments lacking crypto.subtle (e.g. older node unit tests)
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input[i];
		hash = Math.imul(hash, 0x01000193);
	}
	const hex = (hash >>> 0).toString(16).padStart(8, "0");
	return `fallback-${hex}-${input.length}`;
}

/**
 * Computes SHA-256 bookId directly from a vault EPUB file.
 */
export async function computeBookIdFromFile(app: App, filePath: string): Promise<string | null> {
	const normalizedPath = normalizePath(filePath || "");
	if (!normalizedPath) {
		return null;
	}

	const adapter = app.vault.adapter as {
		readBinary?: (path: string) => Promise<ArrayBuffer | Uint8Array>;
	};
	if (typeof adapter?.readBinary !== "function") {
		return null;
	}

	try {
		const binary = await adapter.readBinary(normalizedPath);
		return await computeBookIdFromBinary(binary);
	} catch {
		return null;
	}
}
