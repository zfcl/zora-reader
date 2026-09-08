/** Shared wire adapter for every reader AI action. No host-specific networking. */
export type AIProtocol = 'chat-completions' | 'responses';

export interface AIMessage {
  role: string;
  content: string;
}

export interface AIRequestOptions {
  model: string;
  messages: AIMessage[];
  maxTokens: number;
  json?: boolean;
  temperature?: number;
  thinking?: 'enabled' | 'disabled';
}

/** Explicit protocol wins; old settings remain Chat Completions unless the URL says /responses. */
export function resolveAIProtocol(protocol?: AIProtocol, endpoint = ''): AIProtocol {
  if (protocol === 'responses' || protocol === 'chat-completions') return protocol;
  try {
    if (/\/responses\/?$/i.test(new URL(endpoint.trim()).pathname)) return 'responses';
  } catch { /* URL validation happens before sending. */ }
  return 'chat-completions';
}

export function aiEndpoint(endpoint: string, protocol?: AIProtocol): string {
  let url: URL;
  try { url = new URL(endpoint.trim()); }
  catch { throw new Error('API Endpoint 不是有效网址，请在 AI 设置中检查'); }
  if (url.protocol !== 'https:') throw new Error('为保护 API Key，API Endpoint 必须使用 HTTPS');
  const selected = resolveAIProtocol(protocol, endpoint);
  const base = url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|responses)$/i, '');
  // Preserve provider-specific prefixes (including /go/v1) and query parameters.
  url.pathname = `${base}/${selected === 'responses' ? 'responses' : 'chat/completions'}`;
  url.hash = '';
  return url.toString();
}

function supportsDeepSeekThinking(endpoint: string, model: string): boolean {
  let host: string;
  try { host = new URL(endpoint).hostname; } catch { return false; }
  return host === 'deepseek.com' || host.endsWith('.deepseek.com') ||
    ((host === 'opencode.ai' || host.endsWith('.opencode.ai')) && /deepseek/i.test(model));
}

function supportsOpenAIReasoning(model: string): boolean {
  return /^(?:o[1-9](?:-|$)|gpt-[5-9](?:[.-]|$))/i.test(model);
}

export function buildAIRequestBody(endpoint: string, protocol: AIProtocol | undefined, options: AIRequestOptions): Record<string, unknown> {
  const selected = resolveAIProtocol(protocol, endpoint);
  if (selected === 'responses') {
    return {
      model: options.model,
      input: options.messages,
      max_output_tokens: options.maxTokens,
      stream: false,
      store: false,
      ...(options.json ? { text: { format: { type: 'json_object' } } } : {}),
      // Do not send Chat Completions / vendor-only fields to Responses servers.
      // Let unknown models use their own reasoning defaults.
      ...(options.thinking === 'enabled' && supportsOpenAIReasoning(options.model)
        ? { reasoning: { effort: 'medium' } } : {}),
    };
  }
  const deepSeek = supportsDeepSeekThinking(endpoint, options.model);
  const reasoning = supportsOpenAIReasoning(options.model);
  return {
    model: options.model,
    messages: options.messages,
    ...(reasoning ? { max_completion_tokens: options.maxTokens } : { max_tokens: options.maxTokens }),
    stream: false,
    ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    ...(options.temperature !== undefined && !reasoning ? { temperature: options.temperature } : {}),
    ...(options.thinking && deepSeek ? { thinking: { type: options.thinking } } : {}),
    ...(options.thinking === 'enabled' && (deepSeek || reasoning) ? { reasoning_effort: 'medium' } : {}),
  };
}

interface AIEnvelope {
  choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string };
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

/** Normalize only the wire envelope, retaining the existing grammar/translation parsers. */
export function normalizeAIResponse(value: unknown, protocol?: AIProtocol, endpoint = ''): AIEnvelope {
  const body = record(value);
  if (resolveAIProtocol(protocol, endpoint) !== 'responses') return body as AIEnvelope;
  if (body.error) return { error: { message: String(record(body.error).message || 'AI 服务请求失败') } };
  if (body.status === 'failed' || body.status === 'cancelled') {
    return { error: { message: `AI 请求未完成（${body.status}）` } };
  }
  const incompleteReason = record(body.incomplete_details).reason;
  if (body.status === 'incomplete' && incompleteReason !== 'max_output_tokens') {
    return { error: { message: `AI 输出未完成（${incompleteReason || '原因未知'}）` } };
  }
  if (body.status && !['completed', 'incomplete'].includes(body.status)) {
    return { error: { message: `AI 请求尚未完成（${body.status}）` } };
  }
  const texts: string[] = [];
  let refusal = '';
  for (const rawItem of Array.isArray(body.output) ? body.output : []) {
    const item = record(rawItem);
    if (item.type !== 'message') continue; // Never show reasoning as the answer.
    for (const rawPart of Array.isArray(item.content) ? item.content : []) {
      const part = record(rawPart);
      if (part.type === 'output_text' && typeof part.text === 'string') texts.push(part.text);
      if (part.type === 'refusal') refusal = String(part.refusal || '模型拒绝了此请求');
    }
  }
  if (refusal) return { error: { message: refusal } };
  const content = texts.length ? texts.join('') : typeof body.output_text === 'string' ? body.output_text : '';
  const usage = record(body.usage);
  return {
    choices: [{ message: { content }, finish_reason: body.status === 'incomplete' ? 'length' : 'stop' }],
    usage: {
      prompt_tokens: usage.input_tokens,
      completion_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
      completion_tokens_details: usage.output_tokens_details,
    },
  };
}

export function readAIText(value: unknown, protocol?: AIProtocol, endpoint = ''): string {
  const envelope = normalizeAIResponse(value, protocol, endpoint);
  if (envelope.error?.message) throw new Error(envelope.error.message);
  const choice = envelope.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('输出被截断（超出最大 Token 限制），请提高最大输出 Token 后重试。');
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('AI 服务返回的数据中没有可显示的内容');
  return content;
}
