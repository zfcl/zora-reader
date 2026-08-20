<script lang="ts">
  import "../../styles/epub/zora-lookup.css";
  import { onMount, tick, untrack } from "svelte";
  import type { App } from "obsidian";
  import type { IntegratedAISettings } from "../../config/integrated-ai-settings";
  import type { ReaderAnchorPoint, ReaderViewportRect } from "../../services/epub/reader-engine-types";
  import type { ZoraSelectionTranslationInput } from "../../services/ai/zora/zora-translation-service";
  import { runZoraGrammarAnalysis, type ZoraGrammarAnalysisResult } from "../../services/ai/zora/zora-grammar-service";
  import { appendGrammarStudyNote } from "../../services/ai/zora/zora-study-note-service";
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
  let result = $state<ZoraGrammarAnalysisResult | null>(null);
  let posTop = $state(0);
  let posLeft = $state(0);
  let isDocked = $state(false);
  let isDragging = $state(false);
  let userDragged = $state(false);
  let dragStartX = 0;
  let dragStartY = 0;
  let popoverStartLeft = 0;
  let popoverStartTop = 0;
  let studyNoteState = $state<"idle" | "saving" | "saved" | "error">("idle");
  let studyNoteMessage = $state("");
  let copied = $state(false);
  let generation = 0;

  let expandedQuote = $state(false);

  let widthTier = $derived.by(() => {
    const textLen = (selection?.text || "").trim().length;
    const pointsCount = result?.points?.length || 0;
    if (textLen < 45 && pointsCount <= 1) {
      return "tier-compact";
    }
    if (textLen < 120 && pointsCount <= 3) {
      return "tier-normal";
    }
    return "tier-wide";
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
    if (userDragged) return;
    await tick();
    const el = popoverEl;
    if (!el) return;
    const containerRect = viewportEl.getBoundingClientRect();
    const targetWidth = widthTier === "tier-compact" ? 450 : widthTier === "tier-normal" ? 530 : 640;
    const position = computeToolbarPosition({
      anchorRect: toRelativeRect(anchorRect),
      anchorRects: anchorRects.map(toRelativeRect),
      anchorPoint: anchorPoint
        ? { x: anchorPoint.x - containerRect.left, y: anchorPoint.y - containerRect.top }
        : undefined,
      containerWidth: viewportEl.clientWidth,
      containerHeight: viewportEl.clientHeight,
      toolbarWidth: Math.min(el.offsetWidth || targetWidth, viewportEl.clientWidth - 32),
      toolbarHeight: Math.min(el.offsetHeight || 420, viewportEl.clientHeight * 0.8),
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
      const elWidth = el?.offsetWidth || 640;
      const elHeight = el?.offsetHeight || 460;
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
    status = "loading";
    error = "";
    try {
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
    } catch (e) {
      if (token !== generation) return;
      error = e instanceof Error ? e.message : String(e);
      status = "error";
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
      `核心结构：${result.structure}`,
      ...(result.points.map((p) => `· ${p.label}${p.target ? ` (${p.target})` : ""}: ${p.explanation}`)),
      ...(result.difficulty ? [`难点解析：${result.difficulty}`] : []),
      ...(result.paraphrase ? [`整句理解：${result.paraphrase}`] : []),
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
    onmousedown={handleHeaderMouseDown}
  >
    <span class="zora-lookup-kind">语法解析</span>
    <button class="clickable-icon" onclick={onClose} aria-label="关闭">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6 6 18M6 6l12 12"></path>
      </svg>
    </button>
  </div>
  <div class="zora-lookup-body">
    <div class="zora-grammar-quote-box" class:is-expanded={expandedQuote}>
      <div class="zora-grammar-quote-text">{selection.text}</div>
      {#if selection.text.length > 100}
        <button class="zora-grammar-quote-toggle" onclick={() => (expandedQuote = !expandedQuote)}>
          {expandedQuote ? "收起" : "展开"}
        </button>
      {/if}
    </div>
    {#if status === "loading"}
      <div class="zora-lookup-loading">
        <span>正在分析语法…</span>
      </div>
    {:else if status === "error"}
      <div class="zora-lookup-error" role="alert">
        <span>{error}</span>
        <button class="mod-cta" onclick={() => run(++generation)}>重试</button>
      </div>
    {:else if result}
      {#if result.structure}
        <section class="zora-lookup-section">
          <h4>核心结构</h4>
          <div class="zora-grammar-structure-box">{result.structure}</div>
        </section>
      {/if}

      {#if result.points && result.points.length > 0}
        <section class="zora-lookup-section">
          <h4>关键语法</h4>
          <div class="zora-grammar-points-list">
            {#each result.points as point}
              <div class="zora-grammar-point-card">
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

      {#if result.difficulty}
        <section class="zora-lookup-section">
          <h4>难点解析</h4>
          <p class="zora-grammar-text">{result.difficulty}</p>
        </section>
      {/if}

      {#if result.paraphrase}
        <section class="zora-lookup-section">
          <h4>整句理解</h4>
          <p class="zora-lookup-translation">{result.paraphrase}</p>
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
