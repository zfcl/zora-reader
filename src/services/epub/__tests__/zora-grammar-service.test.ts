import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildGrammarRequestBody,
  extractGrammarResponseDiagnostic,
  inferSentenceComplexity,
  normalizeGrammarComplexity,
  parseGrammarResponse,
  runZoraGrammarAnalysis,
} from "../../ai/zora/zora-grammar-service";
import {
  clearDictionaryCache,
  translateSelection,
} from "../../ai/zora/translation";
import { requestUrl } from "obsidian";

describe("zora-grammar-service", () => {
  it("parses valid JSON response cleanly with complexity", () => {
    const raw = JSON.stringify({
      complexity: "complex",
      structure: "主句 + 状语从句 + 插入语",
      points: [
        {
          label: "插入语",
          target: "as Wells might have put it",
          explanation: "补充说明作者用词，不影响主干。",
        },
        {
          label: "状语从句",
          target: "when he arrived",
          explanation: "时间状语从句，修饰主句谓语。",
        },
      ],
      difficulty: "注意虚拟语气与倒装的结合",
      paraphrase: "正如威尔斯可能说的那样，当他到达时，一切都已经改变了。",
    });

    const result = parseGrammarResponse(raw, "As Wells might have put it, when he arrived...");
    expect(result.complexity).toBe("complex");
    expect(result.structure).toBe("主句 + 状语从句 + 插入语");
    expect(result.points.length).toBe(2);
    expect(result.points[0].label).toBe("插入语");
    expect(result.points[0].target).toBe("as Wells might have put it");
    expect(result.difficulty).toBe("注意虚拟语气与倒装的结合");
    expect(result.paraphrase).toBe("正如威尔斯可能说的那样，当他到达时，一切都已经改变了。");
  });

  it("extracts JSON wrapped in markdown code fence with short sentence complexity", () => {
    const raw =
      "```json\n" +
      JSON.stringify({
        complexity: "short",
        structure: "主系表结构",
        points: [{ label: "关键点", explanation: "is essential 表状态" }],
        paraphrase: "这至关重要。",
      }) +
      "\n```";

    const result = parseGrammarResponse(raw, "It is essential.");
    expect(result.complexity).toBe("short");
    expect(result.structure).toBe("主系表结构");
    expect(result.points.length).toBe(1);
    expect(result.difficulty).toBeUndefined();
    expect(result.paraphrase).toBe("这至关重要。");
  });

  it("correctly handles non-standard spelling and literary character style", () => {
    const raw = JSON.stringify({
      complexity: "short",
      structure: "自我介绍 → 工作信息",
      points: [
        {
          label: "非标准拼写",
          target: "werk",
          explanation: "原文采用非标准拼写，标准形式通常为 werk → work；这是人物书写/语言特征的一部分，阅读时保留原文。",
        },
        {
          label: "口语并列",
          target: "Charlie Gordon I werk",
          explanation: "口语化流水句，省略连接词，符合第一人称日记叙述风格。",
        },
      ],
      difficulty: "",
      paraphrase: "我叫查理·高登，在唐纳面包店工作。",
    });

    const result = parseGrammarResponse(
      raw,
      "My name is Charlie Gordon I werk in Donners bakery."
    );
    expect(result.complexity).toBe("short");
    expect(result.structure).toBe("自我介绍 → 工作信息");
    expect(result.points.length).toBe(2);
    expect(result.points[0].label).toBe("非标准拼写");
    expect(result.points[0].explanation).toBe(
      "原文采用非标准拼写，标准形式通常为 werk → work；这是人物书写/语言特征的一部分，阅读时保留原文。"
    );
    expect(result.difficulty).toBeUndefined();
    expect(result.paraphrase).toBe("我叫查理·高登，在唐纳面包店工作。");
  });

  it("handles compound sentence structure with linking verbs and deduplicated multiple non-standard spellings", () => {
    const raw = JSON.stringify({
      complexity: "short",
      structure: "主系表 → and → 主系表",
      points: [
        {
          label: "非标准拼写",
          target: "yeres / munth",
          explanation: "原文采用非标准拼写，标准形式通常为 yeres → years、munth → month；这是人物书写/语言特征的一部分，阅读时保留原文。",
        },
        {
          label: "并列连词",
          target: "and",
          explanation: "连接两个独立的主系表分句，陈述年龄与生日。",
        },
      ],
      difficulty: "",
      paraphrase: "我32岁了，下个月是我的生日。",
    });

    const result = parseGrammarResponse(
      raw,
      "I am 32 yeres old and next munth is my birthday."
    );
    expect(result.complexity).toBe("short");
    expect(result.structure).toBe("主系表 → and → 主系表");
    expect(result.points.length).toBe(2);
    expect(result.points[0].label).toBe("非标准拼写");
    expect(result.points[0].explanation).toBe(
      "原文采用非标准拼写，标准形式通常为 yeres → years、munth → month；这是人物书写/语言特征的一部分，阅读时保留原文。"
    );
    expect(result.difficulty).toBeUndefined();
    expect(result.paraphrase).toBe("我32岁了，下个月是我的生日。");
  });

  it("infers complexity properly when not explicitly returned in JSON", () => {
    // Short sentence: 3 words, 1 structure node, 1 point, no difficulty
    const shortRaw = JSON.stringify({
      structure: "祈使句",
      points: [{ label: "动词短语", explanation: "take care 表叮嘱" }],
      paraphrase: "保重。",
    });
    const shortResult = parseGrammarResponse(shortRaw, "Take good care.");
    expect(shortResult.complexity).toBe("short");

    // Complex sentence: long sentence, multiple points, has difficulty
    const complexRaw = JSON.stringify({
      structure: "让步状语从句 → 主句 → 宾语从句 → 定语从句",
      points: [
        { label: "让步状语", explanation: "Although ..." },
        { label: "虚拟语气", explanation: "would have ..." },
        { label: "定语从句", explanation: "which was ..." },
        { label: "分词作状语", explanation: "hoping to ..." },
      ],
      difficulty: "注意让步与主从多层嵌套的关系",
      paraphrase: "长难句翻译测试。",
    });
    const complexResult = parseGrammarResponse(
      complexRaw,
      "Although he had been warned many times before he left the city, he chose to ignore all advice hoping that luck would eventually find him."
    );
    expect(complexResult.complexity).toBe("complex");
  });

  it("handles fallback plain text without crashing or leaving markdown headers", () => {
    const raw = `### 句子结构分析
核心结构：主句 + 定语从句
关键语法点：
- 虚拟语气：would have done 表示对过去的假设
- 定语从句：which clause 修饰先行词
整句理解：如果当时发生了那件事，结果就会截然不同。`;

    const result = parseGrammarResponse(raw, "Had it happened...");
    expect(result.structure).toBe("主句 + 定语从句");
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.paraphrase).toBe("如果当时发生了那件事，结果就会截然不同。");
  });

  it("correctly disambiguates simple past tense 'I had a test today' without misjudging as past perfect", () => {
    const raw =
      "<think>\n" +
      "1. Identify tense: 'had' is the simple past form of the transitive verb 'have'.\n" +
      "2. It is followed by the direct object 'a test' and adverbial 'today', not a past participle.\n" +
      "3. Therefore, it is Simple Past (一般过去时), NOT Past Perfect (过去完成时).\n" +
      "</think>\n" +
      "```json\n" +
      JSON.stringify({
        complexity: "short",
        structure: "主谓宾",
        points: [
          {
            label: "时态判断",
            target: "had",
            explanation: "had 为 have 的一般过去式，作谓语动词，全句为一般过去时（表示过去发生的事情）；后接名词短语而非过去分词，非过去完成时。",
          },
        ],
        difficulty: "",
        paraphrase: "我今天参加了一次测试。",
      }) +
      "\n```";

    const result = parseGrammarResponse(raw, "I had a test today");
    expect(result.complexity).toBe("short");
    expect(result.structure).toBe("主谓宾");
    expect(result.points.length).toBe(1);
    expect(result.points[0].target).toBe("had");
    expect(result.points[0].explanation).toContain("一般过去时");
    expect(result.points[0].explanation).toContain("have 的一般过去式");
    expect(result.points[0].explanation).not.toContain("判定为过去完成时");
    expect(result.points[0].label).not.toBe("过去完成时");
    expect(result.paraphrase).toBe("我今天参加了一次测试。");
  });

  it("correctly identifies past perfect tense when 'had' is followed by a past participle 'I had finished the test.'", () => {
    const raw =
      "<think>\n" +
      "1. 'had' is an auxiliary verb followed by the past participle 'finished'.\n" +
      "2. 'had + finished' forms Past Perfect tense (过去完成时).\n" +
      "</think>\n" +
      JSON.stringify({
        complexity: "short",
        structure: "主谓宾",
        points: [
          {
            label: "过去完成时",
            target: "had finished",
            explanation: "助动词 had + 过去分词 finished 构成过去完成时，表示在过去某个参照时间点之前已经完成的动作。",
          },
        ],
        difficulty: "",
        paraphrase: "我已经完成了测试。",
      });

    const result = parseGrammarResponse(raw, "I had finished the test.");
    expect(result.complexity).toBe("short");
    expect(result.structure).toBe("主谓宾");
    expect(result.points.length).toBe(1);
    expect(result.points[0].label).toBe("过去完成时");
    expect(result.points[0].target).toBe("had finished");
    expect(result.points[0].explanation).toContain("过去完成时");
    expect(result.paraphrase).toBe("我已经完成了测试。");
  });

  it("conservatively explains 'a place with a long hall...' as with-phrase / supplementary description without forcing accompaniment adverbial", () => {
    const raw =
      "<think>\n" +
      "Analyzing: 'a place with a long hall...'\n" +
      "- 'with a long hall' modifies 'a place'.\n" +
      "- Conservative description: with-phrase / post-modifier / supplementary description.\n" +
      "- Do NOT force it into an adverbial of accompaniment (伴随状语).\n" +
      "</think>\n" +
      JSON.stringify({
        complexity: "short",
        structure: "名词短语 + with 短语修饰",
        points: [
          {
            label: "with 短语/补充描述",
            target: "with a long hall",
            explanation: "with 引导介词短语作后置定语/补充说明修饰 a place，保守解释为带有长廊的场所特征，作为名词短语的定语修饰。",
          },
        ],
        difficulty: "",
        paraphrase: "一个带有一条长廊的地方……",
      });

    const result = parseGrammarResponse(raw, "a place with a long hall...");
    expect(result.complexity).toBe("short");
    expect(result.points.length).toBe(1);
    expect(result.points[0].label).toBe("with 短语/补充描述");
    expect(result.points[0].target).toBe("with a long hall");
    expect(result.points[0].explanation).toContain("with");
    expect(result.points[0].explanation).toContain("补充说明");
    expect(result.points[0].label).not.toBe("伴随状语");
    expect(result.points[0].label).not.toContain("伴随");
  });

  it("handles thinking tags containing internal curly braces and markdown gracefully", () => {
    const raw =
      "<think>\n" +
      "Let's output: { \"not_real_json\": true }\n" +
      "Tense is simple past.\n" +
      "</think>\n" +
      "```json\n" +
      JSON.stringify({
        complexity: "short",
        structure: "主谓",
        points: [{ label: "一般过去时", explanation: "went 是 go 的过去式" }],
        paraphrase: "他走了。",
      }) +
      "\n```";

    const result = parseGrammarResponse(raw, "He went.");
    expect(result.complexity).toBe("short");
    expect(result.structure).toBe("主谓");
    expect(result.points[0].label).toBe("一般过去时");
    expect(result.paraphrase).toBe("他走了。");
  });

  it("normalizes various complexity aliases", () => {
    expect(normalizeGrammarComplexity("短句", "medium")).toBe("short");
    expect(normalizeGrammarComplexity("simple", "medium")).toBe("short");
    expect(normalizeGrammarComplexity("长难句", "medium")).toBe("complex");
    expect(normalizeGrammarComplexity("hard", "medium")).toBe("complex");
    expect(normalizeGrammarComplexity("中句", "short")).toBe("medium");
    expect(normalizeGrammarComplexity(undefined, "medium")).toBe("medium");
  });

  it("constructs grammar request payload with thinking enabled, reasoning_effort medium, and minimum 8192 max_tokens", () => {
    const settings = {
      enabled: true,
      endpoint: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "test-key",
      maxTokens: 2000,
      customPrompt: "",
    };

    const body = buildGrammarRequestBody(settings, "System prompt", "User prompt");
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("medium");
    expect(body.model).toBe("deepseek-chat");
    expect(body.max_tokens).toBe(8192);
    expect(body.messages).toEqual([
      { role: "system", content: "System prompt" },
      { role: "user", content: "User prompt" },
    ]);
  });

  it("allows higher custom maxTokens when configured above 8192", () => {
    const settings = {
      enabled: true,
      endpoint: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "test-key",
      maxTokens: 12000,
      customPrompt: "",
    };

    const body = buildGrammarRequestBody(settings, "System prompt", "User prompt");
    expect(body.max_tokens).toBe(12000);
  });

  it("ensures grammar chain (thinking enabled) and word translation chain (thinking disabled) are independent", async () => {
    const settings = {
      enabled: true,
      endpoint: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "test-key",
      maxTokens: 4096,
      customPrompt: "",
    };

    // Grammar chain: thinking is enabled with reasoning_effort medium and independent max_tokens
    const grammarBody = buildGrammarRequestBody(settings, "Grammar System", "Grammar User");
    expect(grammarBody.thinking).toEqual({ type: "enabled" });
    expect(grammarBody.reasoning_effort).toBe("medium");
    expect(grammarBody.max_tokens).toBe(8192);

    // Translation chain: thinking is disabled
    clearDictionaryCache();
    const sentBodies: Array<{ thinking?: unknown }> = [];
    const mockSend = async (request: { body?: string }) => {
      const parsed = JSON.parse(request.body || "{}");
      sentBodies.push(parsed);
      const system = String(parsed.messages?.[0]?.content || "");
      let content: string;
      if (system.includes("syntactic analyst")) {
        content = JSON.stringify({ part_of_speech: "noun", syntax_evidence: "a test" });
      } else if (system.includes("You are a dictionary.")) {
        content = JSON.stringify({
          kind: "word",
          lemma: "test",
          phonetic: "/tɛst/",
          part_of_speech: "noun",
          senses: [{ label: "名词", meaning: "测试" }],
        });
      } else {
        content = JSON.stringify({
          context_meaning: "测试",
          context_explanation: "说明",
          sentence_translation: "句译",
        });
      }
      return {
        status: 200,
        text: JSON.stringify({
          choices: [{ message: { content } }],
        }),
      };
    };

    const translationConfig = {
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      sourceLanguage: "auto",
      targetLanguage: "zh",
      disableThinking: true,
    };

    await translateSelection(
      translationConfig,
      {
        source: "weave",
        text: "test",
        context: "a test",
        sentenceContext: "a test",
        cfi: "epubcfi(/6/2)",
        chapter: "Ch1",
        progress: 0,
      } as never,
      mockSend as never
    );

    expect(sentBodies.length).toBeGreaterThan(0);
    expect(sentBodies[0].thinking).toEqual({ type: "disabled" });
  });

  it("extracts diagnostics accurately without exposing sensitive text or full prompt", () => {
    const rawBody = {
      choices: [
        {
          message: {
            content: "{\"structure\": \"主谓宾\"}",
            reasoning_content: "This is a detailed reasoning process taking many steps...",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 450,
        total_tokens: 570,
        completion_tokens_details: {
          reasoning_tokens: 350,
        },
      },
    };

    const diagnostic = extractGrammarResponseDiagnostic(rawBody);
    expect(diagnostic.hasContent).toBe(true);
    expect(diagnostic.hasReasoningContent).toBe(true);
    expect(diagnostic.contentLength).toBe(20);
    expect(diagnostic.reasoningContentLength).toBe(57);
    expect(diagnostic.finishReason).toBe("stop");
    expect(diagnostic.usage?.reasoningTokens).toBe(350);
    expect(diagnostic.usage?.totalTokens).toBe(570);
    expect(diagnostic.jsonParseError).toBeUndefined();

    // Check that diagnostic does not serialize the prompt or full user text
    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain("detailed reasoning process");
    expect(serialized).not.toContain("主谓宾");
  });

  it("handles short grammar + reasoning + content JSON", () => {
    const raw =
      "<think>Brief reasoning about simple subject-verb-object sentence.</think>" +
      JSON.stringify({
        complexity: "short",
        structure: "主谓宾",
        points: [{ label: "一般现在时", explanation: "表示普遍事实" }],
        paraphrase: "猫喝牛奶。",
      });

    const result = parseGrammarResponse(raw, "The cat drinks milk.");
    expect(result.complexity).toBe("short");
    expect(result.structure).toBe("主谓宾");
    expect(result.points.length).toBe(1);
    expect(result.paraphrase).toBe("猫喝牛奶。");
  });

  it("handles long reasoning + content JSON without corrupting structured output", () => {
    const longReasoning = "Step " + "thought process with detailed clause trees and syntactic trees ".repeat(50);
    const raw =
      `<think>${longReasoning}</think>\n` +
      "```json\n" +
      JSON.stringify({
        complexity: "complex",
        structure: "让步状语从句 → 主句 → 结果状语从句",
        points: [
          { label: "让步状语从句", target: "Although...", explanation: "引导让步关系" },
          { label: "主句谓语", target: "persisted", explanation: "核心动作" },
        ],
        difficulty: "注意长句的多层状语修饰",
        paraphrase: "尽管困难重重，他依然坚持了下来，以至于最终赢得了胜利。",
      }) +
      "\n```";

    const result = parseGrammarResponse(raw, "Although difficulties abounded, he persisted so that he finally won.");
    expect(result.complexity).toBe("complex");
    expect(result.structure).toBe("让步状语从句 → 主句 → 结果状语从句");
    expect(result.points.length).toBe(2);
    expect(result.difficulty).toBe("注意长句的多层状语修饰");
    expect(result.paraphrase).toBe("尽管困难重重，他依然坚持了下来，以至于最终赢得了胜利。");
  });

  it("throws explicit truncation error when finish_reason is length and JSON is truncated", () => {
    const truncatedContent = '{"complexity": "complex", "structure": "主句 → 状语从句", "points": [{"label": "从句"';

    expect(() => {
      parseGrammarResponse(truncatedContent, "A very long complex sentence...", { isTruncated: true });
    }).toThrow("输出被截断（超出最大 Token 限制），未能生成完整的语法解析");
  });

  it("throws explicit truncation error when finish_reason is length and content is empty", () => {
    expect(() => {
      parseGrammarResponse("", "A very long sentence...", { isTruncated: true });
    }).toThrow("输出被截断（超出最大 Token 限制）");
  });

  it("throws empty content error when content is empty and finish_reason is not length", () => {
    expect(() => {
      parseGrammarResponse("", "A sentence...", { isTruncated: false });
    }).toThrow("DeepSeek 返回的数据中没有可显示的内容");
  });

  it("correctly parses markdown fenced JSON with unclosed fence or extra text around it", () => {
    const unclosedFence =
      "Here is the analysis:\n```json\n" +
      JSON.stringify({
        complexity: "short",
        structure: "主系表",
        points: [{ label: "系表结构", explanation: "表状态" }],
        paraphrase: "天空是蓝色的。",
      });

    const result = parseGrammarResponse(unclosedFence, "The sky is blue.");
    expect(result.structure).toBe("主系表");
    expect(result.paraphrase).toBe("天空是蓝色的。");
  });

  describe("runZoraGrammarAnalysis API scenarios", () => {
    const mockApp = {
      secretStorage: {
        getSecret: vi.fn().mockReturnValue("sk-test-api-key"),
        setSecret: vi.fn(),
      },
    } as any;

    const baseSettings = {
      enabled: true,
      apiKeySecretId: "zora-reader-api-key",
      endpoint: "https://api.deepseek.com/chat/completions",
      model: "deepseek-chat",
      maxTokens: 2000,
      customPrompt: "",
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockApp.secretStorage.getSecret.mockReturnValue("sk-test-api-key");
    });

    it("successfully analyzes sentence when reasoning_content and valid JSON content are returned", async () => {
      (requestUrl as any).mockResolvedValueOnce({
        status: 200,
        json: {
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  complexity: "short",
                  structure: "主谓宾",
                  points: [{ label: "一般现在时", explanation: "表示日常动作" }],
                  paraphrase: "他读了一本书。",
                }),
                reasoning_content: "Analyzing sentence structure: 'He reads a book'. Subject is He, verb is reads...",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 50,
            completion_tokens: 180,
            total_tokens: 230,
            completion_tokens_details: { reasoning_tokens: 120 },
          },
        },
      });

      const res = await runZoraGrammarAnalysis({
        app: mockApp,
        settings: baseSettings,
        text: "He reads a book.",
      });

      expect(res.complexity).toBe("short");
      expect(res.structure).toBe("主谓宾");
      expect(res.paraphrase).toBe("他读了一本书。");
      // Verify reasoning_content is never put into paraphrase or structure
      expect(res.structure).not.toContain("Analyzing");
      expect(res.paraphrase).not.toContain("Analyzing");
    });

    it("successfully analyzes sentence with long reasoning process", async () => {
      const longReasoning = "Deep analysis: " + "step-by-step reasoning ".repeat(100);
      (requestUrl as any).mockResolvedValueOnce({
        status: 200,
        json: {
          choices: [
            {
              message: {
                role: "assistant",
                content: "```json\n" + JSON.stringify({
                  complexity: "complex",
                  structure: "主句 → 状语从句",
                  points: [{ label: "时间状语", explanation: "when 引导" }],
                  paraphrase: "当雨停时，我们离开了。",
                }) + "\n```",
                reasoning_content: longReasoning,
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 60,
            completion_tokens: 950,
            total_tokens: 1010,
            completion_tokens_details: { reasoning_tokens: 800 },
          },
        },
      });

      const res = await runZoraGrammarAnalysis({
        app: mockApp,
        settings: baseSettings,
        text: "When the rain stopped, we left.",
      });

      expect(res.complexity).toBe("complex");
      expect(res.structure).toBe("主句 → 状语从句");
      expect(res.paraphrase).toBe("当雨停时，我们离开了。");
    });

    it("handles reasoning_content present but content empty with stop finish_reason", async () => {
      (requestUrl as any).mockResolvedValueOnce({
        status: 200,
        json: {
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                reasoning_content: "Some reasoning that finished but produced no content.",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 40, completion_tokens: 100, total_tokens: 140 },
        },
      });

      await expect(
        runZoraGrammarAnalysis({
          app: mockApp,
          settings: baseSettings,
          text: "Some sentence.",
        })
      ).rejects.toThrow("DeepSeek 返回的数据中没有可显示的内容");
    });

    it("handles reasoning hitting token limit resulting in empty content and length finish_reason", async () => {
      (requestUrl as any).mockResolvedValueOnce({
        status: 200,
        json: {
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                reasoning_content: "Extremely long reasoning that ran out of max_tokens budget before outputting content...",
              },
              finish_reason: "length",
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 2000,
            total_tokens: 2100,
            completion_tokens_details: { reasoning_tokens: 2000 },
          },
        },
      });

      await expect(
        runZoraGrammarAnalysis({
          app: mockApp,
          settings: baseSettings,
          text: "A very long sentence requiring excessive reasoning...",
        })
      ).rejects.toThrow("输出被截断（超出最大 Token 限制）");
    });

    it("handles truncated JSON when finish_reason is length", async () => {
      (requestUrl as any).mockResolvedValueOnce({
        status: 200,
        json: {
          choices: [
            {
              message: {
                role: "assistant",
                content: '{"complexity": "complex", "structure": "主句 → 状语从句',
                reasoning_content: "Reasoning took most tokens and output JSON was cut off midway",
              },
              finish_reason: "length",
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 2000,
            total_tokens: 2100,
          },
        },
      });

      await expect(
        runZoraGrammarAnalysis({
          app: mockApp,
          settings: baseSettings,
          text: "A very long sentence...",
        })
      ).rejects.toThrow("输出被截断（超出最大 Token 限制），未能生成完整的语法解析");
    });

    it("successfully parses markdown fenced JSON in response", async () => {
      (requestUrl as any).mockResolvedValueOnce({
        status: 200,
        json: {
          choices: [
            {
              message: {
                role: "assistant",
                content: "```json\n" + JSON.stringify({
                  complexity: "short",
                  structure: "主谓",
                  points: [{ label: "不及物动词", explanation: "sleeps 不接宾语" }],
                  paraphrase: "婴儿睡着了。",
                }) + "\n```",
                reasoning_content: "Short reasoning",
              },
              finish_reason: "stop",
            },
          ],
        },
      });

      const res = await runZoraGrammarAnalysis({
        app: mockApp,
        settings: baseSettings,
        text: "The baby sleeps.",
      });

      expect(res.complexity).toBe("short");
      expect(res.structure).toBe("主谓");
      expect(res.paraphrase).toBe("婴儿睡着了。");
    });
  });
});

