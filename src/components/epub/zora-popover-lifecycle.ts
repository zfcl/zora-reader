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
    popoverEl.style.pointerEvents = "none";
    popoverEl.remove();
  };
}

export interface SelectionDismissalSteps {
  clearPopoverState: () => void;
  hideToolbar: () => void;
  clearSelection: () => void;
}

/** Synchronously removes floating UI before selection observers are notified. */
export function dismissSelectionUiFirst(steps: SelectionDismissalSteps): void {
  steps.clearPopoverState();
  steps.hideToolbar();
  steps.clearSelection();
}
