import { type App, Platform, normalizePath } from "obsidian";

interface SanitizedLogPayload {
	timestamp: string;
	platform: string;
	category: string;
	event: string;
	details?: unknown;
	error?: {
		name?: string;
		message?: string;
		stack?: string;
	};
}

let activeApp: App | null = null;
let logPluginId = "zora-reader";
let logWriteQueue: Promise<void> = Promise.resolve();
const MAX_LOG_SIZE_BYTES = 500 * 1024; // 500 KB limit

/**
 * 敏感字段与长文本脱敏过滤
 */
function sanitizeValue(value: unknown, depth = 0): unknown {
	if (depth > 4) return "[MaxDepth]";
	if (value === null || value === undefined) return value;
	if (typeof value === "string") {
		// 脱敏 API Key / Token
		let text = value.replace(/(sk-[a-zA-Z0-9\-_]{8,})/g, "sk-***[REDACTED]");
		text = text.replace(/(Bearer\s+)[a-zA-Z0-9\-_.]+/gi, "$1***[REDACTED]");
		text = text.replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, "***@***.com");
		// 截断超长正文内容（避免记录整本书正文）
		if (text.length > 200) {
			return `${text.slice(0, 80)}...[truncated, total ${text.length} chars]`;
		}
		return text;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	if (value instanceof Error) {
		return {
			name: value.name,
			message: sanitizeValue(value.message, depth + 1),
			stack: value.stack ? String(sanitizeValue(value.stack.slice(0, 800), depth + 1)) : undefined,
		};
	}
	if (Array.isArray(value)) {
		return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
	}
	if (typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			const lowerKey = k.toLowerCase();
			if (
				lowerKey.includes("key") ||
				lowerKey.includes("token") ||
				lowerKey.includes("secret") ||
				lowerKey.includes("password") ||
				lowerKey.includes("auth")
			) {
				result[k] = "***[REDACTED]***";
			} else {
				result[k] = sanitizeValue(v, depth + 1);
			}
		}
		return result;
	}
	return String(value);
}

function resolvePlatformString(): string {
	if (Platform.isIosApp) return "iOS-App";
	if (Platform.isAndroidApp) return "Android-App";
	if (Platform.isMobile) return "Mobile-Web";
	if (Platform.isMacOS) return "macOS";
	if (Platform.isWin) return "Windows";
	if (Platform.isLinux) return "Linux";
	return "Unknown";
}

function getLogFilePath(): string {
	const configDir = activeApp?.vault.configDir || ".obsidian";
	return normalizePath(`${configDir}/plugins/${logPluginId}/mobile-debug.log`);
}

async function writeLogEntry(entry: SanitizedLogPayload): Promise<void> {
	if (!activeApp?.vault?.adapter) {
		return;
	}

	const adapter = activeApp.vault.adapter;
	const logPath = getLogFilePath();
	const line = `[${entry.timestamp}] [${entry.platform}] [${entry.category}] ${entry.event}${
		entry.details ? ` | ${JSON.stringify(entry.details)}` : ""
	}${entry.error ? ` | ERROR: ${JSON.stringify(entry.error)}` : ""}\n`;

	try {
		const exists = await adapter.exists(logPath);
		if (exists) {
			const stat = await adapter.stat(logPath);
			if (stat && stat.size > MAX_LOG_SIZE_BYTES) {
				// 文件超出上限时保留最近 100KB 内容
				try {
					const existing = await adapter.read(logPath);
					const truncated = existing.slice(-100 * 1024);
					const firstNewline = truncated.indexOf("\n");
					const cleanContent =
						firstNewline !== -1 ? truncated.slice(firstNewline + 1) : truncated;
					await adapter.write(
						logPath,
						`[${new Date().toISOString()}] [SYSTEM] --- Log rotated ---\n${cleanContent}${line}`
					);
					return;
				} catch {
					// fallback append
				}
			}
			await adapter.append(logPath, line);
		} else {
			await adapter.write(logPath, line);
		}
	} catch {
		// Safe failover, do not break application
	}
}

/**
 * 初始化移动端诊断系统
 */
export function initMobileDiagnostics(app: App, pluginId = "zora-reader"): void {
	activeApp = app;
	logPluginId = pluginId;

	logMobileEvent("Lifecycle", "PluginDiagnosticsInitialized", {
		platform: resolvePlatformString(),
		isMobile: Platform.isMobile,
		isIosApp: Platform.isIosApp,
		userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "N/A",
	});

	if (Platform.isMobile && typeof window !== "undefined") {
		window.addEventListener("error", (event) => {
			logMobileError("RuntimeWindowError", event.error || event.message, {
				filename: event.filename,
				lineno: event.lineno,
				colno: event.colno,
			});
		});

		window.addEventListener("unhandledrejection", (event) => {
			logMobileError("UnhandledPromiseRejection", event.reason);
		});
	}
}

/**
 * 记录移动端关键事件
 */
export function logMobileEvent(
	category: string,
	event: string,
	details?: Record<string, unknown>
): void {
	const payload: SanitizedLogPayload = {
		timestamp: new Date().toISOString(),
		platform: resolvePlatformString(),
		category,
		event,
		details: details ? sanitizeValue(details) : undefined,
	};

	logWriteQueue = logWriteQueue.then(() => writeLogEntry(payload)).catch(() => {});
}

/**
 * 记录移动端错误
 */
export function logMobileError(
	category: string,
	error: unknown,
	context?: Record<string, unknown>
): void {
	let errorObj: SanitizedLogPayload["error"];
	if (error instanceof Error) {
		errorObj = {
			name: error.name,
			message: String(sanitizeValue(error.message)),
			stack: error.stack ? String(sanitizeValue(error.stack.slice(0, 800))) : undefined,
		};
	} else {
		errorObj = {
			message: String(sanitizeValue(error)),
		};
	}

	const payload: SanitizedLogPayload = {
		timestamp: new Date().toISOString(),
		platform: resolvePlatformString(),
		category,
		event: "ERROR",
		details: context ? sanitizeValue(context) : undefined,
		error: errorObj,
	};

	logWriteQueue = logWriteQueue.then(() => writeLogEntry(payload)).catch(() => {});
}

/**
 * 轻量移动端跨设备同步诊断日志 (Mobile Sync Debug)
 * 严格脱敏：不记录 API Key、完整正文、笔记正文
 */
export async function logMobileSyncDebug(input: {
	app: App;
	bookId?: string;
	sourceId?: string;
	filePath?: string;
	readingPositionCfi?: string;
	directHighlightsCount?: number;
	readingNoteMarkerCount?: number;
	selectionRangeCount?: number;
	selectionCollapsed?: boolean;
}): Promise<void> {
	const configDir = input.app?.vault.configDir || ".obsidian";
	const statePath = normalizePath(`${configDir}/plugins/${logPluginId}/state/epub-local-state.json`);
	let stateFileExists = false;
	try {
		stateFileExists = await input.app.vault.adapter.exists(statePath);
	} catch {
		stateFileExists = false;
	}

	logMobileEvent("MobileSyncDebug", "StateAudit", {
		platform: resolvePlatformString(),
		bookStableId: input.sourceId || input.bookId || "N/A",
		vaultRelativeBookPath: input.filePath || "N/A",
		stateFileExists,
		readingPositionRead: Boolean(input.readingPositionCfi),
		directHighlightsCount: input.directHighlightsCount ?? 0,
		readingNoteMarkerCount: input.readingNoteMarkerCount ?? 0,
		lastUpdatedTime: Date.now(),
		selectionRangeCount: input.selectionRangeCount ?? 0,
		selectionCollapsed: input.selectionCollapsed ?? true,
	});
}
