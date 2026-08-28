import { describe, expect, it, vi } from "vitest";
import {
  createPopoverCloseHandlers,
  dismissSelectionUiFirst,
  hideMobilePopoverDom,
  mountMobilePopoverPortal,
  shouldPreserveMobilePopoverOnSelectionLoss,
} from "../zora-popover-lifecycle";

describe("zora popover lifecycle", () => {
  it("close press cancels drag before click invokes onClose", () => {
    const order: string[] = [];
    const draggable = { cancel: vi.fn(() => order.push("cancel")) };
    const onClose = vi.fn(() => order.push("close"));
    const handlers = createPopoverCloseHandlers(draggable, onClose);
    const button = document.createElement("button");

    const press = new Event("pointerdown", { bubbles: true, cancelable: true });
    const pressStop = vi.spyOn(press, "stopPropagation");
    handlers.handlePressStart(press);

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    const clickStop = vi.spyOn(click, "stopPropagation");
    button.dispatchEvent(click);
    handlers.handleClick(click);

    expect(pressStop).toHaveBeenCalledOnce();
    expect(clickStop).toHaveBeenCalledOnce();
    expect(draggable.cancel).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledOnce();
    expect(order).toEqual(["cancel", "cancel", "close"]);
  });

  it("mobile destroy hides and removes the portal without reparenting it", () => {
    const originalParent = document.createElement("div");
    const popover = document.createElement("div");
    const nextSibling = document.createElement("span");
    originalParent.append(popover, nextSibling);
    document.body.appendChild(originalParent);

    const teardown = mountMobilePopoverPortal(popover, document, true);
    expect(popover.parentNode).toBe(document.body);

    teardown();

    expect(popover.isConnected).toBe(false);
    expect(popover.style.visibility).toBe("hidden");
    expect(popover.style.opacity).toBe("0");
    expect(popover.style.pointerEvents).toBe("none");
    expect(originalParent.contains(popover)).toBe(false);
    expect(originalParent.firstChild).toBe(nextSibling);
  });

  it("synchronously hides the body portal before clearing state and selection", () => {
    const order: string[] = [];
    const popover = document.createElement("div");
    popover.className = "zora-lookup-popover";
    document.body.appendChild(popover);

    dismissSelectionUiFirst({
      hidePopoverDom: () => {
        order.push("dom");
        hideMobilePopoverDom(document);
      },
      clearPopoverState: () => order.push("popover"),
      hideToolbar: () => order.push("toolbar"),
      clearSelection: () => order.push("selection"),
    });

    expect(order).toEqual(["dom", "popover", "toolbar", "selection"]);
    expect(popover.style.visibility).toBe("hidden");
    expect(popover.style.opacity).toBe("0");
    expect(popover.style.pointerEvents).toBe("none");
    expect(popover.isConnected).toBe(false);
  });

  it("preserves an open mobile popover when the live selection collapses", () => {
    expect(shouldPreserveMobilePopoverOnSelectionLoss(true, true)).toBe(true);
    expect(shouldPreserveMobilePopoverOnSelectionLoss(true, false)).toBe(false);
    expect(shouldPreserveMobilePopoverOnSelectionLoss(false, true)).toBe(false);
  });
});
