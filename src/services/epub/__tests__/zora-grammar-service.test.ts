import { describe, expect, it } from "vitest";
import { parseGrammarResponse } from "../../ai/zora/zora-grammar-service";

describe("zora-grammar-service", () => {
  it("parses valid JSON response cleanly", () => {
    const raw = JSON.stringify({
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
    expect(result.structure).toBe("主句 + 状语从句 + 插入语");
    expect(result.points.length).toBe(2);
    expect(result.points[0].label).toBe("插入语");
    expect(result.points[0].target).toBe("as Wells might have put it");
    expect(result.difficulty).toBe("注意虚拟语气与倒装的结合");
    expect(result.paraphrase).toBe("正如威尔斯可能说的那样，当他到达时，一切都已经改变了。");
  });

  it("extracts JSON wrapped in markdown code fence", () => {
    const raw = "```json\n" + JSON.stringify({
      structure: "主系表结构",
      points: [{ label: "系表结构", explanation: "is essential 表状态" }],
      paraphrase: "这至关重要。",
    }) + "\n```";

    const result = parseGrammarResponse(raw, "It is essential.");
    expect(result.structure).toBe("主系表结构");
    expect(result.points.length).toBe(1);
    expect(result.paraphrase).toBe("这至关重要。");
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
});
