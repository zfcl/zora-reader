import { Menu, Modal, Notice, requestUrl } from "obsidian";
import type { App } from "obsidian";
import type { IntegratedAISettings } from "../../config/integrated-ai-settings";
import {
	DEFAULT_INTEGRATED_AI_SETTINGS,
	readIntegratedAIApiKey,
	supportsIntegratedAISecretStorage,
} from "../../config/integrated-ai-settings";
import { domInstanceOf } from "../../utils/dom-instance-of";

export interface IntegratedAIAction {
	id: string;
	name: string;
	icon: string;
	prompt?: string;
	getPrompt?: (settings: IntegratedAISettings) => string;
}

export const INTEGRATED_AI_ACTIONS: readonly IntegratedAIAction[] = [
	{
		id: "english-grammar",
		name: "英语语法解析",
		icon: "braces",
		prompt:
			"你是一名资深的语法学家。请对该句子进行详尽的句法分析：\n1. 【句子结构】：拆解主谓宾、从句、修饰语等成分。\n2. 【核心语法】：指出句中运用的关键语法规则（如时态、语态、倒装、虚拟语气等）。\n3. 【知识点拓展】：对涉及的语法点进行简要的教学拓展。\n请用清晰的层级结构返回纯文本，不要使用 Markdown 格式。",
	},
	{
		id: "context-appreciation",
		name: "语境赏析",
		icon: "sparkles",
		prompt:
			"你是一名博闻强识的阅读向导与文学评论家。请对选中的书籍文字执行以下分析：\n1. 【语境解析】：结合书籍的上下文，深度解读这段文字在情节、逻辑或论点中的承载与承接作用。\n2. 【文学赏析】：剖析其中蕴含的修辞手法、文学隐喻、人物心理、时代背景或叙事艺术。\n3. 【思考延伸】：提出一个与此相关的启发性思考或关联知识点。\n请返回纯文本，不要使用 Markdown 格式。",
	},
	{
		id: "custom-assistant",
		name: "自定义助手",
		icon: "message-circle",
		getPrompt: (settings) =>
			settings.customPrompt || DEFAULT_INTEGRATED_AI_SETTINGS.customPrompt,
	},
];

interface DeepSeekResponse {
	choices?: Array<{
		message?: {
			content?: unknown;
		};
	}>;
	error?: {
		message?: unknown;
	};
}

class IntegratedAIResultModal extends Modal {
	private statusEl: HTMLElement | null = null;
	private resultEl: HTMLElement | null = null;
	private copyButton: HTMLButtonElement | null = null;
	private result = "";

	constructor(
		app: App,
		private readonly actionName: string,
		private readonly selectedText: string,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(`AI 助手 · ${this.actionName}`);
		this.contentEl.addClass("weave-epub-ai-result-modal");
		this.contentEl.createDiv({
			cls: "weave-epub-ai-selection-preview",
			text: this.selectedText,
		});
		this.statusEl = this.contentEl.createDiv({
			cls: "weave-epub-ai-status",
			text: "正在请求 DeepSeek…",
		});
		this.resultEl = this.contentEl.createDiv({ cls: "weave-epub-ai-result" });

		const buttons = this.contentEl.createDiv({
			cls: "weave-epub-ai-modal-buttons",
		});
		this.copyButton = buttons.createEl("button", { text: "复制结果" });
		this.copyButton.disabled = true;
		this.copyButton.addEventListener("click", () => {
			void this.copyResult();
		});
		const closeButton = buttons.createEl("button", {
			text: "关闭",
			cls: "mod-cta",
		});
		closeButton.addEventListener("click", () => {
			this.close();
		});
	}

	private async copyResult(): Promise<void> {
		if (!this.result) {
			return;
		}
		await navigator.clipboard.writeText(this.result);
		new Notice("AI 结果已复制");
	}

	setResult(text: string): void {
		this.result = text;
		this.statusEl?.setText("");
		this.resultEl?.removeClass("weave-epub-ai-error");
		this.resultEl?.setText(text);
		if (this.copyButton) {
			this.copyButton.disabled = false;
		}
	}

	setError(message: string): void {
		this.statusEl?.setText("请求失败");
		this.resultEl?.addClass("weave-epub-ai-error");
		this.resultEl?.setText(message);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function showIntegratedAIActionMenu(options: {
	event: MouseEvent | KeyboardEvent;
	onSelectAction: (actionId: string) => void;
	openSettings?: () => void;
}): void {
	const menu = new Menu();
	for (const action of INTEGRATED_AI_ACTIONS) {
		menu.addItem((item) => {
			item.setTitle(action.name);
			item.setIcon(action.icon);
			item.onClick(() => {
				options.onSelectAction(action.id);
			});
		});
	}

	if (domInstanceOf(options.event, MouseEvent)) {
		menu.showAtMouseEvent(options.event);
		return;
	}
	const target = options.event.target;
	if (domInstanceOf(target, HTMLElement)) {
		const rect = target.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
		return;
	}
	menu.showAtPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
}

function resolveAction(actionId: string): IntegratedAIAction | null {
	return INTEGRATED_AI_ACTIONS.find((action) => action.id === actionId) ?? null;
}

function assertSecureEndpoint(endpoint: string): string {
	let parsed: URL;
	try {
		parsed = new URL(endpoint);
	} catch {
		throw new Error("API Endpoint 不是有效网址，请在 AI 设置中检查");
	}
	if (parsed.protocol !== "https:") {
		throw new Error("为保护 API Key，API Endpoint 必须使用 HTTPS");
	}
	return parsed.toString();
}

export async function runIntegratedAIAction(options: {
	app: App;
	settings: IntegratedAISettings;
	actionId: string;
	selectedText: string;
	openSettings: () => void;
}): Promise<void> {
	const action = resolveAction(options.actionId);
	if (!action) {
		new Notice("未知的 AI 助手动作");
		return;
	}
	const selectedText = String(options.selectedText || "").trim();
	if (!selectedText) {
		new Notice("请先在阅读器中选择文字");
		return;
	}
	if (!options.settings.enabled) {
		new Notice("AI 助手已在设置中关闭");
		options.openSettings();
		return;
	}
	if (!supportsIntegratedAISecretStorage(options.app)) {
		new Notice("当前 Obsidian 版本不支持安全密钥存储，请先更新 Obsidian");
		return;
	}
	const apiKey = readIntegratedAIApiKey(options.app, options.settings);
	if (!apiKey) {
		new Notice("请先在阅读器设置 → AI 助手中保存 DeepSeek API 密钥");
		options.openSettings();
		return;
	}

	const modal = new IntegratedAIResultModal(
		options.app,
		action.name,
		selectedText,
	);
	modal.open();

	try {
		const prompt = action.getPrompt?.(options.settings) ?? action.prompt ?? "";
		const response = await requestUrl({
			url: assertSecureEndpoint(options.settings.endpoint),
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: options.settings.model || DEFAULT_INTEGRATED_AI_SETTINGS.model,
				messages: [
					{ role: "system", content: prompt },
					{ role: "user", content: `请处理以下选中文本：\n\n${selectedText}` },
				],
				thinking: { type: "disabled" },
				max_tokens: options.settings.maxTokens,
			}),
			throw: false,
		});
		const body = response.json as DeepSeekResponse | undefined;
		if (response.status < 200 || response.status >= 300) {
			const apiMessage =
				typeof body?.error?.message === "string" ? body.error.message : "";
			throw new Error(apiMessage || response.text || `HTTP ${response.status}`);
		}
		const content = body?.choices?.[0]?.message?.content;
		if (typeof content !== "string" || !content.trim()) {
			throw new Error("DeepSeek 返回的数据中没有可显示的内容");
		}
		modal.setResult(content.trim());
	} catch (error) {
		modal.setError(error instanceof Error ? error.message : String(error));
	}
}
