/**
 * 数表规则的公式语言:读入一段公式文字,拆成语法树(AST)。只管"写得对不对",不管读的表在不在(那是 compile.ts 的事)。
 *
 * 写法像表格公式,一条规则算出一个格子(地块 / 州 / 国)的新值:
 *
 *   # 井号或 // 起到行尾是注释
 *   let 增长 = 0.02 * pop * (1 - pop / cap)     # 先起几个中间量(只在这一格里有效)
 *   pop + dt * 增长                              # 最后一行是结果
 *
 * - 数:1、0.5、1e-3;true / false 当 1 / 0
 * - 名字:字母、汉字、数字、下划线(不以数字开头)。指一张表(这一格的值)、一个常数、一个中间量,
 *   或 dt(这一步过了几年)、year(这一刻是第几年)、col(多栏表里正在算第几栏,0 起)
 * - 点和方括号:表.栏名、表[第几栏]、nb.表(邻格的值,只在 nbsum 这类函数里)、edge.kind(这条邻边的类型)
 * - 运算:+ - * / %(取余)、^(乘方,右结合)、< <= > >= == !=、and or not
 * - 函数:if(条件, 是, 否)(只算用到的那一支)、min、max、clamp、abs、floor、ceil、round、sqrt、exp、log、pow;
 *   邻格:nbsum、nbmean、nbmax、nbmin、nbcount;往下汇总:sumof、meanof、maxof、minof、countof;随机:rand();
 *   编号表:has(x)(有没有,比如有没有归哪个国)。各函数的意思见 compile.ts
 *
 * 换行就是一句话写完;括号里、运算符或逗号后面换行算接着写。
 * 只能读表、做算术、得出一个数:没有循环、没有赋值给表、碰不到网页别的东西,别人分享来的规则也是安全的。
 */

export type Node =
  | { k: 'num'; v: number; at: number }
  | { k: 'name'; name: string; at: number }
  | { k: 'member'; obj: Node; name: string; at: number }
  | { k: 'index'; obj: Node; index: Node; at: number }
  | { k: 'call'; fn: string; args: Node[]; at: number }
  | { k: 'bin'; op: BinOp; a: Node; b: Node; at: number }
  | { k: 'un'; op: '-' | 'not'; a: Node; at: number };

export type BinOp = '+' | '-' | '*' | '/' | '%' | '^' | '<' | '<=' | '>' | '>=' | '==' | '!=' | 'and' | 'or';

export interface Program {
  lets: { name: string; expr: Node; at: number }[];
  result: Node;
}

/** 公式写错了:message 是给人看的中文,at 是出错处在原文里的位置(第几个字,0 起) */
export class FormulaError extends Error {
  constructor(
    message: string,
    readonly at: number,
    readonly source: string,
  ) {
    super(`${message}(${where(source, at)})`);
    this.name = 'FormulaError';
  }
}

/** 位置 → "第 3 行第 5 个字" */
function where(src: string, at: number): string {
  let line = 1;
  let col = 1;
  for (let i = 0; i < at && i < src.length; i++) {
    if (src[i] === '\n') line++, (col = 1);
    else col++;
  }
  return `第 ${line} 行第 ${col} 个字`;
}

type Tok = { t: 'num'; v: number; at: number } | { t: 'name'; v: string; at: number } | { t: 'op'; v: string; at: number } | { t: 'nl'; at: number } | { t: 'end'; at: number };

const OPS = ['<=', '>=', '==', '!=', '+', '-', '*', '/', '%', '^', '<', '>', '(', ')', '[', ']', ',', '.', '=', ';'];
/** 这些后面换行算接着写 */
const CONTINUE = new Set(['+', '-', '*', '/', '%', '^', '<', '<=', '>', '>=', '==', '!=', ',', '(', '[', '=', '.', 'and', 'or', 'not']);
const NAME_START = /[\p{L}_]/u;
const NAME_PART = /[\p{L}\p{N}_]/u;
const KEYWORDS = new Set(['let', 'and', 'or', 'not']);

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let depth = 0;
  let i = 0;
  const last = () => out[out.length - 1];
  while (i < src.length) {
    const ch = src[i];
    if (ch === '#' || (ch === '/' && src[i + 1] === '/')) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '\n') {
      const p = last();
      const cont = !p || p.t === 'nl' || (p.t === 'op' && CONTINUE.has(p.v)) || (p.t === 'name' && CONTINUE.has(p.v));
      if (depth === 0 && !cont) out.push({ t: 'nl', at: i });
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: Number(m[0]), at: i });
      i += m[0].length;
      continue;
    }
    if (NAME_START.test(ch)) {
      let j = i + 1;
      while (j < src.length && NAME_PART.test(src[j])) j++;
      out.push({ t: 'name', v: src.slice(i, j), at: i });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new FormulaError(`认不出「${ch}」`, i, src);
    if (op === '(' || op === '[') depth++;
    else if (op === ')' || op === ']') depth = Math.max(0, depth - 1);
    if (op === ';') {
      if (last()?.t !== 'nl') out.push({ t: 'nl', at: i });
    } else out.push({ t: 'op', v: op, at: i });
    i += op.length;
  }
  out.push({ t: 'end', at: src.length });
  return out;
}

/** 把一段公式拆成语法树;写错了抛 FormulaError */
export function parseFormula(src: string): Program {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const fail = (msg: string, at = peek().at): never => {
    throw new FormulaError(msg, at, src);
  };
  const isOp = (v: string) => {
    const t = peek();
    return t.t === 'op' && t.v === v;
  };
  const isWord = (v: string) => {
    const t = peek();
    return t.t === 'name' && t.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) fail(`这里少了「${v}」`);
    p++;
  };
  const skipNl = () => {
    while (peek().t === 'nl') p++;
  };

  const primary = (): Node => {
    const t = peek();
    if (t.t === 'num') {
      p++;
      return { k: 'num', v: t.v, at: t.at };
    }
    if (t.t === 'name') {
      if (KEYWORDS.has(t.v)) fail(`「${t.v}」不能放在这里`);
      p++;
      if (t.v === 'true' || t.v === 'false') return { k: 'num', v: t.v === 'true' ? 1 : 0, at: t.at };
      if (isOp('(')) {
        p++;
        const args: Node[] = [];
        if (!isOp(')')) {
          for (;;) {
            args.push(expr());
            if (isOp(',')) {
              p++;
              continue;
            }
            break;
          }
        }
        expect(')');
        return { k: 'call', fn: t.v, args, at: t.at };
      }
      return { k: 'name', name: t.v, at: t.at };
    }
    if (t.t === 'op' && t.v === '(') {
      p++;
      const e = expr();
      expect(')');
      return e;
    }
    if (t.t === 'end' || t.t === 'nl') return fail('公式没写完');
    return fail(`这里不该是「${t.t === 'op' ? t.v : ''}」`);
  };
  const postfix = (): Node => {
    let e = primary();
    for (;;) {
      if (isOp('.')) {
        const at = peek().at;
        p++;
        const t = peek();
        if (t.t !== 'name') fail('点后面要跟一个名字');
        p++;
        e = { k: 'member', obj: e, name: (t as { v: string }).v, at };
      } else if (isOp('[')) {
        const at = peek().at;
        p++;
        const index = expr();
        expect(']');
        e = { k: 'index', obj: e, index, at };
      } else return e;
    }
  };
  const unary = (): Node => {
    if (isOp('-')) {
      const at = peek().at;
      p++;
      return { k: 'un', op: '-', a: unary(), at };
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return power();
  };
  const power = (): Node => {
    const a = postfix();
    if (isOp('^')) {
      const at = peek().at;
      p++;
      return { k: 'bin', op: '^', a, b: unary(), at };
    }
    return a;
  };
  const binLevel = (next: () => Node, ops: string[], words = false) => (): Node => {
    let a = next();
    for (;;) {
      const t = peek();
      const op = words ? (t.t === 'name' && ops.includes(t.v) ? t.v : null) : t.t === 'op' && ops.includes(t.v) ? t.v : null;
      if (!op) return a;
      p++;
      a = { k: 'bin', op: op as BinOp, a, b: next(), at: t.at };
    }
  };
  const mul = binLevel(unary, ['*', '/', '%']);
  const add = binLevel(mul, ['+', '-']);
  const cmp = (): Node => {
    const a = add();
    const t = peek();
    if (t.t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(t.v)) {
      p++;
      const b = add();
      const n = peek();
      if (n.t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(n.v)) fail('比较不能连着写,用 and 分开');
      return { k: 'bin', op: t.v as BinOp, a, b, at: t.at };
    }
    return a;
  };
  const not = (): Node => {
    if (isWord('not')) {
      const at = peek().at;
      p++;
      return { k: 'un', op: 'not', a: not(), at };
    }
    return cmp();
  };
  const and = binLevel(not, ['and'], true);
  const or = binLevel(and, ['or'], true);
  const expr = or;

  const lets: Program['lets'] = [];
  skipNl();
  for (;;) {
    if (isWord('let')) {
      const at = peek().at;
      p++;
      const t = peek();
      if (t.t !== 'name' || KEYWORDS.has(t.v)) fail('let 后面要跟一个名字');
      p++;
      expect('=');
      const e = expr();
      lets.push({ name: (t as { v: string }).v, expr: e, at });
      if (peek().t !== 'nl') fail(peek().t === 'end' ? '最后一行要写出结果' : '一行只写一句');
      skipNl();
      if (peek().t === 'end') fail('最后一行要写出结果');
      continue;
    }
    const result = expr();
    skipNl();
    if (peek().t !== 'end') fail(isWord('let') ? '结果要写在最后一行' : '结果只能有一句');
    return { lets, result };
  }
}
