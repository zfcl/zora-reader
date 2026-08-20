<script lang="ts">
	import { Notice, Setting } from "obsidian";
	import type { TextComponent } from "obsidian";
	import {
		clearIntegratedAIApiKey,
		DEFAULT_INTEGRATED_AI_SETTINGS,
		normalizeIntegratedAISettings,
		readIntegratedAIApiKey,
		supportsIntegratedAISecretStorage,
		writeIntegratedAIApiKey,
	} from "../../config/integrated-ai-settings";
	import type StandaloneEpubPlugin from "../../main";
	import { logZoraSettings } from "../../utils/zora-debug-logger";

	interface Props {
		plugin: StandaloneEpubPlugin;
	}

	let { plugin }: Props = $props();
	let settingsHost = $state<HTMLDivElement | null>(null);

	async function save(): Promise<void> {
		plugin.settings.aiAssistant = normalizeIntegratedAISettings(
			plugin.settings.aiAssistant
		);
		await plugin.saveSettings();
	}

	$effect(() => {
		if (!settingsHost) {
			return;
		}
		logZoraSettings("EpubAISettingsTab $effect mounting AI settings");
		const host = settingsHost;
		if (typeof (host as any).empty === "function") {
			(host as any).empty();
		} else {
			host.replaceChildren();
		}

		const settings = normalizeIntegratedAISettings(plugin.settings.aiAssistant);
		const supportsSecretStorage = supportsIntegratedAISecretStorage(plugin.app);
		let apiKeyDraft = "";
		let apiKeyInput: TextComponent | null = null;
		const hasSavedKey = Boolean(readIntegratedAIApiKey(plugin.app, settings));

		new Setting(host)
			.setName("启用 AI 助手与词义翻译")
			.setDesc("在阅读器选区工具栏中显示 AI 动作（词义、翻译、AI 对话等）。")
			.addToggle((toggle) => {
				toggle.setValue(settings.enabled).onChange(async (value) => {
					settings.enabled = value;
					plugin.settings.aiAssistant.enabled = value;
					await save();
				});
			});

		const keySetting = new Setting(host)
			.setName("API Key")
			.setDesc(
				hasSavedKey
					? (supportsSecretStorage
						? "已保存在当前 vault 的 Obsidian SecretStorage 中。输入新密钥可覆盖。"
						: "已保存。输入新密钥可覆盖。")
					: (supportsSecretStorage
						? "密钥将保存在当前 vault 的 Obsidian SecretStorage 中，不写入插件 data.json。"
						: "密钥将保存在插件设置中。")
			)
			.addText((text) => {
				apiKeyInput = text;
				text.setPlaceholder(
					hasSavedKey ? "已配置 (••••••••)；输入新密钥以替换" : "sk-..."
				);
				text.inputEl.type = "password";
				text.onChange((value) => {
					apiKeyDraft = value;
				});
			})
			.addButton((button) => {
				button
					.setButtonText("保存密钥")
					.setCta()
					.onClick(async () => {
						if (!apiKeyDraft.trim()) {
							new Notice("请输入 API Key");
							return;
						}
						const saved = await writeIntegratedAIApiKey(
							plugin.app,
							plugin.settings.aiAssistant,
							apiKeyDraft
						);
						if (!saved) {
							new Notice("保存 API Key 失败");
							return;
						}
						await save();
						apiKeyDraft = "";
						apiKeyInput?.setValue("");
						apiKeyInput?.setPlaceholder("已配置 (••••••••)；输入新密钥以替换");
						keySetting.setDesc(
							supportsSecretStorage
								? "已保存在当前 vault 的 Obsidian SecretStorage 中。输入新密钥可覆盖。"
								: "已保存。输入新密钥可覆盖。"
						);
						new Notice("API Key 已安全保存");
					});
			})
			.addExtraButton((button) => {
				button
					.setIcon("trash-2")
					.setTooltip("清除已保存的 API Key")
					.onClick(async () => {
						await clearIntegratedAIApiKey(plugin.app, plugin.settings.aiAssistant);
						await save();
						apiKeyDraft = "";
						apiKeyInput?.setValue("");
						apiKeyInput?.setPlaceholder("sk-...");
						keySetting.setDesc(
							supportsSecretStorage
								? "密钥将保存在当前 vault 的 Obsidian SecretStorage 中，不写入插件 data.json。"
								: "密钥将保存在插件设置中。"
						);
						new Notice("已清除 API Key");
					});
			});

		new Setting(host)
			.setName("API Endpoint (Base URL)")
			.setDesc("API 请求地址（支持 DeepSeek 官方或兼容 OpenAI 格式的端点）。")
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_INTEGRATED_AI_SETTINGS.endpoint)
					.setValue(settings.endpoint)
					.onChange(async (value) => {
						const next = value.trim() || DEFAULT_INTEGRATED_AI_SETTINGS.endpoint;
						settings.endpoint = next;
						plugin.settings.aiAssistant.endpoint = next;
						await save();
					});
			});

		new Setting(host)
			.setName("模型 (Model)")
			.setDesc("填写 API 接受的模型 ID（如 deepseek-v4-flash、deepseek-chat 等）。")
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_INTEGRATED_AI_SETTINGS.model)
					.setValue(settings.model)
					.onChange(async (value) => {
						const next = value.trim() || DEFAULT_INTEGRATED_AI_SETTINGS.model;
						settings.model = next;
						plugin.settings.aiAssistant.model = next;
						await save();
					});
			});

		new Setting(host)
			.setName("Thinking 深度思考")
			.setDesc("翻译与查词请求默认显式发送 thinking: { type: \"disabled\" }，以保证极速响应。")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("disabled", "彻底关闭 (推荐，极速响应)")
					.setValue("disabled")
					.setDisabled(true);
			});

		new Setting(host)
			.setName("最大输出 Token")
			.setDesc("允许范围：256–16384。")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "256";
				text.inputEl.max = "16384";
				text
					.setValue(String(settings.maxTokens))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						if (Number.isFinite(parsed)) {
							settings.maxTokens = parsed;
							plugin.settings.aiAssistant.maxTokens = parsed;
							await save();
						}
					});
			});

		new Setting(host)
			.setName("自定义助手提示词")
			.setDesc("“自定义助手”动作使用的系统提示词。")
			.addTextArea((text) => {
				text.inputEl.rows = 5;
				text.setValue(settings.customPrompt).onChange(async (value) => {
					const next = value.trim() || DEFAULT_INTEGRATED_AI_SETTINGS.customPrompt;
					settings.customPrompt = next;
					plugin.settings.aiAssistant.customPrompt = next;
					await save();
				});
			});

		return () => {
			if (typeof (host as any).empty === "function") {
				(host as any).empty();
			} else {
				host.replaceChildren();
			}
		};
	});
</script>

<section class="epub-settings-section epub-settings-section--compact">
	<div class="epub-settings-group epub-settings-group--panel">
		<div class="epub-settings-group-header">
			<h3 class="epub-settings-group-title with-accent-bar accent-cyan">AI 助手与翻译设置</h3>
			<p class="epub-settings-group-description">
				为 Zora Reader 阅读器配置 API Key、翻译模型与端点。
			</p>
		</div>
		<div bind:this={settingsHost} class="epub-native-settings-host"></div>
		<p class="setting-item-description">
			选中文本后点击词义/翻译会向配置的 API Endpoint 发送请求；插件不包含任何遥测或数据回传。
		</p>
	</div>
</section>
