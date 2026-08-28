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
  /** Force-cancel an active or stale drag session without committing a position */
  cancel: () => void;
  /** Exposed for lifecycle assertions and defensive close handling */
  isDragging: () => boolean;
  /** Clean up any active drag listeners / frames */
  destroy: () => void;
}

export function createZoraDraggable(options: ZoraDraggableOptions): ZoraDraggableController {
  let isDragging = false;
  let rafId: number | null = null;
  let cleanupListeners: (() => void) | null = null;
  let activePopoverEl: HTMLElement | null = null;
  let activeCaptureTarget: HTMLElement | null = null;
  let activePointerId: number | null = null;
  let activeSessionId = 0;
  let nextSessionId = 1;

  function releaseActivePointerCapture() {
    const captureTarget = activeCaptureTarget;
    const pointerId = activePointerId;
    activeCaptureTarget = null;
    activePointerId = null;

    if (captureTarget && pointerId !== null && typeof captureTarget.releasePointerCapture === "function") {
      try {
        captureTarget.releasePointerCapture(pointerId);
      } catch {
        // The capture may already have been released by WebKit.
      }
    }
  }

  function clearDragStyles(popoverEl = activePopoverEl) {
    if (!popoverEl) return;
    popoverEl.style.transform = "";
    popoverEl.style.willChange = "";
    popoverEl.classList.remove("is-dragging");
  }

  function cancelActiveDrag() {
    const wasDragging = isDragging;
    isDragging = false;
    activeSessionId = 0;

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    if (cleanupListeners) {
      const cleanup = cleanupListeners;
      cleanupListeners = null;
      cleanup();
    }

    releaseActivePointerCapture();
    clearDragStyles();
    activePopoverEl = null;

    if (wasDragging) {
      options.onDragStateChange?.(false);
    }
  }

  function destroy() {
    cancelActiveDrag();
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
    // A new real gesture is also the recovery path for a WebKit session that
    // never delivered pointerup/pointercancel/touchend.
    if (isDragging) {
      cancelActiveDrag();
    }
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

    const sessionId = nextSessionId++;
    const inputFamily = "pointerId" in e ? "pointer" : "touches" in e ? "touch" : "mouse";
    const currentTarget = e.currentTarget as HTMLElement | null;
    const eventWindow = currentTarget?.ownerDocument.defaultView ?? window;
    const eventDocument = currentTarget?.ownerDocument ?? popoverEl.ownerDocument;

    // Pointer capture is scoped to pointer sessions only.
    const pointerId = inputFamily === "pointer" ? (e as PointerEvent).pointerId : null;
    if (currentTarget && pointerId !== null && typeof currentTarget.setPointerCapture === "function") {
      try {
        currentTarget.setPointerCapture(pointerId);
        activeCaptureTarget = currentTarget;
        activePointerId = pointerId;
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
    activeSessionId = sessionId;
    activePopoverEl = popoverEl;
    options.onDragStateChange?.(true);

    popoverEl.classList.add("is-dragging");
    popoverEl.style.willChange = "transform";

    let currentDx = 0;
    let currentDy = 0;
    let latestTargetLeft = startLeft;
    let latestTargetTop = startTop;

    const handlePointerMove = (moveEvt: PointerEvent | MouseEvent | TouchEvent) => {
      if (!isDragging || activeSessionId !== sessionId) return;
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
          if (!isDragging || activeSessionId !== sessionId) return;
          popoverEl.style.transform = `translate3d(${currentDx}px, ${currentDy}px, 0)`;
        });
      }
    };

    const finishActiveDrag = () => {
      if (!isDragging || activeSessionId !== sessionId) return;
      isDragging = false;
      activeSessionId = 0;

      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      if (cleanupListeners) {
        const cleanup = cleanupListeners;
        cleanupListeners = null;
        cleanup();
      }

      releaseActivePointerCapture();

      const finalPos = { left: latestTargetLeft, top: latestTargetTop };

      // Commit reactive state first, mirror it directly onto the element, and
      // only then remove the temporary transform. This prevents a one-frame
      // jump back to the pre-drag Svelte left/top while its update is pending.
      options.onDragEnd(finalPos);
      popoverEl.style.left = `${finalPos.left}px`;
      popoverEl.style.top = `${finalPos.top}px`;
      clearDragStyles(popoverEl);
      activePopoverEl = null;
      options.onDragStateChange?.(false);

      if (isMobile) {
        setSessionMobilePopoverPosition(finalPos);
      }

      // Persist position ONLY ONCE at drag end
      options.onPersistPosition?.(finalPos);
    };

    const handleCancel = () => {
      if (activeSessionId === sessionId) {
        cancelActiveDrag();
      }
    };

    const handleVisibilityChange = () => handleCancel();

    const removeListeners = () => {
      if (inputFamily === "pointer") {
        eventWindow.removeEventListener("pointermove", handlePointerMove as EventListener, true);
        eventWindow.removeEventListener("pointerup", finishActiveDrag, true);
        eventWindow.removeEventListener("pointercancel", handleCancel, true);
        currentTarget?.removeEventListener("lostpointercapture", handleCancel, true);
      } else if (inputFamily === "touch") {
        eventWindow.removeEventListener("touchmove", handlePointerMove as EventListener, true);
        eventWindow.removeEventListener("touchend", finishActiveDrag, true);
        eventWindow.removeEventListener("touchcancel", handleCancel, true);
      } else {
        eventWindow.removeEventListener("mousemove", handlePointerMove as EventListener, true);
        eventWindow.removeEventListener("mouseup", finishActiveDrag, true);
      }
      eventWindow.removeEventListener("blur", handleCancel, true);
      eventDocument.removeEventListener("visibilitychange", handleVisibilityChange, true);
    };

    cleanupListeners = removeListeners;

    if (inputFamily === "pointer") {
      eventWindow.addEventListener("pointermove", handlePointerMove as EventListener, { capture: true, passive: false });
      eventWindow.addEventListener("pointerup", finishActiveDrag, { capture: true });
      eventWindow.addEventListener("pointercancel", handleCancel, { capture: true });
      currentTarget?.addEventListener("lostpointercapture", handleCancel, { capture: true });
    } else if (inputFamily === "touch") {
      eventWindow.addEventListener("touchmove", handlePointerMove as EventListener, { capture: true, passive: false });
      eventWindow.addEventListener("touchend", finishActiveDrag, { capture: true });
      eventWindow.addEventListener("touchcancel", handleCancel, { capture: true });
    } else {
      eventWindow.addEventListener("mousemove", handlePointerMove as EventListener, { capture: true });
      eventWindow.addEventListener("mouseup", finishActiveDrag, { capture: true });
    }
    eventWindow.addEventListener("blur", handleCancel, { capture: true });
    eventDocument.addEventListener("visibilitychange", handleVisibilityChange, { capture: true });
  }

  return {
    handleHeaderPointerDown,
    cancel: cancelActiveDrag,
    isDragging: () => isDragging,
    destroy,
  };
}
