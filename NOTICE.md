# Zora Reader — Personal Fork Notice

Zora Reader is a personal, local-use derivative of:

- Weave EPUB AI Reader 1.0.1 by HarrySuen626
- Weave EPUB Reader 0.6.55 by Rabbit (zhuzhige)

Both upstream projects are GPL-3.0-or-later. This fork remains GPL-3.0-or-later.

This personal build removes the commercial license/entitlement UI and runtime
dependency on the official Weave main plugin. Local reader capabilities are
resolved by `src/config/personal-capabilities.ts`. No activation token,
purchase record, or remote license response is fabricated.

The Zora dictionary/translation engine under `src/services/ai/zora/` is the
previously tested personal translation implementation, migrated into the
reader's native SelectionToolbar popover.
