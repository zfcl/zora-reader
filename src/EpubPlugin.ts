import { addIcon, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, EpubPluginSettings, EpubSettingTab } from './EpubPluginSettings';
import { EPUB_FILE_EXTENSION, EpubView, ICON_EPUB, VIEW_TYPE_EPUB } from './EpubView';
import { refreshEpubViews } from './readerBackground';
import { ReviewView, VIEW_TYPE_REVIEW } from './ReviewView';
import { deepenSelection, translateSelection, type SelectionCapture, type TranslationConfig } from './translation';
import { saveCapture, type CaptureDraft } from './notes';

export default class EpubPlugin extends Plugin {
  settings: EpubPluginSettings = { ...DEFAULT_SETTINGS, bookLocations: {} };

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.migrateLegacyReader();

    addIcon(ICON_EPUB, '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M4.5 5.5c3-1.2 5.5-.8 7.5 1.1v12c-2-1.9-4.5-2.3-7.5-1.1zm15 0c-3-1.2-5.5-.8-7.5 1.1v12c2-1.9 4.5-2.3 7.5-1.1z"/>');
    this.registerView(VIEW_TYPE_EPUB, (leaf: WorkspaceLeaf) => new EpubView(leaf, this));
    this.registerView(VIEW_TYPE_REVIEW, (leaf: WorkspaceLeaf) => new ReviewView(leaf, this));
    try { this.registerExtensions([EPUB_FILE_EXTENSION], VIEW_TYPE_EPUB); } catch { /* old reader may still be enabled */ }
    this.addSettingTab(new EpubSettingTab(this.app, this));
    this.addRibbonIcon('book-open-text', 'Zora Reader 今日复习', () => void this.openReview());
    this.addCommand({ id: 'open-review', name: '打开今日复习', callback: () => void this.openReview() });
    this.registerObsidianProtocolHandler('zora-reader', (parameters) => void this.openBookAt(parameters.book, parameters.cfi));
  }

  async translate(capture: SelectionCapture) {
    return translateSelection(this.translationConfig(), capture);
  }

  async deepen(capture: SelectionCapture): Promise<string> { return deepenSelection(this.translationConfig(), capture); }

  async save(book: TFile, capture: SelectionCapture, result: Awaited<ReturnType<EpubPlugin['translate']>>, draft: CaptureDraft) {
    return saveCapture(this.app, this.settings, book, capture, result, draft);
  }

  async rememberLocation(bookPath: string, location: string | number): Promise<void> {
    this.settings.bookLocations[bookPath] = location;
    await this.saveSettings();
  }

  async rememberFontScale(fontScale: number): Promise<void> {
    this.settings.fontScale = fontScale;
    await this.saveSettings();
  }

  async openReview(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_REVIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_REVIEW, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  private async openBookAt(bookPath = '', cfi = ''): Promise<void> {
    const file = this.app.vault.getFileByPath(bookPath);
    if (!file || file.extension !== EPUB_FILE_EXTENSION || !cfi) return;
    this.settings.bookLocations[file.path] = cfi;
    await this.saveSettings();
    await this.app.workspace.getLeaf(true).openFile(file, { active: true });
  }

  async refreshEpubViews(): Promise<void> {
    const views: Array<{ file: TFile; onLoadFile(file: TFile): Promise<void> }> = [];
    this.app.workspace.getLeavesOfType(VIEW_TYPE_EPUB).forEach((leaf) => {
      if (leaf.view instanceof EpubView && leaf.view.file) views.push({ file: leaf.view.file, onLoadFile: (file) => (leaf.view as EpubView).onLoadFile(file) });
    });
    await refreshEpubViews(views);
  }

  async loadSettings(): Promise<void> {
    const stored: unknown = await this.loadData();
    const saved = isRecord(stored) ? stored : {};
    this.settings = { ...DEFAULT_SETTINGS, ...saved, bookLocations: isRecord(saved.bookLocations) ? saved.bookLocations as Record<string, string | number> : {} };
  }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  private translationConfig(): TranslationConfig {
    return {
      apiKey: this.app.secretStorage.getSecret(this.settings.apiSecretId) ?? '',
      baseUrl: this.settings.apiBaseUrl,
      model: this.settings.apiModel,
      sourceLanguage: this.settings.sourceLanguage,
      targetLanguage: this.settings.targetLanguage,
    };
  }

  private async migrateLegacyReader(): Promise<void> {
    if (this.settings.legacyMigrationDone) return;
    try {
      const raw = await this.app.vault.adapter.read(`${this.app.vault.configDir}/plugins/epub-reader-highlighter/data.json`);
      const legacy: unknown = JSON.parse(raw);
      if (isRecord(legacy) && isRecord(legacy.books)) {
        Object.entries(legacy.books).forEach(([path, record]) => {
          if (isRecord(record) && (typeof record.lastCfi === 'string' || typeof record.lastCfi === 'number')) this.settings.bookLocations[path] = record.lastCfi;
        });
      }
      if (isRecord(legacy) && isRecord(legacy.prefs) && typeof legacy.prefs.fontSize === 'number') {
        this.settings.fontScale = Math.max(80, Math.min(160, Math.round(legacy.prefs.fontSize * 5.6)));
      }
    } catch { /* no legacy plugin data */ }
    this.settings.legacyMigrationDone = true;
    await this.saveSettings();
    new Notice('Zora Reader 已准备好。旧阅读器数据保持不变。', 3500);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
