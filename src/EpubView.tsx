import { FileView, Menu, TFile, WorkspaceLeaf } from 'obsidian';
import * as React from 'react';
import { render } from 'preact';
import EpubPlugin from './EpubPlugin';
import { EpubReader } from './EpubReader';

export const EPUB_FILE_EXTENSION = 'epub';
export const VIEW_TYPE_EPUB = 'zora-reader-epub';
export const ICON_EPUB = 'zora-book';

export class EpubView extends FileView {
  allowNoFile: false;
  constructor(leaf: WorkspaceLeaf, private plugin: EpubPlugin) { super(leaf); }

  onPaneMenu(menu: Menu, source: string): void {
    menu.addItem((item) => item.setTitle('打开书籍笔记').setIcon('notebook-pen').onClick(() => void this.openBookNote()));
    menu.addSeparator();
    super.onPaneMenu(menu, source);
  }

  async onLoadFile(file: TFile): Promise<void> {
    render(null, this.contentEl);
    this.contentEl.empty();
    this.contentEl.addClass('zora-reader-view');
    const contents = await this.app.vault.readBinary(file);
    render(<EpubReader
      book={file}
      contents={contents}
      settings={this.plugin.settings}
      initialLocation={this.plugin.settings.bookLocations[file.path] ?? 0}
      onLocationChanged={(location) => void this.plugin.rememberLocation(file.path, location)}
      onTranslate={(capture) => this.plugin.translate(capture)}
      onDeepen={(capture) => this.plugin.deepen(capture)}
      onFontScaleChanged={(fontScale) => void this.plugin.rememberFontScale(fontScale)}
      onSave={(capture, result, draft) => this.plugin.save(file, capture, result, draft)}
      onOpenNote={(path) => void this.app.workspace.openLinkText(path, file.path, true)} />,
    this.contentEl);
  }

  onunload(): void { render(null, this.contentEl); }
  getDisplayText(): string { return this.file?.basename ?? 'EPUB'; }
  canAcceptExtension(extension: string): boolean { return extension === EPUB_FILE_EXTENSION; }
  getViewType(): string { return VIEW_TYPE_EPUB; }
  getIcon(): string { return ICON_EPUB; }

  private async openBookNote(): Promise<void> {
    if (!this.file) return;
    const path = `${this.plugin.settings.bookNoteFolder}/${this.file.basename}.md`;
    const file = this.app.vault.getFileByPath(path);
    if (file) await this.app.workspace.getLeaf('split').openFile(file);
  }
}
