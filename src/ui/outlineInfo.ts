/**
 * 大纲的说法(界面上各处共用:概览「大纲」页、侧栏「大纲」一组、「我的干预」照大纲一组):
 * 情节的种类、时间、谁、推完怎么查、批改的结果;点一条到地图上时小牌子上的一句、立在哪。年份一律写成"第 N 年",显示时按纪年换写法(gen/era.ts 的 eraText)。
 * 国家、州、城、人物按稳定键在这份历史里解析(格式见 gen/edits.ts 文件头"大纲");`plot:编号` = 那一条立起来的国家(看批改)。
 * 纯计算,不碰 DOM。
 */
import type { Civ } from '../gen/civ/types';
import { regionLabel } from '../gen/civ/display';
import { personName } from '../gen/civ/peopleText';
import { capitalAt } from '../gen/civ/growth';
import {
  DISASTER_LEVEL_NAMES,
  DISASTER_NAMES,
  PLOT_CHECK_ONLY,
  PLOT_SPAN_DEFAULT,
  OUTLINE_ALLY_YEARS,
  keyCells,
  parsePersonKey,
  regionOfKey,
  resolveKey,
  resolvePersonKey,
  type AuthorMark,
  type Intervention,
  type Plot,
  type PlotKind,
  type PlotReview,
  type PlotStatus,
} from '../gen/edits';
import type { AuthorCharacter } from '../gen/characters';
import { entryInvolves, type ChronicleEntry } from '../gen/civ/chronicle';
import type { DirectorPlot } from './directorPlan';
import { nameAt } from './Interventions';
import { yearAt, type Era } from '../gen/era';

/** 种类的名字、一句说明(编一行时选种类那一栏) */
export const PLOT_KIND_INFO: Record<PlotKind, { name: string; desc: string }> = {
  found: { name: '立国', desc: '在某州立一国，可以起名' },
  fall: { name: '亡国', desc: '某国亡，可以写亡于谁' },
  hold: { name: '占据一片地方', desc: '某国占下作者标记圈的地方，或现圈几州' },
  war: { name: '开战', desc: '某国攻某国' },
  ally: { name: '结盟', desc: '两国结盟' },
  capital: { name: '迁都', desc: '某国迁都到某城' },
  death: { name: '君主去世', desc: '推演里的君主去世' },
  crown: { name: '作者的人物即位', desc: '你捏的人物即某国君位' },
  split: { name: '分裂、独立', desc: '某地从某国分出去' },
  disaster: { name: '天灾', desc: '瘟疫、饥荒、地震水旱' },
  submit: { name: '称臣', desc: '' },
  peace: { name: '议和', desc: '' },
  dynasty: { name: '改朝换代', desc: '' },
  revolt: { name: '民变', desc: '' },
  collapse: { name: '大崩解', desc: '' },
  story: { name: '只讲故事', desc: '心情、对话、小场面；导播到那一年照样打出这句' },
};

/** 选种类那一栏的三组 */
export const PLOT_KIND_GROUPS: { head: string; kinds: PlotKind[]; inline?: boolean }[] = [
  { head: '会查；没发生就在那一年直接改过来', kinds: ['found', 'fall', 'hold', 'war', 'ally', 'capital', 'death', 'crown', 'split', 'disaster'] },
  { head: '只查不改：推演里还不能直接让它发生，没发生就标「做不到」', kinds: ['submit', 'peace', 'dynasty', 'revolt', 'collapse'], inline: true },
  { head: '不查不改', kinds: ['story'] },
];

/** 批改的章:名字 */
export const STATUS_NAMES: Record<PlotStatus | 'todo', string> = { natural: '照着发生了', forced: '硬改的', failed: '做不到', story: '只讲故事', todo: '还没推' };

/** 只查不改的几种 */
export const checkOnly = (k: PlotKind) => PLOT_CHECK_ONLY.includes(k);

/** 说法里要用到的:这份历史、大纲、上一次的批改、作者的标记和人物 */
export interface OutlineCtx {
  civ: Civ;
  plots: readonly Plot[];
  review?: readonly PlotReview[];
  marks?: readonly AuthorMark[];
  characters?: readonly AuthorCharacter[];
}

const reviewOf = (o: OutlineCtx, id: number) => o.review?.find((r) => r.id === id);
/** 情节在大纲里是第几条(1 起;没有 = 0) */
export const plotNo = (plots: readonly Pick<Plot, 'id'>[], id: number) => plots.findIndex((p) => p.id === id) + 1;

/** 情节里的国家(稳定键或 `plot:编号`)→ 这份历史里的编号(−1 = 没有) */
export function plotPolityId(o: OutlineCtx, key: string | undefined): number {
  if (!key) return -1;
  let k: string | undefined = key;
  if (key.startsWith('plot:')) k = reviewOf(o, Number(key.slice(5)))?.polity;
  const r = k ? resolveKey(o.civ, k) : null;
  return r?.kind === 'polity' ? r.id : -1;
}

/** 情节里的国家叫什么(那一年的名字;`plot:编号` 那一条还没立起来 = "第 N 条立的国") */
export function plotPolityName(o: OutlineCtx, key: string | undefined, year: number): string {
  if (!key) return '';
  const id = plotPolityId(o, key);
  if (id >= 0) return nameAt(o.civ.polities[id], year);
  if (key.startsWith('plot:')) return `第 ${plotNo(o.plots, Number(key.slice(5)))} 条立的国`;
  return '（这段历史里没有的国家）';
}

/** 国家的颜色(没有 = null) */
export function plotPolityColor(o: OutlineCtx, key: string | undefined): readonly number[] | null {
  const id = plotPolityId(o, key);
  return id >= 0 ? o.civ.polities[id].color : null;
}

/** 州键 → 州名 */
export function regionName(civ: Civ, key: string | undefined): string {
  if (!key) return '';
  const r = regionOfKey(key, keyCells(civ.regions));
  return r >= 0 && r < civ.regions.count ? regionLabel(civ, r) : '（没有的州）';
}

/** 城键 → 城名 */
export function cityName(civ: Civ, key: string | undefined): string {
  if (!key) return '';
  const r = resolveKey(civ, key);
  return r?.kind === 'settlement' ? civ.settlements[r.id].name || '某城' : '（这段历史里没有的城）';
}

/** 人物键 → 名字(这段历史里没有 = 键里记的名字) */
export function personKeyName(civ: Civ, key: string | undefined): string {
  if (!key) return '';
  const id = resolvePersonKey(civ, key);
  const x = id >= 0 ? civ.people?.[id] : undefined;
  return x ? personName(civ, x) : parsePersonKey(key)?.name || '（这段历史里没有的人物）';
}

/** 作者的人物叫什么 */
export function charName(o: Pick<OutlineCtx, 'characters'>, id: number | undefined): string {
  return o.characters?.find((c) => c.id === id)?.name || '作者的人物';
}

/** 一片地方:作者标记 / 现圈几州 —— 名字和州数 */
export function areaText(o: Pick<OutlineCtx, 'marks'>, p: Pick<Plot, 'mark' | 'regions'>): { name: string; n: number; mark: boolean } {
  if (p.regions?.length) return { name: `现圈 ${p.regions.length} 州`, n: p.regions.length, mark: false };
  const m = o.marks?.find((x) => x.id === p.mark);
  if (!m) return { name: '（找不到的作者标记）', n: 0, mark: true };
  return { name: m.title || '作者标记', n: m.regions?.length ?? 1, mark: true };
}

// ---------------------------------------------------------------------------
// 时间

/**
 * 情节的时间窗口:前后 span 年(after 的 = 它跟着的那条落定那年起 span 年内;那一条还没推过 = 按它本来的年份估)。
 * at = 没发生时在哪一年硬改;after = 跟着第几条(1 起;没有 = 0)
 */
export function plotWindow(o: Pick<OutlineCtx, 'plots' | 'review'>, p: Pick<Plot, 'year' | 'span' | 'after'>): { lo: number; hi: number; at: number; after: number } {
  const span = p.span ?? PLOT_SPAN_DEFAULT;
  if (p.after !== undefined) {
    const ref = o.review?.find((r) => r.id === p.after)?.year ?? o.plots.find((x) => x.id === p.after)?.year ?? p.year;
    return { lo: ref, hi: ref + span, at: ref + 1, after: plotNo(o.plots, p.after) };
  }
  return { lo: Math.max(0, p.year - span), hi: p.year + span, at: p.year, after: 0 };
}

/** 时间那一格:第一行、第二行小字("1700 年前后 / 前后 10 年""1530 年 / 就这一年""第 7 条之后 / 50 年内");年份按纪年写 */
export function timeCell(o: Pick<OutlineCtx, 'plots'>, p: Pick<Plot, 'kind' | 'year' | 'span' | 'after'>, era?: Era | null): [string, string] {
  const span = p.span ?? PLOT_SPAN_DEFAULT;
  if (p.after !== undefined) return [`第 ${plotNo(o.plots, p.after)} 条之后`, `${span} 年内`];
  if (p.kind === 'story' || span === 0) return [yearAt(p.year, era), '就这一年'];
  return [`${yearAt(p.year, era)}前后`, `前后 ${span} 年`];
}

// ---------------------------------------------------------------------------
// 谁、发生什么

/** 谁那一格的一段:名字、颜色(国家) */
export interface WhoPart {
  text: string;
  color?: readonly number[] | null;
}

/** 谁那一格:一两段(两段之间 sep:"→" 有方向 / "与");小字;没有 = 空 */
export function whoCell(o: OutlineCtx, p: Plot): { parts: WhoPart[]; sep?: string; small?: string } {
  const y = p.year;
  const pol = (k: string | undefined): WhoPart => ({ text: plotPolityName(o, k, y), color: plotPolityColor(o, k) });
  switch (p.kind) {
    case 'war':
    case 'submit':
      return { parts: [pol(p.a), pol(p.b)], sep: '→' };
    case 'ally':
    case 'peace':
      return { parts: [pol(p.a), pol(p.b)], sep: '与' };
    case 'fall':
      return { parts: [pol(p.a)], small: p.b ? `亡于${plotPolityName(o, p.b, y)}` : undefined };
    case 'hold':
    case 'capital':
    case 'dynasty':
    case 'revolt':
    case 'collapse':
      return { parts: [pol(p.a)] };
    case 'crown':
      return { parts: [{ text: charName(o, p.char) }], small: '作者的人物' };
    case 'death': {
      const owner = parsePersonKey(p.person)?.polity;
      return { parts: [{ text: personKeyName(o.civ, p.person) }], small: owner ? `${plotPolityName(o, owner, y)}君主` : undefined };
    }
    case 'found':
      return { parts: [{ text: regionName(o.civ, p.region) }] };
    case 'split':
      return { parts: [{ text: regionName(o.civ, p.region) }], small: p.a ? `从${plotPolityName(o, p.a, y)}分出` : undefined };
    case 'disaster':
      if (p.type === 'plague') return { parts: [{ text: cityName(o.civ, p.city) }] };
      if (p.type === 'quake') return { parts: [{ text: `${regionName(o.civ, p.region)}一带` }] };
      if (p.a) return { parts: [pol(p.a)] };
      return { parts: [{ text: p.regions?.length ? `${regionName(o.civ, p.regions[0])}${p.regions.length > 1 ? `等 ${p.regions.length} 州` : ''}` : '' }] };
    case 'story': {
      const where = storyWhere(o, p);
      return { parts: where ? [{ text: where }] : [] };
    }
  }
}

/** 只讲故事的"在哪"(没填 = 空) */
export function storyWhere(o: OutlineCtx, p: Pick<Plot, 'a' | 'region' | 'city' | 'person' | 'mark' | 'year'>): string {
  if (p.city) return cityName(o.civ, p.city);
  if (p.region) return regionName(o.civ, p.region);
  if (p.a) return plotPolityName(o, p.a, p.year);
  if (p.person) return personKeyName(o.civ, p.person);
  if (p.mark !== undefined) return areaText(o, { mark: p.mark }).name;
  return '';
}

/** 谁那一格写成一行字(手机、侧栏用):"大定 → 奥利亚王国" */
export function whoLine(o: OutlineCtx, p: Plot): string {
  const w = whoCell(o, p);
  return w.parts.map((x) => x.text).join(w.sep === '与' ? '、' : ` ${w.sep ?? ''} `) || '—';
}

/** 发生什么那一格:种类、小字(只查不改 / 那片地方 / 迁到哪 / 即哪国君位 / 灾的轻重) */
export function whatCell(o: OutlineCtx, p: Plot): [string, string] {
  const name = PLOT_KIND_INFO[p.kind].name;
  if (checkOnly(p.kind)) return [name, '只查不改'];
  switch (p.kind) {
    case 'hold': {
      const a = areaText(o, p);
      return [name, a.mark ? `${a.name}（作者标记，${a.n} 州）` : a.name];
    }
    case 'capital':
      return [name, `迁到${cityName(o.civ, p.city)}`];
    case 'crown':
      return [name, `即${plotPolityName(o, p.a, p.year)}君位`];
    case 'found':
      return [name, p.name ? `国号${p.name}` : ''];
    case 'death':
      return [name, p.how === 'murdered' ? '遇弑' : p.how === 'battle' ? '战死' : ''];
    case 'disaster':
      return [name, `${DISASTER_NAMES[p.type!]}（${DISASTER_LEVEL_NAMES[p.level ?? 2]}）`];
    default:
      return [name, ''];
  }
}

// ---------------------------------------------------------------------------
// 推完怎么查(编一行那一栏最下面)

export function checkText(o: OutlineCtx, p: Plot): string {
  const w = plotWindow(o, p);
  const win = w.after ? `第 ${w.after} 条之后 ${p.span ?? PLOT_SPAN_DEFAULT} 年内` : `第 ${w.lo}–${w.hi} 年`;
  const at = w.after ? `第 ${w.after} 条之后的那一年` : `第 ${w.at} 年`;
  const A = plotPolityName(o, p.a, p.year) || '那国';
  const B = plotPolityName(o, p.b, p.year) || '那国';
  const tail = '，从这一年接着推；前面的历史不变。';
  switch (p.kind) {
    case 'found': {
      const R = regionName(o.civ, p.region) || '那州';
      return `看${win}${R}有没有立起新国。没有，就在${at}直接改：在${R}立国${p.name ? `，号${p.name}` : ''}${tail}那州没人住就做不到。`;
    }
    case 'fall':
      return `看${win}${A}有没有亡${p.b ? `、是不是亡于${B}` : ''}。没亡，就在${at}直接改：灭${A}${p.b ? `，国土并入${B}` : '，散成无主'}${tail}`;
    case 'hold': {
      const a = areaText(o, p);
      return `看${win}有没有哪一年年底，这 ${a.n} 州里有人住的都归${A}；没占全，就在${at}把缺的州一州州划给${A}${tail}没人住的州不算。`;
    }
    case 'war':
      return `看${win}${A}有没有向${B}开战。没有，就在${at}直接改：${A}向${B}宣战${tail}两国要接壤、不在交战。`;
    case 'ally':
      return `看${win}${A}和${B}有没有结盟、在不在盟。没有，就在${at}直接改：两国结盟 ${OUTLINE_ALLY_YEARS} 年${tail}`;
    case 'capital': {
      const C = cityName(o.civ, p.city) || '那座城';
      return `看${win}${A}有没有迁都到${C}。没有，就在${at}直接改：迁都${C}${tail}那座城要在${A}手里。`;
    }
    case 'death': {
      const P = personKeyName(o.civ, p.person) || '他';
      const how = p.how === 'murdered' ? '遇弑' : p.how === 'battle' ? '战死' : '去世';
      return `看${win}${P}有没有${how}。没有，就在${at}直接改：让他去世${tail}${p.how ? '硬改只能写成"去世"，写不成遇弑、战死。' : ''}`;
    }
    case 'crown':
      return `看${win}${charName(o, p.char)}有没有即${A}君位。没有，就在${at}直接改：让他即位${tail}`;
    case 'split': {
      const R = regionName(o.civ, p.region) || '那州';
      return `看${win}${R}有没有起事自立${p.a ? `、从${A}分出去` : ''}。没有，就在${at}直接改：${R}自立为国${tail}`;
    }
    case 'disaster': {
      const what = DISASTER_NAMES[p.type ?? 'famine'];
      return `看${win}那里有没有闹${what}。没有，就在${at}直接降一场${what}（${DISASTER_LEVEL_NAMES[p.level ?? 2]}）${tail}`;
    }
    case 'story':
      return `不查、不改历史。导播放到第 ${p.year} 年照样停下来，打出这句。`;
    default:
      return `看${win}有没有${PLOT_KIND_INFO[p.kind].name}。推演里还不能直接让它发生，没发生就标「做不到」。`;
  }
}

// ---------------------------------------------------------------------------
// 批改的结果

/** 这条情节硬改出来的那几条干预(在干预列表里的下标) */
export function plotFixes(list: readonly Intervention[], id: number): number[] {
  const out: number[] = [];
  list.forEach((v, i) => v.plot === id && out.push(i));
  return out;
}

/** 一条硬改出来的干预怎么写(硬改结果、「我的干预」照大纲一组):"灭东定国，13 州并入大定""鹿东郡划给大定" */
export function fixText(civ: Civ, v: Intervention, base: (v: Intervention, i: number) => string): string {
  const i = (civ.interventions ?? []).findIndex((x) => JSON.stringify(x) === JSON.stringify(v));
  if (v.kind === 'destroy') {
    const id = resolveKey(civ, v.a);
    const A = id?.kind === 'polity' ? nameAt(civ.polities[id.id], v.from) : '那国';
    if (!v.b) return `灭${A}，散成无主`;
    const b = resolveKey(civ, v.b);
    const B = b?.kind === 'polity' ? nameAt(civ.polities[b.id], v.from) : '那国';
    const n = i >= 0 ? civ.annals.find((x) => x.kind === 'intervene' && x.war === i)?.n : undefined;
    return `灭${A}，${n ? `${n} 州` : '国土'}并入${B}`;
  }
  if (v.kind === 'death') return `让${personKeyName(civ, v.person)}去世`;
  return base(v, i).replace(/:/g, '：');
}

/** 批改那一格的一句小字(还没推 = 空) */
export function resultText(o: OutlineCtx, p: Plot, r: PlotReview | undefined, list: readonly Intervention[], base: (v: Intervention, i: number) => string): string {
  if (!r) return '';
  const y = r.year;
  const A = plotPolityName(o, p.a, y);
  const B = plotPolityName(o, p.b, y);
  switch (r.status) {
    case 'story':
      return `不查不改；导播到第 ${p.year} 年打出这句`;
    case 'natural':
      return `第 ${y} 年${happenedText(o, p, r)}`;
    case 'forced': {
      const fx = plotFixes(list, p.id).map((i) => list[i]);
      let what: string;
      if (p.kind === 'hold' && fx.length > 1) {
        const names = fx.slice(0, 3).map((v) => (v.kind === 'cede' ? regionName(o.civ, v.region) : ''));
        what = `把还缺的 ${fx.length} 州（${names.join('、')}${fx.length > 3 ? ' 等' : ''}）划给${A}`;
      } else what = fx.map((v) => fixText(o.civ, v, base)).join('；') || PLOT_KIND_INFO[p.kind].name;
      return `第 ${y} 年硬改：${what}${r.asDeath ? '（只能写成去世，写不成遇弑、战死）' : ''}`;
    }
    case 'failed':
      return `做不到：${failText(o, p, r, A, B)}`;
  }
}

/** 照着发生了的那一句("大定伐奥利亚王国""有桑皇朝亡") */
function happenedText(o: OutlineCtx, p: Plot, r: PlotReview): string {
  const y = r.year;
  const A = plotPolityName(o, p.a, y);
  const B = plotPolityName(o, p.b, y);
  const made = r.polity ? plotPolityName(o, r.polity, y + 1) : '';
  switch (p.kind) {
    case 'found':
      return `${regionName(o.civ, p.region)}立国${made ? `，即${made}` : ''}`;
    case 'split':
      return `${regionName(o.civ, p.region)}自立${made ? `，即${made}` : ''}`;
    case 'fall':
      return `${A}亡${p.b ? `于${B}` : ''}`;
    case 'hold':
      return `${areaText(o, p).name.replace(/^现圈 /, '那 ')}都归${A}`;
    case 'war':
      return `${A}伐${B}`;
    case 'ally':
      return `${A}与${B}在盟`;
    case 'capital':
      return `${A}迁都${cityName(o.civ, p.city)}`;
    case 'death':
      return `${personKeyName(o.civ, p.person)}${p.how === 'murdered' ? '遇弑' : p.how === 'battle' ? '战死' : '去世'}`;
    case 'crown':
      return `${charName(o, p.char)}即位`;
    case 'disaster':
      return `闹${DISASTER_NAMES[p.type ?? 'famine']}`;
    case 'submit':
      return `${A}称臣于${B}`;
    case 'peace':
      return `${A}与${B}议和`;
    case 'dynasty':
      return `${A}改朝换代`;
    case 'revolt':
      return `${A}治下民变`;
    case 'collapse':
      return `${A}大崩解`;
    case 'story':
      return '';
  }
}

/** 做不到的原因 */
function failText(o: OutlineCtx, p: Plot, r: PlotReview, A: string, B: string): string {
  const who = r.who === 'b' ? B : A;
  const y = r.year;
  const w = plotWindow(o, p);
  switch (r.reason) {
    case 'notYet':
      return `第 ${y} 年${who || '那国'}还没立国`;
    case 'gone':
      return `第 ${y} 年${who || '那国'}已经亡了`;
    case 'missing':
      return p.kind === 'crown' ? '找不到这位作者的人物' : p.kind === 'death' ? '这段历史里没有这个人' : p.kind === 'hold' ? '找不到那片地方' : '这段历史里找不到它';
    case 'empty':
      return '那里没人住';
    case 'notOwned':
      return p.kind === 'capital' ? `那座城不在${who}手里` : `那州不在${who}手里`;
    case 'ruined':
      return '那座城已经毁了';
    case 'border':
      return `第 ${y} 年两国不接壤`;
    case 'atWar':
      return `第 ${y} 年两国已经在打仗`;
    case 'dead':
      return `第 ${y} 年他已经不在世了`;
    case 'unborn':
      return `第 ${y} 年他还没出生`;
    case 'notReigning':
      return `第 ${y} 年他不在位`;
    case 'unsupported':
      return `第 ${w.lo}–${w.hi} 年没有自然发生，推演里还不能直接让它发生`;
    case 'crowded':
      return '前面的情节已经把这段时间定下了，挪不进去';
    case 'beyond':
      return '年份超出了推演的年数';
    case 'refFailed':
      return `它跟着的那一条没立起国家`;
    case 'noEffect':
    default:
      return '硬改了也没成';
  }
}

/** 做不到是因为要的国家没了(还没立国、已亡、跟着的那条没立起来):提示先用「立国」把它捏出来 */
export const needsFound = (r: PlotReview | undefined) => r?.status === 'failed' && (r.reason === 'notYet' || r.reason === 'gone' || r.reason === 'refFailed');

/** 批改合计:每种章各几条 */
export function reviewCounts(review: readonly PlotReview[] | undefined): Record<PlotStatus, number> {
  const n: Record<PlotStatus, number> = { natural: 0, forced: 0, failed: 0, story: 0 };
  for (const r of review ?? []) n[r.status]++;
  return n;
}

/** 合计的一句:"照着发生了 5 条，硬改 2 条，做不到 2 条" */
export function countsText(n: Record<PlotStatus, number>, story = false): string {
  return [`照着发生了 ${n.natural} 条`, `硬改 ${n.forced} 条`, `做不到 ${n.failed} 条`, story ? `只讲故事 ${n.story} 条` : ''].filter(Boolean).join('，');
}

/**
 * 照大纲推演到这一条、它没自然发生,正在第 fix 年硬改:提示条上的一句("第 1700 年东定国没有亡，在这一年灭东定国，从这年接着推")
 */
export function stageText(o: OutlineCtx, p: Plot, fix: number): string {
  const A = plotPolityName(o, p.a, fix) || '那国';
  const B = plotPolityName(o, p.b, fix) || '那国';
  const R = regionName(o.civ, p.region) || '那州';
  const [no, fixed] = ((): [string, string] => {
    switch (p.kind) {
      case 'found':
        return [`${R}没有立国`, `在${R}立国`];
      case 'fall':
        return [`${A}没有亡`, `灭${A}`];
      case 'hold':
        return [`${A}没占全那片地方`, `把缺的州划给${A}`];
      case 'war':
        return [`${A}没有向${B}开战`, `让${A}向${B}宣战`];
      case 'ally':
        return [`${A}和${B}没有结盟`, '让两国结盟'];
      case 'capital':
        return [`${A}没有迁都`, `迁都${cityName(o.civ, p.city) || '那座城'}`];
      case 'death': {
        const P = personKeyName(o.civ, p.person) || '他';
        return [`${P}还在`, `让${P}去世`];
      }
      case 'crown': {
        const C = charName(o, p.char);
        return [`${C}没有即位`, `让${C}即位`];
      }
      case 'split':
        return [`${R}没有自立`, `让${R}自立`];
      case 'disaster': {
        const what = DISASTER_NAMES[p.type ?? 'famine'];
        return [`那里没有闹${what}`, `降一场${what}`];
      }
      default:
        return ['没有自然发生', '直接改过来'];
    }
  })();
  return `第 ${fix} 年${no}，在这一年${fixed}，从这年接着推`;
}

/** 「我的干预」里列几行:作者自己下的一条一行,照大纲硬改出来的一条情节一行 */
export function interventionRows(list: readonly Intervention[]): number {
  const plots = new Set<number>();
  let n = 0;
  for (const v of list) {
    if (v?.plot === undefined) n++;
    else plots.add(v.plot);
  }
  return n + plots.size;
}

// ---------------------------------------------------------------------------
// 地图上看一条(点一条到地图上:地图上的小牌子)

/** 一条情节一句话说出了什么事(地图上的小牌子):"东定国亡，并入大定""大定占据南境" */
export function plotHeadline(o: OutlineCtx, p: Plot): string {
  const y = p.year;
  const A = plotPolityName(o, p.a, y);
  const B = plotPolityName(o, p.b, y);
  const R = regionName(o.civ, p.region);
  switch (p.kind) {
    case 'fall':
      return B ? `${A}亡，并入${B}` : `${A}亡`;
    case 'war':
      return `${A}攻${B}`;
    case 'submit':
      return `${A}向${B}称臣`;
    case 'ally':
      return `${A}与${B}结盟`;
    case 'peace':
      return `${A}与${B}议和`;
    case 'hold':
      return `${A}占据${areaText(o, p).name}`;
    case 'capital':
      return `${A}迁都${cityName(o.civ, p.city)}`;
    case 'dynasty':
    case 'revolt':
    case 'collapse':
      return `${A}${PLOT_KIND_INFO[p.kind].name}`;
    case 'crown':
      return `${charName(o, p.char)}即${A}君位`;
    case 'death':
      return `${personKeyName(o.civ, p.person)}去世`;
    case 'found':
      return p.name ? `${R}立国，号${p.name}` : `${R}立国`;
    case 'split':
      return A ? `${R}从${A}分出` : `${R}自立`;
    case 'disaster':
      return `${whoLine(o, p)}${DISASTER_NAMES[p.type ?? 'famine']}`;
    case 'story':
      return plotText(p);
  }
}

/** 作者写的那句(去掉句末的句号),没写 = 发生什么 */
export function plotText(p: Plot): string {
  return p.text ? p.text.replace(/[。.]$/, '') : PLOT_KIND_INFO[p.kind].name;
}

/** 地图上的小牌子立在哪个地块(城 / 州的治所 / 国家那时的国都;说不出地方 = −1) */
export function plotCell(o: OutlineCtx, p: Plot, r: PlotReview | undefined): number {
  const civ = o.civ;
  // 推过了 = 落定的那年;没推过 = 情节的年份(跟着前一条的按估的,和点过去、时间轴上的记号一样)
  const year = r && r.status !== 'failed' ? r.year : plotWindow(o, p).at;
  const city = (k: string | undefined) => {
    const q = k ? resolveKey(civ, k) : null;
    return q?.kind === 'settlement' ? (civ.settlements[q.id]?.cell ?? -1) : -1;
  };
  const seat = (k: string | undefined) => {
    const reg = k ? regionOfKey(k, keyCells(civ.regions)) : -1;
    return reg >= 0 && reg < civ.regions.count ? civ.regions.seat[reg] : -1;
  };
  const capital = (id: number) => {
    const q = civ.polities[id];
    if (!q) return -1;
    const y = q.ended !== undefined ? Math.min(year, q.ended - 1) : year;
    return civ.settlements[capitalAt(q, Math.max(q.founded, y))]?.cell ?? -1;
  };
  const pol = (k: string | undefined) => capital(plotPolityId(o, k));
  const first = (...xs: number[]) => xs.find((x) => x >= 0) ?? -1;
  switch (p.kind) {
    case 'capital':
      return first(city(p.city), pol(p.a));
    case 'found':
    case 'split':
      return first(r?.polity ? capital(resolveKey(civ, r.polity)?.id ?? -1) : -1, seat(p.region));
    case 'hold': {
      const keys = p.regions ?? o.marks?.find((m) => m.id === p.mark)?.regions ?? [];
      return first(seat(keys[0]), pol(p.a));
    }
    case 'death': {
      const owner = parsePersonKey(p.person)?.polity;
      return pol(owner);
    }
    case 'crown':
      return pol(p.a);
    case 'disaster':
      return first(city(p.city), seat(p.region), seat(p.regions?.[0]), pol(p.a));
    case 'story':
      return first(city(p.city), seat(p.region), pol(p.a), p.person ? pol(parsePersonKey(p.person)?.polity) : -1);
    default:
      return pol(p.a);
  }
}

// ---------------------------------------------------------------------------
// 导播照大纲放

/** 照着发生了的情节,编年史里先找哪几种(找不到再看那一年和它有关的别的大事) */
const PLOT_ENTRY_KINDS: Partial<Record<PlotKind, readonly string[]>> = {
  fall: ['fall', 'conquer', 'merge'],
  war: ['war'],
  submit: ['submit', 'war'],
  ally: ['alliance'],
  peace: ['peace', 'war'],
  found: ['found'],
  split: ['split', 'found', 'revolt'],
  dynasty: ['dynasty'],
  capital: ['capital'],
  revolt: ['revolt'],
  collapse: ['collapse'],
  hold: ['war', 'conquer'],
  disaster: ['plague', 'famine', 'upheaval', 'intervene'],
};

/**
 * 导播照大纲放的情节(按大纲的先后):推过的、不是做不到的;编年史里对上的那一条 ——
 * 硬改的 = 照这条情节下的那条干预;照着发生了的 = 落定那年、和它说的国家有关的那件(种类对得上的先);只讲故事不对
 */
export function directorPlots(o: OutlineCtx, entries: readonly ChronicleEntry[]): DirectorPlot[] {
  const out: DirectorPlot[] = [];
  o.plots.forEach((p, i) => {
    const r = o.review?.find((x) => x.id === p.id);
    if (!r || r.status === 'failed') return;
    const year = r.status === 'story' ? p.year : r.year;
    out.push({
      id: p.id,
      n: i + 1,
      total: o.plots.length,
      year,
      text: p.text || PLOT_KIND_INFO[p.kind].name,
      entry: r.status === 'story' ? null : plotEntry(o, p, r, entries),
      cell: plotCell(o, p, r),
    });
  });
  return out;
}

function plotEntry(o: OutlineCtx, p: Plot, r: PlotReview, entries: readonly ChronicleEntry[]): ChronicleEntry | null {
  const civ = o.civ;
  if (r.status === 'forced')
    return entries.find((e) => e.kind === 'intervene' && civ.interventions?.[civ.annals[e.id]?.war ?? -1]?.plot === p.id) ?? null;
  const y = Math.floor(r.year);
  const pol = r.polity ? (resolveKey(civ, r.polity)?.kind === 'polity' ? resolveKey(civ, r.polity)!.id : -1) : plotPolityId(o, p.a);
  const kinds = PLOT_ENTRY_KINDS[p.kind] ?? [];
  let best: ChronicleEntry | null = null;
  let score = -1;
  for (const e of entries) {
    if (Math.floor(e.year) !== y || e.importance < 2) continue;
    if (pol >= 0 && !entryInvolves(e, pol)) continue;
    const k = kinds.indexOf(e.kind);
    const sc = (k >= 0 ? 100 - k * 10 : 0) + e.importance;
    if (sc > score) [best, score] = [e, sc];
  }
  return best;
}
