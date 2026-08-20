<script lang="ts">
  import type StandaloneEpubPlugin from "../../main";
  import type { EpubSettingsTabId } from "./epub-settings-types";
  import EpubSettingsBasicTab from "./EpubSettingsBasicTab.svelte";
  import EpubAISettingsTab from "./EpubAISettingsTab.svelte";
  import EpubSettingsAboutTab from "./EpubSettingsAboutTab.svelte";
  import "../../styles/epub/epub-settings-panel.css";
  import { logZoraSettings } from "../../utils/zora-debug-logger";

  interface Props {
    plugin: StandaloneEpubPlugin;
  }

  let { plugin }: Props = $props();
  let activeTab = $state<EpubSettingsTabId>("basic");

  logZoraSettings("EpubSettingsPanel script evaluated", { activeTab });

  const tabs: Array<{ id: EpubSettingsTabId; label: string }> = [
    { id: "basic", label: "基础" },
    { id: "ai", label: "AI 助手" },
    { id: "about", label: "关于" },
  ];

  function switchTab(tabId: EpubSettingsTabId): void {
    logZoraSettings("EpubSettingsPanel switchTab called", { from: activeTab, to: tabId });
    activeTab = tabId;
  }

  $effect(() => {
    logZoraSettings("EpubSettingsPanel $effect running", { activeTab });
  });
</script>

<div class="epub-settings-root">
  <div class="epub-settings-tabs">
    <div class="tab-navigation tab-navigation--plain" role="tablist" tabindex="0">
      {#each tabs as tab}
        <button
          class="tab-button"
          class:active={activeTab === tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          tabindex={activeTab === tab.id ? 0 : -1}
          onclick={() => switchTab(tab.id)}
        >
          <span class="tab-label">{tab.label}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="epub-settings-tab-panel" id={`epub-settings-panel-${activeTab}`}>
    {#if activeTab === "basic"}
      <EpubSettingsBasicTab {plugin} />
    {/if}

    {#if activeTab === "ai"}
      <EpubAISettingsTab {plugin} />
    {/if}

    {#if activeTab === "about"}
      <EpubSettingsAboutTab {plugin} />
    {/if}
  </div>
</div>
