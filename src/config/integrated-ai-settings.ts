import type { App } from "obsidian";

export interface IntegratedAISettings {
	enabled: boolean;
	apiKeySecretId: string;
	endpoint: string;
	model: string;
	maxTokens: number;
	customPrompt: string;
}

export const DEFAULT_INTEGRATED_AI_SECRET_ID =
	"weave-epub-ai-reader-deepseek-api-key";

export const DEFAULT_INTEGRATED_AI_SETTINGS: IntegratedAISettings = {
	enabled: true,
	apiKeySecretId: DEFAULT_INTEGRATED_AI_SECRET_ID,
	endpoint: "https://api.deepseek.com/chat/completions",
	model: "deepseek-v4-flash",
	maxTokens: 2000,
	customPrompt:
		"你是一名得力的 AI 伴读助手。请根据我选中的文本提供有用、准确且有条理的解读和答复。请返回纯文本，不要使用 Markdown 格式。",
};

interface SecretStorageLike {
	getSecret(id: string): string | null;
	setSecret(id: string, value: string): void | Promise<void>;
	deleteSecret?(id: string): void | Promise<void>;
}

function getSecretStorage(app: App): SecretStorageLike | null {
	const candidate = app as App & { secretStorage?: SecretStorageLike };
	return candidate.secretStorage ?? null;
}

export function normalizeIntegratedAISettings(
	value: unknown,
): IntegratedAISettings {
	const raw =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Partial<IntegratedAISettings>)
			: {};
	const parsedMaxTokens = Number(raw.maxTokens);

	return {
		enabled: raw.enabled !== false,
		apiKeySecretId:
			String(raw.apiKeySecretId || "").trim() ||
			DEFAULT_INTEGRATED_AI_SECRET_ID,
		endpoint:
			String(raw.endpoint || "").trim() ||
			DEFAULT_INTEGRATED_AI_SETTINGS.endpoint,
		model:
			String(raw.model || "").trim() || DEFAULT_INTEGRATED_AI_SETTINGS.model,
		maxTokens: Number.isFinite(parsedMaxTokens)
			? Math.min(16_384, Math.max(256, Math.round(parsedMaxTokens)))
			: DEFAULT_INTEGRATED_AI_SETTINGS.maxTokens,
		customPrompt:
			String(raw.customPrompt || "").trim() ||
			DEFAULT_INTEGRATED_AI_SETTINGS.customPrompt,
	};
}

export function supportsIntegratedAISecretStorage(app: App): boolean {
	return getSecretStorage(app) !== null;
}

export function readIntegratedAIApiKey(
	app: App,
	settings: IntegratedAISettings,
): string {
	return (
		getSecretStorage(app)?.getSecret(settings.apiKeySecretId)?.trim() ?? ""
	);
}

export async function writeIntegratedAIApiKey(
	app: App,
	settings: IntegratedAISettings,
	apiKey: string,
): Promise<boolean> {
	const storage = getSecretStorage(app);
	if (!storage) {
		return false;
	}
	await storage.setSecret(settings.apiKeySecretId, apiKey.trim());
	return true;
}

export async function clearIntegratedAIApiKey(
	app: App,
	settings: IntegratedAISettings,
): Promise<boolean> {
	const storage = getSecretStorage(app);
	if (!storage) {
		return false;
	}
	if (storage.deleteSecret) {
		await storage.deleteSecret(settings.apiKeySecretId);
	} else {
		await storage.setSecret(settings.apiKeySecretId, "");
	}
	return true;
}
