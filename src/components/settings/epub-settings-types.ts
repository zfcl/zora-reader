import type { TextComponent } from "obsidian";
import type {
	CustomWebTranslationProvider,
	SelectionTranslationSettings,
} from "../../config/selection-translation-settings";
import type StandaloneEpubPlugin from "../../main";
import type { InterfaceLanguagePreference } from "../../utils/i18n";

export type EpubSettingsTabId = "basic" | "ai" | "about";

export type SettingsCleanupFn = () => void;

export type EpubSettingsTranslateFn = (
	key: string,
	params?: Record<string, string | number>,
) => string;

export interface EpubBasicSettingsHosts {
	interface: HTMLElement;
	reading: HTMLElement;
	selectionTranslation: HTMLElement;
	diagnostics: HTMLElement;
}

export interface EpubBasicSettingsSnapshot {
	interfaceLanguageValue: InterfaceLanguagePreference;
	bookmarkFolderValue: string;
	bookmarkFolderInput: string;
	bookNotesExportTemplateFolderValue: string;
	bookNotesExportTemplateFolderInput: string;
	bookNotesExportDefaultTemplatePath: string;
	continuousReadingPositionAutoSaveEnabled: boolean;
	continuousReadingPositionAutoSavePages: number;
	continuousReadingPositionAutoSavePagesInput: string;
	sourceNavigationOpenInNewTab: boolean;
	debugModeEnabled: boolean;
	selectionTranslationSettings: SelectionTranslationSettings;
	customTranslationProviderDrafts: CustomWebTranslationProvider[];
}

export interface EpubBasicSettingsCallbacks {
	save: () => Promise<void>;
	setBookmarkFolderInput: (value: string) => void;
	setBookNotesExportTemplateFolderInput: (value: string) => void;
	setContinuousReadingPositionAutoSavePagesInput: (value: string) => void;
	setAutoSavePagesTextControl: (control: TextComponent | null) => void;
	updateBookmarkFolder: (folderPath: string) => Promise<void>;
	updateInterfaceLanguage: (
		value: InterfaceLanguagePreference,
	) => Promise<void>;
	updateBookNotesExportTemplatePath: (templatePath: string) => Promise<void>;
	updateBookNotesExportTemplateFolder: (folderPath: string) => Promise<void>;
	openBookNotesExportTemplateModal: () => void;
	updateContinuousReadingPositionAutoSaveEnabled: (
		enabled: boolean,
	) => Promise<void>;
	updateContinuousReadingPositionAutoSavePages: (
		value: string,
	) => Promise<void>;
	setBuiltinTranslationProviderEnabled: (
		providerId: string,
		enabled: boolean,
	) => Promise<void>;
	updateCustomTranslationProvider: (
		index: number,
		patch: Partial<CustomWebTranslationProvider>,
	) => Promise<void>;
	updateCustomTranslationProviderDraft: (
		index: number,
		patch: Partial<CustomWebTranslationProvider>,
	) => Promise<void>;
	commitCustomTranslationProviderDrafts: () => Promise<void>;
	addCustomTranslationProvider: () => Promise<void>;
	removeCustomTranslationProvider: (index: number) => Promise<void>;
	updateSourceNavigationOpenInNewTab: (enabled: boolean) => Promise<void>;
	updateDebugMode: (enabled: boolean) => Promise<void>;
}

export interface EpubBasicSettingsMountOptions {
	plugin: StandaloneEpubPlugin;
	t: EpubSettingsTranslateFn;
	hosts: EpubBasicSettingsHosts;
	snapshot: EpubBasicSettingsSnapshot;
	callbacks: EpubBasicSettingsCallbacks;
}
