/**
 * 插件隔离自检:把各项检查交回来的原始结果判成九行,再加「推演插件」「地图插件」两组(只量,不算进全部通过)。
 * 纯逻辑,单测直接调;真去试的在 ./probes.ts、./simProbe.ts。
 * 判法和 scripts/sandbox-check.ts 一样,只是没有收信站:连没连出去以插件在小屋里自己看到的为准。
 */

export type Step<T> = T | { error: string };

// 推演插件那一组(真去量的在 ./simProbe.ts,后台线程里跑)

export const SIM_PROBE_SEED = 7;
/** 推几年:宗教生效每 5 年出手一次,取 200 回合左右 */
export const SIM_PROBE_YEARS = 1000;
/** 电脑上推出来的散列。改了推演或示例插件,单测会报,照它打出来的换掉 */
export const SIM_PROBE_SUM = '93821bb70b78defc';
/** 推 3000 年要在这么多秒以内(电脑上每秒至少推 80 年):超过算慢 */
export const SIM_SLOW_SEC = 37.5;

export interface SimProbeRaw {
  /** 宗教生效一回合的中间值(毫秒)、取了几回合 */
  faithMs: number;
  faithTurns: number;
  /** 厌战一回合的中间值(毫秒) */
  wearMs: number;
  /** 不算插件推一年(毫秒) */
  yearMs: number;
  /** 照这个,带两个示例插件推 3000 年约几秒 */
  estSec: number;
  /** 生成地图、推历史各用了多久(毫秒) */
  genMs: number;
  civMs: number;
  sum: string;
  same: boolean;
}

// 地图插件那一组(真去量的在 ./mapProbe.ts,后台线程里跑)

export const MAP_PROBE_SEED = 7;
/** 电脑上长出来的散列。改了生成或示例插件,单测会报,照它打出来的换掉 */
export const MAP_PROBE_SUM = '75825ebcc6c178e0';
/** 电脑上示例插件长一张图多花几秒(写给人看的对照) */
export const MAP_PROBE_PC_SEC = 0.1;
/** 多花超过这么久(毫秒)算慢 */
export const MAP_SLOW_MS = 1000;

export interface MapProbeRaw {
  /** 插件那几口一共用了多久(毫秒) */
  ms: number;
  /** 连插件长一整张用了多久(毫秒) */
  genMs: number;
  /** 要长几块地(参数里的) */
  cells: number;
  sum: string;
  same: boolean;
}

export interface StackRaw {
  /** 套到第几层停下 */
  depth: number;
  /** 谁先停的:QuickJS 自己(够)、后台线程的栈(不够);一直没停 = none */
  by: 'quickjs' | 'thread' | 'none';
  /** 停下时的那句话 */
  note: string;
}

export interface Outcome {
  name: string;
  outcome: string;
}

export interface BatteryRaw {
  readyMs: number;
  stoppedBefore: string | null;
  results: Outcome[] | null;
  heard: string[];
  framesLeft: number;
}

export interface IsolationRaw {
  aHeard: string[];
  hostHeard: string[];
}

export interface EchoRaw {
  s: number;
  n: number;
  backIsArray: boolean;
  detached: boolean;
  ms: number;
  errorReply: string;
  uncloneable: string;
  early: boolean;
  stopped: string | null;
  afterStop: string;
  framesLeft: number;
}

export interface StopRaw {
  reason: string;
  detail: string;
  ms: number;
  framesLeft: number;
}

export interface SpinRaw {
  reason: string;
  stopped: string | null;
  maxGapMs: number;
  framesLeft: number;
}

export interface NavRaw {
  /** 框里的代码跑到了的几种跳法 */
  ran: string[];
  /** 网站页面报告「被 frame-src 拦下」的几种 */
  blocked: string[];
  /** 框里 window.open 的返回值,或 threw:错误名 */
  open: string;
  /** 框里改 top.location 抛的错;没抛是空串 */
  top: string;
  loads: Record<string, number>;
}

export interface Raw {
  battery?: Step<BatteryRaw>;
  isolation?: Step<IsolationRaw>;
  echo?: Step<EchoRaw>;
  stops?: Step<Record<string, StopRaw>>;
  spin?: Step<SpinRaw>;
  nav?: Step<NavRaw>;
  /** 推演插件那一组 */
  sim?: Step<SimProbeRaw>;
  stack?: Step<StackRaw>;
  /** 地图插件那一组 */
  map?: Step<MapProbeRaw>;
  /** 上一次查的时候整页被框带走了(网址上带着记号回来) */
  escapedTop: boolean;
}

/** slow = 推演插件那一组里量出来慢(右边变黄) */
export type RowState = 'run' | 'ok' | 'bad' | 'err' | 'slow';

export interface Row {
  label: string;
  state: RowState;
  /** 右边那几个字 */
  result: string;
  /** 没过时下面那句大白话 */
  why: string;
  /** 复制结果里带的原始数 */
  detail: string;
}

/** 联网的 14 种办法,名字是 battery.js 里记的 */
export const NET_WAYS = [
  'fetch',
  'fetch no-cors',
  'fetch keepalive',
  'fetch site',
  'xhr',
  'websocket',
  'eventsource',
  'importScripts',
  'dynamic import',
  'new Worker(url)',
  'blob worker fetch',
  'FontFace',
  'sendBeacon',
  'WebTransport',
];
const STORE_WAYS = ['indexedDB', 'caches', 'opfs', 'localStorage'];
const CODE_WAYS = ['eval', 'new Function', 'setTimeout(string)', 'WebAssembly'];
/** 这个浏览器根本没有这个办法,或者它自己说不发 */
const NOT_THERE = new Set(['ok:no sendBeacon', 'ok:no WebTransport', 'ok:false']);

export const STOP_CASES: Record<string, string> = {
  syntax: 'crashed',
  throwLater: 'crashed',
  garbage: 'protocol',
  forgedBoot: 'protocol',
  wrongVersion: 'protocol',
  strayReply: 'protocol',
  topLevelLoop: 'start-timeout',
  pingLoop: 'unresponsive',
};

/** 上一次查的时候框把整页带走,回来的网址上带着它 */
export const ESCAPED_PARAM = 'sandbox-escaped';

/** 框自己跳走的五种:前三种靠网站页面的 frame-src 拦,后两种靠框的 sandbox 属性 */
export const NAV_WAYS = ['self', 'refresh', 'link', 'top', 'open'];
export const NAV_FRAME_WAYS = ['self', 'refresh', 'link'];

const MAX_GAP_MS = 250;
const AFTER = '开发修好以前，这个浏览器里先别装没审核的插件。';
const NOT_DONE = '这一项在这个浏览器里没查完。请把结果发给开发。';

const failed = <T>(s: Step<T> | undefined): s is { error: string } => !!s && typeof s === 'object' && 'error' in s;

function run(label: string): Row {
  return { label, state: 'run', result: '', why: '', detail: '' };
}
function done(label: string, ok: boolean, okText: string, badText: string, why: string, detail: string): Row {
  return ok ? { label, state: 'ok', result: okText, why: '', detail } : { label, state: 'bad', result: badText, why, detail };
}
function notDone(label: string, detail: string): Row {
  return { label, state: 'err', result: '没查成', why: NOT_DONE, detail };
}

const pick = (rs: Outcome[], names: string[]) => names.map((n) => `${n}=${rs.find((r) => r.name === n)?.outcome ?? '(没记)'}`).join('; ');

/** 坏事清单没跑完就判不了的几行 */
function fromBattery(label: string, raw: Raw, judge: (rs: Outcome[], b: BatteryRaw) => Row): Row {
  const b = raw.battery;
  if (!b) return run(label);
  if (failed(b)) return notDone(label, b.error);
  if (!b.results) return notDone(label, `没交回结果;插件${b.stoppedBefore ? `被停掉了(${b.stoppedBefore})` : '没停'}`);
  if (b.stoppedBefore) return notDone(label, `跑到一半插件被停掉了(${b.stoppedBefore})`);
  return judge(b.results, b);
}

export function verdict(raw: Raw): Row[] {
  const rows: Row[] = [];

  rows.push(
    fromBattery('联网（14 种办法）', raw, (rs) => {
      const out = (n: string) => rs.find((r) => r.name === n)?.outcome ?? '';
      const leaked = NET_WAYS.filter((n) => {
        const o = out(n);
        return !o || (o.startsWith('ok:') && !NOT_THERE.has(o));
      });
      if (out('typeof Worker') !== 'undefined') leaked.push('typeof Worker');
      return done('联网（14 种办法）', leaked.length === 0, '都挡住了', `${leaked.length} 种没挡住`, `插件可能借这几种办法把东西发出去。${AFTER}`, pick(rs, [...NET_WAYS, 'typeof Worker']));
    }),
  );

  rows.push(
    fromBattery('网站存的世界、密钥', raw, (rs) => {
      const out = (n: string) => rs.find((r) => r.name === n)?.outcome ?? '';
      const ok =
        out('where') === 'worker' &&
        out('origin') === 'null' &&
        out('typeof document') === 'undefined' &&
        out('indexedDB').startsWith('err') &&
        !out('localStorage').startsWith('ok') &&
        !out('opfs').startsWith('ok') &&
        (!out('caches').startsWith('ok') || out('caches') === 'ok:keys 0');
      return done('网站存的世界、密钥', ok, '碰不到', '碰得到', `插件可能读到你存的世界和 AI 密钥。${AFTER}`, pick(rs, ['where', 'origin', 'typeof document', ...STORE_WAYS]));
    }),
  );

  rows.push(
    fromBattery('从一串字变出代码', raw, (rs) => {
      const out = (n: string) => rs.find((r) => r.name === n)?.outcome ?? '';
      const ok = out('eval').startsWith('err') && out('new Function').startsWith('err') && out('setTimeout(string)') === 'ok:no';
      return done('从一串字变出代码', ok, '拦住了', '没拦住', `这个浏览器没按小屋的规矩管住插件，别的几项也可能漏。${AFTER}`, pick(rs, CODE_WAYS));
    }),
  );

  {
    const label = '跟网站页面、别的插件传话';
    const iso = raw.isolation;
    if (!raw.battery || !iso) rows.push(run(label));
    else if (failed(iso)) rows.push(notDone(label, iso.error));
    else {
      rows.push(
        fromBattery(label, raw, (_rs, b) => {
          const ok = b.heard.length === 0 && iso.hostHeard.length === 0 && !iso.aHeard.some((h) => h.includes('from-b'));
          return done(label, ok, '都不通', '能传话', `插件可能跟网站页面或别的插件串通。${AFTER}`, `网站听到 ${JSON.stringify(b.heard)} / ${JSON.stringify(iso.hostHeard)};插件 A 听到 ${JSON.stringify(iso.aHeard)}`);
        }),
      );
    }
  }

  rows.push(
    fromBattery('视频通话的通道', raw, (rs) => {
      const t = rs.find((r) => r.name === 'typeof RTCPeerConnection')?.outcome ?? '';
      return done('视频通话的通道', t === 'undefined', '小屋里没有', '小屋里能用', `插件可能借这个通道往外发数据。${AFTER}`, `typeof RTCPeerConnection=${t || '(没记)'}`);
    }),
  );

  {
    const label = '小屋自己跳走、弹新窗口';
    const nav = raw.nav;
    const why = `插件可能跳到别的网站，把东西带出去。${AFTER}`;
    const topNote = raw.escapedTop ? ';上一次查的时候框把整页带走了' : '';
    if (!nav) rows.push(run(label));
    else if (failed(nav)) rows.push(raw.escapedTop ? done(label, false, '', '1 种没拦住', why, nav.error + topNote) : notDone(label, nav.error));
    else {
      const detail = `跑到 ${nav.ran.join(',')};拦下 ${nav.blocked.join(',') || '无'};open=${nav.open};top=${nav.top || '没抛错'};load ${JSON.stringify(nav.loads)}${topNote}`;
      const escaped = NAV_FRAME_WAYS.filter((w) => nav.ran.includes(w) && !nav.blocked.includes(w));
      if (nav.ran.includes('open') && !(nav.open === 'null' || nav.open.startsWith('threw:'))) escaped.push('open');
      if (raw.escapedTop) escaped.push('top');
      // 框里的代码没跑到,就说不上拦没拦住;但已经看到跳走的照样算没过
      if (escaped.length === 0 && !NAV_WAYS.every((w) => nav.ran.includes(w))) rows.push(notDone(label, detail));
      else rows.push(done(label, escaped.length === 0, '都没成', `${escaped.length} 种没拦住`, why, detail));
    }
  }

  {
    const label = '出错、乱发话、死循环（8 种）';
    const st = raw.stops;
    if (!st) rows.push(run(label));
    else if (failed(st)) rows.push(notDone(label, st.error));
    else {
      const wrong = Object.entries(STOP_CASES).filter(([k, want]) => st[k]?.reason !== want || st[k].framesLeft !== 0);
      const detail = Object.keys(STOP_CASES)
        .map((k) => `${k}=${st[k] ? `${st[k].reason}${st[k].detail ? `(${st[k].detail})` : ''} ${st[k].ms}ms${st[k].framesLeft ? ` 剩框${st[k].framesLeft}` : ''}` : '(没记)'}`)
        .join('; ');
      rows.push(done(label, wrong.length === 0, '都停下了', `${wrong.length} 种没停对`, `出了问题的插件可能停不下来，一直占着手机。${AFTER}`, detail));
    }
  }

  {
    const label = '插件死循环时界面卡不卡';
    const sp = raw.spin;
    if (!sp) rows.push(run(label));
    else if (failed(sp)) rows.push(notDone(label, sp.error));
    else {
      const stopped = sp.reason === 'unresponsive' && sp.stopped === 'unresponsive' && sp.framesLeft === 0;
      const gap = `最长隔 ${sp.maxGapMs} 毫秒`;
      rows.push(done(label, stopped && sp.maxGapMs < MAX_GAP_MS, gap, stopped ? gap : '没停下', `插件死循环时网站会跟着卡住。${AFTER}`, `${sp.reason} / ${sp.stopped};最长隔 ${sp.maxGapMs} ms`));
    }
  }

  {
    const label = '递进去 3.6 万地块';
    const e = raw.echo;
    if (!e) rows.push(run(label));
    else if (failed(e)) rows.push(notDone(label, e.error));
    else {
      const ok =
        e.early &&
        e.s === 36_000 &&
        e.n === 36_000 &&
        e.backIsArray &&
        e.detached &&
        e.errorReply.length > 0 &&
        e.uncloneable === 'DataCloneError, still running' &&
        e.stopped === 'stopped' &&
        e.afterStop === 'stopped' &&
        e.framesLeft === 0;
      rows.push(done(label, ok, `${Math.max(1, Math.ceil(e.ms))} 毫秒`, '没递对', '插件收不全地图数据，这个浏览器里插件可能算不对。请把结果发给开发。', JSON.stringify(e)));
    }
  }

  return rows;
}

export function allDone(rows: Row[]): boolean {
  return rows.every((r) => r.state !== 'run');
}

export interface Summary {
  state: 'run' | 'ok' | 'bad';
  title: string;
  note: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 26 秒、3 分钟 */
const dur = (sec: number) => (sec < 60 ? `${Math.max(1, Math.round(sec))} 秒` : `${Math.round(sec / 60)} 分钟`);

/** 「推演插件」那一组:一回合多久、推出来的和电脑上一不一样、插件调用能套多深。只量,不算进上面的全部通过 */
export function simRows(raw: Raw): Row[] {
  const run = (label: string): Row => ({ label, state: 'run', result: '', why: '', detail: '' });
  const err = (label: string, e: string): Row => ({ label, state: 'err', result: '没量成', why: '这一项没量成，把结果复制给开发', detail: e });
  const out: Row[] = [];
  const s = raw.sim;
  const TURN = '算一回合要多久';
  const SAME = '推出来的和电脑上一样';
  if (!s) out.push(run(TURN), run(SAME));
  else if (failed(s)) out.push(err(TURN, s.error), err(SAME, s.error));
  else {
    const slow = s.estSec > SIM_SLOW_SEC;
    out.push({
      label: TURN,
      state: slow ? 'slow' : 'ok',
      result: `${Number(s.faithMs.toPrecision(2))} 毫秒`,
      why: `示例插件「宗教生效」跑 ${s.faithTurns} 回合取中间；照这个，带两个示例插件推 3000 年约 ${dur(s.estSec)}${slow ? '，用了推演插件的世界会推得很慢' : ''}`,
      detail: `宗教生效一回合 ${s.faithMs} ms（${s.faithTurns} 回合的中间值），厌战 ${s.wearMs} ms，不算插件推一年 ${s.yearMs} ms，估 3000 年 ${s.estSec} 秒；地图 ${s.genMs} ms，推 ${SIM_PROBE_YEARS} 年 ${s.civMs} ms`,
    });
    out.push({
      label: SAME,
      state: s.same ? 'ok' : 'bad',
      result: s.same ? '一样' : '不一样',
      why: s.same ? '' : '同一个世界在这台上推出来的历史和电脑上的不一样，用了推演插件的世界在这台上接着推会推出另一段',
      detail: `散列 ${s.sum}，电脑上 ${SIM_PROBE_SUM}`,
    });
  }
  const k = raw.stack;
  const DEEP = '插件调用能套多深';
  if (!k) out.push(run(DEEP));
  else if (failed(k)) out.push(err(DEEP, k.error));
  else if (k.by === 'quickjs') out.push({ label: DEEP, state: 'ok', result: `${k.depth} 层`, why: '', detail: `套到 ${k.depth} 层 QuickJS 先停下：${k.note}` });
  else
    out.push({
      label: DEEP,
      state: 'bad',
      result: '不够',
      why: k.by === 'thread' ? '后台线程的栈比插件的上限先用完：插件调用套得深的时候，在这台上停的地方和电脑上不一样' : '套到很深也没停下，说明 QuickJS 的栈上限没起作用',
      detail: `${k.by}：${k.note}`,
    });
  return out;
}
/** 6 毫秒、0.04 秒、0.4 秒、1.2 秒 */
const secs = (ms: number) => (ms < 10 ? `${Math.max(1, Math.round(ms))} 毫秒` : `${(ms / 1000).toFixed(ms < 100 ? 2 : 1)} 秒`);

/** 「地图插件」那一组:长一张图多花多久、长出来的和电脑上一不一样。只量,不算进上面的全部通过 */
export function mapRows(raw: Raw): Row[] {
  const COST = '长一张图多花多久';
  const SAME = '长出来的图和电脑上一样';
  const m = raw.map;
  if (!m) return [COST, SAME].map((label) => ({ label, state: 'run', result: '', why: '', detail: '' }));
  if (failed(m)) return [COST, SAME].map((label) => ({ label, state: 'err', result: '没量成', why: '这一项没量成，把结果复制给开发', detail: m.error }));
  const slow = m.ms > MAP_SLOW_MS;
  const wan = Math.round(m.cells / 1000) / 10;
  return [
    {
      label: COST,
      state: slow ? 'slow' : 'ok',
      result: secs(m.ms),
      why: `示例插件「柯本气候」长 ${wan} 万块地的一张图；电脑上约 ${MAP_PROBE_PC_SEC} 秒${slow ? '。用了地图插件的世界在这台上新建、改地形会慢一些' : ''}`,
      detail: `柯本气候那几口 ${m.ms} ms，连插件长一整张 ${m.genMs} ms，${m.cells} 块地`,
    },
    {
      label: SAME,
      state: m.same ? 'ok' : 'bad',
      result: m.same ? '一样' : '不一样',
      why: m.same ? '' : '同一个世界在这台上长出来的地图和电脑上不一样',
      detail: `散列 ${m.sum}，电脑上 ${MAP_PROBE_SUM}`,
    },
  ];
}

export const shortTime = (d: Date) => `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${d.getHours()}:${pad(d.getMinutes())}`;

export function summary(rows: Row[], when: Date | null): Summary {
  if (!allDone(rows) || !when) return { state: 'run', title: '正在查', note: '十来秒，查完以前别切走这页。' };
  const bad = rows.filter((r) => r.state !== 'ok').length;
  if (bad === 0) return { state: 'ok', title: '全部通过', note: `插件关在小屋里：碰不到网站存的东西，也连不了网。${shortTime(when)} 查的` };
  return { state: 'bad', title: `有 ${bad} 项没过`, note: '在这个浏览器里，插件可能不够隔离。请把结果发给开发' };
}

export interface ReportMeta {
  when: Date;
  url: string;
  device: string;
  ua: string;
  site: string;
}

/** 「复制结果」复制的字:发给开发看,每行带原始数 */
export function report(rows: Row[], raw: Raw, meta: ReportMeta): string {
  const d = meta.when;
  const b = raw.battery && !failed(raw.battery) ? raw.battery : null;
  return [
    `插件隔离自检：${summary(rows, d).title}`,
    `时间 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    `网址 ${meta.url}`,
    `这台：${meta.device}`,
    `网站 ${meta.site}`,
    `浏览器标识 ${meta.ua}`,
    ...(b ? [`开沙箱 ${b.readyMs} ms`] : []),
    '只看小屋里面：没有收信站，连没连出去以插件在小屋里自己看到的为准。',
    '',
    ...rows.flatMap((r) => [`${r.state === 'ok' ? '✓' : '✗'} ${r.label}：${r.result}`, `  ${r.detail}`]),
    '',
    '推演插件（只量，不算进全部通过）',
    ...simRows(raw).flatMap((r) => [`${r.state === 'ok' ? '✓' : r.state === 'slow' ? '!' : '✗'} ${r.label}：${r.result}`, `  ${r.detail}`]),
    '',
    '地图插件（只量，不算进全部通过）',
    ...mapRows(raw).flatMap((r) => [`${r.state === 'ok' ? '✓' : r.state === 'slow' ? '!' : '✗'} ${r.label}：${r.result}`, `  ${r.detail}`]),
  ].join('\n');
}
