export interface ReaderWindowHost {
  ownerDocument?: Document | null;
}

/**
 * 优先使用承载阅读器的 DOM 窗口，以支持 Obsidian 弹出窗口。
 * Prefer the reader host's DOM window so Obsidian popout windows receive events.
 */
export function getReaderWindow(host: ReaderWindowHost | null, fallbackWindow: Window): Window {
  return host?.ownerDocument?.defaultView ?? fallbackWindow;
}

/**
 * 返回承载阅读器的文档，以便监听实际窗口的主题和 iframe 变化。
 * Returns the reader host document so theme and iframe changes are observed in the actual window.
 */
export function getReaderDocument(host: ReaderWindowHost | null, fallbackDocument: Document): Document {
  return host?.ownerDocument ?? fallbackDocument;
}
