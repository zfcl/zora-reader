import { Platform } from "obsidian";
import { generateCardUUID } from "../identifier/WeaveIDGenerator";

const SYNC_DEVICE_ID_STORAGE_KEY = "zora-sync-device-id";

let cachedDeviceId: string | null = null;

function resolvePlatformPrefix(): string {
	if (Platform.isIosApp || (Platform.isMobile && Platform.isSafari)) {
		return "ios";
	}
	if (Platform.isAndroidApp) {
		return "android";
	}
	if (Platform.isMacOS) {
		return "macos";
	}
	if (Platform.isWin) {
		return "windows";
	}
	if (Platform.isLinux) {
		return "linux";
	}
	return Platform.isMobile ? "mobile" : "desktop";
}

/**
 * Gets or creates a stable, local device ID for this Obsidian installation.
 * The device ID is persistent on this device and formatted as `<platform>-<uuid>`.
 */
export function getOrCreateSyncDeviceId(): string {
	if (cachedDeviceId) {
		return cachedDeviceId;
	}

	try {
		if (typeof window !== "undefined" && window.localStorage) {
			const saved = window.localStorage.getItem(SYNC_DEVICE_ID_STORAGE_KEY);
			if (saved && saved.trim()) {
				cachedDeviceId = saved.trim();
				return cachedDeviceId;
			}
		}
	} catch {
		/* ignore localStorage access errors */
	}

	const prefix = resolvePlatformPrefix();
	const randomPart = generateCardUUID().replace(/-/g, "").slice(0, 16);
	const newDeviceId = `${prefix}-${randomPart}`;

	try {
		if (typeof window !== "undefined" && window.localStorage) {
			window.localStorage.setItem(SYNC_DEVICE_ID_STORAGE_KEY, newDeviceId);
		}
	} catch {
		/* ignore */
	}

	cachedDeviceId = newDeviceId;
	return cachedDeviceId;
}

/**
 * For testing purposes: allows resetting the cached device ID.
 */
export function setCachedSyncDeviceIdForTest(id: string | null): void {
	cachedDeviceId = id;
}
