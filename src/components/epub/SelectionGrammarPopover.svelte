<script lang="ts">
  import "../../styles/epub/zora-lookup.css";
  import { onMount, tick, untrack } from "svelte";
  import { Platform, type App } from "obsidian";
  import type { IntegratedAISettings } from "../../config/integrated-ai-settings";
  import type { ReaderAnchorPoint, ReaderViewportRect } from "../../services/epub/reader-engine-types";
  import type { ZoraSelectionTranslationInput } from "../../services/ai/zora/zora-translation-service";
  import {
    runZoraGrammarAnalysis,
    type ZoraGrammarAnalysisResult,
    type ZoraGrammarComplexity,
  } from "../../services/ai/zora/zora-grammar-service";
  import { appendGrammarStudyNote } from "../../services/ai/zora/zora-study-note-service";
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
  let result = $state<ZoraGrammarAnalysisResult | null>(null);
  let posTop = $state(0);
  let posLeft = $state(0);
  let isDocked = $state(false);
  let isDragging = $state(false);
  let userDragged = $state(false);
  let studyNoteState = $state<"idle" | "saving" | "saved" | "error">("idle");
  let studyNoteMessage = $state("");
  let copied = $state(false);
  let generation = 0;

  let expandedQuote = $state(false);

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

  let effectiveComplexity = $derived.by<ZoraGrammarComplexity>(() => {
    if (result?.complexity) return result.complexity;
    const textLen = (selection?.text || "").trim().length;
    const pointsCount = result?.points?.length || 0;
    if (textLen < 60 && pointsCount <= 3 && !result?.difficulty) {
      return "short";
    }
    if (textLen >= 140 || pointsCount >= 5) {
      return "complex";
    }
    return "medium";
  });

  let widthTier = $derived.by(() => {
    if (effectiveComplexity === "short") {
      return "tier-compact"; // ~480px (460~500px)
    }
    if (effectiveComplexity === "complex") {
      return "tier-wide"; // ~660px (620~680px)
    }
    return "tier-normal"; // ~560px (540~580px)
  });

  let pointsHeading = $derived(
    effectiveComplexity === "short" ? "关键点" : "关键语法"
  );

  let isLongQuote = $derived.by(() => {
    const textLen = (selection?.text || "").trim().length;
    const transLen = (result?.paraphrase || "").trim().length;
    return textLen > 80 || transLen > 60;
  });

  let showDifficulty = $derived.by(() => {
    if (!result?.difficulty || !result.difficulty.trim()) return false;
    const diff = result.difficulty.trim();
    if (diff === "无" || diff === "暂无" || diff === "无难点" || diff === "none") return false;
    if (result.paraphrase && diff === result.paraphrase.trim()) return false;
    return true;
  });

  let structureParts = $derived.by(() => {
    if (!result?.structure) return [];
    const raw = result.structure.trim();
    const parts = raw.split(/\s*(?:→|->|\+|\|)\s*/).filter(Boolean);
    if (parts.length > 1) {
      return parts;
    }
    return [];
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
      logMobileEvent("AI", "GrammarAnalysisStart", { length: selection.text?.length });
      const next = await runZoraGrammarAnalysis({
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
      logMobileEvent("AI", "GrammarAnalysisSuccess", { points: result?.points?.length });
    } catch (e) {
      if (token !== generation) return;
      error = e instanceof Error ? e.message : String(e);
      status = "error";
      logMobileError("AI", e, { context: "GrammarAnalysis" });
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

  async function handleSaveToStudyNote() {
    if (!result || studyNoteState === "saving") return;
    studyNoteState = "saving";
    studyNoteMessage = "";
    try {
      await appendGrammarStudyNote(app, {
        sentence: selection.text,
        structure: result.structure,
        points: result.points,
        difficulty: result.difficulty,
        paraphrase: result.paraphrase,
        bookPath: selection.bookPath,
        bookTitle: selection.bookTitle,
        cfiRange: selection.cfiRange,
      });
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
    if (!result) return;
    const lines = [
      `原句：${selection.text}`,
      ...(result.paraphrase ? [`译文：${result.paraphrase}`] : []),
      `句子骨架：${result.structure}`,
      ...(result.points.map((p) => `· ${p.label}${p.target ? ` (${p.target})` : ""}: ${p.explanation}`)),
      ...(showDifficulty && result.difficulty ? [`难点解析：${result.difficulty}`] : []),
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
  aria-label="Zora 语法解析"
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="zora-lookup-header"
    style="cursor: grab; user-select: none;"
    onpointerdown={draggable.handleHeaderPointerDown}
    ontouchstart={draggable.handleHeaderPointerDown}
    onmousedown={draggable.handleHeaderPointerDown}
  >
    <span class="zora-lookup-kind">语法解析</span>
    <button class="clickable-icon" onclick={onClose} aria-label="关闭">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <path d="M18 6 6 18M6 6l12 12"></path>
      </svg>
    </button>
  </div>
  <div class="zora-lookup-body">
    <div class="zora-grammar-quote-box" class:is-expanded={expandedQuote}>
      <div class="zora-grammar-quote-text">{selection.text}</div>
      {#if result?.paraphrase}
        <div class="zora-grammar-quote-translation">{result.paraphrase}</div>
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
          <span>正在分析语法…</span>
        </div>
      </div>
    {:else if status === "error"}
      <div class="zora-lookup-error" role="alert">
        <span>{error}</span>
        <button class="mod-cta" onclick={() => run(++generation)}>重试</button>
      </div>
    {:else if result}
      {#if result.structure}
        <section class="zora-lookup-section">
          <h4>句子骨架</h4>
          <div class="zora-grammar-structure-flow">
            {#each structureParts as part, idx}
              {#if idx > 0}
                <span class="zora-flow-arrow">→</span>
              {/if}
              <span class="zora-flow-node">{part}</span>
            {/each}
          </div>
        </section>
      {/if}

      {#if result.points && result.points.length > 0}
        <section class="zora-lookup-section">
          <h4>{pointsHeading}</h4>
          <div
            class="zora-grammar-points-list"
            class:grid-2col={result.points.length >= 2}
          >
            {#each result.points as point}
              <div class="zora-grammar-point-item">
                <div class="zora-grammar-point-head">
                  <span class="zora-pos">{point.label}</span>
                  {#if point.target}
                    <span class="zora-grammar-target">{point.target}</span>
                  {/if}
                </div>
                <div class="zora-grammar-point-desc">{point.explanation}</div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if showDifficulty && result.difficulty}
        <section class="zora-lookup-section">
          <h4>难点解析</h4>
          <p class="zora-grammar-difficulty-text">{result.difficulty}</p>
        </section>
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
    {#if studyNoteState === "error"}
      <div class="zora-lookup-vocab-error">{studyNoteMessage}</div>
    {/if}
  {/if}
</div>
