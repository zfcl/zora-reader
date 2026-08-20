<script lang="ts">
  import "../../styles/epub/zora-lookup.css";
  import { onMount, tick, untrack } from "svelte";
  import type { App } from "obsidian";
  import type { IntegratedAISettings } from "../../config/integrated-ai-settings";
  import type { ReaderAnchorPoint, ReaderViewportRect } from "../../services/epub/reader-engine-types";
  import type { TranslationResult } from "../../services/ai/zora/translation";
  import { runZoraSelectionTranslation, type ZoraSelectionTranslationInput } from "../../services/ai/zora/zora-translation-service";
  import { appendVocabularyStudyNote } from "../../services/ai/zora/zora-study-note-service";
  import { contextPosLabel } from "../../services/ai/zora/translation";
  import { computeToolbarPosition } from "./toolbar-positioning";

  interface Props {
    app: App;
    settings: IntegratedAISettings;
    selection: ZoraSelectionTranslationInput;
    anchorRect: DOMRect;
    anchorRects?: DOMRect[];
    anchorPoint?: ReaderAnchorPoint;
    viewportEl: HTMLElement;
    onClose: () => void;
  }
  let { app, settings, selection, anchorRect, anchorRects = [], anchorPoint, viewportEl, onClose }: Props = $props();
  let popoverEl = $state<HTMLDivElement | null>(null);
  let status = $state<"loading" | "success" | "error">("loading");
  let error = $state("");
  let result = $state<TranslationResult | null>(null);
  let posTop = $state(0);
  let posLeft = $state(0);
  let isDocked = $state(false);
  let isDragging = $state(false);
  let userDragged = $state(false);
  let dragStartX = 0;
  let dragStartY = 0;
  let popoverStartLeft = 0;
  let popoverStartTop = 0;
  let vocabState = $state<"idle" | "saving" | "saved" | "error">("idle");
  let vocabMessage = $state("");
  let studyNoteState = $state<"idle" | "saving" | "saved" | "error">("idle");
  let studyNoteMessage = $state("");
  let copied = $state(false);
  let generation = 0;

  function toRelativeRect(rect: DOMRect | ReaderViewportRect) {
    const containerRect = viewportEl.getBoundingClientRect();
    return { top: rect.top - containerRect.top, left: rect.left - containerRect.left, bottom: rect.bottom - containerRect.top, right: rect.right - containerRect.left, width: rect.width, height: rect.height };
  }
  async function positionPopover() {
    if (userDragged) return;
    await tick();
    const el = popoverEl;
    if (!el) return;
    const containerRect = viewportEl.getBoundingClientRect();
    const position = computeToolbarPosition({
      anchorRect: toRelativeRect(anchorRect),
      anchorRects: anchorRects.map(toRelativeRect),
      anchorPoint: anchorPoint ? { x: anchorPoint.x - containerRect.left, y: anchorPoint.y - containerRect.top } : undefined,
      containerWidth: viewportEl.clientWidth,
      containerHeight: viewportEl.clientHeight,
      toolbarWidth: el.offsetWidth || 340,
      toolbarHeight: Math.min(el.offsetHeight || 420, viewportEl.clientHeight - 24),
      mobile: false,
      insetBottom: 0,
    });
    posTop = position.top;
    posLeft = position.left;
    isDocked = position.mode === "docked";
  }

  function handleHeaderMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target && target.closest("button")) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    popoverStartLeft = posLeft;
    popoverStartTop = posTop;

    const handleMouseMove = (moveEvt: MouseEvent) => {
      if (!isDragging) return;
      moveEvt.preventDefault();
      const dx = moveEvt.clientX - dragStartX;
      const dy = moveEvt.clientY - dragStartY;

      const el = popoverEl;
      const elWidth = el?.offsetWidth || 340;
      const elHeight = el?.offsetHeight || 420;
      const maxLeft = Math.max(0, viewportEl.clientWidth - elWidth);
      const maxTop = Math.max(0, viewportEl.clientHeight - elHeight);

      posLeft = Math.max(0, Math.min(maxLeft, popoverStartLeft + dx));
      posTop = Math.max(0, Math.min(maxTop, popoverStartTop + dy));
      userDragged = true;
    };

    const handleMouseUp = () => {
      isDragging = false;
      window.removeEventListener("mousemove", handleMouseMove, { capture: true });
      window.removeEventListener("mouseup", handleMouseUp, { capture: true });
    };

    window.addEventListener("mousemove", handleMouseMove, { capture: true });
    window.addEventListener("mouseup", handleMouseUp, { capture: true });
  }

  async function run(token: number) {
    status = "loading"; error = "";
    try {
      const next = await runZoraSelectionTranslation({ app, settings, selection });
      if (token !== generation) return;
      result = next; status = "success"; await tick(); await positionPopover();
    } catch (e) {
      if (token !== generation) return;
      error = e instanceof Error ? e.message : String(e); status = "error";
    }
  }
  $effect(() => { const token = ++generation; untrack(() => { void run(token); }); });
  function handlePointerDown(event: Event) {
    if (isDragging) return;
    const target = event.target as Node | null;
    if (target && popoverEl?.contains(target)) return;
    onClose();
  }
  function handleKeydown(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
  onMount(() => {
    activeDocument.addEventListener("mousedown", handlePointerDown, { capture: true });
    activeDocument.addEventListener("touchstart", handlePointerDown, true);
    window.addEventListener("keydown", handleKeydown);
    viewportEl.addEventListener("scroll", onClose, { passive: true });
    void positionPopover();
    return () => {
      activeDocument.removeEventListener("mousedown", handlePointerDown, { capture: true });
      activeDocument.removeEventListener("touchstart", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeydown);
      viewportEl.removeEventListener("scroll", onClose);
    };
  });

  async function handleSaveVocabulary() {
    if (!result || vocabState === "saving") return;
    const plugin = (app as App & { plugins?: { getPlugin?(id: string): unknown } }).plugins?.getPlugin?.("zora-reader") as { saveVocabularyEntry?: (entry: unknown, result?: unknown) => Promise<unknown> } | null;
    if (!plugin?.saveVocabularyEntry) { vocabState = "error"; vocabMessage = "当前 Zora Reader 未加载"; return; }
    vocabState = "saving"; vocabMessage = "";
    try {
      await plugin.saveVocabularyEntry({
        word: selection.text,
        lemma: result.kind === "word" ? result.lemma : undefined,
        originalForm: result.surfaceForm,
        pronunciation: result.phonetic,
        contextualMeaning: result.currentMeaning || result.translation,
        contextExplanation: result.contextExplanation,
        commonMeanings: result.senses.map((sense) => ({ label: sense.label, meaning: sense.meaning, usage: sense.usage })),
        sourceSentence: selection.context,
        sentenceTranslation: result.sentenceTranslation,
        bookPath: selection.bookPath,
        bookTitle: selection.bookTitle,
        chapter: selection.chapter,
        cfiRange: selection.cfiRange,
        createdAt: new Date().toISOString(),
        reviewState: { interval: 0, ease: 2.5, lapses: 0, due: new Date().toISOString().slice(0, 10), status: "new" },
      }, {
        contextualMeaning: result.currentMeaning || result.translation,
        contextExplanation: result.contextExplanation,
        sentenceTranslation: result.sentenceTranslation,
        commonMeanings: result.senses.map((sense) => ({ label: sense.label, meaning: sense.meaning, usage: sense.usage })),
      });
      vocabState = "saved";
    } catch (e) { vocabState = "error"; vocabMessage = e instanceof Error ? e.message : String(e); }
  }

  async function handleSaveToStudyNote() {
    if (!result || studyNoteState === "saving") return;
    studyNoteState = "saving";
    studyNoteMessage = "";
    try {
      if (result.kind === "word") {
        await appendVocabularyStudyNote(app, {
          word: result.lemma || result.surfaceForm || selection.text,
          partOfSpeech: result.partOfSpeech || (result.contextPartOfSpeech ? contextPosLabel(result.contextPartOfSpeech) : undefined),
          contextMeaning: result.currentMeaning || result.translation,
          senses: result.senses,
          sentence: selection.context || result.sentenceTranslation,
          bookPath: selection.bookPath,
          bookTitle: selection.bookTitle,
          cfiRange: selection.cfiRange,
        });
      } else {
        await appendVocabularyStudyNote(app, {
          word: selection.text,
          contextMeaning: result.translation,
          sentence: selection.context,
          bookPath: selection.bookPath,
          bookTitle: selection.bookTitle,
          cfiRange: selection.cfiRange,
        });
      }
      studyNoteState = "saved";
      setTimeout(() => {
        if (studyNoteState === "saved") {
          studyNoteState = "idle";
        }
      }, 1800);
    } catch (e) {
      studyNoteState = "error";
      studyNoteMessage = e instanceof Error ? e.message : String(e);
    }
  }

  async function handleCopy() {
    const text = result ? (result.kind === "word" ? `${result.lemma || result.surfaceForm} ${result.phonetic || ""}\n${result.currentMeaning || result.translation}\n${result.senses.map((s) => `${s.label} ${s.meaning}`).join("\n")}` : result.translation) : selection.text;
    try { await navigator.clipboard.writeText(text); copied = true; } catch { copied = false; }
  }
  let displayWord = $derived(result?.kind === "word" ? (result.lemma || result.surfaceForm || selection.text) : selection.text);
  let visibleSenses = $derived(result?.kind === "word" ? result.senses.slice(0, 5) : []);
</script>

<div
  class="zora-lookup-popover epub-glass-panel"
  class:docked={isDocked}
  class:is-dragging={isDragging}
  style={`top: ${posTop}px; left: ${posLeft}px; user-select: ${isDragging ? "none" : "auto"};`}
  bind:this={popoverEl}
  role="dialog"
  aria-label="Zora 词义与翻译"
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="zora-lookup-header"
    style="cursor: grab; user-select: none;"
    onmousedown={handleHeaderMouseDown}
  >
    <span class="zora-lookup-kind">{result?.kind === "word" ? "词义" : result?.kind === "phrase" ? "短语" : "翻译"}</span>
    <button class="clickable-icon" onclick={onClose} aria-label="关闭"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"></path></svg></button>
  </div>
  <div class="zora-lookup-body">
    {#if status === "loading"}
      <div class="zora-lookup-loading"><span class="zora-lookup-target">{selection.text}</span><span>正在查询…</span></div>
    {:else if status === "error"}
      <div class="zora-lookup-error" role="alert"><span>{error}</span><button class="mod-cta" onclick={() => run(++generation)}>重试</button></div>
    {:else if result}
      {#if result.kind === "word"}
        <div class="zora-lookup-word-head">
          <div class="zora-lookup-display">{displayWord}</div>
          {#if result.phonetic}<div class="zora-lookup-phonetic">{result.phonetic}</div>{/if}
          {#if result.surfaceForm && result.lemma && result.surfaceForm !== result.lemma}<div class="zora-lookup-surface">原文形式：{result.surfaceForm}</div>{/if}
        </div>
        <section class="zora-lookup-section">
          <h4>当前语境 <span class="zora-pos">{contextPosLabel(result.contextPartOfSpeech || result.partOfSpeech)}</span></h4>
          <p class="zora-lookup-meaning">{result.currentMeaning || result.translation}</p>
          {#if result.contextExplanation}<p class="zora-lookup-explanation">{result.contextExplanation}</p>{/if}
        </section>
        {#if visibleSenses.length > 0}
          <section class="zora-lookup-section">
            <h4>常用释义</h4>
            <ol class="zora-lookup-senses">
              {#each visibleSenses as sense, index}
                <li>
                  <span class="zora-sense-index">{index + 1}</span>
                  {#if sense.label}<span class="zora-sense-label">{sense.label}</span>{/if}
                  <div class="zora-sense-content">
                    <span class="zora-sense-meaning">{sense.meaning}</span>
                    {#if sense.usage}<span class="zora-sense-usage">{sense.usage}</span>{/if}
                  </div>
                </li>
              {/each}
            </ol>
          </section>
        {/if}
        {#if result.sentenceTranslation}
          <section class="zora-lookup-section">
            <h4>本句翻译</h4>
            <p class="zora-lookup-translation">{result.sentenceTranslation}</p>
          </section>
        {/if}
      {:else}
        <div class="zora-lookup-source">{selection.text}</div><section class="zora-lookup-section"><h4>翻译</h4><p class="zora-lookup-translation">{result.translation}</p></section>
      {/if}
    {/if}
  </div>
  {#if status === "success" && result}
    <div class="zora-lookup-footer">
      <button onclick={handleCopy} disabled={copied}>{copied ? "已复制" : "复制"}</button>
      <button class="zora-lookup-primary" onclick={handleSaveToStudyNote} disabled={studyNoteState === "saving"}>
        {studyNoteState === "saved" ? "✓ 已添加" : studyNoteState === "saving" ? "添加中…" : "添加到外文笔记"}
      </button>
      <button onclick={onClose}>关闭</button>
    </div>
    {#if studyNoteState === "error"}<div class="zora-lookup-vocab-error">{studyNoteMessage}</div>{/if}
  {/if}
</div>
