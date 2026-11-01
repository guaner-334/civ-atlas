/**
 * 要打开的世界(Target)和围着它的几样小东西,App 和 ./useWorldLoad.ts 都用:
 *   - Target 从哪来:存着的(storedTarget)、新建中的(draftTarget、yearsEdits)、朋友的预设链接打开的新建弹窗(presetDialog)
 *   - 写进网址:这个世界(writeWorldUrl)、回我的世界(writeHomeUrl)、作品墙(writeGalleryUrl)
 *   - 推文明的请求里带的地形大事、地名风格、推演年数、拓荒起源天灾规则(upsOpt、namesOpt、yearsOpt、setupOpt;这一步带哪些见 yearsFor、setupFor)
 *   - 打开网页时去哪(FirstRoute)、作品墙那一页(WallView)、新建弹窗、分享说明、世界作品、分享短链接那一页的状态类型
 */
import { DEFAULT_PARAMS, type WorldParams } from '../../gen/world';
import type { Civ } from '../../gen/civ/types';
import { polityAlive } from '../../gen/civ/growth';
import { cleanCalamity, type Calamity } from '../../gen/civ/calamity';
import { cleanFrontier, cleanOrigins, sameFrontier, sameOrigins, type Frontier, type Origins } from '../../gen/civ/frontier';
import { EMPTY_EDITS, GENERATOR_VERSION, cleanCivSeed, cleanEndYear, endParamOf, type Upheaval, type WorldEdits } from '../../gen/edits';
import { ruleTuning, worldRules, type RuleSet } from '../../gen/civ/ruleSet';
import type { TuningValues } from '../../gen/civ/tuning';
import type { NameMix } from '../../gen/names/mix';
import { GEN_KEY, worldKey, type ResolvedMoment, type SaveFile, type SaveMoment, type SaveOrigin, type SaveView } from '../../gen/savefile';
import { galleryHref, type GalleryItem } from '../../account/gallery';
import { AREA_KEYS } from '../areaLink';
import { navUrl, type NavState } from '../nav';
import type { NewWorldInit, NewWorldMode } from '../NewWorldDialog';
import { OWN_KEY } from '../oldSite';
import type { SharedPreset } from '../presetStore';
import { randomSeedValue } from '../homeStart';
import { isStored, loadWorld, newWorldId, type StoredWorld, type WorldKind } from '../saveStore';
import type { DraftBase, Stage } from '../stageStore';
import { showToast } from '../Toast';

/** 一个要打开的世界:生成(或直接用正在看的这一个)→ 套上修改 → 交给 saveStore 自动存 */
export interface Target {
  id: string;
  kind: WorldKind;
  params: WorldParams;
  edits: WorldEdits;
  /** 已经存下的修改(套上的和它是同一个对象就不重写) */
  saved?: WorldEdits;
  title?: string;
  /** 新建中、作者还没动过(不存) */
  pristine?: boolean;
  /** 以某个世界为底稿新建 */
  base?: DraftBase | null;
  /** 换成存档里的投影和中央经线(undefined = 不动;null = 等距圆柱、0°) */
  view?: SaveView | null;
  /** 从哪打开的(生成完的提示按它说) */
  from?: 'file' | 'link' | 'stored' | 'restore' | 'url';
  /** 网址里带的生成器版本(from = 'url':打开带种子的网址) */
  gen?: number;
  /** 打开的存档(核对版本、地形) */
  save?: SaveFile;
  /** 读档时的警告 */
  warnings?: string[];
  /** 从分享短链接打开的:它的码(还没存进我的世界时留在网址里,刷新再取一次,看到分享的人最新的改动) */
  shareCode?: string;
  /** 从作品墙打开的世界作品:作品编号(还没存进我的世界时留在网址里,刷新再取一次) */
  gallery?: string;
  /** 分享链接带着的"打开时看哪"(停在哪一年、选中什么、镜头;gen/savefile.ts 的 SaveMoment) */
  moment?: SaveMoment | null;
  /** 底稿出处(存档里带着的;打开别人的分享短链接时是那个链接,改了另存时写进去) */
  origin?: SaveOrigin | null;
  /** 新建时选的照手绘图生成(还没照图长出星球时靠它认;存下以后看草图里有没有那张图) */
  mode?: 'image';
  /**
   * 在旧版本建的世界的地图上打造文明:那个世界存的地形校验。生成出来的地图和它对不上(现在的版本算出来不一样了)就不让打造
   */
  mapCheck?: string;
  /**
   * 照故事找世界选中的一个结果(新建中的世界换成它):推文明带上拓荒、起源、「天灾」(新建界面平时一律按默认推),
   * 和搜的时候推的一模一样
   */
  fullCiv?: true;
}

/**
 * 作品墙盖在我的世界的位置上(和分享停了那一页一样):
 *   list  作品墙那一页(preset = 开着的新建参数作品,打开它的网址时)
 *   work  打开一个作品的网址:正在取 / 撤下了 / 取不到
 *   map   地图作品:整屏一颗星球
 * 世界作品打开就是平常的世界(只是看看,左上一条写作品;见 App 的 workFor)
 */
export type WallView = { kind: 'list'; preset?: GalleryItem } | { kind: 'work'; id: string; state: 'loading' | 'gone' | { error: string } } | { kind: 'map'; work: GalleryItem };

/** 打开网页时去哪(App 的 firstRoute 算一次):我的世界 / 新建 / 某个世界;gone = 要回的世界已经删掉了(世界名);dialog = 开着新建弹窗 */
export type FirstRoute = { stage: Stage; target: Target | null; gone?: string; dialog?: NewWorldInit };

/** 「新建世界」弹窗:从哪一步开始、朋友分享的预设(作品墙上的新建参数作品也是)、stamp = 新开一个(开着的那个里填的东西不留) */
/** rules = 这个世界用哪一套规则先选好(别人分享的规则「用它新建世界」;本机「我的规则」里的,带本机编号) */
export type NewDlg = { init?: NewWorldInit; shared?: SharedPreset; rules?: RuleSet; stamp?: number };

/** 打开别人分享的世界时地图下那条说明(App 的 sharedFor):哪个世界、短链接还是长链接、署名;at = 链接带着"这一刻"、打开停在了那里 */
export type SharedFor = { id: string; short: boolean; by: string; own: boolean; at?: { year: number; sel: ResolvedMoment['selected'] | null } | null };

/** 正在看的世界是从作品墙打开的世界作品:那个世界的编号和作品(App 的 workFor) */
export type WorkFor = { id: string; work: GalleryItem };

/** 分享短链接:正在取 / 停了 / 打不开(取到了 = null) */
export type Landing = 'loading' | 'gone' | { error: string } | null;

/** 新建中的世界是哪一种:照手绘图(选的就是它,或者草图里有照着长的图;旧的没建完的世界也这样认)/ 随机 */
export function draftModeOf(t: Target | null): NewWorldMode {
  // 在一张地图上打造文明(地图锁着):不管地图是不是照手绘图长的,都是「打造文明」那一页
  if (t?.edits.map) return 'random';
  return t && (t.mode === 'image' || !!t.edits.sketch?.image) ? 'image' : 'random';
}

/** 存着的一个世界(刷新页面回到它时投影照网址,不换) */
export function storedTarget(w: StoredWorld, from: 'stored' | 'restore'): Target {
  return {
    id: w.id,
    kind: w.draft ? 'draft' : 'created',
    params: w.save.params,
    edits: w.save.edits,
    saved: w.save.edits,
    title: w.save.title,
    base: w.base ?? null,
    pristine: false,
    view: from === 'restore' ? undefined : (w.save.view ?? null),
    from,
    save: w.save,
    origin: w.save.origin ?? null,
  };
}

/** 新建时只定了推演年数(3000 = 什么都没有)、拓荒(默认 = 什么都没有)、规则(官方 = 什么都没有)的修改 */
export function yearsEdits(endYear: number | undefined, frontier?: Frontier, rules?: RuleSet): WorldEdits {
  const y = cleanEndYear(endYear);
  const f = cleanFrontier(frontier);
  const r = worldRules(rules);
  return y || f || r ? { ...EMPTY_EDITS, ...(y ? { endYear: y } : {}), ...(f ? { frontier: f } : {}), ...(r ? { rules: r } : {}) } : EMPTY_EDITS;
}

/** 一个新建中的世界(还没动过) */
export function draftTarget(params: WorldParams, base: DraftBase | null = null, edits: WorldEdits = EMPTY_EDITS, title?: string): Target {
  return { id: newWorldId(), kind: 'draft', params, edits, pristine: true, base, title };
}

/** 朋友的预设链接打开的新建弹窗:第 2 步(随机生成),参数照链接填好;没带种子的随机给一个 */
export function presetDialog(p: SharedPreset): { init: NewWorldInit; shared: SharedPreset } {
  return { init: { mode: 'random', params: { ...p.params, seed: p.seed ?? randomSeedValue() }, step: 2, endYear: p.endYear }, shared: p };
}

/**
 * 把世界写进网址:种子 + 参数(和默认值相同的省略,别人打开是同一颗星球);存着的加 w=编号,新建中还没存的加 new=1
 * (照手绘图新建、还没照图长出星球的加 new=image)
 */
export function writeWorldUrl(t: Target) {
  const q = new URLSearchParams(location.search);
  for (const k of Object.keys(DEFAULT_PARAMS) as (keyof WorldParams)[]) {
    if (k === 'seed' || t.params[k] !== DEFAULT_PARAMS[k]) q.set(k, String(t.params[k]));
    else q.delete(k);
  }
  q.delete('w');
  q.delete('new');
  q.delete('s');
  q.delete('gallery');
  q.delete(OWN_KEY);
  // 分享短链接、作品墙打开的、还没存进我的世界:码 / 作品编号留在网址里(刷新再取一次)
  if (t.shareCode && t.kind === 'visit' && !isStored(t.id)) q.set('s', t.shareCode);
  if (t.gallery && t.kind === 'visit' && !isStored(t.id)) q.set('gallery', t.gallery);
  // 存着的记录还是换参数之前的(新建中换了种子、参数,正在生成):先不指向它,存好了再换成 w=
  const w = isStored(t.id) ? loadWorld(t.id) : null;
  if (w && worldKey(w.save.params) === worldKey(t.params)) q.set('w', t.id);
  else if (t.kind === 'draft') q.set('new', draftModeOf(t) === 'image' && !t.edits.sketch?.image ? 'image' : '1');
  // 还没存下的新建:弹窗里开的推演年数也写上(存下以后在存档里)
  const years = q.has('new') ? cleanEndYear(t.edits.endYear) : undefined;
  if (years) q.set('years', String(years));
  else q.delete('years');
  // 生成器版本:复制这个网址发给别人,以后版本更新了对方打开会说清变了什么。
  // 网址来自更新的版本(页面是旧的)就留着那个号:刷新还是旧页面照样提示,换到新页面就对上了。
  // 新建中还没存的(new=1)不带:打开这种网址是接着新建,用的总是现在的版本
  if (q.has('new')) q.delete(GEN_KEY);
  else q.set(GEN_KEY, String(t.gen !== undefined && t.gen > GENERATOR_VERSION ? t.gen : GENERATOR_VERSION));
  const next = `?${q}`;
  if (next !== location.search) navUrl(next);
}

/** 回到"我的世界"时网址里去掉的:这个世界(种子、参数、编号、年份……) */
export const HOME_DROP = [...Object.keys(DEFAULT_PARAMS), 'w', 'new', 'years', 's', GEN_KEY, 'civYear', 'play', 'chron', ...AREA_KEYS];

/** 回到"我的世界":网址里去掉这个世界(种子、参数、编号、年份……)、作品墙,留着图层、投影这些看法 */
export function writeHomeUrl() {
  const q = new URLSearchParams(location.search);
  for (const k of [...HOME_DROP, 'gallery']) q.delete(k);
  const rest = q.toString();
  navUrl(rest ? `?${rest}` : location.pathname);
}

/** 作品墙那一页(id = '')/ 一个作品的网址:世界的种子、参数这些去掉,图层、投影这些看法留着 */
export function writeGalleryUrl(id: string) {
  navUrl(galleryHref(location.pathname, location.search, id, HOME_DROP));
}

/** 还在 b 那个画面(同一个画面里开卡片多记的几步也算);去解开 / 取回分享的世界,拿到时看一眼 */
export function sameScreen(a: NavState | null, b: NavState | null): boolean {
  return !!a && !!b && a.bare === b.bare && a.page === b.page && a.id === b.id;
}

/** 按后退 / 前进要回的世界已经删掉了(停在我的世界) */
export function goneToast(title: string | undefined) {
  showToast({ id: 'nav-gone', kind: 'warn', text: `回不到「${title || '未命名世界'}」`, more: ['这个世界已经删掉了'] });
}

/** 请求里带的地形大事(没有 = 不带) */
export const upsOpt = (u: readonly Upheaval[] | undefined) => (u?.length ? { upheavals: [...u] } : {});
/** 推文明时带的地名风格(自动 = 不带) */
export const namesOpt = (names: NameMix | undefined) => (names ? { names } : {});
/** 推文明时带的推演年数(3000 = 不带) */
export const yearsOpt = (endYear: number | undefined) => (endYear ? { endYear } : {});
/**
 * 这一步要推到第几年(3000 = undefined):新建界面里只看星球,一律先推 3000 年(换种子、调参数不用等);
 * 创建以后再按世界自己的推演年数接着推(App 里干预、地形大事变了就重推的那段)
 */
export const yearsFor = (draft: boolean, edits: Pick<WorldEdits, 'endYear' | 'endTick'>) => (draft ? undefined : endParamOf(edits));
/** 推文明时带的拓荒、起源、文明种子、「天灾」、规则里改过的规则项(默认 = undefined) */
export type CivSetup = { frontier?: Frontier; origins?: Origins; civSeed?: number; calamity?: Calamity; tuning?: TuningValues };
export const setupOpt = (s: CivSetup | undefined) => ({
  ...(s?.frontier ? { frontier: s.frontier } : {}),
  ...(s?.origins ? { origins: s.origins } : {}),
  ...(s?.civSeed !== undefined ? { civSeed: s.civSeed } : {}),
  ...(s?.calamity ? { calamity: s.calamity } : {}),
  ...(s?.tuning ? { tuning: s.tuning } : {}),
});
/**
 * 这一步带的拓荒、起源、文明种子、「天灾」、规则:拓荒、起源、天灾、规则和推演年数一样,新建界面里只看星球、一律按默认推,创建以后按世界自己的;
 * 文明种子新建界面里就带着(星球上的地名、选起源时的州名照它长)。规则只带推演用的那部分(改过的规则项;名字、地貌的叫法不改历史)
 */
export function setupFor(draft: boolean, edits: Pick<WorldEdits, 'frontier' | 'origins' | 'civSeed' | 'calamity' | 'rules'>): CivSetup | undefined {
  const civSeed = cleanCivSeed(edits.civSeed);
  if (draft) return civSeed !== undefined ? { civSeed } : undefined;
  const frontier = cleanFrontier(edits.frontier);
  const origins = cleanOrigins(edits.origins);
  const calamity = cleanCalamity(edits.calamity);
  const tuning = ruleTuning(edits.rules);
  return frontier || origins || civSeed !== undefined || calamity || tuning
    ? { ...(frontier ? { frontier } : {}), ...(origins ? { origins } : {}), ...(civSeed !== undefined ? { civSeed } : {}), ...(calamity ? { calamity } : {}), ...(tuning ? { tuning } : {}) }
    : undefined;
}
export const sameSetup = (a: CivSetup | undefined, b: CivSetup | undefined) =>
  sameFrontier(a?.frontier, b?.frontier) &&
  sameOrigins(a?.origins, b?.origins) &&
  a?.civSeed === b?.civSeed &&
  a?.calamity === b?.calamity &&
  JSON.stringify(a?.tuning ?? null) === JSON.stringify(b?.tuning ?? null);

/** 结束那一年现存几国(我的世界的卡片上写;没长出文明 = 0) */
export function aliveAtEnd(civ: Civ): number {
  return civ.viable ? civ.polities.filter((x) => polityAlive(x, civ.endYear)).length : 0;
}
