import { App, PluginSettingTab, Setting } from "obsidian";
import PandocFencedDivsPlugin from "./main";

export interface PandocFencedDivsPluginSettings {
	mySetting: string;
}

export const DEFAULT_SETTINGS: PandocFencedDivsPluginSettings = {
	mySetting: "default",
};

export class PandocFencedDivsPluginSettingTab extends PluginSettingTab {
	plugin: PandocFencedDivsPlugin;

	constructor(app: App, plugin: PandocFencedDivsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Settings #1")
			.setDesc("It's a secret")
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings.mySetting)
					.onChange(async (value) => {
						this.plugin.settings.mySetting = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
