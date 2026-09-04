export type SyncAnnotationType = "highlight" | "underline" | "strikethrough" | "wavy" | "reading-note";

export interface SyncBookMeta {
	bookId: string;
	title: string;
	author?: string;
	vaultPath?: string;
	fileSize?: number;
	updatedAt: string;
}

export interface SyncProgress {
	bookId: string;
	deviceId: string;
	cfi: string;
	href?: string;
	percentage: number;
	chapterIndex?: number;
	chapterTitle?: string;
	updatedAt: string;
}

export interface SyncBookmark {
	id: string;
	bookId: string;
	cfi: string;
	chapterIndex: number;
	percentage: number;
	chapterTitle: string;
	pageNumber?: number;
	totalPages?: number;
	preview?: string;
	createdAt: string;
	updatedAt: string;
}

export interface SyncAnnotation {
	id: string;
	bookId: string;
	cfiRange: string;
	type: SyncAnnotationType;
	color: string;
	style?: SyncAnnotationType;
	text: string;
	selectedTextHash?: string;
	chapterIndex?: number;
	chapterTitle?: string;
	createdAt: string;
	updatedAt: string;
}

export interface SyncNote {
	id: string;
	bookId: string;
	annotationId?: string;
	cfiRange: string;
	type: "reading-note" | "study-note";
	content: string;
	selectedText?: string;
	chapterIndex?: number;
	chapterTitle?: string;
	createdAt: string;
	updatedAt: string;
}

export interface SyncTombstone {
	id: string;
	entityType: "annotation" | "note" | "bookmark";
	deletedAt: string;
	deviceId: string;
}

export interface SyncMigrationV2Record {
	version: 2;
	migratedAt: string;
	deviceId: string;
	migratedBookIds: string[];
	counts: {
		highlights: number;
		notes: number;
		progress: number;
	};
}

export interface SyncDiagnostics {
	bookId?: string;
	deviceId: string;
	latestProgressDevice?: string;
	latestProgressTime?: string;
	annotationCount: number;
	bookmarkCount: number;
	readingNoteCount: number;
	lastSyncScan?: string;
	lastSyncError?: string;
}
