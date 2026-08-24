import { requestUrl } from "obsidian";
import type { App } from "obsidian";
import type { IntegratedAISettings } from "../../../config/integrated-ai-settings";
import {
  DEFAULT_INTEGRATED_AI_SETTINGS,
  readIntegratedAIApiKey,
  supportsIntegratedAISecretStorage,
} from "../../../config/integrated-ai-settings";

export type ZoraGrammarComplexity = "short" | "medium" | "complex";

export interface ZoraGrammarPoint {
  label: string;
  target?: string;
  explanation: string;
}

export interface ZoraGrammarAnalysisResult {
  sentence: string;
  complexity?: ZoraGrammarComplexity;
  structure: string;
  points: ZoraGrammarPoint[];
  difficulty?: string;
  paraphrase?: string;
  rawText?: string;
}

const GRAMMAR_SYSTEM_PROMPT =
  `你是一名资深的英语阅读理解与语法解析专家。请对用户提供的英文句子进行结构化解析，定位为"读书辅助解析"，而非生硬的应试拆句。\n\n` +
  `【解析与策略规范】\n` +
  `1. 短句真正简化与分级规则（complexity）：\n` +
  `   - "short"（短句）：句子结构简单（如单句、单并列、简短复合句）、语法点 ≤ 3 的句子。\n` +
  `     【短句显示规范】只输出 3 项内容：\n` +
  `       ① 句子骨架（structure）\n` +
  `       ② 关键点（points，精简保留 1~3 个核心点）\n` +
  `       ③ 中文翻译（paraphrase，自然流畅的整句中文翻译）\n` +
  `     【隐藏难点解析】difficulty 必须输出空字符串 ""。\n` +
  `   - "medium"（中句）：包含 1~2 个修饰成分/从句或复合结构，有一定阅读信息量。如无超出翻译本身的特殊难点 difficulty 留空 ""。\n` +
  `   - "complex"（长难句）：多重从句嵌套、长定状语修饰、倒装、虚拟语气等复杂长句，保持完整输出（骨架、关键语法、整句翻译，仅必要时输出难点解析）。\n\n` +
  `2. 结构判断修正规范（structure）：\n` +
  `   - 必须准确判断每个分句的真实句式结构，严禁将系动词分句（如 is/am/are/was/were/become/seem 等后接表语）泛化或误判为普通"主谓结构"或"主谓宾"：\n` +
  `     · 主系表（Subject + Linking Verb + Predicative）：如 "I am 32 yeres old"、"next munth is my birthday" 均为主系表\n` +
  `     · 主谓宾（Subject + Verb + Object）\n` +
  `     · 主谓（Subject + Verb）\n` +
  `     · 主谓双宾 / 主谓宾补 等\n` +
  `   - 当句子通过 and / but / or / so / yet 等并列连词连接两个独立分句时，必须分别判断前后各分句的真实结构，连词本身作为独立节点连接：\n` +
  `     · 正确示例："I am 32 yeres old and next munth is my birthday." → 骨架：主系表 → and → 主系表（严禁把第二分句误判成普通主谓）\n` +
  `     · 正确示例："She left early but he was angry." → 骨架：主谓 → but → 主系表\n` +
  `     · 正确示例："He opened the door and entered the room." → 骨架：主谓宾 → and → 主谓宾\n` +
  `   - 骨架节点之间统一用 " → " 连接，保持清晰流畅。\n\n` +
  `3. 难点解析与理解提示规范（difficulty）：\n` +
  `   - 仅在句子确实存在超出直译本身的深层语气、反讽、双关、特殊语境暗示或严重违背直觉的难点时才输出（作为理解提示）；\n` +
  `   - 【严禁重复翻译】严禁在 difficulty 中重复输出中文整句翻译或复述已知语法点；\n` +
  `   - 若无超出翻译本身的特殊语气或难点，difficulty 必须输出空字符串 ""。\n\n` +
  `4. 非标准拼写集中与去重规范：\n` +
  `   - 当遇到文学作品中的非标准拼写、方言或角色口语化拼写（如 yeres, munth, brithday, werk, wud 等）：\n` +
  `     · 同一句中的所有非标准拼写必须集中合并为一个"非标准拼写"语法点（label 固定为 "非标准拼写"），严禁拆分成多个条目；\n` +
  `     · 集中解释后，严禁在其他关键语法条目中重复解释，严禁在难点解析（difficulty）中重复出现。\n\n` +
  `5. 文学文本措辞规范：\n` +
  `   - 【严禁】使用"错误拼写"、"拼写错误"、"应改为"、"反映教育程度"、"反映口音"、"错别字"等批改式或评判性措辞；\n` +
  `   - 【统一规范措辞】合并后的非标准拼写条目，其 explanation 必须统一更谨慎地写为：\n` +
  `     "原文采用非标准拼写，标准形式通常为 xxx；这是人物书写/语言特征的一部分，阅读时保留原文。"\n` +
  `     （其中 xxx 按原词与标准词对应列出，例如 "yeres → years、munth → month、brithday → birthday" 或单词 "werk → work"）；\n` +
  `   - 禁止修改 EPUB 正文，所有解析仅作为阅读辅助。\n\n` +
  `必须严格输出以下 JSON 格式（不要包含任何额外 Markdown 标题或代码块之外的废话）：\n` +
  `{\n` +
  `  "complexity": "short | medium | complex",\n` +
  `  "structure": "句子骨架（如：主系表 → and → 主系表）",\n` +
  `  "points": [\n` +
  `    {\n` +
  `      "label": "关键点或语法标签（如：非标准拼写 / 状语从句 / 口语流水句）",\n` +
  `      "target": "对应原文短语或词汇",\n` +
  `      "explanation": "简明自然的阅读辅助解释"\n` +
  `    }\n` +
  `  ],\n` +
  `  "difficulty": "难点解析（仅在有超出翻译本身的深层语气/特殊含义时填写，短句及普通句必须为 \"\"，严禁重复翻译）",\n` +
  `  "paraphrase": "整句自然流畅的中文翻译"\n` +
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

export function inferSentenceComplexity(
  sentence: string,
  structure: string,
  pointsCount: number,
  hasDifficulty: boolean
): ZoraGrammarComplexity {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  const structNodes = structure.split(/\s*(?:→|->|\+|\|)\s*/).filter(Boolean);

  if (words.length <= 14 && structNodes.length <= 3 && pointsCount <= 3 && !hasDifficulty) {
    return "short";
  }
  if (words.length >= 24 || structNodes.length >= 5 || pointsCount >= 5 || (words.length >= 18 && hasDifficulty)) {
    return "complex";
  }
  return "medium";
}

export function normalizeGrammarComplexity(
  raw: unknown,
  fallback: ZoraGrammarComplexity
): ZoraGrammarComplexity {
  if (typeof raw !== "string") return fallback;
  const s = raw.toLowerCase().trim();
  if (s === "short" || s === "短句" || s === "简短句" || s === "simple") return "short";
  if (s === "complex" || s === "长难句" || s === "难句" || s === "hard") return "complex";
  if (s === "medium" || s === "中句" || s === "中等句" || s === "normal") return "medium";
  return fallback;
}

export const GRAMMAR_DEFAULT_MAX_TOKENS = 8192;

export interface GrammarResponseDiagnostic {
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

export function extractGrammarResponseDiagnostic(
  body: unknown,
  jsonParseError?: unknown
): GrammarResponseDiagnostic {
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

export function logGrammarResponseShape(diagnostic: GrammarResponseDiagnostic): void {
  console.warn("[ZoraGrammar] Request failed or abnormal response shape:", JSON.stringify(diagnostic));
}

export function parseGrammarResponse(
  rawContent: string,
  sentence: string,
  options?: { isTruncated?: boolean }
): ZoraGrammarAnalysisResult {
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

  // Try extracting JSON from code fence or raw string
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

  let parseError: unknown;
  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed === "object" && parsed !== null) {
      const structure = String(parsed.structure || "").trim();
      const rawPoints = Array.isArray(parsed.points) ? parsed.points : [];
      const points: ZoraGrammarPoint[] = rawPoints.map((p: any) => ({
        label: String(p.label || "关键点").trim(),
        target: p.target ? String(p.target).trim() : undefined,
        explanation: String(p.explanation || "").trim(),
      })).filter((p) => p.explanation || p.label);

      const rawDifficulty = parsed.difficulty ? String(parsed.difficulty).trim() : "";
      const difficulty =
        rawDifficulty && rawDifficulty !== "无" && rawDifficulty !== "无难点" && rawDifficulty !== "暂无"
          ? rawDifficulty
          : undefined;

      const fallbackComplexity = inferSentenceComplexity(
        sentence,
        structure,
        points.length,
        Boolean(difficulty)
      );
      const complexity = normalizeGrammarComplexity(parsed.complexity, fallbackComplexity);

      return {
        sentence,
        complexity,
        structure: structure || "句子骨架",
        points,
        difficulty,
        paraphrase: parsed.paraphrase ? String(parsed.paraphrase).trim() : undefined,
        rawText: trimmed,
      };
    }
  } catch (err) {
    parseError = err;
  }

  if (options?.isTruncated) {
    throw new Error("输出被截断（超出最大 Token 限制），未能生成完整的语法解析");
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

  const rawDifficulty = difficulty.trim();
  const validDifficulty =
    rawDifficulty && rawDifficulty !== "无" && rawDifficulty !== "无难点" && rawDifficulty !== "暂无"
      ? rawDifficulty
      : undefined;
  const structClean = structure.trim() || "句子骨架";
  const finalPoints = points.slice(0, 4);
  const inferredComp = inferSentenceComplexity(sentence, structClean, finalPoints.length, Boolean(validDifficulty));

  return {
    sentence,
    complexity: inferredComp,
    structure: structClean,
    points: finalPoints,
    difficulty: validDifficulty,
    paraphrase: paraphrase ? paraphrase.trim() : undefined,
    rawText: text,
  };
}

export function buildGrammarRequestBody(
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
  const grammarMaxTokens = Math.max(configuredMaxTokens, GRAMMAR_DEFAULT_MAX_TOKENS);

  return {
    model: settings.model || DEFAULT_INTEGRATED_AI_SETTINGS.model,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: userContent },
    ],
    thinking: { type: "enabled" },
    reasoning_effort: "medium",
    max_tokens: grammarMaxTokens,
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
    body: JSON.stringify(buildGrammarRequestBody(options.settings, prompt, userContent)),
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
    const diagnostic = extractGrammarResponseDiagnostic(body, apiMessage || `HTTP ${response.status}`);
    logGrammarResponseShape(diagnostic);
    throw new Error(apiMessage || response.text || `HTTP ${response.status}`);
  }

  const choice = body?.choices?.[0];
  const rawContent = choice?.message?.content;
  const finishReason = choice?.finish_reason;
  const isTruncated = finishReason === "length";
  const content = typeof rawContent === "string" ? rawContent : "";

  if (!content.trim()) {
    const diagnostic = extractGrammarResponseDiagnostic(
      body,
      isTruncated ? "Content empty due to length limit" : "Empty content"
    );
    logGrammarResponseShape(diagnostic);

    if (isTruncated) {
      throw new Error("输出被截断（超出最大 Token 限制）");
    }
    throw new Error("DeepSeek 返回的数据中没有可显示的内容");
  }

  try {
    return parseGrammarResponse(content, selectedText, { isTruncated });
  } catch (parseError) {
    const diagnostic = extractGrammarResponseDiagnostic(body, parseError);
    logGrammarResponseShape(diagnostic);
    throw parseError;
  }
}
