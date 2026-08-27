import { describe, expect, it } from "vitest";
import {
	isEphemeralEditorHighlightSourcePath,
	resolveEpubHighlightPersistenceSourcePath,
} from "../epub-highlight-source-path";

describe("epub-highlight-source-path", () => {
	it("prefers wdeck storage path over epub we_source path on saved cards", () => {
		expect(
			resolveEpubHighlightPersistenceSourcePath({
				sourceFile: "Books/demo.epub",
				customFields: {
					wdeck: {
						sourcePath: "weave/memory/deck-files/demo_01.wdeck",
					},
				},
			})
		).toBe("weave/memory/deck-files/demo_01.wdeck");
	});

	it("treats modal editor temp files as ephemeral", () => {
		const app = {
			plugins: { getPlugin: () => null },
		} as any;

		expect(
			isEphemeralEditorHighlightSourcePath(app, "weave/temp/modal-editor-permanent.md")
		).toBe(true);
		expect(
			isEphemeralEditorHighlightSourcePath(app, "weave-data/editor/modal-editor-permanent.md")
		).toBe(true);
		expect(
			isEphemeralEditorHighlightSourcePath(app, "Books/demo.epub")
		).toBe(false);
		expect(
			isEphemeralEditorHighlightSourcePath(app, "Zora Reader/debug/mobile-debug.log")
		).toBe(true);
		expect(
			isEphemeralEditorHighlightSourcePath(app, "Zora Reader/debug/test.log")
		).toBe(false);
		expect(
			isEphemeralEditorHighlightSourcePath(app, "Zora Reader/debug/gesture-debug.json")
		).toBe(false);
	});
});
