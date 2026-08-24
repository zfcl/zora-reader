import type { App } from "obsidian";
import { ZoraSyncService } from "./ZoraSyncService";

const syncServiceInstances = new WeakMap<App, ZoraSyncService>();

export function getZoraSyncService(app: App): ZoraSyncService {
	let instance = syncServiceInstances.get(app);
	if (!instance) {
		instance = new ZoraSyncService(app);
		void instance.init();
		syncServiceInstances.set(app, instance);
	}
	return instance;
}

export function setZoraSyncServiceForTest(app: App, service: ZoraSyncService | null): void {
	if (service) {
		syncServiceInstances.set(app, service);
	} else {
		syncServiceInstances.delete(app);
	}
}
