import { describe, it, expect } from "vitest";
import {
	findSentenceBoundariesInText,
	findMobileClauseBoundariesInText,
	isSentenceTerminator,
	expandRangeToSentence,
	expandRangeToParagraph,
	snapRangeToSentenceForMobileDrag,
} from "../sentence-selection";

describe("sentence-selection", () => {
	describe("isSentenceTerminator", () => {
		it("identifies standard periods, exclamation marks, question marks", () => {
			expect(isSentenceTerminator("Hello world.", 11).isTerminator).toBe(true);
			expect(isSentenceTerminator("Hello world?", 11).isTerminator).toBe(true);
			expect(isSentenceTerminator("Hello world!", 11).isTerminator).toBe(true);
		});

		it("handles quotes following punctuation", () => {
			const res = isSentenceTerminator('He said, "No!" Then he left.', 12);
			expect(res.isTerminator).toBe(true);
			// 12 is '!', 13 is '"', endOffset should be 14
			expect(res.endOffset).toBe(14);
		});

		it("ignores decimals like 3.14 or $19.99", () => {
			expect(isSentenceTerminator("The price is $19.99 today.", 16).isTerminator).toBe(false);
			expect(isSentenceTerminator("Pi is 3.14159 approximately.", 7).isTerminator).toBe(false);
		});

		it("ignores common English abbreviations like Mr., Dr., etc., e.g.", () => {
			expect(isSentenceTerminator("I saw Dr. Watson yesterday.", 8).isTerminator).toBe(false);
			expect(isSentenceTerminator("Hello Mr. Darcy.", 8).isTerminator).toBe(false);
			expect(isSentenceTerminator("Apples, oranges, etc. are fruits.", 20).isTerminator).toBe(false);
			expect(isSentenceTerminator("Some books (e.g. Gatsby) are great.", 15).isTerminator).toBe(false);
		});

		it("ignores single initial abbreviations like J. K. Rowling", () => {
			expect(isSentenceTerminator("Written by J. K. Rowling in 1997.", 12).isTerminator).toBe(false);
		});
	});

	describe("findSentenceBoundariesInText", () => {
		it("expands single word to full sentence as requested in prompt", () => {
			const text = "I don't know what he's gonna do. I ain't never been to no dentist neither. Then we went home.";
			const word = "dentist";
			const selStart = text.indexOf(word);
			const selEnd = selStart + word.length;

			const { start, end } = findSentenceBoundariesInText(text, selStart, selEnd);
			const extracted = text.slice(start, end);
			expect(extracted).toBe("I ain't never been to no dentist neither.");
		});

		it("handles first sentence in paragraph", () => {
			const text = "First sentence here. Second sentence follows.";
			const word = "sentence";
			const selStart = text.indexOf(word);
			const selEnd = selStart + word.length;

			const { start, end } = findSentenceBoundariesInText(text, selStart, selEnd);
			expect(text.slice(start, end)).toBe("First sentence here.");
		});

		it("handles last sentence in paragraph without trailing punctuation", () => {
			const text = "First sentence here. Second sentence without dot";
			const word = "without";
			const selStart = text.indexOf(word);
			const selEnd = selStart + word.length;

			const { start, end } = findSentenceBoundariesInText(text, selStart, selEnd);
			expect(text.slice(start, end)).toBe("Second sentence without dot");
		});

		it("includes trailing quotes and multiple punctuation", () => {
			const text = 'She asked, "Are you sure?!" Then she smiled.';
			const word = "sure";
			const selStart = text.indexOf(word);
			const selEnd = selStart + word.length;

			const { start, end } = findSentenceBoundariesInText(text, selStart, selEnd);
			expect(text.slice(start, end)).toBe('She asked, "Are you sure?!"');
		});

		it("does not break at decimals or Dr. in middle of sentence", () => {
			const text = "Dr. Watson paid $3.50 for lunch. It was cheap.";
			const word = "paid";
			const selStart = text.indexOf(word);
			const selEnd = selStart + word.length;

			const { start, end } = findSentenceBoundariesInText(text, selStart, selEnd);
			expect(text.slice(start, end)).toBe("Dr. Watson paid $3.50 for lunch.");
		});
	});

	describe("findMobileClauseBoundariesInText", () => {
		it("uses comma, semicolon, period, question mark, and exclamation mark as clause edges", () => {
			const text = "First clause, second clause; third clause! Fourth clause?";
			const target = text.indexOf("second");
			const { start, end } = findMobileClauseBoundariesInText(text, target);

			expect(text.slice(start, end)).toBe("second clause;");
		});

		it("supports the corresponding Chinese punctuation", () => {
			const text = "第一小句，第二小句；第三小句？！第四小句。";
			const target = text.indexOf("第二");
			const { start, end } = findMobileClauseBoundariesInText(text, target);

			expect(text.slice(start, end)).toBe("第二小句；");
		});

		it("keeps decimals and abbreviations inside the same clause", () => {
			const text = "Before, Dr. Watson paid $3.50 for lunch; after.";
			const target = text.indexOf("Watson");
			const { start, end } = findMobileClauseBoundariesInText(text, target);

			expect(text.slice(start, end)).toBe("Dr. Watson paid $3.50 for lunch;");
		});

		it("falls back to the bounded raw drag when no punctuation is nearby", () => {
			const text = `${"a".repeat(300)} target ${"b".repeat(300)}.`;
			const target = text.indexOf("target");
			const { start, end } = findMobileClauseBoundariesInText(text, target, {
				fallbackStart: 0,
				fallbackEnd: text.length,
				maxEdgeChars: 40,
			});

			expect(start).toBe(target - 40);
			expect(end).toBe(target + 40);
			expect(end - start).toBe(80);
		});
	});

	describe("expandRangeToSentence DOM expansion", () => {
		it("expands DOM Range spanning text nodes", () => {
			const p = document.createElement("p");
			const t1 = document.createTextNode("I don't know what he's gonna do. I ain't never been to no ");
			const em = document.createElement("em");
			em.textContent = "dentist";
			const t2 = document.createTextNode(" neither. Then we went home.");
			p.appendChild(t1);
			p.appendChild(em);
			p.appendChild(t2);
			document.body.appendChild(p);

			const range = document.createRange();
			range.selectNodeContents(em);

			const result = expandRangeToSentence(range, document);
			expect(result).not.toBeNull();
			expect(result?.text).toBe("I ain't never been to no dentist neither.");

			document.body.removeChild(p);
		});

		it("expands sentence ranges whose nodes belong to an EPUB iframe realm", () => {
			const iframe = document.createElement("iframe");
			document.body.appendChild(iframe);
			const frameDoc = iframe.contentDocument;
			expect(frameDoc).toBeTruthy();
			if (!frameDoc) return;

			const p = frameDoc.createElement("p");
			const before = frameDoc.createTextNode("Before. The iframe sentence has ");
			const emphasis = frameDoc.createElement("em");
			const selected = frameDoc.createTextNode("cross-realm nodes");
			emphasis.appendChild(selected);
			const after = frameDoc.createTextNode(" and must expand completely. After.");
			p.append(before, emphasis, after);
			frameDoc.body.appendChild(p);

			const range = frameDoc.createRange();
			range.setStart(selected, 2);
			range.setEnd(selected, 7);
			const result = snapRangeToSentenceForMobileDrag(range, frameDoc);

			expect(result?.text).toBe(
				"The iframe sentence has cross-realm nodes and must expand completely."
			);
			expect(result?.range.startContainer.ownerDocument).toBe(frameDoc);
			iframe.remove();
		});

		it("extends a short mobile drag through a sentence ending on the next visual page", () => {
			const p = document.createElement("p");
			const currentPage = document.createElement("span");
			currentPage.dataset.visualPage = "current";
			const currentText = document.createTextNode(
				"Previous sentence. This sentence starts on the current visual page "
			);
			currentPage.appendChild(currentText);
			const nextPage = document.createElement("span");
			nextPage.dataset.visualPage = "next";
			const nextText = document.createTextNode(
				"and reaches its ending on the next page. Following sentence."
			);
			nextPage.appendChild(nextText);
			p.append(currentPage, nextPage);
			document.body.appendChild(p);

			const range = document.createRange();
			const start = currentText.data.indexOf("starts");
			range.setStart(currentText, start);
			range.setEnd(currentText, start + 2);

			const result = snapRangeToSentenceForMobileDrag(range, document);
			expect(result?.text).toBe(
				"This sentence starts on the current visual page and reaches its ending on the next page."
			);
			expect(result?.range.endContainer).toBe(nextText);
			expect(result?.range.endOffset).toBe(nextText.data.indexOf(".") + 1);

			document.body.removeChild(p);
		});

		it("stops at the first comma on the next visual page instead of selecting the page", () => {
			const blockquote = document.createElement("blockquote");
			const currentPage = document.createElement("div");
			const currentText = document.createTextNode(
				"out of the brighter life, and is unable to see because unaccustomed to the "
			);
			currentPage.appendChild(currentText);
			const nextPage = document.createElement("div");
			const nextText = document.createTextNode(
				"dark, or having turned from darkness to the day is dazzled by excess of light. " +
				"And he will count the one happy in his condition and state of being."
			);
			nextPage.appendChild(nextText);
			blockquote.append(currentPage, nextPage);
			document.body.appendChild(blockquote);

			const anchor = currentText.data.indexOf("unable");
			const range = document.createRange();
			range.setStart(currentText, anchor);
			range.setEnd(currentText, anchor + 3);

			const result = snapRangeToSentenceForMobileDrag(range, document, {
				node: currentText,
				offset: anchor,
			});

			expect(result?.text).toBe(
				"and is unable to see because unaccustomed to the dark,"
			);
			expect(result?.range.endContainer).toBe(nextText);
			expect(result?.range.endOffset).toBe(nextText.data.indexOf(",") + 1);

			document.body.removeChild(blockquote);
		});

		it("does not treat generic EPUB layout divs as sentence boundaries", () => {
			const blockquote = document.createElement("blockquote");
			const currentPage = document.createElement("div");
			currentPage.dataset.visualPage = "current";
			const currentText = document.createTextNode(
				"Previous sentence. This complete sentence starts in one layout block "
			);
			currentPage.appendChild(currentText);
			const nextPage = document.createElement("div");
			nextPage.dataset.visualPage = "next";
			const nextText = document.createTextNode(
				"and ends inside another layout block. Following sentence."
			);
			nextPage.appendChild(nextText);
			blockquote.append(currentPage, nextPage);
			document.body.appendChild(blockquote);

			const range = document.createRange();
			const start = currentText.data.indexOf("complete");
			range.setStart(currentText, start);
			range.setEnd(currentText, start + 3);

			const result = snapRangeToSentenceForMobileDrag(range, document);
			expect(result?.text).toBe(
				"This complete sentence starts in one layout block and ends inside another layout block."
			);
			expect(result?.range.endContainer).toBe(nextText);

			document.body.removeChild(blockquote);
		});

		it("keeps only the initial-touch clause when a mobile drag crosses boundaries", () => {
			const p = document.createElement("p");
			const text = document.createTextNode("First complete sentence. Second complete sentence. Third one.");
			p.appendChild(text);
			document.body.appendChild(p);
			const range = document.createRange();
			range.setStart(text, text.data.indexOf("complete"));
			range.setEnd(text, text.data.indexOf("Third") - 1);

			const result = snapRangeToSentenceForMobileDrag(range, document, {
				node: text,
				offset: text.data.indexOf("complete"),
			});
			expect(result?.text).toBe("First complete sentence.");

			document.body.removeChild(p);
		});
	});

	describe("expandRangeToParagraph DOM expansion", () => {
		it("expands DOM Range to whole paragraph without leaking to sibling paragraphs", () => {
			const container = document.createElement("div");
			const p1 = document.createElement("p");
			p1.textContent = "First paragraph before.";
			const p2 = document.createElement("p");
			const t1 = document.createTextNode("Second paragraph with ");
			const em = document.createElement("em");
			em.textContent = "highlighted word";
			const t2 = document.createTextNode(" and more details.");
			p2.appendChild(t1);
			p2.appendChild(em);
			p2.appendChild(t2);
			const p3 = document.createElement("p");
			p3.textContent = "Third paragraph after.";

			container.appendChild(p1);
			container.appendChild(p2);
			container.appendChild(p3);
			document.body.appendChild(container);

			const range = document.createRange();
			range.selectNodeContents(em);

			const result = expandRangeToParagraph(range, document);
			expect(result).not.toBeNull();
			expect(result?.text).toBe("Second paragraph with highlighted word and more details.");

			document.body.removeChild(container);
		});
	});
});
