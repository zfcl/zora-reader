import {
	computeToolbarPosition,
	createEventBinder,
	estimateNativeSelectionMenuSide,
	isEventInsideObsidianFloatingUi,
	isEventOutsideToolbar,
	mirrorFloatingSide,
	resolveMobileFloatingInsetBottom,
	shouldDismissToolbarOnPointerDown,
} from './toolbar-positioning';

describe('toolbar-positioning', () => {
	it('always docks mobile toolbars at the bottom decoupled from selection', () => {
		const anchorRect = { top: 80, left: 40, bottom: 96, right: 96, width: 56, height: 16 };
		const result = computeToolbarPosition({
			anchorRect,
			containerWidth: 320,
			containerHeight: 480,
			toolbarWidth: 280,
			toolbarHeight: 72,
			mobile: true,
		});

		expect(result.mode).toBe('docked');
		expect(result.top).toBe(0);
		expect(result.left).toBe(20);
		expect(result.arrowOffset).toBe(0);
		expect(result.anchorRect).toEqual(anchorRect);
	});

	it('docks mobile toolbars with horizontally clamped centered position', () => {
		const anchorRect = { top: 120, left: 140, bottom: 144, right: 204, width: 64, height: 24 };
		const result = computeToolbarPosition({
			anchorRect,
			containerWidth: 390,
			containerHeight: 720,
			toolbarWidth: 220,
			toolbarHeight: 72,
			mobile: true,
		});

		expect(result.mode).toBe('docked');
		expect(result.top).toBe(0);
		expect(result.left).toBe(85);
		expect(result.arrowOffset).toBe(0);
	});

	it('places floating toolbars above the anchor when space is available', () => {
		const result = computeToolbarPosition({
			anchorRect: { top: 120, left: 100, bottom: 144, right: 164, width: 64, height: 24 },
			containerWidth: 360,
			containerHeight: 280,
			toolbarWidth: 140,
			toolbarHeight: 60,
			mobile: false,
		});

		expect(result.mode).toBe('floating');
		expect(result.isBelowAnchor).toBe(false);
		expect(result.top).toBe(48);
		expect(result.left).toBe(62);
		expect(result.arrowOffset).toBe(0);
	});

	it('flips below and clamps arrow offset near viewport edges', () => {
		const result = computeToolbarPosition({
			anchorRect: { top: 18, left: 8, bottom: 34, right: 40, width: 32, height: 16 },
			containerWidth: 240,
			containerHeight: 180,
			toolbarWidth: 120,
			toolbarHeight: 56,
			mobile: false,
		});

		expect(result.isBelowAnchor).toBe(true);
		expect(result.left).toBe(12);
		expect(result.top).toBe(46);
		expect(result.arrowOffset).toBe(-42);
	});

	it('chooses the top-most line rect for multi-line selections when floating above', () => {
		const result = computeToolbarPosition({
			anchorRect: { top: 80, left: 24, bottom: 152, right: 212, width: 188, height: 72 },
			anchorRects: [
				{ top: 80, left: 120, bottom: 104, right: 212, width: 92, height: 24 },
				{ top: 128, left: 24, bottom: 152, right: 116, width: 92, height: 24 },
			],
			containerWidth: 320,
			containerHeight: 260,
			toolbarWidth: 120,
			toolbarHeight: 56,
			mobile: false,
		});

		expect(result.isBelowAnchor).toBe(false);
		expect(result.anchorRect).toEqual({ top: 80, left: 120, bottom: 104, right: 212, width: 92, height: 24 });
		expect(result.top).toBe(12);
		expect(result.left).toBe(106);
	});

	it('chooses the bottom-most line rect and anchor point when preferred below', () => {
		const result = computeToolbarPosition({
			anchorRect: { top: 48, left: 32, bottom: 136, right: 196, width: 164, height: 88 },
			anchorRects: [
				{ top: 48, left: 32, bottom: 72, right: 164, width: 132, height: 24 },
				{ top: 112, left: 84, bottom: 136, right: 196, width: 112, height: 24 },
			],
			anchorPoint: { x: 180, y: 124 },
			containerWidth: 320,
			containerHeight: 260,
			toolbarWidth: 140,
			toolbarHeight: 72,
			mobile: false,
			preferredSide: 'bottom',
		});

		expect(result.isBelowAnchor).toBe(true);
		expect(result.anchorRect).toEqual({ top: 112, left: 84, bottom: 136, right: 196, width: 112, height: 24 });
		expect(result.left).toBe(110);
		expect(result.top).toBe(148);
		expect(result.arrowOffset).toBe(0);
	});

	it('keeps floating toolbars above reserved bottom insets', () => {
		const result = computeToolbarPosition({
			anchorRect: { top: 220, left: 110, bottom: 244, right: 174, width: 64, height: 24 },
			containerWidth: 360,
			containerHeight: 320,
			toolbarWidth: 160,
			toolbarHeight: 72,
			mobile: false,
			insetBottom: 68,
		});

		expect(result.isBelowAnchor).toBe(false);
		expect(result.top).toBe(136);
	});

	it('disposes bound listeners together', () => {
		const binder = createEventBinder();
		const target = document.createElement('div');
		const handler = vi.fn();

		binder.bind(target, 'click', handler);
		target.dispatchEvent(new Event('click'));
		expect(handler).toHaveBeenCalledTimes(1);

		binder.dispose();
		target.dispatchEvent(new Event('click'));
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('detects outside toolbar events', () => {
		const toolbar = document.createElement('div');
		const child = document.createElement('button');
		toolbar.appendChild(child);
		document.body.appendChild(toolbar);
		const outside = document.createElement('div');
		document.body.appendChild(outside);

		const insideEvent = new MouseEvent('mousedown', { bubbles: true });
		Object.defineProperty(insideEvent, 'target', { value: child });
		expect(isEventOutsideToolbar(toolbar, insideEvent)).toBe(false);

		const outsideEvent = new MouseEvent('mousedown', { bubbles: true });
		Object.defineProperty(outsideEvent, 'target', { value: outside });
		expect(isEventOutsideToolbar(toolbar, outsideEvent)).toBe(true);

		expect(isEventOutsideToolbar(undefined, outsideEvent)).toBe(false);
	});

	it('treats Obsidian menus as inside floating UI', () => {
		const menu = document.createElement('div');
		menu.className = 'menu';
		const item = document.createElement('div');
		menu.appendChild(item);
		document.body.appendChild(menu);

		const menuEvent = new MouseEvent('mousedown', { bubbles: true });
		Object.defineProperty(menuEvent, 'target', { value: item });
		expect(isEventInsideObsidianFloatingUi(menuEvent)).toBe(true);
	});

	it('dismisses toolbar on outside pointer down but not on menu clicks', () => {
		const toolbar = document.createElement('div');
		const button = document.createElement('button');
		toolbar.appendChild(button);
		document.body.appendChild(toolbar);

		const menu = document.createElement('div');
		menu.className = 'menu';
		const menuItem = document.createElement('div');
		menu.appendChild(menuItem);
		document.body.appendChild(menu);

		const outside = document.createElement('div');
		document.body.appendChild(outside);

		const toolbarEvent = new MouseEvent('mousedown', { bubbles: true });
		Object.defineProperty(toolbarEvent, 'target', { value: button });
		expect(shouldDismissToolbarOnPointerDown(toolbar, toolbarEvent)).toBe(false);

		const menuEvent = new MouseEvent('mousedown', { bubbles: true });
		Object.defineProperty(menuEvent, 'target', { value: menuItem });
		expect(shouldDismissToolbarOnPointerDown(toolbar, menuEvent)).toBe(false);

		const outsideEvent = new MouseEvent('mousedown', { bubbles: true });
		Object.defineProperty(outsideEvent, 'target', { value: outside });
		expect(shouldDismissToolbarOnPointerDown(toolbar, outsideEvent)).toBe(true);
	});

	it('dismisses toolbar for pointer targets inside EPUB iframe documents', () => {
		const toolbar = document.createElement('div');
		document.body.appendChild(toolbar);

		const iframe = document.createElement('iframe');
		document.body.appendChild(iframe);
		const iframeDoc = iframe.contentDocument;
		expect(iframeDoc).toBeTruthy();
		const insideIframe = iframeDoc!.createElement('p');
		iframeDoc!.body.appendChild(insideIframe);

		const iframeEvent = new MouseEvent('mousedown', { bubbles: true });
		Object.defineProperty(iframeEvent, 'target', { value: insideIframe });
		expect(shouldDismissToolbarOnPointerDown(toolbar, iframeEvent)).toBe(true);
	});
});
