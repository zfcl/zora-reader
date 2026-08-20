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
		this.containerEl.empty();
	}

	private unmountPanel(): void {
		if (!this.svelteRoot) {
			return;
		}
		void unmount(this.svelteRoot);
		this.svelteRoot = null;
	}

	private renderPanelInto(containerEl: HTMLElement): void {
		this.unmountPanel();

		containerEl.empty();

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
