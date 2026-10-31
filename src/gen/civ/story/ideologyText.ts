/**
 * 思潮的大事写进编年史(kind = 'thought',标签"思",界面上叫"思潮")。数是 ideology.ts 推出来的,只看,不改历史:
 * - 始倡:每说世上头一回冒出来(那州、那城、那国;IdeoEvent origin):大事(重要度 3)。
 *   "埃维里亚王国国王阿尔努尔夫三世时,克尔顿始倡天命之说,言君权受之于天、守成为上"
 *   (当时没有君主的不写君主:"某国克尔顿始倡……";没有国家的写"某某人克尔顿始倡……";没有城写州名)。
 * - 盛于:一说在一国国中(按人口加权,每 STEP 年一份)头一回过半,那国当时 BIG 州以上:每国每说一条(重要度 2,"全部"里看)。
 *   "律法之说盛于埃维里亚帝国,国中过半从之"。头一回过半时还是小国的,以后不再记。
 * - 渐衰:BIG 州以上的国里,国中最盛的那说(过了 LEAD 才算)被别的说压过 —— 压过 OVERTAKE,或连着 HOLD 年压着 —— 记一条(重要度 2):
 *   "埃维里亚帝国天命之说渐衰,律法之说代兴"。门槛是免得两说相持时来回记;小国里最盛的换了不记,只记下现在是哪说(长成大国时不补记老账)。
 * 盛于、渐衰记在国中那一份的年份上;国名用当年的国号。纯计算,主线程用。
 */
import type { Civ, Year } from '../types';
import type { ChronicleEntry, Importance } from './chronicle';
import { polityName } from '../growth';
import { regionLabel } from './display';
import { rulerAt } from './peopleInfo';
import { rulerBare } from './peopleText';
import { ownersAt, type Owners } from '../engine/timeline';
import { IDEO_SCALE, THOUGHTS, THOUGHT_COUNT } from '../ideology';
import { tradeEntries } from './tradeText';

/** 一字标签(界面上的类型名见 timelineLayout.ts 的 TAG_LABEL:思潮) */
export const THOUGHT_TAG = '思';

/** 国中每多少年一份(ideology.ts 的 STEP) */
const STEP = 20;
/** 盛于、渐衰只记这么多州以上的国 */
const BIG = 20;
/** 国中过了这么多才算"最盛的那说" */
const LEAD = 0.3;
/** 压过几个百分点算代兴;不到的话连着压这么多年也算 */
const OVERTAKE = 0.05;
const HOLD = 40;
/** 过半 */
const HALF = 0.5;

/** 主张写进句子:"君权受之于天、守成为上" */
const sayOf = (k: number) => THOUGHTS[k].say.replace(/[,，]/g, '、');

const cache = new WeakMap<Civ, ChronicleEntry[]>();

/** 盛于 / 渐衰的候选(还没看国家大小) */
interface Cand {
  kind: 'rise' | 'fade';
  year: Year;
  polity: number;
  /** 盛于:哪一说;渐衰:衰的那说 */
  thought: number;
  /** 渐衰:代兴的那说 */
  by: number;
}

/** 一国国中各说的走势里找盛于、渐衰(候选,按年份) */
function polityCands(civ: Civ, p: number, out: Cand[]): void {
  const s = civ.ideology?.polities[p];
  if (!s) return;
  const K = THOUGHT_COUNT;
  const v = s.v;
  const n = v.length / K;
  const half = new Uint8Array(K);
  let lead = -1;
  let chal = -1;
  let chalFrom = 0;
  for (let i = 0; i < n; i++) {
    const y = s.from + i * STEP;
    const at = i * K;
    let any = false;
    let best = -1;
    for (let k = 0; k < K; k++) {
      const a = v[at + k];
      if (a > 0) any = true;
      if (!half[k] && a >= HALF * IDEO_SCALE) {
        half[k] = 1;
        out.push({ kind: 'rise', year: y, polity: p, thought: k, by: k });
      }
      if (a > LEAD * IDEO_SCALE && (best < 0 || a > v[at + best])) best = k;
    }
    // 中间亡过国的那几份是 0:复国以后重新看
    if (!any) {
      lead = chal = -1;
      continue;
    }
    if (best < 0) {
      chal = -1;
      continue;
    }
    if (lead < 0 || best === lead) {
      lead = best;
      chal = -1;
      continue;
    }
    if (chal !== best) {
      chal = best;
      chalFrom = y;
    }
    if (v[at + best] - v[at + lead] >= OVERTAKE * IDEO_SCALE || y - chalFrom >= HOLD) {
      out.push({ kind: 'fade', year: y, polity: p, thought: lead, by: best });
      lead = best;
      chal = -1;
    }
  }
}

/**
 * 思潮的大事 → 编年史条目(按年份排好)。id 接在史事、人物、宗教大事、时代和物产大事、商道后面(不和它们撞);没有思潮 = 空数组。按 civ 缓存
 */
export function ideologyEntries(civ: Civ): ChronicleEntry[] {
  const hit = cache.get(civ);
  if (hit) return hit;
  const out: ChronicleEntry[] = [];
  const ideo = civ.ideology;
  if (ideo) {
    let id = (civ.annals?.length ?? 0) + (civ.people?.length ?? 0) + (civ.religion?.events.length ?? 0) + (civ.development?.events.length ?? 0);
    for (const e of tradeEntries(civ)) {
      id = Math.max(id, e.id + 1);
      for (const c of e.children ?? []) id = Math.max(id, c.id + 1);
    }
    const pn = (p: number, y: Year) => (p >= 0 && civ.polities[p] ? polityName(civ.polities[p], y) || civ.polities[p].name : '');
    const entry = (year: Year, thought: number, text: string, importance: Importance, polities: number[], regions: number[], settlement: number): ChronicleEntry => ({
      id: id++,
      kind: 'thought',
      year,
      end: year,
      text,
      tag: THOUGHT_TAG,
      importance,
      polities,
      regions,
      settlement,
      thought,
    });
    // 始倡
    for (const e of ideo.events) {
      if (e.kind !== 'origin' || !THOUGHTS[e.thought]) continue;
      const place = civ.settlements[e.settlement]?.name || (e.region >= 0 ? regionLabel(civ, e.region) : '');
      const who = pn(e.polity, e.year) || (e.culture >= 0 && civ.cultures[e.culture]?.name ? `${civ.cultures[e.culture].name}人` : '');
      const ruler = e.polity >= 0 && civ.people?.length ? rulerAt(civ, e.polity, e.year) : null;
      const head = ruler ? `${who}${rulerBare(civ, ruler, e.year)}时,${place}` : `${who}${place}`;
      const x = entry(e.year, e.thought, `${head}始倡${THOUGHTS[e.thought].name},言${sayOf(e.thought)}`, 3, e.polity >= 0 ? [e.polity] : [], e.region >= 0 ? [e.region] : [], e.settlement);
      if (ruler) x.people = [ruler.id];
      out.push(x);
    }
    // 盛于、渐衰:先找候选,再按那一年的国土大小筛
    const cands: Cand[] = [];
    for (let p = 0; p < ideo.polities.length; p++) polityCands(civ, p, cands);
    cands.sort((a, b) => a.year - b.year || a.polity - b.polity || a.thought - b.thought);
    let own: Owners | undefined;
    let ownYear = NaN;
    let size = new Int32Array(0);
    for (const c of cands) {
      if (c.year !== ownYear) {
        own = ownersAt(civ, c.year, own);
        ownYear = c.year;
        size = new Int32Array(civ.polities.length);
        for (const q of own.polity) if (q >= 0) size[q]++;
      }
      if (size[c.polity] < BIG) continue;
      const name = pn(c.polity, c.year);
      if (!name) continue;
      const text = c.kind === 'rise' ? `${THOUGHTS[c.thought].name}盛于${name},国中过半从之` : `${name}${THOUGHTS[c.thought].name}渐衰,${THOUGHTS[c.by].name}代兴`;
      out.push(entry(c.year, c.by, text, 2, [c.polity], [], -1));
    }
    out.sort((a, b) => a.year - b.year || a.id - b.id);
  }
  cache.set(civ, out);
  return out;
}
