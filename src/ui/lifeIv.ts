/**
 * 作者的人物「一生」里一段经历进推演(人物卡每段经历右边的「进推演…」,CharacterPanel.tsx;选一种的那一页 LifeIvPage.tsx):
 *
 * - 他本人的六种(即位、自立、为将、出征、为臣、掌权):打开人物卡上现成的那一页(CrownPage.tsx、AuthorIvPages.tsx),
 *   年份照这段经历、国家照他那年的身份(lifePolity)先填好,页顶「照这段经历填好了」(LifeHead.tsx)。
 * - 国家的事十种(结盟、立约、划中立地、迁都、划州、灭国、立国、方针、天灾、大迁徙),记在他名下:换到那一国(划州、立国换到那一州)
 *   现成的那一页,年份、国家照样先填好;这时候下的令带 author = 他(gen/edits.ts 的 AUTHOR_IV_KINDS;推演不看它,
 *   编年史这一条后面写"(林小满之议)",单子上写"（林小满之议）")。开着的那一页记在 lifeTag.ts,页顶同样写「照这段经历填好了」,
 *   那一页关掉(返回、选了别的)就收起。
 * - 先不能的三行(议和、称臣、改朝换代、民变;联姻;他的生死):灰着写原因。
 *
 * 每段经历下面的状态(lifeStatuses):他名下的令(即位、任将任臣掌权、点他挂帅的宣战、记在他名下的国家的事)按生效那年对上那一段经历 ——
 * "待推演：…" / "下一步生效：…"(还在单子里)、"已进推演：林小满为大衍王朝将，2421–2442 年""已进推演：林小满入大衍王朝为臣"、"没生效：…（原因）"。
 * 纯计算,不碰 DOM。
 */
import type { Civ } from '../gen/civ/types';
import { polityAlive } from '../gen/civ/growth';
import { interventionFate } from '../gen/stepwise';
import type { Intervention } from '../gen/edits';
import { eraText, yearAt, yearSpanAt, type Era } from '../gen/era';
import type { Pending } from './pendingStore';
import type { CrownState } from './crownInfo';
import { AUTHOR_HOW_NAMES, polityNameAt, type PostState } from './authorIvInfo';

/** 他本人的六种 */
export type LifeSelfKind = 'crown' | 'found' | 'general' | 'send' | 'minister' | 'regent';
import type { LifeNationKind } from './lifeTag';

/** 他本人的六种:名字、一句说明(他 / 她按人物卡) */
export const LIFE_SELF: readonly { k: LifeSelfKind; name: string; desc: (he: string) => string }[] = [
  { k: 'crown', name: '即位', desc: () => '即一国君位' },
  { k: 'found', name: '自立', desc: (he) => `据一州立国，${he}当开国之君` },
  { k: 'general', name: '为将', desc: () => '当一国将领' },
  { k: 'send', name: '出征', desc: (he) => `一国宣战，${he}挂帅` },
  { k: 'minister', name: '为臣', desc: () => '入朝当名臣' },
  { k: 'regent', name: '掌权', desc: (he) => `名义上的君主照旧在位，政出于${he}` },
];

export const LIFE_NATION: readonly { k: LifeNationKind; name: string }[] = [
  { k: 'ally', name: '结盟' },
  { k: 'treaty', name: '立约' },
  { k: 'neutral', name: '划中立地' },
  { k: 'move', name: '迁都' },
  { k: 'cede', name: '划州' },
  { k: 'destroy', name: '灭国' },
  { k: 'found', name: '立国' },
  { k: 'policy', name: '方针' },
  { k: 'disaster', name: '天灾' },
  { k: 'trek', name: '大迁徙' },
];

/** 先不能进推演的三行:名字、原因(他 / 她按人物卡) */
export const LIFE_OFF: readonly { name: (he: string) => string; why: (he: string) => string }[] = [
  { name: () => '议和、称臣、改朝换代、民变', why: () => '推演里还不能直接让这几样发生（大纲里也只能查、不能改）' },
  { name: () => '联姻', why: () => '作者的人物联姻还没做：现在只认推演里的宗室' },
  { name: (he) => `${he}的生死`, why: (he) => `生卒在人物卡上改：卒年就是${he}去世那年，在任的到那年为止` },
];

// ---------------------------------------------------------------------------
// 每段经历下面的状态

export interface LifeStatus {
  /** queued 还在单子里(step = 逐年推演的下一步生效)/ done 已进推演 / void 没生效 */
  state: 'queued' | 'done' | 'void';
  step?: boolean;
  text: string;
}

/** 这一条是不是人物 id 名下的(即位、任将任臣掌权、点他挂帅的宣战、记在他名下的国家的事) */
export function isLifeIvOf(v: Intervention, id: number): boolean {
  if (v.author === id) return true;
  if (v.kind === 'crown' || v.kind === 'appoint') return v.char === id;
  if (v.kind === 'regent') return v.char === id;
  return v.kind === 'declare' && v.lead === id;
}

/** 状态那一行的字:"已进推演：…" / "待推演：…" / "下一步生效：…" / "没生效：…" */
export function lifeStatusText(s: LifeStatus): string {
  const head = s.state === 'done' ? '已进推演' : s.state === 'void' ? '没生效' : s.step ? '下一步生效' : '待推演';
  return `${head}：${s.text}`;
}

/**
 * 人物 id 名下的令,按生效那一年(整年)分好:年份 → 几行状态(先后照单子、推过的顺序)。
 * crowns / posts = crownInfo.ts 的 characterCrowns、authorIvInfo.ts 的 characterPosts(同一份参数算的);
 * text = 一条干预的说法(Interventions.tsx 的 interventionText;i = 它在这份历史里是第几条)
 */
export function lifeStatuses(
  civ: Civ,
  id: number,
  name: string,
  pending: readonly Pending[],
  crowns: readonly CrownState[],
  posts: readonly PostState[],
  step: boolean,
  era: Era | undefined,
  text: (v: Intervention, i: number) => string,
): Map<number, LifeStatus[]> {
  const out = new Map<number, LifeStatus[]>();
  const put = (from: number, s: LifeStatus) => {
    const y = Math.floor(from);
    const l = out.get(y);
    if (l) l.push(s);
    else out.set(y, [s]);
  };
  const span = (from: number, until: number | undefined) => (until !== undefined ? yearSpanAt(from, until, era) : `${yearAt(from, era)}起`);
  // 推过的:即位、任将任臣掌权照人物卡上那几块的结果,别的照这份历史里那一条的结局
  const ivs = civ.interventions ?? [];
  ivs.forEach((v, i) => {
    if (!isLifeIvOf(v, id)) return;
    if (v.kind === 'crown') {
      const st = crowns.find((s) => s.kind !== 'queued' && JSON.stringify(s.v) === JSON.stringify(v));
      if (!st || st.kind === 'queued') return;
      const P = st.kind === 'done' ? civ.polities[st.x.polity] : undefined;
      if (st.kind === 'done') put(v.from, { state: 'done', text: `${name}即${P ? polityNameAt(P, st.x.from ?? v.from) : '一国'}君位，${span(st.x.from ?? v.from, st.x.until)}` });
      else put(v.from, { state: 'void', text: `${text(v, i)}（${st.why}）` });
      return;
    }
    if (v.kind === 'appoint' || (v.kind === 'regent' && v.char !== undefined)) {
      const st = posts.find((s) => s.kind !== 'queued' && JSON.stringify(s.v) === JSON.stringify(v));
      if (!st || st.kind === 'queued') return;
      if (st.kind === 'void') return put(v.from, { state: 'void', text: `${text(v, i)}（${st.why}）` });
      const from = st.g ? st.g.from : (st.x.from ?? v.from);
      const until = st.g ? st.g.until : st.x.until;
      const what =
        v.kind === 'regent' ? `${name}以${AUTHOR_HOW_NAMES[v.how]}掌${st.A}国政` : v.role === 'minister' ? `${name}入${st.A}为臣` : `${name}为${st.A}将`;
      // 照稿子:为将、掌权写起止年份,为臣只写入了哪国的朝(在朝几年见下面「为臣」一块)
      return put(v.from, { state: 'done', text: v.kind === 'appoint' && v.role === 'minister' ? what : `${what}，${span(from, until)}` });
    }
    const f = interventionFate(civ, i);
    if (f.state === 'later') return;
    put(v.from, f.state === 'void' ? { state: 'void', text: `${text(v, i)}（${eraText(f.why, era)}）` } : { state: 'done', text: text(v, i) });
  });
  // 还在单子里的
  for (const p of pending) if (p.kind === 'iv' && isLifeIvOf(p.v, id)) put(p.v.from, { state: 'queued', step, text: p.text });
  return out;
}

/** 他那年的国家:那年在位、在任(将相、掌权)的那国;都没有 = 人物卡上他的国家(那年还在才算);都没有 = −1 */
export function lifePolity(civ: Civ, crowns: readonly CrownState[], posts: readonly PostState[], home: number, year: number): number {
  for (const s of crowns) if (s.kind === 'done' && (s.x.from ?? Infinity) <= year && (s.x.until === undefined || s.x.until > year)) return s.x.polity;
  for (const s of posts) {
    if (s.kind !== 'done') continue;
    const from = s.g ? s.g.from : (s.x.from ?? s.v.from);
    const until = s.g ? s.g.until : s.x.until;
    if (from <= year && (until === undefined || until > year)) return s.x.polity;
  }
  const P = home >= 0 ? civ.polities[home] : undefined;
  return P && polityAlive(P, year) ? home : -1;
}
