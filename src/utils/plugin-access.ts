import { getVisibleSplitActionsFromHost } from "../services/ai/ai-action-config";
import type {
	EffectiveLicenseState,
	LicenseInfo,
	LicenseStore,
} from "../types/license";
import {
	cloneLicenseAsInherited,
	dedupeLicenses,
	normalizeLicenseStore,
} from "./license-state";

export type PluginLookupApp = {
	vault?: unknown;
	plugins?: {
		getPlugin?: (pluginId: string) => unknown;
	};
};

type PluginSettingsOwner = {
	app?: PluginLookupApp;
	settings?: CompatiblePluginSettings;
};

type CompatibleAIDataStorage = CompatibleDataStorage & {
	getDecks: () => unknown[] | Promise<unknown[]>;
	saveCard: (card: unknown) => unknown;
};

export type CompatibleIncrementalReadingSettings = {
	importFolder?: string;
	selectionQuickCreateLastFolder?: string;
	dailyTimeBudgetMinutes?: number;
	interleaveMode?: string;
	enableTagGroupPrior?: boolean;
	defaultIntervalFactor?: number;
	maxConsecutiveSameTopic?: number;
	maxAppearancesPerDay?: number;
	agingStrength?: number;
	autoPostponeStrategy?: string;
	priorityHalfLifeDays?: number;
	maxInterval?: number;
	tagGroupFollowMode?: "off" | "ask" | "auto";
};

export type CompatiblePluginSettings = {
	weaveParentFolder?: string;
	incrementalReading?: CompatibleIncrementalReadingSettings;
	selectionQuickCreateLastFolder?: string;
	lastSelectedIRDeckId?: string;
	bookmarkFolder?: string;
	license?: Partial<LicenseInfo>;
	licenseState?: Partial<LicenseStore>;
	aiConfig?: {
		customSplitActions?: unknown[];
	};
};

export type CompatibleDataStorage = {
	getAllCards?: () => unknown[] | Promise<unknown[]>;
	getDecks?: () => unknown[] | Promise<unknown[]>;
	getCardByUUID?: (uuid: string) => unknown;
	saveCard?: (card: unknown) => unknown;
	deleteCard?: (uuid: string) => unknown;
};

export type CompatibleReadingMaterialManager = {
	getAllMaterials?: () => unknown[] | Promise<unknown[]>;
};

export type CompatiblePlugin = {
	manifest?: {
		id?: string;
	};
	settings?: CompatiblePluginSettings;
	dataStorage?: CompatibleDataStorage;
	readingMaterialManager?: CompatibleReadingMaterialManager;
	getLocalLicenses?: () => LicenseInfo[];
	getEffectiveLicenseState?: () => EffectiveLicenseState;
};

export type CompatibleAISelectedTextPanelHost = CompatiblePlugin & {
	app: PluginLookupApp;
	settings: CompatiblePluginSettings;
	dataStorage: CompatibleAIDataStorage;
};

export const STANDALONE_PLUGIN_ID = "zora-reader";
export const LEGACY_WEAVE_PLUGIN_ID = "weave";

function normalizeOptionalString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function getPluginById(
	app: PluginLookupApp | undefined,
	pluginId: string,
): CompatiblePlugin | null {
	const plugin = app?.plugins?.getPlugin?.(pluginId);
	return plugin && typeof plugin === "object" ? plugin : null;
}

export function getStandalonePlugin(
	app: PluginLookupApp | undefined,
): CompatiblePlugin | null {
	return getPluginById(app, STANDALONE_PLUGIN_ID);
}

export function getLegacyWeavePlugin(
	app: PluginLookupApp | undefined,
): CompatiblePlugin | null {
	return getPluginById(app, LEGACY_WEAVE_PLUGIN_ID);
}

export function getCompatiblePlugin(
	app: PluginLookupApp | undefined,
): CompatiblePlugin | null {
	return getStandalonePlugin(app) ?? getLegacyWeavePlugin(app);
}

function hasAISelectedTextPanelCapability(
	plugin: CompatiblePlugin | null | undefined,
): plugin is CompatiblePlugin & {
	settings: CompatiblePluginSettings;
	dataStorage: CompatibleAIDataStorage;
} {
	return Boolean(
		plugin?.settings &&
			typeof plugin.dataStorage?.getDecks === "function" &&
			typeof plugin.dataStorage?.saveCard === "function",
	);
}

function createCompatibleAISelectedTextPanelHost(
	app: PluginLookupApp | undefined,
	plugin: CompatiblePlugin & {
		settings: CompatiblePluginSettings;
		dataStorage: CompatibleAIDataStorage;
	},
): CompatibleAISelectedTextPanelHost | null {
	if (!app) {
		return null;
	}

	return Object.assign(Object.create(plugin as object), {
		app,
		settings: plugin.settings,
		dataStorage: plugin.dataStorage,
	}) as CompatibleAISelectedTextPanelHost;
}

export function getCompatibleWeaveParentFolder(
	app: PluginLookupApp | undefined,
): string | undefined {
	const standaloneSettings = getStandalonePlugin(app)?.settings;
	const legacySettings = getLegacyWeavePlugin(app)?.settings;
	return (
		normalizeOptionalString(standaloneSettings?.weaveParentFolder) ??
		normalizeOptionalString(legacySettings?.weaveParentFolder)
	);
}

export function getCompatibleWeaveParentFolderFromSettingsOwner(
	owner: PluginSettingsOwner | undefined,
): string | undefined {
	return (
		normalizeOptionalString(owner?.settings?.weaveParentFolder) ??
		getCompatibleWeaveParentFolder(owner?.app)
	);
}

export function getCompatibleIncrementalReadingSettings(
	app: PluginLookupApp | undefined,
): CompatibleIncrementalReadingSettings {
	const standaloneSettings = getStandalonePlugin(app)?.settings;
	const legacySettings = getLegacyWeavePlugin(app)?.settings;
	const standaloneIR = standaloneSettings?.incrementalReading ?? {};
	const legacyIR = legacySettings?.incrementalReading ?? {};
	const selectionQuickCreateLastFolder =
		normalizeOptionalString(standaloneIR.selectionQuickCreateLastFolder) ??
		normalizeOptionalString(
			standaloneSettings?.selectionQuickCreateLastFolder,
		) ??
		normalizeOptionalString(legacyIR.selectionQuickCreateLastFolder) ??
		normalizeOptionalString(legacySettings?.selectionQuickCreateLastFolder);

	return {
		...legacyIR,
		...standaloneIR,
		selectionQuickCreateLastFolder,
	};
}

export function getCompatibleSelectionQuickCreateLastFolder(
	app: PluginLookupApp | undefined,
): string {
	return (
		getCompatibleIncrementalReadingSettings(app)
			.selectionQuickCreateLastFolder ?? ""
	);
}

export function getCompatibleAISelectedTextPanelHost(
	app: PluginLookupApp | undefined,
): CompatibleAISelectedTextPanelHost | null {
	const standalonePlugin = getStandalonePlugin(app);
	const legacyPlugin = getLegacyWeavePlugin(app);

	const capablePlugins = [standalonePlugin, legacyPlugin].filter(
		hasAISelectedTextPanelCapability,
	);
	if (capablePlugins.length === 0) {
		return null;
	}

	const preferredPlugin =
		capablePlugins.find(
			(plugin) => getVisibleSplitActionsFromHost(plugin).length > 0,
		) || capablePlugins[0];

	return createCompatibleAISelectedTextPanelHost(app, preferredPlugin);
}

export function getCompatibleDataStorage(
	app: PluginLookupApp | undefined,
): CompatibleDataStorage | null {
	const standaloneDataStorage = getStandalonePlugin(app)?.dataStorage;
	if (standaloneDataStorage?.getAllCards) {
		return standaloneDataStorage;
	}

	const legacyDataStorage = getLegacyWeavePlugin(app)?.dataStorage;
	return legacyDataStorage?.getAllCards
		? legacyDataStorage
		: standaloneDataStorage ?? legacyDataStorage ?? null;
}

export function getCompatibleReadingMaterialManager(
	app: PluginLookupApp | undefined,
): CompatibleReadingMaterialManager | null {
	const standaloneManager = getStandalonePlugin(app)?.readingMaterialManager;
	if (standaloneManager?.getAllMaterials) {
		return standaloneManager;
	}

	const legacyManager = getLegacyWeavePlugin(app)?.readingMaterialManager;
	return legacyManager?.getAllMaterials
		? legacyManager
		: standaloneManager ?? legacyManager ?? null;
}

function getPluginLocalLicenses(plugin: CompatiblePlugin): LicenseInfo[] {
	if (typeof plugin.getLocalLicenses === "function") {
		return plugin.getLocalLicenses();
	}

	return normalizeLicenseStore(
		plugin.settings?.license,
		plugin.settings?.licenseState,
	).localLicenses;
}

function getPluginActiveLicenses(plugin: CompatiblePlugin): LicenseInfo[] {
	if (typeof plugin.getEffectiveLicenseState === "function") {
		return plugin.getEffectiveLicenseState().activeLicenses ?? [];
	}

	return getPluginLocalLicenses(plugin);
}

export function getInheritedLicensesFromLegacyWeave(
	app: PluginLookupApp | undefined,
): LicenseInfo[] {
	const legacyPlugin = getLegacyWeavePlugin(app);
	if (!legacyPlugin) {
		return [];
	}

	const sourcePluginId =
		String(legacyPlugin.manifest?.id || LEGACY_WEAVE_PLUGIN_ID).trim() ||
		LEGACY_WEAVE_PLUGIN_ID;

	return dedupeLicenses(
		getPluginActiveLicenses(legacyPlugin).map((license) =>
			cloneLicenseAsInherited(license, sourcePluginId),
		),
	);
}
