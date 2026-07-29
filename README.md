# Weave EPUB AI Reader

An integrated Obsidian ebook reader with a built-in DeepSeek reading assistant.

> This is an independent GPL-3.0-or-later derivative of
> [Weave EPUB Reader 0.6.55](https://github.com/zhuzhige123/obsidian-weave-reader/tree/0.6.55)
> by Rabbit (zhuzhige). It is not an official release of the upstream project.
> The exact upstream base is commit
> [`536b2ca29a834385231fe49e6cd757fd07eecd1e`](https://github.com/zhuzhige123/obsidian-weave-reader/commit/536b2ca29a834385231fe49e6cd757fd07eecd1e).

## Why this fork exists

The upstream reader includes an AI button in its native selection toolbar, but
the action is delegated to the separate Weave main plugin. This fork keeps the
reader's native selected-text pipeline and integrates the AI menu, DeepSeek
request, settings, and result window directly into one plugin.

There is no DOM injection, context-menu replacement, runtime patcher, or
dependency on the Weave main plugin.

## AI reading workflow

1. Select a word, sentence, or paragraph in the reader.
2. Click **AI** in the reader's native floating selection toolbar.
3. Choose one of five actions:
   - 学术概念解析
   - 英语句子翻译
   - 英语语法解析
   - 通用语境赏析
   - 自定义助手
4. Read or copy the result in a viewport-aware result window.

Every request explicitly includes:

```json
{
  "thinking": {
    "type": "disabled"
  }
}
```

## Requirements

- Obsidian 1.11.4 or newer
- A DeepSeek API key
- Network access to the configured HTTPS API endpoint

The minimum Obsidian version is 1.11.4 because this plugin stores the API key
in Obsidian SecretStorage. The key is not written to plugin `data.json`, source
files, build assets, or release archives.

## Manual installation

1. Disable **Weave EPUB Reader** and the old **Weave AI Assistant** bridge if
   they are installed. The readers use separate plugin IDs and view types, but
   Obsidian can associate an ebook file extension with only one reader at a
   time.
2. Download the release ZIP and extract it to:

   ```text
   <Vault>/.obsidian/plugins/weave-epub-ai-reader/
   ```

3. Confirm that the folder directly contains:

   ```text
   main.js
   manifest.json
   styles.css
   ```

4. Reload Obsidian, enable **Weave EPUB AI Reader**, then open:
   **Settings → Weave EPUB AI Reader → AI Assistant**.
5. Save the DeepSeek API key and choose the model, endpoint, maximum output
   tokens, and optional custom prompt.

## Privacy and network disclosure

- Reading, highlighting, bookshelf state, and normal reader operations are
  local-first.
- When you explicitly choose an AI action, the selected text, the chosen
  prompt, model name, and output limit are sent to the configured DeepSeek API
  endpoint.
- The plugin does not include telemetry.
- The API key is stored through Obsidian SecretStorage in the current vault.
- DeepSeek is a third-party service. Review its privacy policy and terms before
  using the integration.

See [PRIVACY.md](PRIVACY.md) for the complete disclosure inherited from and
extended beyond the upstream reader.

## Building from source

```powershell
npm ci
npm run build
```

Release assets are generated in `dist/`. A valid release contains
`main.js`, `manifest.json`, and `styles.css`. Never add an API key or a local
plugin `data.json` to a release.

## Upstream updates

This repository keeps the upstream Git history. To port a newer reader version:

1. Fetch the upstream tag.
2. Record its tag and exact commit in [UPSTREAM.md](UPSTREAM.md).
3. Rebase or merge it into a dedicated update branch.
4. Reapply only the integrated-AI source changes if conflicts occur.
5. Run the build, release verification, secret scan, and manual Obsidian
   selection-toolbar test before publishing.

## License and attribution

Licensed under GPL-3.0-or-later. See [LICENSE](LICENSE) and [COPYRIGHT](COPYRIGHT).

- Original reader: [zhuzhige123/obsidian-weave-reader](https://github.com/zhuzhige123/obsidian-weave-reader)
- Integrated AI fork: HarrySuen626 and contributors
