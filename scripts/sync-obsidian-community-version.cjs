/**
 * Push only Obsidian community version metadata to origin/main without other code changes.
 *
 * Usage:
 *   node scripts/sync-obsidian-community-version.cjs
 *   node scripts/sync-obsidian-community-version.cjs --version 0.6.9
 *   node scripts/sync-obsidian-community-version.cjs --dry-run
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SYNC_BRANCH = "obsidian-version-sync";
const REMOTE = "origin";
const DEFAULT_BRANCH = "main";
function readMinAppVersion() {
	const manifest = readJson("manifest.json");
	if (!manifest.minAppVersion) {
		fail("manifest.json is missing minAppVersion");
	}
	return manifest.minAppVersion;
}

function fail(message) {
	console.error(`[sync-obsidian-community-version] ${message}`);
	process.exit(1);
}

function run(command, args, options = {}) {
	const result = execFileSync(command, args, {
		cwd: PROJECT_ROOT,
		encoding: "utf8",
		stdio: options.dryRun ? "pipe" : "inherit",
		...options,
	});
	return typeof result === "string" ? result.trim() : "";
}

function runCapture(command, args) {
	return run(command, args, { stdio: "pipe" });
}

function parseArgs(argv) {
	const args = { dryRun: false, version: null };
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--dry-run") {
			args.dryRun = true;
		} else if (token === "--version") {
			args.version = argv[index + 1];
			index += 1;
		} else if (token === "--help" || token === "-h") {
			console.log(
				"Usage: node scripts/sync-obsidian-community-version.cjs [--version x.y.z] [--dry-run]",
			);
			process.exit(0);
		} else {
			fail(`Unknown argument: ${token}`);
		}
	}
	return args;
}

function readJson(relativePath) {
	return JSON.parse(
		fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8"),
	);
}

function writeJson(relativePath, value) {
	fs.writeFileSync(
		path.join(PROJECT_ROOT, relativePath),
		`${JSON.stringify(value, null, 2)}\n`,
	);
}

function syncPackageLockVersion(version) {
	const lockPath = path.join(PROJECT_ROOT, "package-lock.json");
	if (!fs.existsSync(lockPath)) {
		return;
	}

	const lock = readJson("package-lock.json");
	lock.version = version;
	if (lock.packages?.[""]) {
		lock.packages[""].version = version;
	}
	writeJson("package-lock.json", lock);
}

function resolveTargetVersion(explicitVersion) {
	if (explicitVersion) {
		if (!/^\d+\.\d+\.\d+$/.test(explicitVersion)) {
			fail(`Invalid version format: ${explicitVersion}`);
		}
		return explicitVersion;
	}

	const manifest = readJson("manifest.json");
	if (!manifest.version) {
		fail("manifest.json is missing version");
	}
	return manifest.version;
}

function ensureVersionsEntry(version) {
	const versionsPath = path.join(PROJECT_ROOT, "versions.json");
	const versions = readJson("versions.json");
	if (!Object.prototype.hasOwnProperty.call(versions, version)) {
		versions[version] = readMinAppVersion();
		writeJson("versions.json", versions);
		console.log(
			`[sync-obsidian-community-version] Added versions.json entry for ${version}`,
		);
	}
	return versionsPath;
}

function ensureLocalVersionFiles(version) {
	const manifest = readJson("manifest.json");
	const packageJson = readJson("package.json");

	if (manifest.version !== version) {
		manifest.version = version;
		writeJson("manifest.json", manifest);
	}

	if (packageJson.version !== version) {
		packageJson.version = version;
		writeJson("package.json", packageJson);
	}

	syncPackageLockVersion(version);

	ensureVersionsEntry(version);
}

function getCurrentBranch() {
	return runCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
}

function hasStashNamed(name) {
	const stashList = runCapture("git", ["stash", "list"]);
	return stashList.split("\n").some((line) => line.includes(name));
}

function buildRemoteMetadata(targetVersion) {
	ensureLocalVersionFiles(targetVersion);
	const manifest = { ...readJson("manifest.json"), version: targetVersion };
	const versions = {
		...readJson("versions.json"),
		[targetVersion]: readMinAppVersion(),
	};
	return { manifest, versions };
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const targetVersion = resolveTargetVersion(args.version);
	const stashMessage = `wip-before-obsidian-community-version-sync-${Date.now()}`;
	const previousBranch = getCurrentBranch();
	const metadata = buildRemoteMetadata(targetVersion);

	console.log(
		`[sync-obsidian-community-version] Target version: ${targetVersion}`,
	);

	if (args.dryRun) {
		console.log(
			"[sync-obsidian-community-version] Dry run only. Planned actions:",
		);
		console.log(`  - git fetch ${REMOTE}`);
		console.log(`  - git stash push -u -m "${stashMessage}"`);
		console.log(
			`  - git checkout -B ${SYNC_BRANCH} ${REMOTE}/${DEFAULT_BRANCH}`,
		);
		console.log(
			"  - update manifest.json / package.json(version only) / package-lock.json(version only) / versions.json",
		);
		console.log(
			`  - git commit + git push ${REMOTE} ${SYNC_BRANCH}:${DEFAULT_BRANCH}`,
		);
		console.log(`  - git checkout ${previousBranch} && git stash pop`);
		return;
	}

	run("git", ["fetch", REMOTE]);

	let stashed = false;
	const status = runCapture("git", ["status", "--porcelain"]);
	if (status.length > 0) {
		run("git", ["stash", "push", "-u", "-m", stashMessage]);
		stashed = true;
	}

	try {
		run("git", ["checkout", "-B", SYNC_BRANCH, `${REMOTE}/${DEFAULT_BRANCH}`]);

		writeJson("manifest.json", metadata.manifest);

		run("git", [
			"checkout",
			`${REMOTE}/${DEFAULT_BRANCH}`,
			"--",
			"package.json",
		]);
		const packageJson = readJson("package.json");
		packageJson.version = targetVersion;
		writeJson("package.json", packageJson);

		writeJson("versions.json", metadata.versions);

		// Keep package-lock root version aligned so remote `npm ci` does not fail after version-only sync.
		syncPackageLockVersion(targetVersion);

		run("git", [
			"add",
			"manifest.json",
			"package.json",
			"package-lock.json",
			"versions.json",
		]);

		const stagedDiff = runCapture("git", ["diff", "--cached", "--stat"]);
		console.log(stagedDiff);

		run("git", [
			"commit",
			"-m",
			`Sync version metadata on main to ${targetVersion} for Obsidian community updates.`,
		]);
		run("git", ["push", REMOTE, `${SYNC_BRANCH}:${DEFAULT_BRANCH}`]);
	} finally {
		run("git", ["checkout", previousBranch]);
		if (stashed) {
			if (hasStashNamed(stashMessage)) {
				run("git", ["stash", "pop"]);
			}
		}
	}

	const remoteManifestUrl = `https://raw.githubusercontent.com/HarrySuen626/weave-epub-ai-reader/${DEFAULT_BRANCH}/manifest.json`;
	console.log(
		`[sync-obsidian-community-version] Done. Verify: ${remoteManifestUrl}`,
	);
}

main();
