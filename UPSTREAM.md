# Upstream provenance

| Field | Value |
| --- | --- |
| Project | `zhuzhige123/obsidian-weave-reader` |
| Release tag | `0.6.55` |
| Commit | `536b2ca29a834385231fe49e6cd757fd07eecd1e` |
| Commit date | 2026-07-27T15:55:29Z |
| Source tree | `c5fc0c93de9c4c4059d550a07b3dd941012975bf` |
| License | GPL-3.0-or-later |
| Integrated fork version | `1.0.1` |

The fork was created from the exact upstream tag above. The Git history is
retained so future upstream changes can be audited and merged.

The integration changes are intentionally isolated around:

- `src/components/epub/SelectionToolbar.svelte`
- `src/components/epub/EpubReaderApp.svelte`
- `src/services/ai/integrated-reader-ai.ts`
- `src/config/integrated-ai-settings.ts`
- `src/components/settings/EpubAISettingsTab.svelte`
- `src/main.ts`

No upstream release bundle is modified at runtime.
