import { describe, expect, it } from "vitest";
import {
  buildComprehensionRequestBody,
  parseComprehensionResponse,
} from "../../ai/zora/zora-comprehension-service";

describe("zora-comprehension-service", () => {
  it("builds request body with thinking enabled and reasoning_effort medium", () => {
    const settings: any = {
      model: "deepseek-reasoner",
      maxTokens: 4096,
      enabled: true,
    };
    const body = buildComprehensionRequestBody(settings, "SYSTEM_PROMPT", "TEST_USER_CONTENT");
    expect(body.model).toBe("deepseek-reasoner");
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("medium");
    expect(body.max_tokens).toBeGreaterThanOrEqual(8192);
    expect(body.messages[0].content).toBe("SYSTEM_PROMPT");
    expect(body.messages[1].content).toBe("TEST_USER_CONTENT");
  });

  it("ignores the removed specialNotes field in legacy JSON responses", () => {
    const rawJson = JSON.stringify({
      complexity: "complex",
      translation: "我不知道他准备做什么，而我正紧紧抓住……",
      howToRead: [
        { chunk: "I didn't know", translation: "我不知道" },
        { chunk: "what he was gonna do", translation: "他准备做什么" },
        { chunk: "and I was holding on tight", translation: "而我正紧紧抓住" },
      ],
      keyPatterns: [
        { pattern: "didn't know what...", meaning: "不知道……" },
        { pattern: "hold on tight", meaning: "抓紧；坚持住" },
      ],
      specialNotes: [
        { target: "gonna", explanation: "口语化表达，等于 going to。" },
      ],
    });

    const result = parseComprehensionResponse(
      `<think>Analyzing reading chunks...</think> \`\`\`json\n${rawJson}\n\`\`\``,
      "I didn't know what he was gonna do and I was holding on tight."
    );

    expect(result.complexity).toBe("complex");
    expect(result.translation).toBe("我不知道他准备做什么，而我正紧紧抓住……");
    expect(result.howToRead).toHaveLength(3);
    expect(result.howToRead?.[0]).toEqual({ chunk: "I didn't know", translation: "我不知道" });
    expect(result.keyPatterns).toHaveLength(2);
    expect(result.keyPatterns[0]).toEqual({ pattern: "didn't know what...", meaning: "不知道……" });
    expect("specialNotes" in result).toBe(false);
  });

  it("parses valid JSON response with transferExample (顺手记一下)", () => {
    const rawJson = JSON.stringify({
      complexity: "complex",
      translation: "她一直叫我保守秘密。",
      howToRead: [
        { chunk: "She kept telling me", translation: "她一直叫我" },
        { chunk: "to keep the secret", translation: "保守秘密" },
      ],
      keyPatterns: [
        { pattern: "keep telling sb to do sth", meaning: "一直叫某人做某事" },
      ],
      transferExample: {
        pattern: "keep telling sb to do sth",
        sentence: "She kept asking me the same question.",
        translation: "她一直问我同一个问题。",
      },
    });

    const result = parseComprehensionResponse(rawJson, "She kept telling me to keep the secret.");

    expect(result.complexity).toBe("complex");
    expect(result.translation).toBe("她一直叫我保守秘密。");
    expect(result.howToRead).toHaveLength(2);
    expect(result.keyPatterns).toHaveLength(1);
    expect(result.transferExample).toBeDefined();
    expect(result.transferExample?.sentence).toBe("She kept asking me the same question.");
    expect(result.transferExample?.translation).toBe("她一直问我同一个问题。");
    expect(result.transferExample?.pattern).toBe("keep telling sb to do sth");
  });

  it("parses simple sentence without howToRead or transferExample", () => {
    const rawJson = JSON.stringify({
      complexity: "simple",
      translation: "他每天早上慢跑。",
      howToRead: [],
      keyPatterns: [
        { pattern: "go jogging", meaning: "去慢跑" },
      ],
      transferExample: null,
    });

    const result = parseComprehensionResponse(
      rawJson,
      "He goes jogging every morning."
    );

    expect(result.complexity).toBe("simple");
    expect(result.translation).toBe("他每天早上慢跑。");
    expect(result.howToRead).toBeUndefined();
    expect(result.keyPatterns).toHaveLength(1);
    expect(result.transferExample).toBeUndefined();
  });

  it("preserves the original sentence while ignoring removed legacy notes", () => {
    const sentence = "I am 32 yeres old and next munth is my brithday.";
    const rawJson = JSON.stringify({
      complexity: "complex",
      translation: "我今年32岁，下个月是我的生日。",
      howToRead: [
        { chunk: "I am 32 yeres old", translation: "我32岁" },
        { chunk: "and next munth", translation: "而且下个月" },
        { chunk: "is my brithday", translation: "是我的生日" },
      ],
      keyPatterns: [
        { pattern: "I am ... years old", meaning: "我……岁" },
      ],
      specialNotes: [
        {
          target: "yeres / munth / brithday",
          explanation: "原文采用非标准拼写/书写形式，标准形式通常为 years / month / birthday；这是人物当前书写与语言特征的一部分，阅读时保留原文。",
        },
      ],
    });

    const result = parseComprehensionResponse(rawJson, sentence);
    expect(result.sentence).toBe(sentence); // Original non-standard spellings preserved
    expect("specialNotes" in result).toBe(false);
  });

  it("throws error when response is truncated by token limit", () => {
    expect(() => {
      parseComprehensionResponse("{\"translation\": \"部分翻译...", "Some sentence", { isTruncated: true });
    }).toThrow("输出被截断（超出最大 Token 限制）");
  });

  it("falls back to text parsing if JSON is malformed", () => {
    const textOutput = `
译文：我不知道他准备做什么。
怎么读：
- I didn't know → 我不知道
- what he was gonna do → 他准备做什么
值得记住：
- didn't know what... → 不知道……
这里为什么这样说：
- gonna: 口语中 going to 的缩写
顺手记一下：
She kept asking me the same question. → 她一直问我同一个问题。
    `;

    const result = parseComprehensionResponse(textOutput, "I didn't know what he was gonna do.");
    expect(result.translation).toBe("我不知道他准备做什么。");
    expect(result.howToRead).toHaveLength(2);
    expect(result.keyPatterns).toHaveLength(1);
    expect("specialNotes" in result).toBe(false);
    expect(result.transferExample).toBeDefined();
    expect(result.transferExample?.sentence).toBe("She kept asking me the same question.");
    expect(result.transferExample?.translation).toBe("她一直问我同一个问题。");
  });

  it("handles highly transferable key patterns (e.g. don't know what + clause)", () => {
    const rawJson = JSON.stringify({
      complexity: "complex",
      translation: "我不知道他打算做什么。",
      howToRead: [
        { chunk: "I didn't know", translation: "我不知道" },
        { chunk: "what he was gonna do", translation: "他打算做什么" },
      ],
      keyPatterns: [
        { pattern: "don't know what + clause", meaning: "不知道……" },
        { pattern: "keep telling sb to do sth", meaning: "一直叫某人做某事" },
        { pattern: "get + sb + adjective", meaning: "使某人变得…… / 使某人感到……" },
      ],
      transferExample: null,
    });

    const result = parseComprehensionResponse(rawJson, "I didn't know what he was gonna do.");
    expect(result.keyPatterns).toHaveLength(3);
    expect(result.keyPatterns[0]).toEqual({
      pattern: "don't know what + clause",
      meaning: "不知道……",
    });
    expect(result.keyPatterns[1]).toEqual({
      pattern: "keep telling sb to do sth",
      meaning: "一直叫某人做某事",
    });
    expect(result.keyPatterns[2]).toEqual({
      pattern: "get + sb + adjective",
      meaning: "使某人变得…… / 使某人感到……",
    });
  });
});
