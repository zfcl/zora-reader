import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, TFile } from 'obsidian';
import { ReactReader, ReactReaderStyle, type IReactReaderStyle } from 'react-reader';
import type { Contents, Rendition } from 'epubjs';
import type { EpubPluginSettings } from './EpubPluginSettings';
import { getEpubOptions, MAX_READING_PAGE_WIDTH } from './paginationLayout';
import { navigatePage } from './pageNavigation';
import { flattenToc, type TocEntry, type TocItem } from './tocNavigation';
import { getKeyboardPageAction, isEditableTarget } from './keyboardNavigation';
import { getWheelPageAction } from './wheelNavigation';
import { injectPublisherStyles } from './publisherStyles';
import { resolveReaderColors, getReaderThemeRules } from './readerBackground';
import { normalizeSelection, surroundingContext } from './selectionContext';
import { TranslationCard, type TranslationCardState } from './TranslationCard';
import type { CaptureDraft } from './notes';
import type { SelectionCapture, TranslationResult } from './translation';

type RuntimeRendition = Rendition & { manager?: unknown };

export function EpubReader({ book, contents, settings, initialLocation, onLocationChanged, onFontScaleChanged, onTranslate, onDeepen, onSave, onOpenNote }: {
  book: TFile;
  contents: ArrayBuffer;
  settings: EpubPluginSettings;
  initialLocation: string | number;
  onLocationChanged(location: string | number): void;
  onFontScaleChanged(fontScale: number): void;
  onTranslate(capture: SelectionCapture): Promise<TranslationResult>;
  onDeepen(capture: SelectionCapture): Promise<string>;
  onSave(capture: SelectionCapture, result: TranslationResult, draft: CaptureDraft): Promise<{ file: TFile }>;
  onOpenNote(path: string): void;
}) {
  const renditionRef = useRef<RuntimeRendition | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const tocRef = useRef<TocEntry[]>([]);
  const locationRef = useRef(initialLocation);
  const lastWheelRef = useRef(0);
  const [location, setLocation] = useState<string | number>(initialLocation);
  const [fontSize, setFontSize] = useState(settings.fontScale);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [card, setCard] = useState<TranslationCardState | null>(null);
  const cardRef = useRef<TranslationCardState | null>(null);
  cardRef.current = card;
  tocRef.current = toc;

  const colors = resolveReaderColors(settings.readerBackgroundMode, '', '', '');
  const locationChanged = useCallback((next: string | number) => {
    locationRef.current = next;
    setLocation(next);
    onLocationChanged(next);
  }, [onLocationChanged]);

  const runTranslation = useCallback(async (capture: SelectionCapture) => {
    setCard({ capture, status: 'loading' });
    try {
      const result = await onTranslate(capture);
      if (cardRef.current?.capture.cfi === capture.cfi) setCard({ capture, result, status: 'success' });
    } catch (error) {
      if (cardRef.current?.capture.cfi === capture.cfi) setCard({ capture, error: error instanceof Error ? error.message : '翻译失败，请重试。', status: 'error' });
    }
  }, [onTranslate]);

  const selectionChanged = useCallback((cfi: string, chapterContents: Contents) => {
    const range = chapterContents.range(cfi);
    const text = normalizeSelection(range.toString());
    if (!text) return;
    const current = renditionRef.current?.currentLocation() as unknown as { start?: { href?: string; percentage?: number } } | undefined;
    const href = current?.start?.href ?? '';
    const selectionRect = range.getBoundingClientRect();
    const frameRect = (chapterContents.window.frameElement as HTMLIFrameElement | null)?.getBoundingClientRect();
    const capture: SelectionCapture = {
      text,
      context: surroundingContext(range),
      cfi,
      chapter: findChapter(tocRef.current, href),
      progress: current?.start?.percentage ?? 0,
      anchorX: frameRect ? frameRect.left + selectionRect.right : undefined,
      anchorY: frameRect ? frameRect.top + selectionRect.bottom : undefined,
    };
    renditionRef.current?.annotations.remove(cfi, 'highlight');
    renditionRef.current?.annotations.highlight(cfi, {}, undefined, 'zora-active-selection', { fill: '#78aef4', 'fill-opacity': '0.32', 'mix-blend-mode': 'multiply' });
    if (Platform.isPhone || Platform.isTablet) setCard({ capture, status: 'ready' });
    else void runTranslation(capture);
  }, [runTranslation]);

  const enhanceContents = useCallback((chapterContents: Contents) => {
    const document = chapterContents.window.document;
    void chapterContents.addStylesheetRules({
      body: { 'line-height': '1.78 !important', padding: '0 5vw !important' },
      img: { height: 'auto !important', 'max-height': '100%', 'max-width': '100%', width: 'auto !important' },
      svg: { height: 'auto !important', 'max-height': '100%', 'max-width': '100%', width: 'auto !important' },
      '::selection': { background: '#b9d6ff' },
    }, 'zora-reader-foundations');
    void injectPublisherStyles(document, (href) => chapterContents.window.fetch(href));
    chapterContents.window.addEventListener('wheel', (event) => {
      const now = Date.now();
      const action = getWheelPageAction({ deltaY: event.deltaY, isPaginated: !settings.scrolledView, enabled: settings.mouseWheelPageTurn, isModified: event.ctrlKey || event.metaKey || event.altKey, now, lastTurnAt: lastWheelRef.current });
      if (!action || !renditionRef.current) return;
      event.preventDefault();
      lastWheelRef.current = now;
      navigatePage(action === 'prev' ? 'previous' : 'next', renditionRef.current);
    }, { passive: false });
  }, [settings.mouseWheelPageTurn, settings.scrolledView]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    rendition.themes.fontSize(`${fontSize}%`);
  }, [fontSize]);

  const readerStyles: IReactReaderStyle = {
    ...ReactReaderStyle,
    arrow: { ...ReactReaderStyle.arrow, display: 'none' },
    readerArea: { ...ReactReaderStyle.readerArea, backgroundColor: colors.background, transition: undefined },
    titleArea: { ...ReactReaderStyle.titleArea, display: 'none' },
  };

  return <div className={`zora-reader-shell theme-${settings.readerBackgroundMode}`} style={{ '--zora-paper': colors.background, '--zora-ink': colors.text } as React.CSSProperties}>
    <header className="zora-reader-toolbar">
      <button aria-label="目录" onClick={() => setTocOpen(true)}><Icon name="menu" /></button>
      <div className="zora-book-title"><strong>{book.basename}</strong><span>{Math.round(((renditionRef.current?.currentLocation() as unknown as { start?: { percentage?: number } })?.start?.percentage ?? 0) * 100)}%</span></div>
          <label className="zora-font-size"><span>A</span><input aria-label="字号" type="range" min="84" max="160" value={fontSize} onChange={(event) => setFontSize(Number(event.currentTarget.value))} onPointerUp={() => onFontScaleChanged(fontSize)} onKeyUp={() => onFontScaleChanged(fontSize)} /></label>
    </header>
    <main className="zora-reader-main">
      <div className="zora-reader-host" ref={hostRef} style={{ maxWidth: MAX_READING_PAGE_WIDTH }}>
        <ReactReader
          title={book.basename}
          showToc={false}
          location={location}
          locationChanged={locationChanged}
          tocChanged={(value) => setToc(Array.isArray(value) ? flattenToc(value as TocItem[]) : [])}
          handleKeyPress={(event?: KeyboardEvent) => {
            if (!event || !renditionRef.current) return;
            const action = getKeyboardPageAction({ key: event.key, isModified: event.ctrlKey || event.metaKey || event.altKey, isEditable: isEditableTarget(event.target) });
            if (action) { event.preventDefault(); navigatePage(action, renditionRef.current); }
          }}
          swipeable={Platform.isMobile}
          url={contents}
          getRendition={(rendition: Rendition) => {
            const runtime = rendition as RuntimeRendition;
            renditionRef.current = runtime;
            runtime.themes.default(getReaderThemeRules(colors));
            runtime.themes.fontSize(`${fontSize}%`);
            runtime.hooks.content.register(enhanceContents);
            runtime.on('selected', selectionChanged);
            (runtime.getContents() as unknown as Contents[]).forEach(enhanceContents);
          }}
          epubOptions={getEpubOptions(settings.scrolledView)}
          readerStyles={readerStyles} />
        <button className="zora-page-button previous" aria-label="上一页" onClick={() => renditionRef.current && navigatePage('previous', renditionRef.current)}><Icon name="previous" /></button>
        <button className="zora-page-button next" aria-label="下一页" onClick={() => renditionRef.current && navigatePage('next', renditionRef.current)}><Icon name="next" /></button>
      </div>
    </main>
    {tocOpen && <div className="zora-toc-scrim" onClick={() => setTocOpen(false)}><aside className="zora-toc" onClick={(event) => event.stopPropagation()}><header><div><small>CONTENTS</small><h2>目录</h2></div><button aria-label="关闭目录" onClick={() => setTocOpen(false)}>×</button></header><nav>{toc.map((entry) => <button key={entry.href} onClick={() => { setLocation(entry.href); setTocOpen(false); }}>{entry.label}</button>)}</nav></aside></div>}
    {card && <TranslationCard state={card} mobile={Platform.isMobile} bookKey={book.path}
      onTranslate={() => void runTranslation(card.capture)}
      onDeepen={() => onDeepen(card.capture)}
      onSave={async (draft) => { if (!card.result) return ''; const saved = await onSave(card.capture, card.result, draft); setCard({ ...card, status: 'saved' }); return saved.file.path; }}
      onOpenNote={onOpenNote}
      onClose={() => { renditionRef.current?.annotations.remove(card.capture.cfi, 'highlight'); setCard(null); }} />}
  </div>;
}

function findChapter(toc: TocEntry[], href: string): string {
  const clean = href.split('#')[0];
  return toc.find((entry) => entry.href.split('#')[0] === clean)?.label ?? '';
}

function Icon({ name }: { name: 'menu' | 'previous' | 'next' }) {
  const path = name === 'menu' ? <><path d="M5 7h14"/><path d="M5 12h14"/><path d="M5 17h14"/></> : name === 'previous' ? <path d="m14 6-6 6 6 6"/> : <path d="m10 6 6 6-6 6"/>;
  return <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="20">{path}</svg>;
}
