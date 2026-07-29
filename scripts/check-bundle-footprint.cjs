const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const bundlePath = path.join(PROJECT_ROOT, "dist", "main.js");
const BASELINE_PATH = path.join(PROJECT_ROOT, "scripts", "bundle-footprint-baseline.json");

const FORBIDDEN_STRINGS = [
	"IRStorageService",
	"IREpubBookmarkTaskService",
	"MobileKanbanView",
	"AnkiConnect",
	"sql.js",
	"BatchParsingManager",
];

const DEFAULT_MAX_GZIP_KB = 640;
const DEFAULT_MAX_RAW_KB = 2100;
const GROWTH_TOLERANCE_RATIO = 1.05;

function fail(message) {
	console.error(`[check-bundle-footprint] ${message}`);
	process.exit(1);
}

function readBaseline() {
	if (!fs.existsSync(BASELINE_PATH)) {
		return null;
	}
	try {
		return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
	} catch {
		return null;
	}
}

function main() {
	if (!fs.existsSync(bundlePath)) {
		fail("dist/main.js not found. Run `npm run build` first.");
	}

	const bundle = fs.readFileSync(bundlePath, "utf8");
	const gzipBytes = zlib.gzipSync(bundle).length;
	const rawBytes = bundle.length;
	const gzipKb = gzipBytes / 1024;
	const rawKb = rawBytes / 1024;
	const hits = FORBIDDEN_STRINGS.filter((needle) => bundle.includes(needle));

	if (hits.length > 0) {
		fail(`forbidden legacy strings found in bundle: ${hits.join(", ")}`);
	}

	const baseline = readBaseline();
	const maxGzipKb = baseline?.maxGzipKb ?? DEFAULT_MAX_GZIP_KB;
	const maxRawKb = baseline?.maxRawKb ?? DEFAULT_MAX_RAW_KB;

	if (gzipKb > maxGzipKb) {
		fail(`gzip footprint ${gzipKb.toFixed(1)} KB exceeds limit ${maxGzipKb} KB`);
	}
	if (rawKb > maxRawKb) {
		fail(`raw footprint ${rawKb.toFixed(1)} KB exceeds limit ${maxRawKb} KB`);
	}

	if (baseline?.gzipKb && gzipKb > baseline.gzipKb * GROWTH_TOLERANCE_RATIO) {
		fail(
			`gzip footprint grew more than ${Math.round((GROWTH_TOLERANCE_RATIO - 1) * 100)}% (${baseline.gzipKb.toFixed(1)} KB -> ${gzipKb.toFixed(1)} KB)`
		);
	}

	console.log(
		`[check-bundle-footprint] OK (gzip ${gzipKb.toFixed(1)} KB, ${rawKb.toFixed(1)} KB raw)`
	);
}

main();
