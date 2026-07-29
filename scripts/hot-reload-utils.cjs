const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_RUNTIME_FILES = new Set([
	"main.js",
	"main.js.map",
	"styles.css",
	"styles.css.map",
	"manifest.json",
	"versions.json",
]);
const DEFAULT_RUNTIME_ASSET_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".svg",
	".webp",
	".ico",
	".ttf",
	".otf",
	".woff",
	".woff2",
]);
const DEFAULT_RUNTIME_ASSET_DIRS = new Set(["assets"]);
const DEFAULT_PRUNABLE_RUNTIME_DIRS = new Set(["assets", "src"]);
const DEFAULT_PRUNABLE_RUNTIME_FILES = new Set([
	"main.js",
	"main.js.map",
	"styles.css",
	"styles.css.map",
	"manifest.json",
	"versions.json",
]);

function parseDotEnv(content) {
	const parsed = {};

	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) {
			continue;
		}

		const separatorIndex = line.indexOf("=");
		if (separatorIndex < 0) {
			continue;
		}

		const key = line.slice(0, separatorIndex).trim();
		if (!key) {
			continue;
		}

		let value = line.slice(separatorIndex + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		parsed[key] = value;
	}

	return parsed;
}

function readEnvValueFromDotEnv(key) {
	const envPath = path.join(PROJECT_ROOT, ".env");
	if (!fs.existsSync(envPath)) {
		return null;
	}

	try {
		const parsed = parseDotEnv(fs.readFileSync(envPath, "utf8"));
		const value = parsed[key];
		return typeof value === "string" && value.trim() ? value.trim() : null;
	} catch {
		return null;
	}
}

function resolveVaultPath(processEnv = process.env) {
	return (
		processEnv.OBSIDIAN_VAULT_PATH?.trim() ||
		readEnvValueFromDotEnv("OBSIDIAN_VAULT_PATH")
	);
}

function resolveHotReloadPluginId(processEnv = process.env) {
	return (
		processEnv.OBSIDIAN_PLUGIN_ID?.trim() ||
		readEnvValueFromDotEnv("OBSIDIAN_PLUGIN_ID") ||
		"weave-epub-ai-reader"
	);
}

function resolvePluginDir(pluginId, processEnv = process.env) {
	const vaultPath = resolveVaultPath(processEnv);
	if (!vaultPath) {
		return null;
	}

	return path.resolve(vaultPath, "plugins", pluginId);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function listRuntimeFiles(sourceDir, runtimeFiles = DEFAULT_RUNTIME_FILES) {
	if (!fs.existsSync(sourceDir)) {
		return [];
	}

	return fs
		.readdirSync(sourceDir, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.filter((name) => runtimeFiles.has(name))
		.sort((a, b) => a.localeCompare(b));
}

function listRuntimeAssetFiles(
	sourceDir,
	assetDirs = DEFAULT_RUNTIME_ASSET_DIRS,
	assetExtensions = DEFAULT_RUNTIME_ASSET_EXTENSIONS,
) {
	if (!fs.existsSync(sourceDir)) {
		return [];
	}

	const files = [];

	function walk(relativeDir) {
		const absoluteDir = path.join(sourceDir, relativeDir);
		if (!fs.existsSync(absoluteDir)) {
			return;
		}

		for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
			const relativePath = relativeDir
				? path.posix.join(relativeDir, entry.name)
				: entry.name;
			const normalizedRelativePath = relativePath.replace(/\\/g, "/");

			if (entry.isDirectory()) {
				walk(normalizedRelativePath);
				continue;
			}

			if (assetExtensions.has(path.extname(entry.name).toLowerCase())) {
				files.push(normalizedRelativePath);
			}
		}
	}

	for (const assetDir of assetDirs) {
		walk(assetDir);
	}

	return files.sort((a, b) => a.localeCompare(b));
}

async function copyFileAtomicWithRetry(
	sourceFile,
	targetFile,
	{ retries = 24, delayMs = 180 } = {},
) {
	if (path.resolve(sourceFile) === path.resolve(targetFile)) {
		return false;
	}

	const tempFile = path.join(
		path.dirname(targetFile),
		`.weave-sync-${process.pid}-${Date.now()}-${path.basename(targetFile)}`,
	);

	for (let attempt = 0; attempt <= retries; attempt += 1) {
		try {
			fs.mkdirSync(path.dirname(targetFile), { recursive: true });
			fs.copyFileSync(sourceFile, tempFile);

			if (fs.existsSync(targetFile)) {
				fs.rmSync(targetFile, { force: true });
			}

			fs.renameSync(tempFile, targetFile);
			return true;
		} catch (error) {
			try {
				if (fs.existsSync(tempFile)) {
					fs.rmSync(tempFile, { force: true });
				}
			} catch {}

			const code = error?.code;
			if (
				(code === "EBUSY" ||
					code === "EPERM" ||
					code === "ENOTEMPTY" ||
					code === "EMFILE" ||
					code === "ENOENT") &&
				attempt < retries
			) {
				await sleep(delayMs);
				continue;
			}

			throw error;
		}
	}

	return false;
}

function pruneManagedRuntimeFiles(
	targetDir,
	keepFiles = new Set(),
	managedFiles = DEFAULT_PRUNABLE_RUNTIME_FILES,
) {
	if (!fs.existsSync(targetDir)) {
		return [];
	}

	const removed = [];

	for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
		if (!entry.isFile()) {
			continue;
		}

		if (!managedFiles.has(entry.name) || keepFiles.has(entry.name)) {
			continue;
		}

		fs.rmSync(path.join(targetDir, entry.name), { force: true });
		removed.push(entry.name);
	}

	return removed.sort((a, b) => a.localeCompare(b));
}

function pruneManagedRuntimeDirectories(
	targetDir,
	keepDirectories = new Set(),
	managedDirectories = DEFAULT_PRUNABLE_RUNTIME_DIRS,
) {
	if (!fs.existsSync(targetDir)) {
		return [];
	}

	const removed = [];

	for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}

		if (
			!managedDirectories.has(entry.name) ||
			keepDirectories.has(entry.name)
		) {
			continue;
		}

		fs.rmSync(path.join(targetDir, entry.name), {
			recursive: true,
			force: true,
		});
		removed.push(`${entry.name}/`);
	}

	return removed.sort((a, b) => a.localeCompare(b));
}

async function syncRuntimeFiles(
	sourceDir,
	targetDir,
	{
		runtimeFiles = DEFAULT_RUNTIME_FILES,
		runtimeAssetDirs = DEFAULT_RUNTIME_ASSET_DIRS,
		runtimeAssetExtensions = DEFAULT_RUNTIME_ASSET_EXTENSIONS,
		retries = 24,
		delayMs = 180,
		pruneStaleManagedFiles = false,
		managedFiles = DEFAULT_PRUNABLE_RUNTIME_FILES,
		managedDirectories = DEFAULT_PRUNABLE_RUNTIME_DIRS,
	} = {},
) {
	const runtimeFilesList = [
		...listRuntimeFiles(sourceDir, runtimeFiles),
		...listRuntimeAssetFiles(
			sourceDir,
			runtimeAssetDirs,
			runtimeAssetExtensions,
		),
	].sort((a, b) => a.localeCompare(b));
	const copied = [];

	for (const fileName of runtimeFilesList) {
		const copiedFile = await copyFileAtomicWithRetry(
			path.join(sourceDir, fileName),
			path.join(targetDir, fileName),
			{ retries, delayMs },
		);

		if (copiedFile) {
			copied.push(fileName);
		}
	}

	const removed = pruneStaleManagedFiles
		? [
				...pruneManagedRuntimeFiles(
					targetDir,
					new Set(runtimeFilesList),
					managedFiles,
				),
				...pruneManagedRuntimeDirectories(
					targetDir,
					new Set(
						runtimeFilesList
							.filter((fileName) => fileName.includes("/"))
							.map((fileName) => fileName.split("/")[0]),
					),
					managedDirectories,
				),
		  ]
		: [];

	return {
		runtimeFiles: runtimeFilesList,
		copied,
		removed,
	};
}

module.exports = {
	DEFAULT_PRUNABLE_RUNTIME_DIRS,
	DEFAULT_PRUNABLE_RUNTIME_FILES,
	DEFAULT_RUNTIME_FILES,
	DEFAULT_RUNTIME_ASSET_DIRS,
	DEFAULT_RUNTIME_ASSET_EXTENSIONS,
	PROJECT_ROOT,
	copyFileAtomicWithRetry,
	listRuntimeAssetFiles,
	listRuntimeFiles,
	pruneManagedRuntimeFiles,
	pruneManagedRuntimeDirectories,
	readEnvValueFromDotEnv,
	resolveHotReloadPluginId,
	resolvePluginDir,
	resolveVaultPath,
	syncRuntimeFiles,
};
