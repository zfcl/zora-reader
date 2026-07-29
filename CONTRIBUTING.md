# Contributing

Thank you for improving Weave EPUB AI Reader.

## Before opening a pull request

1. Create a focused branch from `main`.
2. Install dependencies with `npm ci`.
3. Keep the integrated AI boundary small and preserve upstream attribution.
4. Never commit an API key, `.env`, plugin `data.json`, Vault content, or
   generated release assets.
5. Run the relevant tests and a production build.

For changes to source code or `manifest.json`, the preferred validation is:

```text
npm run verify:community
npm run verify:public-repo
npm run verify:release
```

The upstream project currently contains known Svelte-check findings. Do not
silence or expand them; explain whether your change introduces any new
diagnostics.

## Pull requests

Describe:

- what changed and why;
- user-visible impact;
- tests and platforms used;
- privacy or network behavior changes;
- upstream version compatibility, when relevant.

UI changes to the selection toolbar or result modal should include a screenshot
or a concise manual verification record.

By contributing, you agree that your contribution is licensed under
GPL-3.0-or-later.
