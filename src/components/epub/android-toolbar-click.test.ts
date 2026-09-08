import { describe, expect, it, vi } from 'vitest';
import { suppressDuplicateAndroidToolbarClick } from './android-toolbar-click';

describe('Android toolbar duplicate activation', () => {
  it.each([
    [true, true, 100, 200, 0], // Android's later native click must not reach the button.
    [true, false, 100, 200, 1], // Pointer-down's synthetic click must still activate it.
    [false, true, 100, 200, 1], // Desktop/iOS clicks stay untouched.
    [true, true, 200, 200, 1], // The suppression window expires.
  ])('guards a capture-phase click without duplicate action', (android, trusted, now, until, expectedCalls) => {
    const toolbar = document.createElement('div');
    const button = document.createElement('button');
    toolbar.append(button);
    const action = vi.fn();
    button.addEventListener('click', action);
    toolbar.addEventListener('click', event => {
      // jsdom events cannot be trusted; model the host's trust bit while keeping real propagation.
      suppressDuplicateAndroidToolbarClick({
        isTrusted: trusted,
        preventDefault: () => event.preventDefault(),
        stopImmediatePropagation: () => event.stopImmediatePropagation(),
      }, android, until, now);
    }, { capture: true });
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(action).toHaveBeenCalledTimes(expectedCalls);
  });
});
