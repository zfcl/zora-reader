import { App, PluginSettingTab } from "obsidian";
import { mount, unmount, type Component as SvelteComponent } from "svelte";
import type StandaloneEpubPlugin from "../../main";
import EpubSettingsPanel from "./EpubSettingsPanel.svelte";

export class EpubSettingsTab extends PluginSettingTab {
	plugin: StandaloneEpubPlugin;
	private svelteRoot: ReturnType<typeof mount> | null = null;

	constructor(app: App, plugin: StandaloneEpubPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions() {
		return [
			{
				type: "render" as const,
				render: (containerEl: HTMLElement) => {
					this.renderPanelInto(containerEl);
				},
			},
		];
	}

	display(): void {
		this.renderPanelInto(this.containerEl);
	}

	hide(): void {
		this.unmountPanel();
		if (typeof this.containerEl?.empty === "function") {
			this.containerEl.empty();
		} else if (typeof this.containerEl?.replaceChildren === "function") {
			this.containerEl.replaceChildren();
		}
	}

	private unmountPanel(): void {
		if (!this.svelteRoot) {
			return;
		}
		void unmount(this.svelteRoot);
		this.svelteRoot = null;
	}

	private renderPanelInto(rawContainerEl: HTMLElement | { settingEl?: HTMLElement }): void {
		this.unmountPanel();

		const containerEl =
			rawContainerEl && "settingEl" in rawContainerEl && rawContainerEl.settingEl
				? rawContainerEl.settingEl
				: (rawContainerEl as HTMLElement);
		if (!containerEl) return;

		if (typeof containerEl?.empty === "function") {
			containerEl.empty();
		} else if (typeof containerEl?.replaceChildren === "function") {
			containerEl.replaceChildren();
		}

		try {
			this.svelteRoot = mount(EpubSettingsPanel as SvelteComponent, {
				target: containerEl,
				props: {
					plugin: this.plugin,
				},
			});
		} catch (error) {
			console.error("[ZoraReader] Failed to mount settings panel:", error);
		}
	}
}
