import { describe, it, expect } from "vitest";
import { buildReaderChapterStyles } from "../reader-chapter-styles";

describe("buildReaderChapterStyles", () => {
	const createMockStyleSource = () => {
		const doc = document.implementation.createHTMLDocument();
		return doc.body;
	};

	it("injects user-select:none and -webkit-touch-callout:none on Mobile chapter styles", () => {
		const styleSource = createMockStyleSource();
		const css = buildReaderChapterStyles({
			styleSource,
			currentLineHeight: 1.66,
			currentLetterSpacing: 0,
			currentPageMargin: 24,
			currentWidthMode: "full",
			isMobile: true,
		});

		expect(css).toContain("user-select: none !important");
		expect(css).toContain("-webkit-user-select: none !important");
		expect(css).toContain("-webkit-touch-callout: none !important");
	});

	it("does not inject user-select:none on Desktop chapter styles", () => {
		const styleSource = createMockStyleSource();
		const css = buildReaderChapterStyles({
			styleSource,
			currentLineHeight: 1.72,
			currentLetterSpacing: 0,
			currentPageMargin: 48,
			currentWidthMode: "standard",
			isMobile: false,
		});

		expect(css).not.toContain("user-select: none !important");
		expect(css).not.toContain("-webkit-user-select: none !important");
	});
});
