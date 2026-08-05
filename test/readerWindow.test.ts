import assert from 'node:assert/strict';
import test from 'node:test';
import { getReaderDocument, getReaderWindow } from '../src/readerWindow.ts';

test('reader DOM owner window takes precedence over the global window', () => {
  const popoutWindow = {} as Window;
  const mainWindow = {} as Window;

  assert.equal(getReaderWindow({ ownerDocument: { defaultView: popoutWindow } as Document }, mainWindow), popoutWindow);
});

test('reader DOM owner document takes precedence over the global document', () => {
  const popoutDocument = {} as Document;
  const mainDocument = {} as Document;

  assert.equal(getReaderDocument({ ownerDocument: popoutDocument }, mainDocument), popoutDocument);
});

test('reader window helpers fall back to the global context before mounting', () => {
  const mainWindow = {} as Window;
  const mainDocument = {} as Document;

  assert.equal(getReaderWindow(null, mainWindow), mainWindow);
  assert.equal(getReaderDocument(null, mainDocument), mainDocument);
});
