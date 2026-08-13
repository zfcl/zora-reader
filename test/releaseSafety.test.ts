import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";

test("release bundle does not dynamically create script elements", () => {
	const bundle = readFileSync(resolve(process.cwd(), "main.js"), "utf8");

	assert.doesNotMatch(
		bundle,
		/\.createElement\(["']script["']\)/,
		"Release bundles must not include dynamic script injection.",
	);
});

test("mobile manifest and bundle avoid desktop-only platform imports", () => {
	const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "manifest.json"), "utf8")) as { isDesktopOnly: boolean };
	const bundle = readFileSync(resolve(process.cwd(), "main.js"), "utf8");
	assert.equal(manifest.isDesktopOnly, false);
	assert.doesNotMatch(bundle, /require\(["'](?:electron|fs|path|child_process)["']\)/);
});

test("iPhone and iPad breakpoints keep a touch-sized mobile translation sheet", () => {
	const css = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");
	assert.match(css, /@media \(max-width: 700px\)/);
	assert.match(css, /\.zora-translation-card\.is-mobile/);
	assert.match(css, /env\(safe-area-inset-bottom\)/);
	assert.match(css, /width:\s*100%/);
});
