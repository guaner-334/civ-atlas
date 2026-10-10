import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { aiChat, getAiStatus } from '../src/ai/client';
import { setupAi } from '../src/ai/setup';
import { chooseProvider, getAiSettings, getSecrets, resetAiSettingsForTest, sanitizeSettings, scrubSecrets, setSecret, updateAiSettings } from '../src/ai/settings';
import { customEndpoint, fetchCustomModels } from '../src/ai/providers/custom';
import { anthropicBody } from '../src/ai/providers/anthropic';
import type { AiRequest } from '../src/ai/types';

const req: AiRequest = { feature: '测试', messages: [{ role: 'system', content: '请用中文' }, { role: 'user', content: '你好' }] };
const key = 'test-custom-secret-123456';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
beforeAll(setupAi);
afterEach(() => { vi.unstubAllGlobals(); resetAiSettingsForTest(); chooseProvider(null); });

describe('自定义兼容 AI', () => {
  it('旧设置补上新模块，两个模块的配置独立且可以清空模型', () => {
    expect(sanitizeSettings({ provider: 'deepseek' }).openai).toEqual({ baseUrl: '', model: '' });
    updateAiSettings({ openai: { baseUrl: 'https://proxy.test/v1', model: 'custom-model' }, anthropic: { model: 'claude-custom' } });
    updateAiSettings({ openai: { model: '' } });
    expect(getAiSettings().openai).toEqual({ baseUrl: 'https://proxy.test/v1', model: '' });
    expect(getAiSettings().anthropic.model).toBe('claude-custom');
    chooseProvider('openai');
    expect(getAiStatus().ready).toBe(false);
  });

  it('新密钥遵循记住开关和脱敏规则', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) });
    resetAiSettingsForTest();
    setSecret('openai', key);
    setSecret('anthropic', 'anthropic-secret-123456');
    expect(scrubSecrets(`${key} anthropic-secret-123456`)).toBe('*** ***');
    resetAiSettingsForTest();
    expect(getSecrets().openai).toBe(key);
    updateAiSettings({ remember: false });
    expect(data.has('civ-atlas:ai-secrets')).toBe(false);
    expect(getSecrets().openai).toBe(key);
    resetAiSettingsForTest();
    expect(getSecrets().openai).toBeUndefined();
  });

  it('支持根地址、版本路径、代理路径、末尾斜杠及完整调用地址', () => {
    expect(customEndpoint('https://proxy.test/', 'models')).toBe('https://proxy.test/v1/models');
    expect(customEndpoint('https://proxy.test/v1/', 'chat/completions')).toBe('https://proxy.test/v1/chat/completions');
    expect(customEndpoint('https://proxy.test/api/v1/messages', 'models')).toBe('https://proxy.test/api/v1/models');
    expect(() => customEndpoint('file:///tmp/test', 'models')).toThrow();
    expect(() => customEndpoint('https://user:pass@proxy.test', 'models')).toThrow();
  });

  it('OpenAI 使用填写的地址和密钥获取模型，然后可通过统一 client 调用', async () => {
    updateAiSettings({ openai: { baseUrl: 'https://proxy.test/v1', model: 'model-a' } });
    setSecret('openai', key);
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${key}`);
      if (url.endsWith('/models')) return json({ data: [{ id: 'model-a' }, { id: 'model-b' }, { id: 'model-a' }, {}] });
      expect(url).toBe('https://proxy.test/v1/chat/completions');
      expect(JSON.parse(String(init?.body)).model).toBe('model-a');
      return json({ model: 'model-a', choices: [{ message: { content: '你好' }, finish_reason: 'stop' }] });
    });
    vi.stubGlobal('fetch', fetch);
    expect(await fetchCustomModels('openai', getAiSettings().openai.baseUrl, key)).toEqual(['model-a', 'model-b']);
    chooseProvider('openai');
    expect(await aiChat(req)).toMatchObject({ provider: 'openai', text: '你好' });
  });

  it('自定义 OpenAI 连接 DeepSeek 时，工具请求关闭思考；普通请求和其他服务商保持原参数', async () => {
    updateAiSettings({ openai: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash' } });
    setSecret('openai', key); chooseProvider('openai');
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return json({ choices: [{ message: { content: '你好' }, finish_reason: 'stop' }] });
    }));
    const toolReq = { ...req, tools: [{ name: 'probe', description: '测试', parameters: { type: 'object' } }], toolChoice: 'required' as const };
    await aiChat(toolReq);
    expect(bodies[0].thinking).toEqual({ type: 'disabled' });
    await aiChat(req);
    expect(bodies[1].thinking).toBeUndefined();
    updateAiSettings({ openai: { baseUrl: 'https://proxy.test/v1' } });
    await aiChat(toolReq);
    expect(bodies[2].thinking).toBeUndefined();
  });

  it('Anthropic 模型列表使用 x-api-key，并获取后续分页', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-api-key')).toBe(key);
      expect(new Headers(init?.headers).get('anthropic-version')).toBe('2023-06-01');
      return url.includes('after_id=') ? json({ data: [{ id: 'model-b' }], has_more: false }) : json({ data: [{ id: 'model-a' }], has_more: true, last_id: 'model-a' });
    });
    vi.stubGlobal('fetch', fetch);
    expect(await fetchCustomModels('anthropic', 'https://proxy.test/v1', key)).toEqual(['model-a', 'model-b']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('DeepSeek Anthropic 地址通过同源 OpenAI 接口获取模型，聊天路径保持 Anthropic', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.deepseek.com/v1/models');
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${key}`);
      expect(new Headers(init?.headers).has('x-api-key')).toBe(false);
      return json({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] });
    });
    vi.stubGlobal('fetch', fetch);
    expect(await fetchCustomModels('anthropic', 'https://api.deepseek.com/anthropic', key)).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
    expect(await fetchCustomModels('anthropic', 'https://api.deepseek.com/anthropic/v1', key)).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
    expect(customEndpoint('https://api.deepseek.com/anthropic', 'messages')).toBe('https://api.deepseek.com/anthropic/messages');
  });

  it('模型列表错误给出可读提示，服务商回显密钥会被遮掉', async () => {
    setSecret('openai', key);
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { message: `invalid ${key}` } }, 401)));
    await expect(fetchCustomModels('openai', 'https://proxy.test', key)).rejects.toMatchObject({ code: 'auth', message: expect.not.stringContaining(key) });
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [] })));
    await expect(fetchCustomModels('openai', 'https://proxy.test', key)).rejects.toMatchObject({ code: 'bad-response' });
    const ctl = new AbortController(); ctl.abort();
    await expect(fetchCustomModels('anthropic', 'https://proxy.test', key, ctl.signal)).rejects.toMatchObject({ code: 'aborted' });
  });

  it('Anthropic 转换 system、JSON 提示、工具调用与连续工具结果', () => {
    const body = anthropicBody('custom', { ...req, json: true, tools: [{ name: 'lookup', description: '查询', parameters: { type: 'object' } }], toolChoice: 'required', messages: [...req.messages,
      { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'lookup', args: '{"id":1}' }, { id: 'b', name: 'lookup', args: '{}' }] },
      { role: 'tool', toolCallId: 'a', content: '结果 A' }, { role: 'tool', toolCallId: 'b', content: '结果 B' },
    ] });
    expect(body.system).toContain('json');
    expect(body.tool_choice).toEqual({ type: 'any' });
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: '你好' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'lookup', input: { id: 1 } }, { type: 'tool_use', id: 'b', name: 'lookup', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: '结果 A' }, { type: 'tool_result', tool_use_id: 'b', content: '结果 B' }] },
    ]);
  });

  it('Anthropic 读取流式正文、工具参数和累计用量', async () => {
    updateAiSettings({ anthropic: { baseUrl: 'https://proxy.test/v1', model: 'custom' } });
    setSecret('anthropic', key);
    chooseProvider('anthropic');
    const events = [
      { type: 'message_start', message: { model: 'custom', usage: { input_tokens: 12, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '查询中' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool-a', name: 'lookup', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"id":' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '1}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } },
      { type: 'message_stop' },
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://proxy.test/v1/messages');
      expect(JSON.parse(String(init.body))).toMatchObject({ model: 'custom', system: '请用中文', stream: true });
      return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    const onDelta = vi.fn();
    expect(await aiChat(req, { onDelta })).toMatchObject({ provider: 'anthropic', text: '查询中', usage: { inputTokens: 12, outputTokens: 8 }, toolCalls: [{ id: 'tool-a', name: 'lookup', args: '{"id":1}' }] });
    expect(onDelta).toHaveBeenCalledWith('查询中', '查询中');
  });

  it('Anthropic 接受非流式兼容回复，拒绝中断的 SSE', async () => {
    updateAiSettings({ anthropic: { baseUrl: 'https://proxy.test/v1', model: 'custom' } });
    setSecret('anthropic', key); chooseProvider('anthropic');
    vi.stubGlobal('fetch', vi.fn(async () => json({ model: 'custom', content: [{ type: 'text', text: '你好' }] })));
    expect((await aiChat(req)).text).toBe('你好');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"半段"}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })));
    await expect(aiChat(req)).rejects.toMatchObject({ code: 'bad-response' });
  });
});
