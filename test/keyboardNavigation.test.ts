import assert from 'node:assert/strict';
import test from 'node:test';
import { getKeyboardPageAction, isEditableTarget } from '../src/keyboardNavigation.ts';

test('reader arrow keys map to page navigation', () => {
  assert.equal(getKeyboardPageAction({ key: 'ArrowLeft', isModified: false, isEditable: false }), 'previous');
  assert.equal(getKeyboardPageAction({ key: 'ArrowRight', isModified: false, isEditable: false }), 'next');
});

test('modified keys and editable controls keep their native behavior', () => {
  assert.equal(getKeyboardPageAction({ key: 'ArrowLeft', isModified: true, isEditable: false }), null);
  assert.equal(getKeyboardPageAction({ key: 'ArrowRight', isModified: false, isEditable: true }), null);
  assert.equal(getKeyboardPageAction({ key: 'Enter', isModified: false, isEditable: false }), null);
});

test('editable target detection also works for elements from a popout window realm', () => {
  assert.equal(isEditableTarget({ tagName: 'INPUT', isContentEditable: false } as unknown as EventTarget), true);
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget), true);
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: false } as unknown as EventTarget), false);
});
