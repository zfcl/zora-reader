import * as React from "react";
import { useEffect, useRef, useState, useCallback } from 'react';
import { ReactReader, ReactReaderStyle, type IReactReaderStyle } from 'react-reader';
import type { Contents, Rendition } from 'epubjs';
import useLocalStorageState from 'use-local-storage-state';
import { getEpubOptions, getResizeDimensions, MAX_READING_PAGE_WIDTH } from './paginationLayout';
import { navigatePage } from './pageNavigation';
import { getFontSizeAnchor, reflowFontSizeAtAnchor, shouldPreserveFontSizeAnchor } from './fontSizeAnchor';
import { injectPublisherStyles } from './publisherStyles';
import { getReaderThemeRules, resolveReaderColors, type ReaderBackgroundMode } from './readerBackground';
import { flattenToc, getTocSelection, type TocEntry, type TocItem } from './tocNavigation';
import { getFirstVisibleTextCfi } from './visibleTextAnchor';
import { getWheelPageAction } from './wheelNavigation';
import { getKeyboardPageAction, isEditableTarget } from './keyboardNavigation';
import { getReaderDocument, getReaderWindow } from './readerWindow';

type RuntimeRendition = Rendition & {
  manager?: unknown;
  resize(width: number, height: number, epubcfi?: string): void;
};

export const EpubReader = ({ contents, title, scrolled, mouseWheelPageTurn, readerBackgroundMode, readerBackgroundColor }: {
  contents: ArrayBuffer;
  title: string;
  scrolled: boolean;
  mouseWheelPageTurn: boolean;
  readerBackgroundMode: ReaderBackgroundMode;
  readerBackgroundColor: string;
}) => {
  const [location, setLocation] = useLocalStorageState<string | number>(`epub-${title}`, { defaultValue: 0 });
  const renditionRef = useRef<RuntimeRendition | null>(null);
  const readerHostRef = useRef<HTMLDivElement | null>(null);
  const fontSizeAnchorRef = useRef<string | null>(null);
  const fontSizeAnchorResetTimerRef = useRef<number | null>(null);
  const lastWheelPageTurnAtRef = useRef(0);
  const wheelSettingsRef = useRef({ scrolled, mouseWheelPageTurn });
  const [fontSize, setFontSize] = useState(100); 
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => document.body.classList.contains('theme-dark'));

  wheelSettingsRef.current = { scrolled, mouseWheelPageTurn };

  const locationChanged = useCallback((epubcifi: string | number) => {
    setLocation(epubcifi);
  }, [setLocation]);

  const tocChanged = useCallback((toc: unknown) => {
    setTocEntries(Array.isArray(toc) ? flattenToc(toc as TocItem[]) : []);
  }, []);

  const selectTocEntry = useCallback((href: string) => {
    const selection = getTocSelection(href);
    setLocation(selection.location);
    setTocOpen(selection.tocOpen);
  }, [setLocation]);

  const getReaderColors = useCallback(() => {
    const readerDocument = getReaderDocument(readerHostRef.current, document);
    const rootStyles = getComputedStyle(readerDocument.body);
    return resolveReaderColors(
      readerBackgroundMode,
      readerBackgroundColor,
      rootStyles.getPropertyValue('--background-primary').trim() || '#ffffff',
      rootStyles.getPropertyValue('--text-normal').trim() || '#000000',
    );
  }, [readerBackgroundColor, readerBackgroundMode]);

  const updateTheme = useCallback((rendition: Rendition) => {
    const themes = rendition.themes;
    const colors = getReaderColors();
    themes.default(getReaderThemeRules(colors));
  }, [getReaderColors]);

  useEffect(() => {
    const readerDocument = getReaderDocument(readerHostRef.current, document);
    const themeObserver = new MutationObserver(() => {
      setIsDarkMode(readerDocument.body.classList.contains('theme-dark'));
      if (renditionRef.current != null) updateTheme(renditionRef.current);
    });
    setIsDarkMode(readerDocument.body.classList.contains('theme-dark'));
    themeObserver.observe(readerDocument.body, { attributes: true, attributeFilter: ['class'] });
    return () => themeObserver.disconnect();
  }, [updateTheme]);

  const resizeRendition = useCallback((anchor: string | null = null) => {
    const readerHost = readerHostRef.current;
    if (!readerHost) return;

    const rendition = renditionRef.current;
    const epubContainer = readerHost.querySelector('div.epub-container');
    const readerViewport = epubContainer?.parentElement;
    if (!readerViewport) return;

    const dimensions = getResizeDimensions(rendition?.manager != null, readerViewport.clientWidth, readerViewport.clientHeight);
    if (dimensions != null && rendition != null) {
      // epub.js 的声明文件遗漏了第三个 epubcfi 参数；运行时 API 会将其作为本次重排的定位锚点。
      // epub.js type definitions omit the third epubcfi parameter; the runtime API uses it as the anchor for this reflow.
      rendition.resize(dimensions.width, dimensions.height, anchor ?? undefined);
    }
  }, []);

  const applyPublisherStyles = useCallback((document: Document) => {
    const contentWindow = document.defaultView;
    if (contentWindow == null || document.documentElement == null || document.head == null) return;

    void injectPublisherStyles(document, (href) => contentWindow.fetch(href)).then((injected) => {
      if (injected) getReaderWindow(readerHostRef.current, window).requestAnimationFrame(() => resizeRendition());
    });
  }, [resizeRendition]);

  const updateFontSize = useCallback((size: number) => {
    const rendition = renditionRef.current;
    if (rendition == null) return;
    const readerWindow = getReaderWindow(readerHostRef.current, window);

    if (!shouldPreserveFontSizeAnchor(scrolled, rendition.manager != null)) {
      rendition.themes.fontSize(`${size}%`);
      readerWindow.requestAnimationFrame(() => resizeRendition());
      return;
    }

    const renderedContents = rendition.getContents() as unknown as Contents[];
    const visibleTextAnchor = fontSizeAnchorRef.current == null && readerHostRef.current != null
      ? renderedContents.map((contents) => getFirstVisibleTextCfi(contents, readerHostRef.current!)).find((cfi) => cfi != null) ?? null
      : null;
    const anchor = getFontSizeAnchor(
      fontSizeAnchorRef.current ?? visibleTextAnchor,
      rendition.currentLocation() as unknown as { start?: { cfi?: string } },
    );
    fontSizeAnchorRef.current = anchor;
    reflowFontSizeAtAnchor(rendition, size, anchor, resizeRendition, readerWindow.requestAnimationFrame.bind(readerWindow));

    if (fontSizeAnchorResetTimerRef.current != null) readerWindow.clearTimeout(fontSizeAnchorResetTimerRef.current);
    fontSizeAnchorResetTimerRef.current = readerWindow.setTimeout(() => {
      fontSizeAnchorRef.current = null;
      fontSizeAnchorResetTimerRef.current = null;
    }, 250);
  }, [resizeRendition, scrolled]);

  useEffect(() => () => {
    if (fontSizeAnchorResetTimerRef.current != null) {
      getReaderWindow(readerHostRef.current, window).clearTimeout(fontSizeAnchorResetTimerRef.current);
    }
  }, []);

  useEffect(() => {
    updateFontSize(fontSize);
  }, [fontSize, updateFontSize]);

  useEffect(() => {
    const readerHost = readerHostRef.current;
    if (!readerHost) return;

    const resizeObserver = new ResizeObserver(() => resizeRendition());
    resizeObserver.observe(readerHost);
    resizeRendition();

    return () => resizeObserver.disconnect();
  }, [resizeRendition]);

  useEffect(() => {
    const rootDocument = getReaderDocument(readerHostRef.current, document);

    const applyStylesToFrames = () => {
      rootDocument.querySelectorAll<HTMLIFrameElement>('iframe[id^="epubjs-view-"]').forEach((frame) => {
        if (frame.contentDocument != null) applyPublisherStyles(frame.contentDocument);
      });
    };
    const handleFrameLoad = (event: Event) => {
      if (event.target instanceof HTMLIFrameElement && event.target.contentDocument != null) {
        applyPublisherStyles(event.target.contentDocument);
      }
    };
    const frameObserver = new MutationObserver(applyStylesToFrames);

    rootDocument.addEventListener('load', handleFrameLoad, true);
    frameObserver.observe(rootDocument.body, { childList: true, subtree: true });
    applyStylesToFrames();

    return () => {
      rootDocument.removeEventListener('load', handleFrameLoad, true);
      frameObserver.disconnect();
    };
  }, [applyPublisherStyles]);

  const handleContentWheel = useCallback((event: WheelEvent) => {
    const settings = wheelSettingsRef.current;
    const now = Date.now();
    const action = getWheelPageAction({
      deltaY: event.deltaY,
      isPaginated: !settings.scrolled,
      enabled: settings.mouseWheelPageTurn,
      isModified: event.ctrlKey || event.metaKey || event.altKey,
      now,
      lastTurnAt: lastWheelPageTurnAtRef.current,
    });

    if (action == null) return;

    event.preventDefault();
    event.stopPropagation();
    lastWheelPageTurnAtRef.current = now;

    const rendition = renditionRef.current;
    if (rendition != null) navigatePage(action === 'next' ? 'next' : 'previous', rendition);
  }, []);

  const handleReaderKeyPress = useCallback((event?: KeyboardEvent) => {
    if (event == null) return;

    const action = getKeyboardPageAction({
      key: event.key,
      isModified: event.ctrlKey || event.metaKey || event.altKey,
      isEditable: isEditableTarget(event.target),
    });
    if (action == null) return;

    event.preventDefault();
    event.stopPropagation();
    const rendition = renditionRef.current;
    if (rendition != null) navigatePage(action, rendition);
  }, []);

  const readerColors = getReaderColors();
  const baseReaderStyles = isDarkMode ? darkReaderTheme : lightReaderTheme;
  const readerStyles: IReactReaderStyle = {
    ...baseReaderStyles,
    readerArea: {
      ...baseReaderStyles.readerArea,
      backgroundColor: readerColors.background,
    },
  };
  const tocColors = isDarkMode
    ? { background: '#111', border: '#333', text: '#f2f2f2', mutedText: '#bbb' }
    : { background: '#fff', border: '#e6e6e6', text: '#333', mutedText: '#666' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', width: '100%' }}>
      <div style={{ flex: '0 0 auto', padding: '10px' }}>
        <label htmlFor="fontSizeSlider">Adjust Font Size: </label>
        <input
          id="fontSizeSlider"
          type="range"
          min="80"
          max="160"
          value={fontSize}
          onChange={e => setFontSize(parseInt(e.target.value))}
        />
      </div>
      <div style={{ alignItems: 'center', display: 'flex', flex: '1 1 0', justifyContent: 'center', minHeight: 0, overflow: 'hidden' }}>
        <div ref={readerHostRef} style={{ height: '100%', maxWidth: `${MAX_READING_PAGE_WIDTH}px`, minHeight: 0, overflow: 'hidden', position: 'relative', width: '100%' }}>
          <ReactReader
          title={title}
          showToc={false}
          location={location}
          locationChanged={locationChanged}
          tocChanged={tocChanged}
          handleKeyPress={handleReaderKeyPress}
          swipeable={false}
          url={contents}
          getRendition={(rendition: Rendition) => {
            renditionRef.current = rendition;
            const enhanceContents = (contents: Contents) => {
              const body = contents.window.document.body;
              body.oncontextmenu = () => false;
              void contents.addStylesheetRules({
                img: {
                  'height': 'auto !important',
                  'max-height': '100%',
                  'max-width': '100%',
                  'object-fit': 'contain',
                  'width': 'auto !important',
                },
                svg: {
                  'height': 'auto !important',
                  'max-height': '100%',
                  'max-width': '100%',
                  'width': 'auto !important',
                },
              }, 'epub-reader-plus-image-aspect-ratio');
              contents.window.addEventListener('wheel', handleContentWheel, { passive: false });
              applyPublisherStyles(contents.window.document);
            };
            rendition.hooks.content.register(enhanceContents);
            const enhanceRenderedContents = () => {
              (rendition.getContents() as unknown as Contents[]).forEach(enhanceContents);
            };
            enhanceRenderedContents();
            getReaderWindow(readerHostRef.current, window).requestAnimationFrame(enhanceRenderedContents);
            updateTheme(rendition);
            updateFontSize(fontSize);
          }}
          epubOptions={getEpubOptions(scrolled)}
          readerStyles={readerStyles}
          />
          <button
            aria-label="上一页 / Previous page"
            className="epub-icon-button epub-page-button epub-page-button--previous"
            onClick={() => {
              const rendition = renditionRef.current;
              if (rendition != null) navigatePage('previous', rendition);
            }}
          >
            <ReaderIcon name="previous" />
          </button>
          <button
            aria-label="下一页 / Next page"
            className="epub-icon-button epub-page-button epub-page-button--next"
            onClick={() => {
              const rendition = renditionRef.current;
              if (rendition != null) navigatePage('next', rendition);
            }}
          >
            <ReaderIcon name="next" />
          </button>
          {!tocOpen && tocEntries.length > 0 && (
            <button
              aria-label="打开目录 / Open table of contents"
              className="epub-icon-button epub-toc-toggle"
              onClick={() => setTocOpen(true)}
            >
              <ReaderIcon name="menu" />
            </button>
          )}
          {tocOpen && (
            <div
              onClick={() => setTocOpen(false)}
              style={{ bottom: 0, left: 0, position: 'absolute', right: 0, top: 0, zIndex: 30 }}
            >
              <aside
                aria-label="目录 / Table of contents"
                onClick={(event) => event.stopPropagation()}
                style={{ background: tocColors.background, bottom: 0, boxShadow: `1px 0 12px ${isDarkMode ? '#000' : '#ddd'}`, color: tocColors.text, left: 0, overflowY: 'auto', position: 'absolute', top: 0, width: 256 }}
              >
                <div style={{ alignItems: 'center', borderBottom: `1px solid ${tocColors.border}`, display: 'flex', justifyContent: 'space-between', padding: '16px 14px 14px' }}>
                  <strong style={{ fontSize: 20 }}>目录</strong>
                  <button
                    aria-label="关闭目录 / Close table of contents"
                    className="epub-icon-button epub-toc-close"
                    onClick={() => setTocOpen(false)}
                  >
                    <ReaderIcon name="close" />
                  </button>
                </div>
                <nav style={{ padding: '12px 0 20px' }}>
                  {tocEntries.map((entry) => (
                    <button
                      key={entry.href}
                      className="epub-toc-entry"
                      onClick={() => selectTocEntry(entry.href)}
                      style={{ appearance: 'none', background: 'transparent', border: 0, borderRadius: 0, boxShadow: 'none', color: tocColors.text, cursor: 'pointer', display: 'block', fontSize: 15, fontWeight: 600, lineHeight: 1.45, margin: 0, outline: 'none', padding: '8px 28px', textAlign: 'left', width: '100%' }}
                    >
                      {entry.label}
                    </button>
                  ))}
                </nav>
              </aside>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const lightReaderTheme: IReactReaderStyle = {
  ...ReactReaderStyle,
  arrow: {
    ...ReactReaderStyle.arrow,
    display: 'none',
  },
  readerArea: {
    ...ReactReaderStyle.readerArea,
    transition: undefined,
  },
};

const darkReaderTheme: IReactReaderStyle = {
  ...ReactReaderStyle,
  arrow: {
    ...ReactReaderStyle.arrow,
    display: 'none',
  },
  arrowHover: {
    ...ReactReaderStyle.arrowHover,
    color: '#ccc',
  },
  readerArea: {
    ...ReactReaderStyle.readerArea,
    backgroundColor: '#000',
    transition: undefined,
  },
  titleArea: {
    ...ReactReaderStyle.titleArea,
    color: '#ccc',
  },
  tocArea: {
    ...ReactReaderStyle.tocArea,
    background: '#111',
  },
  tocButtonExpanded: {
    ...ReactReaderStyle.tocButtonExpanded,
    background: '#222',
  },
  tocButtonBar: {
    ...ReactReaderStyle.tocButtonBar,
    background: '#fff',
  },
  tocButton: {
    ...ReactReaderStyle.tocButton,
    color: 'white',
  },
};

type ReaderIconName = 'menu' | 'close' | 'previous' | 'next';

function ReaderIcon({ name }: { name: ReaderIconName }) {
  const path = name === 'menu'
    ? <><path d="M5 7h14" /><path d="M5 12h14" /><path d="M5 17h14" /></>
    : name === 'close'
      ? <><path d="m7 7 10 10" /><path d="m17 7-10 10" /></>
      : name === 'previous'
        ? <path d="m14 6-6 6 6 6" />
        : <path d="m10 6 6 6-6 6" />;

  return (
    <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="20">
      {path}
    </svg>
  );
}
