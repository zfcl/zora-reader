import type { TextComponent } from "obsidian";
import {
	DEFAULT_CONTINUOUS_READING_POSITION_AUTO_SAVE_ENABLED,
	DEFAULT_CONTINUOUS_READING_POSITION_AUTO_SAVE_PAGES,
	normalizeContinuousReadingPositionAutoSaveEnabled,
	normalizeContinuousReadingPositionAutoSavePages,
} from "../../config/reading-position-auto-save";
import {
	createCustomTranslationProvider,
	normalizeSelectionTranslationSettings,
	type CustomWebTranslationProvider,
	type SelectionTranslationSettings,
} from "../../config/selection-translation-settings";
import { getEpubStorageService, normalizeEpubBookmarkFolderPath } from "../../services/epub";
import { notifyExcerptSettingsChanged } from "../../services/epub/excerpt-settings-events";
import { ensureDefaultBookNotesExportTemplates } from "../../services/epub/book-notes-export/install-templates";
import { resolveBookNotesExportTemplateFolder } from "../../services/epub/book-notes-export/template-folder";
import {
	normalizeInterfaceLanguagePreference,
	setInterfaceLanguagePreference,
	type InterfaceLanguagePreference,
} from "../../utils/i18n";
import { showNotification } from "../../utils/notifications";
import { getVaultFileBasename } from "../../utils/VaultMarkdownFileSuggest";
import { normalizeVaultFolderPath } from "../../utils/vault-folder-markdown-filter";
import type StandaloneEpubPlugin from "../../main";
import { BookNotesExportTemplateModalObsidian } from "./BookNotesExportTemplateModalObsidian";
import type { EpubSettingsTranslateFn } from "./epub-settings-types";

export interface EpubBasicSettingsActionDeps {
	plugin: StandaloneEpubPlugin;
	getTranslate: () => EpubSettingsTranslateFn;
	getBookmarkFolderValue: () => string;
	getInterfaceLanguageValue: () => InterfaceLanguagePreference;
	getContinuousReadingPositionAutoSaveEnabled: () => boolean;
	getContinuousReadingPositionAutoSavePages: () => number;
	getSourceNavigationOpenInNewTab: () => boolean;
	getDebugModeEnabled: () => boolean;
	getBookNotesExportTemplateFolderValue: () => string;
	getBookNotesExportDefaultTemplatePath: () => string;
	getCustomTranslationProviderDrafts: () => CustomWebTranslationProvider[];
	getAutoSavePagesTextControl: () => TextComponent | null;
	setBookmarkFolderInput: (value: string) => void;
	setBookNotesExportTemplateFolderInput: (value: string) => void;
	setBookNotesExportTemplateFolderValue: (value: string) => void;
	setBookNotesExportDefaultTemplatePath: (value: string) => void;
	setContinuousReadingPositionAutoSavePagesInput: (value: string) => void;
	setExcerptSettingsVersion: (updater: (value: number) => number) => void;
	save: () => Promise<void>;
}

export function createEpubBasicSettingsActions(deps: EpubBasicSettingsActionDeps) {
	const { plugin } = deps;
	const t = (key: string, params?: Record<string, string | number>) =>
		deps.getTranslate()(key, params);

	function getSelectionTranslationSettings(): SelectionTranslationSettings {
		return normalizeSelectionTranslationSettings(plugin.settings?.selectionTranslation);
	}

	async function persistSelectionTranslationSettings(
		next: SelectionTranslationSettings
	): Promise<void> {
		plugin.settings.selectionTranslation = next;
		await deps.save();
	}

	async function refreshBookNotesExportTemplateFolder(options?: {
		notify?: boolean;
	}): Promise<void> {
		const settings = await getEpubStorageService(plugin.app).loadExcerptSettings();
		const folderValue = resolveBookNotesExportTemplateFolder(settings);
		deps.setBookNotesExportTemplateFolderValue(folderValue);
		deps.setBookNotesExportTemplateFolderInput(folderValue);
		deps.setBookNotesExportDefaultTemplatePath(
			String(settings.bookNotesExportTemplatePath || "").trim()
		);
		deps.setExcerptSettingsVersion((value) => value + 1);
		if (options?.notify) {
			notifyExcerptSettingsChanged(settings);
		}
	}

	return {
		refreshBookNotesExportTemplateFolder,

		async updateBookmarkFolder(folderPath: string): Promise<void> {
			const normalizedFolderPath = normalizeEpubBookmarkFolderPath(folderPath);
			if (!normalizedFolderPath) {
				deps.setBookmarkFolderInput(deps.getBookmarkFolderValue());
				return;
			}
			if (normalizedFolderPath === deps.getBookmarkFolderValue()) {
				deps.setBookmarkFolderInput(deps.getBookmarkFolderValue());
				return;
			}

			plugin.settings.bookmarkFolder = normalizedFolderPath;
			await deps.save();
			showNotification(t("epub.settings.notifications.bookmarkFolderUpdated"), "success");
		},

		async updateInterfaceLanguage(value: InterfaceLanguagePreference): Promise<void> {
			const normalizedValue = normalizeInterfaceLanguagePreference(value);
			if (deps.getInterfaceLanguageValue() === normalizedValue) {
				return;
			}

			plugin.settings.interfaceLanguage = normalizedValue;
			setInterfaceLanguagePreference(normalizedValue);
			await deps.save();
			showNotification(t("epub.settings.notifications.interfaceLanguageUpdated"), "success");
		},

		async updateBookNotesExportTemplatePath(templatePath: string): Promise<void> {
			const normalizedPath = String(templatePath || "").trim();
			if (!normalizedPath || normalizedPath === deps.getBookNotesExportDefaultTemplatePath()) {
				return;
			}

			const storageService = getEpubStorageService(plugin.app);
			const currentSettings = await storageService.loadExcerptSettings();
			await storageService.saveExcerptSettings({
				...currentSettings,
				bookNotesExportTemplatePath: normalizedPath,
			});
			deps.setBookNotesExportDefaultTemplatePath(normalizedPath);
			deps.setExcerptSettingsVersion((value) => value + 1);
			notifyExcerptSettingsChanged(await storageService.loadExcerptSettings());
			showNotification(
				t("epub.settings.notifications.templateSwitched", {
					template: getVaultFileBasename(normalizedPath),
				}),
				"success"
			);
		},

		async updateBookNotesExportTemplateFolder(folderPath: string): Promise<void> {
			const normalizedFolderPath = normalizeVaultFolderPath(folderPath);
			if (!normalizedFolderPath) {
				deps.setBookNotesExportTemplateFolderInput(deps.getBookNotesExportTemplateFolderValue());
				return;
			}

			if (normalizedFolderPath === deps.getBookNotesExportTemplateFolderValue()) {
				deps.setBookNotesExportTemplateFolderInput(deps.getBookNotesExportTemplateFolderValue());
				return;
			}

			const storageService = getEpubStorageService(plugin.app);
			const currentSettings = await storageService.loadExcerptSettings();
			await storageService.saveExcerptSettings({
				...currentSettings,
				bookNotesExportTemplateFolder: normalizedFolderPath,
			});
			await ensureDefaultBookNotesExportTemplates(plugin.app, normalizedFolderPath);
			await refreshBookNotesExportTemplateFolder({ notify: true });
			showNotification(
				t("epub.settings.notifications.bookNotesExportTemplateFolderUpdated"),
				"success"
			);
		},

		openBookNotesExportTemplateModal(): void {
			const modal = new BookNotesExportTemplateModalObsidian(plugin.app, {
				plugin,
				onClose: () => {
					void refreshBookNotesExportTemplateFolder();
				},
			});
			modal.open();
		},

		async updateContinuousReadingPositionAutoSaveEnabled(enabled: boolean): Promise<void> {
			const normalizedEnabled = normalizeContinuousReadingPositionAutoSaveEnabled(enabled);
			if (deps.getContinuousReadingPositionAutoSaveEnabled() === normalizedEnabled) {
				return;
			}

			plugin.settings.continuousReadingPositionAutoSaveEnabled = normalizedEnabled;
			if (plugin.settings.continuousReadingPositionAutoSavePages == null) {
				plugin.settings.continuousReadingPositionAutoSavePages =
					DEFAULT_CONTINUOUS_READING_POSITION_AUTO_SAVE_PAGES;
			}
			await deps.save();

			const autoSavePagesTextControl = deps.getAutoSavePagesTextControl();
			autoSavePagesTextControl?.setDisabled(!normalizedEnabled);
			if (!normalizedEnabled) {
				const pages = normalizeContinuousReadingPositionAutoSavePages(
					plugin.settings.continuousReadingPositionAutoSavePages
				);
				autoSavePagesTextControl?.setValue(String(pages));
			}

			showNotification(
				normalizedEnabled
					? t("epub.settings.notifications.autoSaveEnabled")
					: t("epub.settings.notifications.autoSaveDisabled"),
				"success"
			);
		},

		async updateContinuousReadingPositionAutoSavePages(value: string): Promise<void> {
			const normalizedPages = normalizeContinuousReadingPositionAutoSavePages(value);
			deps.setContinuousReadingPositionAutoSavePagesInput(String(normalizedPages));

			if (deps.getContinuousReadingPositionAutoSavePages() === normalizedPages) {
				return;
			}

			plugin.settings.continuousReadingPositionAutoSavePages = normalizedPages;
			if (plugin.settings.continuousReadingPositionAutoSaveEnabled == null) {
				plugin.settings.continuousReadingPositionAutoSaveEnabled =
					DEFAULT_CONTINUOUS_READING_POSITION_AUTO_SAVE_ENABLED;
			}
			await deps.save();
			showNotification(
				t("epub.settings.notifications.autoSavePagesUpdated", { pages: normalizedPages }),
				"success"
			);
		},

		async updateSourceNavigationOpenInNewTab(enabled: boolean): Promise<void> {
			if (deps.getSourceNavigationOpenInNewTab() === enabled) {
				return;
			}

			plugin.settings.sourceNavigationOpenInNewTab = enabled;
			await deps.save();
		},

		async updateDebugMode(enabled: boolean): Promise<void> {
			if (deps.getDebugModeEnabled() === enabled) {
				return;
			}

			plugin.settings.enableDebugMode = enabled;
			await deps.save();
			showNotification(
				enabled
					? t("epub.settings.notifications.debugEnabled")
					: t("epub.settings.notifications.debugDisabled"),
				"success"
			);
		},

		async setBuiltinTranslationProviderEnabled(
			providerId: string,
			enabled: boolean
		): Promise<void> {
			const current = getSelectionTranslationSettings();
			const disabled = new Set(current.disabledBuiltinIds);
			if (enabled) {
				disabled.delete(providerId);
			} else {
				disabled.add(providerId);
			}
			await persistSelectionTranslationSettings({
				...current,
				disabledBuiltinIds: [...disabled],
			});
		},

		async addCustomTranslationProvider(): Promise<void> {
			const current = getSelectionTranslationSettings();
			await persistSelectionTranslationSettings({
				...current,
				customProviders: [...current.customProviders, createCustomTranslationProvider()],
			});
		},

		async updateCustomTranslationProvider(
			index: number,
			patch: Partial<CustomWebTranslationProvider>
		): Promise<void> {
			const current = getSelectionTranslationSettings();
			const customProviders = current.customProviders.map((provider, providerIndex) =>
				providerIndex === index ? { ...provider, ...patch } : provider
			);
			await persistSelectionTranslationSettings({
				...current,
				customProviders,
			});
		},

		async commitCustomTranslationProviderDrafts(): Promise<void> {
			const current = getSelectionTranslationSettings();
			const normalizedDrafts = deps.getCustomTranslationProviderDrafts().map((provider) => ({
				...provider,
				name: String(provider.name || "").trim(),
				urlTemplate: String(provider.urlTemplate || "").trim(),
				category: "translation" as const,
			}));
			const unchanged =
				JSON.stringify(current.customProviders) === JSON.stringify(normalizedDrafts);
			if (unchanged) {
				return;
			}
			await persistSelectionTranslationSettings({
				...current,
				customProviders: normalizedDrafts,
			});
		},

		async removeCustomTranslationProvider(index: number): Promise<void> {
			const current = getSelectionTranslationSettings();
			await persistSelectionTranslationSettings({
				...current,
				customProviders: current.customProviders.filter(
					(_, providerIndex) => providerIndex !== index
				),
			});
		},
	};
}
