import { ItemView, TFile, WorkspaceLeaf } from 'obsidian';
import EpubPlugin from './EpubPlugin';
import { nextReview, type ReviewRating } from './review';

export const VIEW_TYPE_REVIEW = 'zora-reader-review';

export class ReviewView extends ItemView {
  private due: TFile[] = [];
  private index = 0;
  private revealed = false;

  constructor(leaf: WorkspaceLeaf, private plugin: EpubPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_REVIEW; }
  getDisplayText(): string { return '今日复习'; }
  getIcon(): string { return 'brain'; }

  async onOpen(): Promise<void> { await this.reload(); }

  private async reload(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const prefix = `${this.plugin.settings.captureFolder}/`;
    const candidates = this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(prefix));
    const due: TFile[] = [];
    for (const file of candidates) {
      const cache = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (cache?.zora_reader === true && cache.review === true && (!cache.due || String(cache.due) <= today)) due.push(file);
    }
    this.due = due;
    this.index = 0;
    this.revealed = false;
    await this.render();
  }

  private async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass('zora-review');
    container.createDiv({ cls: 'zora-review-eyebrow', text: 'TODAY' });
    container.createEl('h2', { text: '今日复习' });
    if (this.index >= this.due.length) {
      container.createDiv({ cls: 'zora-review-complete', text: this.due.length ? '今天完成了。' : '今天没有到期内容。' });
      return;
    }

    const file = this.due[this.index];
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    container.createDiv({ cls: 'zora-review-count', text: `${this.index + 1} / ${this.due.length}` });
    const card = container.createDiv({ cls: 'zora-review-card' });
    card.createEl('h3', { text: String(frontmatter.source || frontmatter.lemma || file.basename) });
    const content = await this.app.vault.cachedRead(file);
    const context = content.match(/## 语境[^\n]*\n\n(?:<!--[^>]+-->\n)?(?:> )?([^\n]+)/)?.[1];
    if (context) card.createEl('blockquote', { text: context });

    if (!this.revealed) {
      const reveal = card.createEl('button', { cls: 'mod-cta zora-review-reveal', text: '显示答案' });
      reveal.addEventListener('click', () => { this.revealed = true; void this.render(); });
      return;
    }

    const answer = content.match(/\*\*语境义\*\*：([^\n]+)/)?.[1] ?? content.match(/## 翻译\n\n([^\n]+)/)?.[1] ?? '';
    card.createDiv({ cls: 'zora-review-answer', text: answer });
    const actions = card.createDiv({ cls: 'zora-review-actions' });
    ([['again', '忘记'], ['hard', '困难'], ['good', '记得']] as const).forEach(([rating, label]) => {
      const button = actions.createEl('button', { text: label });
      button.addEventListener('click', () => void this.rate(file, rating));
    });
  }

  private async rate(file: TFile, rating: ReviewRating): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const update = nextReview({ interval: Number(cache.interval) || 0, ease: Number(cache.ease) || 2.5, lapses: Number(cache.lapses) || 0 }, rating);
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => Object.assign(frontmatter, update, { updated: new Date().toISOString() }));
    this.index += 1;
    this.revealed = false;
    await this.render();
  }
}
