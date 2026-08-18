export interface EpubRuntimeConfig {
	pluginId: string;
	pluginDirName: string;
	viewTypes: {
		reader: string;
		sidebar: string;
		bookshelfSidebar: string;
	};
	protocol: {
		primaryName: string;
		legacyNames: string[];
		allNames: string[];
	};
	events: {
		bookshelfDataChanged: string;
		bookshelfRefreshRequest: string;
		bookshelfDisplaySettingsChanged: string;
		bookDisplayTitleChanged: string;
		excerptSettingsChanged: string;
		highlightSyncRequested: string;
		navigate: string;
		premiumFeaturePreviewRequest: string;
		premiumUiStateChanged: string;
	};
	globals: {
		pendingNavigationKey: string;
	};
}

declare const __WEAVE_EPUB_STANDALONE__: boolean;

const isStandalone =
	typeof __WEAVE_EPUB_STANDALONE__ !== "undefined" && __WEAVE_EPUB_STANDALONE__;

const primaryProtocolName = isStandalone
	? "zora-reader"
	: "weave-epub";
const legacyProtocolNames = isStandalone
	? ["weave-epub-reader", "weave-epub"]
	: [];
const bookshelfDataChangedEvent = isStandalone
	? "ZoraReader:epub-bookshelf-data-changed"
	: "Weave:epub-bookshelf-data-changed";
const bookshelfRefreshRequestEvent = isStandalone
	? "ZoraReader:epub-bookshelf-refresh-request"
	: "Weave:epub-bookshelf-refresh-request";
const bookshelfDisplaySettingsChangedEvent = isStandalone
	? "ZoraReader:epub-bookshelf-display-settings-changed"
	: "Weave:epub-bookshelf-display-settings-changed";
const bookDisplayTitleChangedEvent = isStandalone
	? "ZoraReader:epub-book-display-title-changed"
	: "Weave:epub-book-display-title-changed";
const excerptSettingsChangedEvent = isStandalone
	? "ZoraReader:epub-excerpt-settings-changed"
	: "Weave:epub-excerpt-settings-changed";
const highlightSyncRequestedEvent = isStandalone
	? "ZoraReader:epub-highlight-sync-requested"
	: "Weave:epub-highlight-sync-requested";

export const EPUB_RUNTIME: EpubRuntimeConfig = {
	pluginId: isStandalone ? "zora-reader" : "weave",
	pluginDirName: isStandalone ? "zora-reader" : "weave",
	viewTypes: {
		reader: isStandalone ? "zora-reader" : "weave-epub-reader",
		sidebar: isStandalone ? "zora-reader-sidebar" : "weave-epub-sidebar",
		bookshelfSidebar: isStandalone
			? "zora-reader-bookshelf-sidebar"
			: "weave-epub-bookshelf-sidebar",
	},
	protocol: {
		primaryName: primaryProtocolName,
		legacyNames: legacyProtocolNames,
		allNames: [primaryProtocolName, ...legacyProtocolNames],
	},
	events: {
		bookshelfDataChanged: bookshelfDataChangedEvent,
		bookshelfRefreshRequest: bookshelfRefreshRequestEvent,
		bookshelfDisplaySettingsChanged: bookshelfDisplaySettingsChangedEvent,
		bookDisplayTitleChanged: bookDisplayTitleChangedEvent,
		excerptSettingsChanged: excerptSettingsChangedEvent,
		highlightSyncRequested: highlightSyncRequestedEvent,
		navigate: isStandalone
			? "ZoraReader:epub-navigate"
			: "Weave:epub-navigate",
		premiumFeaturePreviewRequest: isStandalone
			? "ZoraReader:epub-premium-feature-preview-request"
			: "Weave:epub-premium-feature-preview-request",
		premiumUiStateChanged: isStandalone
			? "ZoraReader:epub-premium-ui-state-changed"
			: "Weave:epub-premium-ui-state-changed",
	},
	globals: {
		pendingNavigationKey: isStandalone
			? "__zoraReaderPendingNav"
			: "__weaveEpubPendingNav",
	},
};

export function getEpubRuntime(): EpubRuntimeConfig {
	return EPUB_RUNTIME;
}

export function isLegacyEpubProtocolName(protocolName: string): boolean {
	return EPUB_RUNTIME.protocol.legacyNames.includes(protocolName);
}

export function isSupportedEpubProtocolName(protocolName: string): boolean {
	return EPUB_RUNTIME.protocol.allNames.includes(protocolName);
}
