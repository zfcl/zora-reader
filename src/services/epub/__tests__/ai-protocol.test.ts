import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from 'obsidian';
import { aiEndpoint, buildAIRequestBody, normalizeAIResponse, readAIText, resolveAIProtocol } from '../../ai/api-protocol';
import { normalizeIntegratedAISettings } from '../../../config/integrated-ai-settings';
import { clearDictionaryCache, deepenSelection, translateSelection } from '../../ai/zora/translation';
import { runZoraGrammarAnalysis } from '../../ai/zora/zora-grammar-service';
import { runZoraComprehensionAnalysis } from '../../ai/zora/zora-comprehension-service';
import { runIntegratedAIAction } from '../../ai/integrated-reader-ai';

const endpoint = 'https://example.com/go/v1';
const settings = () => normalizeIntegratedAISettings({ endpoint, apiProtocol: 'responses', model: 'test-model', apiKeyFallback: 'test-key' });
const response = (content: string, extra = {}) => ({ status: 'completed', output: [
  { type: 'reasoning', summary: [{ type: 'summary_text', text: 'private reasoning' }] },
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: content }] },
], ...extra });
const capture = { source: 'weave' as const, text: 'x', context: 'x context', sentenceContext: 'x context', cfi: 'one', chapter: '', progress: 0 };
const config = { apiKey: 'test-key', apiProtocol: 'responses' as const, baseUrl: endpoint, model: 'test-model', sourceLanguage: 'auto', targetLanguage: 'zh' };

beforeEach(() => { vi.clearAllMocks(); clearDictionaryCache(); });

describe('AI wire protocols', () => {
  it.each([
    [endpoint, 'responses', `${endpoint}/responses`],
    [`${endpoint}/responses/`, 'responses', `${endpoint}/responses`],
    [`${endpoint}/chat/completions/`, 'responses', `${endpoint}/responses`],
    [`${endpoint}/responses?version=1#hash`, 'chat-completions', `${endpoint}/chat/completions?version=1`],
    [`${endpoint}/responses`, undefined, `${endpoint}/responses`],
  ] as const)('normalizes %s for %s without losing provider prefix/query', (url, protocol, expected) => {
    expect(aiEndpoint(url, protocol)).toBe(expected);
  });
  it.each(['http://example.com/v1', 'not-a-url'])('rejects unsafe/invalid endpoints: %s', url => {
    expect(() => aiEndpoint(url, 'responses')).toThrow();
  });
  it('migrates legacy settings and preserves explicit protocol choices', () => {
    expect(normalizeIntegratedAISettings({}).apiProtocol).toBe('chat-completions');
    expect(normalizeIntegratedAISettings({ endpoint: `${endpoint}/responses` }).apiProtocol).toBe('responses');
    expect(normalizeIntegratedAISettings({ ...settings(), apiProtocol: 'responses' }).apiProtocol).toBe('responses');
    expect(resolveAIProtocol('chat-completions', `${endpoint}/responses`)).toBe('chat-completions');
    expect(normalizeIntegratedAISettings({ apiProtocol: 'invalid' }).apiProtocol).toBe('chat-completions');
  });
  it('maps JSON, output budget and full message context to Responses fields', () => {
    const messages = [{ role: 'system', content: 'Return JSON' }, { role: 'user', content: 'one' }, { role: 'assistant', content: 'two' }, { role: 'user', content: 'three' }];
    const body = buildAIRequestBody(endpoint, 'responses', { model: 'test', messages, maxTokens: 8000, json: true, temperature: 0.2, thinking: 'disabled' });
    expect(body).toEqual({ model: 'test', input: messages, max_output_tokens: 8000, stream: false, store: false, text: { format: { type: 'json_object' } } });
  });
  it('uses compatible reasoning fields only for recognized models/providers', () => {
    const options = { model: 'gpt-5', messages: [], maxTokens: 8192, thinking: 'enabled' as const, temperature: 0.2 };
    expect(buildAIRequestBody(endpoint, 'responses', options).reasoning).toEqual({ effort: 'medium' });
    const chat = buildAIRequestBody(endpoint, 'chat-completions', options);
    expect(chat.max_completion_tokens).toBe(8192);
    expect(chat).not.toHaveProperty('temperature');
    expect(chat).not.toHaveProperty('thinking');
    const unknown = buildAIRequestBody(endpoint, 'responses', { ...options, model: 'custom' });
    expect(unknown).not.toHaveProperty('reasoning');
  });
  it('keeps DeepSeek Chat Completions thinking and JSON settings', () => {
    const body = buildAIRequestBody('https://api.deepseek.com', undefined, { model: 'deepseek-chat', messages: [], maxTokens: 4096, thinking: 'disabled', json: true, temperature: 0.2 });
    expect(body).toMatchObject({ thinking: { type: 'disabled' }, max_tokens: 4096, response_format: { type: 'json_object' }, temperature: 0.2 });
  });
  it('collects output_text parts while ignoring reasoning and tool items', () => {
    const body = response('answer');
    body.output.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: ' 2' }] });
    expect(readAIText(body, 'responses')).toBe('answer 2');
    expect(readAIText({ output_text: 'proxy helper' }, 'responses')).toBe('proxy helper');
  });
  it.each([
    [response('', { status: 'failed', error: { message: 'bad model' } }), 'bad model'],
    [response('partial', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), 'Token'],
    [response('partial', { status: 'incomplete', incomplete_details: { reason: 'content_filter' } }), 'content_filter'],
    [response('partial', { status: 'in_progress' }), '尚未完成'],
    [{ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'cannot answer' }] }] }, 'cannot answer'],
    [response(''), '没有可显示'],
  ])('surfaces errors instead of treating them as successful results', (body, error) => {
    expect(() => readAIText(body, 'responses')).toThrow(error as string);
  });
  it('maps usage and truncation to existing diagnostics', () => {
    expect(normalizeAIResponse(response('partial', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 12, output_tokens: 30, total_tokens: 42, output_tokens_details: { reasoning_tokens: 20 } } }), 'responses')).toMatchObject({ choices: [{ finish_reason: 'length' }], usage: { prompt_tokens: 12, completion_tokens: 30, total_tokens: 42, completion_tokens_details: { reasoning_tokens: 20 } } });
  });
});

describe('Responses feature integration', () => {
  it('runs dictionary, syntax verification and contextual translation through Responses', async () => {
    const send = vi.fn(async (request: any) => {
      const body = JSON.parse(request.body);
      expect(request.url).toBe(`${endpoint}/responses`);
      expect(body).not.toHaveProperty('messages');
      expect(body.text.format.type).toBe('json_object');
      const system = body.input[0].content;
      const data = system.includes('syntactic analyst') ? { part_of_speech: 'noun', syntax_evidence: 'x context' }
        : system.includes('You are a dictionary.') ? { kind: 'word', phonetic: '/x/', part_of_speech: 'noun', senses: [{ label: 'noun', meaning: '某物' }] }
        : { context_meaning: '语境义', sentence_translation: '句译' };
      return { status: 200, text: JSON.stringify(response(JSON.stringify(data))) };
    });
    const result = await translateSelection(config, capture, send);
    expect(send).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ phonetic: '/x/', currentMeaning: '语境义', sentenceTranslation: '句译', contextPartOfSpeech: 'noun' });
  });
  it('runs phrase/passage translation through Responses', async () => {
    const send = vi.fn().mockResolvedValueOnce({ status: 200, text: JSON.stringify(response(JSON.stringify({ kind: 'passage', translation: '先译', senses: [] }))) })
      .mockResolvedValueOnce({ status: 200, text: JSON.stringify(response(JSON.stringify({ kind: 'passage', translation: '完整译文', senses: [] }))) });
    expect((await translateSelection(config, { ...capture, text: 'He reads a book.' }, send)).translation).toBe('完整译文');
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('supports the deeper reading helper', async () => {
    const send = vi.fn().mockResolvedValue({ status: 200, text: JSON.stringify(response('{"analysis":"解释"}')) });
    expect(await deepenSelection(config, capture, send)).toBe('解释');
    expect(send.mock.calls[0][0].url).toBe(`${endpoint}/responses`);
  });
  it('reports malformed network JSON and HTTP errors', async () => {
    await expect(deepenSelection(config, capture, vi.fn().mockResolvedValue({ status: 200, text: 'not json' }))).rejects.toThrow('无法解析');
    await expect(deepenSelection(config, capture, vi.fn().mockResolvedValue({ status: 401, text: '{"error":{"message":"invalid key"}}' }))).rejects.toThrow('invalid key');
  });
  it('runs grammar on mobile without SecretStorage using the saved fallback key', async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce({ status: 200, json: response(JSON.stringify({ structure: '主谓宾', points: [{ label: '现在时', explanation: '日常动作' }], paraphrase: '他读书。' })) } as any);
    const result = await runZoraGrammarAnalysis({ app: {} as any, settings: settings(), text: 'He reads books.', context: 'His daily routine.' });
    expect(result.paraphrase).toBe('他读书。');
    const request = vi.mocked(requestUrl).mock.calls[0][0];
    expect(request).toMatchObject({ url: `${endpoint}/responses`, headers: { Authorization: 'Bearer test-key' } });
    const body = JSON.parse((request as any).body);
    expect(body.max_output_tokens).toBeGreaterThanOrEqual(8192);
    expect(body.input[1].content).toContain('His daily routine.');
    expect(body).not.toHaveProperty('thinking');
  });
  it('runs comprehension through Responses and keeps structured teaching fields', async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce({ status: 200, json: response(JSON.stringify({ translation: '他读书。', howToRead: [{ chunk: 'He reads books', translation: '他读书' }], keyPatterns: [{ pattern: 'read books', meaning: '读书' }] })) } as any);
    const result = await runZoraComprehensionAnalysis({ app: {} as any, settings: settings(), text: 'He reads books.' });
    expect(result.translation).toBe('他读书。');
    expect(result.howToRead?.[0].chunk).toBe('He reads books');
    expect(vi.mocked(requestUrl).mock.calls[0][0]).toMatchObject({ url: `${endpoint}/responses` });
  });
  it.each(['english-grammar', 'context-appreciation', 'custom-assistant'])('routes integrated action %s through Responses', async actionId => {
    vi.mocked(requestUrl).mockResolvedValueOnce({ status: 200, json: response('助手答复') } as any);
    const openSettings = vi.fn();
    await runIntegratedAIAction({ app: {} as any, settings: settings(), actionId, selectedText: 'Read this.', openSettings });
    expect(openSettings).not.toHaveBeenCalled();
    expect(requestUrl).toHaveBeenCalledOnce();
    const request = vi.mocked(requestUrl).mock.calls[0][0];
    expect(request).toMatchObject({ url: `${endpoint}/responses` });
    const body = JSON.parse((request as any).body);
    expect(body.input[1].content).toContain('Read this.');
    expect(body).not.toHaveProperty('thinking');
  });
  it('passes Responses failure to grammar instead of displaying partial JSON', async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce({ status: 200, json: response('partial', { status: 'failed', error: { message: 'model unavailable' } }) } as any);
    await expect(runZoraGrammarAnalysis({ app: {} as any, settings: settings(), text: 'He reads.' })).rejects.toThrow('model unavailable');
  });
});
