import type { AiProvider } from '../client';
import { AiError } from '../types';
import { getAiSettings, getSecrets } from '../settings';
import { compatChat } from './compat';

/** Accept an OpenAI-compatible base URL or the complete chat endpoint. */
export function customEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new AiError('not-configured', '请填写完整的 HTTP 或 HTTPS 接口地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new AiError('not-configured', '接口地址只能使用 HTTP 或 HTTPS，不应包含账号、密钥、查询参数或锚点');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions';
  return url.href;
}

export const customProvider: AiProvider = {
  kind: 'custom',
  get label() { return getAiSettings().custom.name; },
  status() {
    const s = getAiSettings().custom;
    try { customEndpoint(s.baseUrl); }
    catch (e) { return { ready: false, model: s.model, reason: (e as Error).message }; }
    if (!s.model) return { ready: false, model: '', reason: '请填写模型名称' };
    if (!getSecrets().custom) return { ready: false, model: s.model, reason: '请填写自定义服务的 API 密钥' };
    return { ready: true, model: s.model };
  },
  async chat(req, opts) {
    const s = getAiSettings().custom, key = getSecrets().custom;
    const url = customEndpoint(s.baseUrl);
    if (!s.model || !key) throw new AiError('not-configured', '请先填写自定义服务的模型名称和 API 密钥');
    try { return await compatChat({ name: s.name, url, key, model: s.model }, req, opts); }
    catch (e) {
      if (e instanceof AiError && e.code === 'network') throw new AiError(e.code, e.message + '；请确认接口允许浏览器跨域访问，HTTPS 页面应使用 HTTPS 接口');
      throw e;
    }
  },
};
