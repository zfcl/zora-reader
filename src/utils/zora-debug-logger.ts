function formatData(data: any): string {
  if (data === undefined) return "";
  if (data === null) return "null";
  if (data instanceof Error) {
    return JSON.stringify({
      name: data.name,
      message: data.message,
      stack: data.stack,
    });
  }
  if (typeof data === "object") {
    try {
      const seen = new WeakSet();
      return JSON.stringify(data, (key, value) => {
        if (value instanceof Error) {
          return { name: value.name, message: value.message, stack: value.stack };
        }
        if (typeof value === "object" && value !== null) {
          if (typeof HTMLElement !== "undefined" && value instanceof HTMLElement) {
            return {
              tag: value.tagName,
              class: value.className,
              id: value.id,
              connected: value.isConnected,
              children: value.childElementCount,
            };
          }
          if (seen.has(value)) {
            return "[Circular]";
          }
          seen.add(value);
        }
        return value;
      });
    } catch (e) {
      return String(data);
    }
  }
  return String(data);
}

export function logZoraSettings(msg: string, data?: any): void {
  try {
    const formattedData = data !== undefined ? ` | ${formatData(data)}` : "";
    const logLine = `[${new Date().toISOString()}] [Zora Settings] ${msg}${formattedData}`;
    
    // 1. Console log
    console.log("[Zora Settings]", msg, data !== undefined ? data : "");

    // 2. Append to log file in Vault plugin dir (if Node fs is available in Electron)
    if (typeof require !== "undefined") {
      try {
        const fs = require("fs");
        const logPath = "C:\\Users\\xxzfc\\OneDrive\\应用\\remotely-save\\English Reading Vault\\.obsidian\\plugins\\zora-reader\\zora-debug.log";
        fs.appendFileSync(logPath, logLine + "\n");
      } catch (fsErr) {
        // ignore fs error
      }
    }
  } catch (e) {
    console.error("[Zora Settings Logger Error]", e);
  }
}
