export type ReaderBackgroundMode = 'paper' | 'night' | 'contrast';

export interface ReaderColors {
  background: string;
  text: string;
}

export interface ReaderThemeRules {
  html: { background: string };
  body: { background: string; color: string };
}

export interface ReloadableEpubView<TFile> {
  file: TFile;
  onLoadFile(file: TFile): Promise<void>;
}

/**
 * 根据用户背景设置和 Obsidian 主题变量解析阅读器颜色。
 * Resolves reader colors from the user background setting and Obsidian theme variables.
 */
export function resolveReaderColors(
  mode: ReaderBackgroundMode,
  _customBackground: string,
  _themeBackground: string,
  _themeText: string,
): ReaderColors {
  if (mode === 'night') return { background: '#17191d', text: '#e9e7e2' };
  if (mode === 'contrast') return { background: '#ffffff', text: '#111111' };
  return { background: '#f6f1e7', text: '#262522' };
}

/**
 * 将主题颜色限制为文档基础规则，使 EPUB 元素自身的颜色声明保持优先。
 * Limits theme colors to document base rules so EPUB element color declarations keep precedence.
 */
export function getReaderThemeRules(colors: ReaderColors): ReaderThemeRules {
  return {
    html: { background: colors.background },
    body: { background: colors.background, color: colors.text },
  };
}

/**
 * 重载所有已打开的 EPUB View，使设置立即生效。
 * Reloads every open EPUB View so the updated setting takes effect immediately.
 */
export async function refreshEpubViews<TFile>(views: Array<ReloadableEpubView<TFile>>): Promise<void> {
  await Promise.all(views.map((view) => view.onLoadFile(view.file)));
}
