/** 用户指定的 OpenAI / Anthropic 兼容接口，浏览器直接调用。 */
import type { AiProvider } from '../client';
import { getAiSettings, getSecrets, scrubSecrets, type CustomProviderKind } from '../settings';
import { AiError } from '../types';
import { idleTimer } from '../sse';
import { compatChat, mapHttpError } from './compat';
import { anthropicChat } from './anthropic';

export const CUSTOM_NAMES = { openai: '自定义 OpenAI 兼容 API', anthropic: '自定义 Anthropic 兼容 API' };

/** 根地址自动加 /v1，已含版本或代理路径的地址保留原路径。 */
export function customEndpoint(baseUrl: string, endpoint: string): string {
  let url: URL;
  try { url = new URL(baseUrl.trim()); } catch { throw new AiError('not-configured', 'baseUrl 格式不正确，请填写完整的 http:// 或 https:// 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new AiError('not-configured', 'baseUrl 请使用 HTTP(S) 地址，不要包含账号、密码、查询参数或片段');
  }
  let path = url.pathname.replace(/\/+$/, '').replace(/\/(chat\/completions|messages|models)$/, '');
  if (!path) path = '/v1';
  url.pathname = `${path}/${endpoint}`;
  return url.toString();
}

export function customHeaders(kind: CustomProviderKind, key: string): Record<string, string> {
  return kind === 'openai'
    ? { Authorization: `Bearer ${key}` }
    : { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
}

export async function checkCustomResponse(res: Response, kind: CustomProviderKind, model = ''): Promise<void> {
  if (res.ok) return;
  let message = '', code = '';
  try {
    const body = await res.json();
    message = String(body.error?.message ?? body.message ?? '');
    code = String(body.error?.type ?? body.error?.code ?? '');
  } catch { /* HTTP 状态码仍可用 */ }
  throw mapHttpError(CUSTOM_NAMES[kind], { status: res.status, code, message: scrubSecrets(message).slice(0, 200) }, model);
}

/** Anthropic 模型列表按 after_id 分页；OpenAI 通常一次返回全部。 */
export async function fetchCustomModels(kind: CustomProviderKind, baseUrl: string, key: string, signal?: AbortSignal): Promise<string[]> {
  if (!key) throw new AiError('not-configured', '请先填写 API 密钥');
  if (signal?.aborted) throw new AiError('aborted', '已取消');
  let endpoint = customEndpoint(baseUrl, 'models');
  let modelProtocol = kind;
  // DeepSeek 的 Anthropic 兼容地址只提供 Messages；模型列表共用 OpenAI 路径。
  const modelUrl = new URL(endpoint);
  if (kind === 'anthropic' && modelUrl.hostname === 'api.deepseek.com' && /^\/anthropic(?:\/v1)?\/models$/.test(modelUrl.pathname)) {
    modelUrl.pathname = '/v1/models';
    endpoint = modelUrl.toString();
    modelProtocol = 'openai';
  }
  const idle = idleTimer(signal, 30_000);
  const models = new Set<string>();
  const cursors = new Set<string>();
  let cursor = '';
  try {
    for (;;) {
      const url = new URL(endpoint);
      if (cursor) url.searchParams.set('after_id', cursor);
      const res = await fetch(url.toString(), {
        headers: { Accept: 'application/json', ...customHeaders(modelProtocol, key) },
        signal: idle.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
      });
      await checkCustomResponse(res, kind);
      const body = await res.json();
      if (!Array.isArray(body?.data)) throw new AiError('bad-response', '接口返回的模型列表格式不正确，可以手填模型名');
      for (const m of body.data) if (typeof m?.id === 'string' && m.id.trim()) models.add(m.id.trim());
      if (modelProtocol !== 'anthropic' || !body.has_more) break;
      cursor = body.last_id;
      if (typeof cursor !== 'string' || !cursor || cursors.has(cursor)) throw new AiError('bad-response', '接口返回的模型分页信息不正确');
      cursors.add(cursor);
    }
    if (!models.size) throw new AiError('bad-response', '接口没有返回可用模型，可以手填模型名');
    return [...models];
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (signal?.aborted) throw new AiError('aborted', '已取消');
    if (idle.timedOut()) throw new AiError('network', '获取模型超时，请稍后再试');
    throw new AiError('network', '获取模型失败，请检查 baseUrl、网络及接口的浏览器跨域支持；也可以手填模型名');
  } finally { idle.dispose(); }
}

function provider(kind: CustomProviderKind): AiProvider {
  return {
    kind, label: CUSTOM_NAMES[kind],
    status() {
      const s = getAiSettings()[kind];
      let reason = '';
      if (!s.baseUrl) reason = '请先填写 baseUrl';
      else { try { customEndpoint(s.baseUrl, 'models'); } catch (e) { reason = (e as Error).message; } }
      if (!reason && !getSecrets()[kind]) reason = '请先填写 API 密钥';
      if (!reason && !s.model) reason = '请先填写或获取模型';
      return { ready: !reason, model: s.model, reason: reason || undefined };
    },
    async chat(req, opts) {
      const st = this.status();
      if (!st.ready) throw new AiError('not-configured', st.reason!);
      const s = getAiSettings()[kind];
      const key = getSecrets()[kind]!;
      if (kind === 'anthropic') return anthropicChat({ url: customEndpoint(s.baseUrl, 'messages'), key, model: s.model }, req, opts);
      const url = customEndpoint(s.baseUrl, 'chat/completions');
      // DeepSeek 默认思考模式不支持强制工具调用，也要求保留 reasoning_content。
      // 与内置 DeepSeek 模块一致，助手工具请求关闭思考，确保后续工具结果可正常交回。
      const extra = new URL(url).hostname === 'api.deepseek.com' && req.tools?.length ? { thinking: { type: 'disabled' } } : undefined;
      return compatChat({ name: CUSTOM_NAMES[kind], url, key, model: s.model, extra }, req, opts);
    },
  };
}

export const openaiProvider = provider('openai');
export const anthropicProvider = provider('anthropic');
