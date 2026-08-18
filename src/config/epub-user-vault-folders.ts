/**
 * EPUB 阅读器用户可见 Vault 目录的初始默认值（仅用于首次安装 / 设置未配置时的回退）。
 * 运行时业务逻辑应通过 plugin.settings 与 excerptSettings 读取用户配置，
 * 勿在其它模块重复硬编码路径字符串。
 */
export const DEFAULT_EPUB_BOOKMARK_FOLDER = "Zora Reader";

export const DEFAULT_BOOK_NOTES_EXPORT_TEMPLATE_FOLDER = "Zora Reader/Export templates";
