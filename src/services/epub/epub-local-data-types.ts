import type { EpubBookshelfMembershipEntry } from "./epub-bookshelf-membership-store";
import type { EpubBookshelfPlaylist } from "./epub-bookshelf-playlist-store";
import type { EpubExcerptSettings } from "./epub-excerpt-settings";
import type { EpubReaderSettingsDeviceKind } from "./reader-settings";
import type {
	BookMetadata,
	ConcealedText,
	EpubBook,
	EpubLastOpenBookmark,
	EpubReadingReferencePoint,
	EpubReaderSettings,
} from "./types";
import type { EpubTocChapterMarkMap } from "./epub-toc-chapter-mark";
import type { EpubTocChapterMarkSettings } from "./epub-toc-chapter-mark-settings";
export interface EpubPluginUiMemory {
	lastSelectedIRDeckId: string;
	selectionQuickCreateLastFolder: string;
	epubMarkdownExportLastFolder: string;
	bookshelfSearchQuery: string;
	readerTutorialDismissed: boolean;
}

export interface EpubBookshelfIndexEntry {
	path: string;
	name: string;
	folder: string;
	size: number;
	addedAt?: number;
	customCoverPath?: string;
}

export interface EpubScanIndexEntry extends EpubBookshelfIndexEntry {
	mtime: number;
	coverImage?: string;
}

export interface EpubSourceRegistryEntry {
	sourceId: string;
	filePath: string;
	sourceFingerprint?: string;
	legacySourceIds?: string[];
	sourceSize?: number;
	sourceMtime?: number;
	lastSeenAt: number;
	lastKnownPath?: string;
}

export interface EpubStoredBookDescriptor {
	id: string;
	filePath: string;
	sourceId?: string;
	sourceFingerprint?: string;
	sourceMtime?: number;
	sourceSize?: number;
	metadata: BookMetadata;
}

import type { DirectHighlight } from "./types";

export interface EpubReaderLocalBookRecord {
	descriptor?: EpubStoredBookDescriptor;
	state?: Pick<EpubBook, "currentPosition" | "readingStats">;
	lastOpenBookmark?: EpubLastOpenBookmark | null;
	readingReferencePoint?: EpubReadingReferencePoint | null;
	concealedTexts?: ConcealedText[];
	tocChapterMarks?: EpubTocChapterMarkMap;
	directHighlights?: DirectHighlight[];
}

export interface CanvasExcerptAnchorRecord {
	lockedNodeId: string | null;
	lastCreatedNodeId: string | null;
	layoutDirection?: "down" | "right" | "up" | "left";
}

export interface EpubReaderLocalDataFile {
	version: 1;
	updatedAt: number;
	bookCatalogStoredLocally?: boolean;
	uiMemory?: EpubPluginUiMemory;
	readerSettings?: Partial<Record<EpubReaderSettingsDeviceKind, EpubReaderSettings>>;
	excerptSettings?: EpubExcerptSettings;
	bookNotesExportAppendByBook?: Record<string, string>;
	scanIndex?: EpubScanIndexEntry[];
	bookshelfMembership?: EpubBookshelfMembershipEntry[];
	bookshelfPlaylists?: EpubBookshelfPlaylist[];
	sourceRegistry?: EpubSourceRegistryEntry[];
	canvasBindings?: Record<string, string>;
	canvasExcerptAnchors?: Record<string, CanvasExcerptAnchorRecord>;
	books?: Record<string, EpubReaderLocalBookRecord>;
	tocChapterMarkSettings?: EpubTocChapterMarkSettings;
}
