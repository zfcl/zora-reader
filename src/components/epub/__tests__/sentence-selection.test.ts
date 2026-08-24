import { describe, it, expect } from "vitest";
import {
	findSentenceBoundariesInText,
	isSentenceTerminator,
	expandRangeToSentence,
	expandRangeToParagraph,
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
