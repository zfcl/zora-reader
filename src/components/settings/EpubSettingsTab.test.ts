import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { EpubSettingsTab } from "./EpubSettingsTab";
import type StandaloneEpubPlugin from "../../main";
import {
  readIntegratedAIApiKey,
  writeIntegratedAIApiKey,
  clearIntegratedAIApiKey,
} from "../../config/integrated-ai-settings";

function createMockPlugin() {
  const secrets = new Map<string, string>();
  secrets.set("zora-reader-api-key", "sk-initial-key");

  const plugin = {
    app: {
      vault: {
        adapter: {
          exists: vi.fn().mockResolvedValue(false),
          read: vi.fn().mockResolvedValue(""),
          write: vi.fn().mockResolvedValue(undefined),
        },
        getAbstractFileByPath: vi.fn().mockReturnValue(null),
        getMarkdownFiles: vi.fn().mockReturnValue([]),
        getAllLoadedFiles: vi.fn().mockReturnValue([]),
        createFolder: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue(undefined),
      },
      workspace: {
        getActiveFile: vi.fn().mockReturnValue(null),
      },
      secretStorage: {
        getSecret: (id: string) => secrets.get(id) ?? null,
        setSecret: (id: string, val: string) => {
          secrets.set(id, val);
        },
        deleteSecret: (id: string) => {
          secrets.delete(id);
        },
      },
      plugins: {
        getPlugin: vi.fn().mockReturnValue(null),
        plugins: {},
      },
    } as unknown as App,
    manifest: {
      id: "zora-reader",
      name: "Zora Reader",
      version: "0.2.0",
    },
    settings: {
      interfaceLanguage: "zh-CN",
      bookmarkFolder: "Books/Bookmarks",
      selectionTranslation: {
        enabled: true,
        preferNativeDictionaryApp: false,
        smartRoutingEnabled: true,
        builtinProviders: {},
        customProviders: [],
      },
      aiAssistant: {
        enabled: true,
        apiKeySecretId: "zora-reader-api-key",
        endpoint: "https://api.deepseek.com/chat/completions",
        model: "deepseek-v4-flash",
        maxTokens: 2000,
        customPrompt: "",
      },
      enableDebugMode: false,
      sourceNavigationOpenInNewTab: true,
      continuousReadingPositionAutoSaveEnabled: true,
      continuousReadingPositionAutoSavePages: 5,
      vocabularyEntries: [],
    },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    getEpubStorageService: vi.fn().mockReturnValue({
      loadExcerptSettings: vi.fn().mockResolvedValue({}),
    }),
  } as unknown as StandaloneEpubPlugin;

  return { plugin, secrets };
}

describe("EpubSettingsTab", () => {
  it("renders settings tab with active default 'basic' panel synchronously", async () => {
    const { plugin } = createMockPlugin();
    const container = document.createElement("div");
    const tab = new EpubSettingsTab(plugin.app, plugin);
    (tab as any).containerEl = container;

    tab.display();

    expect(container.innerHTML).toContain("epub-settings-root");
    expect(container.innerHTML).toContain("基础");
    expect(container.innerHTML).toContain("AI 助手");
    expect(container.innerHTML).toContain("关于");
    expect(container.innerHTML).toContain("epub-settings-panel-basic");

    tab.hide();
    expect(container.innerHTML).toBe("");
  });

  it("handles AI settings API key reads and updates correctly", async () => {
    const { plugin, secrets } = createMockPlugin();

    // Verify initial read
    expect(readIntegratedAIApiKey(plugin.app, plugin.settings.aiAssistant)).toBe(
      "sk-initial-key"
    );

    // Verify write
    await writeIntegratedAIApiKey(
      plugin.app,
      plugin.settings.aiAssistant,
      "sk-new-api-key"
    );
    expect(readIntegratedAIApiKey(plugin.app, plugin.settings.aiAssistant)).toBe(
      "sk-new-api-key"
    );

    // Verify clear
    await clearIntegratedAIApiKey(plugin.app, plugin.settings.aiAssistant);
    expect(readIntegratedAIApiKey(plugin.app, plugin.settings.aiAssistant)).toBe(
      ""
    );
  });

  it("renders EpubAISettingsTab with full controls", async () => {
    const { plugin } = createMockPlugin();
    const container = document.createElement("div");
    const { mount, unmount } = await import("svelte");
    const { default: EpubAISettingsTab } = await import(
      "./EpubAISettingsTab.svelte"
    );

    const root = mount(EpubAISettingsTab, {
      target: container,
      props: { plugin },
    });

    // Wait for $effect
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(container.innerHTML).toContain("AI 助手与翻译设置");
    expect(container.innerHTML).toContain("API Key");
    expect(container.innerHTML).toContain("API Endpoint");
    expect(container.innerHTML).toContain("模型 (Model)");
    expect(container.innerHTML).toContain("Thinking 深度思考");
    expect(container.innerHTML).toContain("最大输出 Token");
    expect(container.innerHTML).toContain("自定义助手提示词");

    unmount(root);
  });

  it("renders EpubSettingsAboutTab with version and format info", async () => {
    const { plugin } = createMockPlugin();
    const container = document.createElement("div");
    const { mount, unmount } = await import("svelte");
    const { default: EpubSettingsAboutTab } = await import(
      "./EpubSettingsAboutTab.svelte"
    );

    const root = mount(EpubSettingsAboutTab, {
      target: container,
      props: { plugin },
    });

    expect(container.innerHTML).toContain("Zora Reader");
    expect(container.innerHTML).toContain("EPUB / MOBI / AZW3 / FB2 / FBZ / TXT / CBZ");

    unmount(root);
  });

  it("handles getSettingDefinitions render when passed an Obsidian Setting object", async () => {
    const { plugin } = createMockPlugin();
    const tab = new EpubSettingsTab(plugin.app, plugin);
    const hostEl = document.createElement("div");
    const mockSetting = {
      settingEl: hostEl,
      infoEl: document.createElement("div"),
      nameEl: document.createElement("div"),
      descEl: document.createElement("div"),
      controlEl: document.createElement("div"),
    };

    const defs = tab.getSettingDefinitions();
    expect(defs.length).toBe(1);
    defs[0].render(mockSetting as any);

    expect(hostEl.innerHTML).toContain("epub-settings-root");
    expect(hostEl.innerHTML).toContain("基础");
    expect(hostEl.innerHTML).toContain("AI 助手");
    expect(hostEl.innerHTML).toContain("关于");
  });

  it("updates DOM when adding custom translation provider", async () => {
    const { plugin } = createMockPlugin();
    const container = document.createElement("div");
    const { mount, unmount } = await import("svelte");
    const { default: EpubSettingsBasicTab } = await import(
      "./EpubSettingsBasicTab.svelte"
    );

    const root = mount(EpubSettingsBasicTab, {
      target: container,
      props: { plugin },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const addBtn = container.querySelector(".epub-custom-translation-panel__add") as HTMLButtonElement;
    expect(addBtn).not.toBeNull();
    expect(container.querySelectorAll(".epub-custom-translation-panel__row").length).toBe(0);

    addBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(plugin.settings.selectionTranslation.customProviders.length).toBe(1);
    expect(container.querySelectorAll(".epub-custom-translation-panel__row").length).toBe(1);

    unmount(root);
  });
});
