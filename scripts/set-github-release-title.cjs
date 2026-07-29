/**
 * Set a GitHub release display title to match its tag (ObsidianReviewBot requirement).
 * Usage: node scripts/set-github-release-title.cjs <tag>
 * Requires GITHUB_TOKEN and GITHUB_REPOSITORY (or --repo owner/name).
 */
const tag = process.argv[2];
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const repo =
	process.env.GITHUB_REPOSITORY ||
	(process.argv.includes("--repo")
		? process.argv[process.argv.indexOf("--repo") + 1]
		: null);

if (!tag) {
	console.error("Usage: node scripts/set-github-release-title.cjs <tag>");
	process.exit(1);
}

if (!token || !repo) {
	console.error(
		"Missing GITHUB_TOKEN (or GH_TOKEN) and GITHUB_REPOSITORY (or --repo).",
	);
	process.exit(1);
}

async function main() {
	const getUrl = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(
		tag,
	)}`;
	const getResponse = await fetch(getUrl, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"User-Agent": "weave-epub-ai-reader-set-release-title",
		},
	});

	if (!getResponse.ok) {
		console.error(
			`Failed to fetch release ${tag}: ${getResponse.status} ${getResponse.statusText}`,
		);
		process.exit(1);
	}

	const release = await getResponse.json();
	if (release.name === tag) {
		console.log(`Release title for ${tag} already matches tag.`);
		return;
	}

	const patchUrl = `https://api.github.com/repos/${repo}/releases/${release.id}`;
	const patchResponse = await fetch(patchUrl, {
		method: "PATCH",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"Content-Type": "application/json",
			"User-Agent": "weave-epub-ai-reader-set-release-title",
		},
		body: JSON.stringify({ name: tag, tag_name: tag }),
	});

	if (!patchResponse.ok) {
		const body = await patchResponse.text();
		console.error(
			`Failed to update release ${tag}: ${patchResponse.status} ${body}`,
		);
		process.exit(1);
	}

	const updated = await patchResponse.json();
	if (updated.name !== tag) {
		console.error(
			`Release title mismatch after patch: expected "${tag}", got "${
				updated.name ?? ""
			}"`,
		);
		process.exit(1);
	}

	console.log(`Set release title for ${tag} to "${tag}".`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
