import type { App } from "obsidian";
import type { IntegratedAISettings } from "../../../config/integrated-ai-settings";
import { readIntegratedAIApiKey } from "../../../config/integrated-ai-settings";
import { translateSelection, type SelectionCapture, type TranslationConfig, type TranslationResult } from "./translation";
import { extractSentences, isSingleWordSelection } from "./selection-context";
export interface ZoraSelectionTranslationInput { text: string; cfiRange: string; chapter: string; bookPath: string; bookTitle: string; context: string; range?: Range | null; }
export function buildZoraTranslationCapture(input: ZoraSelectionTranslationInput): SelectionCapture {
  const sentences = input.range ? extractSentences(input.range, input.text) : { previous: "", target: input.text, next: "", truncated: false, targetStart: 0, targetEnd: input.text.length };
  return { source: "weave", text: input.text, context: input.context, sentenceContext: sentences.target, sentence: sentences.target, contextBefore: sentences.previous, contextAfter: sentences.next, cfi: input.cfiRange, location: input.cfiRange, chapter: input.chapter, progress: 0, bookPath: input.bookPath, bookTitle: input.bookTitle, sourceLink: "", singleWord: isSingleWordSelection(input.text) };
}
export async function runZoraSelectionTranslation(input: { app: App; settings: IntegratedAISettings; selection: ZoraSelectionTranslationInput }): Promise<TranslationResult> {
  const apiKey = readIntegratedAIApiKey(input.app, input.settings);
  if (!input.settings.enabled) throw new Error("AI 翻译已在设置中关闭");
  if (!apiKey) throw new Error("请先在设置 → AI 助手中保存 API Key");
  const config: TranslationConfig = { apiKey, baseUrl: input.settings.endpoint, model: input.settings.model, sourceLanguage: "自动识别", targetLanguage: "简体中文", disableThinking: true };
  return translateSelection(config, buildZoraTranslationCapture(input.selection));
}
