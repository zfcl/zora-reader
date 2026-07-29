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
	? "weave-epub-ai-reader"
	: "weave-epub";
const legacyProtocolNames = isStandalone
	? ["weave-epub-reader", "weave-epub"]
	: [];
const bookshelfDataChangedEvent = isStandalone
	? "WeaveEpubAI:epub-bookshelf-data-changed"
	: "Weave:epub-bookshelf-data-changed";
const bookshelfRefreshRequestEvent = isStandalone
	? "WeaveEpubAI:epub-bookshelf-refresh-request"
	: "Weave:epub-bookshelf-refresh-request";
const bookshelfDisplaySettingsChangedEvent = isStandalone
	? "WeaveEpubAI:epub-bookshelf-display-settings-changed"
	: "Weave:epub-bookshelf-display-settings-changed";
const bookDisplayTitleChangedEvent = isStandalone
	? "WeaveEpubAI:epub-book-display-title-changed"
	: "Weave:epub-book-display-title-changed";
const excerptSettingsChangedEvent = isStandalone
	? "WeaveEpubAI:epub-excerpt-settings-changed"
	: "Weave:epub-excerpt-settings-changed";
const highlightSyncRequestedEvent = isStandalone
	? "WeaveEpubAI:epub-highlight-sync-requested"
	: "Weave:epub-highlight-sync-requested";

export const EPUB_RUNTIME: EpubRuntimeConfig = {
	pluginId: isStandalone ? "weave-epub-ai-reader" : "weave",
	pluginDirName: isStandalone ? "weave-epub-ai-reader" : "weave",
	viewTypes: {
		reader: isStandalone ? "weave-epub-ai-reader" : "weave-epub-reader",
		sidebar: isStandalone ? "weave-epub-ai-sidebar" : "weave-epub-sidebar",
		bookshelfSidebar: isStandalone
			? "weave-epub-ai-bookshelf-sidebar"
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
			? "WeaveEpubAI:epub-navigate"
			: "Weave:epub-navigate",
		premiumFeaturePreviewRequest: isStandalone
			? "WeaveEpubAI:epub-premium-feature-preview-request"
			: "Weave:epub-premium-feature-preview-request",
		premiumUiStateChanged: isStandalone
			? "WeaveEpubAI:epub-premium-ui-state-changed"
			: "Weave:epub-premium-ui-state-changed",
	},
	globals: {
		pendingNavigationKey: isStandalone
			? "__weaveEpubAIPendingNav"
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
