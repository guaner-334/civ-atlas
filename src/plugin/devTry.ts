/**
 * 开发者模式的「试推」:在打开着的世界上(地图、种子、规则、干预照它的)带着推演插件从第 0 年推几百年,不改世界。
 * 量每个插件出手几回、一共多久、最慢一次在哪年;数插件下的命令、写的编年史;记插件 console 打的和被作者干预挡下的命令(带年份);
 * 再查分段推:推到一半存下、另装一份插件接着推,和一口气推的一样不一样(插件拿全局变量记东西就对不上)。
 * 纯计算,不碰 DOM;推演线程里 import() 用,单测里直接跑。
 */
import type { PluginTurn, SimPlugin } from '../gen/civ/engine/plugin';
import { extendCiv } from '../gen/civ/extend';
import type { SimRead } from '../gen/civ/simRead';
import { civOrStuck } from '../gen/civ/stuck';
import type { Civ, CivParams } from '../gen/civ/types';
import type { World } from '../gen/world';
import { simPluginsOn, type SimBoxer, type SimPluginsOn } from '../simPluginRun';
import type { SimPluginFile } from './pluginWorld';
import { firstDiff } from './simTrial';

/** 一个插件出手几回、一共多久、最慢一次多久、在哪年(毫秒) */
export interface DevTryPlugin {
  id: string;
  turns: number;
  ms: number;
  worst: number;
  worstYear: number;
}

/** 试推里记的一条:插件 console 打的(info / warn / error),网站记的(site:命令没办、推不下去) */
export interface DevTryLog {
  /** 那一回合的年份;装插件时打的 = null */
  year: number | null;
  level: 'info' | 'warn' | 'error' | 'site';
  plugin: string;
  text: string;
}

export interface DevTryResult {
  /** 推到第几年(推完 = 要推的年数) */
  years: number;
  /** 推不下去:停在第几年、那句错 */
  stuck: { year: number; error: string } | null;
  /** 一口气推那一遍用了多久(毫秒) */
  ms: number;
  plugins: DevTryPlugin[];
  /** 插件下的、照办了的命令:种类 → 条数 */
  commands: Record<string, number>;
  /** 插件写了几句编年史 */
  lines: number;
  logs: DevTryLog[];
  /** 分段推和一口气推:一样;不一样(从哪年起,史事都一样 = null);没查(推不下去)= null */
  resume: { same: true } | { same: false; year: number | null; what: string } | null;
}

/** 日志最多留几条 */
export const DEV_TRY_LOGS = 300;

const METHOD_LEVEL: Record<string, DevTryLog['level']> = { warn: 'warn', error: 'error' };
/** 挡下命令的作者干预(PluginTurn.refused 的 why)→ 网站的说法 */
const REFUSE_TEXT: Record<string, string> = { protect: '不许灭', unity: '禁止分裂', halt: '不许扩张', ally: '结盟', stay: '不许迁' };
const COMMAND_TEXT: Record<string, string> = { declare: '宣战', ally: '结盟', treaty: '立约', cede: '割地', found: '立国', move: '迁都', destroy: '灭国', disaster: '天灾', trek: '大迁徙' };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 两串按年份排的(史事、插件写的编年史)从哪年起不一样;一样 = null */
function firstYear(a: readonly { year: number }[] = [], b: readonly { year: number }[] = []): number | null {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (firstDiff(a[i], b[i])) return Math.floor(Math.min(a[i]?.year ?? Infinity, b[i]?.year ?? Infinity));
  return null;
}

/** 接着推的(rest)和一口气推的(full)不一样在哪:史事、编年史从哪年起不一样;都一样就说哪一项不一样;一样 = null */
export function resumeWhere(rest: Civ, full: Civ): { year: number | null; what: string } | null {
  const d = firstDiff(rest, full);
  if (!d) return null;
  const ys = [firstYear(rest.annals, full.annals), firstYear(rest.simChronicle, full.simChronicle)].filter((y): y is number => y !== null);
  return ys.length ? { year: Math.min(...ys), what: 'history' } : { year: null, what: d.split(/[.[]/)[0] };
}

export interface DevTryOptions {
  /** 推几年 */
  years: number;
  /** 推到第几年存下再接着推 */
  half: number;
  /** 装插件(浏览器里经 import() 取 QuickJS) */
  box: SimBoxer;
  /** 进度(0–1) */
  progress?: (pct: number) => void;
  now?: () => number;
}

/**
 * 在 world 上试推:params = 推这个世界用的(不带推演插件和推演年数),files = 带的推演插件(按出手的先后),seed = 文明种子。
 * 插件装不上、推不下去照实写进 stuck;文件对不上这类网站这头的错照旧抛
 */
export async function devTry(world: World, params: Partial<CivParams>, files: readonly SimPluginFile[], seed: number, o: DevTryOptions): Promise<DevTryResult> {
  const now = o.now ?? (() => performance.now());
  const logs: DevTryLog[] = [];
  let capture = true;
  const say = (l: DevTryLog) => {
    if (capture && logs.length < DEV_TRY_LOGS) logs.push(l);
  };
  const box: SimBoxer = (spec) => o.box({ ...spec, log: (method, text, year) => say({ year: year === null ? null : Math.floor(year), level: METHOD_LEVEL[method] ?? 'info', plugin: spec.id, text }) });
  const install = () => simPluginsOn(files, seed, box);

  // 一口气推:量每个插件每一回合(只量出手那一下)
  const meters = new Map<string, DevTryPlugin>(files.map((f) => [f.id, { id: f.id, turns: 0, ms: 0, worst: 0, worstYear: 0 }]));
  let first: DevTryPlugin[] | null = null;
  let firstLogs = -1;
  let failure = '';
  const on = await install();
  const lastYear = new Map<string, number>();
  const plugins = on.plugins.map(
    (p): SimPlugin<SimRead> => ({
      ...p,
      act(turn: PluginTurn<SimRead>) {
        for (const r of turn.refused ?? []) say({ year: lastYear.get(p.id) ?? Math.floor(turn.year), level: 'site', plugin: p.id, text: `${COMMAND_TEXT[r.kind] ?? r.kind}没办：你下了「${REFUSE_TEXT[r.why] ?? r.why}」` });
        lastYear.set(p.id, Math.floor(turn.year));
        const m = meters.get(p.id)!;
        const t0 = now();
        try {
          return p.act(turn);
        } finally {
          const d = now() - t0;
          m.turns++;
          m.ms += d;
          if (d > m.worst) {
            m.worst = d;
            m.worstYear = Math.floor(turn.year);
          }
        }
      },
    }),
  );
  const t0 = now();
  let full: Civ;
  try {
    full = civOrStuck(
      world,
      { ...params, endYear: o.years, plugins },
      {
        // 推不下去时会从头一年年再推一遍找停在哪年:用时、日志只算第一遍
        failed: (e) => {
          first ??= [...meters.values()].map((m) => ({ ...m }));
          if (firstLogs < 0) firstLogs = logs.length;
          failure ||= msg(e);
        },
      },
    );
  } finally {
    on.dispose();
  }
  const ms = now() - t0;
  if (firstLogs >= 0) logs.length = firstLogs;
  capture = false;
  const stats = (first ?? [...meters.values()]).map((m) => ({ ...m, ms: Math.round(m.ms * 10) / 10, worst: Math.round(m.worst * 10) / 10 }));
  const commands: Record<string, number> = {};
  for (const v of full.interventions ?? []) if (v.plugin) commands[v.kind] = (commands[v.kind] ?? 0) + 1;
  const stuck = full.stuck ? { year: Math.floor(full.stuck.at), error: failure || '出错了' } : null;
  if (stuck) logs.push({ year: stuck.year, level: 'error', plugin: full.stuck?.plugin ?? '', text: stuck.error });
  const out: DevTryResult = { years: Math.floor(full.endYear), stuck, ms: Math.round(ms), plugins: stats, commands, lines: full.simChronicle?.length ?? 0, logs, resume: null };
  o.progress?.(0.6);
  if (stuck) return out;

  // 分段推:推到一半存下(复制一份,插件的全局变量带不过去),另装一份插件接着推
  const run = async (f: (on: SimPluginsOn) => Promise<Civ | null> | Civ | null) => {
    const fresh = await install();
    try {
      return await f(fresh);
    } finally {
      fresh.dispose();
    }
  };
  const half = await run((p) => civOrStuck(world, { ...params, endYear: o.half, plugins: p.plugins }));
  o.progress?.(0.8);
  if (!half || half.stuck) {
    out.resume = { same: false, year: half?.stuck ? Math.floor(half.stuck.at) : null, what: 'stuck' };
    return out;
  }
  const kept = structuredClone(half);
  const rest = await run((p) =>
    extendCiv(world, kept, { ...params, endYear: o.years, plugins: p.plugins }, { progress: (_, pct) => o.progress?.(0.8 + 0.2 * pct), pause: () => new Promise((r) => setTimeout(r, 0)) }),
  );
  if (!rest || rest.stuck) {
    out.resume = { same: false, year: rest?.stuck ? Math.floor(rest.stuck.at) : null, what: 'stuck' };
    return out;
  }
  const d = resumeWhere(rest, full);
  out.resume = d ? { same: false, ...d } : { same: true };
  o.progress?.(1);
  return out;
}
