/**
 * 网站帮作品墙的后台画封面、列名字(帮手模式 ?gallery-helper=1):和后台网页之间怎么传话。纯逻辑,不碰 DOM,单测直接调。
 *
 * 后台上架一个作品时,在一个看不见的框里打开 `网站地址/?gallery-helper=1`,用浏览器的 postMessage 把作品交给网站:
 *
 *   1. 网站准备好了 → 后台:   { type: 'civ-atlas:helper-ready', v: 1 }
 *   2. 后台 → 网站:           { type: 'civ-atlas:render', v: 1, id, kind: 'world' | 'map' | 'preset', save?(世界、地图), preset?(新建参数) }
 *   3. 网站画好 → 后台:       { type: 'civ-atlas:rendered', v: 1, id, ok: true, cover, info, texts }
 *      画不出来:              { type: 'civ-atlas:rendered', v: 1, id, ok: false, error: '中文的原因' }
 *
 * - 只认网站所配服务器(VITE_AI_SERVER)那个来源、从上一层框发来的消息;回话也只发给那个来源。没配服务器 = 不帮(不出声)
 * - cover:封面 JPEG(data: 网址,宽高 2:1,1200×600,600 KB 以内);info:种子、停在哪年、那年现存几国几族、生成器版本(都是数)
 * - texts:那一年看得到的所有生成出来的名字(不套用作者改的名字),最多 TEXTS_MAX 条;
 *   cat 类别(12 字以内)、text 名字(100 字以内)、key 稳定键(和存档里改名的键同一套,有就带)、where 一句上下文(60 字以内,可以不带)
 * 一次画一个,后到的排在后面。
 */

export const HELPER_V = 1;
export const MSG_READY = 'civ-atlas:helper-ready';
export const MSG_RENDER = 'civ-atlas:render';
export const MSG_RENDERED = 'civ-atlas:rendered';

/** 最多列多少个名字 */
export const TEXTS_MAX = 10000;
const CAT_MAX = 12;
const TEXT_MAX = 100;
const WHERE_MAX = 60;
const KEY_MAX = 200;

export type HelperKind = 'world' | 'map' | 'preset';

/** 后台交来要画的一个作品 */
export interface RenderRequest {
  id: string;
  kind: HelperKind;
  /** 世界、地图:存档(和存成文件同一个格式) */
  save?: unknown;
  /** 新建参数:预设链接 # 后面那段(preset=1&…) */
  preset?: string;
}

export interface HelperInfo {
  seed: number;
  year: number;
  states: number;
  peoples: number;
  generator: number;
}

export interface HelperText {
  cat: string;
  text: string;
  key?: string;
  where?: string;
}

export interface Rendered {
  cover: string;
  info: HelperInfo;
  texts: HelperText[];
}

/** 网站所配服务器的来源(https://ai.example.com);没配、写得不对 = null。here = 网站本身的地址(服务器地址写成相对路径时按它算) */
export function helperOrigin(base: string | null, here: string): string | null {
  if (!base) return null;
  try {
    const o = new URL(base, here).origin;
    return o && o !== 'null' ? o : null;
  } catch {
    return null;
  }
}

const KINDS: readonly HelperKind[] = ['world', 'map', 'preset'];

/** 后台发来的"画这个作品";不是这种消息、写得不对 = null */
export function readRender(data: unknown): RenderRequest | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (m.type !== MSG_RENDER || m.v !== HELPER_V) return null;
  if (typeof m.id !== 'string' || !m.id || m.id.length > 200) return null;
  if (!KINDS.includes(m.kind as HelperKind)) return null;
  const kind = m.kind as HelperKind;
  if (kind === 'preset') return typeof m.preset === 'string' ? { id: m.id, kind, preset: m.preset } : null;
  return m.save && typeof m.save === 'object' ? { id: m.id, kind, save: m.save } : null;
}

/** 去掉控制字符、首尾空白,超长截断(按码位,不切开一个字) */
function line(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const cs = [...s];
  return cs.length > max ? cs.slice(0, max).join('').trim() : s;
}

/** 列出来的名字整理成约好的样子:空名字去掉,各项按上限截,最多 TEXTS_MAX 条(前面的先留) */
export function tidyTexts(list: readonly HelperText[]): HelperText[] {
  const out: HelperText[] = [];
  for (const t of list) {
    if (out.length >= TEXTS_MAX) break;
    const text = line(t.text, TEXT_MAX);
    if (!text) continue;
    const x: HelperText = { cat: line(t.cat, CAT_MAX) || '名字', text };
    if (typeof t.key === 'string' && t.key && t.key.length <= KEY_MAX) x.key = t.key;
    const where = line(t.where, WHERE_MAX);
    if (where) x.where = where;
    out.push(x);
  }
  return out;
}

export function readyMsg() {
  return { type: MSG_READY, v: HELPER_V } as const;
}

export function renderedMsg(id: string, r: Rendered) {
  return { type: MSG_RENDERED, v: HELPER_V, id, ok: true as const, cover: r.cover, info: r.info, texts: tidyTexts(r.texts) };
}

export function failedMsg(id: string, error: string) {
  return { type: MSG_RENDERED, v: HELPER_V, id, ok: false as const, error: line(error, 200) || '没画出来' };
}

/** 帮手要用到的那几样窗口的东西(单测里换成假的) */
export interface HelperHost {
  /** 上一层框(后台网页) */
  parent: { postMessage(msg: unknown, targetOrigin: string): void } | null;
  addEventListener(type: 'message', f: (e: { origin: string; source: unknown; data: unknown }) => void): void;
  removeEventListener(type: 'message', f: (e: { origin: string; source: unknown; data: unknown }) => void): void;
}

/**
 * 开始听后台的消息:只认 origin 这个来源、上一层框发来的;收到一个作品交给 render 画,画好(或出错)回给后台。
 * 先给后台说一声准备好了。返回停止听的函数
 */
export function listenHelper(host: HelperHost, origin: string, render: (req: RenderRequest) => Promise<Rendered>): () => void {
  const parent = host.parent;
  let queue: Promise<void> = Promise.resolve();
  const onMsg = (e: { origin: string; source: unknown; data: unknown }) => {
    if (e.origin !== origin || !parent || e.source !== parent) return;
    const req = readRender(e.data);
    if (!req) return;
    queue = queue.then(async () => {
      let msg: ReturnType<typeof renderedMsg> | ReturnType<typeof failedMsg>;
      try {
        msg = renderedMsg(req.id, await render(req));
      } catch (err) {
        msg = failedMsg(req.id, err instanceof Error ? err.message : String(err));
      }
      parent.postMessage(msg, origin);
    });
  };
  host.addEventListener('message', onMsg);
  parent?.postMessage(readyMsg(), origin);
  return () => host.removeEventListener('message', onMsg);
}
