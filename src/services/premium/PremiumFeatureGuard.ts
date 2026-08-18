import { get, writable, type Writable } from "svelte/store";
import { isPersonalEpubFeatureEnabled } from "../../config/personal-capabilities";
import { EPUB_RUNTIME } from "../epub/epub-runtime";
import { LICENSED_PRODUCTS, type EffectiveLicenseState, type LicenseInfo, type LicensedProduct } from "../../utils/license-state";

export const PREMIUM_FEATURES = {
  EPUB_NON_EPUB_FORMATS: "epub-non-epub-formats",
  EPUB_READING_REFERENCE: "epub-reading-reference",
  EPUB_PARAGRAPH_MODE: "epub-paragraph-mode",
  EPUB_EXCERPT_NOTES: "epub-excerpt-notes",
  EPUB_STYLED_EXCERPTS: "epub-styled-excerpts",
  EPUB_SOURCE_LOCATION: "epub-source-location",
  EPUB_CANVAS_EXCERPTS: "epub-canvas-excerpts",
  EPUB_FOOTNOTE_PREVIEW: "epub-footnote-preview",
  EPUB_CHAPTER_EXPORT: "epub-chapter-export",
} as const;

export const FEATURE_METADATA: Record<string, { icon?: string }> = {
  [PREMIUM_FEATURES.EPUB_NON_EPUB_FORMATS]: { icon: "library" },
  [PREMIUM_FEATURES.EPUB_READING_REFERENCE]: { icon: "flag" },
  [PREMIUM_FEATURES.EPUB_PARAGRAPH_MODE]: { icon: "pilcrow" },
  [PREMIUM_FEATURES.EPUB_EXCERPT_NOTES]: { icon: "highlighter" },
  [PREMIUM_FEATURES.EPUB_STYLED_EXCERPTS]: { icon: "underline" },
  [PREMIUM_FEATURES.EPUB_SOURCE_LOCATION]: { icon: "map-pinned" },
  [PREMIUM_FEATURES.EPUB_CANVAS_EXCERPTS]: { icon: "layout-dashboard" },
  [PREMIUM_FEATURES.EPUB_FOOTNOTE_PREVIEW]: { icon: "message-square" },
  [PREMIUM_FEATURES.EPUB_CHAPTER_EXPORT]: { icon: "file-output" },
};

export const PREMIUM_BENEFIT_FEATURE_ORDER = [
  PREMIUM_FEATURES.EPUB_NON_EPUB_FORMATS,
  PREMIUM_FEATURES.EPUB_SOURCE_LOCATION,
  PREMIUM_FEATURES.EPUB_PARAGRAPH_MODE,
] as const;

export interface PremiumFeatureAccessContext { page?: string; }

export class PremiumFeatureGuard {
  private static instance: PremiumFeatureGuard;
  private currentProduct: LicensedProduct = LICENSED_PRODUCTS.EPUB;
  public isPremiumActive: Writable<boolean>;
  public premiumFeaturesPreviewEnabled: Writable<boolean>;
  private constructor() {
    this.isPremiumActive = writable(true);
    this.premiumFeaturesPreviewEnabled = writable(false);
  }
  static getInstance(): PremiumFeatureGuard {
    if (!PremiumFeatureGuard.instance) PremiumFeatureGuard.instance = new PremiumFeatureGuard();
    return PremiumFeatureGuard.instance;
  }
  async initializeForProduct(input: { product?: LicensedProduct; localLicenses?: LicenseInfo[]; inheritedLicenses?: LicenseInfo[] }): Promise<void> {
    this.currentProduct = input.product ?? this.currentProduct;
    this.isPremiumActive.set(true);
    this.dispatchPremiumUiStateChanged();
  }
  async updateLicenseState(input: { product?: LicensedProduct; localLicenses?: LicenseInfo[]; inheritedLicenses?: LicenseInfo[] }): Promise<void> {
    await this.initializeForProduct(input);
  }
  getEffectiveState(): EffectiveLicenseState {
    return { product: this.currentProduct, localLicenses: [], inheritedLicenses: [], activeLicenses: [], entitlements: [], primaryLicense: null, isPremiumActive: true };
  }
  setPremiumFeaturesPreview(_enabled: boolean): void { this.premiumFeaturesPreviewEnabled.set(false); this.dispatchPremiumUiStateChanged(); }
  isPremiumFeature(_featureId: string): boolean { return false; }
  shouldShowFeatureEntry(featureId: string): boolean { return this.canUseFeature(featureId); }
  canUseFeature(featureId: string, _context?: PremiumFeatureAccessContext): boolean { return isPersonalEpubFeatureEnabled(featureId); }
  canUseAnyFeature(featureIds: string[], context?: PremiumFeatureAccessContext): boolean { return featureIds.some((id) => this.canUseFeature(id, context)); }
  getFeatureEntryTitle(baseTitle: string, _featureId: string): string { return baseTitle; }
  private dispatchPremiumUiStateChanged(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(EPUB_RUNTIME.events.premiumUiStateChanged));
  }
}
export default PremiumFeatureGuard;
