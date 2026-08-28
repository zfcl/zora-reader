/**
 * Zora Reader - Shared 60fps Popover Draggable Controller
 *
 * Designed for ultra-smooth 60fps GPU-accelerated dragging:
 * - pointerdown: one-time measurement of viewport & card rects, boundary caching, pointer capture
 * - pointermove: O(1) pure numerical clamp, requestAnimationFrame batched translate3d direct DOM update (zero Svelte reactivity overhead, zero layout thrashing)
 * - pointerup: commit final position to reactive state, clear temporary transform, invoke position persistence ONCE
 */

import { Platform } from "obsidian";
import { getMobileSafeBounds, setSessionMobilePopoverPosition } from "./toolbar-positioning";

export interface ZoraDraggableOptions {
  /** Returns the popover element to be moved */
  getPopoverEl: () => HTMLElement | null;
  /** Returns the viewport / boundary container element */
  getViewportEl: () => HTMLElement | null;
  /** Returns current left and top coordinates */
  getPos: () => { left: number; top: number };
  /** Notifies when drag state changes (e.g. to set isDragging reactive state) */
  onDragStateChange?: (isDragging: boolean) => void;
  /** Callback fired at drag start (e.g. to mark userDragged or undock) */
  onDragStart?: () => void;
  /** Callback fired at drag end with the final position */
  onDragEnd: (finalPos: { left: number; top: number }) => void;
  /** Callback fired ONLY ONCE on drag end to persist position */
  onPersistPosition?: (finalPos: { left: number; top: number }) => void;
}

export interface ZoraDraggableController {
  /** Pointerdown / mousedown event listener to attach to the draggable header */
  handleHeaderPointerDown: (e: PointerEvent | MouseEvent | TouchEvent) => void;
  /** Clean up any active drag listeners / frames */
  destroy: () => void;
}

export function createZoraDraggable(options: ZoraDraggableOptions): ZoraDraggableController {
  let isDragging = false;
  let rafId: number | null = null;
  let cleanupListeners: (() => void) | null = null;

  function destroy() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (cleanupListeners) {
      cleanupListeners();
      cleanupListeners = null;
    }
    isDragging = false;
  }

  function getCoords(evt: PointerEvent | MouseEvent | TouchEvent): { clientX: number; clientY: number } {
    if ("touches" in evt && evt.touches.length > 0) {
      return { clientX: evt.touches[0].clientX, clientY: evt.touches[0].clientY };
    }
    if ("changedTouches" in evt && evt.changedTouches.length > 0) {
      return { clientX: evt.changedTouches[0].clientX, clientY: evt.changedTouches[0].clientY };
    }
    return { clientX: (evt as MouseEvent).clientX, clientY: (evt as MouseEvent).clientY };
  }

  function handleHeaderPointerDown(e: PointerEvent | MouseEvent | TouchEvent) {
    if (isDragging) return;
    if ("button" in e && e.button !== 0) return;
    if ("touches" in e && e.touches.length > 1) return;

    // Ignore clicks originating on interactive elements (buttons, links, inputs, icons)
    const target = e.target as HTMLElement | null;
    if (target && target.closest("button, a, input, textarea, select, [role='button'], .clickable-icon")) {
      return;
    }

    const popoverEl = options.getPopoverEl();
    const viewportEl = options.getViewportEl();
    if (!popoverEl || !viewportEl) return;

    if ("cancelable" in e && e.cancelable) {
      e.preventDefault();
    }
    e.stopPropagation();

    // Pointer capture
    const currentTarget = e.currentTarget as HTMLElement | null;
    const pointerId = "pointerId" in e ? (e as PointerEvent).pointerId : undefined;
    if (currentTarget && pointerId !== undefined && typeof currentTarget.setPointerCapture === "function") {
      try {
        currentTarget.setPointerCapture(pointerId);
      } catch {
        // Fallback gracefully in unsupported environments
      }
    }

    options.onDragStart?.();

    const isMobile = Platform.isMobile || (typeof document !== "undefined" && (document.body.classList.contains("is-mobile") || document.body.classList.contains("is-phone")));

    const startCoords = getCoords(e);
    const startPointerX = startCoords.clientX;
    const startPointerY = startCoords.clientY;
    const currentPos = options.getPos();
    const startLeft = currentPos.left;
    const startTop = currentPos.top;

    const popoverWidth = popoverEl.offsetWidth || 500;
    const popoverHeight = popoverEl.offsetHeight || 440;

    let minLeft = 0;
    let maxLeft = 0;
    let minTop = 0;
    let maxTop = 0;

    if (isMobile) {
      const bounds = getMobileSafeBounds(viewportEl);
      minLeft = bounds.minLeft;
      maxLeft = Math.max(bounds.minLeft, bounds.maxRight - popoverWidth);
      minTop = bounds.minTop;
      maxTop = Math.max(bounds.minTop, bounds.maxBottom - popoverHeight);
    } else {
      const viewportWidth = viewportEl.clientWidth || window.innerWidth;
      const viewportHeight = viewportEl.clientHeight || window.innerHeight;
      minLeft = 0;
      maxLeft = Math.max(0, viewportWidth - popoverWidth);
      minTop = 0;
      maxTop = Math.max(0, viewportHeight - popoverHeight);
    }

    isDragging = true;
    options.onDragStateChange?.(true);

    popoverEl.classList.add("is-dragging");
    popoverEl.style.willChange = "transform";

    let currentDx = 0;
    let currentDy = 0;
    let latestTargetLeft = startLeft;
    let latestTargetTop = startTop;

    const handlePointerMove = (moveEvt: PointerEvent | MouseEvent | TouchEvent) => {
      if (!isDragging) return;
      if ("cancelable" in moveEvt && moveEvt.cancelable) {
        moveEvt.preventDefault();
      }
      moveEvt.stopPropagation();

      const moveCoords = getCoords(moveEvt);
      const rawDx = moveCoords.clientX - startPointerX;
      const rawDy = moveCoords.clientY - startPointerY;

      // Pure numerical clamp - O(1)
      latestTargetLeft = Math.max(minLeft, Math.min(maxLeft, startLeft + rawDx));
      latestTargetTop = Math.max(minTop, Math.min(maxTop, startTop + rawDy));

      currentDx = latestTargetLeft - startLeft;
      currentDy = latestTargetTop - startTop;

      // Batch DOM update to at most once per animation frame
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (!isDragging || !popoverEl) return;
          popoverEl.style.transform = `translate3d(${currentDx}px, ${currentDy}px, 0)`;
        });
      }
    };

    const handlePointerUp = (upEvt?: PointerEvent | MouseEvent | TouchEvent) => {
      if (!isDragging) return;
      isDragging = false;

      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      if (currentTarget && pointerId !== undefined && typeof currentTarget.releasePointerCapture === "function") {
        try {
          currentTarget.releasePointerCapture(pointerId);
        } catch {
          // Ignore
        }
      }

      // Remove window listeners
      if (cleanupListeners) {
        cleanupListeners();
        cleanupListeners = null;
      }

      // Reset direct DOM transform and will-change
      if (popoverEl) {
        popoverEl.style.transform = "";
        popoverEl.style.willChange = "";
        popoverEl.classList.remove("is-dragging");
      }

      options.onDragStateChange?.(false);

      // Commit final position to reactive state
      const finalPos = { left: latestTargetLeft, top: latestTargetTop };
      options.onDragEnd(finalPos);

      if (isMobile) {
        setSessionMobilePopoverPosition(finalPos);
      }

      // Persist position ONLY ONCE at drag end
      options.onPersistPosition?.(finalPos);
    };

    const removeListeners = () => {
      window.removeEventListener("pointermove", handlePointerMove, { capture: true });
      window.removeEventListener("pointerup", handlePointerUp, { capture: true });
      window.removeEventListener("pointercancel", handlePointerUp, { capture: true });
      window.removeEventListener("touchmove", handlePointerMove, { capture: true });
      window.removeEventListener("touchend", handlePointerUp, { capture: true });
      window.removeEventListener("touchcancel", handlePointerUp, { capture: true });
      window.removeEventListener("mousemove", handlePointerMove, { capture: true });
      window.removeEventListener("mouseup", handlePointerUp, { capture: true });
    };

    cleanupListeners = removeListeners;

    window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", handlePointerUp, { capture: true });
    window.addEventListener("pointercancel", handlePointerUp, { capture: true });
    window.addEventListener("touchmove", handlePointerMove, { capture: true, passive: false });
    window.addEventListener("touchend", handlePointerUp, { capture: true });
    window.addEventListener("touchcancel", handlePointerUp, { capture: true });
    window.addEventListener("mousemove", handlePointerMove, { capture: true });
    window.addEventListener("mouseup", handlePointerUp, { capture: true });
  }

  return {
    handleHeaderPointerDown,
    destroy,
  };
}
