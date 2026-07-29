<script lang="ts">
	import { Notice, Setting } from "obsidian";
	import type { TextComponent } from "obsidian";
	import { onMount } from "svelte";
	import {
		clearIntegratedAIApiKey,
		DEFAULT_INTEGRATED_AI_SETTINGS,
		normalizeIntegratedAISettings,
		readIntegratedAIApiKey,
		supportsIntegratedAISecretStorage,
		writeIntegratedAIApiKey,
	} from "../../config/integrated-ai-settings";
	import type StandaloneEpubPlugin from "../../main";

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

	onMount(() => {
		if (!settingsHost) {
			return;
		}
		const host = settingsHost;
		const settings = plugin.settings.aiAssistant;
		const supportsSecretStorage = supportsIntegratedAISecretStorage(plugin.app);
		let apiKeyDraft = "";
		let apiKeyInput: TextComponent | null = null;

		new Setting(host)
			.setName("启用 AI 助手")
			.setDesc("在阅读器原生选区工具条中显示并启用 AI 动作。")
			.addToggle((toggle) => {
				toggle.setValue(settings.enabled).onChange(async (value) => {
					settings.enabled = value;
					await save();
				});
			});

		const keySetting = new Setting(host)
			.setName("DeepSeek API Key")
			.setDesc(
				supportsSecretStorage
					? readIntegratedAIApiKey(plugin.app, settings)
						? "已保存在当前 vault 的 Obsidian SecretStorage 中。输入新密钥可覆盖。"
						: "密钥将保存在当前 vault 的 Obsidian SecretStorage 中，不写入插件 data.json。"
					: "当前 Obsidian 版本不支持 SecretStorage，请更新 Obsidian 后再配置。"
			)
			.addText((text) => {
				apiKeyInput = text;
				text.setPlaceholder(
					readIntegratedAIApiKey(plugin.app, settings) ? "已配置；输入新密钥以替换" : "sk-..."
				);
				text.inputEl.type = "password";
				text.inputEl.disabled = !supportsSecretStorage;
				text.onChange((value) => {
					apiKeyDraft = value;
				});
			})
			.addButton((button) => {
				button
					.setButtonText("保存密钥")
					.setCta()
					.setDisabled(!supportsSecretStorage)
					.onClick(async () => {
						if (!apiKeyDraft.trim()) {
							new Notice("请输入 DeepSeek API Key");
							return;
						}
						const saved = await writeIntegratedAIApiKey(
							plugin.app,
							settings,
							apiKeyDraft
						);
						if (!saved) {
							new Notice("无法访问 Obsidian SecretStorage");
							return;
						}
						apiKeyDraft = "";
						apiKeyInput?.setValue("");
						keySetting.setDesc(
							"已保存在当前 vault 的 Obsidian SecretStorage 中。输入新密钥可覆盖。"
						);
						new Notice("DeepSeek API Key 已安全保存");
					});
			})
			.addExtraButton((button) => {
				button
					.setIcon("trash-2")
					.setTooltip("清除已保存的 API Key")
					.setDisabled(!supportsSecretStorage)
					.onClick(async () => {
						await clearIntegratedAIApiKey(plugin.app, settings);
						keySetting.setDesc(
							"密钥将保存在当前 vault 的 Obsidian SecretStorage 中，不写入插件 data.json。"
						);
						new Notice("已清除 DeepSeek API Key");
					});
			});

		new Setting(host)
			.setName("模型")
			.setDesc("填写 DeepSeek API 接受的模型 ID。")
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_INTEGRATED_AI_SETTINGS.model)
					.setValue(settings.model)
					.onChange(async (value) => {
						settings.model =
							value.trim() || DEFAULT_INTEGRATED_AI_SETTINGS.model;
						await save();
					});
			});

		new Setting(host)
			.setName("API Endpoint")
			.setDesc("为保护 API Key，只接受 HTTPS 地址。")
			.addText((text) => {
				text
					.setValue(settings.endpoint)
					.onChange(async (value) => {
						settings.endpoint =
							value.trim() || DEFAULT_INTEGRATED_AI_SETTINGS.endpoint;
						await save();
					});
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
						settings.maxTokens = Number.parseInt(value, 10);
						await save();
					});
			});

		new Setting(host)
			.setName("自定义助手提示词")
			.setDesc("“自定义助手”动作使用的系统提示词。")
			.addTextArea((text) => {
				text.inputEl.rows = 7;
				text.inputEl.addClass("weave-epub-ai-custom-prompt");
				text.setValue(settings.customPrompt).onChange(async (value) => {
					settings.customPrompt =
						value.trim() || DEFAULT_INTEGRATED_AI_SETTINGS.customPrompt;
					await save();
				});
			});

		host.createEl("p", {
			cls: "setting-item-description",
			text: '每次请求都会显式发送 thinking: { type: "disabled" }。选中的文本会发送到你配置的 DeepSeek API Endpoint；插件不包含遥测。',
		});

		return () => {
			host.empty();
		};
	});
</script>

<section class="epub-settings-section epub-settings-section--compact">
	<div class="epub-settings-group epub-settings-group--panel">
		<div class="epub-settings-group-header">
			<h3 class="epub-settings-group-title with-accent-bar accent-cyan">AI 助手</h3>
			<p class="epub-settings-group-description">
				为阅读器选区工具条配置内置 DeepSeek 阅读助手。
			</p>
		</div>
		<div bind:this={settingsHost} class="epub-native-settings-host"></div>
	</div>
</section>
