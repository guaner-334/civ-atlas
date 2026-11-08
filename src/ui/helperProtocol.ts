/**
 * 网站帮作品墙的后台画封面、列名字(帮手模式 ?gallery-helper=1):和后台网页之间怎么传话。纯逻辑,不碰 DOM,单测直接调。
 *
 * 后台上架一个作品时,在一个看不见的框里打开 `网站地址/?gallery-helper=1`,用浏览器的 postMessage 把作品交给网站:
 *
 *   1. 网站准备好了 → 后台:   { type: 'civ-atlas:helper-ready', v: 1, versions: [1, 2] }(听得懂哪几版;没有 versions 的网站只懂第 1 版)
 *   2. 后台 → 网站:
 *      第 1 版   { type: 'civ-atlas:render', v: 1, id, kind: 'world' | 'map' | 'preset', save?(世界、地图), preset?(新建参数) }
 *      第 2 版   { type: 'civ-atlas:render', v: 2, id, kind: 'world', file(世界文件,Blob 或 ArrayBuffer), at?(短链接 # 后面那段:at=1500&…) }
 *                { type: 'civ-atlas:render', v: 2, id, kind: 'rules', rules(规则链接 # 后面那段:rules=1&…) }
 *   3. 网站画好 → 后台(v 和请求的一样):
 *      第 1 版   { type: 'civ-atlas:rendered', v: 1, id, ok: true, cover, info, texts }
 *      第 2 版   { type: 'civ-atlas:rendered', v: 2, id, ok: true, cover, info, rules?(规则作品、用了非官方规则的世界文件才有) }
 *      画不出来: { type: 'civ-atlas:rendered', v, id, ok: false, error: '中文的原因' }
 *   第 3 版(审插件的试跑):
 *      后台 → 网站 { type: 'civ-atlas:trial', v: 3, id, file(插件文件,Blob 或 ArrayBuffer), seeds?(只认 7、2024,不给 = 两个都跑) }
 *      网站 → 后台 { type: 'civ-atlas:trial-done', v: 3, id, ok: true, runs: [{ seed, ok, ms, error?, log, did?, shots: { map?, panel? }, sim? }] }
 *                  (runs 和后台存试跑结果的接口收的一样;插件自己出错、没开成都算一份 ok = false 的 run)
 *                  推演插件(清单 role: 'sim')不带 did,带 sim(plugin/simTrial.ts 的 SimTrial):各推 3000 年和官方比的几样数、
 *                  插件写的编年史前 20 句、分段推和一口气推一不一样;map 是带插件推到最后一年的政区图盖上它的第一个图层
 *                  地图插件(清单 role: 'map')不带 did,带 map(plugin/mapTrial.ts 的 MapTrial):不带 / 带插件各长一张比的几样数、
 *                  每一口多久、长两遍和改一笔一不一样、各推 3000 年;shots.map 是带插件的地形图,
 *                  shots.views 是地形、气温、降水、群落四样图各一对(不带 / 带插件,600×300),shots.layers 是它的图层盖在带插件的地形图上(按图层编号)
 *                  { type: 'civ-atlas:trial-done', v: 3, id, ok: false, error }(网站这边没跑成,比如生成不了示例世界)
 *
 * - 只认网站所配服务器(VITE_AI_SERVER)那个来源、从上一层框发来的消息;回话也只发给那个来源。没配服务器 = 不帮(不出声)
 * - cover:封面 JPEG(data: 网址,宽高 2:1,1200×600,600 KB 以内);info:种子、停在哪年、那年现存几国几族、生成器版本(都是数)
 * - texts(只有第 1 版):那一年看得到的所有生成出来的名字(不套用作者改的名字),最多 TEXTS_MAX 条;
 *   cat 类别(12 字以内)、text 名字(100 字以内)、key 稳定键(和存档里改名的键同一套,有就带)、where 一句上下文(60 字以内,可以不带)
 * - 世界文件(第 2 版):照文件里存的内容画,不重新生成(存的内容没跟上最后的修改时,和别人打开短链接一样按配方现推);
 *   文件放进本机仓库一个临时编号,下次清理时清掉。封面停在 at 那一年,没给 at 按文件里存档带的那一刻,都没有 = 结束那年;
 *   info.generator = 画封面的历史是哪一版生成器算的;文件里的世界用了非官方规则(改了规则项或地貌的叫法)时带 rules,算法和规则作品一样,
 *   name 是那套规则自己的名字;官方规则不带
 * - 规则(第 2 版):在默认参数、种子 7 的地图上照这套规则推 3000 年,封面是那年的政区图;
 *   rules:name 规则名、changed 改了几项(规则项 + 地貌的叫法)、brief 最显眼的三处(BRIEF_MAX 字以内)
 * 一次画一个,后到的排在后面。
 */
import { RULES_NAME_MAX, UNNAMED_RULES } from '../gen/civ/ruleSet';
import type { MapTrial } from '../plugin/mapTrial';
import type { SimTrial } from '../plugin/simTrial';

export const HELPER_V = 1;
export const HELPER_V2 = 2;
export const HELPER_V3 = 3 as const;
/** 听得懂的几版(不带试跑时没有第 3 版) */
export const HELPER_VERSIONS: readonly HelperVersion[] = [HELPER_V, HELPER_V2];
export const MSG_READY = 'civ-atlas:helper-ready';
export const MSG_RENDER = 'civ-atlas:render';
export const MSG_RENDERED = 'civ-atlas:rendered';
export const MSG_TRIAL = 'civ-atlas:trial';
export const MSG_TRIAL_DONE = 'civ-atlas:trial-done';
/** 试跑的示例世界(后台存试跑结果也只收这两个) */
export const TRIAL_SEEDS: readonly number[] = [7, 2024];

/** 最多列多少个名字 */
export const TEXTS_MAX = 10000;
/** 规则作品「最显眼的三处」最多几个字 */
export const BRIEF_MAX = 120;
const CAT_MAX = 12;
const TEXT_MAX = 100;
const WHERE_MAX = 60;
const KEY_MAX = 200;
const AT_MAX = 300;
const RULES_MAX = 65536;

export type HelperVersion = 1 | 2;
export type HelperKind = 'world' | 'map' | 'preset';

/** 后台交来要画的一个作品(第 1 版) */
export interface RenderRequest {
  id: string;
  kind: HelperKind;
  /** 世界、地图:存档(和存成文件同一个格式) */
  save?: unknown;
  /** 新建参数:预设链接 # 后面那段(preset=1&…) */
  preset?: string;
}

/** 后台交来要画的一个作品(第 2 版):世界文件、规则 */
export type RenderRequestV2 = { v: 2; id: string; kind: 'world'; file: Blob; at?: string } | { v: 2; id: string; kind: 'rules'; rules: string };

export type HelperRequest = RenderRequest | RenderRequestV2;

export const versionOf = (r: HelperRequest): HelperVersion => ('v' in r ? r.v : HELPER_V);

/** 后台交来要试跑的插件(第 3 版) */
export interface TrialRequest {
  v: 3;
  id: string;
  file: Blob;
  seeds: number[];
}

/** 地图插件并排比的四样图 */
export const MAP_VIEWS = ['terrain', 'temperature', 'precipitation', 'biomes'] as const;
export type MapView = (typeof MAP_VIEWS)[number];

/** 一个种子的试跑结果(和后台存试跑结果的接口收的一样) */
export interface TrialRun {
  seed: number;
  ok: boolean;
  ms: number;
  error?: string;
  log: string[];
  /** 工具插件做了什么 */
  did?: { got: string; picked: string; drew: string; wrote: string; said: string };
  /** JPEG 的 data: 网址;没截到 = 不带 */
  shots: {
    map?: string;
    panel?: string;
    /** 地图插件:不带插件、带插件各一张 */
    views?: Partial<Record<MapView, { official?: string; plugin?: string }>>;
    /** 地图插件:图层编号 → 盖在带插件的地形图上 */
    layers?: Record<string, string>;
  };
  /** 推演插件 */
  sim?: SimTrial;
  /** 地图插件 */
  map?: MapTrial;
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

/** 规则作品、用了非官方规则的世界文件交回的摘要 */
export interface RulesBrief {
  name: string;
  changed: number;
  brief: string;
}

export interface Rendered {
  cover: string;
  info: HelperInfo;
  /** 第 1 版 */
  texts?: HelperText[];
  /** 第 2 版:规则作品、用了非官方规则的世界文件 */
  rules?: RulesBrief;
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

/** 世界文件:Blob 或 ArrayBuffer,空的不要 */
function blobOf(v: unknown): Blob | null {
  const b = v instanceof Blob ? v : v instanceof ArrayBuffer ? new Blob([v]) : null;
  return b && b.size > 0 ? b : null;
}

/** 后台发来的"画这个作品";不是这种消息、写得不对 = null */
export function readRender(data: unknown): HelperRequest | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (m.type !== MSG_RENDER) return null;
  if (typeof m.id !== 'string' || !m.id || m.id.length > 200) return null;
  const id = m.id;
  if (m.v === HELPER_V2) {
    if (m.kind === 'rules') return typeof m.rules === 'string' && m.rules && m.rules.length <= RULES_MAX ? { v: 2, id, kind: 'rules', rules: m.rules } : null;
    if (m.kind !== 'world') return null;
    const file = blobOf(m.file);
    if (!file) return null;
    return { v: 2, id, kind: 'world', file, ...(typeof m.at === 'string' && m.at && m.at.length <= AT_MAX ? { at: m.at } : {}) };
  }
  if (m.v !== HELPER_V) return null;
  if (!KINDS.includes(m.kind as HelperKind)) return null;
  const kind = m.kind as HelperKind;
  if (kind === 'preset') return typeof m.preset === 'string' ? { id, kind, preset: m.preset } : null;
  return m.save && typeof m.save === 'object' ? { id, kind, save: m.save } : null;
}

/** 后台发来的"试跑这个插件";不是这种消息、写得不对 = null */
export function readTrial(data: unknown): TrialRequest | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (m.type !== MSG_TRIAL || m.v !== HELPER_V3) return null;
  if (typeof m.id !== 'string' || !m.id || m.id.length > 200) return null;
  const file = blobOf(m.file);
  if (!file) return null;
  if (m.seeds === undefined) return { v: 3, id: m.id, file, seeds: [...TRIAL_SEEDS] };
  if (!Array.isArray(m.seeds)) return null;
  const seeds = TRIAL_SEEDS.filter((s) => (m.seeds as unknown[]).includes(s));
  return seeds.length ? { v: 3, id: m.id, file, seeds } : null;
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

/** 规则作品的摘要整理成约好的样子 */
export function tidyRules(r: RulesBrief): RulesBrief {
  return { name: line(r.name, RULES_NAME_MAX) || UNNAMED_RULES, changed: Number.isInteger(r.changed) && r.changed > 0 ? r.changed : 0, brief: line(r.brief, BRIEF_MAX) };
}

export function readyMsg(trial = false) {
  return { type: MSG_READY, v: HELPER_V, versions: trial ? [...HELPER_VERSIONS, HELPER_V3] : [...HELPER_VERSIONS] };
}

export function trialDoneMsg(id: string, runs: TrialRun[]) {
  return { type: MSG_TRIAL_DONE, v: HELPER_V3, id, ok: true as const, runs };
}

export function trialFailedMsg(id: string, error: string) {
  return { type: MSG_TRIAL_DONE, v: HELPER_V3, id, ok: false as const, error: line(error, 200) || '没跑成' };
}

export function renderedMsg(id: string, r: Rendered) {
  return { type: MSG_RENDERED, v: HELPER_V, id, ok: true as const, cover: r.cover, info: r.info, texts: tidyTexts(r.texts ?? []) };
}

export function renderedMsgV2(id: string, r: Rendered) {
  return { type: MSG_RENDERED, v: HELPER_V2, id, ok: true as const, cover: r.cover, info: r.info, ...(r.rules ? { rules: tidyRules(r.rules) } : {}) };
}

export function failedMsg(id: string, error: string, v: HelperVersion = HELPER_V) {
  return { type: MSG_RENDERED, v, id, ok: false as const, error: line(error, 200) || '没画出来' };
}

/** 帮手要用到的那几样窗口的东西(单测里换成假的) */
export interface HelperHost {
  /** 上一层框(后台网页) */
  parent: { postMessage(msg: unknown, targetOrigin: string): void } | null;
  addEventListener(type: 'message', f: (e: { origin: string; source: unknown; data: unknown }) => void): void;
  removeEventListener(type: 'message', f: (e: { origin: string; source: unknown; data: unknown }) => void): void;
}

/**
 * 开始听后台的消息:只认 origin 这个来源、上一层框发来的;收到一个作品交给 render 画,画好(或出错)按请求的那一版回给后台;
 * 给了 trial 的还听第 3 版的试跑。一次做一件,先给后台说一声准备好了。返回停止听的函数
 */
export function listenHelper(
  host: HelperHost,
  origin: string,
  render: (req: HelperRequest) => Promise<Rendered>,
  trial?: (req: TrialRequest) => Promise<TrialRun[]>,
): () => void {
  const parent = host.parent;
  let queue: Promise<void> = Promise.resolve();
  const onMsg = (e: { origin: string; source: unknown; data: unknown }) => {
    if (e.origin !== origin || !parent || e.source !== parent) return;
    const t = trial ? readTrial(e.data) : null;
    if (t && trial) {
      queue = queue.then(async () => {
        let msg: ReturnType<typeof trialDoneMsg> | ReturnType<typeof trialFailedMsg>;
        try {
          msg = trialDoneMsg(t.id, await trial(t));
        } catch (err) {
          msg = trialFailedMsg(t.id, err instanceof Error ? err.message : String(err));
        }
        parent.postMessage(msg, origin);
      });
      return;
    }
    const req = readRender(e.data);
    if (!req) return;
    const v = versionOf(req);
    queue = queue.then(async () => {
      let msg: ReturnType<typeof renderedMsg> | ReturnType<typeof renderedMsgV2> | ReturnType<typeof failedMsg>;
      try {
        const r = await render(req);
        msg = v === HELPER_V ? renderedMsg(req.id, r) : renderedMsgV2(req.id, r);
      } catch (err) {
        msg = failedMsg(req.id, err instanceof Error ? err.message : String(err), v);
      }
      parent.postMessage(msg, origin);
    });
  };
  host.addEventListener('message', onMsg);
  parent?.postMessage(readyMsg(!!trial), origin);
  return () => host.removeEventListener('message', onMsg);
}
