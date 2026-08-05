import type { PageNavigationDirection } from './pageNavigation';

export interface KeyboardPageNavigationInput {
  key: string;
  isModified: boolean;
  isEditable: boolean;
}

/**
 * 判断键盘事件是否应在阅读器中翻页，避免抢占输入控件的方向键。
 * Determines whether a key event should turn a reader page without taking arrow keys from inputs.
 */
export function getKeyboardPageAction(input: KeyboardPageNavigationInput): PageNavigationDirection | null {
  if (input.isModified || input.isEditable) return null;
  if (input.key === 'ArrowLeft') return 'previous';
  if (input.key === 'ArrowRight') return 'next';
  return null;
}

/**
 * 判断事件目标是否为可编辑控件。
 * Determines whether an event target is an editable control.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as { isContentEditable?: unknown; tagName?: unknown } | null;
  if (element == null || typeof element.tagName !== 'string') return false;
  return element.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
}
