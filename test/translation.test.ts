import assert from 'node:assert/strict';
import test from 'node:test';
import { deepenSelection, parseTranslationResult, translateSelection } from '../src/translation.ts';

test('word result keeps every distinct reliable sense without a numeric cap', () => {
  const senses = Array.from({ length: 8 }, (_, index) => ({ label: `sense-${index}`, meaning: `meaning-${index}` }));
  const result = parseTranslationResult(JSON.stringify({ kind: 'word', source: 'bank', currentMeaning: '银行', translation: '银行', senses }), 'bank');
  assert.equal(result.senses.length, 8);
});

test('every request contains only a fresh system and current user message', async () => {
  const bodies: unknown[] = [];
  const send = async (request: { body?: string }) => {
    bodies.push(JSON.parse(request.body ?? '{}'));
    return { status: 200, text: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ kind: 'passage', source: 'x', translation: '译文', senses: [] }) } }] }) };
  };
  const config = { apiKey: 'secret', baseUrl: 'https://example.test', model: 'model', sourceLanguage: 'auto', targetLanguage: 'zh' };
  const capture = { text: 'first', context: 'first only', cfi: 'one', chapter: '', progress: 0 };
  await translateSelection(config, capture, send);
  await translateSelection(config, { ...capture, text: 'second', context: 'second only', cfi: 'two' }, send);
  assert.equal((bodies[0] as { messages: unknown[] }).messages.length, 2);
  assert.equal((bodies[1] as { messages: unknown[] }).messages.length, 2);
  assert.doesNotMatch(JSON.stringify(bodies[1]), /first/);
});

test('malformed model output fails closed instead of fabricating a translation', () => {
  assert.throws(() => parseTranslationResult('{"kind":"word","senses":[]}', 'bank'), /没有可用释义/);
});

test('deep understanding is a second fresh request without the first translation response', async () => {
  let body = '';
  const result = await deepenSelection(
    { apiKey: 'secret', baseUrl: 'https://example.test', model: 'model', sourceLanguage: 'en', targetLanguage: 'zh' },
    { text: 'He bore it well.', context: 'He bore it well.', cfi: 'cfi', chapter: 'One', progress: 0 },
    async (request) => {
      body = String(request.body);
      return { status: 200, text: JSON.stringify({ choices: [{ message: { content: '{"analysis":"bore 在此处表示承受。"}' } }] }) };
    },
  );
  assert.equal(result, 'bore 在此处表示承受。');
  assert.equal((JSON.parse(body) as { messages: unknown[] }).messages.length, 2);
  assert.doesNotMatch(body, /assistant/);
});
