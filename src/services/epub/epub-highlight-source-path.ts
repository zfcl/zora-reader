import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import {
	getPluginEditorTempDir,
	getVaultEditorTempDir,
	isDetachedEditorTempFilePath,
	isLegacyModalEditorPermanentFilePath,
	isModalEditorPermanentFilePath,
	isPluginCacheModalEditorPermanentFilePath,
} from "../editor/editor-temp-file-policy";
import type { WDeckPersistenceCardLike } from "../../utils/wdeck-card-persistence";
import {
	isEpubSemanticSourcePath as isEpubDocumentSourcePathFromUtil,
	isPersistedCardStorageSourcePath as isPersistedExcerptStorageSourcePathFromUtil,
	readWDeckPersistenceSourcePath,
} from "../../utils/wdeck-card-persistence";

export type EpubHighlightPersistenceSourceCandidate = WDeckPersistenceCardLike;

/**
 * Modal / detached editor buffers are not persisted excerpt sources.
 * They must never drive EPUB reader highlight aggregation.
 */
export function isEphemeralEditorHighlightSourcePath(
	app: App,
	path?: string | null
): boolean {
	const normalizedPath = normalizePath(String(path || "").trim());
	if (!normalizedPath) {
		return false;
	}

	const fileName = normalizedPath.split("/").pop() || "";
	if (isModalEditorPermanentFilePath(normalizedPath) || isModalEditorPermanentFilePath(fileName)) {
		return true;
	}
	if (isDetachedEditorTempFilePath(normalizedPath)) {
		return true;
	}
	if (isLegacyModalEditorPermanentFilePath(normalizedPath)) {
		return true;
	}
	if (isPluginCacheModalEditorPermanentFilePath(app, normalizedPath)) {
		return true;
	}

	const vaultEditorTempDir = getVaultEditorTempDir(app);
	if (
		vaultEditorTempDir &&
		(normalizedPath === vaultEditorTempDir || normalizedPath.startsWith(`${vaultEditorTempDir}/`))
	) {
		return true;
	}

	const pluginEditorTempDir = getPluginEditorTempDir(app);
	if (
		pluginEditorTempDir &&
		(normalizedPath === pluginEditorTempDir || normalizedPath.startsWith(`${pluginEditorTempDir}/`))
	) {
		return true;
	}

	if (normalizedPath === normalizePath("Zora Reader/debug/mobile-debug.log")) {
		return true;
	}

	return false;
}

export function isEpubDocumentSourcePath(path?: string | null): boolean {
	return isEpubDocumentSourcePathFromUtil(path);
}

/**
 * Vault file that stores excerpt content (markdown/canvas/card json/wdeck), not the EPUB itself.
 */
export function isPersistedExcerptStorageSourcePath(path?: string | null): boolean {
	return isPersistedExcerptStorageSourcePathFromUtil(path);
}

/**
 * Resolve where excerpt content is persisted (`.wdeck` / card json / md / canvas).
 */
export function resolveEpubHighlightPersistenceSourcePath(
	card: EpubHighlightPersistenceSourceCandidate
): string | undefined {
	return readWDeckPersistenceSourcePath(card);
}
