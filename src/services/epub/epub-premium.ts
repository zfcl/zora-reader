import { App, Notice } from "obsidian";
import { EPUB_FEATURE_IDS, EPUB_PREMIUM_FEATURE_IDS } from "../../config/epub-feature-tier";
import { EPUB_RUNTIME } from "./epub-runtime";
import { PremiumFeatureGuard, PREMIUM_FEATURES } from "../premium/PremiumFeatureGuard";
import { i18n } from "../../utils/i18n";
import { isFreeBookFormat } from "./book-format";

export interface EpubFeatureTierPreviewItem {
	title: string;
	description: string;
	featureId?: string;
}

function buildEpubFreeFeaturePreviewItems(): EpubFeatureTierPreviewItem[] {
	return [
		{
			title: i18n.t("epub.premium.freeFeatures.basicReading.title"),
			description: i18n.t("epub.premium.freeFeatures.basicReading.description"),
		},
		{
			title: i18n.t("epub.premium.freeFeatures.bookmarksAndNavigation.title"),
			description: i18n.t("epub.premium.freeFeatures.bookmarksAndNavigation.description"),
		},
		{
			title: i18n.t("epub.premium.freeFeatures.typographyAndView.title"),
			description: i18n.t("epub.premium.freeFeatures.typographyAndView.description"),
		},
		{
			title: i18n.t("epub.premium.freeFeatures.aiAndTutorial.title"),
			description: i18n.t("epub.premium.freeFeatures.aiAndTutorial.description"),
		},
		{
			title: i18n.t("epub.premium.freeFeatures.cardCreation.title"),
			description: i18n.t("epub.premium.freeFeatures.cardCreation.description"),
		},
		{
			title: i18n.t("epub.premium.freeFeatures.excerptNotes.title"),
			description: i18n.t("epub.premium.freeFeatures.excerptNotes.description"),
		},
		{
			title: i18n.t("epub.premium.freeFeatures.incrementalReadingEntry.title"),
			description: i18n.t("epub.premium.freeFeatures.incrementalReadingEntry.description"),
		},
	];
}

function buildEpubPremiumFeaturePreviewMeta(): Record<
	(typeof EPUB_PREMIUM_FEATURE_IDS)[number],
	EpubFeatureTierPreviewItem
> {
	return {
		[EPUB_FEATURE_IDS.NON_EPUB_FORMATS]: {
			featureId: EPUB_FEATURE_IDS.NON_EPUB_FORMATS,
			title: i18n.t("epub.premium.premiumFeatures.nonEpubFormats.title"),
			description: i18n.t("epub.premium.premiumFeatures.nonEpubFormats.description"),
		},
		[EPUB_FEATURE_IDS.READING_REFERENCE]: {
			featureId: EPUB_FEATURE_IDS.READING_REFERENCE,
			title: i18n.t("epub.premium.premiumFeatures.readingReference.title"),
			description: i18n.t("epub.premium.premiumFeatures.readingReference.description"),
		},
		[EPUB_FEATURE_IDS.PARAGRAPH_MODE]: {
			featureId: EPUB_FEATURE_IDS.PARAGRAPH_MODE,
			title: i18n.t("epub.premium.premiumFeatures.paragraphMode.title"),
			description: i18n.t("epub.premium.premiumFeatures.paragraphMode.description"),
		},
		[EPUB_FEATURE_IDS.STYLED_EXCERPTS]: {
			featureId: EPUB_FEATURE_IDS.STYLED_EXCERPTS,
			title: i18n.t("epub.premium.premiumFeatures.styledExcerpts.title"),
			description: i18n.t("epub.premium.premiumFeatures.styledExcerpts.description"),
		},
		[EPUB_FEATURE_IDS.SOURCE_LOCATION]: {
			featureId: EPUB_FEATURE_IDS.SOURCE_LOCATION,
			title: i18n.t("epub.premium.premiumFeatures.sourceLocation.title"),
			description: i18n.t("epub.premium.premiumFeatures.sourceLocation.description"),
		},
		[EPUB_FEATURE_IDS.CANVAS_EXCERPTS]: {
			featureId: EPUB_FEATURE_IDS.CANVAS_EXCERPTS,
			title: i18n.t("epub.premium.premiumFeatures.canvasExcerpts.title"),
			description: i18n.t("epub.premium.premiumFeatures.canvasExcerpts.description"),
		},
		[EPUB_FEATURE_IDS.FOOTNOTE_PREVIEW]: {
			featureId: EPUB_FEATURE_IDS.FOOTNOTE_PREVIEW,
			title: i18n.t("epub.premium.premiumFeatures.footnotePreview.title"),
			description: i18n.t("epub.premium.premiumFeatures.footnotePreview.description"),
		},
		[EPUB_FEATURE_IDS.CHAPTER_EXPORT]: {
			featureId: EPUB_FEATURE_IDS.CHAPTER_EXPORT,
			title: i18n.t("epub.premium.premiumFeatures.chapterExport.title"),
			description: i18n.t("epub.premium.premiumFeatures.chapterExport.description"),
		},
	};
}

export function getEpubFeatureTierPreview(): {
	freeFeatures: EpubFeatureTierPreviewItem[];
	premiumFeatures: EpubFeatureTierPreviewItem[];
} {
	const freeFeatures = buildEpubFreeFeaturePreviewItems();
	const premiumFeaturePreviewMeta = buildEpubPremiumFeaturePreviewMeta();
	return {
		freeFeatures,
		premiumFeatures: EPUB_PREMIUM_FEATURE_IDS.map(
			(featureId) => premiumFeaturePreviewMeta[featureId]
		),
	};
}

export function getEpubPremiumFeaturePreviewContent(featureId: string): {
	title: string;
	description: string;
	freeFeatures: EpubFeatureTierPreviewItem[];
	premiumFeatures: EpubFeatureTierPreviewItem[];
} {
	const freeFeatures = buildEpubFreeFeaturePreviewItems();
	const premiumFeaturePreviewMeta = buildEpubPremiumFeaturePreviewMeta();
	const featurePreview =
		premiumFeaturePreviewMeta[featureId as (typeof EPUB_PREMIUM_FEATURE_IDS)[number]];
	return {
		title: featurePreview?.title ?? i18n.t("epub.premium.defaultTitle"),
		description: featurePreview?.description ?? i18n.t("epub.premium.defaultDescription"),
		freeFeatures,
		premiumFeatures: EPUB_PREMIUM_FEATURE_IDS.map(
			(currentFeatureId) => premiumFeaturePreviewMeta[currentFeatureId]
		),
	};
}

export function canUseEpubPremiumFeature(app: App, featureId: string): boolean {
	void app;
	return PremiumFeatureGuard.getInstance().canUseFeature(featureId, {
		page: "epub-reader",
	});
}

export function canOpenBookWithCurrentLicense(filePath: string): boolean {
	return (
		isFreeBookFormat(filePath) ||
		PremiumFeatureGuard.getInstance().canUseFeature(PREMIUM_FEATURES.EPUB_NON_EPUB_FORMATS, {
			page: "epub-reader",
		})
	);
}

export function canOpenEpubFile(app: App, filePath: string): boolean {
	return (
		isFreeBookFormat(filePath) ||
		canUseEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_NON_EPUB_FORMATS)
	);
}

export function canUseEpubReadingProgress(app: App): boolean {
	void app;
	return PremiumFeatureGuard.getInstance().canUseFeature(EPUB_FEATURE_IDS.READING_PROGRESS, {
		page: "epub-reader",
	});
}

export function canUseEpubReadingReference(app: App): boolean {
	return canUseEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_READING_REFERENCE);
}

export function canUseEpubParagraphMode(app: App): boolean {
	return canUseEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_PARAGRAPH_MODE);
}

export function canUseEpubExcerptNotes(app: App): boolean {
	void app;
	return true;
}

export function canUseEpubStyledExcerpts(app: App): boolean {
	void app;
	return true;
}

export function canUseEpubSourceLocation(app: App): boolean {
	return canUseEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_SOURCE_LOCATION);
}

/** Cross-document excerpt source tracing (book ↔ notes/cards), all supported formats. */
export function ensureBookSourceLocationAccess(
	app: App,
	noticeMessage?: string
): boolean {
	return ensureEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_SOURCE_LOCATION, noticeMessage);
}

export function canUseEpubCanvasExcerpts(app: App): boolean {
	return canUseEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_CANVAS_EXCERPTS);
}

export function canUseEpubFootnotePreview(app: App): boolean {
	return canUseEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_FOOTNOTE_PREVIEW);
}

export function canUseEpubChapterExport(app: App): boolean {
	return canUseEpubPremiumFeature(app, PREMIUM_FEATURES.EPUB_CHAPTER_EXPORT);
}

export function requestEpubPremiumFeaturePreview(app: App, featureId: string): void {
	const normalizedFeatureId = String(featureId || "").trim();
	if (!normalizedFeatureId) {
		return;
	}

	void app;
	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent(EPUB_RUNTIME.events.premiumFeaturePreviewRequest, {
				detail: { featureId: normalizedFeatureId },
			})
		);
	}
}

export function ensureEpubFileAccess(app: App, filePath: string, noticeMessage?: string): boolean {
	if (canOpenEpubFile(app, filePath)) {
		return true;
	}

	if (noticeMessage) {
		new Notice(noticeMessage);
	}
	requestEpubPremiumFeaturePreview(app, PREMIUM_FEATURES.EPUB_NON_EPUB_FORMATS);
	return false;
}

export function ensureEpubPremiumFeature(
	app: App,
	featureId: string,
	_noticeMessage?: string
): boolean {
	if (canUseEpubPremiumFeature(app, featureId)) {
		return true;
	}

	requestEpubPremiumFeaturePreview(app, featureId);
	return false;
}
