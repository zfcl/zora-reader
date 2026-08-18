import { Modal, Notice, setIcon, type App } from "obsidian";
import type StandaloneEpubPlugin from "../../main";
import { getNavigationHub } from "../../services/navigation/navigation-hub-access";
import type { ZoraVocabularyEntry } from "../../services/ai/zora/vocabulary";
export class ZoraVocabularyModal extends Modal {
  constructor(app: App, private readonly plugin: StandaloneEpubPlugin) { super(app); }
  onOpen(): void {
    this.titleEl.setText("Zora 生词本");
    this.contentEl.addClass("zora-vocabulary-modal");
    const entries = this.plugin.getVocabularyEntries();
    if (entries.length === 0) { this.contentEl.createEl("p", { text: "还没有加入生词。选中单词 → 词义 → 加入生词。" }); return; }
    const list = this.contentEl.createDiv({ cls: "zora-vocabulary-list" });
    for (const entry of entries) {
      const row = list.createDiv({ cls: "zora-vocabulary-row" });
      const head = row.createDiv({ cls: "zora-vocabulary-head" });
      head.createEl("strong", { text: entry.lemma || entry.word });
      if (entry.originalForm && entry.originalForm !== entry.word) head.createSpan({ text: `原文 ${entry.originalForm}`, cls: "zora-vocabulary-muted" });
      if (entry.pronunciation) head.createSpan({ text: entry.pronunciation, cls: "zora-vocabulary-phonetic" });
      row.createDiv({ text: entry.contextualMeaning || entry.commonMeanings[0]?.meaning || "", cls: "zora-vocabulary-meaning" });
      row.createDiv({ text: entry.sourceSentence, cls: "zora-vocabulary-sentence" });
      row.createDiv({ text: `${entry.bookTitle} · ${entry.chapter}`, cls: "zora-vocabulary-muted" });
      const actions = row.createDiv({ cls: "zora-vocabulary-actions" });
      const back = actions.createEl("button", { text: "回到原文" });
      const icon = back.createSpan(); setIcon(icon, "book-open"); back.prepend(icon);
      back.addEventListener("click", () => {
        if (!entry.bookPath || !entry.cfiRange) { new Notice("这条记录缺少原书定位"); return; }
        void getNavigationHub(this.app).navigate({ kind: "book", resourcePath: entry.bookPath, locate: { cfi: entry.cfiRange, flashStyle: "highlight", showLocateOverlay: true }, policy: { preferredLeaf: true, focus: true } });
        this.close();
      });
    }
  }
  onClose(): void { this.contentEl.empty(); }
}
