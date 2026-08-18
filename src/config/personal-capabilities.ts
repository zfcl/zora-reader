import {
  EPUB_CORE_FEATURE_IDS,
  EPUB_PREMIUM_FEATURE_IDS,
} from "./epub-feature-tier";

export const PERSONAL_ENABLED_EPUB_FEATURE_IDS = new Set<string>([
  ...EPUB_CORE_FEATURE_IDS,
  ...EPUB_PREMIUM_FEATURE_IDS,
]);

export const PERSONAL_EXTERNAL_BRIDGE_CAPABILITIES: Record<
  "aiSplit" | "incrementalReadingDeck" | "weaveVocabulary",
  boolean
> = {
  aiSplit: false,
  incrementalReadingDeck: false,
  weaveVocabulary: false,
};

export function isPersonalEpubFeatureEnabled(featureId: string): boolean {
  return PERSONAL_ENABLED_EPUB_FEATURE_IDS.has(featureId);
}

export function isExternalBridgeCapabilityEnabled(
  capability: keyof typeof PERSONAL_EXTERNAL_BRIDGE_CAPABILITIES
): boolean {
  return PERSONAL_EXTERNAL_BRIDGE_CAPABILITIES[capability] === true;
}
