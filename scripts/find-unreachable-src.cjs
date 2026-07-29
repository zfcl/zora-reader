const fs = require("fs");
const path = require("path");

const root = path.resolve("src");
const projectRoot = path.resolve(__dirname, "..");

const ENTRY_RELATIVE_PATHS = [
	"main.ts",
	"views/epub-view-host.ts",
	"tests/setup.ts",
	"tests/vitest-setup.ts",
	"tests/mocks/obsidian.ts",
];

const ENTRY_DIRECTORIES = [
	"views",
	"components/epub",
	"components/settings",
	"services/epub",
	"services/navigation",
	"services/premium",
	"services/ui",
	"services/identifier",
	"events",
	"stores",
	"config",
	"styles/epub",
	"shims",
];

const ENTRY_FILES = [
	"styles/obsidian-confirm.css",
	"services/ai/ai-action-config.ts",
	"services/ai/ai-host.ts",
	"services/editor/editor-temp-file-policy.ts",
	"modals/VaultFileSuggestModal.ts",
	"modals/VaultFolderSuggestModal.ts",
	"modals/weaveComplexSuggestion.ts",
	"modals/weaveSuggestModalTheme.ts",
	"components/modals/EpubBookshelfImportModal.ts",
	"data/epub-bridge-types.ts",
	"types/license.ts",
	"types/utility-types.ts",
	"types/ai-types.ts",
	"types/plugin-settings.d.ts",
	"types/ir-point-storage-types.ts",
	"types/ir-types.ts",
	"types/view-card-modal-types.ts",
	"types/obsidian-runtime-globals.d.ts",
	"types/obsidian-extensions.ts",
	"types/foliate-js.d.ts",
	"types/weave-vendor-epubcfi.d.ts",
	"utils/i18n/locale-policy.ts",
	"shims/readable-stream-disabled.js",
];

const TEST_GLOBS = [
	"components/epub/**/*.test.ts",
	"components/epub/*.test.ts",
	"components/ui/**/*.test.ts",
	"components/ui/*.test.ts",
	"components/settings/**/*.test.ts",
	"components/settings/*.test.ts",
	"views/**/*.test.ts",
	"views/*.test.ts",
	"services/epub/__tests__/**/*.{test,spec}.ts",
	"services/navigation/__tests__/**/*.{test,spec}.ts",
	"services/obsidian/__tests__/*.test.ts",
	"services/obsidian/__tests__/**/*.test.ts",
	"services/obsidian/__tests__/*.spec.ts",
	"services/obsidian/__tests__/**/*.spec.ts",
	"utils/__tests__/epub-author-color-sanitizer.test.ts",
	"utils/__tests__/locale-resolver.test.ts",
	"utils/__tests__/source-path-matcher.epub-links.test.ts",
	"utils/__tests__/yaml-utils.epub-source.test.ts",
	"utils/__tests__/license-sync-bridge.test.ts",
	"utils/__tests__/license-state.test.ts",
	"utils/__tests__/license-owner-email.test.ts",
	"utils/__tests__/activation-privacy.test.ts",
	"utils/__tests__/plugin-license.test.ts",
	"utils/__tests__/license-device-stats.test.ts",
	"utils/__tests__/device-fingerprint.test.ts",
	"utils/__tests__/mobile-edit-viewport.test.ts",
	"utils/__tests__/mobile-floating-viewport.test.ts",
	"utils/__tests__/mobile-reading-viewport-lock.test.ts",
	"utils/__tests__/epub-reader-keyboard-guards.test.ts",
	"utils/__tests__/dom-instance-of.test.ts",
	"utils/__tests__/blob-url-text.test.ts",
	"utils/__tests__/blob-url-registry.test.ts",
	"utils/__tests__/clipboard-copy.test.ts",
	"utils/__tests__/i18n-locales.test.ts",
	"utils/__tests__/VaultMarkdownFileSuggest.test.ts",
];

const UI_COMPONENTS_FOR_TESTS = [
	"components/ui/EnhancedModal.svelte",
	"components/ui/EnhancedButton.svelte",
	"components/ui/EnhancedIcon.svelte",
	"components/ui/FloatingMenu.svelte",
	"components/ui/Icon.svelte",
	"components/ui/ObsidianIcon.svelte",
	"components/ui/TabNavigation.svelte",
	"components/ui/VirtualScroll.svelte",
];

function globToRegExp(globPattern) {
	const normalized = globPattern.replace(/\\/g, "/");
	let regex = "";
	for (let index = 0; index < normalized.length; index += 1) {
		const char = normalized[index];
		const next = normalized[index + 1];
		if (char === "*" && next === "*") {
			regex += ".*";
			index += 1;
			continue;
		}
		if (char === "*") {
			regex += "[^/]*";
			continue;
		}
		if (/[.+^${}()|[\]\\]/.test(char)) {
			regex += `\\${char}`;
			continue;
		}
		regex += char;
	}
	return new RegExp(`^${regex}$`);
}

const testPatterns = TEST_GLOBS.map(globToRegExp);

function resolveImport(fromFile, spec) {
	if (spec.startsWith("@/")) {
		const aliasBase = path.join(root, spec.slice(2));
		const aliasCandidates = [
			aliasBase,
			`${aliasBase}.ts`,
			`${aliasBase}.tsx`,
			`${aliasBase}.svelte`,
			path.join(aliasBase, "index.ts"),
		];
		for (const candidate of aliasCandidates) {
			if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
				return candidate;
			}
		}
		return null;
	}

	if (!spec.startsWith(".")) {
		return null;
	}

	const base = path.resolve(path.dirname(fromFile), spec);
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		`${base}.svelte`,
		`${base}.js`,
		`${base}.css`,
		path.join(base, "index.ts"),
		path.join(base, "index.svelte"),
	];

	for (const candidate of candidates) {
		if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
			return candidate;
		}
	}

	return null;
}

function parseImports(file) {
	const text = fs.readFileSync(file, "utf8");
	const specs = [];
	const patterns = [
		/from\s+['"]([^'"]+)['"]/g,
		/import\s+['"]([^'"]+)['"]/g,
		/import\s*\(\s*['"]([^'"]+)['"]\s*\)/gs,
	];

	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern)) {
			specs.push(match[1]);
		}
	}

	return specs;
}

function walk(dir, files = []) {
	if (!fs.existsSync(dir)) {
		return files;
	}

	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(entryPath, files);
			continue;
		}

		if (/\.(ts|tsx|svelte|css|js)$/.test(entry.name)) {
			files.push(path.resolve(entryPath));
		}
	}

	return files;
}

function collectReachable(entryFiles) {
	const queue = [...entryFiles];
	const seen = new Set();

	while (queue.length > 0) {
		const file = queue.shift();
		if (!file || seen.has(file)) {
			continue;
		}

		seen.add(file);

		for (const spec of parseImports(file)) {
			const resolved = resolveImport(file, spec);
			if (resolved && resolved.startsWith(root) && !seen.has(resolved)) {
				queue.push(resolved);
			}
		}
	}

	return seen;
}

function collectEntryFiles(allSourceFiles) {
	const entries = new Set();

	for (const relativePath of ENTRY_RELATIVE_PATHS) {
		const absolutePath = path.join(root, relativePath);
		if (fs.existsSync(absolutePath)) {
			entries.add(path.resolve(absolutePath));
		}
	}

	for (const relativePath of ENTRY_FILES) {
		const absolutePath = path.join(root, relativePath);
		if (fs.existsSync(absolutePath)) {
			entries.add(path.resolve(absolutePath));
		}
	}

	for (const relativePath of UI_COMPONENTS_FOR_TESTS) {
		const absolutePath = path.join(root, relativePath);
		if (fs.existsSync(absolutePath)) {
			entries.add(path.resolve(absolutePath));
		}
	}

	for (const relativeDir of ENTRY_DIRECTORIES) {
		const absoluteDir = path.join(root, relativeDir);
		for (const file of walk(absoluteDir)) {
			entries.add(file);
		}
	}

	for (const file of allSourceFiles) {
		const relative = path.relative(root, file).replace(/\\/g, "/");
		if (testPatterns.some((pattern) => pattern.test(relative))) {
			entries.add(file);
		}
	}

	return [...entries];
}

function main() {
	const all = walk(root);
	const entryFiles = collectEntryFiles(all);
	const mainEntry = path.join(root, "main.ts");
	if (fs.existsSync(mainEntry)) {
		for (const file of collectReachable([mainEntry])) {
			entryFiles.push(file);
		}
	}

	const reachable = collectReachable([...new Set(entryFiles)]);
	const unreachable = all.filter((file) => !reachable.has(file)).sort();
	const relativeUnreachable = unreachable.map((file) =>
		path.relative(projectRoot, file).replace(/\\/g, "/")
	);

	const listOnly = process.argv.includes("--list");
	const writeList = process.argv.includes("--write-list");

	if (writeList) {
		const outputPath = path.join(projectRoot, "scripts", ".plugin-scope-unreachable.txt");
		fs.writeFileSync(outputPath, `${relativeUnreachable.join("\n")}\n`, "utf8");
		console.log(`[find-unreachable-src] wrote ${relativeUnreachable.length} paths -> ${outputPath}`);
		return;
	}

	if (listOnly) {
		process.stdout.write(`${relativeUnreachable.join("\n")}\n`);
		return;
	}

	const topDirs = new Map();
	for (const file of unreachable) {
		const relative = path.relative(root, file).replace(/\\/g, "/");
		const top = relative.split("/").slice(0, 2).join("/");
		topDirs.set(top, (topDirs.get(top) || 0) + 1);
	}

	console.log(
		JSON.stringify(
			{
				entrySeeds: entryFiles.length,
				reachable: reachable.size,
				total: all.length,
				unreachable: unreachable.length,
				topUnreachableDirs: Object.fromEntries(
					[...topDirs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
				),
			},
			null,
			2
		)
	);
}

main();
