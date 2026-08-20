import { requestUrl } from "obsidian";
import type { App } from "obsidian";
import type { IntegratedAISettings } from "../../../config/integrated-ai-settings";
import {
  DEFAULT_INTEGRATED_AI_SETTINGS,
  readIntegratedAIApiKey,
  supportsIntegratedAISecretStorage,
} from "../../../config/integrated-ai-settings";

export interface ZoraGrammarPoint {
  label: string;
  target?: string;
  explanation: string;
}

export interface ZoraGrammarAnalysisResult {
  sentence: string;
  structure: string;
  points: ZoraGrammarPoint[];
  difficulty?: string;
  paraphrase?: string;
  rawText?: string;
}

const GRAMMAR_SYSTEM_PROMPT =
  `你是一名资深的英语语法与句法分析专家。请对用户提供的英文句子进行结构化句法解析。\n` +
  `必须严格输出以下 JSON 格式（不要添加额外的 Markdown 标题或分割线）：\n` +
  `{\n` +
  `  "structure": "核心句子结构（如：主句 + 宾语从句 + 插入语）",\n` +
  `  "points": [\n` +
  `    {\n` +
  `      "label": "语法点名称（如：虚拟语气 / 插入语 / 倒装句 / 分词作状语）",\n` +
  `      "target": "对应原文短语或片段",\n` +
  `      "explanation": "简明解释该结构在句中的功能与含义"\n` +
  `    }\n` +
  `  ],\n` +
  `  "difficulty": "难点辨析或易错点提示（若无可留空）",\n` +
  `  "paraphrase": "整句自然理解与中文释义"\n` +
  `}`;

function normalizeChatCompletionsEndpoint(rawEndpoint: string): string {
  const base = String(rawEndpoint || "").trim() || DEFAULT_INTEGRATED_AI_SETTINGS.endpoint;
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error("API Endpoint 不是有效网址，请在 AI 设置中检查");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("为保护 API Key，API Endpoint 必须使用 HTTPS");
  }
  const cleanUrl = base.replace(/\/+$/, "");
  if (!cleanUrl.endsWith("/chat/completions")) {
    return `${cleanUrl}/chat/completions`;
  }
  return cleanUrl;
}

export function parseGrammarResponse(
  rawContent: string,
  sentence: string
): ZoraGrammarAnalysisResult {
  const trimmed = rawContent.trim();

  // Try extracting JSON from code fence or raw string
  let jsonStr = trimmed;
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonMatch && jsonMatch[1]) {
    jsonStr = jsonMatch[1].trim();
  } else {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = trimmed.slice(firstBrace, lastBrace + 1);
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed === "object" && parsed !== null) {
      const structure = String(parsed.structure || "").trim();
      const rawPoints = Array.isArray(parsed.points) ? parsed.points : [];
      const points: ZoraGrammarPoint[] = rawPoints.map((p: any) => ({
        label: String(p.label || "语法点").trim(),
        target: p.target ? String(p.target).trim() : undefined,
        explanation: String(p.explanation || "").trim(),
      })).filter((p) => p.explanation || p.label);

      return {
        sentence,
        structure: structure || "句子主干结构分析",
        points,
        difficulty: parsed.difficulty ? String(parsed.difficulty).trim() : undefined,
        paraphrase: parsed.paraphrase ? String(parsed.paraphrase).trim() : undefined,
        rawText: trimmed,
      };
    }
  } catch {
    // Fallback: parse raw text stripping markdown headers and fences
  }

  return parseGrammarTextFallback(trimmed, sentence);
}

function parseGrammarTextFallback(
  text: string,
  sentence: string
): ZoraGrammarAnalysisResult {
  // Strip Markdown headings (###, ##), horizontal rules, and bold wrappers
  const cleaned = text
    .replace(/^#+\s+/gm, "")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .replace(/^>\s*/gm, "")
    .trim();

  const lines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);
  const points: ZoraGrammarPoint[] = [];
  let currentPoint: ZoraGrammarPoint | null = null;
  let structure = "";
  let paraphrase = "";
  let difficulty = "";

  for (const line of lines) {
    const structMatch = line.match(/(?:核心|句子)?(?:结构|主干|骨架)\s*[:：]\s*(.+)$/i);
    const paraMatch = line.match(/(?:整句|自然|语境)?(?:理解|译文|意思|释义)\s*[:：]\s*(.+)$/i);
    const diffMatch = line.match(/(?:难点|辨析|注意|提示)\s*[:：]\s*(.+)$/i);

    if (structMatch && !structure) {
      structure = structMatch[1].trim();
    } else if (paraMatch && !paraphrase) {
      paraphrase = paraMatch[1].trim();
    } else if (diffMatch && !difficulty) {
      difficulty = diffMatch[1].trim();
    } else if (/^[-*•\d+.]+\s*/.test(line)) {
      const content = line.replace(/^[-*•\d+.]+\s*/, "").trim();
      const colonMatch = content.match(/^([^:：]+)[:：]\s*(.*)$/);
      if (colonMatch) {
        points.push({
          label: colonMatch[1].replace(/[*_`]/g, "").trim(),
          explanation: colonMatch[2].replace(/[*_`]/g, "").trim(),
        });
      } else {
        points.push({
          label: "关键语法",
          explanation: content.replace(/[*_`]/g, "").trim(),
        });
      }
    } else if (points.length > 0) {
      const last = points[points.length - 1];
      last.explanation = `${last.explanation} ${line.replace(/[*_`]/g, "").trim()}`;
    }
  }

  return {
    sentence,
    structure: structure || "句子核心结构",
    points: points.slice(0, 4),
    difficulty: difficulty || undefined,
    paraphrase: paraphrase || undefined,
    rawText: text,
  };
}

export async function runZoraGrammarAnalysis(options: {
  app: App;
  settings: IntegratedAISettings;
  text: string;
  context?: string;
}): Promise<ZoraGrammarAnalysisResult> {
  const selectedText = String(options.text || "").trim();
  if (!selectedText) {
    throw new Error("请先在阅读器中选择文字");
  }
  if (!options.settings.enabled) {
    throw new Error("AI 助手已在设置中关闭");
  }
  if (!supportsIntegratedAISecretStorage(options.app)) {
    throw new Error("当前 Obsidian 版本不支持安全密钥存储");
  }
  const apiKey = readIntegratedAIApiKey(options.app, options.settings);
  if (!apiKey) {
    throw new Error("请先在阅读器设置 → AI 助手中保存 DeepSeek API 密钥");
  }

  const endpoint = normalizeChatCompletionsEndpoint(options.settings.endpoint);
  const prompt = GRAMMAR_SYSTEM_PROMPT;
  const userContent =
    options.context && options.context.trim() && options.context !== selectedText
      ? `选中文本：\n${selectedText}\n\n上下文：\n${options.context}`
      : `请分析以下英语句子：\n\n${selectedText}`;

  const response = await requestUrl({
    url: endpoint,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.settings.model || DEFAULT_INTEGRATED_AI_SETTINGS.model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userContent },
      ],
      thinking: { type: "disabled" },
      max_tokens: options.settings.maxTokens || DEFAULT_INTEGRATED_AI_SETTINGS.maxTokens,
    }),
    throw: false,
  });

  const body = response.json as
    | {
        choices?: Array<{ message?: { content?: unknown } }>;
        error?: { message?: string };
      }
    | undefined;

  if (response.status < 200 || response.status >= 300) {
    const apiMessage = typeof body?.error?.message === "string" ? body.error.message : "";
    throw new Error(apiMessage || response.text || `HTTP ${response.status}`);
  }
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("DeepSeek 返回的数据中没有可显示的内容");
  }

  return parseGrammarResponse(content, selectedText);
}
