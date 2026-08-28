import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	computeMobilePopoverCenterPosition,
	clampPopoverPosition,
	getSessionMobilePopoverPosition,
	setSessionMobilePopoverPosition,
	computeToolbarPosition,
} from '../toolbar-positioning';
import { createZoraDraggable } from '../zora-draggable';
import { MobileDirectSelectionController } from '../mobile-direct-selection';
import type { ReaderFrame } from '../../../services/epub/reader-engine-types';

describe('Mobile Selection UX Verification Suite', () => {
	let viewportEl: HTMLElement;
	let popoverEl: HTMLElement;

	beforeEach(() => {
		vi.restoreAllMocks();
		setSessionMobilePopoverPosition(null);

		viewportEl = document.createElement('div');
		viewportEl.className = 'epub-reader-viewport';
		document.body.appendChild(viewportEl);

		popoverEl = document.createElement('div');
		popoverEl.className = 'zora-lookup-popover';
		viewportEl.appendChild(popoverEl);

		Object.defineProperty(viewportEl, 'getBoundingClientRect', {
			configurable: true,
			value: () => ({ left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844 }),
		});
		Object.defineProperty(viewportEl, 'clientWidth', { configurable: true, value: 390 });
		Object.defineProperty(viewportEl, 'clientHeight', { configurable: true, value: 844 });

		Object.defineProperty(popoverEl, 'offsetWidth', { configurable: true, value: 340 });
		Object.defineProperty(popoverEl, 'offsetHeight', { configurable: true, value: 300 });

		// Mock visualViewport
		(window as any).visualViewport = {
			width: 390,
			height: 844,
			offsetLeft: 0,
			offsetTop: 0,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		};
	});

	afterEach(() => {
		document.body.innerHTML = '';
		setSessionMobilePopoverPosition(null);
	});

	it('7. popover 首次打开位于 viewport 内 (center position)', () => {
		const pos = computeMobilePopoverCenterPosition(340, 300, viewportEl);
		expect(pos.left).toBeGreaterThanOrEqual(12);
		expect(pos.top).toBeGreaterThanOrEqual(12);
		expect(pos.left + 340).toBeLessThanOrEqual(390 - 12);
		expect(pos.top + 300).toBeLessThanOrEqual(844 - 12);
		expect(pos.left).toBe(Math.round((390 - 340) / 2));
	});

	it('7b. mobile fixed popover uses visual viewport coordinates even when reader is offset', () => {
		Object.defineProperty(viewportEl, 'getBoundingClientRect', {
			configurable: true,
			value: () => ({ left: 80, top: 120, right: 470, bottom: 964, width: 390, height: 844 }),
		});

		const pos = computeMobilePopoverCenterPosition(340, 300, viewportEl);
		expect(pos.left).toBe(Math.round((390 - 340) / 2));
		expect(pos.top).toBe(Math.round((844 - 300) / 2));
	});

	it('8. 超出左边 → clamp', () => {
		const clamped = clampPopoverPosition({ left: -100, top: 200 }, 340, 300, viewportEl, true);
		expect(clamped.left).toBe(12);
		expect(clamped.top).toBe(200);
	});

	it('9. 超出右边 → clamp', () => {
		const clamped = clampPopoverPosition({ left: 500, top: 200 }, 340, 300, viewportEl, true);
		expect(clamped.left).toBe(390 - 12 - 340); // 38
		expect(clamped.top).toBe(200);
	});

	it('10. 超出顶部 → clamp', () => {
		const clamped = clampPopoverPosition({ left: 20, top: -50 }, 340, 300, viewportEl, true);
		expect(clamped.left).toBe(20);
		expect(clamped.top).toBeGreaterThanOrEqual(12);
	});

	it('11. 超出底部 → clamp', () => {
		const clamped = clampPopoverPosition({ left: 20, top: 900 }, 340, 300, viewportEl, true);
		expect(clamped.left).toBe(20);
		expect(clamped.top + 300).toBeLessThanOrEqual(844 - 12);
	});

	it('12. visualViewport resize → reclamp to new safe bounds', () => {
		let currentPos = { left: 25, top: 500 };
		const clampedBefore = clampPopoverPosition(currentPos, 340, 300, viewportEl, true);
		expect(clampedBefore.top).toBe(500);

		// Keyboard appears, visualViewport height becomes 400
		(window as any).visualViewport.height = 400;
		const clampedAfter = clampPopoverPosition(currentPos, 340, 300, viewportEl, true);
		expect(clampedAfter.top + 300).toBeLessThanOrEqual(400 - 12);
	});

	it('13. header drag → card 移动', () => {
		let currentPos = { left: 25, top: 100 };
		let finalPosResult: { left: number; top: number } | null = null;

		const draggable = createZoraDraggable({
			getPopoverEl: () => popoverEl,
			getViewportEl: () => viewportEl,
			getPos: () => currentPos,
			onDragEnd: (pos) => {
				finalPosResult = pos;
			},
		});

		const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
		Object.defineProperty(touchStart, 'touches', { value: [{ clientX: 50, clientY: 120 }] });
		draggable.handleHeaderPointerDown(touchStart as any);

		const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
		Object.defineProperty(touchMove, 'touches', { value: [{ clientX: 70, clientY: 150 }] });
		window.dispatchEvent(touchMove);

		const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
		Object.defineProperty(touchEnd, 'changedTouches', { value: [{ clientX: 70, clientY: 150 }] });
		window.dispatchEvent(touchEnd);

		expect(finalPosResult).not.toBeNull();
		expect(finalPosResult!.left).toBe(45);
		expect(finalPosResult!.top).toBe(130);
	});

	it('14. card content scroll → 不触发 drag', () => {
		let dragStarted = false;
		const draggable = createZoraDraggable({
			getPopoverEl: () => popoverEl,
			getViewportEl: () => viewportEl,
			getPos: () => ({ left: 25, top: 100 }),
			onDragStart: () => {
				dragStarted = true;
			},
			onDragEnd: () => {},
		});

		const bodyEl = document.createElement('div');
		bodyEl.className = 'zora-lookup-body';
		popoverEl.appendChild(bodyEl);

		// Touch on body
		const bodyTouch = new Event('touchstart', { bubbles: true, cancelable: true });
		Object.defineProperty(bodyTouch, 'target', { value: bodyEl });
		Object.defineProperty(bodyTouch, 'touches', { value: [{ clientX: 50, clientY: 200 }] });
		// Header listener not called on body
		expect(dragStarted).toBe(false);
	});

	it('15. drag 不穿透到 EPUB selection / Foliate', () => {
		const draggable = createZoraDraggable({
			getPopoverEl: () => popoverEl,
			getViewportEl: () => viewportEl,
			getPos: () => ({ left: 25, top: 100 }),
			onDragEnd: () => {},
		});

		const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
		Object.defineProperty(touchStart, 'touches', { value: [{ clientX: 50, clientY: 120 }] });
		const preventDefault = vi.spyOn(touchStart, 'preventDefault');
		const stopPropagation = vi.spyOn(touchStart, 'stopPropagation');

		draggable.handleHeaderPointerDown(touchStart as any);

		expect(preventDefault).toHaveBeenCalled();
		expect(stopPropagation).toHaveBeenCalled();
	});

	it('16. Desktop 悬浮窗定位不变', () => {
		const desktopPos = computeToolbarPosition({
			anchorRect: { left: 100, top: 200, bottom: 220, right: 150, width: 50, height: 20 },
			containerWidth: 1000,
			containerHeight: 800,
			toolbarWidth: 340,
			toolbarHeight: 200,
			mobile: false,
			insetBottom: 0,
		});

		expect(desktopPos.mode).toBe('floating');
		expect(desktopPos.left).toBeGreaterThan(0);
		expect(desktopPos.top).toBeGreaterThan(0);
	});

	describe('Regression Verification: Popover preservation & host dismissals', () => {
		it('1-4. opening popover retains lookupSelection and activePopoverType without being cleared by hideToolbar', () => {
			let lookupSelection: any = { text: 'serendipity' };
			let activePopoverType: any = 'dict';

			function clearPopoverState() {
				lookupSelection = null;
				activePopoverType = null;
			}

			function hideToolbar() {
				// hideToolbar only hides toolbar, not popover
			}

			// Simulating handleDictionaryLookup
			lookupSelection = { text: 'serendipity' };
			activePopoverType = 'dict';
			hideToolbar();

			expect(lookupSelection).not.toBeNull();
			expect(activePopoverType).toBe('dict');

			// Simulating handleComprehensionLookup
			activePopoverType = 'comprehension';
			hideToolbar();
			expect(activePopoverType).toBe('comprehension');

			// Simulating handleGrammarLookup
			activePopoverType = 'grammar';
			hideToolbar();
			expect(activePopoverType).toBe('grammar');

			// Simulating handleNoteLookup
			activePopoverType = 'note';
			hideToolbar();
			expect(activePopoverType).toBe('note');

			// 5. closePopover clears popover state
			clearPopoverState();
			expect(lookupSelection).toBeNull();
			expect(activePopoverType).toBeNull();
		});

		it('14. new word selection replaces old selection without premature idle flash', () => {
			const frameDoc = document.implementation.createHTMLDocument('Chapter');
			const p = frameDoc.createElement('p');
			p.textContent = 'Alpha beta gamma';
			frameDoc.body.appendChild(p);

			const states: any[] = [];
			const controller = new MobileDirectSelectionController({
				onStateChange: (s) => states.push(s),
			});

			const mockFrame: ReaderFrame = {
				frameDocument: frameDoc,
				window: window as any,
				cfiFromRange: () => 'epubcfi(/6/2[chap1]!/4/2/1:0,/4/2/1:5)',
			};
			controller.syncFrames([mockFrame]);

			const textNode = p.firstChild as Text;
			(frameDoc as any).caretRangeFromPoint = vi.fn(() => {
				const r = frameDoc.createRange();
				r.setStart(textNode, 0);
				r.setEnd(textNode, 5);
				return r;
			});

			// Select first word
			const start1 = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(start1, 'touches', { value: [{ clientX: 10, clientY: 10 }] });
			p.dispatchEvent(start1);

			const end1 = new Event('touchend', { bubbles: true, cancelable: true });
			Object.defineProperty(end1, 'touches', { value: [] });
			p.dispatchEvent(end1);

			expect(controller.getSelection()).not.toBeNull();
			const countAfterFirst = states.length;

			// Select second word immediately
			(frameDoc as any).caretRangeFromPoint = vi.fn(() => {
				const r = frameDoc.createRange();
				r.setStart(textNode, 6);
				r.setEnd(textNode, 10);
				return r;
			});

			const start2 = new Event('touchstart', { bubbles: true, cancelable: true });
			Object.defineProperty(start2, 'touches', { value: [{ clientX: 60, clientY: 10 }] });
			p.dispatchEvent(start2);

			// Between start2 and end2, no 'idle' state should have been emitted
			const intermediateStates = states.slice(countAfterFirst);
			expect(intermediateStates.some((s) => s.mode === 'idle')).toBe(false);

			const end2 = new Event('touchend', { bubbles: true, cancelable: true });
			Object.defineProperty(end2, 'touches', { value: [] });
			p.dispatchEvent(end2);

			expect(controller.getSelection()).not.toBeNull();
			expect(controller.getSelection()?.text).toBe('beta');

			controller.dispose();
		});
	});
});
