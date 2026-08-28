<script lang="ts">
  import "../../styles/epub/zora-lookup.css";
  import { onMount, tick, untrack } from "svelte";
  import { Platform, type App } from "obsidian";
  import type { IntegratedAISettings } from "../../config/integrated-ai-settings";
  import type { ReaderAnchorPoint, ReaderViewportRect } from "../../services/epub/reader-engine-types";
  import type { TranslationResult } from "../../services/ai/zora/translation";
  import { runZoraSelectionTranslation, type ZoraSelectionTranslationInput } from "../../services/ai/zora/zora-translation-service";
  import { appendVocabularyStudyNote } from "../../services/ai/zora/zora-study-note-service";
  import { contextPosLabel } from "../../services/ai/zora/translation";
  import {
    computeToolbarPosition,
    computeMobilePopoverCenterPosition,
    clampPopoverPosition,
    getSessionMobilePopoverPosition,
  } from "./toolbar-positioning";
  import { createZoraDraggable } from "./zora-draggable";
  import { logMobileEvent, logMobileError } from "../../utils/zora-mobile-logger";

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
  let vocabState = $state<"idle" | "saving" | "saved" | "error">("idle");
  let vocabMessage = $state("");
  let studyNoteState = $state<"idle" | "saving" | "saved" | "error">("idle");
  let studyNoteMessage = $state("");
  let copied = $state(false);
  let generation = 0;

  const draggable = createZoraDraggable({
    getPopoverEl: () => popoverEl,
    getViewportEl: () => viewportEl,
    getPos: () => ({ left: posLeft, top: posTop }),
    onDragStart: () => {
      userDragged = true;
      isDocked = false;
    },
    onDragStateChange: (state) => {
      isDragging = state;
    },
    onDragEnd: (finalPos) => {
      posLeft = finalPos.left;
      posTop = finalPos.top;
      userDragged = true;
    },
  });

  function toRelativeRect(rect: DOMRect | ReaderViewportRect) {
    const containerRect = viewportEl.getBoundingClientRect();
    return { top: rect.top - containerRect.top, left: rect.left - containerRect.left, bottom: rect.bottom - containerRect.top, right: rect.right - containerRect.left, width: rect.width, height: rect.height };
  }

  async function positionPopover() {
    const isMobile = Platform.isMobile || (typeof document !== "undefined" && (document.body.classList.contains("is-mobile") || document.body.classList.contains("is-phone")));
    await tick();
    const el = popoverEl;
    if (!el) return;

    if (isMobile) {
      const targetWidth = el.offsetWidth || 500;
      const targetHeight = el.offsetHeight || 440;
      const center = computeMobilePopoverCenterPosition(targetWidth, targetHeight, viewportEl);
      const sessionPos = getSessionMobilePopoverPosition();

      if (userDragged || sessionPos) {
        const basePos = userDragged ? { left: posLeft, top: posTop } : sessionPos!;
        const clamped = clampPopoverPosition(basePos, targetWidth, targetHeight, viewportEl, true);
        posLeft = clamped.left;
        posTop = clamped.top;
      } else {
        posLeft = center.left;
        posTop = center.top;
      }
      isDocked = false;
      return;
    }

    if (userDragged) return;
    const containerRect = viewportEl.getBoundingClientRect();
    const position = computeToolbarPosition({
      anchorRect: toRelativeRect(anchorRect),
      anchorRects: anchorRects.map(toRelativeRect),
      anchorPoint: anchorPoint ? { x: anchorPoint.x - containerRect.left, y: anchorPoint.y - containerRect.top } : undefined,
      containerWidth: viewportEl.clientWidth,
      containerHeight: viewportEl.clientHeight,
      toolbarWidth: Math.min(el.offsetWidth || 500, viewportEl.clientWidth - 24),
      toolbarHeight: Math.min(el.offsetHeight || 440, viewportEl.clientHeight * 0.75),
      mobile: false,
      insetBottom: 0,
    });
    posTop = position.top;
    posLeft = position.left;
    isDocked = position.mode === "docked";
  }

  async function run(token: number) {
    status = "loading"; error = "";
    try {
      logMobileEvent("AI", "DictionaryLookupStart", { word: selection.text });
      const next = await runZoraSelectionTranslation({ app, settings, selection });
      if (token !== generation) return;
      result = next; status = "success"; await tick(); await positionPopover();
      logMobileEvent("AI", "DictionaryLookupSuccess", { word: selection.text, kind: result?.kind });
    } catch (e) {
      if (token !== generation) return;
      error = e instanceof Error ? e.message : String(e); status = "error";
      logMobileError("AI", e, { word: selection.text });
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

  function handleViewportResize() {
    if (!popoverEl || !viewportEl) return;
    const isMobile = Platform.isMobile || (typeof document !== "undefined" && (document.body.classList.contains("is-mobile") || document.body.classList.contains("is-phone")));
    if (!isMobile) return;
    const width = popoverEl.offsetWidth || 500;
    const height = popoverEl.offsetHeight || 440;
    const clamped = clampPopoverPosition({ left: posLeft, top: posTop }, width, height, viewportEl, true);
    posLeft = clamped.left;
    posTop = clamped.top;
  }

  onMount(() => {
    const isMobile = Platform.isMobile || (typeof document !== "undefined" && (document.body.classList.contains("is-mobile") || document.body.classList.contains("is-phone")));
    const originalParent = popoverEl?.parentNode ?? null;
    const originalNextSibling = popoverEl?.nextSibling ?? null;

    if (isMobile && popoverEl && popoverEl.parentNode !== activeDocument.body) {
      activeDocument.body.appendChild(popoverEl);
    }

    if (!isMobile) {
      activeDocument.addEventListener("mousedown", handlePointerDown, { capture: true });
      viewportEl.addEventListener("scroll", onClose, { passive: true });
    }

    window.addEventListener("keydown", handleKeydown);
    window.visualViewport?.addEventListener("resize", handleViewportResize);
    window.addEventListener("resize", handleViewportResize);
    window.addEventListener("orientationchange", handleViewportResize);

    void positionPopover();

    return () => {
      draggable.destroy();

      if (!isMobile) {
        activeDocument.removeEventListener("mousedown", handlePointerDown, { capture: true });
        viewportEl.removeEventListener("scroll", onClose);
      }

      window.removeEventListener("keydown", handleKeydown);
      window.visualViewport?.removeEventListener("resize", handleViewportResize);
      window.removeEventListener("resize", handleViewportResize);
      window.removeEventListener("orientationchange", handleViewportResize);

      if (
        isMobile &&
        popoverEl &&
        originalParent &&
        originalParent.isConnected &&
        popoverEl.parentNode === activeDocument.body
      ) {
        if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
          originalParent.insertBefore(popoverEl, originalNextSibling);
        } else {
          originalParent.appendChild(popoverEl);
        }
      }
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
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => { copied = false; }, 1500);
    } catch {
      copied = false;
    }
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
    onpointerdown={draggable.handleHeaderPointerDown}
    ontouchstart={draggable.handleHeaderPointerDown}
    onmousedown={draggable.handleHeaderPointerDown}
  >
    <span class="zora-lookup-kind">{result?.kind === "word" ? "词义" : result?.kind === "phrase" ? "短语" : "翻译"}</span>
    <button class="clickable-icon" onclick={onClose} aria-label="关闭">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <path d="M18 6 6 18M6 6l12 12"></path>
      </svg>
    </button>
  </div>
  <div class="zora-lookup-body">
    {#if status === "loading"}
      <div class="zora-lookup-loading">
        <span class="zora-lookup-target">{selection.text}</span>
        <div class="zora-lookup-spinner-row">
          <span class="epub-loading-spinner zora-mini-spinner"></span>
          <span>正在查询…</span>
        </div>
      </div>
    {:else if status === "error"}
      <div class="zora-lookup-error" role="alert">
        <span>{error}</span>
        <button class="mod-cta" onclick={() => run(++generation)}>重试</button>
      </div>
    {:else if result}
      {#if result.kind === "word"}
        <div class="zora-lookup-word-head">
          <div class="zora-dict-title-row">
            <span class="zora-lookup-display">{displayWord}</span>
            {#if result.phonetic}<span class="zora-lookup-phonetic">{result.phonetic}</span>{/if}
          </div>
          {#if result.surfaceForm && result.lemma && result.surfaceForm.toLowerCase() !== result.lemma.toLowerCase()}
            <div class="zora-lookup-surface">原型: {result.lemma} · 原文: {result.surfaceForm}</div>
          {/if}
        </div>
        <section class="zora-lookup-section">
          <h4>
            <span>当前语境</span>
            {#if result.contextPartOfSpeech || result.partOfSpeech}
              <span class="zora-pos">{contextPosLabel(result.contextPartOfSpeech || result.partOfSpeech)}</span>
            {/if}
          </h4>
          <div class="zora-lookup-context-box">
            <p class="zora-lookup-meaning">{result.currentMeaning || result.translation}</p>
            {#if result.contextExplanation}
              <p class="zora-lookup-explanation">{result.contextExplanation}</p>
            {/if}
          </div>
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
        <div class="zora-lookup-source">{selection.text}</div>
        <section class="zora-lookup-section">
          <h4>中文翻译</h4>
          <p class="zora-lookup-translation-main">{result.translation}</p>
        </section>
        {#if result.sentenceTranslation && result.sentenceTranslation !== result.translation}
          <section class="zora-lookup-section">
            <h4>本句翻译</h4>
            <p class="zora-lookup-translation">{result.sentenceTranslation}</p>
          </section>
        {/if}
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
