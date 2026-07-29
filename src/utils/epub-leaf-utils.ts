import { type App, TFile, type WorkspaceLeaf, normalizePath } from "obsidian";
import { getEpubStorageService } from "../services/epub";
import { isSupportedBookPath } from "../services/epub/book-format";
import { EPUB_RUNTIME } from "../services/epub/epub-runtime";
import {
	epubVaultPathsReferToSameBook,
	resolveSupportedBookFilePath,
} from "../services/epub/epub-vault-path";
import { epubActiveDocumentStore } from "../stores/epub-active-document-store";
import type {
	AppWithViewRegistry,
	ViewRegistryExtension,
} from "../types/obsidian-extensions";
import { VIEW_TYPE_EPUB } from "../views/EpubView";
import { focusWorkspaceLeaf } from "./obsidian-workspace-utils";
import { getLeafLocation } from "./view-location-utils";

function getViewRegistry(app: App): ViewRegistryExtension | null {
	return (app as App & AppWithViewRegistry).viewRegistry ?? null;
}

function readMapLikeValue<T>(
	value:
		| Map<string, T>
		| (Record<string, T> & { get?: (key: string) => T | undefined })
		| undefined,
	key: string,
): T | null {
	if (!value || !key) {
		return null;
	}
	if (value instanceof Map) {
		return value.get(key) ?? null;
	}
	if (typeof value.get === "function") {
		return value.get(key) ?? null;
	}
	return value[key] ?? null;
}

function hasMapLikeValue(
	value:
		| Map<string, unknown>
		| (Record<string, unknown> & { get?: (key: string) => unknown })
		| undefined,
	key: string,
): boolean {
	return readMapLikeValue(value, key) != null;
}

const KNOWN_EPUB_VIEW_TYPES = Array.from(
	new Set([
		VIEW_TYPE_EPUB,
		EPUB_RUNTIME.viewTypes.reader,
		"weave-epub-reader",
		"weave-epub-reader-standalone",
		"weave-epub-ai-reader",
	]),
);

function isCenterLeaf(
	leaf: WorkspaceLeaf | null | undefined,
): leaf is WorkspaceLeaf {
	return !!leaf && getLeafLocation(leaf) === "center";
}

function readRegisteredViewTypeForExtension(
	app: App,
	extension: string,
): string | null {
	const normalizedExtension = String(extension || "")
		.trim()
		.toLowerCase();
	if (!normalizedExtension) {
		return null;
	}
	const typeByExtension = getViewRegistry(app)?.typeByExtension;
	return readMapLikeValue(typeByExtension, normalizedExtension);
}

function isRegisteredViewType(app: App, viewType: string): boolean {
	const registry = getViewRegistry(app);
	if (!registry || !viewType) {
		return false;
	}
	const creators =
		registry.viewByType ?? registry.viewCreators ?? registry.views;
	return hasMapLikeValue(creators, viewType);
}

export function getAllOpenEpubLeaves(app: App): WorkspaceLeaf[] {
	const leaves = new Set<WorkspaceLeaf>();
	for (const viewType of KNOWN_EPUB_VIEW_TYPES) {
		for (const leaf of app.workspace.getLeavesOfType(viewType)) {
			leaves.add(leaf);
		}
	}
	return Array.from(leaves);
}

export function getOpenEpubFilePath(
	leaf: WorkspaceLeaf | null | undefined,
): string {
	if (!leaf) {
		return "";
	}
	try {
		const view = leaf.view as {
			getCurrentFilePath?: () => string;
			getState?: () => Record<string, unknown>;
		};
		const fromView =
			typeof view?.getCurrentFilePath === "function"
				? view.getCurrentFilePath()
				: "";
		if (typeof fromView === "string" && fromView.trim()) {
			return fromView;
		}
		const state = leaf.getViewState?.()?.state ?? view?.getState?.() ?? {};
		const filePath = typeof state?.filePath === "string" ? state.filePath : "";
		if (filePath.trim()) {
			return filePath;
		}
		const file = typeof state?.file === "string" ? state.file : "";
		return file.trim();
	} catch {
		return "";
	}
}

export function resolveRegisteredEpubViewType(
	app: App,
	filePath?: string,
): string | null {
	const extension =
		String(filePath || "")
			.split(".")
			.pop() || "";
	const mappedViewType = readRegisteredViewTypeForExtension(app, extension);
	if (mappedViewType && KNOWN_EPUB_VIEW_TYPES.includes(mappedViewType)) {
		return mappedViewType;
	}
	for (const viewType of KNOWN_EPUB_VIEW_TYPES) {
		if (isRegisteredViewType(app, viewType)) {
			return viewType;
		}
	}
	return null;
}

function isExistingEpubPath(
	app: App,
	filePath: string | null | undefined,
): filePath is string {
	if (!filePath) {
		return false;
	}

	const file = app.vault.getAbstractFileByPath(filePath);
	return file instanceof TFile && isSupportedBookPath(file.path);
}

export function pathsReferToSameOpenBook(left: string, right: string): boolean {
	const normalizedLeft = normalizePath(String(left || "").trim());
	const normalizedRight = normalizePath(String(right || "").trim());
	if (!normalizedLeft || !normalizedRight) {
		return false;
	}
	return epubVaultPathsReferToSameBook(normalizedLeft, normalizedRight);
}

export function findOpenEpubLeaf(
	app: App,
	filePath?: string,
): WorkspaceLeaf | null {
	const leaves = getAllOpenEpubLeaves(app);

	if (filePath) {
		const canonicalPath =
			resolveSupportedBookFilePath(app, filePath) || normalizePath(filePath);
		const matchedLeaf = leaves.find((leaf) => {
			const openPath = getOpenEpubFilePath(leaf);
			return openPath
				? pathsReferToSameOpenBook(openPath, canonicalPath)
				: false;
		});
		return matchedLeaf ?? null;
	}

	return leaves.find((leaf) => isCenterLeaf(leaf)) ?? leaves[0] ?? null;
}

export function getPreferredEpubLeaf(
	app: App,
	filePath?: string,
): WorkspaceLeaf | null {
	const matchedEpubLeaf = findOpenEpubLeaf(app, filePath);
	if (matchedEpubLeaf) {
		return matchedEpubLeaf;
	}

	if (filePath) {
		return app.workspace.getLeaf("tab");
	}

	const activeLeaf = app.workspace.getMostRecentLeaf?.() ?? null;
	if (isCenterLeaf(activeLeaf)) {
		return activeLeaf;
	}

	const recentLeaf = app.workspace.getMostRecentLeaf?.();
	if (isCenterLeaf(recentLeaf)) {
		return recentLeaf;
	}

	const markdownLeaf = app.workspace
		.getLeavesOfType("markdown")
		.find((leaf) => isCenterLeaf(leaf));
	if (markdownLeaf) {
		return markdownLeaf;
	}

	const fallbackLeaf = app.workspace.getLeaf(false);
	if (isCenterLeaf(fallbackLeaf)) {
		return fallbackLeaf;
	}

	return app.workspace.getLeaf("tab");
}

export async function openEpubInPreferredLeaf(
	app: App,
	filePath: string,
	state: Record<string, unknown> = {},
): Promise<WorkspaceLeaf | null> {
	const viewType = resolveRegisteredEpubViewType(app, filePath);
	if (!viewType) {
		return null;
	}
	const leaf = getPreferredEpubLeaf(app, filePath);
	if (!leaf) {
		return null;
	}

	const canonicalPath =
		resolveSupportedBookFilePath(app, filePath) || normalizePath(filePath);

	await leaf.setViewState({
		type: viewType,
		active: true,
		state: {
			filePath: canonicalPath,
			...state,
		},
	});
	void app.workspace.revealLeaf(leaf);
	return leaf;
}

/**
 * Open or focus a book for excerpt source navigation from notes.
 * Never reuses the active markdown/note leaf; reuses an existing reader leaf for the same book or opens a new tab.
 */
export async function openBookForSourceNavigation(
	app: App,
	filePath: string,
	state: Record<string, unknown> = {},
	options: { focus?: boolean } = {},
): Promise<WorkspaceLeaf | null> {
	const { focus = true } = options;
	const viewType = resolveRegisteredEpubViewType(app, filePath);
	if (!viewType) {
		return null;
	}

	const canonicalPath =
		resolveSupportedBookFilePath(app, filePath) || normalizePath(filePath);
	const existingLeaf = findOpenEpubLeaf(app, canonicalPath);
	const leaf = existingLeaf ?? app.workspace.getLeaf("tab");

	await leaf.setViewState({
		type: viewType,
		active: true,
		state: {
			filePath: canonicalPath,
			...state,
		},
	});

	if (focus) {
		focusWorkspaceLeaf(app, leaf, focus);
	} else {
		void app.workspace.revealLeaf(leaf);
	}
	return leaf;
}

export async function resolveRecentEpubPath(app: App): Promise<string | null> {
	const activePath = epubActiveDocumentStore.getActiveDocument();
	if (isExistingEpubPath(app, activePath)) {
		return activePath;
	}

	const openLeafPath = getAllOpenEpubLeaves(app)
		.map((leaf) => {
			return getOpenEpubFilePath(leaf);
		})
		.find((path) => isExistingEpubPath(app, path));
	if (openLeafPath) {
		return openLeafPath;
	}

	try {
		const storageService = getEpubStorageService(app);
		const recentBook = Object.values(
			await storageService.loadBooks({ hydrateStates: false }),
		)
			.filter((book) => isExistingEpubPath(app, book.filePath))
			.sort((a, b) => {
				const timeA = Number.isFinite(a.readingStats?.lastReadTime)
					? a.readingStats.lastReadTime
					: 0;
				const timeB = Number.isFinite(b.readingStats?.lastReadTime)
					? b.readingStats.lastReadTime
					: 0;
				if (timeA !== timeB) {
					return timeB - timeA;
				}
				return a.filePath.localeCompare(b.filePath, "zh-CN");
			})[0];

		return recentBook?.filePath ?? null;
	} catch {
		return null;
	}
}
