import assert from 'node:assert/strict';
import test from 'node:test';
import { getReaderThemeRules, refreshEpubViews, resolveReaderColors } from '../src/readerBackground.ts';

test('paper mode is a coherent authored reading palette', () => {
  assert.deepEqual(resolveReaderColors('paper', '#123456', '#fbfaf8', '#2d2b29'), {
    background: '#f6f1e7',
    text: '#262522',
  });
});

test('night and contrast modes use fixed accessible palettes', () => {
  assert.deepEqual(resolveReaderColors('night', '', '', ''), {
    background: '#17191d',
    text: '#e9e7e2',
  });
  assert.deepEqual(resolveReaderColors('contrast', '', '', ''), {
    background: '#ffffff',
    text: '#111111',
  });
});

test('theme colors are base rules that do not override publisher element colors', () => {
  assert.deepEqual(getReaderThemeRules({ background: '#fbfaf8', text: '#2d2b29' }), {
    html: { background: '#fbfaf8' },
    body: { background: '#fbfaf8', color: '#2d2b29' },
  });
});

test('refreshes every open EPUB view with its current file', async () => {
  const loaded: string[] = [];
  await refreshEpubViews([
    { file: 'first.epub', onLoadFile: async (file) => { loaded.push(file); } },
    { file: 'second.epub', onLoadFile: async (file) => { loaded.push(file); } },
  ]);

  assert.deepEqual(loaded, ['first.epub', 'second.epub']);
});
