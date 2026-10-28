/**
 * 立约与中立地在卡片上的写法:国家卡片「立约」「中立地」两行、条约卡片(TreatyPanel.tsx)、
 * 中立地那一州的卡片(RegionPanel.tsx)、人物卡「放逐」(PersonPanel.tsx)。数据全按史事整理(gen/civ/treatyInfo.ts),不改推演。
 */
import type { Annal, Civ, ExileTie, Person, Year } from '../gen/civ/types';
import { cnNumber, exiledTo, type ChronicleEntry } from '../gen/civ/chronicle';
import { polityAlive, polityName } from '../gen/civ/growth';
import { yearAt, type Era } from '../gen/era';
import { treatyBook, zonesAt, type TreatyInfo, type ZoneInfo } from '../gen/civ/treatyInfo';

/** 约的种类:"有限竞争之约"(三国以上)/ "互不侵犯之约" */
export const treatyKindWord = (x: TreatyInfo): string => (x.kind === 'limited' ? '有限竞争之约' : '互不侵犯之约');

/** 几国:"两国""三国" */
export const nationsWord = (n: number): string => `${n === 2 ? '两' : cnNumber(n)}国`;

/** 期限(年):"二十年" */
export const termWord = (n: number): string => `${cnNumber(n)}年`;

/** 这份约在 year 那一刻的这一期:约里的几国(立约或最近那次续约时的)、这一期从哪年起、几年、到哪年(期限 0 = 一直有效,到 Infinity) */
export function treatyPeriod(x: TreatyInfo, year: Year): { parties: number[]; from: Year; term: number; until: Year } {
  let parties = x.parties;
  let from = x.start;
  let term = x.term;
  for (const r of x.renewals) {
    if (r.year > year) break;
    parties = r.parties;
    from = r.year;
    term = r.term;
  }
  return { parties, from, term, until: term > 0 ? from + term : Infinity };
}

/** 到哪年:"到 2330 年";一直有效的约 = "一直有效" */
export function untilText(until: Year, era?: Era | null): string {
  return Number.isFinite(until) ? `到 ${yearAt(until, era)}` : '一直有效';
}

/** 国家 p 在 year 那一刻参与共建的中立地 */
export function zonesOfAt(civ: Civ, p: number, year: Year): ZoneInfo[] {
  return zonesAt(civ, year).filter((z) => z.founders.includes(p));
}

/** 州 r 在 year 那一刻是不是中立地(是 = 那处中立地) */
export function zoneOfRegionAt(civ: Civ, r: number, year: Year): ZoneInfo | null {
  return zonesAt(civ, year).find((z) => z.region === r) ?? null;
}

/** 州 r 做过的中立地(按设立先后) */
export function zonesOfRegion(civ: Civ, r: number): ZoneInfo[] {
  return treatyBook(civ).zones.filter((z) => z && z.region === r);
}

/** 共建几国的颜色(按共建先后;国家找不到的跳过;一国也没有 = 一种灰) */
export function zoneColors(civ: Civ, z: ZoneInfo): [number, number, number][] {
  const out = z.founders.map((p) => civ.polities[p]?.color).filter((c): c is [number, number, number] => !!c);
  return out.length ? out : [[150, 140, 128]];
}

/** 卡片上的细横纹(色块、历任归属里中立地那一段):几国颜色每道 2 像素轮着来,和地图上一样是横的 */
export function zoneStripeCss(colors: readonly (readonly number[])[]): string {
  const stops = colors.map((c, i) => `rgb(${c.join(',')}) ${i * 2}px ${i * 2 + 2}px`).join(', ');
  return `repeating-linear-gradient(180deg, ${stops})`;
}

/** 放逐 / 出奔到中立地的人是不是死在那里(中立地撤销以前去世的;出奔邻国的不算) */
export function diedInExile(x: Person): boolean {
  const e = x.exile;
  return !!e && e.to === undefined && x.died !== undefined && x.died >= e.year && (e.until === undefined || x.died <= e.until);
}

/** 出奔邻国的人去的那国在 year 年的国名(不是出奔邻国的 = 空串) */
export function exileHostName(civ: Civ, x: Person, year: Year): string {
  const H = x.exile?.to !== undefined ? civ.polities[x.exile.to] : undefined;
  return H ? polityName(H, year) || H.name || '' : '';
}

/** 出奔邻国的人是不是卒于那国(去世时那国还在) */
export function diedAbroad(civ: Civ, x: Person): boolean {
  const e = x.exile;
  const H = e?.to !== undefined ? civ.polities[e.to] : undefined;
  return !!H && x.died !== undefined && x.died >= e!.year && polityAlive(H, x.died);
}

/** 投奔邻国的缘由怎么说(灭他之国的敌国另写;别的邻国不写) */
const TIE_WORD: Record<ExileTie, string> = { kin: '姻亲之国', ally: '盟国', pact: '同约之国', folk: '同族之国', foe: '', near: '' };

/**
 * 人物卡「出奔」一行小字里的缘由:"投奔盟国""投奔佩罗斯王国的敌国"(写出灭他的国家);
 * 去的是别的邻国、不是出奔邻国的 = 空串
 */
export function exileTieText(civ: Civ, x: Person): string {
  const e = x.exile;
  if (!e || e.to === undefined || !e.tie) return '';
  if (e.tie !== 'foe') return TIE_WORD[e.tie] ? `投奔${TIE_WORD[e.tie]}` : '';
  // 灭他的国家:同一刻那条亡国史事里的攻方
  const home = civ.annals[e.annal]?.a ?? x.polity;
  const fall = civ.annals.find((a) => a.kind === 'fall' && a.a === home && a.b >= 0 && Math.abs(a.year - e.year) < 1e-6);
  const P = fall ? civ.polities[fall.b] : undefined;
  const name = P ? polityName(P, e.year) || P.name : '';
  return name ? `投奔${name}的敌国` : '';
}

/**
 * 出奔邻国的末代之君,日后故国宗室从他去的那国回来复国的那几条(编年史写"故某宗室某某自某国还,……复国"的):
 * 返回 [那一条, 编年史里点哪一条](并在大崩解里的,点大崩解那一条)
 */
export function exileReturns(civ: Civ, x: Person, all: readonly ChronicleEntry[]): [ChronicleEntry, ChronicleEntry][] {
  const e = x.exile;
  if (!e || e.to === undefined) return [];
  const home = civ.annals[e.annal]?.a ?? x.polity;
  const out: [ChronicleEntry, ChronicleEntry][] = [];
  for (const c of all) {
    for (const s of [c, ...(c.children ?? [])]) {
      if (s.kind !== 'split' || s.year < e.year || !s.people?.length) continue;
      if (civ.polities[s.polities[0]]?.restores !== home || s.polities[1] === e.to) continue;
      if (exiledTo(civ, home, s.year) === e.to) out.push([s, c]);
    }
  }
  return out;
}

/** year 那一刻住在中立地 z 的人:已经徙来、还活着(中立地还在,这一刻才算) */
export function zoneResidentsAt(civ: Civ, z: ZoneInfo, year: Year): Person[] {
  const out: Person[] = [];
  for (const id of z.residents) {
    const x = civ.people?.[id];
    const e = x?.exile;
    if (!x || !e || e.year > year || (x.died !== undefined && x.died <= year) || (e.until !== undefined && e.until <= year)) continue;
    out.push(x);
  }
  return out;
}

/**
 * 和这份约有关的大事(编年史里的条目,按先后):立约、续约、背约、约满 / 约废,它的中立地设立、撤销,徙居、出奔那里的人。
 * all = 整份编年史(fullChronicle)
 */
export function treatyEntries(civ: Civ, x: TreatyInfo, all: readonly ChronicleEntry[]): ChronicleEntry[] {
  const A = civ.annals;
  const zone = x.zone;
  return all.filter((e) => {
    const a = A[e.id];
    if (!a || a.kind !== e.kind) return false;
    // 作者下令立的约、划的中立地并进了干预那一条(紧跟在它后面记的)
    if (a.kind === 'intervene') return decreeHits(civ, e.id, (n) => (n.kind === 'treaty' && n.war === x.id) || (n.kind === 'neutral' && (n.n === x.id || (zone >= 0 && n.war === zone))));
    switch (a.kind) {
      case 'treaty':
      case 'expire':
        return a.war === x.id;
      case 'breach':
        return a.n === x.id;
      case 'neutral':
        return a.cause === 'lapse' ? zone >= 0 && a.war === zone : a.n === x.id;
      case 'exile':
        return zone >= 0 && a.war === zone;
      default:
        return false;
    }
  });
}

/** 和这处中立地有关的大事:设立(作者下令划的:干预那一条)、撤销、徙居、出奔那里的人(按先后) */
export function zoneEntries(civ: Civ, z: ZoneInfo, all: readonly ChronicleEntry[]): ChronicleEntry[] {
  const A = civ.annals;
  return all.filter((e) => {
    const a = A[e.id];
    if (!a || a.kind !== e.kind) return false;
    if (a.kind === 'intervene') return decreeHits(civ, e.id, (n) => n.kind === 'neutral' && n.war === z.id);
    return (a.kind === 'neutral' || a.kind === 'exile') && a.war === z.id;
  });
}

/** 第 id 条史事(干预)紧跟着记的作者下令立的约、划的中立地(cause = decree,同一刻)里有没有合 hit 的 */
function decreeHits(civ: Civ, id: number, hit: (n: Annal) => boolean): boolean {
  const A = civ.annals;
  for (let k = id + 1; k < A.length && A[k].year === A[id].year && (A[k].kind === 'treaty' || A[k].kind === 'neutral') && A[k].cause === 'decree'; k++) if (hit(A[k])) return true;
  return false;
}
