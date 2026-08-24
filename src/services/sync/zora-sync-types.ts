export type ZoraAnnotationType = "highlight";
export type ZoraAnnotationStyle = "highlight" | "underline" | "strikethrough" | "wavy" | "reading-note";
export type ZoraAnnotationColor = "yellow" | "blue" | "red" | "purple" | "green" | "mask";

export interface ZoraBookSyncIdentity {
	bookId: string;
	title: string;
	author?: string;
	vaultPath: string;
	createdAt: string;
	updatedAt: string;
}

export interface ZoraProgressSyncRecord {
	bookId: string;
	deviceId: string;
	cfi: string;
	href?: string;
	percentage: number;
	updatedAt: string;
}

export interface ZoraAnnotationSyncRecord {
	id: string;
	bookId: string;
	cfiRange: string;
	type: ZoraAnnotationType;
	color: ZoraAnnotationColor;
	style: ZoraAnnotationStyle;
	text: string;
	selectedTextHash?: string;
	chapterIndex?: number;
	chapterTitle?: string;
	createdAt: string;
	updatedAt: string;
}

export interface ZoraNoteSyncRecord {
	id: string;
	bookId: string;
	annotationId?: string;
	cfiRange: string;
	type: "reading-note" | "study-note";
	content: string;
	selectedText?: string;
	chapterIndex?: number;
	createdAt: string;
	updatedAt: string;
}

export interface ZoraTombstoneRecord {
	id: string;
	entityType: "annotation" | "note" | "progress";
	deletedAt: string;
	deviceId: string;
}

export interface ZoraMigrationV2Record {
	migratedAt: string;
	version: 2;
	booksCount: number;
	annotationsCount: number;
	notesCount: number;
	progressCount: number;
}

export interface ZoraSyncDiagnostics {
	bookId?: string;
	deviceId: string;
	latestProgressDevice?: string;
	latestProgressTime?: string;
	annotationCount: number;
	readingNoteCount: number;
	lastSyncScan?: string;
	lastSyncError?: string;
}
