/**
 * 一个世界的 AI 正文怎么改、两份怎么合。纯计算,页面(ai/library.ts)和仓库的后台线程(worldVault.ts)用同一份,两边算出来才一样。
 *
 * 改动按「操作」传,不传整份:仓库里的那份可能比页面里新(别的标签页写过、页面还没读到),整份盖上去会把没读到的盖掉。
 */
import type { AuthorNote } from './gen/worldFormat';

export type NoteOp =
  /** 存一条(同 key 换掉) */
  | { op: 'put'; note: AuthorNote }
  /** 用的人删了一条 */
  | { op: 'del'; key: string }
  /** 整份换成这些(只有读到过仓库里那份才能发:少了的就是真不要了) */
  | { op: 'set'; notes: AuthorNote[] }
  /** 这些并进去,什么都不去掉 */
  | { op: 'merge'; notes: AuthorNote[] };

/** 一条正文缺的字段补成空的:老版本写的、账号同步下来的可能缺,世界文件要求都有(一条缺字段的正文不能让整个文件打不开) */
export const fullNote = <T extends object>(n: T): T => {
  const out = { ...n } as Record<string, unknown>;
  for (const k of ['kind', 'title', 'createdAt', 'provider', 'model']) if (typeof out[k] !== 'string') out[k] = '';
  return out as T;
};

/** 不知道哪来的一份:只留像一条正文的,缺的字段补上 */
export function cleanNoteList(v: unknown): AuthorNote[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x && typeof x.key === 'string' && typeof x.text === 'string').map((x) => fullNote(x as AuthorNote));
}

/** 这一条最近写的是什么时候:同一部书的几版存在一条里,别的几版也算 */
function latestAt(n: AuthorNote): string {
  let t = n.createdAt;
  const others = (n as { others?: unknown }).others;
  if (Array.isArray(others)) for (const v of others) if (v && typeof v.createdAt === 'string' && v.createdAt > t) t = v.createdAt;
  return t;
}

/** a 比 b 新,或者一样新 */
export const notNewer = (b: AuthorNote, a: AuthorNote) => latestAt(a) >= latestAt(b);

/** 两条一模一样 */
export const sameNote = (a: AuthorNote, b: AuthorNote) => a === b || JSON.stringify(a) === JSON.stringify(b);

export const sameNotes = (a: readonly AuthorNote[], b: readonly AuthorNote[]) => a === b || (a.length === b.length && a.every((n, i) => sameNote(n, b[i])));

/** 一部书的一版 */
type AuthorVersion = { createdAt?: unknown; provider?: unknown; model?: unknown; text?: unknown; book?: unknown };

/** 认一版用的:同一时刻、同一家 AI 写的同样长的,算同一版 */
const versionSig = (v: AuthorVersion) => `${String(v.createdAt)}|${String(v.provider)}|${String(v.model)}|${typeof v.text === 'string' ? v.text.length : 0}`;

type Book = AuthorNote & { book?: unknown; others?: unknown; ver?: unknown };

/** 一部书的几版,按写的先后(正在用的那版放在 ver 记的位置,见 ai/history.ts) */
function versionsOf(n: Book): AuthorVersion[] {
  const others: AuthorVersion[] = Array.isArray(n.others) ? n.others.filter(Boolean) : [];
  const at = typeof n.ver === 'number' ? Math.max(0, Math.min(others.length, n.ver - 1)) : others.length;
  return [...others.slice(0, at), { text: n.text, createdAt: n.createdAt, provider: n.provider, model: n.model, book: n.book }, ...others.slice(at)];
}

/**
 * 同一部书的两份:winner 为准,loser 里有、winner 没有的几版也留下,按写的先后排(一部书的几版存在一条里,见 ai/history.ts)。
 * 没有书目信息的(不分版本的正文)就是 winner
 */
function withVersions(winner: Book, loser: Book): AuthorNote {
  if (winner.book === undefined || loser.book === undefined) return winner;
  const mine = versionsOf(winner);
  const have = new Set(mine.map(versionSig));
  const theirs = versionsOf(loser).filter((v) => !have.has(versionSig(v)));
  if (!theirs.length) return winner;
  const cur = versionSig(winner);
  const all = [...mine, ...theirs].sort((a, b) => (String(a.createdAt) < String(b.createdAt) ? -1 : String(a.createdAt) > String(b.createdAt) ? 1 : 0));
  const i = all.findIndex((v) => versionSig(v) === cur);
  return { ...winner, others: all.filter((_, k) => k !== i), ver: i + 1 } as AuthorNote;
}

/**
 * 两份合起来:什么都不去掉。同一条留新的,一样新的留 more 的(先后照 base,新的条排在后面);同一部书两边各有的几版都留。
 * 一条新版本只在一边、删掉的版本还留在另一边这种说不清的,宁可多留
 */
export function mergeNotes(base: readonly AuthorNote[], more: readonly AuthorNote[]): AuthorNote[] {
  const out = new Map(base.map((n) => [n.key, n]));
  for (const n of more) {
    const had = out.get(n.key);
    if (!had) out.set(n.key, n);
    else if (sameNote(had, n)) continue;
    else if (notNewer(had, n)) out.set(n.key, withVersions(n, had));
    else out.set(n.key, withVersions(had, n));
  }
  return [...out.values()];
}

export function applyNoteOps(list: readonly AuthorNote[], ops: readonly NoteOp[]): AuthorNote[] {
  let out = list.slice();
  for (const o of ops) {
    if (o.op === 'put') {
      out = out.filter((n) => n.key !== o.note.key);
      out.push(o.note);
    } else if (o.op === 'del') out = out.filter((n) => n.key !== o.key);
    else if (o.op === 'set') out = o.notes.slice();
    else out = mergeNotes(out, o.notes);
  }
  return out;
}
