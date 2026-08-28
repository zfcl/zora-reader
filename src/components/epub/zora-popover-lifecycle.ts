import type { ZoraDraggableController } from "./zora-draggable";

export interface PopoverCloseHandlers {
  handlePressStart: (event: Event) => void;
  handleClick: (event?: Event) => void;
}

/**
 * Keeps the close control independent from the draggable header. A press on X
 * first breaks any stale drag session; the click then cancels defensively once
 * more before invoking the component's close callback.
 */
export function createPopoverCloseHandlers(
  draggable: Pick<ZoraDraggableController, "cancel">,
  onClose: () => void
): PopoverCloseHandlers {
  return {
    handlePressStart(event: Event) {
      event.stopPropagation();
      draggable.cancel();
    },
    handleClick(event?: Event) {
      event?.stopPropagation();
      draggable.cancel();
      onClose();
    },
  };
}

/**
 * Portals a mobile fixed-position card to the active document. Teardown hides
 * and removes it in place; it is intentionally never reparented into the EPUB
 * reader, where containment can make it flash at the top for one frame.
 */
export function mountMobilePopoverPortal(
  popoverEl: HTMLElement | null,
  targetDocument: Document,
  isMobile: boolean
): () => void {
  if (!popoverEl || !isMobile) {
    return () => {};
  }

  if (popoverEl.parentNode !== targetDocument.body) {
    targetDocument.body.appendChild(popoverEl);
  }

  return () => {
    popoverEl.style.visibility = "hidden";
    popoverEl.style.opacity = "0";
    popoverEl.style.pointerEvents = "none";
    popoverEl.remove();
  };
}

/**
 * Hides portalled lookup cards synchronously, before Svelte gets a chance to
 * flush state-driven teardown. This closes the one-frame gap that is visible
 * on iOS when the selection is dismissed.
 */
export function hideMobilePopoverDom(targetDocument: Document): void {
  const candidates = targetDocument.querySelectorAll<HTMLElement>(".zora-lookup-popover");
  for (const popoverEl of candidates) {
    if (popoverEl.parentNode !== targetDocument.body) continue;
    popoverEl.style.visibility = "hidden";
    popoverEl.style.opacity = "0";
    popoverEl.style.pointerEvents = "none";
  }
}

export interface SelectionDismissalSteps {
  hidePopoverDom: () => void;
  clearPopoverState: () => void;
  hideToolbar: () => void;
  clearSelection: () => void;
}

/** Synchronously removes floating UI before selection observers are notified. */
export function dismissSelectionUiFirst(steps: SelectionDismissalSteps): void {
  steps.hidePopoverDom();
  steps.clearPopoverState();
  steps.hideToolbar();
  steps.clearSelection();
}
