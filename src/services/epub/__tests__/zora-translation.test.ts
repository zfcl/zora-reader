import { describe, expect, it } from "vitest";
import { clearDictionaryCache, parseDictionaryEntry, parseTranslationResult, translateSelection } from "../../ai/zora/translation";
import { buildZoraTranslationCapture } from "../../ai/zora/zora-translation-service";
import { normalizeVocabularyEntry } from "../../ai/zora/vocabulary";
const ok = (content: string) => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content } }] }) });
describe("Zora translation regression", () => {
  it("keeps multiple high-frequency senses for a word", () => {
    const result = parseTranslationResult(JSON.stringify({ kind: "word", source: "cause", currentMeaning: "原因", translation: "原因", senses: [{ label: "名词", meaning: "原因", frequencyBand: "common" }, { label: "名词", meaning: "理由", frequencyBand: "regular" }, { label: "名词", meaning: "事业", frequencyBand: "regular" }, { label: "动词", meaning: "导致", frequencyBand: "common" }] }), "cause");
    expect(result.senses).toHaveLength(4); expect(result.currentMeaning).toBe("原因");
  });
  it("does not apply a word template to a sentence", () => {
    const result = parseTranslationResult(JSON.stringify({ kind: "passage", source: "Charlie felt perplexed by the maze.", translation: "查理对迷宫感到困惑。", senses: [] }), "Charlie felt perplexed by the maze.");
    expect(result.kind).toBe("passage"); expect(result.senses).toHaveLength(0); expect(result.translation).toBe("查理对迷宫感到困惑。");
  });
  it("builds a unified selection capture", () => {
    const capture = buildZoraTranslationCapture({ text: "causes", cfiRange: "epubcfi(/6/2!/1:0)", chapter: "Ch", bookPath: "Books/A.epub", bookTitle: "A", context: "He studies causes.", range: null });
    expect(capture.source).toBe("weave"); expect(capture.singleWord).toBe(true); expect(capture.bookPath).toBe("Books/A.epub");
  });
  it("sends a non-thinking JSON request", async () => {
    clearDictionaryCache();
    const bodies: Array<{ model: string; thinking?: unknown; response_format?: unknown }> = [];
    const send = async (request: { body?: unknown }) => {
      const body = JSON.parse(typeof request.body === "string" ? request.body : "{}"); bodies.push(body);
      const system = String(body.messages?.[0]?.content || "");
      let content: string;
      if (system.includes("syntactic analyst")) content = JSON.stringify({ part_of_speech: "noun", syntax_evidence: "x context" });
      else if (system.includes("You are a dictionary.")) content = JSON.stringify({ kind: "word", lemma: "x", phonetic: "/x/", part_of_speech: "noun", senses: [{ label: "名词", meaning: "某物" }] });
      else content = JSON.stringify({ context_meaning: "语境义", context_explanation: "说明", sentence_translation: "句译" });
      return ok(content);
    };
    const config = { apiKey: "secret", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", sourceLanguage: "auto", targetLanguage: "zh", disableThinking: true };
    await translateSelection(config, { source: "weave", text: "x", context: "x context", sentenceContext: "x context", cfi: "one", chapter: "", progress: 0 } as never, send as never);
    const body = bodies[0];
    expect(body.thinking).toEqual({ type: "disabled" }); expect(body.response_format).toEqual({ type: "json_object" });
  });
  it("normalizes vocabulary entries with book/cfi", () => {
    const entry = normalizeVocabularyEntry({ word: "cause", lemma: "cause", contextualMeaning: "原因", sourceSentence: "He studies causes.", bookPath: "Books/A.epub", cfiRange: "epubcfi(/6/2!/1:0)" });
    expect(entry?.word).toBe("cause"); expect(entry?.bookPath).toBe("Books/A.epub"); expect(entry?.cfiRange).toContain("epubcfi"); expect(normalizeVocabularyEntry(null)).toBeNull();
  });
});
