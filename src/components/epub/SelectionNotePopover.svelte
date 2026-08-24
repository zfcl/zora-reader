<script lang="ts">
  import "../../styles/epub/zora-lookup.css";
  import { onMount, tick } from "svelte";
  import { Notice, Platform, type App } from "obsidian";
  import type { ReaderAnchorPoint, ReaderViewportRect } from "../../services/epub/reader-engine-types";
  import type { ZoraSelectionTranslationInput } from "../../services/ai/zora/zora-translation-service";
  import { appendBookReadingNote } from "../../services/ai/zora/zora-study-note-service";
  import { computeToolbarPosition } from "./toolbar-positioning";
  import { createZoraDraggable } from "./zora-draggable";

  interface Props {
    app: App;
    selection: ZoraSelectionTranslationInput;
    anchorRect: DOMRect;
    anchorRects?: DOMRect[];
    anchorPoint?: ReaderAnchorPoint;
    viewportEl: HTMLElement;
    onSaved?: (info: { cfiRange: string; blockId: string; text: string; filePath: string }) => void;
    onClose: () => void;
  }

  let { app, selection, anchorRect, anchorRects = [], anchorPoint, viewportEl, onSaved, onClose }: Props = $props();

  let popoverEl = $state<HTMLDivElement | null>(null);
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let noteText = $state("");
  let error = $state("");
  let saving = $state(false);
  let posTop = $state(0);
  let posLeft = $state(0);
  let isDocked = $state(false);
  let isDragging = $state(false);
  let userDragged = $state(false);

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
    const isMobile = Platform.isMobile || (typeof document !== "undefined" && (document.body.classList.contains("is-mobile") || document.body.classList.contains("is-phone")));
    if (isMobile) {
      posTop = 0;
      posLeft = 0;
      isDocked = true;
      return;
    }
    await tick();
    const el = popoverEl;
    if (!el) return;
    const containerRect = viewportEl.getBoundingClientRect();
    const position = computeToolbarPosition({
      anchorRect: toRelativeRect(anchorRect),
      anchorRects: anchorRects.map(toRelativeRect),
      anchorPoint: anchorPoint
        ? { x: anchorPoint.x - containerRect.left, y: anchorPoint.y - containerRect.top }
        : undefined,
      containerWidth: viewportEl.clientWidth,
      containerHeight: viewportEl.clientHeight,
      toolbarWidth: el.offsetWidth || 340,
      toolbarHeight: Math.min(el.offsetHeight || 320, viewportEl.clientHeight - 24),
      mobile: false,
      insetBottom: 0,
    });
    posTop = position.top;
    posLeft = position.left;
    isDocked = position.mode === "docked";
  }

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
    const isMobile = Platform.isMobile || (typeof document !== "undefined" && (document.body.classList.contains("is-mobile") || document.body.classList.contains("is-phone")));
    activeDocument.addEventListener("mousedown", handlePointerDown, { capture: true });
    activeDocument.addEventListener("touchstart", handlePointerDown, true);
    window.addEventListener("keydown", handleKeydown);
    if (!isMobile) {
      viewportEl.addEventListener("scroll", onClose, { passive: true });
    }
    void positionPopover().then(() => {
      textareaEl?.focus();
    });
    return () => {
      draggable.destroy();
      activeDocument.removeEventListener("mousedown", handlePointerDown, { capture: true });
      activeDocument.removeEventListener("touchstart", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeydown);
      if (!isMobile) {
        viewportEl.removeEventListener("scroll", onClose);
      }
    };
  });

  async function handleSaveNote() {
    const text = noteText.trim();
    if (!text) {
      error = "请输入笔记内容";
      return;
    }
    saving = true;
    error = "";
    try {
      const result = await appendBookReadingNote(app, {
        note: text,
        selectedText: selection.text,
        bookPath: selection.bookPath,
        bookTitle: selection.bookTitle,
        cfiRange: selection.cfiRange,
      });
      new Notice("已保存至读书笔记");
      onSaved?.({
        cfiRange: selection.cfiRange,
        blockId: result.blockId,
        text: selection.text,
        filePath: result.filePath,
      });
      onClose();
    } catch (e) {
      saving = false;
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div
  class="zora-lookup-popover epub-glass-panel"
  class:docked={isDocked}
  class:is-dragging={isDragging}
  style={`top: ${posTop}px; left: ${posLeft}px; user-select: ${isDragging ? "none" : "auto"};`}
  bind:this={popoverEl}
  role="dialog"
  aria-label="Zora 添加读书笔记"
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="zora-lookup-header"
    style="cursor: grab; user-select: none;"
    onpointerdown={draggable.handleHeaderPointerDown}
    onmousedown={draggable.handleHeaderPointerDown}
  >
    <span class="zora-lookup-kind">添加读书笔记</span>
    <button class="clickable-icon" onclick={onClose} aria-label="关闭">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6 6 18M6 6l12 12"></path>
      </svg>
    </button>
  </div>
  <div class="zora-lookup-body">
    <div class="zora-note-quote-preview">{selection.text}</div>
    <textarea
      class="zora-note-textarea"
      placeholder="记录你的思考、短笔记或阅读心得…"
      bind:value={noteText}
      bind:this={textareaEl}
      rows={4}
    ></textarea>
    {#if error}
      <div class="zora-lookup-error" role="alert" style="margin-top: 6px;">
        <span>{error}</span>
      </div>
    {/if}
  </div>
  <div class="zora-lookup-footer">
    <button onclick={onClose}>取消</button>
    <button class="zora-lookup-primary" onclick={handleSaveNote} disabled={saving}>
      {saving ? "保存中…" : "添加到读书笔记"}
    </button>
  </div>
</div>
