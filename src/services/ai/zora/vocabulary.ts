export interface ZoraVocabularyEntry {
  word: string; lemma?: string; originalForm?: string; pronunciation?: string;
  contextualMeaning: string; contextExplanation?: string;
  commonMeanings: Array<{ label: string; meaning: string; usage?: string }>;
  sourceSentence: string; sentenceTranslation?: string;
  bookPath: string; bookTitle: string; chapter: string; cfiRange: string; createdAt: string;
  reviewState: { interval: number; ease: number; lapses: number; due: string; status: "new" | "learning" | "review" };
}
export function normalizeVocabularyEntry(value: Partial<ZoraVocabularyEntry> | null | undefined): ZoraVocabularyEntry | null {
  if (!value || typeof value.word !== "string" || !value.word.trim()) return null;
  return {
    word: value.word.trim(),
    lemma: typeof value.lemma === "string" ? value.lemma.trim() || undefined : undefined,
    originalForm: typeof value.originalForm === "string" ? value.originalForm.trim() || undefined : undefined,
    pronunciation: typeof value.pronunciation === "string" ? value.pronunciation.trim() || undefined : undefined,
    contextualMeaning: String(value.contextualMeaning || "").trim(),
    contextExplanation: typeof value.contextExplanation === "string" ? value.contextExplanation.trim() || undefined : undefined,
    commonMeanings: Array.isArray(value.commonMeanings) ? value.commonMeanings : [],
    sourceSentence: String(value.sourceSentence || "").trim(),
    sentenceTranslation: typeof value.sentenceTranslation === "string" ? value.sentenceTranslation.trim() || undefined : undefined,
    bookPath: String(value.bookPath || "").trim(), bookTitle: String(value.bookTitle || "").trim(), chapter: String(value.chapter || "").trim(), cfiRange: String(value.cfiRange || "").trim(), createdAt: String(value.createdAt || new Date().toISOString()),
    reviewState: { interval: 0, ease: 2.5, lapses: 0, due: new Date().toISOString().slice(0, 10), status: "new", ...(value.reviewState && typeof value.reviewState === "object" ? value.reviewState : {}) },
  };
}
