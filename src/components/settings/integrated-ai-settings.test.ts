import type { App } from "obsidian";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_INTEGRATED_AI_SECRET_ID,
	DEFAULT_INTEGRATED_AI_SETTINGS,
	clearIntegratedAIApiKey,
	normalizeIntegratedAISettings,
	readIntegratedAIApiKey,
	writeIntegratedAIApiKey,
} from "../../config/integrated-ai-settings";

describe("integrated AI settings", () => {
	it("uses a SecretStorage-compatible ID and stable defaults", () => {
		expect(DEFAULT_INTEGRATED_AI_SECRET_ID).toMatch(/^[a-z0-9-]+$/);
		expect(DEFAULT_INTEGRATED_AI_SETTINGS.endpoint).toBe(
			"https://api.deepseek.com/chat/completions",
		);
		expect(DEFAULT_INTEGRATED_AI_SETTINGS.model).toBe("deepseek-v4-flash");
	});

	it("normalizes missing values and clamps max tokens", () => {
		expect(normalizeIntegratedAISettings(null)).toEqual(
			DEFAULT_INTEGRATED_AI_SETTINGS,
		);
		expect(normalizeIntegratedAISettings({ maxTokens: 1 }).maxTokens).toBe(256);
		expect(normalizeIntegratedAISettings({ maxTokens: 99_999 }).maxTokens).toBe(
			16_384,
		);
		expect(normalizeIntegratedAISettings({ enabled: false }).enabled).toBe(
			false,
		);
	});

	it("reads, writes, and clears the key through SecretStorage only", async () => {
		const secrets = new Map<string, string>();
		const app = {
			secretStorage: {
				getSecret: (id: string) => secrets.get(id) ?? null,
				setSecret: (id: string, value: string) => {
					secrets.set(id, value);
				},
			},
		} as unknown as App;
		const settings = normalizeIntegratedAISettings(undefined);

		expect(readIntegratedAIApiKey(app, settings)).toBe("");
		expect(await writeIntegratedAIApiKey(app, settings, "  sk-test  ")).toBe(
			true,
		);
		expect(readIntegratedAIApiKey(app, settings)).toBe("sk-test");
		expect(await clearIntegratedAIApiKey(app, settings)).toBe(true);
		expect(readIntegratedAIApiKey(app, settings)).toBe("");
	});
});
