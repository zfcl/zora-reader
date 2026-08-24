import type { App, DataAdapter } from "obsidian";
import { normalizePath } from "obsidian";
import { DirectoryUtils } from "../../utils/directory-utils";
import { logger } from "../../utils/logger";

/**
 * Safely and atomically writes JSON data to a file.
 * 1. Serializes and validates the JSON data.
 * 2. Writes to a temporary `<file>.tmp` path.
 * 3. Validates that the written temporary file can be read back and parsed.
 * 4. Replaces/renames the temporary file to the target path.
 */
export async function atomicWriteJson<T>(
	adapter: DataAdapter,
	filePath: string,
	data: T
): Promise<void> {
	const normalizedPath = normalizePath(filePath);
	const serialized = JSON.stringify(data, null, 2);

	// Pre-validate serialization
	JSON.parse(serialized);

	await DirectoryUtils.ensureDirForFile(adapter, normalizedPath);

	const tmpPath = `${normalizedPath}.tmp`;

	try {
		await adapter.write(tmpPath, serialized);

		// Post-write verification: ensure file was written and is valid JSON
		const readBack = await adapter.read(tmpPath);
		JSON.parse(readBack);

		// Atomic replace / overwrite
		if (typeof adapter.rename === "function") {
			try {
				if (await adapter.exists(normalizedPath)) {
					await adapter.remove(normalizedPath);
				}
				await adapter.rename(tmpPath, normalizedPath);
				return;
			} catch (renameErr) {
				logger.debug("[AtomicWrite] Rename failed, falling back to direct write:", renameErr);
			}
		}

		await adapter.write(normalizedPath, serialized);
		try {
			if (await adapter.exists(tmpPath)) {
				await adapter.remove(tmpPath);
			}
		} catch {
			/* ignore tmp cleanup error */
		}
	} catch (error) {
		logger.error("[AtomicWrite] Failed to write atomically:", { filePath: normalizedPath, error });
		try {
			if (await adapter.exists(tmpPath)) {
				await adapter.remove(tmpPath);
			}
		} catch {
			/* ignore */
		}
		throw error;
	}
}

/**
 * Safely reads and parses a JSON file. Returns null if the file does not exist or contains invalid JSON.
 */
export async function safeReadJson<T>(
	adapter: DataAdapter,
	filePath: string
): Promise<T | null> {
	const normalizedPath = normalizePath(filePath);
	try {
		if (!(await adapter.exists(normalizedPath))) {
			return null;
		}
		const content = await adapter.read(normalizedPath);
		if (!content || !content.trim()) {
			return null;
		}
		return JSON.parse(content) as T;
	} catch (error) {
		logger.warn("[SafeReadJson] Failed to read JSON file:", { filePath: normalizedPath, error });
		return null;
	}
}
