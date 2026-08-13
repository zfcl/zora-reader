import { App, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import EpubPlugin from './EpubPlugin';
import type { ReaderBackgroundMode } from './readerBackground';

export interface EpubPluginSettings {
  scrolledView: boolean;
  mouseWheelPageTurn: boolean;
  readerBackgroundMode: ReaderBackgroundMode;
  readerBackgroundColor: string;
  fontScale: number;
  apiBaseUrl: string;
  apiModel: string;
  apiSecretId: string;
  sourceLanguage: string;
  targetLanguage: string;
  captureFolder: string;
  bookNoteFolder: string;
  bookLocations: Record<string, string | number>;
  legacyMigrationDone: boolean;
}

export const DEFAULT_SETTINGS: EpubPluginSettings = {
  scrolledView: false,
  mouseWheelPageTurn: true,
  readerBackgroundMode: 'paper',
  readerBackgroundColor: '#f6f1e7',
  fontScale: 112,
  apiBaseUrl: 'https://api.deepseek.com',
  apiModel: 'deepseek-v4-flash',
  apiSecretId: '',
  sourceLanguage: '自动识别',
  targetLanguage: '简体中文',
  captureFolder: 'Books/Highlights',
  bookNoteFolder: 'Books/Notes',
  bookLocations: {},
  legacyMigrationDone: false,
};

export class EpubSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: EpubPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('zora-settings');
    containerEl.createEl('h1', { text: 'Zora Reader' });
    containerEl.createEl('p', { cls: 'zora-settings-intro', text: '阅读、翻译与复习。' });

    this.heading('翻译服务');
    new Setting(containerEl)
      .setName('服务地址')
      .setDesc('OpenAI 兼容 API 的基础地址。')
      .addText((text) => text.setPlaceholder('https://api.deepseek.com').setValue(this.plugin.settings.apiBaseUrl).onChange((value) => this.save('apiBaseUrl', value.trim())));
    new Setting(containerEl)
      .setName('模型')
      .addText((text) => text.setValue(this.plugin.settings.apiModel).onChange((value) => this.save('apiModel', value.trim())));
    new Setting(containerEl)
      .setName('API 密钥')
      .setDesc('由 Obsidian SecretStorage 保存在本机；笔记和插件配置只记录密钥名称。')
      .addComponent((element) => new SecretComponent(this.app, element)
        .setValue(this.plugin.settings.apiSecretId)
        .onChange((value) => this.save('apiSecretId', value)));
    new Setting(containerEl)
      .setName('原文语言')
      .addText((text) => text.setValue(this.plugin.settings.sourceLanguage).onChange((value) => this.save('sourceLanguage', value.trim())));
    new Setting(containerEl)
      .setName('译文语言')
      .addText((text) => text.setValue(this.plugin.settings.targetLanguage).onChange((value) => this.save('targetLanguage', value.trim())));

    this.heading('阅读');
    new Setting(containerEl)
      .setName('默认阅读主题')
      .setDesc('三个完整设计的主题，不跟随外部主题拼接。')
      .addDropdown((dropdown) => dropdown
        .addOptions({ paper: '纸张', night: '夜间', contrast: '高对比' })
        .setValue(this.plugin.settings.readerBackgroundMode)
        .onChange(async (value) => {
          await this.save('readerBackgroundMode', value as ReaderBackgroundMode);
          await this.plugin.refreshEpubViews();
        }));
    new Setting(containerEl)
      .setName('滚动阅读')
      .setDesc('关闭时使用分页阅读。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.scrolledView).onChange(async (value) => {
        await this.save('scrolledView', value);
        await this.plugin.refreshEpubViews();
      }));
    new Setting(containerEl)
      .setName('分页时滚轮翻页')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.mouseWheelPageTurn).onChange((value) => this.save('mouseWheelPageTurn', value)));

    this.heading('笔记');
    new Setting(containerEl)
      .setName('原子摘录目录')
      .setDesc('单词、短语和段落笔记写入这里。')
      .addText((text) => text.setValue(this.plugin.settings.captureFolder).onChange((value) => this.save('captureFolder', value.trim())));
    new Setting(containerEl)
      .setName('书籍主笔记目录')
      .addText((text) => text.setValue(this.plugin.settings.bookNoteFolder).onChange((value) => this.save('bookNoteFolder', value.trim())));
  }

  private heading(text: string): void {
    new Setting(this.containerEl).setName(text).setHeading();
  }

  private async save<K extends keyof EpubPluginSettings>(key: K, value: EpubPluginSettings[K]): Promise<void> {
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings();
  }
}
