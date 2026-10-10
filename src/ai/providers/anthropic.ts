/** Anthropic Messages 协议：system、工具消息、SSE 文本与工具参数。 */
import { AiError, type AiRequest, type AiCallOptions, type AiResult, type AiToolCall, type AiUsage } from '../types';
import { idleTimer, readSse } from '../sse';
import { withJsonHint } from './compat';
import { checkCustomResponse, customHeaders } from './custom';
import { scrubSecrets } from '../settings';

export function anthropicBody(model: string, req: AiRequest): Record<string, unknown> {
  const source = req.json ? withJsonHint(req.messages) : req.messages;
  const messages: { role: 'user' | 'assistant'; content: Record<string, unknown>[] }[] = [];
  for (const m of source) {
    if (m.role === 'system') continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content: Record<string, unknown>[] = [];
    if (m.role === 'tool') content.push({ type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content });
    else {
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const t of m.toolCalls ?? []) {
        let input: unknown;
        try { input = JSON.parse(t.args); } catch { throw new AiError('bad-response', '工具调用参数不是有效的 JSON'); }
        content.push({ type: 'tool_use', id: t.id, name: t.name, input });
      }
    }
    if (!content.length) continue;
    const last = messages[messages.length - 1];
    if (last?.role === role) last.content.push(...content);
    else messages.push({ role, content });
  }
  const body: Record<string, unknown> = { model, messages, max_tokens: req.maxTokens ?? 8192, stream: true };
  const system = source.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  if (system) body.system = system;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    body.tool_choice = { type: req.toolChoice === 'required' ? 'any' : req.toolChoice ?? 'auto' };
  }
  return body;
}

export async function anthropicChat(cfg: { url: string; key: string; model: string }, req: AiRequest, opts: AiCallOptions): Promise<Omit<AiResult, 'provider' | 'ms'>> {
  if (opts.signal?.aborted) throw new AiError('aborted', '已取消');
  const idle = idleTimer(opts.signal, 90_000);
  let text = '', model = cfg.model;
  let usage: AiUsage | undefined;
  const tools = new Map<number, { id: string; name: string; args: string; input: unknown }>();
  let stopped = false;
  const take = (j: any) => {
    if (j?.type === 'error' || j?.error) throw new AiError('other', `Anthropic 接口出错：${scrubSecrets(String(j.error?.message ?? '未知错误')).slice(0, 200)}`);
    const msg = j?.type === 'message_start' ? j.message : j;
    if (typeof msg?.model === 'string') model = msg.model;
    if (msg?.usage) usage = { inputTokens: msg.usage.input_tokens ?? usage?.inputTokens ?? 0, outputTokens: msg.usage.output_tokens ?? usage?.outputTokens ?? 0 };
    const addText = (piece: unknown) => {
      if (typeof piece === 'string' && piece) { text += piece; opts.onDelta?.(piece, text); }
    };
    const block = (b: any, i: number) => {
      if (b?.type === 'text') addText(b.text);
      if (b?.type === 'tool_use') tools.set(i, { id: b.id, name: b.name, args: '', input: b.input });
    };
    if (Array.isArray(j?.content)) j.content.forEach(block);
    if (j?.type === 'content_block_start') block(j.content_block, j.index);
    if (j?.type === 'content_block_delta') {
      if (j.delta?.type === 'text_delta') addText(j.delta.text);
      if (j.delta?.type === 'input_json_delta') {
        const t = tools.get(j.index);
        if (t) t.args += j.delta.partial_json ?? '';
      }
    }
    if (j?.type === 'message_stop') stopped = true;
  };
  try {
    const res = await fetch(cfg.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...customHeaders('anthropic', cfg.key) },
      body: JSON.stringify(anthropicBody(cfg.model, req)), signal: idle.signal,
      credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
    });
    idle.arm();
    await checkCustomResponse(res, 'anthropic', cfg.model);
    if (/application\/json/i.test(res.headers.get('content-type') ?? '') || !res.body) take(await res.json());
    else {
      for await (const ev of readSse(res.body, idle.arm)) {
        take(JSON.parse(ev.data));
        if (stopped) break;
      }
      if (!stopped) throw new AiError('bad-response', 'Anthropic 的流式回复中途结束，请再试一次');
    }
    const toolCalls: AiToolCall[] = [...tools.values()].map((t) => ({ id: t.id, name: t.name, args: t.args || JSON.stringify(t.input ?? {}) }));
    if (!text && !toolCalls.length) throw new AiError('bad-response', 'Anthropic 返回了空回复，请再试一次');
    return { text, model, usage, ...(toolCalls.length ? { toolCalls } : {}) };
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (opts.signal?.aborted) throw new AiError('aborted', '已取消');
    if (idle.timedOut()) throw new AiError('network', 'Anthropic 接口超过 90 秒没有回应，请稍后再试');
    if (e instanceof SyntaxError) throw new AiError('bad-response', 'Anthropic 返回的内容格式不正确');
    throw new AiError('network', '连不上 Anthropic 接口，请检查 baseUrl、网络及接口的浏览器跨域支持');
  } finally { idle.dispose(); }
}
