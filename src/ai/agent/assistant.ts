/**
 * 助手:作者用一句话问这个世界的事、或者说想怎么改它,AI 自己查资料、在后台试推演、看了结果再调,
 * 最后把要改的列成一张确认单(作者点了执行才生效)。这里是给 AI 的工具、提示词和一次完整的对话;
 * 循环本身在 ./loop.ts,结果对照在 ./trial.ts。纯逻辑,不碰 DOM(试推演由调用方给 simulate:界面里交给 worker)。
 *
 * 工具:
 * - country:一个国家的来龙去脉(国号、国都、国土消长、结局、相关大事)
 * - chronicle:编年史(按年份、国家筛)
 * - situation:某一年的格局(在世的国家、国土、邻国、正在打的仗)
 * - try_edits:按一批修改在后台重推一遍,和现在比(不动作者的世界;次数有限)
 * - propose_edits:把修改列给作者确认(和改写同一套核对;能试推演的顺带附上和现在比的结果)
 *
 * 修改的写法、核对、合进 WorldEdits 都和「用一句话改写世界」共用(../prompts/rewrite.ts):
 * 编号(P3、C12……)是现在这份历史里的,地形修改不能试推演(整个世界要重新生成)。
 */
import type { World } from '../../gen/world';
import type { Civ } from '../../gen/civ/types';
import { buildChronicle, entryInvolves, entryYearLabel, MAJOR, type ChronicleEntry } from '../../gen/civ/chronicle';
import { capitalAt, polityAlive, polityRoots, polityTitleChain } from '../../gen/civ/growth';
import { ownersAt } from '../../gen/civ/timeline';
import { cleanIntervention, resolveKey, type Intervention, type WorldEdits } from '../../gen/edits';
import {
  REWRITE_OPS,
  bordersAt,
  cleanWish,
  endText,
  lastYear,
  mergeRewrite,
  nameAt,
  parseRewrite,
  rewriteMaterial,
  type RewriteChange,
  type RewriteContext,
  type RewriteItem,
  type RewriteLock,
} from '../prompts/rewrite';
import type { AiMessage, AiUsage } from '../types';
import { runAgent, type AgentEvent, type AgentStep, type AgentTool } from './loop';
import { compareTrial, trialText, type TrialDiff } from './trial';

/** 调用记录里的功能名 */
export const ASSISTANT_FEATURE = '助手';
/** 一次对话里最多试推演几次(propose_edits 顺带的那一次不算) */
export const TRIAL_MAX = 6;
/** 带上前面几轮 */
const HISTORY_TURNS = 6;

export interface AssistantContext {
  world: World;
  /** 套上了改名的这份历史(界面上看到的名字) */
  civ: Civ;
  /** 时间轴的年份 */
  year: number;
  /** 现在的修改 */
  edits: WorldEdits;
  /** 锁住了哪一样(见 RewriteLock) */
  lock?: RewriteLock;
  /**
   * 按这份修改在后台把历史重推一遍(不动作者的世界),返回套上改名的历史。
   * 只会给出干预和改名变了的修改(地形不变);不给 = 不能试推演
   */
  simulate?: (edits: WorldEdits, signal?: AbortSignal) => Promise<Civ>;
}

/** 一次试推演 */
export interface AssistantTrial {
  /** 第几次(从 1 数;propose_edits 顺带的 = 0) */
  n: number;
  items: RewriteItem[];
  /** 试推演用的整份修改(现在的 + 这一批) */
  edits: WorldEdits;
  /** 试推演出来的历史(界面"先在地图上看看"用) */
  civ: Civ;
  diff: TrialDiff;
}

/** 列给作者的确认单 */
export interface AssistantProposal {
  items: RewriteItem[];
  cannot: string[];
  /** 这批修改试推演的结果(有地形修改、或者不能试推演时没有) */
  trial?: AssistantTrial;
}

/** 之前的一轮(给 AI 看前情) */
export interface AssistantTurn {
  ask: string;
  /** 助手当时回的话 */
  reply?: string;
  /** 当时列的修改(一句一条) */
  items?: string[];
  /** 作者执行了没有 */
  applied?: boolean;
}

export interface AssistantResult {
  text: string;
  steps: AgentStep[];
  proposal: AssistantProposal | null;
  trials: AssistantTrial[];
  end: 'done' | 'rounds';
  usage: AiUsage;
}

// ---------------------------------------------------------------------------
// 提示词

export const ASSISTANT_SYSTEM = [
  '你是「文明与地图」里的助手。这是一颗虚构的星球:地形由板块、侵蚀、气候生成,历史从第 0 年按规则推演到最后一年。',
  '作者会问这个世界的事,或者说想怎么改它。你可以用工具查资料(country、chronicle、situation)、在后台试推演(try_edits)、把修改列给作者确认(propose_edits)。',
  '',
  '## 怎么做',
  '1. 作者在提问:先用工具查清楚再答,不要凭印象编;答得具体(哪一年、谁、几州)。',
  '2. 作者要改世界:先查清楚来龙去脉,再用 try_edits 试一种改法,看结果是不是作者要的;不理想就换一种再试(最多试 4 次),挑最好的一种用 propose_edits 列给作者。',
  '   试推演不会动作者的世界;只有作者在确认单上点了执行才生效。',
  '3. 只做作者要的,不要额外加作者没提的事;能用历史命令做到的,不要动地形。地形修改不能试推演,直接列给作者,说明历史会整个重来。',
  '4. 命令只能定下条件(保护、结盟、宣战……),不能直接规定谁打赢、哪年发生什么,后果由推演展开。试了几次都做不到时照实说,列出最接近的一种。',
  '5. 说完一件事就停:列了确认单以后,用一两句话说结论(做到了什么、试推演的数字照实说),做不到的部分说一句。不要再问作者要不要执行。',
  '6. 回给作者的话说名字,不说编号(P3、C12 这些只在工具里用);全部用中文,简短,不用 Markdown 标题和表格。',
  '',
  '## 编号',
  '材料和工具结果里的 P3(国家)、C12(城)、R45(州)、E2(民族)、M7(山河湖海)是现在这份历史里的编号,修改里只能用这些编号。',
  '作者说的名字对不上任何一个,就说找不到,不要编。试推演里新出现的国家没有编号,不能对它下命令。',
  '',
  '## 修改的写法(try_edits、propose_edits 的 edits,一条一个对象,op 是种类)',
  '',
  REWRITE_OPS,
  '每条修改带 why:一句话(25 字以内)说为什么这样改,给作者看。',
  'from 是整数年份,要在那个国家存在的年份里(立国当年到亡国前一年),而且早于历史的最后一年。',
  '例:{"op":"protect","country":"P3","from":2400,"until":2750,"why":"…"}、{"op":"ally","country":"P3","other":"P5","from":2400,"why":"…"}、' +
    '{"op":"rename","target":"C12","name":"…","why":"…"}、{"op":"range","path":[[10,40],[14,46]],"size":"大","why":"…"}',
].join('\n');

/** 一条修改的参数(JSON Schema;核对在 parseRewrite 里做,这里只给模型看个大概) */
const EDIT_SCHEMA = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: ['protect', 'unity', 'halt', 'ally', 'declare', 'move', 'cede', 'found', 'rename', 'volcano', 'lake', 'range', 'raise', 'sink'] },
    country: { type: 'string', description: '国家编号,如 P3' },
    other: { type: 'string', description: '另一个国家的编号(ally、declare)' },
    city: { type: 'string', description: '城的编号,如 C12' },
    region: { type: 'string', description: '州的编号,如 R45' },
    target: { type: 'string', description: 'rename 的对象:P / C / R / E / M 编号' },
    name: { type: 'string' },
    from: { type: 'integer', description: '从哪一年起' },
    until: { type: 'integer', description: '到哪一年为止(可不给)' },
    permanent: { type: 'boolean' },
    at: { type: 'array', items: { type: 'number' }, description: '[经度, 纬度]' },
    path: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: '[[经度, 纬度], …]' },
    size: { type: 'string', enum: ['小', '中', '大'] },
    why: { type: 'string' },
  },
  required: ['op'],
};

/** 这一次对话发给 AI 的开头:提示词 + 材料 + 前几轮 + 作者这次说的话 */
export function assistantMessages(ctx: AssistantContext, history: readonly AssistantTurn[], ask: string): AiMessage[] {
  const w = cleanWish(ask);
  const prev = history.slice(-HISTORY_TURNS);
  const mat = rewriteMaterial(ctx.world, ctx.civ, ctx.year, ctx.edits, [...prev.map((t) => t.ask), w], ctx.lock);
  const parts = [mat.text];
  if (prev.length) {
    parts.push('', '# 之前的对话(世界已经按执行过的修改更新,上面的材料是现在的样子)');
    for (const t of prev) {
      parts.push(`作者:${cleanWish(t.ask)}`);
      if (t.reply || t.items?.length)
        parts.push(`你:${t.reply ?? ''}${t.items?.length ? `(列的修改:${t.items.join(';')}${t.applied ? '—— 作者执行了' : '—— 作者没有执行'})` : ''}`);
    }
  }
  parts.push('', '# 作者这次说', w);
  return [
    { role: 'system', content: ASSISTANT_SYSTEM },
    { role: 'user', content: parts.join('\n') },
  ];
}

// ---------------------------------------------------------------------------
// 查资料的小工具

/** "P3" / "3" / 3 / 国名 → 国家编号;找不到 = −1 */
export function polityOf(civ: Civ, v: unknown): number {
  const P = civ.polities;
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v < P.length ? v : -1;
  if (typeof v !== 'string') return -1;
  const s = v.trim();
  const m = /^[Pp]?(\d{1,5})$/.exec(s);
  if (m) {
    const id = Number(m[1]);
    return id < P.length ? id : -1;
  }
  if ([...s].length < 1) return -1;
  // 按名字找:全称(各个国号)、词根;同名的挑立国早的
  const hit = (p: (typeof P)[number]) => polityTitleChain(p).split(' → ').includes(s) || polityRoots(p).includes(s) || p.name === s;
  const exact = P.find(hit);
  if (exact) return exact.id;
  const part = P.find((p) => polityTitleChain(p).includes(s));
  return part ? part.id : -1;
}

/** 年份参数 → 整数年(超出范围的夹到 0..endYear);没给 = fallback */
function yearArg(civ: Civ, v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^\d.-]/g, '')) : NaN;
  const y = Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(Math.floor(civ.endYear), Math.floor(y)));
}

/** 第 y 年各国几州 */
function sizesAt(civ: Civ, y: number): Map<number, number> {
  const own = y >= civ.endYear ? civ.polity : ownersAt(civ, y).polity;
  const m = new Map<number, number>();
  for (let r = 0; r < own.length; r++) if (own[r] >= 0) m.set(own[r], (m.get(own[r]) ?? 0) + 1);
  return m;
}

/** 编年史一条(给 AI 看):"第 1200—1215 年 正文〔P3、P5〕" */
function entryLine(e: ChronicleEntry): string {
  return `${entryYearLabel(e)} ${e.text}${e.polities.length ? `〔${e.polities.slice(0, 4).map((p) => `P${p}`).join('、')}〕` : ''}`;
}

/** 已下的干预里和国家 id 有关的(一句一条) */
function ivsOf(civ: Civ, edits: WorldEdits, id: number): string[] {
  const out: string[] = [];
  const pid = (k: string) => {
    const r = resolveKey(civ, k);
    return r && r.kind === 'polity' ? r.id : -1;
  };
  for (const raw of edits.interventions) {
    const v = cleanIntervention(raw);
    if (!v) continue;
    const a = 'a' in v ? pid(v.a) : -1;
    const b = v.kind === 'ally' || v.kind === 'declare' ? pid(v.b) : -1;
    if (a !== id && b !== id) continue;
    out.push(`第 ${v.from} 年起 ${ivWord(civ, v, a, b)}`);
  }
  return out;
}

const IV_WORD: Record<Intervention['kind'], string> = {
  protect: '保护',
  unity: '禁止分裂',
  halt: '禁止扩张',
  ally: '结盟',
  declare: '宣战',
  move: '迁都',
  cede: '划州',
  found: '立国',
};

function ivWord(civ: Civ, v: Intervention, a: number, b: number): string {
  const n = (id: number) => (id >= 0 ? `P${id} ${nameAt(civ.polities[id], v.from)}` : '(找不到的国家)');
  const until = 'until' in v && v.until !== undefined ? `,至第 ${v.until} 年` : '';
  if (v.kind === 'found') return `在一州立国${v.name ? `「${v.name}」` : ''}`;
  if (v.kind === 'ally') return `${n(a)} 与 ${n(b)} 结盟${until}`;
  if (v.kind === 'declare') return `${n(a)} 向 ${n(b)} 宣战`;
  return `${n(a)} ${IV_WORD[v.kind]}${until}`;
}

/** 一条修改的简短说法(步骤的一行用;不核对):"保护特拉维亚共和国" */
function editWord(civ: Civ, x: unknown): string {
  if (!x || typeof x !== 'object') return '';
  const o = x as Record<string, unknown>;
  const op = String(o.op ?? '');
  const p = (v: unknown) => {
    const id = polityOf(civ, v);
    return id >= 0 ? nameAt(civ.polities[id], typeof o.from === 'number' ? o.from : civ.endYear) : '';
  };
  switch (op) {
    case 'protect':
    case 'unity':
    case 'halt':
      return `${IV_WORD[op]}${p(o.country)}`;
    case 'ally':
      return `${p(o.country)}与${p(o.other)}结盟`;
    case 'declare':
      return `${p(o.country)}向${p(o.other)}宣战`;
    case 'move':
      return `${p(o.country)}迁都`;
    case 'cede':
      return `划一州给${p(o.country)}`;
    case 'found':
      return '立一个新国家';
    case 'rename':
      return `改名为${typeof o.name === 'string' ? o.name : ''}`;
    case 'volcano':
      return '放一座火山';
    case 'lake':
      return '挖一个湖';
    case 'range':
      return '拉一道山脉';
    case 'raise':
      return '抬起陆地';
    case 'sink':
      return '沉成海';
    default:
      return op;
  }
}

const editsWord = (civ: Civ, edits: unknown) =>
  Array.isArray(edits)
    ? edits
        .map((x) => editWord(civ, x))
        .filter(Boolean)
        .slice(0, 3)
        .join('、')
    : '';

/** 两批修改是不是同一批(比能执行的那几条) */
const changeSig = (cs: readonly RewriteChange[]) =>
  cs
    .map((c) => JSON.stringify(c))
    .sort()
    .join('\n');

/** 核对结果写成文字(交回 AI) */
function itemsText(items: readonly RewriteItem[]): string {
  return items.map((it) => `- ${it.text}${it.year !== undefined ? `(第 ${it.year} 年起)` : ''}${it.problem ? ` —— 不合格:${it.problem}` : ''}`).join('\n');
}

// ---------------------------------------------------------------------------
// 一次对话

export interface AssistantOptions {
  signal?: AbortSignal;
  onEvent?: (e: AgentEvent) => void;
  maxRounds?: number;
}

/** 给 AI 的工具(带着这次对话的试推演和确认单) */
export function assistantTools(ctx: AssistantContext, state: { trials: AssistantTrial[]; proposal: AssistantProposal | null }): AgentTool[] {
  const { civ } = ctx;
  const rctx: RewriteContext = { world: ctx.world, civ, year: ctx.year, edits: ctx.edits, lock: ctx.lock };
  const noCiv = '这颗星球没有长出文明:没有国家和历史。';
  const end = Math.floor(civ.endYear);

  const parse = (args: Record<string, unknown>, cannot?: unknown) => {
    const p = parseRewrite(JSON.stringify({ reply: '', edits: args.edits ?? [], ...(cannot !== undefined ? { cannot } : {}) }), rctx);
    if (!p.ok) throw new Error('edits 里没有修改');
    return p;
  };

  /** 能试推演的那几条:干预、改名(地形不行) */
  const trialable = (items: readonly RewriteItem[]) => items.filter((it) => it.change && it.change.kind !== 'terrain').map((it) => it.change!);

  /** 按这几条修改试推演一次 */
  const trial = async (items: RewriteItem[], changes: RewriteChange[], n: number, watch: number[], signal?: AbortSignal): Promise<AssistantTrial> => {
    const edits = mergeRewrite(ctx.edits, changes);
    const after = await ctx.simulate!(edits, signal);
    const focus = new Set(watch);
    let from = end;
    for (const c of changes) {
      if (c.kind !== 'intervention') continue;
      from = Math.min(from, c.v.from);
      for (const k of ['a' in c.v ? c.v.a : undefined, 'b' in c.v ? c.v.b : undefined]) {
        if (!k) continue;
        const r = resolveKey(civ, k);
        if (r && r.kind === 'polity') focus.add(r.id);
      }
    }
    return { n, items, edits, civ: after, diff: compareTrial(civ, after, [...focus], from) };
  };

  const country: AgentTool = {
    def: {
      name: 'country',
      description: '查一个国家的来龙去脉:国号先后、存在的年份、国都变迁、国土消长、邻国、结局、已下的命令、和它有关的大事。',
      parameters: { type: 'object', properties: { country: { type: 'string', description: '国家编号(如 P3),或国名' } }, required: ['country'] },
    },
    label: (a) => {
      const id = polityOf(civ, a.country);
      return id >= 0 ? `查${nameAt(civ.polities[id], ctx.year)}` : '查国家';
    },
    run: (a) => {
      if (!civ.viable) return noCiv;
      const id = polityOf(civ, a.country);
      if (id < 0) return `找不到国家「${String(a.country ?? '')}」;请用材料里的编号(P3 这样)`;
      const p = civ.polities[id];
      const S = civ.settlements;
      const out: string[] = [];
      const cu = civ.cultures[p.culture];
      const last = lastYear(civ, p);
      out.push(
        `P${id} ${nameAt(p, ctx.year)} · 第 ${Math.floor(p.founded)}—${p.ended !== undefined ? `${Math.floor(p.ended)} 年` : `${end} 年(到最后仍在)`}` +
          (polityTitleChain(p).includes('→') ? ` · 国号先后:${polityTitleChain(p)}` : '') +
          (cu ? ` · 民族 E${cu.id}(${cu.name}族)` : ''),
      );
      const caps = p.capitals?.length ? p.capitals : [{ year: p.founded, settlement: p.capital }];
      out.push(`国都:${caps.map((c) => `第 ${Math.floor(c.year)} 年起 C${c.settlement} ${S[c.settlement]?.name ?? ''}`).join(' → ')}`);
      // 国土消长:立国到最后,取八九个年份
      const span = Math.max(1, Math.floor(last) - Math.floor(p.founded));
      const step = Math.max(10, Math.round(span / 8 / 10) * 10);
      const samples: string[] = [];
      let peak = { y: Math.floor(p.founded), n: 0 };
      // 立国那一年州还没划过来(常常是 0 州),从第二年数起
      for (let y = Math.min(Math.floor(last), Math.floor(p.founded) + 1); y < Math.floor(last); y += step) {
        const n = sizesAt(civ, y).get(id) ?? 0;
        samples.push(`第 ${y} 年 ${n} 州`);
        if (n > peak.n) peak = { y, n };
      }
      const nLast = sizesAt(civ, Math.floor(last)).get(id) ?? 0;
      if (nLast > peak.n) peak = { y: Math.floor(last), n: nLast };
      samples.push(`第 ${Math.floor(last)} 年 ${nLast} 州`);
      out.push(`国土:${samples.join(' / ')};最盛约第 ${peak.y} 年 ${peak.n} 州`);
      const Y = Math.floor(Math.min(ctx.year, end));
      if (polityAlive(p, Y)) {
        const own = Y >= civ.endYear ? civ.polity : ownersAt(civ, Y).polity;
        const near = [...bordersAt(civ, own, id)].sort((x, y) => x - y);
        out.push(
          `第 ${Y} 年(时间轴):${sizesAt(civ, Y).get(id) ?? 0} 州,国都 C${capitalAt(p, Y)} ${S[capitalAt(p, Y)]?.name ?? ''},` +
            (near.length ? `邻国 ${near.map((q) => `P${q} ${nameAt(civ.polities[q], Y)}`).join('、')}` : '没有接壤的国家'),
        );
      }
      // endText 只写编号:补上国名(亡国那年的叫法)
      const fate = endText(civ, p).replace(/P(\d+)/, (m, d: string) => `${m} ${nameAt(civ.polities[Number(d)], p.ended ?? civ.endYear)}`);
      out.push(`结局:${fate || '到最后仍在'}`);
      const ivs = ivsOf(civ, ctx.edits, id);
      if (ivs.length) out.push(`已下的命令:${ivs.join(';')}`);
      const all = buildChronicle(civ).filter((e) => entryInvolves(e, id));
      const major = all.filter((e) => e.importance >= MAJOR);
      const list = (major.length >= 6 ? major : all).slice(-24);
      out.push(`和它有关的大事(共 ${all.length} 条,列${list.length < all.length ? '最近的' : ''} ${list.length} 条;更多用 chronicle 查):`);
      for (const e of list) out.push(`- ${entryLine(e)}`);
      return out.join('\n');
    },
  };

  const chronicle: AgentTool = {
    def: {
      name: 'chronicle',
      description: '查编年史:按年份范围、国家筛选。默认只列大事;all = true 列全部。一次最多 60 条,太多就缩小年份范围。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'integer', description: '从哪一年(含)' },
          to: { type: 'integer', description: '到哪一年(含)' },
          country: { type: 'string', description: '只看和这个国家有关的(编号如 P3)' },
          all: { type: 'boolean', description: 'true = 不只大事' },
          limit: { type: 'integer', description: '最多几条,默认 30' },
        },
      },
    },
    label: (a) => {
      const id = a.country !== undefined ? polityOf(civ, a.country) : -1;
      const range = a.from !== undefined || a.to !== undefined ? `第 ${a.from ?? 0}—${a.to ?? end} 年` : '';
      return `查编年史${id >= 0 ? `:${nameAt(civ.polities[id], ctx.year)}` : ''}${range ? `${id >= 0 ? ',' : ':'}${range}` : ''}`;
    },
    run: (a) => {
      if (!civ.viable) return noCiv;
      const from = yearArg(civ, a.from, 0);
      const to = yearArg(civ, a.to, end);
      const id = a.country !== undefined && a.country !== '' ? polityOf(civ, a.country) : -1;
      if (a.country !== undefined && a.country !== '' && id < 0) return `找不到国家「${String(a.country)}」`;
      const limit = Math.max(1, Math.min(60, Math.floor(Number(a.limit) || 30)));
      const list = buildChronicle(civ).filter(
        (e) => Math.floor(e.end) >= from && Math.floor(e.year) <= to && (a.all === true || e.importance >= MAJOR) && (id < 0 || entryInvolves(e, id)),
      );
      if (!list.length) return `第 ${from}—${to} 年${id >= 0 ? `和 P${id} 有关的` : ''}没有${a.all === true ? '' : '大'}事。`;
      const shown = list.slice(0, limit);
      return [
        `第 ${from}—${to} 年${id >= 0 ? `和 P${id} ${nameAt(civ.polities[id], to)} 有关的` : '的'}${a.all === true ? '史事' : '大事'}:共 ${list.length} 条${shown.length < list.length ? `,列前 ${shown.length} 条(缩小年份范围看后面的)` : ''}`,
        ...shown.map((e) => `- ${entryLine(e)}`),
      ].join('\n');
    },
  };

  const situation: AgentTool = {
    def: {
      name: 'situation',
      description: '查某一年的格局:那年在世的国家(按国土大小)、国都、邻国,和正在打的仗。',
      parameters: { type: 'object', properties: { year: { type: 'integer' } }, required: ['year'] },
    },
    label: (a) => `查第 ${yearArg(civ, a.year, ctx.year)} 年的格局`,
    run: (a) => {
      if (!civ.viable) return noCiv;
      const Y = yearArg(civ, a.year, ctx.year);
      const own = Y >= civ.endYear ? civ.polity : ownersAt(civ, Y).polity;
      const size = sizesAt(civ, Y);
      const alive = civ.polities.filter((p) => polityAlive(p, Y) && (size.get(p.id) ?? 0) > 0).sort((x, y) => (size.get(y.id) ?? 0) - (size.get(x.id) ?? 0) || x.id - y.id);
      const S = civ.settlements;
      const out = [`第 ${Y} 年在世的国家 ${alive.length} 个${alive.length > 40 ? '(列最大的 40 个)' : ''}:`];
      for (const p of alive.slice(0, 40)) {
        const cap = capitalAt(p, Y);
        const near = [...bordersAt(civ, own, p.id)].sort((x, y) => x - y);
        out.push(`- P${p.id} ${nameAt(p, Y)} · ${size.get(p.id)} 州 · 国都 C${cap} ${S[cap]?.name ?? ''}${near.length ? ` · 邻国 ${near.map((q) => `P${q}`).join('、')}` : ''}`);
      }
      const wars = buildChronicle(civ).filter((e) => e.kind === 'war' && Math.floor(e.year) <= Y && Math.floor(e.end) >= Y);
      if (wars.length) out.push(`这一年正在打的仗:`, ...wars.slice(0, 12).map((e) => `- ${entryLine(e)}`));
      return out.join('\n');
    },
  };

  const tryEdits: AgentTool = {
    def: {
      name: 'try_edits',
      description:
        `按一批修改在后台把历史重推一遍,告诉你结果和现在比有什么不同(关注的国家结局、变化最大的国家、多了少了哪些大事)。不会动作者的世界。` +
        `一次对话最多 ${TRIAL_MAX} 次;地形修改不能试推演。`,
      parameters: {
        type: 'object',
        properties: {
          edits: { type: 'array', items: EDIT_SCHEMA, description: '要试的修改' },
          watch: { type: 'array', items: { type: 'string' }, description: '另外想看结局的国家编号(修改里点到的会自动看)' },
        },
        required: ['edits'],
      },
    },
    label: (a) => `试推演${editsWord(civ, a.edits) ? `:${editsWord(civ, a.edits)}` : ''}`,
    run: async (a, signal) => {
      if (!ctx.simulate) throw new Error('这里不能试推演,直接用 propose_edits 列给作者');
      const done = state.trials.filter((t) => t.n > 0).length;
      if (done >= TRIAL_MAX) throw new Error(`试推演已经用了 ${TRIAL_MAX} 次,请挑最好的一种用 propose_edits 列给作者`);
      const p = parse(a);
      const changes = trialable(p.items);
      const notes: string[] = [];
      if (p.items.some((it) => it.change?.kind === 'terrain')) notes.push('地形修改不能试推演(整个世界要重新生成),这次没算进去。');
      if (!changes.length) return [`没有能试推演的修改:`, itemsText(p.items), ...notes].join('\n');
      if (!changes.some((c) => c.kind === 'intervention')) return [`只有改名,历史不会变,不用试推演:`, itemsText(p.items)].join('\n');
      const watch = (Array.isArray(a.watch) ? a.watch : []).map((x) => polityOf(civ, x)).filter((id) => id >= 0);
      const t = await trial(p.items, changes, done + 1, watch, signal);
      state.trials.push(t);
      return [`第 ${t.n} 次试推演(没有执行),修改:`, itemsText(p.items), ...notes, trialText(t.diff)].join('\n');
    },
  };

  const propose: AgentTool = {
    def: {
      name: 'propose_edits',
      description:
        '把修改列给作者确认(作者点了执行才生效)。一次对话只列一张,再调会换掉上一张。列之前最好先用 try_edits 试过;' +
        '没试过的会顺带试推演一次。做不到的部分写进 cannot,一条一句话。',
      parameters: {
        type: 'object',
        properties: {
          edits: { type: 'array', items: EDIT_SCHEMA },
          cannot: { type: 'array', items: { type: 'string' }, description: '做不到的部分,一条一句话' },
        },
        required: ['edits'],
      },
    },
    label: (a) => `列出要改的 ${Array.isArray(a.edits) ? a.edits.length : 0} 条`,
    run: async (a, signal) => {
      const p = parse(a, a.cannot);
      const ok = p.items.filter((it) => it.change);
      const changes = trialable(p.items);
      let t: AssistantTrial | undefined;
      // 有地形修改的不附结果(历史会整个重来,和现在没法比)
      if (changes.length === ok.length && changes.some((c) => c.kind === 'intervention')) {
        const sig = changeSig(changes);
        t = state.trials.find((x) => changeSig(trialable(x.items)) === sig);
        if (!t && ctx.simulate) t = await trial(p.items, changes, 0, [], signal);
      }
      const replaced = !!state.proposal;
      state.proposal = { items: p.items, cannot: p.cannot, ...(t ? { trial: t } : {}) };
      const out = [
        `${replaced ? '已换掉上一张,' : ''}列给作者 ${p.items.length} 条${ok.length < p.items.length ? `(其中 ${p.items.length - ok.length} 条不合格,作者执行不了)` : ''}:`,
        itemsText(p.items),
      ];
      if (p.cannot.length) out.push(`做不到的:${p.cannot.join(';')}`);
      if (t) out.push(t.n > 0 ? `这批修改就是第 ${t.n} 次试推演的那一批。` : '这批修改顺带试推演了一次:', ...(t.n > 0 ? [] : [trialText(t.diff)]));
      out.push('现在用一两句话告诉作者结论。');
      return out.join('\n');
    },
  };

  return [country, chronicle, situation, tryEdits, propose];
}

/** 助手的一次对话:问 → 查 / 试 → 列确认单 → 回话 */
export async function runAssistant(ctx: AssistantContext, history: readonly AssistantTurn[], ask: string, opts: AssistantOptions = {}): Promise<AssistantResult> {
  const state: { trials: AssistantTrial[]; proposal: AssistantProposal | null } = { trials: [], proposal: null };
  const w = cleanWish(ask);
  const out = await runAgent({
    feature: ASSISTANT_FEATURE,
    title: [...w].length > 24 ? `${[...w].slice(0, 24).join('')}…` : w,
    messages: assistantMessages(ctx, history, w),
    tools: assistantTools(ctx, state),
    maxRounds: opts.maxRounds,
    temperature: 0.3,
    maxTokens: 2000,
    signal: opts.signal,
    onEvent: opts.onEvent,
  });
  return { text: out.text, steps: out.steps, proposal: state.proposal, trials: state.trials, end: out.end, usage: out.usage };
}
