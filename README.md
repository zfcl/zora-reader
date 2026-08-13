# Zora Reader

在 Obsidian 内阅读 EPUB、翻译选区，并把值得保留的内容整理成可复习的 Markdown 笔记。

## 功能

- 桌面端选中即翻译；iPhone/iPad 选中后点“翻译”，减少误触和 API 消耗。
- 单词显示当前语境、所在句翻译和全部能够可靠确认的释义，不设人为数量上限。
- 短语与段落输出一份忠实、自然的译文。
- 桌面翻译卡片可拖动并按书记住位置；移动端使用安全区域内的底部面板。
- 收藏写入普通 Markdown；单词、短语和段落分别保存并嵌入书籍主笔记。
- 单词默认加入“今日复习”，状态保存在 frontmatter，可随 Vault 同步。
- EPUB CFI 保存阅读位置和原文定位。
- 纸张、夜间、高对比三套完整阅读主题。

## 安装

下载同一版本 Release 中的 `main.js`、`manifest.json`、`styles.css`，放入：

```text
<Vault>/.obsidian/plugins/zora-reader/
```

重启 Obsidian，在“第三方插件”中启用 **Zora Reader**。不要同时启用其他接管 `.epub` 的阅读器。

## 翻译设置

插件使用 OpenAI 兼容 API。默认地址为 `https://api.deepseek.com`，模型为 `deepseek-v4-flash`。API 密钥通过 Obsidian SecretStorage 选择或创建，密钥不会写入 Markdown、仓库或 `data.json`。每次翻译请求只包含系统规则和当前选区/语境，不保留聊天历史。

## 笔记目录

```text
Books/Notes/<书名>.md
Books/Highlights/<书名>/Words/<规范词>.md
Books/Highlights/<书名>/Phrases/<ID>.md
Books/Highlights/<书名>/Passages/<ID>.md
```

同一本书的同一规范词会合并并追加语境与 CFI；不同书籍互不合并。

## 移动端

插件不使用 Electron、Node 文件 API 或桌面专属模块。首发验收覆盖 iPhone 真机，以及 iPad 常见尺寸、横竖屏和分屏模拟；iPad 实体机尚未实测。

## 网络与隐私

只有用户发起翻译时，选中文字、所在段落、章节名和语言设置会发送到用户配置的 API 服务。插件没有遥测、账户系统或自建中转服务器，书籍文件不会上传。

## 开发

```bash
npm install
npm run build
npm test
```

## 许可与上游

MIT。阅读器底座基于 [EPUB Reader Plus](https://github.com/IkariKr/obsidian-epub-reader-plus) 和 [ePub Reader](https://github.com/caronchen/obsidian-epub-plugin)。原始版权与许可见 [LICENSE](LICENSE) 和 [NOTICE.md](NOTICE.md)。
