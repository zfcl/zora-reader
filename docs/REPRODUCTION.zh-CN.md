# 复现、安装与升级流程

本文用于在另一台电脑上复现完全相同的一体化 Reader。API Key 不参与复制、构建、ZIP 或 Git 提交。

## A. 最简单的二进制安装

适用于只想使用插件、不需要改源码的电脑。

1. 关闭 Obsidian。
2. 备份当前 Vault。
3. 在 `设置 → 第三方插件` 中记录当前启用状态。
4. 解压 `weave-epub-ai-reader-1.0.0-beta.zip` 到：

   ```text
   <Vault>/.obsidian/plugins/
   ```

5. 确认目录结构没有多嵌套一层：

   ```text
   <Vault>/.obsidian/plugins/weave-epub-ai-reader/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

6. 禁用旧的 `weave-epub-reader` 与 `weave-ai-assistant`，启用
   `weave-epub-ai-reader`。
7. 重新加载 Obsidian。
8. 打开 `设置 → Weave EPUB AI Reader → AI 助手`，重新输入并保存
   DeepSeek API Key。

API Key 必须在每个 Vault 中单独配置，因为它保存在 Obsidian SecretStorage 中，不在 ZIP 内。

## B. Windows 一键本地安装

安装源码依赖并构建后，在 PowerShell 中运行：

```powershell
.\scripts\install-local.ps1 -VaultPath "D:\path\to\Vault"
```

该脚本会：

- 备份旧 Reader、旧桥接插件、新 Reader（若已存在）和 `community-plugins.json`；
- 把 `dist` 中的三个运行文件安装到新插件目录；
- 默认迁移旧 Reader 的 `data.json`、`state` 和 `cache`，保留阅读设置和本地状态；
- 从启用列表移除两个旧插件并加入新插件；
- 不删除任何旧插件目录；
- 不读取或迁移旧桥接插件的 API Key。

不迁移旧 Reader 数据时：

```powershell
.\scripts\install-local.ps1 -VaultPath "D:\path\to\Vault" -SkipReaderDataMigration
```

## C. 从源码完整复现

### 1. 固定上游

```powershell
git clone --branch 0.6.55 --single-branch https://github.com/zhuzhige123/obsidian-weave-reader.git weave-epub-ai-reader
cd weave-epub-ai-reader
git rev-parse HEAD
```

必须得到：

```text
536b2ca29a834385231fe49e6cd757fd07eecd1e
```

精确来源记录见仓库根目录的 `UPSTREAM.md`。

### 2. 安装依赖与构建

建议使用 Node.js 20 LTS 或更新的受支持版本：

```powershell
npm ci
npm run build
```

构建结束后应存在：

```text
dist/main.js
dist/manifest.json
dist/styles.css
dist/versions.json
```

### 3. 必须保留的一体化改动

上游升级发生冲突时，优先核对这些文件：

- `src/components/epub/SelectionToolbar.svelte`
  - AI 按钮始终由 Reader 原生工具条渲染；
  - 不再依赖 `isWeaveMainPluginEnabled(app)`。
- `src/components/epub/EpubReaderApp.svelte`
  - 不再因为未安装 Weave 主插件而提前退出；
  - 仍使用 Reader 自己捕获的 `text` 和 `cfiRange`。
- `src/services/ai/integrated-reader-ai.ts`
  - 五个 AI 动作；
  - DeepSeek `requestUrl` 调用；
  - 强制 `thinking: { type: "disabled" }`；
  - 自适应结果 Modal。
- `src/config/integrated-ai-settings.ts`
  - Endpoint、模型、Token、自定义提示词；
  - SecretStorage API Key。
- `src/components/settings/EpubAISettingsTab.svelte`
  - Reader 设置中的 AI 助手标签。
- `src/main.ts`
  - 本地 AI 菜单和结果执行入口；
  - AI 设置持久化。

### 4. 安装前检查

```powershell
npm run build
npm run verify:release
npm run verify:obsidian-community
npx vitest run src/components/settings/integrated-ai-settings.test.ts
git diff --check
```

密钥扫描：

```powershell
git ls-files | Select-String -Pattern 'data\.json$|\.env$|\.pem$|\.key$'
rg -n --hidden -g '!node_modules/**' -g '!dist/**' -g '!.git/**' 'sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9_-]{16,}' .
```

预期不应出现真实密钥或被跟踪的本地 `data.json`。

## D. 界面验证清单

1. 打开一本 EPUB。
2. 选择单词或句子。
3. 原生悬浮工具条中直接出现 `AI`。
4. 点击 `AI` 后出现五个动作。
5. 未配置 API Key 时，应提示进入新 Reader 的 AI 设置。
6. 保存 API Key 后逐一测试五个动作。
7. 在网络请求中确认请求体包含：

   ```json
   "thinking": {
     "type": "disabled"
   }
   ```

8. 结果窗口在屏幕允许时一次展示完整内容；只有超过可视高度时整个窗口滚动。
9. `复制结果` 与 `关闭` 按钮可用。
10. 重新启动 Obsidian 后 Reader、AI 设置引用和阅读状态仍正常。

## E. 升级上游版本

1. 新建升级分支，不能直接在稳定分支上覆盖。
2. 添加或更新 `upstream` remote。
3. 获取新的 tag 并记录确切 commit。
4. 合并上游后解决冲突。
5. 更新 `UPSTREAM.md`。
6. 运行 C、D 两节的所有检查。
7. 版本号必须是 `x.y.z`。
8. GitHub Release tag 必须与 `manifest.json` 中的版本完全一致。
9. Release 必须单独上传 `main.js`、`manifest.json`、`styles.css`。
10. 用户界面验证通过后才能合并和发布。

## F. API Key 保密原则

- 不把 API Key 写入源码。
- 不把 API Key 写入 `data.json`。
- 不把 API Key 放进 ZIP 或 GitHub Release。
- 不提交任何 Vault 的 `.obsidian` 目录。
- 不在日志、截图、Issue 或 PR 中粘贴 API Key。
- 发现误提交时立即吊销旧 Key，并清理 Git 历史后再发布。
