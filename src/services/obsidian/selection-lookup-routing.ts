import { Platform } from "obsidian";
import { domInstanceOf } from "../../utils/dom-instance-of";
import type {
	ResolvedWebTranslationProvider,
	SelectionTranslationSettings,
} from "../../config/selection-translation-settings";

const DICTIONARY_PRIORITY_DESKTOP = [
	"eudic-dict",
	"youdao-dict",
	"collins",
	"cambridge",
	"reverso-context",
	"eudic-app",
] as const;

const DICTIONARY_PRIORITY_MOBILE = [
	"eudic-app",
	"eudic-dict",
	"youdao-dict",
	"collins",
	"cambridge",
	"reverso-context",
] as const;

const TRANSLATION_PRIORITY = [
	"deepl",
	"google-translate",
	"youdao-translate",
	"bing-translate",
	"baidu-translate",
] as const;

const PARAGRAPH_LIKE_TAGS = new Set([
	"p",
	"li",
	"td",
	"th",
	"blockquote",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"div",
	"section",
	"article",
]);

/** Short single-word or phrase selections are routed to dictionary providers. */
export function isDictionaryLookupCandidate(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed || trimmed.length > 48) {
		return false;
	}

	const words = trimmed.split(/\s+/).filter(Boolean);
	if (words.length > 3) {
		return false;
	}

	return /^[\p{L}\p{N}'-]+(?:\s+[\p{L}\p{N}'-]+){0,2}$/u.test(trimmed);
}

export function extractSelectionContext(
	iframeDoc: Document | null,
	selectedText: string,
	maxLength = 240,
	explicitRange?: Range | null
): string {
	const fallback = selectedText.trim();
	if (!iframeDoc || !fallback) {
		return fallback;
	}

	try {
		let range: Range | null = explicitRange || null;
		if (!range) {
			const selection = iframeDoc.getSelection();
			if (selection && selection.rangeCount > 0) {
				range = selection.getRangeAt(0);
			}
		}

		if (!range) {
			return fallback;
		}

		let node: Node | null = range.commonAncestorContainer;
		if (node.nodeType === Node.TEXT_NODE) {
			node = node.parentElement;
		}

		while (node && domInstanceOf(node, HTMLElement)) {
			const tag = node.tagName.toLowerCase();
			if (PARAGRAPH_LIKE_TAGS.has(tag)) {
				const paragraphText = node.textContent?.replace(/\s+/g, " ").trim() || fallback;
				if (paragraphText.length <= maxLength) {
					return paragraphText;
				}
				return paragraphText.slice(0, maxLength);
			}
			node = node.parentElement;
		}
	} catch {
		return fallback;
	}

	return fallback;
}

function sortProvidersByPriority(
	providers: ResolvedWebTranslationProvider[],
	priority: readonly string[]
): ResolvedWebTranslationProvider[] {
	const rank = new Map(priority.map((id, index) => [id, index]));
	return [...providers].sort((left, right) => {
		const leftRank = rank.get(left.id);
		const rightRank = rank.get(right.id);
		if (leftRank == null && rightRank == null) {
			return left.label.localeCompare(right.label);
		}
		if (leftRank == null) {
			return 1;
		}
		if (rightRank == null) {
			return -1;
		}
		return leftRank - rightRank;
	});
}

export function resolveSmartDictionaryProvider(input: {
	providers: ResolvedWebTranslationProvider[];
	settings: SelectionTranslationSettings;
}): ResolvedWebTranslationProvider | null {
	if (input.providers.length === 0) {
		return null;
	}

	const priority = Platform.isMobile
		? [...DICTIONARY_PRIORITY_MOBILE]
		: input.settings.preferNativeDictionaryApp
			? ["eudic-app", ...DICTIONARY_PRIORITY_DESKTOP.filter((id) => id !== "eudic-app")]
			: [...DICTIONARY_PRIORITY_DESKTOP];

	return sortProvidersByPriority(input.providers, priority)[0] ?? null;
}

export function resolveSmartTranslationProvider(
	providers: ResolvedWebTranslationProvider[]
): ResolvedWebTranslationProvider | null {
	if (providers.length === 0) {
		return null;
	}
	return sortProvidersByPriority(providers, TRANSLATION_PRIORITY)[0] ?? null;
}

export function shouldOfferSmartDictionaryAction(text: string, settings: SelectionTranslationSettings): boolean {
	return settings.smartRoutingEnabled && isDictionaryLookupCandidate(text);
}

export function shouldOfferSmartTranslationAction(text: string, settings: SelectionTranslationSettings): boolean {
	return settings.smartRoutingEnabled && !isDictionaryLookupCandidate(text);
}
