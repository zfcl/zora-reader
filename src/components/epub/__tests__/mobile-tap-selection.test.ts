import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	extractWordRangeFromTextNode,
	MobileSelectionOverlay,
	MobileTapSelectionController,
} from "../mobile-tap-selection";
import type { ReaderFrame } from "../../../services/epub/reader-engine-types";

describe("mobile-tap-selection", () => {
	describe("extractWordRangeFromTextNode", () => {
		it("extracts simple English words", () => {
			const textNode = document.createTextNode("The quick brown fox jumps over the lazy dog.");
			const res = extractWordRangeFromTextNode(document, textNode, 6); // 'quick'
			expect(res).not.toBeNull();
			expect(res?.text).toBe("quick");
		});

		it("extracts contractions like don't, I'm, teacher's, we've", () => {
			const textNode = document.createTextNode("I don't think she's ready, but we've got to go.");

			const res1 = extractWordRangeFromTextNode(document, textNode, 3); // inside "don't"
			expect(res1?.text).toBe("don't");

			const res2 = extractWordRangeFromTextNode(document, textNode, 15); // inside "she's"
			expect(res2?.text).toBe("she's");

			const res3 = extractWordRangeFromTextNode(document, textNode, 33); // inside "we've"
			expect(res3?.text).toBe("we've");
		});

		it("extracts hyphenated words like twenty-first", () => {
			const textNode = document.createTextNode("Welcome to the twenty-first century.");
			const res = extractWordRangeFromTextNode(document, textNode, 18); // inside "twenty-first"
			expect(res?.text).toBe("twenty-first");
		});

		it("trims trailing punctuation", () => {
			const textNode = document.createTextNode("Are you ready? Yes!");
			const res = extractWordRangeFromTextNode(document, textNode, 12); // 'ready?'
			expect(res?.text).toBe("ready");
		});
	});

	describe("MobileSelectionOverlay", () => {
		let container: HTMLDivElement;

		beforeEach(() => {
			container = document.createElement("div");
			document.body.appendChild(container);
		});

		afterEach(() => {
			if (container.parentNode) {
				container.parentNode.removeChild(container);
			}
		});

		it("renders overlay boxes for Range and clears without DOM modification", () => {
			const p = document.createElement("p");
			const textNode = document.createTextNode("Visual overlay test text");
			p.appendChild(textNode);
			container.appendChild(p);

			const range = document.createRange();
			range.setStart(textNode, 7);
			range.setEnd(textNode, 14);

			const overlay = new MobileSelectionOverlay(document);
			overlay.render(range);

			const layer = document.querySelector(".zora-custom-selection-overlay-layer");
			expect(layer).not.toBeNull();

			overlay.clear();
			expect(document.querySelector(".zora-custom-selection-overlay-layer")).toBeNull();
		});
	});

	describe("MobileTapSelectionController", () => {
		it("arms and cancels cleanly", () => {
			const controller = new MobileTapSelectionController();
			expect(controller.getMode()).toBe("idle");
			expect(controller.isArmed()).toBe(false);

			controller.arm();
			expect(controller.getMode()).toBe("armed");
			expect(controller.isArmed()).toBe(true);

			controller.cancel();
			expect(controller.getMode()).toBe("idle");
			expect(controller.isArmed()).toBe(false);

			controller.dispose();
		});

		it("updates selection range on granularity switch", () => {
			const controller = new MobileTapSelectionController();
			const p = document.createElement("p");
			const text = document.createTextNode("Hello world paragraph test");
			p.appendChild(text);
			document.body.appendChild(p);

			const range1 = document.createRange();
			range1.setStart(text, 0);
			range1.setEnd(text, 5); // "Hello"

			const mockFrame: ReaderFrame = {
				frameDocument: document,
				window: window,
				cfiFromRange: () => "epubcfi(/6/2!/4/2/1:0,/6/2!/4/2/1:5)",
			};

			controller.syncFrames([mockFrame]);

			// Simulate active selection
			(controller as any).activeSelection = {
				source: "mobile-tap",
				range: range1,
				text: "Hello",
				cfiRange: "epubcfi(/6/2!/4/2/1:0,/6/2!/4/2/1:5)",
				rect: new DOMRect(10, 10, 50, 20),
				rects: [new DOMRect(10, 10, 50, 20)],
				frame: mockFrame,
				frameDocument: document,
				clear: () => {},
			};

			const range2 = document.createRange();
			range2.setStart(text, 0);
			range2.setEnd(text, 11); // "Hello world"
			controller.updateSelectionRange(range2, "Hello world", "epubcfi(/6/2!/4/2/1:0,/6/2!/4/2/1:11)");

			const current = controller.getSelection();
			expect(current?.text).toBe("Hello world");
			expect(current?.cfiRange).toBe("epubcfi(/6/2!/4/2/1:0,/6/2!/4/2/1:11)");

			controller.dispose();
			document.body.removeChild(p);
		});
	});
});
