/**
 * 助手查资料的两个只读工具的内容(纯计算,不碰 DOM;只读世界、历史和作者的人物,不改它们):
 *
 * - people:人物。作者的人物(人物卡上的生卒、身份、性格、经历、亲友、即位)和推演里的君主、将领、名臣、宗室
 *   (在位 / 生卒年、所属国家、倾向)。
 *     name             按名字找(本名、称号、字都算;作者的人物和推演里的人一起找)
 *     country          这国的历代君主(role 换成名臣、将领、宗室、作者的人物);from / to 只看这几年
 *     country + year   那一年:谁在位、谁在朝、谁在领兵,和这国那年在世的作者的人物
 *     year             那一年各国在位的君主(按国土大小)
 *     什么都不给       作者的人物和推演里的名人
 * - land:一片地方的地块数据汇总 —— 海拔、年均气温、年降水、地形(群落)占比、人口、城、归属、物产。
 *   一片 = 一州(region,也可以给城)/ 一国某年的国土(country)/ 一块陆地(landmass)/ 经纬度一点(at,带 radius = 周围一圈)/
 *   经纬度一框(box)/ 什么都不给 = 整个世界。只给平均、最低最高、占比,不逐块列:20 万地块的世界也一样短。
 *   平均、占比按面积算(地图上高纬度的地块实际面积小)。
 *
 * 交给模型的字数不超过 LOOKUP_MAX:超了按行截掉后面的,末尾写明截掉了几行、怎么缩小范围。
 */
import type { World } from '../../gen/world';
import type { Civ, Person, Polity, Regions } from '../../gen/civ/types';
import { BIOMES } from '../../gen/biomes';
import { regionLabel, regionNamed } from '../../gen/civ/display';
import { polityAlive, polityRoots, polityTitleChain, populationAt, populationLabel, regionPopulationAt } from '../../gen/civ/growth';
import { ownersAt, type Owners } from '../../gen/civ/timeline';
import { ERAS, RESOURCES, RESOURCE_COUNT, developmentAt, eraLevel, eraOf, resourcesAt } from '../../gen/civ/development';
import { campaignText, commandFoes, fameLine, famousPeople, foesText, generalTally, peopleIndex, personFame, personSpan, riseText, rulerAt } from '../../gen/civ/peopleInfo';
import { ageAt, generalRole, isConsul, leaningsText, ministerRole, personName, princeRole, rulerFateWord, rulerRef, rulerRole } from '../../gen/civ/peopleText';
import { isFemale, kinWord } from '../../gen/civ/gender';
import { deedsShort, ministerFate, personBio } from '../../gen/civ/officialText';
import { fatherOf } from '../../gen/civ/lineageInfo';
import { nearestCell as nearestWorldCell } from '../../gen/civ/frontier';
import { KM_PER_UNIT } from '../../gen/civ/geo';
import { TERRAIN_W } from '../../gen/terrainEdits';
import { applyCharacters, characterAge, lifeInOrder, resolvePersonKey, type AuthorCharacter, type Where } from '../../gen/characters';
import { resolveKey, type WorldEdits } from '../../gen/edits';
import { nameAt, nearestCell, toLonLat } from '../prompts/rewrite';

/** 交给模型的一次结果最多几个字(超了截掉后面的行,写明截掉了) */
export const LOOKUP_MAX = 3000;
/** 列人物默认几个、最多几个 */
export const PEOPLE_LIMIT = 30;
export const PEOPLE_LIMIT_MAX = 60;
/** 按名字找到这么多个以内的,每个写详细些 */
const DETAIL_MAX = 3;
/** 圈一片时半径最大几公里 */
export const RADIUS_MAX = 3000;

export interface LookupContext {
  world: World;
  /** 套上了改名的这份历史 */
  civ: Civ;
  /** 时间轴的年份(没给年份时按它) */
  year: number;
  /** 现在的修改(作者的人物在 characters 里) */
  edits: WorldEdits;
}

export interface LookupResult {
  result: string;
  /** 给作者看的一句(这一步那一行后面的小字) */
  summary: string;
}

const F = Math.floor;
const RAD = Math.PI / 180;
/** 地球半径(公里):赤道一圈 = 地图宽 */
const R_KM = (TERRAIN_W * KM_PER_UNIT) / (2 * Math.PI);
const f1 = (v: number) => String(Math.round(v * 10) / 10);
const ll = (p: readonly [number, number]) => `(${f1(p[0])}, ${f1(p[1])})`;
const cellLL = (world: World, c: number): [number, number] => toLonLat(world.mesh.x[c], world.mesh.y[c]);
/** 截到 n 个字(多的写省略号) */
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
/** 一行最长几个字 */
const LINE_MAX = 600;

/**
 * 按行拼起来,不超过 max 个字:放得下就全给;放不下就截掉后面的行,末尾写明截掉了几行(hint = 怎么缩小范围)。
 * 太长的一行先截到 LINE_MAX
 */
export function fitLines(lines: readonly string[], max = LOOKUP_MAX, hint = ''): string {
  const ls = lines.map((l) => (l.length > LINE_MAX ? `${l.slice(0, LINE_MAX)}……(这一行太长,截断了)` : l));
  const all = ls.join('\n');
  if (all.length <= max) return all;
  const tail = (rest: number) => `……(字数到了上限,后面 ${rest} 行没给${hint ? `;${hint}` : ''})`;
  const out: string[] = [];
  let len = 0;
  for (const l of ls) {
    if (len + l.length + 1 + tail(ls.length).length + 1 > max) break;
    out.push(l);
    len += l.length + 1;
  }
  out.push(tail(ls.length - out.length));
  return out.join('\n').slice(0, max);
}

// ---------------------------------------------------------------------------
// 参数

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

/** 年份参数 → 整数年(超出范围的夹到 0..endYear);没给、看不懂的("unknown""第十二年")= fallback */
export function yearArg(civ: Civ, v: unknown, fallback: number): number {
  const digits = typeof v === 'string' ? v.replace(/[^\d.-]/g, '') : '';
  const n = typeof v === 'number' ? v : digits ? Number(digits) : NaN;
  const y = Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(Math.floor(civ.endYear), Math.floor(y)));
}

/** 给了这个参数(不是空的) */
const given = (v: unknown) => v !== undefined && v !== null && v !== '';

/** "R45" / 45 / 州名 / "第 46 州" / 城("C12" 或城名,取城所在的州)→ 州编号;找不到 = −1 */
export function regionOf(civ: Civ, v: unknown): number {
  const R = civ.regions;
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v < R.count ? v : -1;
  if (typeof v !== 'string') return -1;
  const s = v.trim();
  if (!s) return -1;
  const m = /^[Rr]?(\d{1,6})$/.exec(s);
  if (m) return Number(m[1]) < R.count ? Number(m[1]) : -1;
  const nth = /^第\s*(\d{1,6})\s*州$/.exec(s);
  if (nth) return Number(nth[1]) >= 1 && Number(nth[1]) <= R.count ? Number(nth[1]) - 1 : -1;
  const city = /^[Cc](\d{1,6})$/.exec(s);
  if (city) {
    const st = civ.settlements[Number(city[1])];
    return st && st.region < R.count ? st.region : -1;
  }
  for (const name of [s, s.replace(/州$/, '')]) {
    if (!name) continue;
    for (let r = 0; r < R.count; r++) if (regionNamed(civ, r) && regionLabel(civ, r) === name) return r;
    const st = civ.settlements.find((x) => x.name === name);
    if (st && st.region < R.count) return st.region;
  }
  for (let r = 0; r < R.count; r++) if (regionNamed(civ, r) && regionLabel(civ, r).includes(s)) return r;
  return -1;
}

/** 一串数:数组,或写成字符串的("[10, 20]""10,20");别的、里面有不是数的 = null */
function numsArg(v: unknown): number[] | null {
  const xs = Array.isArray(v) ? v.map((x) => (typeof x === 'string' && x.trim() ? Number(x) : typeof x === 'number' ? x : NaN)) : typeof v === 'string' ? (v.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number) : null;
  return xs && xs.length && xs.every(Number.isFinite) ? xs : null;
}

/** [经度, 纬度] → 规整过的点;不是两个数 = null */
function lonLatArg(v: unknown): [number, number] | null {
  const xs = numsArg(v);
  if (!xs || xs.length !== 2) return null;
  const [lon, lat] = xs;
  return [((((lon + 180) % 360) + 360) % 360) - 180, Math.max(-90, Math.min(90, lat))];
}

/** 两点的球面距离(公里) */
function distKm(a: readonly [number, number], b: readonly [number, number]): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------------------------------------------------------------------------
// 共用:某一年各州归谁(一次查询里按年份缓存)

function ownersCache(civ: Civ): (y: number) => Owners {
  const memo = new Map<number, Owners>();
  return (y) => {
    const Y = Math.max(0, Math.min(civ.endYear, F(y)));
    let o = memo.get(Y);
    if (!o) {
      o = Y >= civ.endYear ? { polity: civ.polity, culture: civ.culture } : ownersAt(civ, Y);
      memo.set(Y, o);
    }
    return o;
  };
}

// ---------------------------------------------------------------------------
// 查人物

const ROLES = ['ruler', 'general', 'minister', 'prince', 'author'] as const;
type RoleArg = (typeof ROLES)[number];
const ROLE_NAME: Record<RoleArg, string> = { ruler: '君主', general: '将领', minister: '名臣', prince: '宗室', author: '作者的人物' };

function roleArg(v: unknown): RoleArg | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const hit = ROLES.find((r) => r === s || ROLE_NAME[r] === s);
  if (hit) return hit;
  // 宗室先认("王子""皇子"里也有"王""皇")
  if (/宗室|王子|皇子|太子|公子|公主|公女|太女/.test(s)) return 'prince';
  if (/作者/.test(s)) return 'author';
  if (/君|帝|王|执政/.test(s)) return 'ruler';
  if (/将/.test(s)) return 'general';
  if (/臣|相/.test(s)) return 'minister';
  return null;
}

/** 名字参数:去掉空白 */
const nameArg = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, '') : '');

/** 查人物这一步的说法(界面上一行) */
export function peopleLabel(ctx: LookupContext, a: Record<string, unknown>): string {
  const { civ } = ctx;
  const name = nameArg(a.name);
  if (name) return `查人物：${clip(name, 12)}`;
  const id = given(a.country) ? polityOf(civ, a.country) : -1;
  const role = roleArg(a.role);
  const what = role && role !== 'ruler' ? ROLE_NAME[role] : '';
  if (id >= 0) {
    const Y = given(a.year) ? yearArg(civ, a.year, ctx.year) : -1;
    return `查人物：${nameAt(civ.polities[id], Y >= 0 ? Y : ctx.year)}${Y >= 0 ? `第 ${Y} 年` : '历代'}${what || (Y >= 0 ? '' : '君主')}`;
  }
  if (given(a.year)) return `查第 ${yearArg(civ, a.year, ctx.year)} 年各国的${what || '君主'}`;
  return role === 'author' ? '查作者的人物' : '查人物';
}

/** 查人物 */
export function lookupPeople(ctx: LookupContext, a: Record<string, unknown>): LookupResult {
  const { world } = ctx;
  const chars = ctx.edits.characters ?? [];
  // 作者立的君主名字是空的(界面套上人物卡的名字以后才有):没套过就在这里套上(只是一份新的 Civ,不改原来的)
  const civ = ctx.civ.people?.some((x) => x.author !== undefined && !x.name) ? applyCharacters(ctx.civ, chars) : ctx.civ;
  const people = civ.people ?? [];
  const P = civ.polities;
  const end = F(civ.endYear);
  const owners = ownersCache(civ);
  const limit = Math.max(1, Math.min(PEOPLE_LIMIT_MAX, F(Number(a.limit)) || PEOPLE_LIMIT));
  const role = roleArg(a.role);
  const Yarg = given(a.year) ? yearArg(civ, a.year, ctx.year) : -1;
  /** 说"第 Y 年时几岁"用的年份 */
  const Ynow = Yarg >= 0 ? Yarg : yearArg(civ, ctx.year, end);
  const charById = new Map(chars.map((c) => [c.id, c]));
  const crowned = new Set<number>();
  for (const v of ctx.edits.interventions ?? []) if (v?.kind === 'crown') crowned.add(v.char);

  // ---- 作者的人物:国家、地方 ----
  const polityName = (id: number, y: number) => (id >= 0 && P[id] ? `P${id} ${nameAt(P[id], y)}` : '');
  const regionMemo = new Map<string, number>();
  /** 一个地方在哪一州(海上、找不到 = −1) */
  const whereRegion = (w: Where): number => {
    const k = typeof w === 'string' ? w : `${w[0]},${w[1]}`;
    let r = regionMemo.get(k);
    if (r === undefined) {
      if (typeof w === 'string') {
        const hit = resolveKey(civ, w);
        r = hit?.kind === 'settlement' ? (civ.settlements[hit.id]?.region ?? -1) : hit?.kind === 'region' ? hit.id : -1;
      } else {
        const c = nearestWorldCell(world, w[0], w[1]);
        r = c >= 0 && world.water[c] === 0 ? civ.regions.of[c] : -1;
      }
      regionMemo.set(k, r);
    }
    return r;
  };
  const whereText = (w: Where): string => {
    if (typeof w !== 'string') {
      const r = whereRegion(w);
      return `${ll(toLonLat(w[0], w[1]))}${r >= 0 ? ` R${r} ${regionLabel(civ, r)}` : ''}`;
    }
    const hit = resolveKey(civ, w);
    if (hit?.kind === 'settlement' && civ.settlements[hit.id]) return `C${hit.id} ${civ.settlements[hit.id].name}`;
    if (hit?.kind === 'region') return `R${hit.id} ${regionLabel(civ, hit.id)}`;
    return '(这个地方找不到了)';
  };
  const polityMemo = new Map<number, number>();
  /** 他的国家:写了 = 那一国;没写 = 出生地在生年归属的国家(没有 = −1) */
  const charPolity = (c: AuthorCharacter): number => {
    let id = polityMemo.get(c.id);
    if (id === undefined) {
      if (c.polity) {
        const k = resolveKey(civ, c.polity);
        id = k?.kind === 'polity' ? k.id : -1;
      } else {
        const r = c.birthplace ? whereRegion(c.birthplace) : -1;
        id = r >= 0 && civ.viable ? (owners(c.born).polity[r] ?? -1) : -1;
      }
      polityMemo.set(c.id, id);
    }
    return id;
  };
  const reignsOf = (cid: number) => people.filter((x) => x.role === 'ruler' && x.author === cid);
  const lifeOf = (born: number, died: number | undefined, still: string) =>
    died !== undefined ? `生卒 第 ${F(born)}—${F(died)} 年(享年 ${F(died) - F(born)})` : `第 ${F(born)} 年生,${still}`;
  const ageWords = (born: number, died: number | undefined, y: number) => {
    const s = characterAge({ born: F(born), died: died === undefined ? undefined : F(died) }, y);
    return s.state === 'unborn' ? `第 ${y} 年时还没出生` : s.state === 'dead' ? `第 ${y} 年时已故` : `第 ${y} 年时 ${s.age} 岁`;
  };

  const charLine = (c: AuthorCharacter, detail: boolean): string => {
    const parts = [`作者的人物 ${c.name}${c.role ? `(${c.role})` : ''}`];
    const pid = charPolity(c);
    if (pid >= 0) parts.push(`国家 ${polityName(pid, Math.max(c.born, 0))}`);
    parts.push(lifeOf(c.born, c.died, '没写卒年'), ageWords(c.born, c.died, Ynow));
    if (c.leanings) parts.push(`性格 ${leaningsText(c.leanings)}`);
    const reigns = reignsOf(c.id);
    for (const x of reigns) {
      const from = F(x.from ?? x.born);
      const fate = rulerFateWord(civ, x);
      parts.push(`在推演里即位:${rulerRole(civ, x)}(P${x.polity}),${x.until !== undefined ? `第 ${from}—${F(x.until)} 年` : `第 ${from} 年起到最后`}${fate ? `,${fate}` : ''}`);
    }
    if (!reigns.length && crowned.has(c.id)) parts.push('下过即位命令,推演里没即位成');
    if (detail) {
      if (c.birthplace) parts.push(`出生地 ${whereText(c.birthplace)}`);
      if (c.note) parts.push(`简介:${clip(c.note.replace(/\s+/g, ' ').trim(), 200)}`);
      const life = lifeInOrder(c);
      if (life.length)
        parts.push(
          `经历 ${life.length} 段${life.length > 12 ? '(列前 12 段)' : ''}:` +
            life
              .slice(0, 12)
              .map(({ e }) => `第 ${e.year} 年 ${clip(e.text, 50)}${e.where ? `(在 ${whereText(e.where)})` : ''}`)
              .join(';'),
        );
      if (c.kin?.length) {
        const kin = c.kin.slice(0, 10).map((k) => {
          let who = '';
          if (k.char !== undefined) who = charById.get(k.char)?.name ?? '';
          else if (k.person) {
            const id = resolvePersonKey(civ, k.person);
            who = id >= 0 && people[id] ? personName(civ, people[id]) : '';
          }
          return who ? `${k.rel || '亲友'} ${who}` : '';
        });
        const shown = kin.filter(Boolean);
        if (shown.length) parts.push(`亲友:${shown.join('、')}`);
      }
    }
    return parts.join(' · ');
  };

  // ---- 推演里的人 ----
  const personLine = (x: Person, detail: boolean, Y = -1): string => {
    const p: Polity | undefined = P[x.polity];
    const pid = p ? `P${x.polity}` : '';
    const parts: string[] = [];
    const died = x.author !== undefined ? charById.get(x.author)?.died : x.died;
    const still = x.author !== undefined ? '生死看人物卡' : '到最后仍在世';
    if (x.role === 'ruler') {
      const consul = isConsul(civ, x);
      const from = F(x.from ?? p?.founded ?? x.born);
      parts.push(`${consul ? '执政' : '君主'} ${personName(civ, x)} · ${rulerRole(civ, x)}${pid ? `(${pid})` : ''}`);
      parts.push(
        x.until !== undefined
          ? `${consul ? '在任' : '在位'} 第 ${from}—${F(x.until)} 年(${F(x.until) - from} 年)`
          : `第 ${from} 年${consul ? '就任' : '即位'},到最后仍${consul ? '在任' : '在位'}`,
      );
      if (Y >= 0) parts.push(`第 ${Y} 年时${consul ? '在任' : '在位'}第 ${Y - from + 1} 年、${ageAt(x, Y)} 岁`);
      parts.push(lifeOf(x.born, died, still));
      const rise = riseText(civ, x);
      if (rise) parts.push(rise);
      const fate = rulerFateWord(civ, x);
      if (fate) parts.push(fate);
      if (x.leanings) parts.push(`倾向 ${leaningsText(x.leanings)}`);
      if (x.author !== undefined) parts.push('是作者的人物(即位命令立的)');
      if (detail) {
        const f = fatherOf(civ, x);
        if (f) parts.push(`${kinWord(f, '父')} ${personName(civ, f)}`);
        const fame = personFame(civ, x);
        if (fame?.deeds) parts.push(`事迹:${fame.deeds}`);
        const foes = commandFoes(civ, x);
        if (foes.length) parts.push(campaignText(civ, foes));
      }
    } else if (x.role === 'general') {
      parts.push(`将领 ${x.name} · ${generalRole(civ, x)}${pid ? `(${pid})` : ''}`);
      const cs = x.commands ?? [];
      if (cs.length) parts.push(`领兵 第 ${F(cs[0].from)}—${F(cs[cs.length - 1].until)} 年`);
      parts.push(lifeOf(x.born, died, still));
      const ft = foesText(civ, commandFoes(civ, x));
      if (ft) parts.push(ft);
      const t = generalTally(civ, x);
      if (t.took || t.held) parts.push([t.took ? `攻下 ${t.took} 州` : '', t.held ? `击退来攻 ${t.held} 次` : ''].filter(Boolean).join('、'));
      if (x.fate) parts.push(x.fate === 'battle' ? '战死' : '寿终');
      if (detail) {
        const bio = personBio(civ, x);
        if (bio) parts.push(`生平:${clip(bio, 300)}`);
      }
    } else if (x.role === 'minister') {
      const from = F(x.from ?? x.born);
      parts.push(`名臣 ${x.name}${x.courtesy ? `(字${x.courtesy})` : ''} · ${ministerRole(civ, x)}${pid ? `(${pid})` : ''}`);
      parts.push(x.until !== undefined ? `在朝 第 ${from}—${F(x.until)} 年` : `第 ${from} 年入仕,到最后仍在朝`);
      parts.push(lifeOf(x.born, died, still));
      const d = deedsShort(civ, x);
      if (d) parts.push(d);
      const fate = ministerFate(civ, x);
      if (fate) parts.push(fate);
      if (detail) {
        const bio = personBio(civ, x);
        if (bio) parts.push(`生平:${clip(bio, 300)}`);
      }
    } else {
      parts.push(`宗室 ${x.name} · ${princeRole(civ, x)}${pid ? `(${pid})` : ''}`, lifeOf(x.born, died, still));
    }
    // 女的写明(AI 写"她"、写女帝女王)
    if (isFemale(x)) parts.splice(1, 0, '女');
    return parts.join(' · ');
  };

  const roleOk = (x: Person) => !role || role === x.role;
  /** 第 Y 年里领过兵(哪一次领兵和这一年有重叠;卸任那一刻不算) */
  const commanding = (x: Person, Y: number) => (x.commands ?? []).some((c) => c.from < Y + 1 && c.until > Y);
  // from / to:只看这几年
  const from = given(a.from) ? yearArg(civ, a.from, 0) : -Infinity;
  const to = given(a.to) ? yearArg(civ, a.to, end) : Infinity;
  const range = Number.isFinite(from) || Number.isFinite(to) ? `第 ${Number.isFinite(from) ? from : 0}—${Number.isFinite(to) ? to : end} 年` : '';
  /** 只看那一年在世的(给了 year)/ 那几年在世过的(给了 from、to)作者的人物 */
  const charsWhen = (list: readonly AuthorCharacter[]) =>
    list.filter((c) => (Yarg < 0 || characterAge(c, Yarg).state === 'alive') && c.born <= to && (c.died ?? Infinity) >= from);
  /**
   * 这几年里在台上过(年份按整年比:即位、卸任可能在一年当中):君主在位、名臣在朝、将领领兵,卸任那一刻起不算;
   * 宗室按生卒,卒年那一年还算在世(和"那一年在世的宗室"一样)
   */
  const activeIn = (x: Person) => {
    if (x.role === 'prince' && role !== 'general') return F(x.born) <= to && (x.died ?? Infinity) >= from;
    // 将领一次次领兵之间可能隔着好些年:要有一次领兵落在这几年里(领过兵的宗室列进将领时也这样算)
    if (x.role === 'general' || x.role === 'prince') return (x.commands ?? []).some((c) => F(c.from) <= to && c.until > from);
    const s = personSpan(x);
    return F(s.from) <= to && (s.until ?? Infinity) > from;
  };
  /** 说"那一年 / 那几年在世的" */
  const charsWhenText = () => (Yarg >= 0 ? `第 ${Yarg} 年在世的` : range ? `${range}在世过的` : '');
  const out: string[] = [];
  const hintNarrow = '用 country、year、role 或 limit 缩小范围';

  // ---- 按名字找 ----
  const name = nameArg(a.name);
  if (name) {
    const cid = given(a.country) ? polityOf(civ, a.country) : -1;
    if (given(a.country) && cid < 0) return { result: `找不到国家「${String(a.country)}」;请用材料里的编号(P3 这样)`, summary: '没找到' };
    type Hit = { exact: boolean; order: number; year: number; c?: AuthorCharacter; x?: Person };
    const hits: Hit[] = [];
    /** 列了的作者的人物(他即位当的君主不再另列一个:人物那一行已经写了在推演里即位) */
    const listed = new Set<number>();
    if (!role || role === 'author') {
      for (const c of chars) {
        const n = nameArg(c.name);
        if (!n.includes(name)) continue;
        if (cid >= 0 && charPolity(c) !== cid) continue;
        hits.push({ exact: n === name, order: 0, year: c.born, c });
        listed.add(c.id);
      }
    }
    if (role !== 'author') {
      const ORDER: Record<Person['role'], number> = { ruler: 1, minister: 2, general: 3, prince: 4 };
      for (const x of people) {
        if (!roleOk(x) || (cid >= 0 && x.polity !== cid)) continue;
        if (x.author !== undefined && listed.has(x.author)) continue;
        const names = [x.name, personName(civ, x), x.courtesy ?? '', x.defaultName ?? ''];
        if (x.role === 'ruler') names.push(rulerRef(civ, x, x.until !== undefined ? x.until - 1 / 512 : civ.endYear));
        const ns = names.map(nameArg).filter(Boolean);
        if (!ns.some((n) => n.includes(name))) continue;
        hits.push({ exact: ns.includes(name), order: ORDER[x.role], year: personSpan(x).from, x });
      }
    }
    hits.sort((p, q) => Number(q.exact) - Number(p.exact) || p.order - q.order || p.year - q.year);
    if (!hits.length)
      return {
        result: `没有名字里带「${name}」的${role ? ROLE_NAME[role] : '人物'}${cid >= 0 ? `(只找了 ${polityName(cid, Ynow)})` : ''}。名字对不上时可以按国家、年份列出来看。`,
        summary: '没找到',
      };
    const detail = hits.length <= DETAIL_MAX;
    const shown = hits.slice(0, limit);
    out.push(`名字里带「${name}」的${role ? ROLE_NAME[role] : '人物'} ${hits.length} 个${shown.length < hits.length ? `,列前 ${shown.length} 个(名字完全一样的在前)` : ''}:`);
    for (const h of shown) out.push(`- ${h.c ? charLine(h.c, detail) : personLine(h.x!, detail)}`);
    return { result: fitLines(out, LOOKUP_MAX, hintNarrow), summary: `找到 ${hits.length} 人` };
  }

  // ---- 按国家 ----
  if (given(a.country)) {
    const id = polityOf(civ, a.country);
    if (id < 0) return { result: `找不到国家「${String(a.country)}」;请用材料里的编号(P3 这样)`, summary: '没找到' };
    const p = P[id];
    const ix = peopleIndex(civ);
    const myChars = chars.filter((c) => charPolity(c) === id);
    const head = `P${id} ${nameAt(p, Yarg >= 0 ? Yarg : ctx.year)} · 第 ${F(p.founded)}—${p.ended !== undefined ? `${F(p.ended)} 年` : `${end} 年(到最后仍在)`}`;
    // 那一年:谁在位、谁在朝、谁领兵
    if (Yarg >= 0 && polityAlive(p, Yarg) && role !== 'author') {
      const Y = Yarg;
      out.push(`${head};第 ${Y} 年:`);
      let summary = '';
      /** 在位的君主是作者的人物即位当的:下面在世的作者的人物不再列他 */
      let crowned: number | undefined;
      if (!role || role === 'ruler') {
        const x = rulerAt(civ, id, Y);
        if (x) {
          crowned = x.author;
          out.push(`在位的:${personLine(x, true, Y)}`);
          summary = `第 ${Y} 年在位的是${personName(civ, x)}`;
          const rs = ix.rulers[id];
          const k = rs.indexOf(x);
          const prev = k > 0 ? rs[k - 1] : null;
          const next = k >= 0 && k + 1 < rs.length ? rs[k + 1] : null;
          if (prev || next)
            out.push(
              [prev ? `前任 ${personName(civ, prev)}(第 ${F(prev.from ?? prev.born)}—${F(prev.until ?? end)} 年)` : '', next ? `继任 ${personName(civ, next)}(第 ${F(next.from ?? next.born)} 年即位)` : '']
                .filter(Boolean)
                .join(';'),
            );
        } else {
          out.push('这一年没有在位的君主(君位空着,或者推演里没有这国的君主)');
          summary = `第 ${Y} 年没有在位的君主`;
        }
      }
      if (!role || role === 'minister') {
        const ms = ix.ministers[id].filter((x) => (x.from ?? x.born) <= Y && (x.until === undefined || Y < x.until));
        out.push(ms.length ? `在朝的名臣 ${ms.length} 位:` : '这一年没有在朝的名臣。');
        for (const x of ms.slice(0, limit)) out.push(`- ${personLine(x, false)} · 那年 ${ageAt(x, Y)} 岁`);
        if (role === 'minister') summary = `在朝的名臣 ${ms.length} 位`;
      }
      if (!role || role === 'general') {
        const gs = ix.generals[id].filter((x) => commanding(x, Y));
        out.push(gs.length ? `这一年领兵的将领 ${gs.length} 位:` : '这一年没有领兵的将领。');
        for (const x of gs.slice(0, limit)) out.push(`- ${personLine(x, false)}`);
        if (role === 'general') summary = `领兵的将领 ${gs.length} 位`;
      }
      if (role === 'prince') {
        const ps = people.filter((x) => x.role === 'prince' && x.polity === id && x.born <= Y && (x.died === undefined || Y <= x.died));
        out.push(ps.length ? `在世的宗室 ${ps.length} 位:` : '这一年没有在世的宗室。');
        for (const x of ps.slice(0, limit)) out.push(`- ${personLine(x, false)}`);
        summary = `宗室 ${ps.length} 位`;
      }
      if (!role) {
        const alive = myChars.filter((c) => c.id !== crowned && characterAge(c, Y).state === 'alive');
        if (alive.length) {
          out.push(`这国那年在世的作者的人物 ${alive.length} 个:`);
          for (const c of alive.slice(0, limit)) out.push(`- ${charLine(c, false)}`);
        }
      }
      return { result: fitLines(out, LOOKUP_MAX, hintNarrow), summary };
    }
    // 历代(或 from / to 这几年里的)
    if (Yarg >= 0 && !polityAlive(p, Yarg) && role !== 'author')
      out.push(`${head}。第 ${Yarg} 年它${Yarg < p.founded ? '还没立国' : '已经亡了'},下面列它的历代人物。`);
    else out.push(head);
    if (role === 'author') {
      const when = charsWhenText();
      const cs = charsWhen(myChars);
      out.push(cs.length ? `${when}作者的人物 ${cs.length} 个(国家写的这一国,或生在这一国):` : `这国没有${when}作者的人物。`);
      for (const c of cs.slice(0, limit)) out.push(`- ${charLine(c, cs.length <= DETAIL_MAX)}`);
      return { result: fitLines(out, LOOKUP_MAX, hintNarrow), summary: `作者的人物 ${cs.length} 个` };
    }
    if (role && role !== 'ruler') {
      const list =
        role === 'minister'
          ? ix.ministers[id]
          : role === 'general'
            ? ix.generals[id]
            : people.filter((x) => x.role === 'prince' && x.polity === id).sort((x, y) => x.born - y.born || x.id - y.id);
      const hit = list.filter(activeIn);
      const shown = hit.slice(0, limit);
      out.push(`${range}${ROLE_NAME[role]} 共 ${hit.length} 位${shown.length < hit.length ? `,列前 ${shown.length} 位(用 from、to 看后面的)` : ''}:`);
      for (const x of shown) out.push(`- ${personLine(x, hit.length <= DETAIL_MAX)}`);
      return { result: fitLines(out, LOOKUP_MAX, '用 from、to 缩小年份范围'), summary: `${ROLE_NAME[role]} ${hit.length} 位` };
    }
    const rulers = ix.rulers[id].filter(activeIn);
    // 太多的列最早的一半和最近的一半,中间的用 from、to 查
    const cut = rulers.length > limit;
    const early = cut ? rulers.slice(0, Math.ceil(limit / 2)) : rulers;
    const late = cut ? rulers.slice(rulers.length - Math.floor(limit / 2)) : [];
    out.push(
      `${range}历代君主 共 ${rulers.length} 位${cut ? `,列最早的 ${early.length} 位和最近的 ${late.length} 位` : ''}` +
        '(要看某一位的倾向、生平,用 name 查;要看某一年谁在位,加 year):',
    );
    const row = (x: Person) => {
      const fate = rulerFateWord(civ, x);
      const span = x.until !== undefined ? `第 ${F(x.from ?? x.born)}—${F(x.until)} 年` : `第 ${F(x.from ?? x.born)} 年起`;
      return `- ${span} ${personName(civ, x)}(${[riseText(civ, x), fate || (x.until === undefined ? '到最后仍在位' : '')].filter(Boolean).join(';')})`;
    };
    for (const x of early) out.push(row(x));
    if (cut) out.push(`- ……(中间 ${rulers.length - early.length - late.length} 位没列,用 from、to 查那几年)`);
    for (const x of late) out.push(row(x));
    if (!range) {
      const ms = ix.ministers[id].length;
      const gs = ix.generals[id].length;
      if (ms || gs) out.push(`名臣 ${ms} 位、将领 ${gs} 位(用 role 列出来)`);
      const fam = [...ix.generals[id]].map((x) => ({ x, f: personFame(civ, x) })).filter((v) => v.f);
      if (fam.length) out.push(`有名的将领:${fam.slice(0, 5).map((v) => `${v.x.name}(${v.f!.deeds})`).join('、')}`);
      if (myChars.length) out.push(`作者的人物 ${myChars.length} 个:${myChars.slice(0, 10).map((c) => c.name).join('、')}(用 role = author 看详细)`);
    }
    return { result: fitLines(out, LOOKUP_MAX, '用 from、to 缩小年份范围'), summary: `历代君主 ${rulers.length} 位` };
  }

  // ---- 只给年份:那年各国的君主(或名臣、将领) ----
  if (Yarg >= 0 && role !== 'author') {
    const Y = Yarg;
    if (!civ.viable) return { result: '这颗星球没有长出文明:没有国家和人物。', summary: '没有人物' };
    const own = owners(Y).polity;
    const size = new Map<number, number>();
    for (let r = 0; r < own.length; r++) if (own[r] >= 0) size.set(own[r], (size.get(own[r]) ?? 0) + 1);
    const alive = P.filter((p) => polityAlive(p, Y) && (size.get(p.id) ?? 0) > 0).sort((x, y) => (size.get(y.id) ?? 0) - (size.get(x.id) ?? 0) || x.id - y.id);
    if (role && role !== 'ruler') {
      const ix = peopleIndex(civ);
      const list = alive.flatMap((p) =>
        role === 'minister'
          ? ix.ministers[p.id].filter((x) => (x.from ?? x.born) <= Y && (x.until === undefined || Y < x.until))
          : role === 'general'
            ? ix.generals[p.id].filter((x) => commanding(x, Y))
            : people.filter((x) => x.role === 'prince' && x.polity === p.id && x.born <= Y && (x.died === undefined || Y <= x.died)),
      );
      const shown = list.slice(0, limit);
      out.push(`第 ${Y} 年各国${role === 'general' ? '领兵' : role === 'minister' ? '在朝' : '在世'}的${ROLE_NAME[role]} 共 ${list.length} 位${shown.length < list.length ? `,列前 ${shown.length} 位(国土大的国家在前)` : ''}:`);
      for (const x of shown) out.push(`- ${personLine(x, false)}`);
      return { result: fitLines(out, LOOKUP_MAX, hintNarrow), summary: `${list.length} 位${ROLE_NAME[role]}` };
    }
    const shown = alive.slice(0, limit);
    out.push(`第 ${Y} 年在世的国家 ${alive.length} 个${shown.length < alive.length ? `,列国土最大的 ${shown.length} 个` : ''},各国在位的君主:`);
    for (const p of shown) {
      const x = rulerAt(civ, p.id, Y);
      const who = x
        ? `${rulerRef(civ, x, Y)},第 ${F(x.from ?? x.born)} 年即位,在位第 ${Y - F(x.from ?? x.born) + 1} 年,${ageAt(x, Y)} 岁${x.leanings ? ` · 倾向 ${leaningsText(x.leanings)}` : ''}`
        : '没有在位的君主';
      out.push(`- P${p.id} ${nameAt(p, Y)}(${size.get(p.id)} 州):${who}`);
    }
    return { result: fitLines(out, LOOKUP_MAX, hintNarrow), summary: `${alive.length} 国的君主` };
  }

  // ---- 只给了身份(君主、将领、名臣、宗室;可加 from、to):全世界这一种人,最近的在前 ----
  if (role && role !== 'author') {
    if (!people.length) return { result: '推演里没有人物(这颗星球没有长出文明)。', summary: '没有人物' };
    const list = people.filter((x) => x.role === role && activeIn(x)).sort((x, y) => personSpan(y).from - personSpan(x).from || x.id - y.id);
    const shown = list.slice(0, limit);
    out.push(`推演里${range}的${ROLE_NAME[role]} 共 ${list.length} 位${shown.length < list.length ? `,列最近的 ${shown.length} 位(用 country、year 或 from、to 缩小)` : ''}:`);
    for (const x of shown) out.push(`- ${personLine(x, list.length <= DETAIL_MAX)}`);
    return { result: fitLines(out, LOOKUP_MAX, hintNarrow), summary: `${ROLE_NAME[role]} ${list.length} 位` };
  }

  // ---- 什么都没给(或只要作者的人物):作者的人物 + 推演里的名人 ----
  const when = charsWhenText();
  const cs = charsWhen(chars);
  out.push(
    cs.length ? `${when}作者的人物 ${cs.length} 个${cs.length > limit ? `,列前 ${limit} 个` : ''}:` : chars.length ? `没有${when}作者的人物(一共建了 ${chars.length} 个)。` : '作者还没有建人物。',
  );
  for (const c of cs.slice(0, limit)) out.push(`- ${charLine(c, cs.length <= DETAIL_MAX)}`);
  if (role !== 'author') {
    if (!people.length) out.push('推演里没有人物(这颗星球没有长出文明)。');
    else {
      const n = (r: Person['role']) => people.filter((x) => x.role === r).length;
      out.push(`推演里的人物:君主 ${n('ruler')} 位、将领 ${n('general')} 位、名臣 ${n('minister')} 位、宗室 ${n('prince')} 位(按名字、国家、年份查)`);
      const fam = famousPeople(civ);
      const shown = fam.slice(0, Math.min(limit, 20));
      if (shown.length) {
        out.push(`推演里的名人 ${fam.length} 位,列最近的 ${shown.length} 位:`);
        for (const f of shown) {
          const x = people[f.id];
          const s = personSpan(x);
          out.push(`- ${personName(civ, x)}(P${x.polity},${s.until !== null ? `第 ${F(s.from)}—${F(s.until)} 年` : `第 ${F(s.from)} 年起到最后`}):${fameLine(civ, x, f)}`);
        }
      }
    }
  }
  return { result: fitLines(out, LOOKUP_MAX, hintNarrow), summary: `作者的人物 ${cs.length} 个` };
}

// ---------------------------------------------------------------------------
// 查地块

/** 选中的一片 */
interface Area {
  /** 开头一行 */
  head: string;
  /** 这一片的地块(null = 整个世界) */
  cells: Int32Array | null;
  /** 那一年的州(地形大事以前按那时的划法;不是 civ.regions = 那一年在某次地形大事以前) */
  regions: Regions;
  /** 按哪一年说人口、归属、物产 */
  year: number;
  /** 整州整州选的(州、国家、陆块、整个世界):不用按地块折算人口 */
  whole: boolean;
  /** 是一个国家的国土(不再说归属) */
  polity?: number;
  /** 是一州(多说几句这州的事) */
  region?: number;
}

/** 查地块这一步的说法(界面上一行) */
export function landLabel(ctx: LookupContext, a: Record<string, unknown>): string {
  const { civ } = ctx;
  if (given(a.region)) {
    const r = regionOf(civ, a.region);
    return r >= 0 ? `查地块：${regionLabel(civ, r)}` : '查地块';
  }
  if (given(a.country)) {
    const id = polityOf(civ, a.country);
    return id >= 0 ? `查地块：${nameAt(civ.polities[id], given(a.year) ? yearArg(civ, a.year, ctx.year) : ctx.year)}` : '查地块';
  }
  if (given(a.landmass)) return /^[Ll]?0$/.test(String(a.landmass).trim()) ? '查地块：最大的大陆' : '查地块：一块陆地';
  const at = lonLatArg(a.at);
  if (at) {
    const km = Number(a.radius);
    return `查地块：${ll(at)}${km > 0 ? ` 周围 ${Math.round(Math.min(RADIUS_MAX, km))} 公里` : ''}`;
  }
  if (given(a.box)) return '查地块：地图上的一片';
  return '查地块：整个世界';
}

/** 第 y 年那一段地形里的州(地形大事以前的段见 Civ.eras;州的编号各段一样,地块也是同一套) */
function regionsAt(civ: Civ, y: number): Regions {
  for (const e of civ.eras ?? []) if (y < e.until) return e.regions;
  return civ.regions;
}

/** 州 → 地块 */
function regionCells(R: Regions, regions: readonly number[]): Int32Array {
  let n = 0;
  for (const r of regions) n += R.cellStart[r + 1] - R.cellStart[r];
  const out = new Int32Array(n);
  let k = 0;
  for (const r of regions) for (let i = R.cellStart[r]; i < R.cellStart[r + 1]; i++) out[k++] = R.cells[i];
  return out;
}

/** 查地块 */
export function lookupLand(ctx: LookupContext, a: Record<string, unknown>): LookupResult {
  const { world, civ } = ctx;
  const mesh = world.mesh;
  const owners = ownersCache(civ);
  const Y = yearArg(civ, a.year, ctx.year);
  /** 那一年的州(地形大事以前按那时的划法) */
  const R = regionsAt(civ, Y);

  // ---- 一片是哪些地块 ----
  let area: Area;
  if (given(a.region)) {
    const r = regionOf(civ, a.region);
    if (r < 0) return { result: `找不到州「${String(a.region)}」;请用材料里的编号(R45 这样)、州名或城名;没有名字的地方用 at 给经纬度`, summary: '没找到' };
    if (r >= R.count) return { result: `R${r} ${regionLabel(civ, r)} 第 ${Y} 年还没有(是后来地形大事里冒出来的陆地)。`, summary: '没有地块' };
    area = { head: `R${r} ${regionLabel(civ, r)}`, cells: regionCells(R, [r]), regions: R, year: Y, whole: true, region: r };
  } else if (given(a.country)) {
    const id = polityOf(civ, a.country);
    if (id < 0) return { result: `找不到国家「${String(a.country)}」;请用材料里的编号(P3 这样)`, summary: '没找到' };
    const p = civ.polities[id];
    const mine = (y: number) => {
      const own = owners(y).polity;
      const n = regionsAt(civ, y).count;
      const rs: number[] = [];
      for (let r = 0; r < own.length && r < n; r++) if (own[r] === id) rs.push(r);
      return rs;
    };
    let y = Y;
    let rs = mine(y);
    let note = '';
    if (!rs.length) {
      // 那一年它不在世(还没立国 / 已亡):按立国次年 / 亡国前最后一年
      y = Y < p.founded ? Math.min(F(civ.endYear), F(p.founded) + 1) : F(Math.min(p.ended !== undefined ? p.ended - 1 / 512 : civ.endYear, civ.endYear));
      rs = mine(y);
      note = `(第 ${Y} 年它${Y < p.founded ? '还没立国' : '已经亡了'},按第 ${y} 年算)`;
    }
    if (!rs.length) return { result: `P${id} ${nameAt(p, Y)} 在第 ${Y} 年前后没有国土。`, summary: '没有国土' };
    const Ry = regionsAt(civ, y);
    area = { head: `P${id} ${nameAt(p, y)} 第 ${y} 年的国土${note}:${rs.length} 州`, cells: regionCells(Ry, rs), regions: Ry, year: y, whole: true, polity: id };
  } else if (given(a.landmass)) {
    const m = /^[Ll]?(\d{1,4})$/.exec(String(a.landmass).trim());
    const id = m ? Number(m[1]) : -1;
    const rs: number[] = [];
    for (let r = 0; r < R.count; r++) if (R.landmass[r] === id) rs.push(r);
    if (!rs.length) return { result: `找不到陆块「${String(a.landmass)}」;请用材料里的编号(L0 这样)`, summary: '没找到' };
    area = { head: `L${id}${id === 0 ? ' 最大的大陆' : ''}(${rs.length} 州)`, cells: regionCells(R, rs), regions: R, year: Y, whole: true };
  } else if (given(a.at)) {
    // 给了却写错的不当作没给(不然会把整个世界的数当成那一处的)
    const at = lonLatArg(a.at);
    if (!at) return { result: 'at 要写成 [经度, 纬度](两个数)', summary: '参数不对' };
    const km = Math.min(RADIUS_MAX, Math.max(0, Number(a.radius) || 0));
    if (!(km > 0)) return cellReport(ctx, at, Y);
    const cs: number[] = [];
    for (let c = 0; c < mesh.n; c++) if (distKm(at, cellLL(world, c)) <= km) cs.push(c);
    if (!cs.length) return cellReport(ctx, at, Y);
    area = { head: `${ll(at)} 周围 ${Math.round(km)} 公里`, cells: Int32Array.from(cs), regions: R, year: Y, whole: false };
  } else if (given(a.box)) {
    const b = numsArg(a.box);
    if (!b || b.length !== 4) return { result: 'box 要写成 [西边的经度, 南边的纬度, 东边的经度, 北边的纬度](四个数)', summary: '参数不对' };
    const wrap = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
    // 东西跨满一圈 = 所有经度;东边写 180 的不折成 −180
    const round = Math.abs(b[2] - b[0]) >= 360;
    const west = wrap(b[0]);
    const east = wrap(b[2]) === -180 && b[2] > 0 ? 180 : wrap(b[2]);
    const south = Math.max(-90, Math.min(b[1], b[3]));
    const north = Math.min(90, Math.max(b[1], b[3]));
    const cs: number[] = [];
    for (let c = 0; c < mesh.n; c++) {
      const [lon, lat] = cellLL(world, c);
      if (lat < south || lat > north) continue;
      if (round || (west <= east ? lon >= west && lon <= east : lon >= west || lon <= east)) cs.push(c);
    }
    const lonText = round ? '经度 全部' : `经度 ${f1(west)} ~ ${f1(east)}${west > east ? '(跨 180° 经线)' : ''}`;
    const head = `${lonText}、纬度 ${f1(south)} ~ ${f1(north)} 这一片`;
    if (!cs.length) return { result: `${head}里没有地块(框太小了),框大一点,或者用 at 查一点。`, summary: '没有地块' };
    area = { head, cells: Int32Array.from(cs), regions: R, year: Y, whole: false };
  } else {
    area = { head: '整个世界', cells: null, regions: R, year: Y, whole: true };
  }
  return areaReport(ctx, area, owners);
}

/** 经纬度一点:离它最近的那一块地 */
function cellReport(ctx: LookupContext, at: [number, number], Y: number): LookupResult {
  const { world, civ } = ctx;
  const c = nearestCell(world, at);
  if (c < 0) return { result: '这个世界没有地块。', summary: '没有地块' };
  const w = world.water[c];
  const kind = w === 1 ? '海洋' : w === 2 ? '湖泊' : '陆地';
  const e = world.elevation[c];
  const out: string[] = [];
  const height = w === 0 ? `海拔 ${Math.round(e)} 米` : w === 2 ? `湖面海拔 ${Math.round(world.waterLevel[c])} 米` : `水深 ${Math.round(-e)} 米`;
  out.push(
    `${ll(at)} 最近的地块 ${ll(cellLL(world, c))}:${kind} · ${height} · 年均气温 ${f1(world.temperature[c])}°C · 年降水 ${Math.round(world.precipitation[c])} 毫米 · 地形 ${BIOMES[world.biome[c]]?.name ?? '未知'}` +
      (w === 1 && world.seaIce[c] >= 0.5 ? ' · 结着海冰' : ''),
  );
  const r = w === 0 ? regionsAt(civ, Y).of[c] : -1;
  if (r >= 0) {
    const o = civ.viable ? (Y >= civ.endYear ? civ.polity : ownersAt(civ, Y).polity)[r] : -1;
    out.push(
      `在 R${r} ${regionLabel(civ, r)}${civ.viable ? `,第 ${Y} 年${o >= 0 ? `属 P${o} ${nameAt(civ.polities[o], Y)}` : '无主'}` : ''};要看这一州的汇总用 region 查,看周围一圈加 radius(公里)。`,
    );
  } else out.push('要看周围一圈加 radius(公里)。');
  return {
    result: out.join('\n'),
    summary: w === 0 ? `海拔 ${Math.round(e)} 米，年均 ${f1(world.temperature[c])}°C，年降水 ${Math.round(world.precipitation[c])} 毫米` : `${kind}`,
  };
}

/** 一片的汇总 */
function areaReport(ctx: LookupContext, area: Area, owners: (y: number) => Owners): LookupResult {
  const { world, civ } = ctx;
  const { mesh, elevation, water, temperature, precipitation, biome } = world;
  const R = area.regions;
  /** 那一年在某次地形大事以前:州按那时划,地形的数只有现在的 */
  const early = R !== civ.regions;
  const Y = area.year;
  const n = area.cells ? area.cells.length : mesh.n;
  const cellAt = (i: number) => (area.cells ? area.cells[i] : i);
  if (!n)
    return {
      result: `${area.head}:没有地块${area.region !== undefined ? '(这一州在地形大事里整个没进了水里)' : ''}。`,
      summary: '没有地块',
    };

  // ---- 按面积加权(地图上的地块按纬度 cos 折实际面积) ----
  let wAll = 0;
  let wLand = 0;
  let wSea = 0;
  let wLake = 0;
  let eSum = 0;
  let eMin = Infinity;
  let eMax = -Infinity;
  let eTop = -1;
  let dSum = 0;
  let dMax = 0;
  const tAll = { s: 0, lo: Infinity, hi: -Infinity };
  const tLand = { s: 0, lo: Infinity, hi: -Infinity };
  const pAll = { s: 0, lo: Infinity, hi: -Infinity };
  const pLand = { s: 0, lo: Infinity, hi: -Infinity };
  const bio = new Float64Array(BIOMES.length);
  const add = (acc: { s: number; lo: number; hi: number }, v: number, w: number) => {
    acc.s += v * w;
    if (v < acc.lo) acc.lo = v;
    if (v > acc.hi) acc.hi = v;
  };
  /** 州 → 这一片里有它几块地 */
  const inRegion = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const c = cellAt(i);
    const lat = 90 - (mesh.y[c] / world.height) * 180;
    const w = Math.max(0.02, Math.cos(lat * RAD));
    wAll += w;
    const t = temperature[c];
    const p = precipitation[c];
    add(tAll, t, w);
    add(pAll, p, w);
    if (biome[c] < bio.length) bio[biome[c]] += w;
    if (water[c] === 0) {
      wLand += w;
      const e = elevation[c];
      eSum += e * w;
      if (e < eMin) eMin = e;
      if (e > eMax) {
        eMax = e;
        eTop = c;
      }
      add(tLand, t, w);
      add(pLand, p, w);
    } else if (water[c] === 1) {
      wSea += w;
      dSum += -elevation[c] * w;
      if (-elevation[c] > dMax) dMax = -elevation[c];
    } else wLake += w;
    // 州按那一年的划法:大事以前是陆地、后来没进水里的地块也算它那州的
    if (water[c] === 0 || early) {
      const r = R.of[c];
      if (r >= 0 && r < R.count) inRegion.set(r, (inRegion.get(r) ?? 0) + 1);
    }
  }
  const pc = (v: number) => {
    const x = (v / (wAll || 1)) * 100;
    return x > 0 && x < 1 ? '不到 1%' : `${Math.round(x)}%`;
  };
  const out: string[] = [area.head];
  if (early) out.push(`第 ${Y} 年在一次地形大事以前:州、国土按那时的划法;海拔、气温、降水、地形只有现在的数(大事以后的样子)。`);
  const kinds = [wLand ? `陆地 ${pc(wLand)}` : '', wSea ? `海洋 ${pc(wSea)}` : '', wLake ? `湖泊 ${pc(wLake)}` : ''].filter(Boolean);
  out.push(`地块 ${n} 块(按面积:${kinds.join('、')})`);
  const land = wLand > 0;
  if (land) out.push(`海拔(陆地):平均 ${Math.round(eSum / wLand / 10) * 10} 米,最低 ${Math.round(eMin)} 米,最高 ${Math.round(eMax)} 米(最高处在 ${ll(cellLL(world, eTop))})`);
  if (wSea > 0) out.push(`海深:平均 ${Math.round(dSum / wSea / 10) * 10} 米,最深 ${Math.round(dMax)} 米`);
  const t = land ? tLand : tAll;
  const p = land ? pLand : pAll;
  const wT = land ? wLand : wAll;
  const on = land && (wSea > 0 || wLake > 0) ? '(陆地)' : '';
  out.push(`年均气温${on}:平均 ${f1(t.s / wT)}°C,最低 ${f1(t.lo)}°C,最高 ${f1(t.hi)}°C`);
  out.push(`年降水${on}:平均 ${Math.round(p.s / wT / 10) * 10} 毫米,最少 ${Math.round(p.lo)} 毫米,最多 ${Math.round(p.hi)} 毫米`);
  const bAll = [...bio.keys()].filter((b) => bio[b] > 0).sort((x, y) => bio[y] - bio[x] || x - y);
  const bs = bAll.slice(0, 7).map((b) => `${BIOMES[b].name} ${pc(bio[b])}`);
  // 排不进前七的合成一项,占比加起来还是一百
  const rest = bAll.slice(7);
  if (rest.length) bs.push(`另有 ${rest.map((b) => BIOMES[b].name).join('、')} 共 ${pc(rest.reduce((s, b) => s + bio[b], 0))}`);
  out.push(`地形(按面积):${bs.join('、')}`);

  // ---- 文明:人口、城、归属、物产 ----
  if (civ.viable && inRegion.size) {
    const regs = [...inRegion.keys()].sort((x, y) => x - y);
    /** 这一片占这州的几成(整州选的 = 1) */
    const frac = (r: number) => (area.whole ? 1 : Math.min(1, (inRegion.get(r) ?? 0) / Math.max(1, R.cellStart[r + 1] - R.cellStart[r])));
    const own = owners(Y);
    // 一州:归属、民族、时代、城
    if (area.region !== undefined) {
      const r = area.region;
      const o = own.polity[r] ?? -1;
      const cu = own.culture[r] ?? -1;
      const parts = [`在 L${R.landmass[r]},治所 ${ll(cellLL(world, R.seat[r]))}`, `第 ${Y} 年${o >= 0 ? `属 P${o} ${nameAt(civ.polities[o], Y)}` : '无主'}`];
      if (cu >= 0 && civ.cultures[cu]) parts.push(`住着 E${cu} ${civ.cultures[cu].name}族`);
      const dev = civ.development;
      if (dev && dev.snaps.length && cu >= 0) parts.push(`${ERAS[eraOf(eraLevel(developmentAt(dev, Y), r)).era]}时代`);
      out.splice(1, 0, parts.join(' · '));
    }
    let pop = 0;
    for (const r of regs) pop += regionPopulationAt(civ, r, Y) * frac(r);
    const S = civ.settlements;
    const inArea = new Set(area.cells ?? []);
    const cities = S.filter(
      (s) => s.founded <= Y && (s.ended === undefined || Y < s.ended) && inRegion.has(s.region) && (area.whole || !area.cells || inArea.has(s.cell)),
    ).sort((x, y) => populationAt(y, Y) - populationAt(x, Y) || x.id - y.id);
    const popWords = pop >= 100000 ? `约 ${f1(pop / 100000)} 亿人` : pop > 0 ? populationLabel(pop) : '没有人';
    const top = regs.length > 1 ? regs.filter((r) => regionPopulationAt(civ, r, Y) * frac(r) > 0).sort((x, y) => regionPopulationAt(civ, y, Y) * frac(y) - regionPopulationAt(civ, x, Y) * frac(x) || x - y) : [];
    out.push(
      `人口(第 ${Y} 年${area.whole ? '' : ',州的人口按落在这一片的地块折算'}):${popWords}` +
        (top.length ? `;最多的州:${top.slice(0, 5).map((r) => `R${r} ${regionLabel(civ, r)} ${populationLabel(regionPopulationAt(civ, r, Y) * frac(r))}`).join('、')}` : ''),
    );
    if (cities.length)
      out.push(`城 ${cities.length} 座${cities.length > 1 ? ',最大的' : ''}:${cities.slice(0, 3).map((s) => `C${s.id} ${s.name} ${populationLabel(populationAt(s, Y))}`).join('、')}`);
    else out.push(`第 ${Y} 年这一片没有城。`);
    // 归属(不是按一国选的)
    if (area.polity === undefined && area.region === undefined) {
      const by = new Map<number, number>();
      let tot = 0;
      for (const r of regs) {
        const k = inRegion.get(r) ?? 0;
        tot += k;
        by.set(own.polity[r] ?? -1, (by.get(own.polity[r] ?? -1) ?? 0) + k);
      }
      const rows = [...by.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]);
      const share = (k: number) => {
        const x = (k / (tot || 1)) * 100;
        return x > 0 && x < 1 ? '不到 1%' : `${Math.round(x)}%`;
      };
      out.push(
        `第 ${Y} 年陆地归属(按地块):${rows
          .slice(0, 6)
          .map(([o, k]) => `${o >= 0 ? `P${o} ${nameAt(civ.polities[o], Y)}` : '无主'} ${share(k)}`)
          .join('、')}${rows.length > 6 ? ` 等 ${rows.length} 家` : ''}`,
      );
    }
    // 物产
    const dev = civ.development;
    if (dev && dev.resources.length >= R.count * RESOURCE_COUNT) {
      const use = resourcesAt(dev, Y);
      const LV = ['', '少', '中', '多'];
      const inUse = (r: number, k: number) => use[r * RESOURCE_COUNT + k] > 0.05;
      if (early) {
        // 储量按最后一次地形大事以后的地形记,那时的没有:只说那一年在用的(快照里有)
        const why = '那时在地形大事以前,储量没有记';
        if (area.region !== undefined) {
          const r = area.region;
          const items: string[] = [];
          for (let k = 0; k < RESOURCE_COUNT; k++)
            if (inUse(r, k)) items.push(`${RESOURCES[k]}(约${LV[Math.min(3, Math.max(1, Math.round(use[r * RESOURCE_COUNT + k])))]})`);
          out.push(items.length ? `物产(第 ${Y} 年在用的;${why}):${items.join('、')}` : `物产:第 ${Y} 年这一州没有在用的物产(${why})。`);
        } else {
          const items: string[] = [];
          for (let k = 0; k < RESOURCE_COUNT; k++) {
            const used = regs.filter((r) => inUse(r, k)).length;
            if (used) items.push(`${RESOURCES[k]} ${used} 州`);
          }
          out.push(items.length ? `物产(第 ${Y} 年在用这样物产的州数;${why}):${items.join('、')}` : `物产:第 ${Y} 年这一片没有在用的物产(${why})。`);
        }
      } else if (area.region !== undefined) {
        const r = area.region;
        const items: string[] = [];
        for (let k = 0; k < RESOURCE_COUNT; k++) {
          const lv = dev.resources[r * RESOURCE_COUNT + k];
          if (!lv) continue;
          const found = dev.found[r * RESOURCE_COUNT + k] <= Y;
          items.push(`${RESOURCES[k]} ${LV[lv] ?? lv}(${found ? (use[r * RESOURCE_COUNT + k] > 0.05 ? '在用' : '已发现、用不上了') : '还没发现'})`);
        }
        out.push(items.length ? `物产(储量;括号里是第 ${Y} 年的情形):${items.join('、')}` : '物产:这一州没有什么物产。');
      } else {
        const items: string[] = [];
        for (let k = 0; k < RESOURCE_COUNT; k++) {
          let has = 0;
          let rich = 0;
          let used = 0;
          for (const r of regs) {
            const lv = dev.resources[r * RESOURCE_COUNT + k];
            if (!lv) continue;
            has++;
            if (lv >= 3) rich++;
            if (use[r * RESOURCE_COUNT + k] > 0.05) used++;
          }
          if (has) items.push(`${RESOURCES[k]} ${has} 州(多 ${rich},在用 ${used})`);
        }
        // 物产按州记:框选、圈选只盖到一州的一部分时,也算这一州(说明一句)
        const partial = !area.whole && regs.some((r) => frac(r) < 1);
        const scope = partial ? `这一片盖到的 ${regs.length} 州(有的只盖到一部分)里` : '';
        out.push(
          items.length
            ? `物产(${scope}有这样物产的州数;多 = 储量多的,在用 = 第 ${Y} 年已发现、还能用的):${items.join('、')}`
            : `物产:${scope || '这一片'}没有什么物产。`,
        );
      }
    }
  } else if (civ.viable && land) out.push('这一片的陆地不属于任何一州(太小或住不了人)。');
  else if (!civ.viable) out.push('这颗星球没有长出文明:没有人口、城和物产。');

  const summary = land
    ? `平均海拔 ${Math.round(eSum / wLand / 10) * 10} 米，年均 ${f1(t.s / wT)}°C，年降水 ${Math.round(p.s / wT / 10) * 10} 毫米`
    : wSea > 0
      ? `海洋，平均水深 ${Math.round(dSum / wSea / 10) * 10} 米`
      : '湖泊';
  return { result: fitLines(out, LOOKUP_MAX, '换小一点的范围再查'), summary };
}
