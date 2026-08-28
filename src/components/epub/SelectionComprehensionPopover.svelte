<script lang="ts">
  import "../../styles/epub/zora-lookup.css";
  import { onMount, tick, untrack } from "svelte";
  import { Platform, type App } from "obsidian";
  import type { IntegratedAISettings } from "../../config/integrated-ai-settings";
  import type { ReaderAnchorPoint, ReaderViewportRect } from "../../services/epub/reader-engine-types";
  import type { ZoraSelectionTranslationInput } from "../../services/ai/zora/zora-translation-service";
  import {
    runZoraComprehensionAnalysis,
    type ZoraComprehensionResult,
    type ZoraComprehensionComplexity,
    type ZoraSenseGroup,
    type ZoraKeyPattern,
  } from "../../services/ai/zora/zora-comprehension-service";
  import {
    appendComprehensionHowToReadNote,
    appendComprehensionSingleChunkNote,
    appendComprehensionKeyPatternsNote,
    appendComprehensionSinglePatternNote,
    appendComprehensionSpecialNotesNote,
    appendComprehensionTransferNote,
  } from "../../services/ai/zora/zora-study-note-service";
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
  let result = $state<ZoraComprehensionResult | null>(null);
  let posTop = $state(0);
  let posLeft = $state(0);
  let isDocked = $state(false);
  let isDragging = $state(false);
  let userDragged = $state(false);
  let copied = $state(false);
  let generation = 0;

  let expandedQuote = $state(false);
  let showTransferMeaning = $state(false);

  let savedSections = $state<Record<string, "saving" | "saved" | "error">>({});
  let savedChunks = $state<Record<number, "saving" | "saved" | "error">>({});
  let savedPatterns = $state<Record<number, "saving" | "saved" | "error">>({});
  let noteErrorMessage = $state("");

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

  let effectiveComplexity = $derived.by<ZoraComprehensionComplexity>(() => {
    if (result?.complexity) return result.complexity;
    const textLen = (selection?.text || "").trim().length;
    const chunksCount = result?.howToRead?.length || 0;
    if (textLen < 60 && chunksCount === 0 && (!result?.specialNotes || result.specialNotes.length === 0)) {
      return "simple";
    }
    if (textLen >= 140 || chunksCount >= 4) {
      return "complex";
    }
    return "simple";
  });

  let widthTier = $derived.by(() => {
    if (effectiveComplexity === "simple") {
      return "tier-compact";
    }
    const textLen = (selection?.text || "").trim().length;
    if (textLen >= 140) {
      return "tier-wide";
    }
    return "tier-normal";
  });

  let isLongQuote = $derived.by(() => {
    const textLen = (selection?.text || "").trim().length;
    const transLen = (result?.translation || "").trim().length;
    return textLen > 80 || transLen > 60;
  });

  function toRelativeRect(rect: DOMRect | ReaderViewportRect) {
    const containerRect = viewportEl.getBoundingClientRect();
    return {
      top: rect.top - containerRect.top,
      left: rect.left - containerRect.left,
      bottom: rect.bottom - containerRect.top,
      right: rect.right - containerRect.left,
      width: rect.width,
      height: rect.height,
    };
  }

  async function positionPopover() {
    const isMobile = Platform.isMobile || (typeof document !== "undefined" && (document.body.classList.contains("is-mobile") || document.body.classList.contains("is-phone")));
    await tick();
    const el = popoverEl;
    if (!el) return;

    if (isMobile) {
      const targetWidth = el.offsetWidth || (widthTier === "tier-compact" ? 480 : widthTier === "tier-normal" ? 560 : 660);
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
    const targetWidth = widthTier === "tier-compact" ? 480 : widthTier === "tier-normal" ? 560 : 660;
    const position = computeToolbarPosition({
      anchorRect: toRelativeRect(anchorRect),
      anchorRects: anchorRects.map(toRelativeRect),
      anchorPoint: anchorPoint
        ? { x: anchorPoint.x - containerRect.left, y: anchorPoint.y - containerRect.top }
        : undefined,
      containerWidth: viewportEl.clientWidth,
      containerHeight: viewportEl.clientHeight,
      toolbarWidth: Math.min(el.offsetWidth || targetWidth, viewportEl.clientWidth - 32),
      toolbarHeight: Math.min(el.offsetHeight || 440, viewportEl.clientHeight * 0.75),
      mobile: false,
      insetBottom: 0,
    });
    posTop = position.top;
    posLeft = position.left;
    isDocked = position.mode === "docked";
  }

  async function run(token: number) {
    status = "loading";
    error = "";
    try {
      logMobileEvent("AI", "ComprehensionAnalysisStart", { length: selection.text?.length });
      const next = await runZoraComprehensionAnalysis({
        app,
        settings,
        text: selection.text,
        context: selection.context,
      });
      if (token !== generation) return;
      result = next;
      status = "success";
      await tick();
      await positionPopover();
      logMobileEvent("AI", "ComprehensionAnalysisSuccess", { chunks: result?.howToRead?.length, patterns: result?.keyPatterns?.length });
    } catch (e) {
      if (token !== generation) return;
      error = e instanceof Error ? e.message : String(e);
      status = "error";
      logMobileError("AI", e, { context: "ComprehensionAnalysis" });
    }
  }

  $effect(() => {
    const token = ++generation;
    untrack(() => {
      void run(token);
    });
  });

  function handlePointerDown(event: Event) {
    if (isDragging) return;
    const target = event.target as Node | null;
    if (target && popoverEl?.contains(target)) return;
    onClose();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }

  function handleViewportResize() {
    if (!popoverEl || !viewportEl) return;
    const isMobile = Platform.isMobile || (typeof document !== "undefined" && (document.body.classList.contains("is-mobile") || document.body.classList.contains("is-phone")));
    if (!isMobile) return;
    const width = popoverEl.offsetWidth || 560;
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

  // Section level save handlers
  async function handleSaveHowToReadSection() {
    if (!result?.howToRead || savedSections["howToRead"] === "saving") return;
    savedSections["howToRead"] = "saving";
    noteErrorMessage = "";
    try {
      await appendComprehensionHowToReadNote(app, {
        sentence: selection.text,
        items: result.howToRead,
        bookPath: selection.bookPath,
        bookTitle: selection.bookTitle,
        cfiRange: selection.cfiRange,
      });
      savedSections["howToRead"] = "saved";
      setTimeout(() => {
        if (savedSections["howToRead"] === "saved") {
          savedSections["howToRead"] = "idle" as any;
        }
      }, 1500);
    } catch (e) {
      savedSections["howToRead"] = "error";
      noteErrorMessage = e instanceof Error ? e.message : String(e);
    }
  }

  async function handleSaveSingleChunk(index: number, item: ZoraSenseGroup) {
    if (savedChunks[index] === "saving") return;
    savedChunks[index] = "saving";
    noteErrorMessage = "";
    try {
      await appendComprehensionSingleChunkNote(app, {
        sentence: selection.text,
        chunk: item.chunk,
        translation: item.translation,
        bookPath: selection.bookPath,
        bookTitle: selection.bookTitle,
        cfiRange: selection.cfiRange,
      });
      savedChunks[index] = "saved";
      setTimeout(() => {
        if (savedChunks[index] === "saved") {
          savedChunks[index] = "idle" as any;
        }
      }, 1500);
    } catch (e) {
      savedChunks[index] = "error";
      noteErrorMessage = e instanceof Error ? e.message : String(e);
    }
  }

  async function handleSaveKeyPatternsSection() {
    if (!result?.keyPatterns || savedSections["keyPatterns"] === "saving") return;
    savedSections["keyPatterns"] = "saving";
    noteErrorMessage = "";
    try {
      await appendComprehensionKeyPatternsNote(app, {
        sentence: selection.text,
        items: result.keyPatterns,
        bookPath: selection.bookPath,
        bookTitle: selection.bookTitle,
        cfiRange: selection.cfiRange,
      });
      savedSections["keyPatterns"] = "saved";
      setTimeout(() => {
        if (savedSections["keyPatterns"] === "saved") {
          savedSections["keyPatterns"] = "idle" as any;
        }
      }, 1500);
    } catch (e) {
      savedSections["keyPatterns"] = "error";
      noteErrorMessage = e instanceof Error ? e.message : String(e);
    }
  }

  async function handleSaveSinglePattern(index: number, item: ZoraKeyPattern) {
    if (savedPatterns[index] === "saving") return;
    savedPatterns[index] = "saving";
    noteErrorMessage = "";
    try {
      await appendComprehensionSinglePatternNote(app, {
        sentence: selection.text,
        pattern: item.pattern,
        meaning: item.meaning,
        bookPath: selection.bookPath,
        bookTitle: selection.bookTitle,
        cfiRange: selection.cfiRange,
      });
      savedPatterns[index] = "saved";
      setTimeout(() => {
        if (savedPatterns[index] === "saved") {
          savedPatterns[index] = "idle" as any;
        }
      }, 1500);
    } catch (e) {
      savedPatterns[index] = "error";
      noteErrorMessage = e instanceof Error ? e.message : String(e);
    }
  }

  async function handleSaveSpecialNotesSection() {
    if (!result?.specialNotes || savedSections["specialNotes"] === "saving") return;
    savedSections["specialNotes"] = "saving";
    noteErrorMessage = "";
    try {
      await appendComprehensionSpecialNotesNote(app, {
        sentence: selection.text,
        items: result.specialNotes,
        bookPath: selection.bookPath,
        bookTitle: selection.bookTitle,
        cfiRange: selection.cfiRange,
      });
      savedSections["specialNotes"] = "saved";
      setTimeout(() => {
        if (savedSections["specialNotes"] === "saved") {
          savedSections["specialNotes"] = "idle" as any;
        }
      }, 1500);
    } catch (e) {
      savedSections["specialNotes"] = "error";
      noteErrorMessage = e instanceof Error ? e.message : String(e);
    }
  }

  async function handleSaveTransferSection() {
    if (!result?.transferExample || savedSections["transferExample"] === "saving") return;
    savedSections["transferExample"] = "saving";
    noteErrorMessage = "";
    try {
      await appendComprehensionTransferNote(app, {
        sentence: selection.text,
        exampleSentence: result.transferExample.sentence,
        exampleTranslation: result.transferExample.translation,
        pattern: result.transferExample.pattern,
        bookPath: selection.bookPath,
        bookTitle: selection.bookTitle,
        cfiRange: selection.cfiRange,
      });
      savedSections["transferExample"] = "saved";
      setTimeout(() => {
        if (savedSections["transferExample"] === "saved") {
          savedSections["transferExample"] = "idle" as any;
        }
      }, 1500);
    } catch (e) {
      savedSections["transferExample"] = "error";
      noteErrorMessage = e instanceof Error ? e.message : String(e);
    }
  }

  async function handleCopy() {
    if (!result) return;
    const lines = [
      `原句：${selection.text}`,
      ...(result.translation ? [`译文：${result.translation}`] : []),
      ...(result.howToRead && result.howToRead.length > 0
        ? [
            `怎么读：`,
            ...result.howToRead.map((item) => `${item.chunk}\n→ ${item.translation}`),
          ]
        : []),
      ...(result.keyPatterns && result.keyPatterns.length > 0
        ? [
            `值得记住：`,
            ...result.keyPatterns.map((item) => `· ${item.pattern}: ${item.meaning}`),
          ]
        : []),
      ...(result.specialNotes && result.specialNotes.length > 0
        ? [
            `这里为什么这样说：`,
            ...result.specialNotes.map(
              (item) => `· ${item.target ? `${item.target}：` : ""}${item.explanation}`
            ),
          ]
        : []),
      ...(result.transferExample
        ? [
            `顺手记一下：`,
            result.transferExample.sentence,
            `→ ${result.transferExample.translation}`,
          ]
        : []),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      copied = true;
      setTimeout(() => { copied = false; }, 1500);
    } catch {
      copied = false;
    }
  }
</script>

<div
  class="zora-lookup-popover zora-grammar-popover epub-glass-panel {widthTier}"
  class:docked={isDocked}
  class:is-dragging={isDragging}
  style={`top: ${posTop}px; left: ${posLeft}px; user-select: ${isDragging ? "none" : "auto"};`}
  bind:this={popoverEl}
  role="dialog"
  aria-label="Zora 简易理解"
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="zora-lookup-header"
    style="cursor: grab; user-select: none;"
    onpointerdown={draggable.handleHeaderPointerDown}
    ontouchstart={draggable.handleHeaderPointerDown}
    onmousedown={draggable.handleHeaderPointerDown}
  >
    <span class="zora-lookup-kind">简易理解</span>
    <button class="clickable-icon" onclick={onClose} aria-label="关闭">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <path d="M18 6 6 18M6 6l12 12"></path>
      </svg>
    </button>
  </div>
  <div class="zora-lookup-body">
    <div class="zora-grammar-quote-box" class:is-expanded={expandedQuote}>
      <div class="zora-grammar-quote-text">{selection.text}</div>
      {#if result?.translation}
        <div class="zora-grammar-quote-translation">{result.translation}</div>
      {/if}
      {#if isLongQuote}
        <div class="zora-grammar-quote-action">
          <button
            type="button"
            class="zora-grammar-quote-toggle"
            onclick={() => (expandedQuote = !expandedQuote)}
            aria-label={expandedQuote ? "收起" : "展开"}
          >
            {expandedQuote ? "收起⌃" : "展开⌄"}
          </button>
        </div>
      {/if}
    </div>
    {#if status === "loading"}
      <div class="zora-lookup-loading">
        <div class="zora-lookup-spinner-row">
          <span class="epub-loading-spinner zora-mini-spinner"></span>
          <span>正在理解句子…</span>
        </div>
      </div>
    {:else if status === "error"}
      <div class="zora-lookup-error" role="alert">
        <span>{error}</span>
        <button class="mod-cta" onclick={() => run(++generation)}>重试</button>
      </div>
    {:else if result}
      {#if result.howToRead && result.howToRead.length > 0}
        <section class="zora-lookup-section">
          <div class="zora-section-header-row">
            <h4>怎么读</h4>
            <button
              type="button"
              class="zora-section-note-btn"
              class:is-saved={savedSections["howToRead"] === "saved"}
              disabled={savedSections["howToRead"] === "saving"}
              onclick={handleSaveHowToReadSection}
            >
              {savedSections["howToRead"] === "saved"
                ? "✓ 已添加"
                : savedSections["howToRead"] === "saving"
                  ? "添加中…"
                  : "+笔记"}
            </button>
          </div>
          <div class="zora-comprehension-flow">
            {#each result.howToRead as item, idx}
              <div class="zora-comprehension-chunk-item">
                <div class="zora-comprehension-chunk-head">
                  <div class="zora-comprehension-chunk-en">{item.chunk}</div>
                  <button
                    type="button"
                    class="zora-item-note-btn"
                    class:is-saved={savedChunks[idx] === "saved"}
                    disabled={savedChunks[idx] === "saving"}
                    onclick={() => handleSaveSingleChunk(idx, item)}
                    title="添加此意群到笔记"
                    aria-label="添加此意群到笔记"
                  >
                    {#if savedChunks[idx] === "saved"}
                      <span class="zora-btn-saved-text">✓ 已添加</span>
                    {:else if savedChunks[idx] === "saving"}
                      <span class="zora-btn-saving-text">…</span>
                    {:else}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                    {/if}
                  </button>
                </div>
                <div class="zora-comprehension-chunk-zh">
                  <span class="zora-chunk-arrow">→</span>
                  <span>{item.translation}</span>
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if result.keyPatterns && result.keyPatterns.length > 0}
        <section class="zora-lookup-section">
          <div class="zora-section-header-row">
            <h4>值得记住</h4>
            <button
              type="button"
              class="zora-section-note-btn"
              class:is-saved={savedSections["keyPatterns"] === "saved"}
              disabled={savedSections["keyPatterns"] === "saving"}
              onclick={handleSaveKeyPatternsSection}
            >
              {savedSections["keyPatterns"] === "saved"
                ? "✓ 已添加"
                : savedSections["keyPatterns"] === "saving"
                  ? "添加中…"
                  : "+笔记"}
            </button>
          </div>
          <div
            class="zora-grammar-points-list"
            class:grid-2col={result.keyPatterns.length >= 2}
          >
            {#each result.keyPatterns as item, idx}
              <div class="zora-grammar-point-item">
                <div class="zora-grammar-point-head" style="justify-content: space-between; width: 100%;">
                  <span class="zora-pos">{item.pattern}</span>
                  <button
                    type="button"
                    class="zora-item-note-btn"
                    class:is-saved={savedPatterns[idx] === "saved"}
                    disabled={savedPatterns[idx] === "saving"}
                    onclick={() => handleSaveSinglePattern(idx, item)}
                    title="添加此表达到笔记"
                    aria-label="添加此表达到笔记"
                  >
                    {#if savedPatterns[idx] === "saved"}
                      <span class="zora-btn-saved-text">✓ 已添加</span>
                    {:else if savedPatterns[idx] === "saving"}
                      <span class="zora-btn-saving-text">…</span>
                    {:else}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                    {/if}
                  </button>
                </div>
                <div class="zora-grammar-point-desc">{item.meaning}</div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if result.specialNotes && result.specialNotes.length > 0}
        <section class="zora-lookup-section">
          <div class="zora-section-header-row">
            <h4>这里为什么这样说</h4>
            <button
              type="button"
              class="zora-section-note-btn"
              class:is-saved={savedSections["specialNotes"] === "saved"}
              disabled={savedSections["specialNotes"] === "saving"}
              onclick={handleSaveSpecialNotesSection}
            >
              {savedSections["specialNotes"] === "saved"
                ? "✓ 已添加"
                : savedSections["specialNotes"] === "saving"
                  ? "添加中…"
                  : "+笔记"}
            </button>
          </div>
          <div class="zora-comprehension-special-list">
            {#each result.specialNotes as item}
              <div class="zora-grammar-point-item">
                {#if item.target}
                  <div class="zora-grammar-point-head">
                    <span class="zora-grammar-target">{item.target}</span>
                  </div>
                {/if}
                <div class="zora-grammar-difficulty-text">{item.explanation}</div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if result.transferExample}
        <section class="zora-lookup-section">
          <div class="zora-section-header-row">
            <h4>顺手记一下</h4>
            <button
              type="button"
              class="zora-section-note-btn"
              class:is-saved={savedSections["transferExample"] === "saved"}
              disabled={savedSections["transferExample"] === "saving"}
              onclick={handleSaveTransferSection}
            >
              {savedSections["transferExample"] === "saved"
                ? "✓ 已添加"
                : savedSections["transferExample"] === "saving"
                  ? "添加中…"
                  : "+笔记"}
            </button>
          </div>
          <div class="zora-transfer-box">
            <div class="zora-transfer-en">{result.transferExample.sentence}</div>
            <div class="zora-transfer-action">
              <button
                type="button"
                class="zora-transfer-reveal-btn"
                onclick={() => (showTransferMeaning = !showTransferMeaning)}
              >
                {showTransferMeaning ? "隐藏理解" : "查看理解 ›"}
              </button>
            </div>
            {#if showTransferMeaning}
              <div class="zora-transfer-zh">{result.transferExample.translation}</div>
            {/if}
          </div>
        </section>
      {/if}
    {/if}
  </div>
  {#if status === "success" && result}
    <div class="zora-lookup-footer">
      <button onclick={handleCopy} disabled={copied}>{copied ? "已复制" : "复制"}</button>
      <button onclick={onClose}>关闭</button>
    </div>
    {#if noteErrorMessage}
      <div class="zora-lookup-vocab-error">{noteErrorMessage}</div>
    {/if}
  {/if}
</div>
