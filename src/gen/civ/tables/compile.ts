/**
 * 数表规则的编译:语法树(formula.ts)→ 查名字、查类型 → 能跑的"核"(kernel)。
 *
 * **名字的意思**(一条规则在"这一格"上算;这一格是地块、州、国还是全世界,看卡上的单位):
 * - 表名:这一格在那张表里的值。那张表的单位比这一格粗(地块读州的表、州读国的表)时,读这一格所在的州 / 所属的国;
 *   不在任何州(海)、不归任何国时读那张表的 off。比这一格细的(州读地块的表)不能直接读,要用 sumof 这类函数汇总。
 *   多栏表写 表.栏名 或 表[第几栏];正在算的这张表自己、和它栏名一模一样的表可以只写表名,指正在算的那一栏
 * - 常数:卡上的 consts 和引擎给的全局常数;一串数写成 名字[第几栏](下标取整,超出两头的取两头)
 * - dt:这一步过了几年(第一步是 0);year:这一刻是第几年;col:正在算第几栏(0 起)
 * - 所有表读到的都是"这一步开头"的值:几张表同一年要算时,先后顺序不影响结果
 *
 * **函数**:
 * - if(条件, 是, 否);min、max(两个以上);clamp(x, 下, 上);abs、floor、ceil、round、sqrt;
 *   exp、log、pow 和 ^ 舍入到 24 位有效数字(跨 CPU、浏览器逐位一致)
 * - 邻格(地块、州):nbsum(式子[, 条件])、nbmean(式子[, 条件])(没有邻格 = 0)、nbmax / nbmin(式子[, 起始值[, 条件]])
 *   (没有起始值时没有邻格 = 0)、nbcount(条件)。式子里 nb.表名 是邻格的值,直接写表名还是这一格的;
 *   edge.kind、edge.len、edge.border 是这条邻边的类型、路程、共享边界(只有州有)
 * - 往下汇总:sumof、meanof、maxof、minof(式子[, 条件])、countof(条件):式子按比这一格细的单位算
 *   (州里的每个地块、国里的每个州;全世界 = 所有格),式子里直接写的表名都指那一小格
 * - avg(表)、total(表):从这张表上一次算到这一刻,那张表平均是多少 / 每年的量累计了多少(慢表读快表用)
 * - prev(表):那张表这一步开头的值。只在卡上写了 after(这一步在那张表算完之后算、直接写表名读的是它刚算完的新值)时才和直接写表名不同
 * - rand() 或 rand(整数):0–1 的随机数,由"种子、这张表、这一格的位置、这一年、这一栏"定,和先后顺序无关
 * - 编号表只能比是不是同一个(==、!=)和 has(x)(有没有;−1 = 没有)
 *
 * 编出来的核有两种跑法,结果逐位一样:拼成 JavaScript 函数(快),或拼成一串闭包(网页不许拼函数时用)。
 * 拼函数时只从语法树生成,表名、栏名都换成编号,原文里的字不会原样进代码。
 */
import { parseFormula, FormulaError, type BinOp, type Node, type Program } from './formula';
import { colCount, type TableCard, type Unit } from './cards';
import { fexp, flog, fpow } from '../rand';
import { keyed } from '../../util';

export { FormulaError };

/** 单位从细到粗 */
const RANK: Record<Unit, number> = { tile: 0, region: 1, polity: 2, world: 3 };
const UNIT_NAME: Record<Unit, string> = { tile: '地块', region: '州', polity: '国', world: '全世界' };

/** 规则查不过:哪张表的哪条规则、哪里不对 */
export class RuleError extends Error {
  constructor(
    readonly table: string,
    readonly part: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuleError';
  }
}

// ---------------------------------------------------------------------------
// 中间表示

type Ty = 'num' | 'id';

/** 读表时从哪一格读:self = 这一格,nb = 邻格,member = 往下汇总里的那一小格 */
interface Scope {
  unit: Unit;
  kind: 'self' | 'nb' | 'member';
  /** 拼函数时这一格编号的变量名;跑闭包时在 I 里的下标 */
  v: string;
  r: number;
}

/** 一处读表(从 B 的第 slot 份数组里读;via = 当前值 / 平均 / 累计) */
interface Slot {
  table: string;
  via: 'cur' | 'avg' | 'total' | 'prev';
}

type IR =
  | { k: 'num'; v: number }
  | { k: 'local'; slot: number }
  | { k: 'dt' }
  | { k: 'year' }
  | { k: 'col' }
  | { k: 'carr'; arr: number; idx: IR }
  | { k: 'read'; slot: number; scope: Scope; to: Unit; cols: number; col: number | IR; off: number; ty: Ty }
  | { k: 'edge'; attr: 'kind' | 'len' | 'border' }
  | { k: 'math'; fn: string; args: IR[] }
  | { k: 'if'; c: IR; a: IR; b: IR }
  | { k: 'bin'; op: BinOp; a: IR; b: IR }
  | { k: 'neg'; a: IR }
  | { k: 'not'; a: IR }
  | { k: 'has'; a: IR }
  | { k: 'rand'; salt: number; scope: Scope }
  | { k: 'nb'; fn: 'sum' | 'mean' | 'max' | 'min' | 'count'; body: IR | null; start: IR | null; cond: IR | null; scope: Scope; nb: Scope }
  | { k: 'down'; fn: 'sum' | 'mean' | 'max' | 'min' | 'count'; body: IR | null; cond: IR | null; scope: Scope; m: Scope };

interface Compiled {
  /** 中间量:编号(同一张卡里各部分接着编)和式子 */
  lets: { slot: number; ir: IR }[];
  result: IR;
}

/** 一张卡编好的结果:各部分的核,用到哪些数组 */
export interface CardCode {
  card: TableCard;
  cols: number;
  /** rule / rate:每栏一份(同一条公式算所有栏时几栏共用同一份) */
  rule: (Compiled | null)[];
  rate: (Compiled | null)[];
  move: Compiled | null;
  init: Compiled | null;
  /** 读到的数组(B[i]),按先后 */
  slots: Slot[];
  /** 常数串(拼函数时变成 Float64Array) */
  carrs: Float64Array[];
  /** 用到的东西:邻接、州里的地块、国里的州、各单位的位置锚 */
  needs: Set<string>;
  /** 读了哪些表(当前值、平均、累计都算) */
  reads: Set<string>;
  /** 闭包要的寄存器个数:中间量、这一格编号 */
  nLocal: number;
  nIdx: number;
}

/** 编译时要知道的:所有表的卡、全局常数、地块 / 州有没有邻边属性 */
export interface CompileEnv {
  cards: ReadonlyMap<string, TableCard>;
  consts?: Readonly<Record<string, number | readonly number[]>>;
  /** 哪个单位有哪些邻边属性(edge.kind 等) */
  edgeAttrs?: Partial<Record<Unit, readonly ('kind' | 'len' | 'border')[]>>;
}

const MATH1 = new Set(['abs', 'floor', 'ceil', 'round', 'sqrt', 'exp', 'log']);
const NB_FNS: Record<string, 'sum' | 'mean' | 'max' | 'min' | 'count'> = {
  nbsum: 'sum',
  nbmean: 'mean',
  nbmax: 'max',
  nbmin: 'min',
  nbcount: 'count',
};
const DOWN_FNS: Record<string, 'sum' | 'mean' | 'max' | 'min' | 'count'> = {
  sumof: 'sum',
  meanof: 'mean',
  maxof: 'max',
  minof: 'min',
  countof: 'count',
};
const SPECIALS = new Set(['dt', 'year', 'col', 'nb', 'edge']);
const RESERVED_FNS = new Set(['if', 'min', 'max', 'clamp', 'pow', 'has', 'rand', 'avg', 'total', 'prev', ...MATH1, ...Object.keys(NB_FNS), ...Object.keys(DOWN_FNS)]);

/** 编一张卡;写错了抛 RuleError(带着是哪一部分、哪里错) */
export function compileCard(card: TableCard, env: CompileEnv): CardCode {
  const cols = colCount(card);
  const code: CardCode = {
    card,
    cols,
    rule: [],
    rate: [],
    move: null,
    init: null,
    slots: [],
    carrs: [],
    needs: new Set(),
    reads: new Set(),
    nLocal: 0,
    nIdx: 1,
  };
  const carrIndex = new Map<string, number>();
  const slotIndex = new Map<string, number>();
  const prog = (src: string, part: string): Program => {
    try {
      return parseFormula(src);
    } catch (e) {
      if (e instanceof FormulaError) throw new RuleError(card.id, part, `「${card.name}」的 ${part}:${e.message}`);
      throw e;
    }
  };

  const self: Scope = { unit: card.unit, kind: 'self', v: 'i', r: 0 };
  let partName = '';
  const fail = (msg: string): never => {
    throw new RuleError(card.id, partName, `「${card.name}」的 ${partName}:${msg}`);
  };

  const constOf = (name: string): number | readonly number[] | undefined => card.consts?.[name] ?? env.consts?.[name];
  const slotOf = (table: string, via: Slot['via']): number => {
    const key = `${via}:${table}`;
    let s = slotIndex.get(key);
    if (s === undefined) {
      s = code.slots.length;
      code.slots.push({ table, via });
      slotIndex.set(key, s);
    }
    code.reads.add(table);
    return s;
  };
  const carrOf = (name: string, v: readonly number[]): number => {
    let i = carrIndex.get(name);
    if (i === undefined) {
      i = code.carrs.length;
      code.carrs.push(Float64Array.from(v));
      carrIndex.set(name, i);
    }
    return i;
  };

  /** 一个名字在这条规则里是什么(表、常数、中间量……);不认识 = undefined */
  const compileProgram = (p: Program, opts: { initOnly?: boolean; move?: boolean }): Compiled => {
    const locals = new Map<string, number>();
    const lets: Compiled['lets'] = [];

    const tableCard = (name: string): TableCard | undefined => env.cards.get(name);

    /** 从 scope 这一格读 table 的哪一栏 */
    const readTable = (t: TableCard, scope: Scope, col: number | IR | null, via: Slot['via']): IR => {
      if (opts.initOnly && t.id !== card.id && !t.input) fail(`开头的值只能读输入表和常数,不能读「${t.name}」`);
      if (opts.initOnly && t.id === card.id) fail('开头的值不能读自己');
      if (card.reads && t.id !== card.id && !card.reads.includes(t.id)) fail(`读了「${t.name}」,卡上的"读哪些表"里没写它`);
      if (RANK[t.unit] < RANK[scope.unit]) fail(`「${t.name}」按${UNIT_NAME[t.unit]}记,比${UNIT_NAME[scope.unit]}细,要用 sumof / meanof 这类函数汇总`);
      if (scope.unit === 'tile' && (t.unit === 'region' || t.unit === 'polity')) code.needs.add('regionOf');
      if (t.unit === 'polity' && scope.unit !== 'polity') code.needs.add('polityOf');
      const n = colCount(t);
      let c: number | IR;
      if (col === null) {
        // 自己、和自己栏名一样的表:读正在算的那一栏
        const sameCols = t.id === card.id || (!!t.cols && (card.cols ?? []).join('\u0000') === t.cols.join('\u0000'));
        if (n > 1 && !sameCols) fail(`「${t.name}」有 ${n} 栏,要写成 ${t.id}.栏名 或 ${t.id}[第几栏]`);
        c = n > 1 ? { k: 'col' } : 0;
      } else c = col;
      if (typeof c !== 'number' && c.k === 'num') c = Math.min(n - 1, Math.max(0, Math.floor(c.v)));
      if ((via === 'avg' || via === 'total') && t.kind === 'id') fail(`「${t.name}」是编号表,不能求平均或累计`);
      return { k: 'read', slot: slotOf(t.id, via), scope, to: t.unit, cols: n, col: c, off: t.off, ty: t.kind === 'id' ? 'id' : 'num' };
    };

    /** 表名、nb.表名、表.栏、表[栏] 这几种写法 → 读表;不是这几种 = null */
    const ref = (node: Node, sc: Scopes, via: Slot['via']): IR | null => {
      let scope = sc.read;
      let n = node;
      let col: number | IR | null = null;
      // 先拆最外层的 .栏名 / [栏]
      const colOf = (t: TableCard, name: string): number => {
        const i = t.cols?.indexOf(name) ?? -1;
        if (i < 0) fail(`「${t.name}」没有「${name}」这一栏${t.cols ? `(有:${t.cols.join('、')})` : ''}`);
        return i;
      };
      const base = (x: Node): { t: TableCard; scope: Scope } | null => {
        if (x.k === 'name') {
          if (locals.has(x.name) || constOf(x.name) !== undefined || SPECIALS.has(x.name)) return null;
          const t = tableCard(x.name);
          return t ? { t, scope } : null;
        }
        if (x.k === 'member' && x.obj.k === 'name' && x.obj.name === 'nb') {
          if (!sc.nb) fail('nb.表名 只能写在 nbsum、nbmax 这类邻格函数里');
          const t = tableCard(x.name);
          if (!t) fail(`没有叫「${x.name}」的表`);
          return { t: t!, scope: sc.nb! };
        }
        return null;
      };
      let b = base(n);
      if (!b && (n.k === 'member' || n.k === 'index')) {
        const inner = base(n.obj);
        if (inner) {
          b = inner;
          if (n.k === 'member') col = colOf(inner.t, n.name);
          else col = expr(n.index, sc);
          n = n.obj;
        }
      }
      if (!b) return null;
      scope = b.scope;
      return readTable(b.t, scope, col, via);
    };

    interface Scopes {
      /** 直接写表名读哪一格 */
      read: Scope;
      /** nb.表名 读哪一格(在邻格函数里) */
      nb?: Scope;
      /** edge.x 能不能用 */
      edge?: boolean;
      /** 在邻格函数、汇总函数里面(里面不能再套) */
      inLoop?: boolean;
    }

    const num = (x: IR, what: string): IR => {
      if (isId(x)) fail(`编号表(${what})只能比是不是同一个、或写 has(…)`);
      return x;
    };

    const expr = (node: Node, sc: Scopes): IR => {
      switch (node.k) {
        case 'num':
          return { k: 'num', v: node.v };
        case 'name': {
          const l = locals.get(node.name);
          if (l !== undefined) return { k: 'local', slot: l };
          if (node.name === 'dt') return opts.initOnly ? { k: 'num', v: 0 } : { k: 'dt' };
          if (node.name === 'year') return { k: 'year' };
          if (node.name === 'col') return { k: 'col' };
          if (node.name === 'nb' || node.name === 'edge') return fail(`「${node.name}」后面要跟 .名字`);
          const c = constOf(node.name);
          if (typeof c === 'number') return { k: 'num', v: c };
          if (c !== undefined) return fail(`常数「${node.name}」是一串数,要写成 ${node.name}[第几栏]`);
          const r = ref(node, sc, 'cur');
          if (r) return r;
          return fail(`不认识「${node.name}」`);
        }
        case 'member': {
          if (node.obj.k === 'name' && node.obj.name === 'edge') {
            if (!sc.edge) fail('edge.名字 只能写在 nbsum、nbmax 这类邻格函数里');
            const attr = node.name as 'kind' | 'len' | 'border';
            const has = env.edgeAttrs?.[sc.read.unit] ?? [];
            if (!has.includes(attr)) fail(`${UNIT_NAME[sc.read.unit]}的邻边没有「${node.name}」${has.length ? `(有:${has.join('、')})` : ''}`);
            code.needs.add(`edge.${attr}`);
            return { k: 'edge', attr };
          }
          const r = ref(node, sc, 'cur');
          if (r) return r;
          return fail(`不认识「${show(node)}」`);
        }
        case 'index': {
          if (node.obj.k === 'name') {
            const c = constOf(node.obj.name);
            if (c !== undefined && typeof c !== 'number') {
              const idx = num(expr(node.index, sc), '下标');
              if (idx.k === 'num') return { k: 'num', v: c[Math.min(c.length - 1, Math.max(0, Math.floor(idx.v)))] };
              return { k: 'carr', arr: carrOf(node.obj.name, c), idx };
            }
            if (typeof c === 'number') fail(`常数「${node.obj.name}」只是一个数,不能取第几个`);
          }
          const r = ref(node, sc, 'cur');
          if (r) return r;
          return fail(`不认识「${show(node)}」`);
        }
        case 'un': {
          const a = expr(node.a, sc);
          if (node.op === '-') {
            num(a, '取负');
            return a.k === 'num' ? { k: 'num', v: -a.v } : { k: 'neg', a };
          }
          return { k: 'not', a: num(a, 'not') };
        }
        case 'bin': {
          const a = expr(node.a, sc);
          const b = expr(node.b, sc);
          if (node.op === '==' || node.op === '!=') {
            const ia = isId(a);
            const ib = isId(b);
            if (ia !== ib && !(ia ? b.k === 'num' : a.k === 'num')) fail('编号表只能和编号表、或一个整数(比如 −1)比');
            return { k: 'bin', op: node.op, a, b };
          }
          num(a, node.op);
          num(b, node.op);
          if (a.k === 'num' && b.k === 'num' && node.op !== '^') return { k: 'num', v: evalBin(node.op, a.v, b.v) };
          return { k: 'bin', op: node.op, a, b };
        }
        case 'call':
          return call(node, sc);
      }
    };

    const call = (node: Node & { k: 'call' }, sc: Scopes): IR => {
      const { fn, args } = node;
      const arity = (lo: number, hi = lo) => {
        if (args.length < lo || args.length > hi) fail(`${fn}(…) 要 ${lo === hi ? lo : `${lo} 到 ${hi}`} 个参数,写了 ${args.length} 个`);
      };
      const nums = () => args.map((a) => num(expr(a, sc), fn));
      if (fn === 'if') {
        arity(3);
        const [c, a, b] = nums();
        return c.k === 'num' ? (c.v ? a : b) : { k: 'if', c, a, b };
      }
      if (fn === 'min' || fn === 'max') {
        if (args.length < 2) fail(`${fn}(…) 至少要 2 个参数`);
        return { k: 'math', fn, args: nums() };
      }
      if (fn === 'clamp') {
        arity(3);
        return { k: 'math', fn, args: nums() };
      }
      if (fn === 'pow') {
        arity(2);
        return { k: 'math', fn, args: nums() };
      }
      if (MATH1.has(fn)) {
        arity(1);
        return { k: 'math', fn, args: nums() };
      }
      if (fn === 'has') {
        arity(1);
        const a = expr(args[0], sc);
        if (!isId(a)) fail('has(…) 里要写一张编号表');
        return { k: 'has', a };
      }
      if (fn === 'rand') {
        arity(0, 1);
        let salt = 0;
        if (args.length) {
          const a = args[0];
          if (a.k !== 'num' || !Number.isInteger(a.v) || a.v < 0 || a.v > 4095) fail('rand(…) 里只能写 0–4095 的整数');
          salt = (a as { v: number }).v;
        }
        if (opts.initOnly) code.needs.add('rand');
        code.needs.add(`anchor.${sc.read.unit}`);
        return { k: 'rand', salt, scope: sc.read };
      }
      if (fn === 'avg' || fn === 'total') {
        arity(1);
        if (opts.initOnly) fail(`开头的值不能用 ${fn}`);
        const r = ref(args[0], sc, fn);
        if (!r) fail(`${fn}(…) 里要写一张表`);
        if (r!.k === 'read' && code.slots[r!.slot].table === card.id) fail(`${fn}(…) 不能求自己`);
        return r!;
      }
      if (fn === 'prev') {
        arity(1);
        if (opts.initOnly) fail('开头的值不能用 prev');
        const r = ref(args[0], sc, 'prev');
        if (!r) fail('prev(…) 里要写一张表');
        return r!;
      }
      const nbFn = NB_FNS[fn];
      if (nbFn) {
        if (sc.inLoop) fail(`${fn} 不能套在别的邻格、汇总函数里`);
        if (opts.initOnly) fail(`开头的值不能用 ${fn}`);
        const u = sc.read.unit;
        if (u !== 'tile' && u !== 'region') fail(`${UNIT_NAME[u]}没有邻格`);
        code.needs.add(`adj.${u}`);
        const nb: Scope = { unit: u, kind: 'nb', v: `j`, r: 1 };
        code.nIdx = Math.max(code.nIdx, 3);
        const inner: Scopes = { read: sc.read, nb, edge: true, inLoop: true };
        if (nbFn === 'count') {
          arity(1);
          return { k: 'nb', fn: nbFn, body: null, start: null, cond: num(expr(args[0], inner), fn), scope: sc.read, nb };
        }
        if (nbFn === 'max' || nbFn === 'min') {
          arity(1, 3);
          const body = num(expr(args[0], inner), fn);
          const start = args.length > 1 ? num(expr(args[1], sc), fn) : null;
          const cond = args.length > 2 ? num(expr(args[2], inner), fn) : null;
          return { k: 'nb', fn: nbFn, body, start, cond, scope: sc.read, nb };
        }
        arity(1, 2);
        const body = num(expr(args[0], inner), fn);
        const cond = args.length > 1 ? num(expr(args[1], inner), fn) : null;
        return { k: 'nb', fn: nbFn, body, start: null, cond, scope: sc.read, nb };
      }
      const downFn = DOWN_FNS[fn];
      if (downFn) {
        if (sc.inLoop) fail(`${fn} 不能套在别的邻格、汇总函数里`);
        if (opts.initOnly) fail(`开头的值不能用 ${fn}`);
        arity(downFn === 'count' ? 1 : 1, downFn === 'count' ? 1 : 2);
        // 那一小格的单位:式子里读到的表中,比这一格细的最细的那种
        const names = new Set<string>();
        for (const a of args) collectNames(a, names);
        let mu: Unit | null = null;
        for (const nm of names) {
          if (locals.has(nm)) continue;
          const t = tableCard(nm);
          if (t && RANK[t.unit] < RANK[sc.read.unit] && (mu === null || RANK[t.unit] < RANK[mu])) mu = t.unit;
        }
        if (!mu) fail(`${fn}(…) 里要读一张比${UNIT_NAME[sc.read.unit]}细的表`);
        const m: Scope = { unit: mu!, kind: 'member', v: 'u', r: 2 };
        code.nIdx = Math.max(code.nIdx, 3);
        code.needs.add(`members.${sc.read.unit}.${mu}`);
        // 国汇总地块要经过州;全世界汇总直接走所有格
        if (mu === 'tile' && sc.read.unit === 'polity') code.needs.add('regionOf');
        if (sc.read.unit === 'polity') code.needs.add('polityOf');
        const inner: Scopes = { read: m, inLoop: true };
        if (downFn === 'count') return { k: 'down', fn: downFn, body: null, cond: num(expr(args[0], inner), fn), scope: sc.read, m };
        const body = num(expr(args[0], inner), fn);
        const cond = args.length > 1 ? num(expr(args[1], inner), fn) : null;
        return { k: 'down', fn: downFn, body, cond, scope: sc.read, m };
      }
      return fail(`没有 ${fn}(…) 这个函数`);
    };

    const scopes: Scopes = { read: self };
    if (opts.move) {
      // move:在每条邻边上算,nb.表名 是邻格、edge.x 是这条边
      const u = card.unit;
      code.needs.add(`adj.${u}`);
      scopes.nb = { unit: u, kind: 'nb', v: 'j', r: 1 };
      scopes.edge = true;
      code.nIdx = Math.max(code.nIdx, 3);
    }
    for (const l of p.lets) {
      if (RESERVED_FNS.has(l.name) || SPECIALS.has(l.name) || tableCard(l.name) || constOf(l.name) !== undefined) fail(`中间量不能叫「${l.name}」(和表名、常数或函数重名)`);
      if (locals.has(l.name)) fail(`中间量「${l.name}」起了两次`);
      const e = expr(l.expr, scopes);
      if (isId(e)) fail(`中间量「${l.name}」不能直接是编号表`);
      const slot = code.nLocal++;
      lets.push({ slot, ir: e });
      locals.set(l.name, slot);
    }
    const result = num(expr(p.result, scopes), '结果');
    return { lets, result };
  };

  const compilePart = (src: string, part: string, opts: { initOnly?: boolean; move?: boolean } = {}): Compiled => {
    partName = part;
    return compileProgram(prog(src, part), opts);
  };
  const perCol = (r: string | Record<string, string> | undefined, part: string): (Compiled | null)[] => {
    const out: (Compiled | null)[] = [];
    if (!r) return new Array(cols).fill(null);
    if (typeof r === 'string') {
      const c = compilePart(r, part);
      for (let i = 0; i < cols; i++) out.push(c);
      return out;
    }
    const names = card.cols ?? [];
    for (let i = 0; i < cols; i++) out.push(r[names[i]] !== undefined ? compilePart(r[names[i]], `${part}(${names[i]})`) : null);
    return out;
  };
  code.rule = perCol(card.rule, 'rule');
  code.rate = perCol(card.rate, 'rate');
  if (card.move) code.move = compilePart(card.move, 'move', { move: true });
  if (typeof card.init === 'string') code.init = compilePart(card.init, 'init', { initOnly: true });
  return code;
}

function isId(x: IR): boolean {
  return x.k === 'read' && x.ty === 'id';
}

function collectNames(n: Node, out: Set<string>): void {
  switch (n.k) {
    case 'name':
      out.add(n.name);
      return;
    case 'member':
      if (n.obj.k === 'name' && n.obj.name === 'nb') out.add(n.name);
      else collectNames(n.obj, out);
      return;
    case 'index':
      collectNames(n.obj, out);
      collectNames(n.index, out);
      return;
    case 'call':
      for (const a of n.args) collectNames(a, out);
      return;
    case 'bin':
      collectNames(n.a, out);
      collectNames(n.b, out);
      return;
    case 'un':
      collectNames(n.a, out);
      return;
    case 'num':
      return;
  }
}

function show(n: Node): string {
  switch (n.k) {
    case 'name':
      return n.name;
    case 'member':
      return `${show(n.obj)}.${n.name}`;
    case 'index':
      return `${show(n.obj)}[…]`;
    default:
      return '…';
  }
}

function evalBin(op: BinOp, a: number, b: number): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return a / b;
    case '%':
      return a % b;
    case '^':
      return fpow(a, b);
    case '<':
      return a < b ? 1 : 0;
    case '<=':
      return a <= b ? 1 : 0;
    case '>':
      return a > b ? 1 : 0;
    case '>=':
      return a >= b ? 1 : 0;
    case '==':
      return a === b ? 1 : 0;
    case '!=':
      return a !== b ? 1 : 0;
    case 'and':
      return a !== 0 && b !== 0 ? 1 : 0;
    case 'or':
      return a !== 0 || b !== 0 ? 1 : 0;
  }
}

// ---------------------------------------------------------------------------
// 跑起来:两种跑法共用的"一帧"(核开跑前由引擎填好)

/** 引擎在每次跑核之前填好的东西 */
export interface Frame {
  /** 读到的数组,和 CardCode.slots 一一对应 */
  B: Float64Array[];
  /** avg 用:各份累计从哪一刻算起到这一刻过了几年(和 B 一一对应;cur 的不用) */
  span: Float64Array;
  dt: number;
  year: number;
  /** rand 用:这张表的种子、这一刻的年份编号(半年一格) */
  seed: number;
  yearKey: number;
  regionOf: Int32Array;
  polityOf: Int32Array;
  /** 各单位的邻接(CSR)、邻边属性 */
  adjStart: Partial<Record<Unit, Int32Array>>;
  adj: Partial<Record<Unit, Int32Array>>;
  edge: { kind?: Float64Array | Uint8Array; len?: Float32Array | Float64Array; border?: Float32Array | Float64Array };
  /** 州里的地块(CSR)、国里的州(CSR,每步按归属重建) */
  cellStart: Int32Array;
  cells: Int32Array;
  polStart: Int32Array;
  polRegions: Int32Array;
  /** 各单位的位置锚(rand 用) */
  anchor: Partial<Record<Unit, Int32Array>>;
  count: Record<Unit, number>;
}

/**
 * 一部分(rule / rate / move / init)跑一遍:
 * - cell:对 [lo, hi) 里的每一格(mask 不为空时只算 mask[格] ≠ 0 的),第 col 栏写进 out[格 × stride + col]
 *   (rule 和 rate 合起来:新值 = rule(没有就是旧值)+ dt × rate)
 * - edge:对 [lo, hi) 里每一格的每条邻边 k,写 out[k] = move 的值(还没乘 dt、没压到 ≥ 0)
 * 拼函数的格子核写的时候顺手压到卡上的上下限里,返回第一个算出不是数(NaN、无穷大)的位置(格 × stride + 栏;没有 = −1),
 * 引擎就不用再走一遍(CardKernels.clamps);闭包的不压,返回 −1,由引擎查
 */
export type CellKernel = (f: Frame, lo: number, hi: number, col: number, out: Float64Array, stride: number, mask: Uint8Array | null) => number;

/** 能不能拼 JavaScript 函数(网页的安全设置可能不许) */
let canEval: boolean | undefined;
export function evalAllowed(): boolean {
  if (canEval === undefined) {
    try {
      canEval = new Function('return 1')() === 1;
    } catch {
      canEval = false;
    }
  }
  return canEval;
}

export type Backend = 'js' | 'closure';

/** 一张卡的各个核 */
export interface CardKernels {
  /** 每栏一个(rule + rate 合起来;两样都没有 = null,这栏不变) */
  cell: (CellKernel | null)[];
  /**
   * 多栏表一次算完所有栏(只有拼函数时有;col、mask 不用):每格先算几栏共用的公式里和栏无关的中间量,再一栏一栏算,
   * 栏号直接写进代码(读第几栏、if(col == …) 当场定下来)。和一栏一栏调 cell 结果逐位一样,只是快
   */
  group: CellKernel | null;
  /** 格子核写的时候已经压了上下限、查了是不是数(拼函数的) */
  clamps: boolean;
  move: CellKernel | null;
  init: CellKernel | null;
}

export function buildKernels(code: CardCode, backend: Backend): CardKernels {
  const make = backend === 'js' ? jsKernel : closureKernel;
  const any = code.rule.some((x) => x) || code.rate.some((x) => x);
  // 拼函数时多栏表一次算完所有栏;全 0 跳过的表每栏跳过的格子不一样,还是一栏一栏算
  const group = backend === 'js' && code.cols > 1 && any ? jsKernel(code, { group: true }) : null;
  const cell: (CellKernel | null)[] = [];
  const cache = new Map<string, CellKernel>();
  for (let c = 0; c < code.cols; c++) {
    const r = code.rule[c];
    const q = code.rate[c];
    if ((!r && !q) || (group && !code.card.zeroStays)) {
      cell.push(null);
      continue;
    }
    // 同一条公式算几栏的共用一个核
    const key = `${code.rule.indexOf(r)}:${code.rate.indexOf(q)}`;
    let k = cache.get(key);
    if (!k) cache.set(key, (k = make(code, { rule: r, rate: q })));
    cell.push(k);
  }
  return {
    cell,
    group,
    clamps: backend === 'js',
    move: code.move ? make(code, { move: code.move }) : null,
    init: code.init ? make(code, { rule: code.init }) : null,
  };
}

/** 式子里用没用到 slots 里的中间量 */
function refsLocals(ir: IR, slots: ReadonlySet<number>): boolean {
  switch (ir.k) {
    case 'local':
      return slots.has(ir.slot);
    case 'carr':
      return refsLocals(ir.idx, slots);
    case 'read':
      return typeof ir.col !== 'number' && refsLocals(ir.col, slots);
    case 'math':
      return ir.args.some((a) => refsLocals(a, slots));
    case 'if':
      return refsLocals(ir.c, slots) || refsLocals(ir.a, slots) || refsLocals(ir.b, slots);
    case 'bin':
      return refsLocals(ir.a, slots) || refsLocals(ir.b, slots);
    case 'neg':
    case 'not':
    case 'has':
      return refsLocals(ir.a, slots);
    case 'nb':
      return [ir.body, ir.start, ir.cond].some((x) => x !== null && refsLocals(x, slots));
    case 'down':
      return [ir.body, ir.cond].some((x) => x !== null && refsLocals(x, slots));
    default:
      return false;
  }
}

/** 式子里用没用到栏号(col、rand,或用到了栏号的中间量) */
function usesCol(ir: IR, variant: ReadonlySet<number>): boolean {
  switch (ir.k) {
    case 'col':
    case 'rand':
      return true;
    case 'local':
      return variant.has(ir.slot);
    case 'carr':
      return usesCol(ir.idx, variant);
    case 'read':
      return typeof ir.col !== 'number' && usesCol(ir.col, variant);
    case 'math':
      return ir.args.some((a) => usesCol(a, variant));
    case 'if':
      return usesCol(ir.c, variant) || usesCol(ir.a, variant) || usesCol(ir.b, variant);
    case 'bin':
      return usesCol(ir.a, variant) || usesCol(ir.b, variant);
    case 'neg':
    case 'not':
    case 'has':
      return usesCol(ir.a, variant);
    case 'nb':
      return [ir.body, ir.start, ir.cond].some((x) => x !== null && usesCol(x, variant));
    case 'down':
      return [ir.body, ir.cond].some((x) => x !== null && usesCol(x, variant));
    default:
      return false;
  }
}

/** 栏号定下来以后能当场算出的部分先算掉(和跑起来的运算一样,结果逐位一样) */
function foldCol(ir: IR, col: number, K: readonly Float64Array[]): IR {
  const f = (x: IR) => foldCol(x, col, K);
  const isNum = (x: IR): x is { k: 'num'; v: number } => x.k === 'num';
  switch (ir.k) {
    case 'col':
      return { k: 'num', v: col };
    case 'carr': {
      const idx = f(ir.idx);
      if (isNum(idx)) {
        const a = K[ir.arr];
        return { k: 'num', v: a[Math.min(a.length - 1, Math.max(0, Math.floor(idx.v)))] };
      }
      return { ...ir, idx };
    }
    case 'read': {
      if (typeof ir.col === 'number') return ir;
      const c = f(ir.col);
      return { ...ir, col: isNum(c) ? Math.min(ir.cols - 1, Math.max(0, Math.floor(c.v))) : c };
    }
    case 'math': {
      const args = ir.args.map(f);
      if (!args.every(isNum)) return { ...ir, args };
      const v = args.map((a) => (a as { v: number }).v);
      const m = ir.fn === 'min' ? Math.min(...v) : ir.fn === 'max' ? Math.max(...v) : ir.fn === 'clamp' ? Math.min(Math.max(v[0], v[1]), v[2]) : ir.fn === 'pow' ? fpow(v[0], v[1]) : ir.fn === 'exp' ? fexp(v[0]) : ir.fn === 'log' ? flog(v[0]) : (Math as unknown as Record<string, (x: number) => number>)[ir.fn](v[0]);
      return { k: 'num', v: m };
    }
    case 'if': {
      const c = f(ir.c);
      if (isNum(c)) return c.v !== 0 ? f(ir.a) : f(ir.b);
      return { k: 'if', c, a: f(ir.a), b: f(ir.b) };
    }
    case 'bin': {
      const a = f(ir.a);
      const b = f(ir.b);
      if (isNum(a) && isNum(b)) return { k: 'num', v: evalBin(ir.op, a.v, b.v) };
      // and / or 有一边定下来了:另一边要么不用看,要么就是结果(都是纯计算,不算也一样)
      if (ir.op === 'and' || ir.op === 'or') {
        const k = isNum(a) ? a : isNum(b) ? b : null;
        const other = k === a ? b : a;
        if (k) {
          const on = k.v !== 0;
          if (ir.op === 'and' ? !on : on) return { k: 'num', v: on ? 1 : 0 };
          return { k: 'bin', op: '!=', a: other, b: { k: 'num', v: 0 } };
        }
      }
      return { ...ir, a, b };
    }
    case 'neg': {
      const a = f(ir.a);
      return isNum(a) ? { k: 'num', v: -a.v } : { k: 'neg', a };
    }
    case 'not': {
      const a = f(ir.a);
      return isNum(a) ? { k: 'num', v: a.v === 0 ? 1 : 0 } : { k: 'not', a };
    }
    case 'has':
      return { k: 'has', a: f(ir.a) };
    case 'nb':
      return { ...ir, body: ir.body && f(ir.body), start: ir.start && f(ir.start), cond: ir.cond && f(ir.cond) };
    case 'down':
      return { ...ir, body: ir.body && f(ir.body), cond: ir.cond && f(ir.cond) };
    default:
      return ir;
  }
}

interface Parts {
  rule?: Compiled | null;
  rate?: Compiled | null;
  move?: Compiled;
  /** 一次算完所有栏(见 CardKernels.group) */
  group?: boolean;
}

// ---------------------------------------------------------------------------
// 跑法一:拼成 JavaScript 函数

const UNIT_KEY: Record<Unit, string> = { tile: 't', region: 'r', polity: 'p', world: 'w' };

type KernelFactory = (K: Float64Array[], e: typeof fexp, l: typeof flog, p: typeof fpow, k: typeof keyed) => CellKernel;
const FACTORIES = new Map<string, KernelFactory>();

function jsKernel(code: CardCode, parts: Parts): CellKernel {
  const head: string[] = [];
  const body: string[] = [];
  let tmp = 0;
  const fresh = (p: string) => `${p}${tmp++}`;
  const used = new Set<string>();
  const need = (name: string, init: string) => {
    if (!used.has(name)) {
      used.add(name);
      head.push(`const ${name} = ${init};`);
    }
  };
  need('B', 'f.B');
  for (let s = 0; s < code.slots.length; s++) need(`b${s}`, `B[${s}]`);
  code.carrs.forEach((_, i) => need(`k${i}`, `K[${i}]`));

  /**
   * 拼出来的代码不分支:if 的两支、and / or 的两边、邻格和汇总里的条件和式子每格都算(都是纯计算,结果和只算用到的一样)。
   * 浏览器把函数优化成机器码时要知道每一处运算见过什么样的数,没跑过的地方一跑到就得退回去重来;
   * 每处每格都跑,头几格就全见过了,优化一次就稳(冷启动快好几倍,算的量多一点不要紧)
   */
  const temp = (v: string, pre: string[]): string => {
    const t = fresh('t');
    pre.push(`const ${t} = ${v};`);
    return t;
  };
  /**
   * 中间量用到才算:每格开头记成"还没算",第一次用到的地方先算好(没人住的州不算长了多少这类)。
   * 中间量里面照样不分支,第一次用到以后就全见过了
   */
  const letIR = new Map<number, IR>();
  for (const x of [...code.rule, ...code.rate, code.move, code.init]) if (x) for (const l of x.lets) letIR.set(l.slot, l.ir);
  /** 栏号定下来时(一次算完所有栏)正在算第几栏 */
  let fixedCol: number | null = null;
  const ensured = new WeakMap<string[], Set<number>>();
  /** 一次算完所有栏时,几栏各走一遍邻格的中间量:合成走一遍(中间量 → 用到它的几栏) */
  const fused = new Map<number, number[]>();
  const ensure = (slot: number, pre: string[]) => {
    let done = ensured.get(pre);
    if (!done) ensured.set(pre, (done = new Set()));
    const key = fused.has(slot) ? -1 - slot : slot;
    if (done.has(key)) return;
    done.add(key);
    if (fused.has(slot)) return ensureFused(slot, pre);
    const ir = letIR.get(slot)!;
    const inner: string[] = [];
    const v = emit(fixedCol === null ? ir : foldCol(ir, fixedCol, code.carrs), inner);
    pre.push(`if (!h${slot}) {`, ...inner, `l${slot} = ${v};`, `h${slot} = true;`, '}');
  };
  const declare = (slots: Iterable<number>): string[] => Array.from(slots, (x) => `let l${x} = 0, h${x} = false;`);
  /** 合成的那一遍:每栏一个累计,邻格走一遍、每个邻格把各栏都算上(各栏共有的那些读数、运算浏览器只算一次) */
  const ensureFused = (slot: number, pre: string[]) => {
    const cols = fused.get(slot)!;
    const keep = fixedCol;
    const g: string[] = [];
    const parts = cols.map((c) => {
      fixedCol = c;
      const ir = foldCol(letIR.get(slot)!, c, code.carrs) as IR & { k: 'nb' };
      const acc = fresh('a');
      const cnt = ir.fn === 'mean' || ((ir.fn === 'max' || ir.fn === 'min') && !ir.start) ? fresh('n') : null;
      const start = ir.start ? emit(ir.start, g) : null;
      g.push(`let ${acc} = ${ir.fn === 'max' ? (start ?? '-Infinity') : ir.fn === 'min' ? (start ?? 'Infinity') : '0'};`);
      if (cnt) g.push(`let ${cnt} = 0;`);
      return { c, ir, acc, cnt };
    });
    const u = parts[0].ir.scope.unit;
    need(`AS${UNIT_KEY[u]}`, `f.adjStart.${u}`);
    need(`AJ${UNIT_KEY[u]}`, `f.adj.${u}`);
    const loop: string[] = [];
    for (const p of parts) {
      fixedCol = p.c;
      loop.push(...gather(p.ir.fn, p.ir.body, p.ir.cond, p.acc, p.cnt, loop));
    }
    g.push(`for (let k = AS${UNIT_KEY[u]}[i], ke = AS${UNIT_KEY[u]}[i + 1]; k < ke; k++) {`, `const j = AJ${UNIT_KEY[u]}[k];`, ...loop, '}');
    for (const p of parts) {
      const v = p.ir.fn === 'mean' ? `(${p.cnt} > 0 ? ${p.acc} / ${p.cnt} : 0)` : p.cnt ? `(${p.cnt} > 0 ? ${p.acc} : 0)` : p.acc;
      g.push(`lF${slot}_${p.c} = ${v};`);
    }
    fixedCol = keep;
    pre.push(`if (!hF${slot}) {`, ...g, `hF${slot} = true;`, '}');
  };

  /** scope 那一格读 unit 为 to 的表时的下标(−1 = 读不到) */
  const indexOf = (scope: Scope, to: Unit, pre: string[]): string => {
    if (scope.unit === to) return scope.v;
    if (to === 'world') return '0';
    let x = scope.v;
    let u = scope.unit;
    if (u === 'tile') {
      need('RO', 'f.regionOf');
      const m = fresh('m');
      pre.push(`const ${m} = RO[${x}];`);
      x = m;
      u = 'region';
      if (to === 'region') return x;
    }
    if (u === 'region' && to === 'polity') {
      need('PO', 'f.polityOf');
      const m = fresh('m');
      // 这一格、邻格、小格自己的编号不会是 −1;从地块查到的州可能是(海)
      pre.push(x === scope.v ? `const ${m} = PO[${x}];` : `const ${m} = ${x} < 0 ? -1 : PO[${x}];`);
      return m;
    }
    throw new Error(`读不到:${scope.unit} → ${to}`);
  };

  /** 当条件用(得出 JavaScript 的真假;和"不是 0 就算真"一样) */
  const cond = (ir: IR, pre: string[]): string => {
    switch (ir.k) {
      case 'num':
        return ir.v !== 0 ? 'true' : 'false';
      case 'bin':
        switch (ir.op) {
          case 'and':
            return `((${cond(ir.a, pre)} & ${cond(ir.b, pre)}) !== 0)`;
          case 'or':
            return `((${cond(ir.a, pre)} | ${cond(ir.b, pre)}) !== 0)`;
          case '==':
            return `(${emit(ir.a, pre)} === ${emit(ir.b, pre)})`;
          case '!=':
            return `(${emit(ir.a, pre)} !== ${emit(ir.b, pre)})`;
          case '<':
          case '<=':
          case '>':
          case '>=':
            return `(${emit(ir.a, pre)} ${ir.op} ${emit(ir.b, pre)})`;
          default:
            return `(${emit(ir, pre)} !== 0)`;
        }
      case 'not':
        return `!${cond(ir.a, pre)}`;
      case 'has':
        return `(${emit(ir.a, pre)} >= 0)`;
      default:
        return `(${emit(ir, pre)} !== 0)`;
    }
  };

  /**
   * 邻格、汇总里每一格的一步:式子和条件都算,条件不成立的不计进去(加的是 0、不比大小)。
   * 返回要接在 pre 后面的语句(式子、条件自己要先算的已经放进 pre)
   */
  const gather = (fn: string, body: IR | null, cnd: IR | null, acc: string, cnt: string | null, pre: string[]): string[] => {
    const out: string[] = [];
    const c = cnd ? temp(cond(cnd, pre), pre) : null;
    const v = body ? temp(emit(body, pre), pre) : null;
    if (fn === 'count') out.push(c ? `${acc} += ${c} ? 1 : 0;` : `${acc} += 1;`);
    else if (fn === 'sum' || fn === 'mean') out.push(c ? `${acc} += ${c} ? ${v} : 0;` : `${acc} += ${v};`);
    else {
      const gt = temp(`${v} ${fn === 'max' ? '>' : '<'} ${acc}`, out);
      out.push(c ? `if (${c} && ${gt}) ${acc} = ${v};` : `if (${gt}) ${acc} = ${v};`);
    }
    if (cnt) out.push(c ? `${cnt} += ${c} ? 1 : 0;` : `${cnt}++;`);
    return out;
  };

  const emit = (ir: IR, pre: string[]): string => {
    switch (ir.k) {
      case 'num':
        return numLit(ir.v);
      case 'local':
        ensure(ir.slot, pre);
        return fused.has(ir.slot) ? `lF${ir.slot}_${fixedCol}` : `l${ir.slot}`;
      case 'dt':
        return 'dt';
      case 'year':
        return 'year';
      case 'col':
        return 'col';
      case 'carr': {
        const a = `k${ir.arr}`;
        const ix = emit(ir.idx, pre);
        return `${a}[Math.min(${a}.length - 1, Math.max(0, Math.floor(${ix})))]`;
      }
      case 'read': {
        const ix = indexOf(ir.scope, ir.to, pre);
        // 栏号就是正在算的这一栏、两张表栏数一样时,不用再压到范围里
        const c = typeof ir.col === 'number' ? String(ir.col) : ir.col.k === 'col' && ir.cols === code.cols ? 'col' : `Math.min(${ir.cols - 1}, Math.max(0, Math.floor(${emit(ir.col, pre)})))`;
        const slot = code.slots[ir.slot];
        const at = ir.cols === 1 ? ix : `${ix} * ${ir.cols} + ${c}`;
        let v = `b${ir.slot}[${at}]`;
        if (slot.via === 'avg') {
          need('SP', 'f.span');
          v = `(SP[${ir.slot}] > 0 ? ${v} / SP[${ir.slot}] : 0)`;
        }
        if (ix === ir.scope.v || ix === '0') return v;
        return `(${ix} < 0 ? ${numLit(ir.off)} : ${v})`;
      }
      case 'edge':
        need(`E${ir.attr}`, `f.edge.${ir.attr}`);
        return `E${ir.attr}[k]`;
      case 'math': {
        const a = ir.args.map((x) => emit(x, pre));
        switch (ir.fn) {
          case 'min':
          case 'max':
            return `Math.${ir.fn}(${a.join(', ')})`;
          case 'clamp':
            return `Math.min(Math.max(${a[0]}, ${a[1]}), ${a[2]})`;
          case 'pow':
            return `fpow(${a[0]}, ${a[1]})`;
          case 'exp':
            return `fexp(${a[0]})`;
          case 'log':
            return `flog(${a[0]})`;
          default:
            return `Math.${ir.fn}(${a[0]})`;
        }
      }
      case 'if': {
        const c = temp(cond(ir.c, pre), pre);
        const pa: string[] = [];
        const pb: string[] = [];
        const a = emit(ir.a, pa);
        const b = emit(ir.b, pb);
        // 有一支要走一遍邻格、汇总的:只算用到的那一支(省得白走一遍);别的两支都先算好再挑(见上)
        const heavy = (x: string[]) => x.some((l) => l.startsWith('for '));
        if (heavy(pa) || heavy(pb)) {
          const v = fresh('v');
          pre.push(`let ${v};`, `if (${c}) {`, ...pa, `${v} = ${a};`, `} else {`, ...pb, `${v} = ${b};`, `}`);
          return v;
        }
        pre.push(...pa, ...pb);
        const simple = (x: string) => /^[\w.]+$/.test(x);
        return `(${c} ? ${simple(a) ? a : temp(a, pre)} : ${simple(b) ? b : temp(b, pre)})`;
      }
      case 'bin': {
        switch (ir.op) {
          case '^':
            return `fpow(${emit(ir.a, pre)}, ${emit(ir.b, pre)})`;
          case '+':
          case '-':
          case '*':
          case '/':
          case '%':
            return `(${emit(ir.a, pre)} ${ir.op} ${emit(ir.b, pre)})`;
          default:
            return `(${cond(ir, pre)} ? 1 : 0)`;
        }
      }
      case 'neg':
        return `(-${emit(ir.a, pre)})`;
      case 'not':
      case 'has':
        return `(${cond(ir, pre)} ? 1 : 0)`;
      case 'rand': {
        need('SEED', 'f.seed');
        need('YK', 'f.yearKey');
        const u = ir.scope.unit;
        const an = u === 'tile' ? ir.scope.v : u === 'world' ? '0' : (need(`AN${UNIT_KEY[u]}`, `f.anchor.${u}`), `AN${UNIT_KEY[u]}[${ir.scope.v}]`);
        return `keyed(SEED, ${an}, YK, col * 4096 + ${ir.salt})`;
      }
      case 'nb': {
        const u = ir.scope.unit;
        need(`AS${UNIT_KEY[u]}`, `f.adjStart.${u}`);
        need(`AJ${UNIT_KEY[u]}`, `f.adj.${u}`);
        const acc = fresh('a');
        const cnt = fresh('n');
        const start = ir.start ? emit(ir.start, pre) : null;
        const init = ir.fn === 'max' ? (start ?? '-Infinity') : ir.fn === 'min' ? (start ?? 'Infinity') : '0';
        pre.push(`let ${acc} = ${init};`);
        if (ir.fn === 'mean' || ((ir.fn === 'max' || ir.fn === 'min') && !start)) pre.push(`let ${cnt} = 0;`);
        const loop: string[] = [];
        loop.push(...gather(ir.fn, ir.body, ir.cond, acc, ir.fn === 'mean' || ((ir.fn === 'max' || ir.fn === 'min') && !start) ? cnt : null, loop));
        pre.push(`for (let k = AS${UNIT_KEY[u]}[${ir.scope.v}], ke = AS${UNIT_KEY[u]}[${ir.scope.v} + 1]; k < ke; k++) {`, `const j = AJ${UNIT_KEY[u]}[k];`, ...loop, '}');
        if (ir.fn === 'mean') return `(${cnt} > 0 ? ${acc} / ${cnt} : 0)`;
        if ((ir.fn === 'max' || ir.fn === 'min') && !start) return `(${cnt} > 0 ? ${acc} : 0)`;
        return acc;
      }
      case 'down': {
        const acc = fresh('a');
        const cnt = fresh('n');
        const init = ir.fn === 'max' ? '-Infinity' : ir.fn === 'min' ? 'Infinity' : '0';
        pre.push(`let ${acc} = ${init};`, `let ${cnt} = 0;`);
        const step: string[] = [];
        step.push(...gather(ir.fn, ir.body, ir.cond, acc, cnt, step));
        pre.push(...memberLoop(ir.scope, ir.m.unit, step, need));
        if (ir.fn === 'mean') return `(${cnt} > 0 ? ${acc} / ${cnt} : 0)`;
        if (ir.fn === 'max' || ir.fn === 'min') return `(${cnt} > 0 ? ${acc} : 0)`;
        return acc;
      }
    }
  };

  /** 结果的式子(中间量用到才算;col = 栏号定下来时是第几栏) */
  const block = (c: Compiled, out: string[], col: number | null = null): string => {
    fixedCol = col;
    const v = emit(col === null ? c.result : foldCol(c.result, col, code.carrs), out);
    fixedCol = null;
    return v;
  };
  const slotsOf = (...xs: (Compiled | null | undefined)[]) => {
    const out = new Set<number>();
    for (const x of xs) if (x) for (const l of x.lets) out.add(l.slot);
    return out;
  };
  const n = code.card.unit;
  const stride = 'stride';
  /** 写一格:先查是不是数(记下第一处),再压到上下限里(和引擎的护栏一样的比法) */
  const store = (at: string, v: string): string[] => {
    const w = fresh('w');
    const x = fresh('x');
    const lo = numLit(code.card.min);
    const hi = numLit(code.card.max);
    return [
      `const ${x} = ${at};`,
      `const ${w} = ${v};`,
      `if (${w} - ${w} !== 0) {`,
      `if (bad < 0 || ${x} < bad) bad = ${x};`,
      `out[${x}] = ${w};`,
      `} else out[${x}] = ${w} > ${hi} ? ${hi} : ${w} < ${lo} ? ${lo} : ${w};`,
    ];
  };
  if (parts.group) {
    // 一格一格算,每格里一栏一栏算(栏号写死);几栏共用的公式里和栏无关的中间量每格只算一次
    const uses = new Map<Compiled, number>();
    for (let c = 0; c < code.cols; c++) for (const x of [code.rule[c], code.rate[c]]) if (x) uses.set(x, (uses.get(x) ?? 0) + 1);
    const shared = new Set<number>();
    for (const [x, cnt] of uses) {
      if (cnt < 2) continue;
      const v = new Set<number>();
      for (const l of x.lets) if (usesCol(l.ir, v)) v.add(l.slot);
      for (const l of x.lets) if (!v.has(l.slot)) shared.add(l.slot);
      // 直接就是一个邻格函数、里面只用到和栏无关的中间量的:几栏合成走一遍
      for (const l of x.lets) {
        if (!v.has(l.slot) || l.ir.k !== 'nb' || refsLocals(l.ir, v)) continue;
        const cols: number[] = [];
        for (let c = 0; c < code.cols; c++) if (code.rule[c] === x || code.rate[c] === x) cols.push(c);
        fused.set(l.slot, cols);
      }
    }
    // 和栏无关的中间量记在格子这一层(几栏共用),别的每栏一份
    const inner: string[] = [...declare(shared)];
    for (const [slot, cols] of fused) inner.push(`let ${cols.map((c) => `lF${slot}_${c} = 0`).join(', ')}, hF${slot} = false;`);
    for (let c = 0; c < code.cols; c++) {
      const r = code.rule[c];
      const q = code.rate[c];
      if (!r && !q) continue;
      const blk: string[] = [`const col = ${c};`, ...declare([...slotsOf(r, q)].filter((x) => !shared.has(x) && !fused.has(x)))];
      let v = r ? block(r, blk, c) : `out[i * ${stride} + ${c}]`;
      if (q) {
        const t = fresh('r');
        blk.push(`const ${t} = ${v};`);
        v = `${t} + dt * ${block(q, blk, c)}`;
      }
      inner.push('{', ...blk, ...store(`i * ${stride} + ${c}`, v), '}');
    }
    body.push('for (let i = lo; i < hi; i++) {', ...inner, '}');
  } else if (parts.move) {
    need(`AS${UNIT_KEY[n]}`, `f.adjStart.${n}`);
    need(`AJ${UNIT_KEY[n]}`, `f.adj.${n}`);
    const inner: string[] = [...declare(slotsOf(parts.move))];
    const v = block(parts.move, inner);
    body.push(
      'for (let i = lo; i < hi; i++) {',
      'if (mask !== null && mask[i] === 0) continue;',
      `for (let k = AS${UNIT_KEY[n]}[i], ke = AS${UNIT_KEY[n]}[i + 1]; k < ke; k++) {`,
      `const j = AJ${UNIT_KEY[n]}[k];`,
      ...inner,
      `out[k] = ${v};`,
      '}',
      '}',
    );
  } else {
    const inner: string[] = [...declare(slotsOf(parts.rule, parts.rate))];
    // 没有 rule 时旧值就是 out 里的(引擎跑核之前把这一步开头的值抄进了 out)
    let v = parts.rule ? block(parts.rule, inner) : `out[i * ${stride} + col]`;
    if (parts.rate) {
      const r = fresh('r');
      inner.push(`const ${r} = ${v};`);
      v = `${r} + dt * ${block(parts.rate, inner)}`;
    }
    body.push('for (let i = lo; i < hi; i++) {', 'if (mask !== null && mask[i] === 0) continue;', ...inner, ...store(`i * ${stride} + col`, v), '}');
  }
  const src = [...head, 'const dt = f.dt;', 'const year = f.year;', 'let bad = -1;', ...body, 'return bad;'].join('\n');
  // 同样的代码只拼一次:几次推演(几个引擎)用同一个函数,浏览器边跑边优化的成果也接着用
  let factory = FACTORIES.get(src);
  if (!factory) {
    factory = new Function('K', 'fexp', 'flog', 'fpow', 'keyed', `return function kernel(f, lo, hi, col, out, stride, mask) {\n${src}\n};`) as KernelFactory;
    FACTORIES.set(src, factory);
  }
  return factory(code.carrs, fexp, flog, fpow, keyed);
}

/** 往下汇总:scope 那一格里每个 to 单位的小格,跑 step(小格编号在变量 u 里) */
function memberLoop(scope: Scope, to: Unit, step: string[], need: (name: string, init: string) => void): string[] {
  const from = scope.unit;
  const v = scope.v;
  if (from === 'world') {
    need(`N${UNIT_KEY[to]}`, `f.count.${to}`);
    return [`for (let u = 0; u < N${UNIT_KEY[to]}; u++) {`, ...step, '}'];
  }
  if (from === 'region' && to === 'tile') {
    need('CS', 'f.cellStart');
    need('CL', 'f.cells');
    return [`for (let q = CS[${v}], qe = CS[${v} + 1]; q < qe; q++) {`, 'const u = CL[q];', ...step, '}'];
  }
  if (from === 'polity' && to === 'region') {
    need('PS', 'f.polStart');
    need('PL', 'f.polRegions');
    return [`for (let q = PS[${v}], qe = PS[${v} + 1]; q < qe; q++) {`, 'const u = PL[q];', ...step, '}'];
  }
  if (from === 'polity' && to === 'tile') {
    need('PS', 'f.polStart');
    need('PL', 'f.polRegions');
    need('CS', 'f.cellStart');
    need('CL', 'f.cells');
    return [`for (let q = PS[${v}], qe = PS[${v} + 1]; q < qe; q++) {`, 'const g = PL[q];', 'for (let h = CS[g], he = CS[g + 1]; h < he; h++) {', 'const u = CL[h];', ...step, '}', '}'];
  }
  throw new Error(`汇总不了:${from} → ${to}`);
}

/** 数 → 能放进代码里的字(只会是有限数、Infinity) */
function numLit(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (v === Infinity) return 'Infinity';
  if (v === -Infinity) return '-Infinity';
  if (Object.is(v, -0)) return '-0';
  return v < 0 ? `(${String(v)})` : String(v);
}

// ---------------------------------------------------------------------------
// 跑法二:拼成一串闭包(和跑法一的运算、先后完全一样)

type Ev = (s: State) => number;

/** 闭包跑的时候的寄存器:I = 这一格 / 邻格 / 小格的编号,L = 中间量,k = 邻边编号 */
interface State {
  f: Frame;
  I: Int32Array;
  L: Float64Array;
  k: number;
  col: number;
}

function closureKernel(code: CardCode, parts: Parts): CellKernel {
  const K = code.carrs;
  const regIdx = (scope: Scope) => scope.r;

  const indexFn = (scope: Scope, to: Unit): ((s: State) => number) => {
    const r = regIdx(scope);
    if (scope.unit === to) return (s) => s.I[r];
    if (to === 'world') return () => 0;
    if (scope.unit === 'tile' && to === 'region') return (s) => s.f.regionOf[s.I[r]];
    if (scope.unit === 'tile' && to === 'polity')
      return (s) => {
        const m = s.f.regionOf[s.I[r]];
        return m < 0 ? -1 : s.f.polityOf[m];
      };
    if (scope.unit === 'region' && to === 'polity')
      return (s) => {
        const x = s.I[r];
        return x < 0 ? -1 : s.f.polityOf[x];
      };
    throw new Error(`读不到:${scope.unit} → ${to}`);
  };

  const ev = (ir: IR): Ev => {
    switch (ir.k) {
      case 'num': {
        const v = ir.v;
        return () => v;
      }
      case 'local': {
        const i = ir.slot;
        return (s) => s.L[i];
      }
      case 'dt':
        return (s) => s.f.dt;
      case 'year':
        return (s) => s.f.year;
      case 'col':
        return (s) => s.col;
      case 'carr': {
        const a = K[ir.arr];
        const ix = ev(ir.idx);
        return (s) => a[Math.min(a.length - 1, Math.max(0, Math.floor(ix(s))))];
      }
      case 'read': {
        const slot = ir.slot;
        const cols = ir.cols;
        const off = ir.off;
        const ix = indexFn(ir.scope, ir.to);
        const direct = ir.scope.unit === ir.to || ir.to === 'world';
        const cf = typeof ir.col === 'number' ? null : ev(ir.col);
        const c0 = typeof ir.col === 'number' ? ir.col : 0;
        const avg = code.slots[slot].via === 'avg';
        return (s) => {
          const x = ix(s);
          if (!direct && x < 0) return off;
          const c = cf ? Math.min(cols - 1, Math.max(0, Math.floor(cf(s)))) : c0;
          const v = s.f.B[slot][cols === 1 ? x : x * cols + c];
          if (avg) {
            const sp = s.f.span[slot];
            return sp > 0 ? v / sp : 0;
          }
          return v;
        };
      }
      case 'edge': {
        const attr = ir.attr;
        return (s) => s.f.edge[attr]![s.k];
      }
      case 'math': {
        const a = ir.args.map(ev);
        switch (ir.fn) {
          case 'min':
            if (a.length === 2) return (s) => Math.min(a[0](s), a[1](s));
            return (s) => Math.min(...a.map((x) => x(s)));
          case 'max':
            if (a.length === 2) return (s) => Math.max(a[0](s), a[1](s));
            return (s) => Math.max(...a.map((x) => x(s)));
          case 'clamp':
            return (s) => Math.min(Math.max(a[0](s), a[1](s)), a[2](s));
          case 'pow':
            return (s) => fpow(a[0](s), a[1](s));
          case 'exp':
            return (s) => fexp(a[0](s));
          case 'log':
            return (s) => flog(a[0](s));
          default: {
            const m = (Math as unknown as Record<string, (x: number) => number>)[ir.fn];
            const x = a[0];
            return (s) => m(x(s));
          }
        }
      }
      case 'if': {
        const c = ev(ir.c);
        const a = ev(ir.a);
        const b = ev(ir.b);
        return (s) => (c(s) !== 0 ? a(s) : b(s));
      }
      case 'bin': {
        const a = ev(ir.a);
        const b = ev(ir.b);
        switch (ir.op) {
          case '+':
            return (s) => a(s) + b(s);
          case '-':
            return (s) => a(s) - b(s);
          case '*':
            return (s) => a(s) * b(s);
          case '/':
            return (s) => a(s) / b(s);
          case '%':
            return (s) => a(s) % b(s);
          case '^':
            return (s) => fpow(a(s), b(s));
          case '<':
            return (s) => (a(s) < b(s) ? 1 : 0);
          case '<=':
            return (s) => (a(s) <= b(s) ? 1 : 0);
          case '>':
            return (s) => (a(s) > b(s) ? 1 : 0);
          case '>=':
            return (s) => (a(s) >= b(s) ? 1 : 0);
          case '==':
            return (s) => (a(s) === b(s) ? 1 : 0);
          case '!=':
            return (s) => (a(s) !== b(s) ? 1 : 0);
          // 两边都先算(和跑法一一样;都是纯计算,先后不影响结果)
          case 'and':
            return (s) => {
              const x = a(s);
              const y = b(s);
              return x !== 0 && y !== 0 ? 1 : 0;
            };
          case 'or':
            return (s) => {
              const x = a(s);
              const y = b(s);
              return x !== 0 || y !== 0 ? 1 : 0;
            };
        }
        throw new Error(ir.op);
      }
      case 'neg': {
        const a = ev(ir.a);
        return (s) => -a(s);
      }
      case 'not': {
        const a = ev(ir.a);
        return (s) => (a(s) === 0 ? 1 : 0);
      }
      case 'has': {
        const a = ev(ir.a);
        return (s) => (a(s) >= 0 ? 1 : 0);
      }
      case 'rand': {
        const u = ir.scope.unit;
        const r = regIdx(ir.scope);
        const salt = ir.salt;
        return (s) => {
          const x = s.I[r];
          const an = u === 'tile' ? x : u === 'world' ? 0 : s.f.anchor[u]![x];
          return keyed(s.f.seed, an, s.f.yearKey, s.col * 4096 + salt);
        };
      }
      case 'nb': {
        const u = ir.scope.unit;
        const rs = regIdx(ir.scope);
        const rn = regIdx(ir.nb);
        const body = ir.body ? ev(ir.body) : null;
        const cond = ir.cond ? ev(ir.cond) : null;
        const start = ir.start ? ev(ir.start) : null;
        const fn = ir.fn;
        return (s) => {
          const AS = s.f.adjStart[u]!;
          const AJ = s.f.adj[u]!;
          const i = s.I[rs];
          let acc = fn === 'max' ? (start ? start(s) : -Infinity) : fn === 'min' ? (start ? start(s) : Infinity) : 0;
          let n = 0;
          // 套在 move 里时,外面那条边和邻格的编号要留着
          const k0 = s.k;
          const j0 = s.I[rn];
          for (let k = AS[i], ke = AS[i + 1]; k < ke; k++) {
            s.k = k;
            s.I[rn] = AJ[k];
            if (cond && cond(s) === 0) continue;
            if (fn === 'count') acc += 1;
            else if (fn === 'sum' || fn === 'mean') acc += body!(s);
            else {
              const v = body!(s);
              if (fn === 'max' ? v > acc : v < acc) acc = v;
            }
            n++;
          }
          s.k = k0;
          s.I[rn] = j0;
          if (fn === 'mean') return n > 0 ? acc / n : 0;
          if ((fn === 'max' || fn === 'min') && !start) return n > 0 ? acc : 0;
          return acc;
        };
      }
      case 'down': {
        const from = ir.scope.unit;
        const to = ir.m.unit;
        const rs = regIdx(ir.scope);
        const rm = regIdx(ir.m);
        const body = ir.body ? ev(ir.body) : null;
        const cond = ir.cond ? ev(ir.cond) : null;
        const fn = ir.fn;
        return (s) => {
          let acc = fn === 'max' ? -Infinity : fn === 'min' ? Infinity : 0;
          let n = 0;
          const visit = (u: number) => {
            s.I[rm] = u;
            if (cond && cond(s) === 0) return;
            if (fn === 'count') acc += 1;
            else if (fn === 'sum' || fn === 'mean') acc += body!(s);
            else {
              const v = body!(s);
              if (fn === 'max' ? v > acc : v < acc) acc = v;
            }
            n++;
          };
          const f = s.f;
          const x = s.I[rs];
          if (from === 'world') for (let u = 0; u < f.count[to]; u++) visit(u);
          else if (from === 'region') for (let q = f.cellStart[x]; q < f.cellStart[x + 1]; q++) visit(f.cells[q]);
          else if (to === 'region') for (let q = f.polStart[x]; q < f.polStart[x + 1]; q++) visit(f.polRegions[q]);
          else
            for (let q = f.polStart[x]; q < f.polStart[x + 1]; q++) {
              const g = f.polRegions[q];
              for (let h = f.cellStart[g]; h < f.cellStart[g + 1]; h++) visit(f.cells[h]);
            }
          if (fn === 'mean') return n > 0 ? acc / n : 0;
          if (fn === 'max' || fn === 'min') return n > 0 ? acc : 0;
          return acc;
        };
      }
    }
  };

  const block = (c: Compiled): ((s: State) => number) => {
    const slots = c.lets.map((l) => l.slot);
    const lets = c.lets.map((l) => ev(l.ir));
    const res = ev(c.result);
    if (!lets.length) return res;
    return (s) => {
      for (let i = 0; i < lets.length; i++) s.L[slots[i]] = lets[i](s);
      return res(s);
    };
  };

  const state = (f: Frame, col: number): State => ({ f, I: new Int32Array(Math.max(3, code.nIdx)), L: new Float64Array(Math.max(1, code.nLocal)), k: 0, col });
  const unit = code.card.unit;
  if (parts.move) {
    const mv = block(parts.move);
    return (f, lo, hi, col, out, _stride, mask) => {
      const s = state(f, col);
      const AS = f.adjStart[unit]!;
      const AJ = f.adj[unit]!;
      for (let i = lo; i < hi; i++) {
        if (mask !== null && mask[i] === 0) continue;
        s.I[0] = i;
        for (let k = AS[i]; k < AS[i + 1]; k++) {
          s.k = k;
          s.I[1] = AJ[k];
          out[k] = mv(s);
        }
      }
      return -1;
    };
  }
  const rule = parts.rule ? block(parts.rule) : null;
  const rate = parts.rate ? block(parts.rate) : null;
  return (f, lo, hi, col, out, stride, mask) => {
    const s = state(f, col);
    for (let i = lo; i < hi; i++) {
      if (mask !== null && mask[i] === 0) continue;
      s.I[0] = i;
      let v = rule ? rule(s) : out[i * stride + col];
      if (rate) {
        const r = v;
        v = r + f.dt * rate(s);
      }
      out[i * stride + col] = v;
    }
    return -1;
  };
}
