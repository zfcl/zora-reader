# Weave EPUB AI Reader

一个把电子书阅读器与 DeepSeek 阅读助手整合到同一 Obsidian 插件中的
GPL-3.0-or-later 开源项目。

本项目基于
[Weave EPUB Reader 0.6.55](https://github.com/zhuzhige123/obsidian-weave-reader/tree/0.6.55)，
但并非上游官方版本。准确的上游提交与移植记录见
[UPSTREAM.md](UPSTREAM.md)。

## 使用方式

1. 在阅读器中选中单词、句子或段落。
2. 点击原生悬浮选区工具条中的 **AI**。
3. 选择“学术概念解析”“英语句子翻译”“英语语法解析”
   “通用语境赏析”或“自定义助手”。
4. 在自适应窗口中阅读或复制结果。

AI 按钮直接集成于 Reader 源码，不依赖 Weave 主插件，也不使用 DOM 注入、
右键菜单替换或运行时补丁。

## 要求与隐私

- Obsidian 1.11.4 或更高版本
- DeepSeek API Key
- 能够访问所配置 HTTPS Endpoint 的网络

API Key 通过 Obsidian SecretStorage 保存，不写入插件 `data.json`、源码、
构建文件或发布包。只有用户主动选择 AI 动作时，所选文本和对应提示词才会
发送到配置的 API Endpoint。插件不包含遥测。

完整安装、构建、隐私和上游更新说明请阅读
[README.md](README.md)、[PRIVACY.md](PRIVACY.md) 与
[复现文档](docs/user/REPRODUCTION.zh-CN.md)。
