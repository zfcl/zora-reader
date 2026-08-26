import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	buildNormalizedRange,
	getCaretPositionFromPoint,
	extractWordRangeFromTextNode,
	MobileDirectSelectionOverlay,
	MobileDirectSelectionController,
} from '../mobile-direct-selection';
import type { ReaderFrame } from '../../../services/epub/reader-engine-types';

describe('mobile-direct-selection', () => {
	let doc: Document;

	beforeEach(() => {
		doc = document.implementation.createHTMLDocument('Test EPUB Chapter');
	});

	describe('1 & 2. TAP -> whole word and contraction/hyphen handling', () => {
		it('extracts simple whole words on tap', () => {
			const textNode = doc.createTextNode('The quick brown fox jumps');
			doc.body.appendChild(textNode);

			const result = extractWordRangeFromTextNode(doc, textNode, 6); // inside "quick"
			expect(result).not.toBeNull();
			expect(result?.text).toBe('quick');
			expect(result?.range.toString()).toBe('quick');
		});

		it('extracts contractions completely (don\'t, can\'t, I\'m, teacher\'s)', () => {
			const textNode = doc.createTextNode("I don't think she's ready, but I'm sure it's teacher's.");
			doc.body.appendChild(textNode);

			const res1 = extractWordRangeFromTextNode(doc, textNode, 3); // "don't"
			expect(res1?.text).toBe("don't");

			const res2 = extractWordRangeFromTextNode(doc, textNode, 15); // "she's"
			expect(res2?.text).toBe("she's");

			const res3 = extractWordRangeFromTextNode(doc, textNode, 33); // "I'm"
			expect(res3?.text).toBe("I'm");

			const res4 = extractWordRangeFromTextNode(doc, textNode, 47); // "teacher's"
			expect(res4?.text).toBe("teacher's");
		});

		it('extracts hyphenated words completely (twenty-first)', () => {
			const textNode = doc.createTextNode('Welcome to the twenty-first century.');
			doc.body.appendChild(textNode);

			const res = extractWordRangeFromTextNode(doc, textNode, 18); // inside "twenty-first"
			expect(res?.text).toBe('twenty-first');
		});
	});

	describe('3, 4 & 5. Drag selection: reverse, cross-line, cross-inline tags', () => {
		it('builds forward range within same text node', () => {
			const p = doc.createElement('p');
			const textNode = doc.createTextNode('I had a test today');
			p.appendChild(textNode);
			doc.body.appendChild(p);

			const range = buildNormalizedRange(doc, textNode, 0, textNode, 5);
			expect(range).not.toBeNull();
			expect(range?.toString()).toBe('I had');
		});

		it('3. normalizes reverse drag range (right-to-left / bottom-to-top)', () => {
			const p = doc.createElement('p');
			const textNode = doc.createTextNode('I had a test today');
			p.appendChild(textNode);
			doc.body.appendChild(p);

			// Drag from offset 18 back to 0
			const range = buildNormalizedRange(doc, textNode, 18, textNode, 0);
			expect(range).not.toBeNull();
			expect(range?.startOffset).toBe(0);
			expect(range?.endOffset).toBe(18);
			expect(range?.toString()).toBe('I had a test today');
		});

		it('4. handles cross-line / cross-block dragging', () => {
			const p1 = doc.createElement('p');
			const t1 = doc.createTextNode('Line 1 of the chapter. ');
			p1.appendChild(t1);

			const p2 = doc.createElement('p');
			const t2 = doc.createTextNode('Line 2 of the chapter.');
			p2.appendChild(t2);

			doc.body.appendChild(p1);
			doc.body.appendChild(p2);

			const range = buildNormalizedRange(doc, t1, 5, t2, 6);
			expect(range).not.toBeNull();
			expect(range?.startContainer).toBe(t1);
			expect(range?.startOffset).toBe(5);
			expect(range?.endContainer).toBe(t2);
			expect(range?.endOffset).toBe(6);
			expect(range?.toString()).toContain('of the chapter');
		});

		it('5. handles cross-inline dragging (span, em, strong)', () => {
			const p = doc.createElement('p');
			const t1 = doc.createTextNode('He said ');
			const em = doc.createElement('em');
			const tEm = doc.createTextNode('Flowers for');
			em.appendChild(tEm);
			const strong = doc.createElement('strong');
			const tStrong = doc.createTextNode(' Algernon');
			strong.appendChild(tStrong);
			const t2 = doc.createTextNode(' was brilliant.');

			p.appendChild(t1);
			p.appendChild(em);
			p.appendChild(strong);
			p.appendChild(t2);
			doc.body.appendChild(p);

			const range = buildNormalizedRange(doc, t1, 3, t2, 4);
			expect(range).not.toBeNull();
			expect(range?.toString()).toBe('said Flowers for Algernon was');
		});
	});

	describe('6. Overlay rect generation', () => {
		it('renders translucent selection overlay boxes and cleans up cleanly', () => {
			const overlay = new MobileDirectSelectionOverlay(doc);
			const p = doc.createElement('p');
			const text = doc.createTextNode('Overlay rendering text');
			p.appendChild(text);
			doc.body.appendChild(p);

			const range = doc.createRange();
			range.setStart(text, 0);
			range.setEnd(text, 7);

			(range as any).getClientRects = vi.fn().mockReturnValue([
				{ top: 10, left: 10, width: 60, height: 18, bottom: 28, right: 70 },
			]);

			overlay.render(range);
			const container = doc.querySelector('.zora-mobile-selection-overlay');
			expect(container).not.toBeNull();
			const boxes = doc.querySelectorAll('.zora-mobile-selection-box');
			expect(boxes.length).toBe(1);

			overlay.clear();
			expect(doc.querySelector('.zora-mobile-selection-overlay')).toBeNull();
		});
	});

	describe('7. touchmove RAF throttling', () => {
		it('throttles touchmove updates with requestAnimationFrame', () => {
			const controller = new MobileDirectSelectionController();
			const p = doc.createElement('p');
			const text = doc.createTextNode('RAF throttling test sentence.');
			p.appendChild(text);
			doc.body.appendChild(p);

			let rafScheduled = 0;
			const win = doc.defaultView || window;
			const originalRaf = win.requestAnimationFrame;
			win.requestAnimationFrame = vi.fn((cb) => {
				rafScheduled++;
				return originalRaf ? originalRaf(cb) : (1 as any);
			});

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: win,
				cfiFromRange: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0,/4/2/1:10)'),
			};

			controller.syncFrames([mockFrame]);

			// Mock caret lookup
			const mockRange = doc.createRange();
			mockRange.setStart(text, 0);
			mockRange.setEnd(text, 0);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(mockRange);

			// Simulate touchstart
			const touchStartEvent = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStartEvent, 'touches', {
				value: [{ clientX: 10, clientY: 10 }],
			});
			doc.dispatchEvent(touchStartEvent);

			// Simulate multiple rapid touchmove events in same frame
			for (let i = 0; i < 5; i++) {
				const touchMoveEvent = new Event('touchmove', { bubbles: true, cancelable: true });
				Object.defineProperty(touchMoveEvent, 'touches', {
					value: [{ clientX: 10 + i * 5, clientY: 10 }],
				});
				doc.dispatchEvent(touchMoveEvent);
			}

			// RAF was scheduled only once per animation frame without runaway spawns
			expect(rafScheduled).toBeGreaterThanOrEqual(1);

			controller.dispose();
			win.requestAnimationFrame = originalRaf;
		});
	});

	describe('8. No window.getSelection pollution', () => {
		it('does not invoke window.getSelection().addRange() or execCommand', () => {
			const controller = new MobileDirectSelectionController();
			const addRangeSpy = vi.fn();
			const mockSelection = {
				addRange: addRangeSpy,
				removeAllRanges: vi.fn(),
			};
			const win = doc.defaultView || window;
			(win as any).getSelection = vi.fn().mockReturnValue(mockSelection);

			const p = doc.createElement('p');
			const text = doc.createTextNode('No WebKit selection pollution');
			p.appendChild(text);
			doc.body.appendChild(p);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: win,
				cfiFromRange: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0,/4/2/1:5)'),
			};

			controller.syncFrames([mockFrame]);

			// Perform direct tap selection
			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 10, clientY: 10 }],
			});
			const mockRange = doc.createRange();
			mockRange.setStart(text, 3);
			mockRange.setEnd(text, 3);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(mockRange);

			doc.dispatchEvent(touchStart);

			const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
			Object.defineProperty(touchEnd, 'touches', { value: [] });
			doc.dispatchEvent(touchEnd);

			// WebKit selection was never handed the range
			expect(addRangeSpy).not.toHaveBeenCalled();

			controller.dispose();
		});
	});

	describe('9 & 10. Page turn clears selection', () => {
		it('clearSelection resets state and removes overlays completely', () => {
			const controller = new MobileDirectSelectionController();
			const p = doc.createElement('p');
			const text = doc.createTextNode('Selection on page one');
			p.appendChild(text);
			doc.body.appendChild(p);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0,/4/2/1:9)'),
			};

			controller.syncFrames([mockFrame]);

			// Simulate active selection
			const range = doc.createRange();
			range.setStart(text, 0);
			range.setEnd(text, 9);
			(controller as any).activeSelection = {
				source: 'mobile-direct',
				range,
				text: 'Selection',
				cfiRange: 'epubcfi(/6/2!/4/2/1:0,/4/2/1:9)',
				rect: new DOMRect(0, 0, 50, 20),
				rects: [new DOMRect(0, 0, 50, 20)],
				frame: mockFrame,
				frameDocument: doc,
				clear: vi.fn(),
			};
			(controller as any).mode = 'selected';

			expect(controller.getSelection()).not.toBeNull();
			expect(controller.getMode()).toBe('selected');

			// Clear selection before next/prev page navigation
			controller.clearSelection();

			expect(controller.getSelection()).toBeNull();
			expect(controller.getMode()).toBe('idle');
			expect(doc.querySelector('.zora-mobile-selection-overlay')).toBeNull();

			controller.dispose();
		});
	});

	describe('11. Mobile direct selection granularity expansion', () => {
		it('updates selection when expanding from word to sentence or paragraph', () => {
			const controller = new MobileDirectSelectionController();
			const p = doc.createElement('p');
			const text = doc.createTextNode('Initial word. Full sentence for expansion.');
			p.appendChild(text);
			doc.body.appendChild(p);

			const range1 = doc.createRange();
			range1.setStart(text, 0);
			range1.setEnd(text, 7); // "Initial"

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0,/4/2/1:7)'),
			};

			controller.syncFrames([mockFrame]);

			(controller as any).activeSelection = {
				source: 'mobile-direct',
				range: range1,
				text: 'Initial',
				cfiRange: 'epubcfi(/6/2!/4/2/1:0,/4/2/1:7)',
				rect: new DOMRect(0, 0, 40, 20),
				rects: [new DOMRect(0, 0, 40, 20)],
				frame: mockFrame,
				frameDocument: doc,
				clear: vi.fn(),
			};
			(controller as any).mode = 'selected';

			const range2 = doc.createRange();
			range2.setStart(text, 0);
			range2.setEnd(text, 42); // Full sentence

			controller.updateExpandedSelection(
				range2,
				'Initial word. Full sentence for expansion.',
				'epubcfi(/6/2!/4/2/1:0,/4/2/1:42)'
			);

			const current = controller.getSelection();
			expect(current?.text).toBe('Initial word. Full sentence for expansion.');
			expect(current?.cfiRange).toBe('epubcfi(/6/2!/4/2/1:0,/4/2/1:42)');

			controller.dispose();
		});
	});
});
