import { requestUrl } from "obsidian";
import type { App } from "obsidian";
import type { IntegratedAISettings } from "../../../config/integrated-ai-settings";
import {
  DEFAULT_INTEGRATED_AI_SETTINGS,
  readIntegratedAIApiKey,
  supportsIntegratedAISecretStorage,
} from "../../../config/integrated-ai-settings";

export type ZoraComprehensionComplexity = "simple" | "complex";

export interface ZoraSenseGroup {
  chunk: string;
  translation: string;
}

export interface ZoraKeyPattern {
  pattern: string;
  meaning: string;
}

export interface ZoraSpecialNote {
  target?: string;
  explanation: string;
}

export interface ZoraTransferExample {
  pattern?: string;
  sentence: string;
  translation: string;
}

export interface ZoraComprehensionResult {
  sentence: string;
  translation: string;
  complexity: ZoraComprehensionComplexity;
  howToRead?: ZoraSenseGroup[];
  keyPatterns: ZoraKeyPattern[];
  specialNotes?: ZoraSpecialNote[];
  transferExample?: ZoraTransferExample;
  rawText?: string;
}

const COMPREHENSION_SYSTEM_PROMPT =
  `你是一名英语原著阅读理解与自然语感专家。请对用户提供的英文句子进行简易、面向原著阅读的理解解析，目标是构建“理解意义 → 意群切块 → 可复用表达 → 必要形式说明 → 轻量迁移”的原著阅读学习模式。\n\n` +
  `【核心原则：严禁传统应试语法分析】\n` +
  `严禁使用学校应试式语法术语（如：主谓宾、主系表、宾语从句、定语从句、状语从句、主从复合句、现在分词作状语等语法树/成分分析术语）。\n` +
  `目标是帮助读者顺着英文语序自然理解，吸收地道表达。\n\n` +
  `【各解析模块规范】\n` +
  `1. 自然中文译文（translation）：整句自然、流畅、符合语境的中文译文（置于顶部）。\n\n` +
  `2. 怎么读（howToRead - 按自然意义单位切块）：\n` +
  `   - 按意义和阅读停顿切块，顺着语序理解，不逐词翻译，不显示主谓宾/从句名称；\n` +
  `   - 极简单句：howToRead 设为空数组 []，不要将极短简单句强行拆碎；\n` +
  `   - 短句/普通句切 1~3 块，长难句最多切 4~7 块；\n` +
  `   - 示例：\n` +
  `     I didn't know → 我不知道\n` +
  `     what he was gonna do → 他打算做什么\n\n` +
  `3. 值得记住（keyPatterns - 提炼 1~4 个高价值、真正可迁移复用的 pattern / 句式骨架）：\n` +
  `   - 提炼 1~4 个真正地道、脱离原句具体单词后读者可在其他语境直接套用的通用表达搭配或句式骨架（必须使用可替换占位符如 sb / sth / adjective / clause / doing / to do 等彻底抽象化）；\n` +
  `   - 【禁止固定原句具体成分】：严禁 pattern 固定当前句子的 that / me / he / him / she 等具体成分（例如原句中出现 that gets me crazy 或 it got him angry 等，禁止写成 that gets me + adjective，必须彻底抽象为 get + sb + adjective）；\n` +
  `   - 严禁输出过度贴合原句具体单词/时态的碎片（如严禁输出 not know what sb is gonna do 这种贴句碎片，必须抽象为通用 pattern 如 don't know what + clause）；\n` +
  `   - 正确 pattern 范例（pattern 必须脱离当前原句仍然可以复用）：\n` +
  `     · get + sb + adjective → 使某人变得…… / 使某人感到……\n` +
  `     · don't know what + clause → 不知道……\n` +
  `     · keep telling sb to do sth → 一直叫某人做某事\n` +
  `   - meaning 必须简明扼要，不要为了凑数硬塞无价值碎片。\n\n` +
  `4. 这里为什么这样说（specialNotes - 仅在真正影响理解时输出）：\n` +
  `   - 只有遇到真正影响理解或具有特殊语言特色的现象时才输出：\n` +
  `     ① 文学作品中的人物非标准拼写/书写形式（如《献给阿尔吉侬的花束》Flowers for Algernon 中的 werk / rite / yeres / munth 等）：\n` +
  `       - 严禁修改原文非标准拼写，必须保留原文；\n` +
  `       - 【禁止无依据推断人物属性】：严禁无原著依据自动推断人物属性，不要自动写“教育程度较低”、“智力水平”、“口音来源”、“社会阶层”等；\n` +
  `       - 统一规范表述为：“原文采用非标准拼写/书写形式，标准形式通常为……；这是人物当前书写与语言特征的一部分，阅读时保留原文。”；\n` +
  `       - 只有原著上下文明确信息时，才能进一步说明原因；\n` +
  `     ② 口语表达、口语缩写（如 gonna → going to）；\n` +
  `     ③ 省略、特殊语境、容易误解的形式；\n` +
  `   - 没有必要时整个模块必须为空数组 []（前端将自动隐藏）。\n\n` +
  `5. 顺手记一下（transferExample - 迁移例句）：\n` +
  `   - 从“值得记住”中选择最有价值的 1 个 pattern，生成 1 个全新的、简短自然的英文例句；\n` +
  `   - 提供对应的自然中文理解译文；\n` +
  `   - 极简单句可不生成（设为 null）；普通句和长难句生成 1 个例句；不要考试、不要评分、不要选择题。\n` +
  `   - 示例：\n` +
  `     sentence: "She kept asking me the same question.", translation: "她一直问我同一个问题。", pattern: "keep telling/asking sb to do..."\n\n` +
  `【复杂度自适应规则（complexity）】\n` +
  `- "simple"（极简单句）：原文+译文 + 值得记住（1~2 个），howToRead 为 []，specialNotes 为 []，transferExample 为 null；\n` +
  `- "complex"（普通句/长难句）：提供 怎么读（howToRead）+ 值得记住（keyPatterns）+ 必要时“为什么这样说”（specialNotes）+ 顺手记一下（transferExample）。\n\n` +
  `必须严格输出以下 JSON 格式（不要包含任何额外 Markdown 标题或代码块之外的废话）：\n` +
  `{\n` +
  `  "complexity": "simple | complex",\n` +
  `  "translation": "自然流畅的中文译文",\n` +
  `  "howToRead": [\n` +
  `    {\n` +
  `      "chunk": "英文意群（如：I didn't know）",\n` +
  `      "translation": "中文对应理解（如：我不知道）"\n` +
  `    }\n` +
  `  ],\n` +
  `  "keyPatterns": [\n` +
  `    {\n` +
  `      "pattern": "核心搭配/句式（如：get + sb + adjective）",\n` +
  `      "meaning": "含义（如：使某人变得…… / 使某人感到……）"\n` +
  `    }\n` +
  `  ],\n` +
  `  "specialNotes": [\n` +
  `    {\n` +
  `      "target": "特殊表达或原词（如：yeres / munth 或 gonna）",\n` +
  `      "explanation": "标准形式与说明（如：原文采用非标准拼写/书写形式，标准形式通常为 years / month；这是人物当前书写与语言特征的一部分，阅读时保留原文。）"\n` +
  `    }\n` +
  `  ],\n` +
  `  "transferExample": {\n` +
  `    "pattern": "对应 pattern",\n` +
  `    "sentence": "全新短自然英文例句（如：She kept asking me the same question.）",\n` +
  `    "translation": "例句中文理解（如：她一直问我同一个问题。）"\n` +
  `  }\n` +
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

export const COMPREHENSION_DEFAULT_MAX_TOKENS = 8192;

export interface ComprehensionResponseDiagnostic {
  hasContent: boolean;
  hasReasoningContent: boolean;
  contentLength: number;
  reasoningContentLength: number;
  finishReason: string | null;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
  };
  jsonParseError?: string;
}

export function extractComprehensionResponseDiagnostic(
  body: unknown,
  jsonParseError?: unknown
): ComprehensionResponseDiagnostic {
  const parsedBody = body && typeof body === "object" ? (body as Record<string, any>) : {};
  const choice = Array.isArray(parsedBody.choices) && parsedBody.choices[0] ? parsedBody.choices[0] : {};
  const message = choice.message && typeof choice.message === "object" ? choice.message : {};
  const usage = parsedBody.usage && typeof parsedBody.usage === "object" ? parsedBody.usage : undefined;

  const content = typeof message.content === "string" ? message.content : "";
  const reasoning = typeof message.reasoning_content === "string" ? message.reasoning_content : "";
  const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : null;

  return {
    hasContent: Boolean(content.trim()),
    hasReasoningContent: Boolean(reasoning.trim()),
    contentLength: content.length,
    reasoningContentLength: reasoning.length,
    finishReason,
    usage: usage
      ? {
          promptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
          completionTokens:
            typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined,
          totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
          reasoningTokens:
            typeof usage.completion_tokens_details?.reasoning_tokens === "number"
              ? usage.completion_tokens_details.reasoning_tokens
              : undefined,
        }
      : undefined,
    jsonParseError:
      jsonParseError instanceof Error
        ? jsonParseError.message
        : typeof jsonParseError === "string"
          ? jsonParseError
          : undefined,
  };
}

export function logComprehensionResponseShape(diagnostic: ComprehensionResponseDiagnostic): void {
  console.warn("[ZoraComprehension] Request failed or abnormal response shape:", JSON.stringify(diagnostic));
}

export function parseComprehensionResponse(
  rawContent: string,
  sentence: string,
  options?: { isTruncated?: boolean }
): ZoraComprehensionResult {
  const cleanedContent = rawContent
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .replace(/<(?:think|thought|reasoning)>[\s\S]*$/gi, "");
  const trimmed = cleanedContent.trim();

  if (!trimmed) {
    if (options?.isTruncated) {
      throw new Error("输出被截断（超出最大 Token 限制）");
    }
    throw new Error("DeepSeek 返回的数据中没有可显示的内容");
  }

  let jsonStr = trimmed;
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  if (fenceMatch && fenceMatch[1] && fenceMatch[1].trim().startsWith("{")) {
    jsonStr = fenceMatch[1].trim();
  } else {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = trimmed.slice(firstBrace, lastBrace + 1);
    } else if (firstBrace >= 0) {
      jsonStr = trimmed.slice(firstBrace);
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed === "object" && parsed !== null) {
      const translation = String(parsed.translation || "").trim();
      const rawComplexity = String(parsed.complexity || "").toLowerCase().trim();
      const complexity: ZoraComprehensionComplexity =
        rawComplexity === "complex" || rawComplexity === "长句" || rawComplexity === "长难句"
          ? "complex"
          : "simple";

      const rawHowToRead = Array.isArray(parsed.howToRead) ? parsed.howToRead : [];
      const howToRead: ZoraSenseGroup[] = rawHowToRead
        .map((item: any) => ({
          chunk: String(item.chunk || "").trim(),
          translation: String(item.translation || "").trim(),
        }))
        .filter((item) => item.chunk && item.translation);

      const rawKeyPatterns = Array.isArray(parsed.keyPatterns) ? parsed.keyPatterns : [];
      const keyPatterns: ZoraKeyPattern[] = rawKeyPatterns
        .map((item: any) => ({
          pattern: String(item.pattern || item.chunk || item.label || "").trim(),
          meaning: String(item.meaning || item.explanation || item.translation || "").trim(),
        }))
        .filter((item) => item.pattern && item.meaning);

      const rawSpecialNotes = Array.isArray(parsed.specialNotes) ? parsed.specialNotes : [];
      const specialNotes: ZoraSpecialNote[] = rawSpecialNotes
        .map((item: any) => ({
          target: item.target ? String(item.target).trim() : undefined,
          explanation: String(item.explanation || item.desc || item.meaning || "").trim(),
        }))
        .filter((item) => item.explanation);

      const rawTransfer = parsed.transferExample;
      let transferExample: ZoraTransferExample | undefined;
      if (rawTransfer && typeof rawTransfer === "object") {
        const tSentence = String(rawTransfer.sentence || rawTransfer.example || "").trim();
        const tTranslation = String(
          rawTransfer.translation || rawTransfer.meaning || rawTransfer.zh || ""
        ).trim();
        if (tSentence && tTranslation) {
          transferExample = {
            sentence: tSentence,
            translation: tTranslation,
            pattern: rawTransfer.pattern ? String(rawTransfer.pattern).trim() : undefined,
          };
        }
      }

      return {
        sentence,
        translation: translation || sentence,
        complexity,
        howToRead: howToRead.length > 0 ? howToRead : undefined,
        keyPatterns: keyPatterns.slice(0, 4),
        specialNotes: specialNotes.length > 0 ? specialNotes : undefined,
        transferExample,
        rawText: trimmed,
      };
    }
  } catch {
    // Fall back to text parsing below
  }

  if (options?.isTruncated) {
    throw new Error("输出被截断（超出最大 Token 限制），未能生成完整的理解解析");
  }

  return parseComprehensionTextFallback(trimmed, sentence);
}

function parseComprehensionTextFallback(
  text: string,
  sentence: string
): ZoraComprehensionResult {
  const cleaned = text
    .replace(/^#+\s+/gm, "")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .replace(/^>\s*/gm, "")
    .trim();

  const lines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);
  let translation = "";
  const howToRead: ZoraSenseGroup[] = [];
  const keyPatterns: ZoraKeyPattern[] = [];
  const specialNotes: ZoraSpecialNote[] = [];
  let transferExample: ZoraTransferExample | undefined;

  let currentSection:
    | "translation"
    | "howToRead"
    | "keyPatterns"
    | "specialNotes"
    | "transferExample"
    | null = null;

  for (const line of lines) {
    if (/(?:译文|中文|翻译)\s*[:：]/i.test(line)) {
      const match = line.match(/(?:译文|中文|翻译)\s*[:：]\s*(.+)$/i);
      if (match) {
        translation = match[1].trim();
      }
      currentSection = "translation";
      continue;
    }
    if (/(?:怎么读|意群|拆读|顺读)/i.test(line)) {
      currentSection = "howToRead";
      continue;
    }
    if (/(?:值得记住|核心表达|核心搭配|重点表达|句式|词组)/i.test(line)) {
      currentSection = "keyPatterns";
      continue;
    }
    if (/(?:这里为什么这样说|为什么这样说|特殊表达|语言特色|非标准)/i.test(line)) {
      currentSection = "specialNotes";
      continue;
    }
    if (/(?:顺手记一下|迁移例句|新例句|例句迁移|迁移应用)/i.test(line)) {
      currentSection = "transferExample";
      continue;
    }

    if (currentSection === "howToRead") {
      const arrowMatch = line.replace(/^[-*•\d+.]+\s*/, "").split(/\s*(?:→|->)\s*/);
      if (arrowMatch.length >= 2) {
        howToRead.push({
          chunk: arrowMatch[0].trim(),
          translation: arrowMatch.slice(1).join(" → ").trim(),
        });
      }
    } else if (currentSection === "keyPatterns") {
      const cleanedLine = line.replace(/^[-*•\d+.]+\s*/, "").trim();
      const match = cleanedLine.match(/^([^:：→\->]+)(?:[:：]|(?:→|->))\s*(.*)$/);
      if (match) {
        keyPatterns.push({
          pattern: match[1].replace(/[*_`]/g, "").trim(),
          meaning: match[2].replace(/[*_`]/g, "").trim(),
        });
      }
    } else if (currentSection === "specialNotes") {
      const cleanedLine = line.replace(/^[-*•\d+.]+\s*/, "").trim();
      const match = cleanedLine.match(/^([^:：→\->]+)(?:[:：]|(?:→|->))\s*(.*)$/);
      if (match) {
        specialNotes.push({
          target: match[1].replace(/[*_`]/g, "").trim(),
          explanation: match[2].replace(/[*_`]/g, "").trim(),
        });
      } else {
        specialNotes.push({
          explanation: cleanedLine.replace(/[*_`]/g, "").trim(),
        });
      }
    } else if (currentSection === "transferExample") {
      const cleanedLine = line.replace(/^[-*•\d+.]+\s*/, "").trim();
      const arrowMatch = cleanedLine.split(/\s*(?:→|->)\s*/);
      if (arrowMatch.length >= 2) {
        transferExample = {
          sentence: arrowMatch[0].replace(/[*_`]/g, "").trim(),
          translation: arrowMatch.slice(1).join(" → ").replace(/[*_`]/g, "").trim(),
        };
      } else {
        const colonMatch = cleanedLine.match(/^([^:：]+)[:：]\s*(.*)$/);
        if (colonMatch && /[a-zA-Z]{3,}/.test(colonMatch[1]) && /[\u4e00-\u9fa5]/.test(colonMatch[2])) {
          transferExample = {
            sentence: colonMatch[1].replace(/[*_`]/g, "").trim(),
            translation: colonMatch[2].replace(/[*_`]/g, "").trim(),
          };
        } else if (!transferExample && /[a-zA-Z]{3,}/.test(cleanedLine)) {
          transferExample = {
            sentence: cleanedLine.replace(/[*_`]/g, "").trim(),
            translation: "",
          };
        } else if (transferExample && !transferExample.translation && /[\u4e00-\u9fa5]/.test(cleanedLine)) {
          transferExample.translation = cleanedLine.replace(/[*_`]/g, "").trim();
        }
      }
    }
  }

  const words = sentence.trim().split(/\s+/).filter(Boolean);
  const complexity: ZoraComprehensionComplexity =
    words.length >= 18 || howToRead.length >= 3 ? "complex" : "simple";

  return {
    sentence,
    translation: translation || sentence,
    complexity,
    howToRead: howToRead.length > 0 ? howToRead : undefined,
    keyPatterns: keyPatterns.slice(0, 4),
    specialNotes: specialNotes.length > 0 ? specialNotes : undefined,
    transferExample:
      transferExample && transferExample.sentence && transferExample.translation
        ? transferExample
        : undefined,
    rawText: text,
  };
}

export function buildComprehensionRequestBody(
  settings: IntegratedAISettings,
  prompt: string,
  userContent: string
): {
  model: string;
  messages: Array<{ role: string; content: string }>;
  thinking: { type: string };
  reasoning_effort: string;
  max_tokens: number;
} {
  const configuredMaxTokens = settings.maxTokens || DEFAULT_INTEGRATED_AI_SETTINGS.maxTokens;
  const comprehensionMaxTokens = Math.max(configuredMaxTokens, COMPREHENSION_DEFAULT_MAX_TOKENS);

  return {
    model: settings.model || DEFAULT_INTEGRATED_AI_SETTINGS.model,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: userContent },
    ],
    thinking: { type: "enabled" },
    reasoning_effort: "medium",
    max_tokens: comprehensionMaxTokens,
  };
}

export async function runZoraComprehensionAnalysis(options: {
  app: App;
  settings: IntegratedAISettings;
  text: string;
  context?: string;
}): Promise<ZoraComprehensionResult> {
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
  const prompt = COMPREHENSION_SYSTEM_PROMPT;
  const userContent =
    options.context && options.context.trim() && options.context !== selectedText
      ? `选中文本：\n${selectedText}\n\n上下文：\n${options.context}`
      : `请简要理解以下英语句子：\n\n${selectedText}`;

  const response = await requestUrl({
    url: endpoint,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(buildComprehensionRequestBody(options.settings, prompt, userContent)),
    throw: false,
  });

  const body = response.json as
    | {
        choices?: Array<{
          message?: {
            content?: unknown;
            reasoning_content?: unknown;
          };
          finish_reason?: string;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          completion_tokens_details?: {
            reasoning_tokens?: number;
          };
        };
        error?: { message?: string };
      }
    | undefined;

  if (response.status < 200 || response.status >= 300) {
    const apiMessage = typeof body?.error?.message === "string" ? body.error.message : "";
    const diagnostic = extractComprehensionResponseDiagnostic(body, apiMessage || `HTTP ${response.status}`);
    logComprehensionResponseShape(diagnostic);
    throw new Error(apiMessage || response.text || `HTTP ${response.status}`);
  }

  const choice = body?.choices?.[0];
  const rawContent = choice?.message?.content;
  const finishReason = choice?.finish_reason;
  const isTruncated = finishReason === "length";
  const content = typeof rawContent === "string" ? rawContent : "";

  if (!content.trim()) {
    const diagnostic = extractComprehensionResponseDiagnostic(
      body,
      isTruncated ? "Content empty due to length limit" : "Empty content"
    );
    logComprehensionResponseShape(diagnostic);

    if (isTruncated) {
      throw new Error("输出被截断（超出最大 Token 限制）");
    }
    throw new Error("DeepSeek 返回的数据中没有可显示的内容");
  }

  try {
    return parseComprehensionResponse(content, selectedText, { isTruncated });
  } catch (parseError) {
    const diagnostic = extractComprehensionResponseDiagnostic(body, parseError);
    logComprehensionResponseShape(diagnostic);
    throw parseError;
  }
}
