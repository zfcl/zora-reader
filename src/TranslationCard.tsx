import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { CaptureDraft } from './notes';
import type { SelectionCapture, TranslationResult } from './translation';

export type CardStatus = 'ready' | 'loading' | 'success' | 'error' | 'saved';

export interface TranslationCardState {
  capture: SelectionCapture;
  status: CardStatus;
  result?: TranslationResult;
  error?: string;
}

export function TranslationCard({ state, mobile, bookKey, onTranslate, onDeepen, onSave, onOpenNote, onClose }: {
  state: TranslationCardState;
  mobile: boolean;
  bookKey: string;
  onTranslate(): void;
  onDeepen(): Promise<string>;
  onSave(draft: CaptureDraft): Promise<string>;
  onOpenNote(path: string): void;
  onClose(): void;
}) {
  const [thoughts, setThoughts] = useState('');
  const [example, setExample] = useState('');
  const [tags, setTags] = useState('');
  const [addToReview, setAddToReview] = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [savedPath, setSavedPath] = useState('');
  const [position, setPosition] = useState(() => readPosition(bookKey, state.capture));
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  useEffect(() => { setThoughts(''); setExample(''); setTags(''); }, [state.capture.cfi]);

  const startDrag = (event: React.PointerEvent) => {
    if (mobile || event.button !== 0) return;
    const element = event.currentTarget.parentElement;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    drag.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: React.PointerEvent) => {
    if (!drag.current) return;
    const left = clamp(drag.current.left + event.clientX - drag.current.x, 8, window.innerWidth - 340);
    const top = clamp(drag.current.top + event.clientY - drag.current.y, 8, window.innerHeight - 180);
    setPosition({ left, top });
  };
  const endDrag = () => {
    drag.current = null;
    localStorage.setItem(`zora-card-${bookKey}`, JSON.stringify(position));
  };

  return <div className={`zora-translation-card${mobile ? ' is-mobile' : ''}`} style={mobile ? undefined : position} role="dialog" aria-label="翻译">
    <header className="zora-card-header" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag}>
      <span>{state.result?.kind === 'word' ? '词义' : state.result?.kind === 'phrase' ? '短语' : '翻译'}</span>
      <button aria-label="关闭" onClick={onClose}>×</button>
    </header>
    <div className="zora-card-body">
      <div className="zora-card-source">{state.capture.text}</div>
      {state.status === 'ready' && <button className="zora-primary" onClick={onTranslate}>翻译</button>}
      {state.status === 'loading' && <div className="zora-card-status"><i />正在翻译</div>}
      {state.status === 'error' && <div className="zora-card-error">{state.error}<button onClick={onTranslate}>重试</button></div>}
      {(state.status === 'success' || state.status === 'saved') && state.result && <Result result={state.result} />}
      {state.status === 'success' && <div className="zora-note-editor">
        {state.result?.kind !== 'word' && <button className="zora-deepen" onClick={async () => { setAnalysisLoading(true); try { setAnalysis(await onDeepen()); } finally { setAnalysisLoading(false); } }}>{analysisLoading ? '正在分析…' : '深入理解'}</button>}
        {analysis && <div className="zora-analysis">{analysis}</div>}
        <textarea aria-label="我的理解" placeholder="我的理解（可选）" value={thoughts} onChange={(event) => setThoughts(event.currentTarget.value)} />
        {state.result.kind === 'word' && <input aria-label="自造句" placeholder="自造句（可选）" value={example} onChange={(event) => setExample(event.currentTarget.value)} />}
        <input aria-label="标签" placeholder="#标签（可选）" value={tags} onChange={(event) => setTags(event.currentTarget.value)} />
        {state.result.kind !== 'word' && <label className="zora-review-toggle"><input type="checkbox" checked={addToReview} onChange={(event) => setAddToReview(event.currentTarget.checked)} />加入复习</label>}
        <button className="zora-save" onClick={() => void onSave({ thoughts: [thoughts, analysis && `### 深入理解\n\n${analysis}`].filter(Boolean).join('\n\n'), example, tags, addToReview: state.result?.kind === 'word' || addToReview }).then(setSavedPath)}>♡ 收藏到笔记</button>
      </div>}
      {state.status === 'saved' && <div className="zora-saved">✓ 已添加到书籍笔记{savedPath && <button onClick={() => onOpenNote(savedPath)}>打开笔记</button>}</div>}
    </div>
  </div>;
}

function Result({ result }: { result: TranslationResult }) {
  if (result.kind !== 'word') return <div className="zora-translation-text">{result.translation}</div>;
  return <>
    <section><h4>当前语境</h4><div className="zora-current-sense"><span>{result.partOfSpeech || '词义'}</span>{result.currentMeaning}</div>{result.sentenceTranslation && <p>{result.sentenceTranslation}</p>}</section>
    <section><h4>全部可靠释义</h4><ol className="zora-senses">{result.senses.map((sense, index) => <li key={`${sense.label}-${sense.meaning}-${index}`}><span>{sense.label}</span><b>{sense.meaning}</b>{sense.usage && <small>{sense.usage}</small>}</li>)}</ol></section>
  </>;
}

function readPosition(bookKey: string, capture: SelectionCapture): { left: number; top: number } {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`zora-card-${bookKey}`) ?? 'null');
    if (typeof value === 'object' && value !== null && typeof (value as { left?: unknown }).left === 'number' && typeof (value as { top?: unknown }).top === 'number') return value as { left: number; top: number };
  } catch { /* default */ }
  if (capture.anchorX != null && capture.anchorY != null) {
    const left = capture.anchorX + 18 + 390 <= window.innerWidth
      ? capture.anchorX + 18
      : capture.anchorX - 408;
    return { left: clamp(left, 12, window.innerWidth - 402), top: clamp(capture.anchorY + 12, 58, window.innerHeight - 190) };
  }
  return { left: Math.max(24, window.innerWidth - 420), top: 88 };
}

function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
