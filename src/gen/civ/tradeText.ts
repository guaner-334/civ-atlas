/**
 * 商道(trade.ts)的文字:货名、哪一年怎么样,编年史里的通、断、复通、废(和现有纪事一样用半角逗号)。
 *
 *   通    "萨巴兰王国自大定王朝万兴郡运铁,万兴西道通"(产地没有国家:"萨巴兰王国自万兴郡运铁,万兴西道通")
 *   断    "大定王朝与萨巴兰王国交兵,万兴西道、拉沙金道断"(同一仗、同一年断的几条写在一句里;不是宣战断的:"万兴西道断")
 *   复通  "大定王朝与萨巴兰王国议和,万兴道复通" / "万兴道复通"
 *   废    "萨巴兰王国亡,万兴西道、拉沙金道废"(同一国同一年);"萨巴兰王国境内自产铁,万兴西道废";"萨巴兰王国不复求铜锡,某道废";"万兴道商旅渐稀而废";"万兴道废"
 *
 * 编年史里都是小事(重要度 1,只在「全部」里),kind = 'era'(和时代、物产一类),标签"商"(界面上叫"商道")。
 * 纯函数,主线程用。
 */
import type { Annal, Civ, Year } from './types';
import type { ChronicleEntry } from './chronicle';
import type { TradeEvent, TradeRoute } from './trade';
import { capitalAt, polityName } from './growth';
import { regionLabel } from './display';
import { ownersAt, type Owners } from './timeline';

/** 编年史的标签 */
export const TRADE_TAG = '商';

/** 货名(物产下标 → 界面上的叫法;牲畜在商道里只算马)。下标同 development.ts 的 Res(装载时就要用,写成数) */
export const GOOD_NAME: Readonly<Record<number, string>> = { 6: '盐', 3: '铁', 1: '马', 10: '金银', 2: '铜锡', 4: '煤', 8: '石油', 9: '稀有矿' };

/** year 这一年运的货(还没通 = 开通时运的;废了 = 废前运的),按开始运的先后 */
export function goodsAt(r: TradeRoute, year: Year): number[] {
  const open = r.events[0]?.year ?? 0;
  const y = Math.max(open, Math.min(year, lastYear(r)));
  let on = r.goods.filter((g) => g.from <= y && (g.until === undefined || g.until > y));
  // 废的那一年:废以前运的那几样
  if (!on.length) on = r.goods.filter((g) => g.from <= y && g.until === y);
  if (!on.length) on = r.goods;
  return on.map((g) => g.res).filter((g, i, a) => a.indexOf(g) === i);
}

/** 货名连起来:"盐、马" */
export function goodsText(goods: readonly number[]): string {
  return goods.map((g) => GOOD_NAME[g] ?? '货').join('、');
}

/** 最后一件事的年份(废了 = 废的那年;没废 = Infinity) */
function lastYear(r: TradeRoute): Year {
  const e = r.events[r.events.length - 1];
  return e && e.kind === 'end' ? e.year : Infinity;
}

/** 这一年的通断:通 / 断 / 废 / 还没通,和那件事 */
export function tradeStateAt(r: TradeRoute, year: Year): { state: 'open' | 'broken' | 'ended' | 'before'; event: TradeEvent | null } {
  let ev: TradeEvent | null = null;
  for (const e of r.events) {
    if (e.year > year) break;
    ev = e;
  }
  if (!ev) return { state: 'before', event: null };
  return { state: ev.kind === 'break' ? 'broken' : ev.kind === 'end' ? 'ended' : 'open', event: ev };
}

/** 史事里的宣战:战争编号 → 那一条 */
const warCache = new WeakMap<Civ, Map<number, Annal>>();
export function warAnnal(civ: Civ, war: number): Annal | undefined {
  let m = warCache.get(civ);
  if (!m) {
    m = new Map();
    for (const e of civ.annals) if (e.kind === 'war' && !m.has(e.war)) m.set(e.war, e);
    warCache.set(civ, m);
  }
  return m.get(war);
}

/** 交兵的两国:"大定王朝与萨巴兰王国"(按宣战那年的国号) */
export function warPair(civ: Civ, war: number): string {
  const w = warAnnal(civ, war);
  if (!w) return '';
  const a = civ.polities[w.a];
  const b = civ.polities[w.b];
  return a && b ? `${polityName(a, w.year)}与${polityName(b, w.year)}` : '';
}

/** 买方国都(这一年的;没有 = −1) */
export function tradeCapital(civ: Civ, r: TradeRoute, year: Year): number {
  const p = civ.polities[r.buyer];
  return p ? capitalAt(p, year) : -1;
}

const pName = (civ: Civ, p: number, y: Year) => (civ.polities[p] ? polityName(civ.polities[p], y) : '');

const cache = new WeakMap<Civ, ChronicleEntry[]>();

/**
 * 商道的通、断、复通、废 → 编年史条目(按年份排好)。kind = 'era',标签"商",重要度 1;trade = 哪几条商道。
 * id = 史事条数 + 人物数 + 宗教大事数 + 时代和物产大事数 + 第几件(不和别的撞)。没有商道 = 空数组。按 civ 缓存
 */
export function tradeEntries(civ: Civ): ChronicleEntry[] {
  const hit = cache.get(civ);
  if (hit) return hit;
  const out: ChronicleEntry[] = [];
  const T = civ.trade;
  if (T) {
    const n0 = (civ.annals?.length ?? 0) + (civ.people?.length ?? 0) + (civ.religion?.events.length ?? 0) + (civ.development?.events.length ?? 0);
    // 每件事:哪条商道、第几件;按年份排(同一年按商道编号)
    const all: { r: TradeRoute; e: TradeEvent; i: number }[] = [];
    for (const r of T.routes) r.events.forEach((e, i) => all.push({ r, e, i }));
    all.sort((a, b) => a.e.year - b.e.year || a.r.id - b.r.id || a.i - b.i);
    let own: Owners | undefined;
    let ownYear = NaN;
    let k = 0;
    const base = (e: TradeEvent, rs: TradeRoute[], text: string, polities: number[]): ChronicleEntry => {
      const cap = tradeCapital(civ, rs[0], e.year);
      return {
        id: n0 + k++,
        kind: 'era',
        year: e.year,
        end: e.year,
        text,
        tag: TRADE_TAG,
        importance: 1,
        polities: polities.filter((p, i, a) => p >= 0 && a.indexOf(p) === i),
        regions: rs.map((r) => r.from),
        settlement: cap,
        trade: rs.map((r) => r.id),
      };
    };
    const names = (rs: TradeRoute[]) => rs.map((r) => r.name).join('、');
    for (let i = 0; i < all.length; i++) {
      const { r, e } = all[i];
      // 同一年、同一个缘故的几条并成一句:同一仗断 / 复通、同一国亡而废
      const group = [r];
      const same = (x: (typeof all)[number]) =>
        x.e.year === e.year &&
        x.e.kind === e.kind &&
        ((e.kind === 'break' && e.war !== undefined && x.e.war === e.war) ||
          (e.kind === 'reopen' && e.war !== undefined && x.e.war === e.war) ||
          (e.kind === 'end' && e.why === 'fall' && x.e.why === 'fall' && x.r.buyer === r.buyer));
      while (i + 1 < all.length && same(all[i + 1])) group.push(all[++i].r);
      const buyer = pName(civ, r.buyer, e.year);
      if (e.kind === 'open') {
        if (ownYear !== e.year) own = ownersAt(civ, (ownYear = e.year), own);
        const q = own!.polity[r.from] ?? -1;
        const from = q >= 0 && q !== r.buyer ? `${pName(civ, q, e.year)}${regionLabel(civ, r.from)}` : regionLabel(civ, r.from);
        out.push(base(e, group, `${buyer}自${from}运${goodsText(goodsAt(r, e.year))},${r.name}通`, [r.buyer, q]));
      } else if (e.kind === 'break' || e.kind === 'reopen') {
        // 相关国家:并进来的各条的买方、交兵的两国
        const w = e.war !== undefined ? warAnnal(civ, e.war) : undefined;
        const ps = [...group.map((x) => x.buyer), ...(w ? [w.a, w.b] : [e.foe ?? -1])];
        const pair = e.war !== undefined ? warPair(civ, e.war) : '';
        const what = e.kind === 'break' ? '断' : '复通';
        out.push(base(e, group, pair ? `${pair}${e.kind === 'break' ? '交兵' : '议和'},${names(group)}${what}` : `${names(group)}${what}`, ps));
      } else {
        const text =
          e.why === 'fall'
            ? `${buyer}亡,${names(group)}废`
            : e.why === 'gain'
              ? `${buyer}境内自产${goodsText(goodsAt(r, e.year))},${r.name}废`
              : e.why === 'need'
                ? `${buyer}不复求${goodsText(goodsAt(r, e.year))},${r.name}废`
              : e.why === 'fade'
                ? `${r.name}商旅渐稀而废`
                : `${r.name}废`;
        out.push(base(e, group, text, [r.buyer]));
      }
    }
  }
  cache.set(civ, out);
  return out;
}

/** 一条商道的大事(编年史里写到它的那几条,按年份) */
export function tradeHistory(civ: Civ, id: number): ChronicleEntry[] {
  return tradeEntries(civ).filter((e) => e.trade?.includes(id));
}
