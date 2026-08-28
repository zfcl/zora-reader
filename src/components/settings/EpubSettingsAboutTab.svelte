<script lang="ts">
  import { CURRENT_PLUGIN_DISPLAY_VERSION, CURRENT_PLUGIN_NAME } from "../../config/plugin-runtime";
  import { t } from "../../utils/i18n";
  import type StandaloneEpubPlugin from "../../main";

  interface Props {
    plugin: StandaloneEpubPlugin;
  }

  let { plugin }: Props = $props();

  const supportedFormats = ["EPUB", "MOBI", "AZW3", "FB2", "FBZ", "TXT", "CBZ"];

  let contactItems = $derived.by(() => [
    {
      label: t("epub.settings.contact.email"),
      href: "mailto:tutaoyuan8@outlook.com?subject=Zora%20Reader%20%E5%8F%8D%E9%A6%88",
    },
    {
      label: t("epub.settings.contact.docs"),
      href: "https://iwi05cktlph.feishu.cn/wiki/XFAqwL7YFilPPvkk4Ftcqh9Jn91",
    },
    {
      label: t("epub.settings.contact.changelog"),
      href: "https://github.com/HarrySuen626/weave-epub-ai-reader",
    },
    {
      label: t("epub.settings.contact.community"),
      href: "https://qm.qq.com/q/p1aphfMroQ",
    },
  ]);

  let pluginDisplayName = $derived.by(() => plugin.manifest?.name ?? CURRENT_PLUGIN_NAME);

  let pluginDisplayVersion = $derived.by(() =>
    plugin.manifest?.version ? `v${plugin.manifest.version}` : CURRENT_PLUGIN_DISPLAY_VERSION
  );

  let aboutOverviewItems = $derived.by(() => [
    {
      label: t("epub.settings.about.supportedFormats"),
      value: supportedFormats.join(" / "),
    },
    {
      label: t("epub.settings.about.overview"),
      value: t("epub.settings.about.overviewValue"),
    },
  ]);
</script>

<section class="epub-settings-section epub-settings-section--about">
  <div class="epub-settings-group">
    <div class="epub-settings-group-header">
      <h3 class="epub-settings-group-title with-accent-bar accent-cyan">{t("epub.settings.about.panelTitle")}</h3>
      <p class="epub-settings-group-description">{t("epub.settings.about.panelDescription")}</p>
    </div>

    <div class="epub-about-overview-list">
      <div class="epub-about-overview-section-label">{t("epub.settings.about.pluginInfo")}</div>
      <div class="epub-about-overview-item">
        <div class="epub-about-overview-label">{t("epub.settings.about.pluginName")}</div>
        <div class="epub-about-overview-value">{pluginDisplayName}</div>
      </div>
      <div class="epub-about-overview-item">
        <div class="epub-about-overview-label">{t("epub.settings.about.version")}</div>
        <div class="epub-about-overview-value">{pluginDisplayVersion}</div>
      </div>
      <div class="epub-about-overview-item">
        <div class="epub-about-overview-label">{t("epub.settings.about.series")}</div>
        <div class="epub-about-overview-value">{t("epub.settings.about.seriesValue")}</div>
      </div>
      <div class="epub-about-overview-item">
        <div class="epub-about-overview-label">{t("epub.settings.about.platform")}</div>
        <div class="epub-about-overview-value">{t("epub.settings.about.platformValue")}</div>
      </div>
      <div class="epub-about-overview-item">
        <div class="epub-about-overview-label">{t("epub.settings.about.licensedDevices")}</div>
        <div class="epub-about-overview-value">{t("epub.settings.about.licensedDevicesValue")}</div>
      </div>

      <div class="epub-about-overview-section-label epub-about-overview-section-label--separated">
        {t("epub.settings.about.readingOverview")}
      </div>
      {#each aboutOverviewItems as item}
        <div class="epub-about-overview-item">
          <div class="epub-about-overview-label">{item.label}</div>
          <div class="epub-about-overview-value">{item.value}</div>
        </div>
      {/each}
    </div>
  </div>

  <div class="epub-settings-group epub-settings-group--panel">
    <div class="epub-settings-group-header">
      <h3 class="epub-settings-group-title with-accent-bar accent-purple">{t("epub.settings.about.contactTitle")}</h3>
    </div>

    <div class="epub-about-links">
      {#each contactItems as item}
        <a
          class="epub-about-link"
          href={item.href}
          target={item.href.startsWith("http") ? "_blank" : undefined}
          rel={item.href.startsWith("http") ? "noopener noreferrer" : undefined}
        >
          {item.label}
        </a>
      {/each}
    </div>
  </div>
</section>
