import { fireEvent, render, waitFor } from '@testing-library/svelte';

vi.mock('obsidian', async () => {
  return await vi.importActual<typeof import('../../tests/mocks/obsidian')>('../../tests/mocks/obsidian');
});

import EpubHighlightToolbar from './EpubHighlightToolbar.svelte';
import type { EpubReaderEngine, HighlightClickInfo } from '../../services/epub';
import { Platform } from 'obsidian';

const originalVisualViewport = window.visualViewport;

function createInfo(): HighlightClickInfo {
  return {
    cfiRange: '/6/2[chapter]!/4/2/6',
    color: 'yellow',
    text: '测试高亮',
    sourceFile: 'Notes/test.md',
    rect: {
      top: 24,
      left: 48,
      bottom: 44,
      right: 148,
      width: 100,
      height: 20,
    },
  };
}

function createReaderService(frameDocuments: Document[] = []): EpubReaderEngine {
  return {
    getVisibleFrames: () => frameDocuments.map((document) => ({
      frameDocument: document,
      window: document.defaultView || window,
      cfiFromRange: () => null,
    })),
  } as unknown as EpubReaderEngine;
}

describe('EpubHighlightToolbar', () => {
	beforeEach(() => {
		Platform.isMobile = false;
		Platform.isDesktop = true;
		document.body.classList.remove('is-mobile', 'is-phone');
	});

  afterEach(() => {
		Platform.isMobile = false;
		Platform.isDesktop = true;
		Object.defineProperty(window, 'visualViewport', {
			configurable: true,
			value: originalVisualViewport,
		});
    document.body.innerHTML = '';
  });

  it('dismisses when clicking outside in the host document', async () => {
    const onDismiss = vi.fn();

    render(EpubHighlightToolbar, {
      props: {
        info: createInfo(),
        readerService: createReaderService(),
        onDelete: vi.fn(),
        onTemporarilyReveal: vi.fn(),
        onChangeColor: vi.fn(),
        onChangeStyle: vi.fn(),
        onEditComment: vi.fn(),
        onBacklink: vi.fn(),
        onExtractToCard: vi.fn(),
        onCopyText: vi.fn(),
        onDismiss,
      },
    });

    await waitFor(() => {
      expect(document.querySelector('.epub-highlight-toolbar.visible')).toBeInTheDocument();
    });

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses when clicking outside in a visible reader frame document', async () => {
    const onDismiss = vi.fn();
    const frameDocument = document.implementation.createHTMLDocument('reader-frame');

    render(EpubHighlightToolbar, {
      props: {
        info: createInfo(),
        readerService: createReaderService([frameDocument]),
        onDelete: vi.fn(),
        onTemporarilyReveal: vi.fn(),
        onChangeColor: vi.fn(),
        onChangeStyle: vi.fn(),
        onEditComment: vi.fn(),
        onBacklink: vi.fn(),
        onExtractToCard: vi.fn(),
        onCopyText: vi.fn(),
        onDismiss,
      },
    });

    await waitFor(() => {
      expect(document.querySelector('.epub-highlight-toolbar.visible')).toBeInTheDocument();
    });

    const outside = frameDocument.createElement('div');
    frameDocument.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

	it('centers reading-note actions in the mobile safe viewport instead of docking at the bottom', async () => {
		Platform.isMobile = true;
		Platform.isDesktop = false;
		const viewport = document.createElement('div');
		viewport.className = 'epub-reader-viewport';
		Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 390 });
		Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 844 });
		document.body.appendChild(viewport);
		Object.defineProperty(window, 'visualViewport', {
			configurable: true,
			value: {
				width: 390,
				height: 844,
				offsetLeft: 0,
				offsetTop: 0,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			},
		});

		render(EpubHighlightToolbar, {
			target: viewport,
			props: {
				info: { ...createInfo(), style: 'reading-note', excerptId: 'note01' },
				readerService: createReaderService(),
				onDelete: vi.fn(),
				onTemporarilyReveal: vi.fn(),
				onChangeColor: vi.fn(),
				onChangeStyle: vi.fn(),
				onEditComment: vi.fn(),
				onBacklink: vi.fn(),
				onExtractToCard: vi.fn(),
				onCopyText: vi.fn(),
				onDismiss: vi.fn(),
			},
		});

		await waitFor(() => {
			const toolbar = viewport.querySelector<HTMLElement>('.epub-highlight-toolbar');
			expect(toolbar).toHaveClass('mobile-centered');
			expect(toolbar).not.toHaveClass('mobile-docked');
			expect(Number.parseFloat(toolbar?.style.top || '0')).toBeGreaterThan(200);
			expect(Number.parseFloat(toolbar?.style.top || '0')).toBeLessThan(600);
		});
	});

	it('stops mobile note actions from bubbling into the reader page-turn surface', async () => {
		Platform.isMobile = true;
		Platform.isDesktop = false;
		const viewport = document.createElement('div');
		viewport.className = 'epub-reader-viewport';
		document.body.appendChild(viewport);
		const pageTurn = vi.fn();
		viewport.addEventListener('click', pageTurn);
		viewport.addEventListener('touchstart', pageTurn);
		const onBacklink = vi.fn(async () => undefined);

		render(EpubHighlightToolbar, {
			target: viewport,
			props: {
				info: { ...createInfo(), style: 'reading-note', excerptId: 'note01' },
				readerService: createReaderService(),
				onDelete: vi.fn(),
				onTemporarilyReveal: vi.fn(),
				onChangeColor: vi.fn(),
				onChangeStyle: vi.fn(),
				onEditComment: vi.fn(),
				onBacklink,
				onExtractToCard: vi.fn(),
				onCopyText: vi.fn(),
				onDismiss: vi.fn(),
			},
		});

		const openButton = await waitFor(() => {
			const button = viewport.querySelector<HTMLButtonElement>('button[title="打开笔记"]');
			expect(button).toBeInTheDocument();
			return button!;
		});
		await fireEvent.touchStart(openButton);
		await fireEvent.click(openButton);

		expect(onBacklink).toHaveBeenCalledTimes(1);
		expect(pageTurn).not.toHaveBeenCalled();
	});
});
