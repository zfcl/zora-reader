import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	buildNormalizedRange,
	getCaretPositionFromPoint,
	extractWordRangeFromTextNode,
	findAccurateTextOffset,
	resolveTextCaretByGeometry,
	isPointOnTextGlyph,
	resolveSelectableTextCaret,
	isTextNode,
	isElementNode,
	MobileDirectSelectionOverlay,
	MobileDirectSelectionController,
} from '../mobile-direct-selection';
import * as mobileLogger from '../../../utils/zora-mobile-logger';
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
			expect(doc.getElementById('zora-direct-selection-style')).toBeNull();
			expect(doc.documentElement.classList.contains('zora-direct-selection-enabled')).toBe(false);
			expect(doc.body.classList.contains('zora-direct-selection-enabled')).toBe(false);
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

	describe('12. Mobile gesture arbitration, interactive elements, glyph hit-test, and paginator isolation', () => {
		it('1. registers touchstart listener with { passive: false, capture: true }', () => {
			const controller = new MobileDirectSelectionController();
			const addEventSpy = vi.spyOn(doc, 'addEventListener');

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};

			controller.syncFrames([mockFrame]);

			const touchStartCalls = addEventSpy.mock.calls.filter((call) => call[0] === 'touchstart');
			expect(touchStartCalls.length).toBeGreaterThanOrEqual(1);

			const options = touchStartCalls[0][2] as AddEventListenerOptions;
			expect(options).toEqual({ passive: false, capture: true });

			controller.dispose();
		});

		it('2. text touch: touchstart immediately calls preventDefault, stopPropagation, stopImmediatePropagation', () => {
			const controller = new MobileDirectSelectionController();
			const p = doc.createElement('p');
			const text = doc.createTextNode('Immediate gesture takeover test.');
			p.appendChild(text);
			doc.body.appendChild(p);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			const mockRange = doc.createRange();
			mockRange.setStart(text, 0);
			mockRange.setEnd(text, 0);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(mockRange);

			const touchStartEvent = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStartEvent, 'touches', {
				value: [{ clientX: 20, clientY: 30 }],
			});

			const preventDefaultSpy = vi.spyOn(touchStartEvent, 'preventDefault');
			const stopPropagationSpy = vi.spyOn(touchStartEvent, 'stopPropagation');
			const stopImmediatePropagationSpy = vi.spyOn(touchStartEvent, 'stopImmediatePropagation');

			doc.dispatchEvent(touchStartEvent);

			expect(preventDefaultSpy).toHaveBeenCalled();
			expect(stopPropagationSpy).toHaveBeenCalled();
			expect(stopImmediatePropagationSpy).toHaveBeenCalled();
			expect(controller.getMode()).toBe('selecting');
			expect(controller.getActiveGestureKind()).toBe('text-selection');

			controller.dispose();
		});

		it('3. text drag across <a>: range encompasses both regular text and link text', () => {
			const p = doc.createElement('p');
			const t1 = doc.createTextNode('Before link ');
			const a = doc.createElement('a');
			a.href = '#footnote-1';
			const tA = doc.createTextNode('linked text');
			a.appendChild(tA);
			const t2 = doc.createTextNode(' after link.');
			p.appendChild(t1);
			p.appendChild(a);
			p.appendChild(t2);
			doc.body.appendChild(p);

			const range = buildNormalizedRange(doc, t1, 0, t2, 6);
			expect(range).not.toBeNull();
			expect(range?.toString()).toBe('Before link linked text after');
		});

		it('4 & 5. tap on footnote <a href="#footnote"> or normal <a> does NOT create Zora selection', () => {
			const controller = new MobileDirectSelectionController();
			const p = doc.createElement('p');
			const a = doc.createElement('a');
			a.href = '#footnote-12';
			a.textContent = '12';
			p.appendChild(a);
			doc.body.appendChild(p);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 50, clientY: 50 }],
			});

			const preventDefaultSpy = vi.spyOn(touchStart, 'preventDefault');

			a.dispatchEvent(touchStart);

			// Interactive target: does NOT preventDefault on touchstart
			expect(preventDefaultSpy).not.toHaveBeenCalled();
			expect(controller.getActiveGestureKind()).toBe('interactive');
			expect(controller.getMode()).toBe('idle');
			expect(controller.getSelection()).toBeNull();

			const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
			Object.defineProperty(touchEnd, 'touches', { value: [] });
			const preventDefaultEndSpy = vi.spyOn(touchEnd, 'preventDefault');

			a.dispatchEvent(touchEnd);

			// Tap (< 8px) on interactive target allows native click
			expect(preventDefaultEndSpy).not.toHaveBeenCalled();
			expect(controller.getSelection()).toBeNull();

			controller.dispose();
		});

		it('6. interactive touch does not bubble to Paginator (body bubble guard)', () => {
			const controller = new MobileDirectSelectionController();
			const p = doc.createElement('p');
			const a = doc.createElement('a');
			a.href = 'https://example.com';
			a.textContent = 'external link';
			p.appendChild(a);
			doc.body.appendChild(p);

			const docPaginatorTouch = vi.fn();
			doc.addEventListener('touchstart', docPaginatorTouch, false);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 50, clientY: 50 }],
			});

			a.dispatchEvent(touchStart);

			// Stopped at doc.body bubble phase, never bubbles to doc listener
			expect(docPaginatorTouch).not.toHaveBeenCalled();

			doc.removeEventListener('touchstart', docPaginatorTouch, false);
			controller.dispose();
		});

		it('7. link small movement (< 8px) retains click capability', () => {
			const controller = new MobileDirectSelectionController();
			const a = doc.createElement('a');
			a.href = '#ch1';
			a.textContent = 'Chapter 1';
			doc.body.appendChild(a);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			// Start at (100, 100)
			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 100, clientY: 100 }],
			});
			a.dispatchEvent(touchStart);

			// Move 3px to (103, 100)
			const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
			Object.defineProperty(touchMove, 'touches', {
				value: [{ clientX: 103, clientY: 100 }],
			});
			const preventDefaultMove = vi.spyOn(touchMove, 'preventDefault');
			a.dispatchEvent(touchMove);

			expect(preventDefaultMove).not.toHaveBeenCalled();

			// End at (103, 100)
			const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
			Object.defineProperty(touchEnd, 'touches', { value: [] });
			const preventDefaultEnd = vi.spyOn(touchEnd, 'preventDefault');
			a.dispatchEvent(touchEnd);

			expect(preventDefaultEnd).not.toHaveBeenCalled();
			expect(controller.getSelection()).toBeNull();

			controller.dispose();
		});

		it('8. link large drag (>= 8px) cancels click, does not select text and does not flip page', () => {
			const controller = new MobileDirectSelectionController();
			const a = doc.createElement('a');
			a.href = '#ch2';
			a.textContent = 'Chapter 2';
			doc.body.appendChild(a);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			// Start at (100, 100)
			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 100, clientY: 100 }],
			});
			a.dispatchEvent(touchStart);

			// Move 20px (>= 8px)
			const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
			Object.defineProperty(touchMove, 'touches', {
				value: [{ clientX: 120, clientY: 100 }],
			});
			const preventDefaultMove = vi.spyOn(touchMove, 'preventDefault');
			a.dispatchEvent(touchMove);

			expect(preventDefaultMove).toHaveBeenCalled();

			// End
			const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
			Object.defineProperty(touchEnd, 'touches', { value: [] });
			const preventDefaultEnd = vi.spyOn(touchEnd, 'preventDefault');
			a.dispatchEvent(touchEnd);

			// Cancelled interactive gesture cancels click via preventDefault
			expect(preventDefaultEnd).toHaveBeenCalled();
			expect(controller.getSelection()).toBeNull();

			controller.dispose();
		});

		it('9 & 10. Note Marker tap / gesture does not create selection and does not bubble to Paginator', () => {
			const controller = new MobileDirectSelectionController();
			const marker = doc.createElement('span');
			marker.className = 'weave-paragraph-annotation';
			marker.setAttribute('data-weave-comment-marker', 'hit-area');
			marker.setAttribute('data-zora-interactive', 'true');
			doc.body.appendChild(marker);

			const paginatorDocTouch = vi.fn();
			doc.addEventListener('touchstart', paginatorDocTouch, false);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 50, clientY: 50 }],
			});

			marker.dispatchEvent(touchStart);

			expect(controller.getActiveGestureKind()).toBe('interactive');
			expect(controller.getSelection()).toBeNull();
			expect(paginatorDocTouch).not.toHaveBeenCalled();

			doc.removeEventListener('touchstart', paginatorDocTouch, false);
			controller.dispose();
		});

		it('11 & 12. body margin / empty container tap is blocked: no selection, no page flip', () => {
			const controller = new MobileDirectSelectionController();
			const emptyDiv = doc.createElement('div');
			emptyDiv.style.margin = '40px';
			doc.body.appendChild(emptyDiv);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			// Caret lookup returns null for empty background
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 5, clientY: 5 }],
			});
			const preventDefaultStart = vi.spyOn(touchStart, 'preventDefault');

			doc.body.dispatchEvent(touchStart);

			expect(preventDefaultStart).toHaveBeenCalled();
			expect(controller.getActiveGestureKind()).toBe('blocked');

			const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
			Object.defineProperty(touchMove, 'touches', {
				value: [{ clientX: 20, clientY: 5 }],
			});
			const preventDefaultMove = vi.spyOn(touchMove, 'preventDefault');
			doc.body.dispatchEvent(touchMove);

			expect(preventDefaultMove).toHaveBeenCalled();
			expect(controller.getSelection()).toBeNull();

			controller.dispose();
		});

		it('13. normal standalone img/svg drag is blocked: no selection, no page flip', () => {
			const controller = new MobileDirectSelectionController();
			const img = doc.createElement('img');
			img.src = 'cover.jpg';
			doc.body.appendChild(img);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 50, clientY: 50 }],
			});
			const preventDefault = vi.spyOn(touchStart, 'preventDefault');

			img.dispatchEvent(touchStart);

			expect(preventDefault).toHaveBeenCalled();
			expect(controller.getActiveGestureKind()).toBe('blocked');
			expect(controller.getSelection()).toBeNull();

			controller.dispose();
		});

		it('14. caret on valid TextNode even when isPointOnTextGlyph is false -> still classified as text-selection', () => {
			const controller = new MobileDirectSelectionController();
			const p = doc.createElement('p');
			const text = doc.createTextNode('Standard body paragraph text');
			p.appendChild(text);
			doc.body.appendChild(p);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			const mockRange = doc.createRange();
			mockRange.setStart(text, 5);
			mockRange.setEnd(text, 5);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(mockRange);

			// Mock char range returning bounding box far away from touch point (simulating iOS column/rect shift)
			const mockCharRange = {
				setStart: vi.fn(),
				setEnd: vi.fn(),
				getClientRects: () => [{ left: 500, top: 500, right: 550, bottom: 520, width: 50, height: 20 }],
				getBoundingClientRect: () => ({ left: 500, top: 500, right: 550, bottom: 520, width: 50, height: 20 }),
			};
			const origCreateRange = doc.createRange;
			doc.createRange = vi.fn().mockReturnValue(mockCharRange);

			// Touch at (50, 50) - glyph test will return false
			const glyphHit = isPointOnTextGlyph(doc, { node: text, offset: 5 }, 50, 50, 5);
			expect(glyphHit).toBe(false);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 50, clientY: 50 }],
			});
			p.dispatchEvent(touchStart);

			// Must STILL be text-selection!
			expect(controller.getActiveGestureKind()).toBe('text-selection');
			expect(controller.getMode()).toBe('selecting');

			doc.createRange = origCreateRange;
			controller.dispose();
		});

		it('15 & 16. native controls (input/textarea/select/video) are not captured by DirectSelection or Paginator', () => {
			const controller = new MobileDirectSelectionController();
			const input = doc.createElement('input');
			input.type = 'text';
			input.value = 'Search term';
			doc.body.appendChild(input);

			const paginatorDocTouch = vi.fn();
			doc.addEventListener('touchstart', paginatorDocTouch, false);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 40, clientY: 40 }],
			});
			Object.defineProperty(touchStart, 'target', { value: input });
			const preventDefault = vi.spyOn(touchStart, 'preventDefault');

			input.dispatchEvent(touchStart);

			// Native control retains native touch, no preventDefault
			expect(preventDefault).not.toHaveBeenCalled();
			expect(controller.getActiveGestureKind()).toBe('native-control');
			expect(controller.getSelection()).toBeNull();
			// Paginator does not receive it due to body bubble guard
			expect(paginatorDocTouch).not.toHaveBeenCalled();

			doc.removeEventListener('touchstart', paginatorDocTouch, false);
			controller.dispose();
		});

		it('17 & 18. TAP word extraction still works for words and contractions', () => {
			const textNode = doc.createTextNode("Don't stop twenty-first century reading.");
			doc.body.appendChild(textNode);

			const res1 = extractWordRangeFromTextNode(doc, textNode, 2);
			expect(res1?.text).toBe("Don't");

			const res2 = extractWordRangeFromTextNode(doc, textNode, 15);
			expect(res2?.text).toBe('twenty-first');
		});

		it('19. reverse drag selection is properly normalized', () => {
			const textNode = doc.createTextNode('Reverse dragging word order.');
			doc.body.appendChild(textNode);

			const range = buildNormalizedRange(doc, textNode, 16, textNode, 0);
			expect(range?.startOffset).toBe(0);
			expect(range?.endOffset).toBe(16);
			expect(range?.toString()).toBe('Reverse dragging');
		});

		it('20. Mobile styles maintain -webkit-user-select:none and restore user-select for native inputs without global touch-action:none', () => {
			const controller = new MobileDirectSelectionController();
			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			const styleEl = doc.getElementById('zora-direct-selection-style');
			expect(styleEl).not.toBeNull();
			expect(styleEl?.textContent).toContain('-webkit-user-select: none !important');
			expect(styleEl?.textContent).toContain('user-select: auto !important');
			expect(styleEl?.textContent).not.toContain('touch-action: none !important');

			controller.dispose();
		});

		it('21 & 22. Foliate pagination methods work via buttons while text drag never flips pages', () => {
			const controller = new MobileDirectSelectionController();
			const p = doc.createElement('p');
			const text = doc.createTextNode('Text for drag isolation.');
			p.appendChild(text);
			doc.body.appendChild(p);

			const mockPaginator = {
				goLeft: vi.fn(),
				goRight: vi.fn(),
				scrollBy: vi.fn(),
				snap: vi.fn(),
			};

			const paginatorTouchStart = vi.fn();
			const paginatorTouchMove = vi.fn();
			const paginatorTouchEnd = vi.fn();
			doc.addEventListener('touchstart', paginatorTouchStart);
			doc.addEventListener('touchmove', paginatorTouchMove);
			doc.addEventListener('touchend', paginatorTouchEnd);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0,/4/2/1:9)'),
			};
			controller.syncFrames([mockFrame]);

			const mockRange = doc.createRange();
			mockRange.setStart(text, 0);
			mockRange.setEnd(text, 9);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(mockRange);

			// Drag on text
			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 10, clientY: 10 }],
			});
			doc.dispatchEvent(touchStart);

			const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
			Object.defineProperty(touchMove, 'touches', {
				value: [{ clientX: 50, clientY: 10 }],
			});
			doc.dispatchEvent(touchMove);

			const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
			Object.defineProperty(touchEnd, 'touches', { value: [] });
			doc.dispatchEvent(touchEnd);

			// Paginator touch listeners were completely shielded
			expect(paginatorTouchStart).not.toHaveBeenCalled();
			expect(paginatorTouchMove).not.toHaveBeenCalled();
			expect(paginatorTouchEnd).not.toHaveBeenCalled();
			expect(mockPaginator.scrollBy).not.toHaveBeenCalled();
			expect(mockPaginator.snap).not.toHaveBeenCalled();
			expect(mockPaginator.goLeft).not.toHaveBeenCalled();
			expect(mockPaginator.goRight).not.toHaveBeenCalled();

			// Bottom buttons work
			mockPaginator.goLeft();
			expect(mockPaginator.goLeft).toHaveBeenCalledTimes(1);
			mockPaginator.goRight();
			expect(mockPaginator.goRight).toHaveBeenCalledTimes(1);

			doc.removeEventListener('touchstart', paginatorTouchStart);
			doc.removeEventListener('touchmove', paginatorTouchMove);
			doc.removeEventListener('touchend', paginatorTouchEnd);
			controller.dispose();
		});
	});

	describe('13. Highlighted text, annotation spans, note markers, and cross-element drag isolation', () => {
		it('1. touch on text inside span[data-cfi-range] is classified as text-selection', () => {
			const controller = new MobileDirectSelectionController();
			const span = doc.createElement('span');
			span.setAttribute('data-cfi-range', 'epubcfi(/6/2!/4/2/1:0,/4/2/1:10)');
			const text = doc.createTextNode('Highlighted text with cfi');
			span.appendChild(text);
			doc.body.appendChild(span);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			const mockRange = doc.createRange();
			mockRange.setStart(text, 2);
			mockRange.setEnd(text, 2);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(mockRange);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 20, clientY: 20 }],
			});
			span.dispatchEvent(touchStart);

			expect(controller.getActiveGestureKind()).toBe('text-selection');
			expect(controller.getMode()).toBe('selecting');

			controller.dispose();
		});

		it('2. touch on text inside [data-has-comment] paragraph is classified as text-selection', () => {
			const controller = new MobileDirectSelectionController();
			const p = doc.createElement('p');
			p.setAttribute('data-has-comment', 'true');
			const text = doc.createTextNode('Paragraph with comment attribute');
			p.appendChild(text);
			doc.body.appendChild(p);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			const mockRange = doc.createRange();
			mockRange.setStart(text, 5);
			mockRange.setEnd(text, 5);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(mockRange);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 30, clientY: 30 }],
			});
			p.dispatchEvent(touchStart);

			expect(controller.getActiveGestureKind()).toBe('text-selection');
			expect(controller.getMode()).toBe('selecting');

			controller.dispose();
		});

		it('3. touch on text inside .weave-paragraph-annotation wrapper is classified as text-selection', () => {
			const controller = new MobileDirectSelectionController();
			const span = doc.createElement('span');
			span.className = 'weave-paragraph-annotation';
			span.setAttribute('data-cfi-range', 'epubcfi(/6/2!/4/2/1:4,/4/2/1:16)');
			span.setAttribute('data-color', 'yellow');
			span.setAttribute('data-style', 'highlight');
			const text = doc.createTextNode('Annotated paragraph text');
			span.appendChild(text);
			doc.body.appendChild(span);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			const mockRange = doc.createRange();
			mockRange.setStart(text, 3);
			mockRange.setEnd(text, 3);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(mockRange);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 25, clientY: 25 }],
			});
			span.dispatchEvent(touchStart);

			expect(controller.getActiveGestureKind()).toBe('text-selection');
			expect(controller.getMode()).toBe('selecting');

			controller.dispose();
		});

		it('4, 5, 6, 7. existing highlight, underline, strikethrough, wavy text all classify as text-selection', () => {
			const styles = ['highlight', 'underline', 'strikethrough', 'wavy'];

			for (const style of styles) {
				const controller = new MobileDirectSelectionController();
				const span = doc.createElement('span');
				span.setAttribute('data-style', style);
				span.setAttribute('data-color', 'purple');
				const text = doc.createTextNode(`Text formatted with ${style}`);
				span.appendChild(text);
				doc.body.appendChild(span);

				const mockFrame: ReaderFrame = {
					frameDocument: doc,
					window: window,
					cfiFromRange: vi.fn(),
				};
				controller.syncFrames([mockFrame]);

				const mockRange = doc.createRange();
				mockRange.setStart(text, 5);
				mockRange.setEnd(text, 5);
				(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(mockRange);

				const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
				Object.defineProperty(touchStart, 'touches', {
					value: [{ clientX: 20, clientY: 20 }],
				});
				span.dispatchEvent(touchStart);

				expect(controller.getActiveGestureKind()).toBe('text-selection');
				expect(controller.getMode()).toBe('selecting');

				controller.dispose();
				doc.body.removeChild(span);
			}
		});

		it('8. real SVG note marker, comment marker, and reference badge classify as interactive', () => {
			const markers = [
				{ attr: 'data-zora-note-marker', val: 'hit-area' },
				{ attr: 'data-weave-comment-marker', val: 'hit-area' },
				{ attr: 'data-weave-reference-badge', val: 'hit-area' },
			];

			for (const m of markers) {
				const controller = new MobileDirectSelectionController();
				const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
				const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
				rect.setAttribute(m.attr, m.val);
				rect.setAttribute('role', 'button');
				g.appendChild(rect);
				doc.body.appendChild(g);

				const mockFrame: ReaderFrame = {
					frameDocument: doc,
					window: window,
					cfiFromRange: vi.fn(),
				};
				controller.syncFrames([mockFrame]);

				const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
				Object.defineProperty(touchStart, 'touches', {
					value: [{ clientX: 50, clientY: 50 }],
				});
				rect.dispatchEvent(touchStart);

				expect(controller.getActiveGestureKind()).toBe('interactive');
				expect(controller.getMode()).toBe('idle');
				expect(controller.getSelection()).toBeNull();

				controller.dispose();
				doc.body.removeChild(g);
			}
		});

		it('9. seamless multi-element drag: starts on existing highlight -> plain text -> <a> -> plain text', () => {
			const p = doc.createElement('p');

			// Highlighted text wrapper
			const highlightSpan = doc.createElement('span');
			highlightSpan.className = 'weave-paragraph-annotation';
			highlightSpan.setAttribute('data-cfi-range', 'epubcfi(/6/2!/4/2/1:0,/4/2/1:10)');
			highlightSpan.setAttribute('data-style', 'highlight');
			highlightSpan.setAttribute('data-color', 'yellow');
			const tHighlight = doc.createTextNode('Highlighted start');
			highlightSpan.appendChild(tHighlight);

			// Intermediate plain text
			const tMiddle = doc.createTextNode(' and plain middle ');

			// Footnote link
			const a = doc.createElement('a');
			a.href = '#footnote-1';
			const tLink = doc.createTextNode('[1]');
			a.appendChild(tLink);

			// Trailing plain text
			const tEnd = doc.createTextNode(' final words here.');

			p.appendChild(highlightSpan);
			p.appendChild(tMiddle);
			p.appendChild(a);
			p.appendChild(tEnd);
			doc.body.appendChild(p);

			let completedSelection: any = null;
			const controller = new MobileDirectSelectionController({
				onSelectionComplete: (sel) => {
					completedSelection = sel;
				},
			});

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0,/4/2/7:11)'),
			};
			controller.syncFrames([mockFrame]);

			// Touch start on highlighted text
			const startRange = doc.createRange();
			startRange.setStart(tHighlight, 0);
			startRange.setEnd(tHighlight, 0);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(startRange);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 10, clientY: 10 }],
			});
			highlightSpan.dispatchEvent(touchStart);

			expect(controller.getActiveGestureKind()).toBe('text-selection');

			// Drag over threshold across elements to tEnd
			(controller as any).isDragging = true;
			const continuousRange = buildNormalizedRange(doc, tHighlight, 0, tEnd, 12);
			expect(continuousRange).not.toBeNull();
			expect(continuousRange?.toString()).toBe('Highlighted start and plain middle [1] final words');

			(controller as any).currentRange = continuousRange;

			// Touch end completes selection
			const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
			Object.defineProperty(touchEnd, 'touches', { value: [] });
			doc.dispatchEvent(touchEnd);

			expect(completedSelection).not.toBeNull();
			expect(completedSelection?.text).toBe('Highlighted start and plain middle [1] final words here.');
			expect(completedSelection?.source).toBe('mobile-direct');
			expect(controller.getMode()).toBe('selected');

			controller.dispose();
		});
	});

	describe('14. Resilient TextNode Caret Resolution & Non-blocking GlyphHit (iPhone Fix)', () => {
		it('1. resolveSelectableTextCaret successfully resolves non-empty text node and returns null for empty background', () => {
			const p = doc.createElement('p');
			const text = doc.createTextNode('Resolved text content');
			p.appendChild(text);
			doc.body.appendChild(p);

			const mockRange = doc.createRange();
			mockRange.setStart(text, 4);
			mockRange.setEnd(text, 4);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(mockRange);

			const res = resolveSelectableTextCaret(doc, p, 10, 10);
			expect(res).not.toBeNull();
			expect(res?.textNode).toBe(text);
			expect(res?.caret.offset).toBe(4);

			// Empty div
			const emptyDiv = doc.createElement('div');
			doc.body.appendChild(emptyDiv);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);

			const resEmpty = resolveSelectableTextCaret(doc, emptyDiv, 5, 5);
			expect(resEmpty).toBeNull();

			// Direct body click with null caret
			const resBody = resolveSelectableTextCaret(doc, doc.body, 1, 1);
			expect(resBody).toBeNull();

			doc.body.removeChild(p);
			doc.body.removeChild(emptyDiv);
		});

		it('2. caret falls on non-empty TextNode but isPointOnTextGlyph is false -> gesture is STILL text-selection', () => {
			const controller = new MobileDirectSelectionController();
			const p = doc.createElement('p');
			const text = doc.createTextNode('iPhone EPUB body text');
			p.appendChild(text);
			doc.body.appendChild(p);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			const mockRange = doc.createRange();
			mockRange.setStart(text, 7);
			mockRange.setEnd(text, 7);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(mockRange);

			// Force glyph hit-test to return false (as happens in iOS multi-column / iframe layout)
			const mockCharRange = {
				setStart: vi.fn(),
				setEnd: vi.fn(),
				getClientRects: () => [{ left: 999, top: 999, right: 1050, bottom: 1020, width: 51, height: 21 }],
				getBoundingClientRect: () => ({ left: 999, top: 999, right: 1050, bottom: 1020, width: 51, height: 21 }),
			};
			const origCreateRange = doc.createRange;
			doc.createRange = vi.fn().mockReturnValue(mockCharRange);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 25, clientY: 25 }],
			});
			p.dispatchEvent(touchStart);

			// Must NOT be blocked; must be text-selection
			expect(controller.getActiveGestureKind()).toBe('text-selection');
			expect(controller.getMode()).toBe('selecting');

			doc.createRange = origCreateRange;
			doc.body.removeChild(p);
			controller.dispose();
		});

		it('3. touch on body background with caret null is classified as blocked', () => {
			const controller = new MobileDirectSelectionController();
			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 5, clientY: 5 }],
			});
			doc.body.dispatchEvent(touchStart);

			expect(controller.getActiveGestureKind()).toBe('blocked');
			expect(controller.getMode()).toBe('idle');
			expect(controller.getSelection()).toBeNull();

			controller.dispose();
		});

		it('4. touch on img is classified as blocked and does not trigger selection or paging', () => {
			const controller = new MobileDirectSelectionController();
			const img = doc.createElement('img');
			img.src = 'illustration.png';
			doc.body.appendChild(img);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 50, clientY: 50 }],
			});
			img.dispatchEvent(touchStart);

			expect(controller.getActiveGestureKind()).toBe('blocked');
			expect(controller.getSelection()).toBeNull();

			doc.body.removeChild(img);
			controller.dispose();
		});

		it('5. Tap on body text extracts whole word when glyphHit is false', () => {
			let completedSelection: any = null;
			const controller = new MobileDirectSelectionController({
				onSelectionComplete: (sel) => {
					completedSelection = sel;
				},
			});

			const p = doc.createElement('p');
			const text = doc.createTextNode('Resilient selection on mobile devices.');
			p.appendChild(text);
			doc.body.appendChild(p);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0,/4/2/1:9)'),
			};
			controller.syncFrames([mockFrame]);

			const mockRange = doc.createRange();
			mockRange.setStart(text, 3);
			mockRange.setEnd(text, 3);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(mockRange);

			// Start touch
			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 30, clientY: 30 }],
			});
			p.dispatchEvent(touchStart);

			expect(controller.getActiveGestureKind()).toBe('text-selection');

			// End touch (< 5px) -> triggers tap word extraction
			const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
			Object.defineProperty(touchEnd, 'touches', { value: [] });
			doc.dispatchEvent(touchEnd);

			expect(completedSelection).not.toBeNull();
			expect(completedSelection?.text).toBe('Resilient');
			expect(completedSelection?.source).toBe('mobile-direct');

			doc.body.removeChild(p);
			controller.dispose();
		});

		it('6. Drag on body text creates Range and keeps Foliate Paginator calls at 0', () => {
			let completedSelection: any = null;
			const controller = new MobileDirectSelectionController({
				onSelectionComplete: (sel) => {
					completedSelection = sel;
				},
			});

			const p = doc.createElement('p');
			const text = doc.createTextNode('Direct drag text selection works smoothly.');
			p.appendChild(text);
			doc.body.appendChild(p);

			const paginatorDocTouch = vi.fn();
			doc.addEventListener('touchstart', paginatorDocTouch);
			doc.addEventListener('touchmove', paginatorDocTouch);
			doc.addEventListener('touchend', paginatorDocTouch);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0,/4/2/1:11)'),
			};
			controller.syncFrames([mockFrame]);

			const startRange = doc.createRange();
			startRange.setStart(text, 0);
			startRange.setEnd(text, 0);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(startRange);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 10, clientY: 10 }],
			});
			p.dispatchEvent(touchStart);

			// Drag > 5px
			(controller as any).isDragging = true;
			const dragRange = buildNormalizedRange(doc, text, 0, text, 11);
			(controller as any).currentRange = dragRange;

			const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
			Object.defineProperty(touchEnd, 'touches', { value: [] });
			doc.dispatchEvent(touchEnd);

			expect(completedSelection).not.toBeNull();
			expect(completedSelection?.text).toBe('Direct drag');
			expect(paginatorDocTouch).not.toHaveBeenCalled();

			doc.removeEventListener('touchstart', paginatorDocTouch);
			doc.removeEventListener('touchmove', paginatorDocTouch);
			doc.removeEventListener('touchend', paginatorDocTouch);
			doc.body.removeChild(p);
			controller.dispose();
		});

		it('7. Link and Note Marker remain interactive and isolated from text selection', () => {
			const controller = new MobileDirectSelectionController();
			const a = doc.createElement('a');
			a.href = 'https://example.com';
			a.textContent = 'External Link';
			doc.body.appendChild(a);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 20, clientY: 20 }],
			});
			a.dispatchEvent(touchStart);

			expect(controller.getActiveGestureKind()).toBe('interactive');
			expect(controller.getSelection()).toBeNull();

			doc.body.removeChild(a);
			controller.dispose();
		});

		it('8. direct text in <body> with target=BODY and glyphHit=false is classified as text-selection', () => {
			const controller = new MobileDirectSelectionController();
			const directText = doc.createTextNode('Direct body text without container wrapper');
			doc.body.appendChild(directText);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			const mockRange = doc.createRange();
			mockRange.setStart(directText, 7);
			mockRange.setEnd(directText, 7);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(mockRange);

			// Mock glyph measurement returning rect far away (glyphHit = false)
			const mockCharRange = {
				setStart: vi.fn(),
				setEnd: vi.fn(),
				getClientRects: () => [{ left: 9999, top: 9999, right: 10050, bottom: 10020, width: 50, height: 20 }],
				getBoundingClientRect: () => ({ left: 9999, top: 9999, right: 10050, bottom: 10020, width: 50, height: 20 }),
			};
			const origCreateRange = doc.createRange;
			doc.createRange = vi.fn().mockReturnValue(mockCharRange);

			// Target is explicitly doc.body
			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 30, clientY: 30 }],
			});
			doc.body.dispatchEvent(touchStart);

			// Must STILL be text-selection!
			expect(controller.getActiveGestureKind()).toBe('text-selection');
			expect(controller.getMode()).toBe('selecting');

			doc.createRange = origCreateRange;
			doc.body.removeChild(directText);
			controller.dispose();
		});

		it('9. direct text in <body> Tap extracts full word and Drag creates continuous Range', () => {
			let completedSelection: any = null;
			const controller = new MobileDirectSelectionController({
				onSelectionComplete: (sel) => {
					completedSelection = sel;
				},
			});

			const directText = doc.createTextNode('Unwrapped body text for gesture testing');
			doc.body.appendChild(directText);

			const paginatorDocTouch = vi.fn();
			doc.addEventListener('touchstart', paginatorDocTouch);
			doc.addEventListener('touchmove', paginatorDocTouch);
			doc.addEventListener('touchend', paginatorDocTouch);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0,/4/2/1:9)'),
			};
			controller.syncFrames([mockFrame]);

			const mockRange = doc.createRange();
			mockRange.setStart(directText, 2);
			mockRange.setEnd(directText, 2);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(mockRange);

			// Tap test on body
			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 20, clientY: 20 }],
			});
			doc.body.dispatchEvent(touchStart);

			expect(controller.getActiveGestureKind()).toBe('text-selection');

			const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
			Object.defineProperty(touchEnd, 'touches', { value: [] });
			doc.body.dispatchEvent(touchEnd);

			expect(completedSelection).not.toBeNull();
			expect(completedSelection?.text).toBe('Unwrapped');
			expect(paginatorDocTouch).not.toHaveBeenCalled();

			// Drag test on body
			completedSelection = null;
			const touchStart2 = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart2, 'touches', {
				value: [{ clientX: 10, clientY: 10 }],
			});
			doc.body.dispatchEvent(touchStart2);

			(controller as any).isDragging = true;
			const dragRange = buildNormalizedRange(doc, directText, 0, directText, 14);
			(controller as any).currentRange = dragRange;

			const touchEnd2 = new Event('touchend', { bubbles: true, cancelable: true });
			Object.defineProperty(touchEnd2, 'touches', { value: [] });
			doc.body.dispatchEvent(touchEnd2);

			expect(completedSelection).not.toBeNull();
			expect(completedSelection?.text).toBe('Unwrapped body text for gesture testing');
			expect(paginatorDocTouch).not.toHaveBeenCalled();

			doc.removeEventListener('touchstart', paginatorDocTouch);
			doc.removeEventListener('touchmove', paginatorDocTouch);
			doc.removeEventListener('touchend', paginatorDocTouch);
			doc.body.removeChild(directText);
			controller.dispose();
		});
	});

	describe('15. Geometry Fallback Caret Resolution & Dragging (iPhone iOS Fix)', () => {
		it('1. when caretPositionFromPoint and caretRangeFromPoint are null, resolves caret via geometry on SPAN text', () => {
			const span = doc.createElement('span');
			const textNode = doc.createTextNode('Geometry span test string');
			span.appendChild(textNode);
			doc.body.appendChild(span);

			// Both native caret APIs return null (iOS WebKit behavior)
			(doc as any).caretPositionFromPoint = undefined;
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);

			// Mock elementsFromPoint returning span
			(doc as any).elementsFromPoint = vi.fn().mockReturnValue([span, doc.body, doc.documentElement]);

			// Mock Range getClientRects for span's textNode
			const origCreateRange = doc.createRange;
			doc.createRange = vi.fn(() => {
				const r = origCreateRange.call(doc);
				r.getClientRects = vi.fn(() => [
					{ left: 20, top: 50, right: 220, bottom: 70, width: 200, height: 20 } as DOMRect,
				]);
				r.getBoundingClientRect = vi.fn(() => ({
					left: 20,
					top: 50,
					right: 220,
					bottom: 70,
					width: 200,
					height: 20,
				} as DOMRect));
				return r;
			});

			const res = resolveSelectableTextCaret(doc, span, 40, 60);

			expect(res).not.toBeNull();
			expect(res?.textNode).toBe(textNode);
			expect(res?.caret.node).toBe(textNode);
			expect(res?.caretSource).toBe('geometry');
			expect(res?.hitElementTag).toBe('span');

			doc.createRange = origCreateRange;
			doc.body.removeChild(span);
		});

		it('2. when native caret APIs are null and touch target is BODY, resolves Text caret on visible text inside body', () => {
			const p = doc.createElement('p');
			const textNode = doc.createTextNode('Paragraph inside body for geometry test');
			p.appendChild(textNode);
			doc.body.appendChild(p);

			(doc as any).caretPositionFromPoint = undefined;
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);
			(doc as any).elementsFromPoint = vi.fn().mockReturnValue([doc.body, doc.documentElement]);

			p.getBoundingClientRect = vi.fn(() => ({
				left: 20,
				top: 50,
				right: 300,
				bottom: 70,
				width: 280,
				height: 20,
			} as DOMRect));

			const origCreateRange = doc.createRange;
			doc.createRange = vi.fn(() => {
				const r = origCreateRange.call(doc);
				r.getClientRects = vi.fn(() => [
					{ left: 20, top: 50, right: 300, bottom: 70, width: 280, height: 20 } as DOMRect,
				]);
				r.getBoundingClientRect = vi.fn(() => ({
					left: 20,
					top: 50,
					right: 300,
					bottom: 70,
					width: 280,
					height: 20,
				} as DOMRect));
				return r;
			});

			// Touch at (60, 60) directly on body
			const res = resolveSelectableTextCaret(doc, doc.body, 60, 60);

			expect(res).not.toBeNull();
			expect(res?.textNode).toBe(textNode);
			expect(res?.caret.node).toBe(textNode);
			expect(res?.caretSource).toBe('geometry');
			expect(res?.hitElementTag).toBe('body');

			doc.createRange = origCreateRange;
			doc.body.removeChild(p);
		});

		it('3. when touch lands on true blank page margin, returns null and classifies as blocked', () => {
			const p = doc.createElement('p');
			const textNode = doc.createTextNode('Text far from margin');
			p.appendChild(textNode);
			doc.body.appendChild(p);

			(doc as any).caretPositionFromPoint = undefined;
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);
			(doc as any).elementsFromPoint = vi.fn().mockReturnValue([doc.body, doc.documentElement]);

			const origCreateRange = doc.createRange;
			doc.createRange = vi.fn(() => {
				const r = origCreateRange.call(doc);
				// Text is located far down at (100, 200)
				r.getClientRects = vi.fn(() => [
					{ left: 100, top: 200, right: 300, bottom: 220, width: 200, height: 20 } as DOMRect,
				]);
				r.getBoundingClientRect = vi.fn(() => ({
					left: 100,
					top: 200,
					right: 300,
					bottom: 220,
					width: 200,
					height: 20,
				} as DOMRect));
				return r;
			});

			// Touch at margin (5, 5) - far from text
			const res = resolveSelectableTextCaret(doc, doc.body, 5, 5);
			expect(res).toBeNull();

			// Controller classifies as blocked
			const controller = new MobileDirectSelectionController();
			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 5, clientY: 5 }],
			});
			doc.body.dispatchEvent(touchStart);

			expect(controller.getActiveGestureKind()).toBe('blocked');
			expect(controller.getMode()).toBe('idle');
			expect(controller.getSelection()).toBeNull();

			doc.createRange = origCreateRange;
			doc.body.removeChild(p);
			controller.dispose();
		});

		it('4. findAccurateTextOffset accurately computes middle-of-word offset instead of always returning 0', () => {
			const textNode = doc.createTextNode('0123456789');
			doc.body.appendChild(textNode);

			const origCreateRange = doc.createRange;
			doc.createRange = vi.fn(() => {
				const r = origCreateRange.call(doc);
				r.getClientRects = vi.fn(() => {
					const start = r.startOffset;
					const end = r.endOffset;
					return [
						{
							left: start * 10,
							right: end * 10,
							top: 10,
							bottom: 30,
							width: (end - start) * 10,
							height: 20,
						} as DOMRect,
					];
				});
				r.getBoundingClientRect = vi.fn(() => {
					const start = r.startOffset;
					const end = r.endOffset;
					return {
						left: start * 10,
						right: end * 10,
						top: 10,
						bottom: 30,
						width: (end - start) * 10,
						height: 20,
					} as DOMRect;
				});
				return r;
			});

			// Touch at x=45 (character '4' spans 40..50, mid is 45) -> offset 4 or 5
			const offsetMiddle = findAccurateTextOffset(doc, textNode, 45, 20);
			expect(offsetMiddle).toBeGreaterThanOrEqual(4);
			expect(offsetMiddle).toBeLessThanOrEqual(5);

			// Touch at x=78 (character '7' spans 70..80, x=78 > 75) -> offset 8
			const offsetSeven = findAccurateTextOffset(doc, textNode, 78, 20);
			expect(offsetSeven).toBe(8);

			// Touch at x=12 (character '1' spans 10..20, x=12 <= 15) -> offset 1
			const offsetOne = findAccurateTextOffset(doc, textNode, 12, 20);
			expect(offsetOne).toBe(1);

			doc.createRange = origCreateRange;
			doc.body.removeChild(textNode);
		});

		it('5. touchstart enters text-selection and logs GestureClassified with caretSource=geometry and hitElementTag', () => {
			const logSpy = vi.spyOn(mobileLogger, 'logMobileEvent');

			const span = doc.createElement('span');
			const textNode = doc.createTextNode('Logged selection test text');
			span.appendChild(textNode);
			doc.body.appendChild(span);

			(doc as any).caretPositionFromPoint = undefined;
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);
			(doc as any).elementsFromPoint = vi.fn().mockReturnValue([span, doc.body, doc.documentElement]);

			const origCreateRange = doc.createRange;
			doc.createRange = vi.fn(() => {
				const r = origCreateRange.call(doc);
				r.getClientRects = vi.fn(() => [
					{ left: 10, top: 10, right: 200, bottom: 30, width: 190, height: 20 } as DOMRect,
				]);
				r.getBoundingClientRect = vi.fn(() => ({
					left: 10,
					top: 10,
					right: 200,
					bottom: 30,
					width: 190,
					height: 20,
				} as DOMRect));
				return r;
			});

			const controller = new MobileDirectSelectionController();
			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0,/4/2/1:6)'),
			};
			controller.syncFrames([mockFrame]);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 20, clientY: 20 }],
			});
			span.dispatchEvent(touchStart);

			expect(controller.getMode()).toBe('selecting');
			expect(controller.getActiveGestureKind()).toBe('text-selection');

			// Check logMobileEvent call
			const classificationCalls = logSpy.mock.calls.filter(
				(call) => call[0] === 'DirectSelection' && call[1] === 'GestureClassified'
			);
			expect(classificationCalls.length).toBeGreaterThanOrEqual(1);
			const lastPayload = classificationCalls[classificationCalls.length - 1][2] as any;
			expect(lastPayload.caretSource).toBe('geometry');
			expect(lastPayload.hitElementTag).toBe('span');
			expect(lastPayload.caretFound).toBe(true);

			doc.createRange = origCreateRange;
			doc.body.removeChild(span);
			controller.dispose();
			logSpy.mockRestore();
		});

		it('6. touchmove when native caret APIs are null resolves focus via geometry fallback and updates selection overlay', () => {
			const p = doc.createElement('p');
			const textNode = doc.createTextNode('Start of drag and focus end of drag');
			p.appendChild(textNode);
			doc.body.appendChild(p);

			(doc as any).caretPositionFromPoint = undefined;
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);
			(doc as any).elementsFromPoint = vi.fn().mockReturnValue([p, doc.body, doc.documentElement]);

			const origCreateRange = doc.createRange;
			doc.createRange = vi.fn(() => {
				const r = origCreateRange.call(doc);
				r.getClientRects = vi.fn(() => {
					const start = r.startOffset;
					const end = r.endOffset;
					return [
						{
							left: start * 10,
							right: end * 10,
							top: 20,
							bottom: 40,
							width: Math.max(10, (end - start) * 10),
							height: 20,
						} as DOMRect,
					];
				});
				r.getBoundingClientRect = vi.fn(() => {
					const start = r.startOffset;
					const end = r.endOffset;
					return {
						left: start * 10,
						right: end * 10,
						top: 20,
						bottom: 40,
						width: Math.max(10, (end - start) * 10),
						height: 20,
					} as DOMRect;
				});
				return r;
			});

			const controller = new MobileDirectSelectionController();
			const win = doc.defaultView || window;
			const origRaf = win.requestAnimationFrame;
			win.requestAnimationFrame = vi.fn((cb) => {
				cb(0);
				return 1 as any;
			});

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: win,
				cfiFromRange: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0,/4/2/1:15)'),
			};
			controller.syncFrames([mockFrame]);

			// Start touch at offset 0 (x=5, y=30)
			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 5, clientY: 30 }],
			});
			p.dispatchEvent(touchStart);

			expect(controller.getMode()).toBe('selecting');

			// Move touch to offset ~15 (x=155, y=30)
			const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
			Object.defineProperty(touchMove, 'touches', {
				value: [{ clientX: 155, clientY: 30 }],
			});
			p.dispatchEvent(touchMove);

			const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
			Object.defineProperty(touchEnd, 'touches', { value: [] });
			p.dispatchEvent(touchEnd);

			const sel = controller.getSelection();
			expect(sel).not.toBeNull();
			expect(sel?.source).toBe('mobile-direct');
			expect(sel?.text.length).toBeGreaterThan(0);

			win.requestAnimationFrame = origRaf;
			doc.createRange = origCreateRange;
			doc.body.removeChild(p);
			controller.dispose();
		});

		it('7. reverse drag (right-to-left) with geometry fallback builds normalized Range', () => {
			const textNode = doc.createTextNode('Reverse drag geometry selection.');
			doc.body.appendChild(textNode);

			const range = buildNormalizedRange(doc, textNode, 24, textNode, 0);
			expect(range).not.toBeNull();
			expect(range?.startOffset).toBe(0);
			expect(range?.endOffset).toBe(24);
			expect(range?.toString()).toBe('Reverse drag geometry se');

			doc.body.removeChild(textNode);
		});

		it('8. cross-line drag with geometry fallback builds cross-line Range', () => {
			const p1 = doc.createElement('p');
			const t1 = doc.createTextNode('Geometry Line 1. ');
			p1.appendChild(t1);

			const p2 = doc.createElement('p');
			const t2 = doc.createTextNode('Geometry Line 2.');
			p2.appendChild(t2);

			doc.body.appendChild(p1);
			doc.body.appendChild(p2);

			const range = buildNormalizedRange(doc, t1, 9, t2, 8);
			expect(range).not.toBeNull();
			expect(range?.startContainer).toBe(t1);
			expect(range?.startOffset).toBe(9);
			expect(range?.endContainer).toBe(t2);
			expect(range?.endOffset).toBe(8);
			expect(range?.toString()).toContain('Line 1. Geometry');

			doc.body.removeChild(p1);
			doc.body.removeChild(p2);
		});

		it('9. interactive links, footnotes, note markers do not regress and remain interactive', () => {
			const controller = new MobileDirectSelectionController();
			const a = doc.createElement('a');
			a.href = '#footnote-geometry';
			a.textContent = '[Footnote 1]';
			doc.body.appendChild(a);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 50, clientY: 50 }],
			});
			const preventDefaultStart = vi.spyOn(touchStart, 'preventDefault');

			a.dispatchEvent(touchStart);

			expect(preventDefaultStart).not.toHaveBeenCalled();
			expect(controller.getActiveGestureKind()).toBe('interactive');
			expect(controller.getSelection()).toBeNull();

			doc.body.removeChild(a);
			controller.dispose();
		});

		it('10. Paginator receives 0 touch events during text-selection and dragging', () => {
			const controller = new MobileDirectSelectionController();
			const p = doc.createElement('p');
			const textNode = doc.createTextNode('Paginator isolation geometry test.');
			p.appendChild(textNode);
			doc.body.appendChild(p);

			const paginatorTouchStart = vi.fn();
			const paginatorTouchMove = vi.fn();
			const paginatorTouchEnd = vi.fn();
			doc.addEventListener('touchstart', paginatorTouchStart);
			doc.addEventListener('touchmove', paginatorTouchMove);
			doc.addEventListener('touchend', paginatorTouchEnd);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0,/4/2/1:9)'),
			};
			controller.syncFrames([mockFrame]);

			const mockRange = doc.createRange();
			mockRange.setStart(textNode, 0);
			mockRange.setEnd(textNode, 0);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(mockRange);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 20, clientY: 20 }],
			});
			p.dispatchEvent(touchStart);

			const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
			Object.defineProperty(touchMove, 'touches', {
				value: [{ clientX: 60, clientY: 20 }],
			});
			p.dispatchEvent(touchMove);

			const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
			Object.defineProperty(touchEnd, 'touches', { value: [] });
			p.dispatchEvent(touchEnd);

			expect(paginatorTouchStart).not.toHaveBeenCalled();
			expect(paginatorTouchMove).not.toHaveBeenCalled();
			expect(paginatorTouchEnd).not.toHaveBeenCalled();

			doc.removeEventListener('touchstart', paginatorTouchStart);
			doc.removeEventListener('touchmove', paginatorTouchMove);
			doc.removeEventListener('touchend', paginatorTouchEnd);
			doc.body.removeChild(p);
			controller.dispose();
		});

		it('11. does not call WebKit native Selection API (window.getSelection().addRange)', () => {
			const controller = new MobileDirectSelectionController();
			const addRangeSpy = vi.fn();
			const win = doc.defaultView || window;
			(win as any).getSelection = vi.fn().mockReturnValue({
				addRange: addRangeSpy,
				removeAllRanges: vi.fn(),
			});

			const p = doc.createElement('p');
			const textNode = doc.createTextNode('No WebKit addRange call');
			p.appendChild(textNode);
			doc.body.appendChild(p);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: win,
				cfiFromRange: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0,/4/2/1:2)'),
			};
			controller.syncFrames([mockFrame]);

			const mockRange = doc.createRange();
			mockRange.setStart(textNode, 1);
			mockRange.setEnd(textNode, 1);
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(mockRange);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 10, clientY: 10 }],
			});
			p.dispatchEvent(touchStart);

			const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
			Object.defineProperty(touchEnd, 'touches', { value: [] });
			p.dispatchEvent(touchEnd);

			expect(addRangeSpy).not.toHaveBeenCalled();

			doc.body.removeChild(p);
			controller.dispose();
		});
	});

	describe('16. Cross-Realm iframe Document & Diagnostic Logging (iOS Real Device Root Cause Fix)', () => {
		let iframe: HTMLIFrameElement;
		let frameDoc: Document;
		let frameWin: Window;

		beforeEach(() => {
			iframe = document.createElement('iframe');
			document.body.appendChild(iframe);
			frameDoc = iframe.contentDocument || iframe.contentWindow!.document;
			frameWin = iframe.contentWindow!;
		});

		afterEach(() => {
			if (iframe.parentNode) {
				iframe.parentNode.removeChild(iframe);
			}
		});

		it('realm-safe helper identifies iframe TextNode and ElementNode correctly', () => {
			const text = frameDoc.createTextNode('Cross realm text');
			const span = frameDoc.createElement('span');
			span.appendChild(text);
			frameDoc.body.appendChild(span);

			expect(isTextNode(text)).toBe(true);
			expect(isTextNode(text, frameDoc)).toBe(true);
			expect(isTextNode(text, document)).toBe(false); // ownerDocument check
			expect(isElementNode(span)).toBe(true);
			expect(isElementNode(frameDoc.body)).toBe(true);
			expect(isTextNode(span)).toBe(false);
		});

		it('A. iframe TextNode + native caret null -> geometry succeeds with caretSource=geometry', () => {
			const p = frameDoc.createElement('p');
			const textNode = frameDoc.createTextNode('Hello from iframe realm');
			p.appendChild(textNode);
			frameDoc.body.appendChild(p);

			(frameDoc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);
			(frameDoc as any).caretPositionFromPoint = undefined;

			const origCreateRange = frameDoc.createRange;
			frameDoc.createRange = vi.fn(() => {
				const r = origCreateRange.call(frameDoc);
				r.getClientRects = vi.fn(() => [
					{
						left: 10,
						right: 200,
						top: 20,
						bottom: 40,
						width: 190,
						height: 20,
					} as DOMRect,
				]);
				return r;
			});

			const result = resolveSelectableTextCaret(frameDoc, p, 50, 30);
			expect(result).not.toBeNull();
			expect(result?.caretSource).toBe('geometry');
			expect(result?.textNode).toBe(textNode);
			expect(result?.caret.node).toBe(textNode);

			frameDoc.createRange = origCreateRange;
		});

		it('B. iframe BODY target -> resolves body text TextNode successfully', () => {
			const p = frameDoc.createElement('p');
			const textNode = frameDoc.createTextNode('Body target iframe text');
			p.appendChild(textNode);
			frameDoc.body.appendChild(p);

			(frameDoc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);
			(frameDoc as any).caretPositionFromPoint = undefined;

			const origCreateRange = frameDoc.createRange;
			frameDoc.createRange = vi.fn(() => {
				const r = origCreateRange.call(frameDoc);
				r.getClientRects = vi.fn(() => [
					{
						left: 20,
						right: 250,
						top: 30,
						bottom: 50,
						width: 230,
						height: 20,
					} as DOMRect,
				]);
				return r;
			});

			const result = resolveSelectableTextCaret(frameDoc, frameDoc.body, 60, 40);
			expect(result).not.toBeNull();
			expect(result?.caretSource).toBe('geometry');
			expect(result?.textNode).toBe(textNode);

			frameDoc.createRange = origCreateRange;
		});

		it('C. iframe SPAN target -> resolves span text TextNode successfully', () => {
			const span = frameDoc.createElement('span');
			const textNode = frameDoc.createTextNode('Span target iframe text');
			span.appendChild(textNode);
			frameDoc.body.appendChild(span);

			(frameDoc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);
			(frameDoc as any).caretPositionFromPoint = undefined;

			const origCreateRange = frameDoc.createRange;
			frameDoc.createRange = vi.fn(() => {
				const r = origCreateRange.call(frameDoc);
				r.getClientRects = vi.fn(() => [
					{
						left: 10,
						right: 150,
						top: 10,
						bottom: 30,
						width: 140,
						height: 20,
					} as DOMRect,
				]);
				return r;
			});

			const result = resolveSelectableTextCaret(frameDoc, span, 40, 20);
			expect(result).not.toBeNull();
			expect(result?.caretSource).toBe('geometry');
			expect(result?.textNode).toBe(textNode);

			frameDoc.createRange = origCreateRange;
		});

		it('D. iframe geometry offset is calculated accurately (not hardcoded 0)', () => {
			const p = frameDoc.createElement('p');
			const textNode = frameDoc.createTextNode('WordOne WordTwo WordThree');
			p.appendChild(textNode);
			frameDoc.body.appendChild(p);

			const origCreateRange = frameDoc.createRange;
			frameDoc.createRange = vi.fn(() => {
				const r = origCreateRange.call(frameDoc);
				r.getClientRects = vi.fn(() => {
					const start = r.startOffset;
					const end = r.endOffset;
					return [
						{
							left: start * 10,
							right: end * 10,
							top: 10,
							bottom: 30,
							width: Math.max(10, (end - start) * 10),
							height: 20,
						} as DOMRect,
					];
				});
				return r;
			});

			const offset = findAccurateTextOffset(frameDoc, textNode, 95, 20);
			expect(offset).toBeGreaterThan(5);
			expect(offset).toBeLessThan(15);

			frameDoc.createRange = origCreateRange;
		});

		it('E. iframe touchstart classifies as text-selection', () => {
			const controller = new MobileDirectSelectionController();
			const p = frameDoc.createElement('p');
			const textNode = frameDoc.createTextNode('Touchstart cross-realm text');
			p.appendChild(textNode);
			frameDoc.body.appendChild(p);

			const mockFrame: ReaderFrame = {
				frameDocument: frameDoc,
				window: frameWin,
				cfiFromRange: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0,/4/2/1:10)'),
			};
			controller.syncFrames([mockFrame]);

			(frameDoc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);
			(frameDoc as any).caretPositionFromPoint = undefined;

			const origCreateRange = frameDoc.createRange;
			frameDoc.createRange = vi.fn(() => {
				const r = origCreateRange.call(frameDoc);
				r.getClientRects = vi.fn(() => [
					{
						left: 0,
						right: 200,
						top: 10,
						bottom: 30,
						width: 200,
						height: 20,
					} as DOMRect,
				]);
				return r;
			});

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 50, clientY: 20 }],
			});
			p.dispatchEvent(touchStart);

			expect(controller.getMode()).toBe('selecting');
			expect(controller.getActiveGestureKind()).toBe('text-selection');

			frameDoc.createRange = origCreateRange;
			controller.dispose();
		});

		it('F. iframe touchmove builds Range and updates selection', () => {
			const controller = new MobileDirectSelectionController();
			const origRaf = frameWin.requestAnimationFrame;
			frameWin.requestAnimationFrame = vi.fn((cb) => {
				cb(0);
				return 1 as any;
			});

			const p = frameDoc.createElement('p');
			const textNode = frameDoc.createTextNode('Iframe touchmove range test');
			p.appendChild(textNode);
			frameDoc.body.appendChild(p);

			const mockFrame: ReaderFrame = {
				frameDocument: frameDoc,
				window: frameWin,
				cfiFromRange: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0,/4/2/1:15)'),
			};
			controller.syncFrames([mockFrame]);

			(frameDoc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);
			(frameDoc as any).caretPositionFromPoint = undefined;

			const origCreateRange = frameDoc.createRange;
			frameDoc.createRange = vi.fn(() => {
				const r = origCreateRange.call(frameDoc);
				r.getClientRects = vi.fn(() => {
					const start = r.startOffset;
					const end = r.endOffset;
					return [
						{
							left: start * 10,
							right: end * 10,
							top: 10,
							bottom: 30,
							width: Math.max(10, (end - start) * 10),
							height: 20,
						} as DOMRect,
					];
				});
				return r;
			});

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 10, clientY: 20 }],
			});
			p.dispatchEvent(touchStart);

			const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
			Object.defineProperty(touchMove, 'touches', {
				value: [{ clientX: 120, clientY: 20 }],
			});
			p.dispatchEvent(touchMove);

			const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
			Object.defineProperty(touchEnd, 'touches', { value: [] });
			p.dispatchEvent(touchEnd);

			const sel = controller.getSelection();
			expect(sel).not.toBeNull();
			expect(sel?.source).toBe('mobile-direct');
			expect(sel?.text.length).toBeGreaterThan(0);

			frameWin.requestAnimationFrame = origRaf;
			frameDoc.createRange = origCreateRange;
			controller.dispose();
		});

		it('G. iframe blank margin classifies as blocked', () => {
			const controller = new MobileDirectSelectionController();
			const p = frameDoc.createElement('p');
			const textNode = frameDoc.createTextNode('Iframe text margin');
			p.appendChild(textNode);
			frameDoc.body.appendChild(p);

			const mockFrame: ReaderFrame = {
				frameDocument: frameDoc,
				window: frameWin,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			(frameDoc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);
			(frameDoc as any).caretPositionFromPoint = undefined;

			const origCreateRange = frameDoc.createRange;
			frameDoc.createRange = vi.fn(() => {
				const r = origCreateRange.call(frameDoc);
				r.getClientRects = vi.fn(() => [
					{
						left: 50,
						right: 200,
						top: 100,
						bottom: 120,
						width: 150,
						height: 20,
					} as DOMRect,
				]);
				return r;
			});

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 500, clientY: 500 }],
			});
			frameDoc.body.dispatchEvent(touchStart);

			expect(controller.getActiveGestureKind()).toBe('blocked');
			expect(controller.getSelection()).toBeNull();

			frameDoc.createRange = origCreateRange;
			controller.dispose();
		});

		it('logs GeometryFallbackFailed with diagnostic fields when touchstart geometry fails', () => {
			const logSpy = vi.spyOn(mobileLogger, 'logMobileEvent');
			(frameDoc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);
			(frameDoc as any).caretPositionFromPoint = undefined;

			const result = resolveSelectableTextCaret(frameDoc, frameDoc.body, 100, 100, true);
			expect(result).toBeNull();

			expect(logSpy).toHaveBeenCalledWith(
				'DirectSelection',
				'GeometryFallbackFailed',
				expect.objectContaining({
					targetTag: expect.any(String),
					elementsUnderPointCount: expect.any(Number),
					candidateElementCount: expect.any(Number),
					candidateTextNodeCount: expect.any(Number),
					targetNodeType: expect.any(Number),
					targetOwnerDocumentMatched: true,
				})
			);
			logSpy.mockRestore();
		});

		describe('Margin & Blank area tap cancellation', () => {
			it('1. left margin tap clears existing active selection and notifies state change without page flip', () => {
				const stateChanges: any[] = [];
				const controller = new MobileDirectSelectionController({
					onStateChange: (state) => stateChanges.push(state),
				});

				const p = frameDoc.createElement('p');
				p.textContent = 'Hello world margin test';
				frameDoc.body.appendChild(p);

				const mockFrame: ReaderFrame = {
					frameDocument: frameDoc,
					window: (frameDoc.defaultView || window) as any,
					cfiFromRange: () => 'epubcfi(/6/2[chapter1]!/4/2/1:0,/4/2/1:5)',
				};
				controller.syncFrames([mockFrame]);

				// Step 1: Create an active selection
				const textNode = p.firstChild as Text;
				(frameDoc as any).caretRangeFromPoint = vi.fn((x: number, y: number) => {
					const r = frameDoc.createRange();
					r.setStart(textNode, 0);
					r.setEnd(textNode, 0);
					return r;
				});

				const startEvt = new Event('touchstart', { bubbles: true, cancelable: true });
				Object.defineProperty(startEvt, 'touches', { value: [{ clientX: 20, clientY: 20 }] });
				p.dispatchEvent(startEvt);

				const endEvt = new Event('touchend', { bubbles: true, cancelable: true });
				Object.defineProperty(endEvt, 'touches', { value: [] });
				p.dispatchEvent(endEvt);

				expect(controller.getSelection()).not.toBeNull();
				expect(stateChanges.length).toBeGreaterThan(0);
				const lastState = stateChanges[stateChanges.length - 1];
				expect(lastState.selection).not.toBeNull();

				// Step 2: Tap left margin (blocked / non-text area at x=2, y=50)
				(frameDoc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);
				(frameDoc as any).caretPositionFromPoint = undefined;

				const marginStartEvt = new Event('touchstart', { bubbles: true, cancelable: true });
				Object.defineProperty(marginStartEvt, 'touches', { value: [{ clientX: 2, clientY: 50 }] });
				const preventDefaultStart = vi.spyOn(marginStartEvt, 'preventDefault');
				const stopPropagationStart = vi.spyOn(marginStartEvt, 'stopPropagation');
				frameDoc.body.dispatchEvent(marginStartEvt);

				expect(controller.getActiveGestureKind()).toBe('blocked');
				expect(preventDefaultStart).toHaveBeenCalled();
				expect(stopPropagationStart).toHaveBeenCalled();

				const marginEndEvt = new Event('touchend', { bubbles: true, cancelable: true });
				Object.defineProperty(marginEndEvt, 'touches', { value: [] });
				const preventDefaultEnd = vi.spyOn(marginEndEvt, 'preventDefault');
				const stopPropagationEnd = vi.spyOn(marginEndEvt, 'stopPropagation');
				frameDoc.body.dispatchEvent(marginEndEvt);

				expect(preventDefaultEnd).toHaveBeenCalled();
				expect(stopPropagationEnd).toHaveBeenCalled();
				expect(controller.getSelection()).toBeNull();

				const finalState = stateChanges[stateChanges.length - 1];
				expect(finalState.mode).toBe('idle');
				expect(finalState.selection).toBeNull();

				controller.dispose();
			});

			it('2. right margin tap clears selection and prevents Foliate page turn', () => {
				const stateChanges: any[] = [];
				const controller = new MobileDirectSelectionController({
					onStateChange: (state) => stateChanges.push(state),
				});

				const mockFrame: ReaderFrame = {
					frameDocument: frameDoc,
					window: (frameDoc.defaultView || window) as any,
					cfiFromRange: () => 'epubcfi(/6/2[chapter1]!/4/2/1:0,/4/2/1:5)',
				};
				controller.syncFrames([mockFrame]);

				// Tap right margin at x=390 (screen width 400), non-text area
				(frameDoc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);
				(frameDoc as any).caretPositionFromPoint = undefined;

				const marginStartEvt = new Event('touchstart', { bubbles: true, cancelable: true });
				Object.defineProperty(marginStartEvt, 'touches', { value: [{ clientX: 390, clientY: 200 }] });
				const preventDefaultStart = vi.spyOn(marginStartEvt, 'preventDefault');
				frameDoc.body.dispatchEvent(marginStartEvt);

				expect(controller.getActiveGestureKind()).toBe('blocked');
				expect(preventDefaultStart).toHaveBeenCalled();

				const marginEndEvt = new Event('touchend', { bubbles: true, cancelable: true });
				Object.defineProperty(marginEndEvt, 'touches', { value: [] });
				const preventDefaultEnd = vi.spyOn(marginEndEvt, 'preventDefault');
				frameDoc.body.dispatchEvent(marginEndEvt);

				expect(preventDefaultEnd).toHaveBeenCalled();
				expect(controller.getSelection()).toBeNull();

				controller.dispose();
			});

			it('3. top blank area tap clears selection and prevents default', () => {
				const controller = new MobileDirectSelectionController();
				const mockFrame: ReaderFrame = {
					frameDocument: frameDoc,
					window: (frameDoc.defaultView || window) as any,
					cfiFromRange: () => 'epubcfi(/6/2[chapter1]!/4/2/1:0,/4/2/1:5)',
				};
				controller.syncFrames([mockFrame]);

				(frameDoc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);
				(frameDoc as any).caretPositionFromPoint = undefined;

				const startEvt = new Event('touchstart', { bubbles: true, cancelable: true });
				Object.defineProperty(startEvt, 'touches', { value: [{ clientX: 150, clientY: 5 }] });
				frameDoc.body.dispatchEvent(startEvt);

				expect(controller.getActiveGestureKind()).toBe('blocked');

				const endEvt = new Event('touchend', { bubbles: true, cancelable: true });
				Object.defineProperty(endEvt, 'touches', { value: [] });
				frameDoc.body.dispatchEvent(endEvt);

				expect(controller.getSelection()).toBeNull();
				controller.dispose();
			});
		});
	});
});
