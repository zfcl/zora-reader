import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	buildNormalizedRange,
	getCaretPositionFromPoint,
	extractWordRangeFromTextNode,
	isPointOnTextGlyph,
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

		it('11 & 12. paragraph margin tap/drag is blocked: no selection, no page flip', () => {
			const controller = new MobileDirectSelectionController();
			const p = doc.createElement('p');
			p.style.margin = '40px';
			p.textContent = 'Paragraph with margins';
			doc.body.appendChild(p);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn(),
			};
			controller.syncFrames([mockFrame]);

			// Caret lookup returns null or far from glyph
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);

			const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(touchStart, 'touches', {
				value: [{ clientX: 5, clientY: 5 }],
			});
			const preventDefaultStart = vi.spyOn(touchStart, 'preventDefault');

			p.dispatchEvent(touchStart);

			expect(preventDefaultStart).toHaveBeenCalled();
			expect(controller.getActiveGestureKind()).toBe('blocked');

			const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
			Object.defineProperty(touchMove, 'touches', {
				value: [{ clientX: 20, clientY: 5 }],
			});
			const preventDefaultMove = vi.spyOn(touchMove, 'preventDefault');
			p.dispatchEvent(touchMove);

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

		it('14. caretRangeFromPoint returns TextNode but point is not on glyph rect -> blocked', () => {
			const text = doc.createTextNode('Short text');
			doc.body.appendChild(text);

			const caretPos = { node: text, offset: 5 };

			// Character rect at (10, 10) to (50, 30)
			const mockCharRange = {
				setStart: vi.fn(),
				setEnd: vi.fn(),
				getClientRects: () => [{ left: 10, top: 10, right: 50, bottom: 30, width: 40, height: 20 }],
				getBoundingClientRect: () => ({ left: 10, top: 10, right: 50, bottom: 30, width: 40, height: 20 }),
			};
			const origCreateRange = doc.createRange;
			doc.createRange = vi.fn().mockReturnValue(mockCharRange);

			// Touch point far away at (300, 300)
			const isHit = isPointOnTextGlyph(doc, caretPos, 300, 300, 5);
			expect(isHit).toBe(false);

			// Touch point right on glyph at (20, 20)
			const isOn = isPointOnTextGlyph(doc, caretPos, 20, 20, 5);
			expect(isOn).toBe(true);

			doc.createRange = origCreateRange;
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
			expect(completedSelection?.text).toBe('Highlighted start and plain middle [1] final words');
			expect(completedSelection?.source).toBe('mobile-direct');
			expect(controller.getMode()).toBe('selected');

			controller.dispose();
		});
	});
});
