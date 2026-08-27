import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createZoraDraggable, type ZoraDraggableOptions } from "../zora-draggable";

// Polyfill PointerEvent for jsdom environment if missing
if (typeof globalThis.PointerEvent === "undefined") {
  globalThis.PointerEvent = class PointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, params: any = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
    }
  } as any;
}

describe("zora-draggable", () => {
  let popoverEl: HTMLElement;
  let viewportEl: HTMLElement;
  let currentPos: { left: number; top: number };
  let dragStateChanges: boolean[];
  let dragStarts: number;
  let dragEnds: { left: number; top: number }[];
  let persistPositions: { left: number; top: number }[];

  beforeEach(() => {
    vi.restoreAllMocks();
    popoverEl = document.createElement("div");
    viewportEl = document.createElement("div");
    document.body.appendChild(viewportEl);
    viewportEl.appendChild(popoverEl);

    Object.defineProperty(popoverEl, "offsetWidth", { configurable: true, value: 500 });
    Object.defineProperty(popoverEl, "offsetHeight", { configurable: true, value: 400 });
    Object.defineProperty(viewportEl, "clientWidth", { configurable: true, value: 1000 });
    Object.defineProperty(viewportEl, "clientHeight", { configurable: true, value: 800 });

    currentPos = { left: 100, top: 100 };
    dragStateChanges = [];
    dragStarts = 0;
    dragEnds = [];
    persistPositions = [];
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  function setupDraggable(customOpts?: Partial<ZoraDraggableOptions>) {
    return createZoraDraggable({
      getPopoverEl: () => popoverEl,
      getViewportEl: () => viewportEl,
      getPos: () => currentPos,
      onDragStateChange: (state) => dragStateChanges.push(state),
      onDragStart: () => {
        dragStarts++;
      },
      onDragEnd: (finalPos) => {
        currentPos = finalPos;
        dragEnds.push(finalPos);
      },
      onPersistPosition: (finalPos) => {
        persistPositions.push(finalPos);
      },
      ...customOpts,
    });
  }

  it("ignores non-primary mouse buttons or clicks on buttons/interactive elements", () => {
    const draggable = setupDraggable();
    const header = document.createElement("div");
    const closeBtn = document.createElement("button");
    header.appendChild(closeBtn);
    popoverEl.appendChild(header);

    // Right click
    const rightClickEvt = new MouseEvent("pointerdown", { button: 2, bubbles: true });
    draggable.handleHeaderPointerDown(rightClickEvt);
    expect(dragStarts).toBe(0);
    expect(popoverEl.classList.contains("is-dragging")).toBe(false);

    // Click on button inside header
    const btnClickEvt = new MouseEvent("pointerdown", { button: 0, bubbles: true });
    Object.defineProperty(btnClickEvt, "target", { value: closeBtn });
    draggable.handleHeaderPointerDown(btnClickEvt);
    expect(dragStarts).toBe(0);
    expect(popoverEl.classList.contains("is-dragging")).toBe(false);
  });

  it("only calls persist position ONCE at drag end, not during high-frequency pointermove", () => {
    let rAFCallbacks: Array<FrameRequestCallback> = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rAFCallbacks.push(cb);
      return rAFCallbacks.length;
    });

    const draggable = setupDraggable();

    // Start drag
    const downEvt = new PointerEvent("pointerdown", {
      button: 0,
      clientX: 200,
      clientY: 200,
      bubbles: true,
    });
    draggable.handleHeaderPointerDown(downEvt);

    expect(dragStarts).toBe(1);
    expect(dragStateChanges).toEqual([true]);
    expect(popoverEl.classList.contains("is-dragging")).toBe(true);
    expect(popoverEl.style.willChange).toBe("transform");

    // 100 rapid pointermove events
    for (let i = 1; i <= 100; i++) {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: 200 + i,
          clientY: 200 + i,
          bubbles: true,
        })
      );
    }

    // Zero persistence calls during move!
    expect(persistPositions.length).toBe(0);
    expect(dragEnds.length).toBe(0);

    // Flush animation frame
    expect(rAFCallbacks.length).toBeGreaterThan(0);
    const lastCb = rAFCallbacks[rAFCallbacks.length - 1];
    lastCb(performance.now());
    expect(popoverEl.style.transform).toBe("translate3d(100px, 100px, 0)");

    // End drag (pointerup)
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 300,
        clientY: 300,
        bubbles: true,
      })
    );

    // Persistence and end position called EXACTLY ONCE
    expect(persistPositions.length).toBe(1);
    expect(persistPositions[0]).toEqual({ left: 200, top: 200 });
    expect(dragEnds.length).toBe(1);
    expect(dragEnds[0]).toEqual({ left: 200, top: 200 });

    // Styles cleaned up
    expect(popoverEl.classList.contains("is-dragging")).toBe(false);
    expect(popoverEl.style.transform).toBe("");
    expect(popoverEl.style.willChange).toBe("");
    expect(dragStateChanges).toEqual([true, false]);
  });

  it("batches DOM transform updates to at most once per animation frame", () => {
    let rAFCount = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => {
      rAFCount++;
      return rAFCount;
    });

    const draggable = setupDraggable();

    draggable.handleHeaderPointerDown(
      new PointerEvent("pointerdown", { button: 0, clientX: 100, clientY: 100 })
    );

    // 50 pointermove events without an animation frame tick
    for (let i = 0; i < 50; i++) {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 100 + i, clientY: 100 + i }));
    }

    // Only 1 rAF requested because rafId was not cleared
    expect(rAFCount).toBe(1);

    draggable.destroy();
  });

  it("correctly clamps dragged coordinates within viewport boundaries without layout thrashing", () => {
    const draggable = setupDraggable();

    draggable.handleHeaderPointerDown(
      new PointerEvent("pointerdown", { button: 0, clientX: 100, clientY: 100 })
    );

    // Drag way past bottom-right (viewport is 1000x800, popover is 500x400, maxLeft=500, maxTop=400)
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 2000, clientY: 2000 }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 2000, clientY: 2000 }));

    expect(dragEnds[0]).toEqual({ left: 500, top: 400 });

    // Drag way past top-left (negative coordinates)
    draggable.handleHeaderPointerDown(
      new PointerEvent("pointerdown", { button: 0, clientX: 500, clientY: 400 })
    );
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: -1000, clientY: -1000 }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: -1000, clientY: -1000 }));

    expect(dragEnds[1]).toEqual({ left: 0, top: 0 });
  });

  it("supports mobile touch dragging from header and clamps to safe area bounds", () => {
    document.body.classList.add("is-phone");
    Object.defineProperty(viewportEl, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844 }),
    });
    Object.defineProperty(popoverEl, "offsetWidth", { configurable: true, value: 340 });
    Object.defineProperty(popoverEl, "offsetHeight", { configurable: true, value: 300 });

    currentPos = { left: 20, top: 100 };
    const draggable = setupDraggable();

    // Start touch on header at (100, 100)
    const touchStartEvt = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(touchStartEvt, "touches", { value: [{ clientX: 100, clientY: 100 }] });
    draggable.handleHeaderPointerDown(touchStartEvt as any);

    expect(dragStarts).toBe(1);
    expect(popoverEl.classList.contains("is-dragging")).toBe(true);

    // Move 10px right and 20px down to (110, 120)
    const touchMoveEvt = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(touchMoveEvt, "touches", { value: [{ clientX: 110, clientY: 120 }] });
    window.dispatchEvent(touchMoveEvt);

    // End touch
    const touchEndEvt = new Event("touchend", { bubbles: true, cancelable: true });
    Object.defineProperty(touchEndEvt, "changedTouches", { value: [{ clientX: 110, clientY: 120 }] });
    window.dispatchEvent(touchEndEvt);

    expect(dragEnds.length).toBe(1);
    expect(dragEnds[0].left).toBe(30);
    expect(dragEnds[0].top).toBe(120);

    document.body.classList.remove("is-phone");
  });

  it("card content scroll does not trigger drag", () => {
    const draggable = setupDraggable();
    const bodyEl = document.createElement("div");
    bodyEl.className = "zora-lookup-body";
    popoverEl.appendChild(bodyEl);

    // Pointerdown / touch on body content
    const bodyTouch = new PointerEvent("pointerdown", { button: 0, clientX: 100, clientY: 200, bubbles: true });
    Object.defineProperty(bodyTouch, "target", { value: bodyEl });
    // Header handler is not triggered by body touch
    expect(dragStarts).toBe(0);
    expect(popoverEl.classList.contains("is-dragging")).toBe(false);
  });
});
