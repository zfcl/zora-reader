import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	buildNormalizedRange,
	getCaretPositionFromPoint,
	MobileSelectionOverlay,
	MobileCustomSelectionController,
} from '../mobile-custom-selection';
import type { ReaderFrame } from '../../../services/epub/reader-engine-types';

describe('mobile-custom-selection', () => {
	let doc: Document;

	beforeEach(() => {
		doc = document.implementation.createHTMLDocument('Test Document');
	});

	describe('buildNormalizedRange', () => {
		it('builds forward range within the same text node', () => {
			const p = doc.createElement('p');
			const textNode = doc.createTextNode('The quick brown fox jumps');
			p.appendChild(textNode);
			doc.body.appendChild(p);

			const range = buildNormalizedRange(doc, textNode, 4, textNode, 9);
			expect(range).not.toBeNull();
			expect(range?.startContainer).toBe(textNode);
			expect(range?.startOffset).toBe(4);
			expect(range?.endContainer).toBe(textNode);
			expect(range?.endOffset).toBe(9);
			expect(range?.toString()).toBe('quick');
		});

		it('normalizes backward range within the same text node', () => {
			const p = doc.createElement('p');
			const textNode = doc.createTextNode('The quick brown fox jumps');
			p.appendChild(textNode);
			doc.body.appendChild(p);

			const range = buildNormalizedRange(doc, textNode, 9, textNode, 4);
			expect(range).not.toBeNull();
			expect(range?.startContainer).toBe(textNode);
			expect(range?.startOffset).toBe(4);
			expect(range?.endContainer).toBe(textNode);
			expect(range?.endOffset).toBe(9);
			expect(range?.toString()).toBe('quick');
		});

		it('returns null for collapsed same-node positions', () => {
			const p = doc.createElement('p');
			const textNode = doc.createTextNode('Hello world');
			p.appendChild(textNode);
			doc.body.appendChild(p);

			const range = buildNormalizedRange(doc, textNode, 5, textNode, 5);
			expect(range).toBeNull();
		});

		it('builds forward range across multiple text nodes and inline spans', () => {
			const p = doc.createElement('p');
			const text1 = doc.createTextNode('Hello ');
			const span = doc.createElement('span');
			const textSpan = doc.createTextNode('brave new');
			span.appendChild(textSpan);
			const text2 = doc.createTextNode(' world today');
			p.appendChild(text1);
			p.appendChild(span);
			p.appendChild(text2);
			doc.body.appendChild(p);

			const range = buildNormalizedRange(doc, text1, 2, text2, 6);
			expect(range).not.toBeNull();
			expect(range?.startContainer).toBe(text1);
			expect(range?.startOffset).toBe(2);
			expect(range?.endContainer).toBe(text2);
			expect(range?.endOffset).toBe(6);
			expect(range?.toString()).toBe('llo brave new world');
		});

		it('normalizes backward range across multiple text nodes', () => {
			const p = doc.createElement('p');
			const text1 = doc.createTextNode('First paragraph sentence. ');
			const text2 = doc.createTextNode('Second sentence here.');
			p.appendChild(text1);
			p.appendChild(text2);
			doc.body.appendChild(p);

			// Backward: from text2 (offset 6) back to text1 (offset 6)
			const range = buildNormalizedRange(doc, text2, 6, text1, 6);
			expect(range).not.toBeNull();
			expect(range?.startContainer).toBe(text1);
			expect(range?.startOffset).toBe(6);
			expect(range?.endContainer).toBe(text2);
			expect(range?.endOffset).toBe(6);
			expect(range?.toString()).toBe('paragraph sentence. Second');
		});

		it('handles null arguments safely', () => {
			const text = doc.createTextNode('text');
			expect(buildNormalizedRange(doc, null as any, 0, text, 1)).toBeNull();
			expect(buildNormalizedRange(doc, text, 0, null as any, 1)).toBeNull();
			expect(buildNormalizedRange(null as any, text, 0, text, 1)).toBeNull();
		});
	});

	describe('getCaretPositionFromPoint', () => {
		it('extracts caret position via caretRangeFromPoint fallback', () => {
			const p = doc.createElement('p');
			const text = doc.createTextNode('Testing point lookup');
			p.appendChild(text);
			doc.body.appendChild(p);

			const mockRange = doc.createRange();
			mockRange.setStart(text, 8);
			mockRange.setEnd(text, 8);

			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(mockRange);

			const result = getCaretPositionFromPoint(doc, 100, 200);
			expect(result).not.toBeNull();
			expect(result?.node).toBe(text);
			expect(result?.offset).toBe(8);
		});

		it('extracts caret position via standard caretPositionFromPoint', () => {
			const p = doc.createElement('p');
			const text = doc.createTextNode('Standard caret position');
			p.appendChild(text);
			doc.body.appendChild(p);

			(doc as any).caretPositionFromPoint = vi.fn().mockReturnValue({
				offsetNode: text,
				offset: 5,
			});

			const result = getCaretPositionFromPoint(doc, 50, 60);
			expect(result).not.toBeNull();
			expect(result?.node).toBe(text);
			expect(result?.offset).toBe(5);
		});

		it('returns null if no caret position is found', () => {
			(doc as any).caretPositionFromPoint = undefined;
			(doc as any).caretRangeFromPoint = vi.fn().mockReturnValue(null);

			const result = getCaretPositionFromPoint(doc, 0, 0);
			expect(result).toBeNull();
		});
	});

	describe('MobileSelectionOverlay', () => {
		it('renders overlay boxes and clears properly', () => {
			const overlay = new MobileSelectionOverlay(doc);
			const p = doc.createElement('p');
			const text = doc.createTextNode('Overlay test paragraph text');
			p.appendChild(text);
			doc.body.appendChild(p);

			const range = doc.createRange();
			range.setStart(text, 0);
			range.setEnd(text, 12);

			(range as any).getClientRects = vi.fn().mockReturnValue([
				{ top: 10, left: 20, width: 100, height: 20, bottom: 30, right: 120 },
				{ top: 35, left: 20, width: 80, height: 20, bottom: 55, right: 100 },
			]);

			overlay.render(range);

			const container = doc.querySelector('.zora-custom-selection-overlay-layer');
			expect(container).not.toBeNull();
			const boxes = doc.querySelectorAll('.zora-custom-selection-box');
			expect(boxes.length).toBe(2);

			overlay.clear();
			expect(doc.querySelector('.zora-custom-selection-overlay-layer')).toBeNull();
		});
	});

	describe('MobileCustomSelectionController', () => {
		it('manages state lifecycle transitions', () => {
			const states: string[] = [];
			const controller = new MobileCustomSelectionController({
				onStateChange: (s) => states.push(s.mode),
			});

			expect(controller.getMode()).toBe('idle');
			expect(controller.isArmed()).toBe(false);

			controller.arm();
			expect(controller.getMode()).toBe('armed');
			expect(controller.isArmed()).toBe(true);

			controller.cancel();
			expect(controller.getMode()).toBe('idle');
			expect(controller.isArmed()).toBe(false);

			expect(states).toEqual(['armed', 'idle']);
			controller.dispose();
		});

		it('updates expanded sentence selection context', () => {
			const controller = new MobileCustomSelectionController();
			const p = doc.createElement('p');
			const text = doc.createTextNode('Initial short. Expanded full sentence here.');
			p.appendChild(text);
			doc.body.appendChild(p);

			const range1 = doc.createRange();
			range1.setStart(text, 0);
			range1.setEnd(text, 7);
			(range1 as any).getClientRects = vi.fn().mockReturnValue([
				{ top: 0, left: 0, width: 50, height: 20, bottom: 20, right: 50 },
			]);
			(range1 as any).getBoundingClientRect = vi.fn().mockReturnValue(
				{ top: 0, left: 0, width: 50, height: 20, bottom: 20, right: 50 }
			);

			const mockFrame: ReaderFrame = {
				frameDocument: doc,
				window: window,
				cfiFromRange: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0,/4/2/1:7)'),
			};

			controller.syncFrames([mockFrame]);

			// Simulate selection completed
			const initialContext = {
				source: 'mobile-custom' as const,
				range: range1,
				text: 'Initial',
				cfiRange: 'epubcfi(/6/2!/4/2/1:0,/4/2/1:7)',
				rect: new DOMRect(0, 0, 50, 20),
				rects: [new DOMRect(0, 0, 50, 20)],
				frame: mockFrame,
				frameDocument: doc,
				clear: vi.fn(),
			};

			// Assign active selection
			(controller as any).activeSelection = initialContext;

			const range2 = doc.createRange();
			range2.setStart(text, 0);
			range2.setEnd(text, 43);
			(range2 as any).getClientRects = vi.fn().mockReturnValue([
				{ top: 0, left: 0, width: 250, height: 20, bottom: 20, right: 250 },
			]);
			(range2 as any).getBoundingClientRect = vi.fn().mockReturnValue(
				{ top: 0, left: 0, width: 250, height: 20, bottom: 20, right: 250 }
			);

			controller.updateExpandedSentence(
				range2,
				'Initial short. Expanded full sentence here.',
				'epubcfi(/6/2!/4/2/1:0,/4/2/1:43)'
			);

			const updated = controller.getSelection();
			expect(updated).not.toBeNull();
			expect(updated?.text).toBe('Initial short. Expanded full sentence here.');
			expect(updated?.cfiRange).toBe('epubcfi(/6/2!/4/2/1:0,/4/2/1:43)');

			controller.clearSelection();
			expect(controller.getSelection()).toBeNull();
			controller.dispose();
		});
	});
});
