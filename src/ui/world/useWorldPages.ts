/**
 * 作品墙、新建世界、回我的世界、按新版另存一份(App 用;生成、打开世界见 ./useWorldLoad.ts):
 *   - 作品墙       去作品墙那一页、打开一个作品(世界作品只是看看、地图作品整屏一颗星球、新建参数作品弹窗)、世界作品「另存一份接着改」
 *   - 新建世界     弹窗、换种子、调参数、起名、创建世界(从此锁住、一直存着)、保存地图;以正在看的世界为底稿新建;
 *                  在一个世界(或只存了地图的那一份)的地图上打造新文明(连同用新版规则另存一份重推);新建卡片左上的返回;
 *                  别人分享的规则「用它新建世界」(新建弹窗,规则选好那一套)
 *   - 回我的世界   showHome
 *   - 按新版另存   照原样打开的旧世界「按新版另存一份」;改历史前先问(setHistoryGate)
 *   - 先出来的首页上点的那一件、云同步要的打开 / 回我的世界、正在看的世界改了名记进浏览器的那一步
 * App 的状态按块传进来(见 ./worldRefs.ts);这里的函数每次渲染新建(和原来写在 App 里一样)。
 * useWorldLoad 经 ref 调的几样(回我的世界、按新版另存、作品墙)在这里填 .current
 */
import { useEffect, useRef } from 'react';
import type { WorkerRequest } from '../../worker';
import { DEFAULT_PARAMS, type WorldParams } from '../../gen/world';
import { EMPTY_EDITS, GENERATOR_VERSION, civSeedOf, cleanEndYear, cleanPlay, endParamOf, newHistoryEdits, type WorldEdits } from '../../gen/edits';
import type { RuleSet } from '../../gen/civ/ruleSet';
import { cleanTitle, parseSave, worldKey, type SaveFile, type SaveOrigin } from '../../gen/savefile';
import { startStepwise } from '../../gen/stepwise';
import { copyNotes } from '../../ai/library';
import { fetchWork, isWorkGone, isWorkId, loadGallery, workLink, type GalleryItem, type GalleryWork } from '../../account/gallery';
import { ServerError, serverBase } from '../../account/server';
import { setReloadHandler, startSync } from '../../account/sync';
import { setGoHome } from '../AccountDialogs';
import { newConversation } from '../assistantStore';
import { getCivTime, pausePlayback, resetCivTime, setCivTime, startCivReplay, takeAutoplay } from '../civView';
import { clearEditHistory, getEdits, putEditsQuiet, setHistoryGate } from '../editsStore';
import { askSaveAsNew, closeSaveAsNew, setSaveAsNew } from '../FrozenWorld';
import { workWho } from '../Gallery';
import { randomSeedValue, type HomeStart } from '../homeStart';
import { beginImport } from '../ImportImage';
import { showMapInWorlds } from '../MyWorlds';
import { navBack, navReplace, navTitle, navTo } from '../nav';
import { setNewCivHandler, setOpenWorldHandler } from '../newCivAction';
import type { NewWorldStart } from '../NewWorldDialog';
import { openOverview } from '../overviewStore';
import { chosenGallery, getPresets, pickSharedPreset, rememberLast, type SharedPreset } from '../presetStore';
import { noteRulesUsed } from '../rulesStore';
import { setNewWorldHandler } from '../rules/sheetStore';
import {
  briefError,
  currentWorld,
  deleteWorld,
  isStored,
  keepWorld,
  loadWorld,
  markCreated,
  newWorldId,
  nextTitle,
  notify,
  persistent,
  refreshThumb,
  renameWorld,
  saveAsNewVersion,
  saveCurrentAsMap,
  setReopenHandler,
  setWorldStats,
  storageFullWhy,
  useSavesVersion,
} from '../saveStore';
import { getStage, type DraftBase } from '../stageStore';
import { showToast } from '../Toast';
import type { SimClient } from '../sim/simClient';
import type { LoadLater, useWorldLoad } from './useWorldLoad';
import type { CivRefs, GenRefs, OpenRefs, Ref, ResimRefs, Setter, WorldViewRefs } from './worldRefs';
import {
  aliveAtEnd,
  draftTarget,
  presetDialog,
  sameSetup,
  setupFor,
  writeGalleryUrl,
  writeHomeUrl,
  writeWorldUrl,
  yearsEdits,
  type Landing,
  type NewDlg,
  type SharedFor,
  type Target,
  type WallView,
  type WorkFor,
} from './worldTarget';

/** 作品墙上的作品另存时写进存档的出处:作品的署名、作品名、作品的网址 */
function workOrigin(w: Pick<GalleryWork, 'id' | 'by' | 'title'>): SaveOrigin {
  return { ...(w.by ? { by: w.by } : {}), title: w.title, url: workLink(w.id), gallery: w.id };
}

/** 新建中的世界现在的样子(参数、修改、名字),比较动没动过用 */
function draftSig(params: WorldParams, edits: WorldEdits, title?: string): string {
  // 地图的校验值是生成完自动记上的,不算动过
  const e = edits.map?.sum === undefined ? edits : { ...edits, map: { ...edits.map, sum: undefined } };
  return JSON.stringify([worldKey(params), e, title ?? '']);
}

/** 创建完要不要从第 0 年起放一遍历史(网址给了 play=0、无头浏览器里不放;play=1 一定放) */
function storyOk(): boolean {
  const play = new URLSearchParams(location.search).get('play');
  if (play === '0') return false;
  if (play === '1') return true;
  return !(typeof navigator !== 'undefined' && navigator.webdriver);
}

/** useWorldPages 要的 App 状态(按块) */
export interface WorldPagesDeps {
  gen: GenRefs;
  civ: CivRefs;
  open: OpenRefs;
  resim: ResimRefs;
  view: WorldViewRefs;
  /** useWorldLoad 交回的:生成、换画面、打开 */
  load: Pick<ReturnType<typeof useWorldLoad>, 'generate' | 'enterStage' | 'openTarget' | 'openStored' | 'openText'>;
  /** 作品墙、新建弹窗、分享说明、回放这些画面上的状态 */
  page: {
    init: { gallery: string | null };
    fromHome: HomeStart | undefined;
    draft: boolean;
    stageBase: DraftBase | null;
    newDlg: NewDlg | null;
    setNewDlg: Setter<NewDlg | null>;
    setDraftTitle: Setter<string>;
    setLanding: Setter<Landing>;
    setSharedFor: Setter<SharedFor | null>;
    setWall: Setter<WallView | null>;
    wallSeq: Ref<number>;
    workItems: Ref<Map<string, GalleryItem>>;
    workFor: WorkFor | null;
    setWorkFor: Setter<WorkFor | null>;
    /** 正在重推、正在放这颗星球的形成(创建世界时等它完) */
    resim: { year: number; end?: number; text?: string } | null;
    replayOn: boolean;
    setReplayOn: Setter<boolean>;
  };
  /** 编辑地形时没起的地名接着在后台起(保存地图时) */
  releaseNames: () => void;
  sim: SimClient;
  /** useWorldLoad 经 ref 调的几样:这里填 .current */
  later: Pick<LoadLater, 'showHomeRef' | 'saveAsNewRef' | 'wallRef'>;
}

export function useWorldPages(deps: WorldPagesDeps) {
  const { sim, releaseNames } = deps;
  const { targetRef, fresh, regenRef, rawRef } = deps.gen;
  const { civYears, civSetup, civLater } = deps.civ;
  const { savedCopy } = deps.open;
  const { stepAuto, storyAfterYears } = deps.resim;
  const { draftViewRef, applyLayer } = deps.view;
  const { generate, enterStage, openTarget, openStored, openText } = deps.load;
  const { init, fromHome, draft, stageBase, newDlg, setNewDlg, setDraftTitle, setLanding, setSharedFor, setWall, wallSeq, workItems, workFor, setWorkFor, resim, replayOn, setReplayOn } = deps.page;
  const { showHomeRef, saveAsNewRef, wallRef } = deps.later;

  /** 换到作品墙的一页(盖在我的世界的位置上):停下正在放的,网址换成作品墙的 */
  const enterWall = (v: WallView, id: string) => {
    wallSeq.current++;
    pausePlayback();
    setReplayOn(false);
    setLanding(null);
    setWorkFor(null);
    enterStage('home');
    setWall(v);
    writeGalleryUrl(id);
  };
  /** 去作品墙那一页(我的世界右上、空页面的精选、作品左上的「‹ 作品墙」、撤下了的那一页) */
  const showGallery = () => {
    navTo({ page: 'gallery' });
    enterWall({ kind: 'list' }, '');
  };
  /**
   * 打开作品墙上的一个作品(作品墙上点的、我的世界空页面上的精选、作品的网址):先是一页空白,去服务器取;
   * 世界作品打开那个世界(只是看看),地图作品整屏一颗星球,新建参数作品在作品墙那一页上弹窗;撤下了、没有这个编号整页说"已经撤下了"
   */
  const openWork = (id: string) => {
    navTo({ page: 'gallery', id });
    enterWall({ kind: 'work', id, state: 'loading' }, id);
    const my = wallSeq.current;
    if (!isWorkId(id) || !serverBase()) return setWall({ kind: 'work', id, state: 'gone' });
    fetchWork(id).then(
      (it) => {
        if (my !== wallSeq.current) return;
        if (it.kind === 'world') return openWorkWorld(it);
        setWall(it.kind === 'map' ? { kind: 'map', work: it } : { kind: 'list', preset: it });
      },
      (e: unknown) => {
        if (my !== wallSeq.current) return;
        const gone = isWorkGone(e);
        setWall({ kind: 'work', id, state: gone ? 'gone' : { error: e instanceof ServerError && e.code === 'network' ? '连不上服务器，请检查网络后再试。' : e instanceof Error ? e.message : String(e) } });
        // 作品墙上的卡片跟着去掉
        if (gone) loadGallery(true);
      },
    );
  };
  /** 打开世界作品:和打开分享链接一样,别人的世界先只是看看,改了才另存进我的世界(出处写作品) */
  const openWorkWorld = (it: GalleryItem) => {
    const p = parseSave(JSON.stringify(it.save ?? null));
    if (!p.ok) return setWall({ kind: 'work', id: it.id, state: { error: briefError(p.error) } });
    const sv = p.save;
    const id = newWorldId();
    setWall(null);
    setSharedFor(null);
    setWorkFor({ id, work: it });
    workItems.current.set(id, it);
    openTarget(
      { id, kind: 'visit', params: sv.params, edits: sv.edits, saved: sv.edits, title: it.title || sv.title, view: sv.view ?? null, from: 'link', save: sv, warnings: p.warnings, gallery: it.id, origin: workOrigin(it), moment: sv.moment ?? null },
      'replace',
    );
  };
  /** 世界作品「另存一份接着改」:存进我的世界(出处已经写着),网址换成它的编号 */
  const keepWork = () => {
    const c = currentWorld();
    const t = targetRef.current;
    if (!c || !t || !workFor || c.id !== workFor.id) return;
    if (c.kind === 'visit') keepWorld(c.id);
    if (!isStored(c.id)) return notify({ kind: 'error', text: '没能另存', more: [storageFullWhy()] });
    writeWorldUrl(t);
    showToast({ id: 'save', kind: 'ok', text: `已存进我的世界「${c.title || workFor.work.title || '未命名世界'}」`, more: [`出处写着${workWho(workFor.work)}`] });
  };
  /** 新建参数作品「用这套参数新建」:回到我的世界,新建弹窗第 2 步照它填好(不自动存进自己的预设) */
  const takePresetWork = (p: SharedPreset) => {
    showHome();
    pickSharedPreset(p);
    setNewDlg({ ...presetDialog(p), stamp: performance.now() });
  };
  wallRef.current = { open: openWork, list: showGallery };
  /** 新建世界(我的世界右上、第一次来、分享停了的那一页):先弹窗选怎么生成、定基础参数 */
  const startDraft = () => setNewDlg({});
  /** 别人分享的规则「用它新建世界」(已经加进了我的规则):回到我的世界,新建弹窗,这个世界的规则选好那一套 */
  const newWorldWithRules = (rules: RuleSet) => {
    showHome();
    setNewDlg({ rules, stamp: performance.now() });
  };
  /** 弹窗里点了「取消」:什么都不留下(刷新回来的照图新建,网址里的 new=image 也去掉,再刷新不再弹) */
  const cancelDialog = () => {
    setNewDlg(null);
    writeHomeUrl();
  };
  /**
   * 弹窗里点了「开始」:存下没建完的世界、进新建界面。照手绘图的把读好的图交过去,进去直接是第 1 步「认出海陆」
   * (照手绘图的新建界面一进来就打开改地形工具,认图在它上面)
   */
  const startFromDialog = (s: NewWorldStart) => {
    // 作品墙上新建参数作品「用这套参数新建」打开的弹窗:新的世界出处写这个作品(和另存世界作品一样);换成了别的预设就不写
    const g = chosenGallery(getPresets(), newDlg?.shared);
    setNewDlg(null);
    const plain = draftTarget(s.params, null, yearsEdits(s.endYear, s.frontier, s.rules));
    const d = g?.id && isWorkId(g.id) ? { ...plain, origin: workOrigin({ id: g.id, by: g.by, title: g.title ?? '' }) } : plain;
    if (s.mode === 'random') return openTarget(d);
    openTarget({ ...d, mode: 'image' });
    if (s.picture) beginImport(s.picture);
  };
  /** 新建中的世界(在看的就是它)*/
  const draftNow = (): Target | null => {
    const t = targetRef.current;
    return t && t.kind === 'draft' && getStage().stage === 'draft' ? t : null;
  };
  /** 新建中:最新的名字、动没动过(存在 saveStore 里;还在生成时看 targetRef) */
  const draftState = (t: Target) => {
    const cur = currentWorld();
    const attached = cur?.id === t.id;
    return { title: attached ? cur.title : t.title, pristine: attached ? cur.pristine : t.pristine, edits: attached ? getEdits() : t.edits };
  };
  /** 新建中换种子:另一颗星球,草图留着(连同放的火山湖河);没画草图时放的那几处作废;没起名、参数也是默认的、没画草图 = 又算没动过(不存) */
  const draftSeed = (seed: number, params?: WorldParams) => {
    const t = draftNow();
    // 以别的世界为底稿、在一张地图上打造文明:种子锁着
    if (!t || t.base || t.edits.map) return;
    const st = draftState(t);
    // 按后退 / 前进换回的那颗:参数也换回那一步的(params)
    const base = params ?? t.params;
    // 换一颗:草图带过去,照它长出新的山河;陆地海洋是照草图长的,放的火山湖河也还对得上,一起带过去。
    // 没画草图 = 整颗星球都换了,放的那几处是照原来的地形放的,不带过去。助手的对话(说的是原来那颗)也清掉
    newConversation();
    const sketch = st.edits.sketch;
    const plain =
      !st.title &&
      !sketch &&
      !st.edits.nameMix &&
      !st.edits.endYear &&
      !st.edits.frontier &&
      !st.edits.calamity &&
      !st.edits.rules &&
      !st.edits.origins &&
      st.edits.civSeed === undefined &&
      !st.edits.era &&
      st.edits.months === undefined &&
      !st.edits.monthNames &&
      worldKey({ ...base, seed: 0 }) === worldKey({ ...DEFAULT_PARAMS, seed: 0 });
    // 地名风格、推演年数、拓荒、天灾、规则和参数一样是这一类星球的设定,换一颗照旧;选的起源按位置照旧(新星球上那里住不了人的,推演时跳过);
    // 纪年、月份(年份的写法)也照旧,按一件事定的换成按年份(那件事是原来那颗星球上的)
    const { nameMix, endYear, frontier, calamity, rules, origins, civSeed, era, months, monthNames } = st.edits;
    const kept: WorldEdits = sketch ? { ...EMPTY_EDITS, sketch, terrain: st.edits.terrain } : EMPTY_EDITS;
    const edits = {
      ...kept,
      ...(nameMix ? { nameMix } : {}),
      ...(endYear ? { endYear } : {}),
      ...(frontier ? { frontier } : {}),
      ...(calamity ? { calamity } : {}),
      ...(rules ? { rules } : {}),
      ...(origins ? { origins } : {}),
      ...(civSeed !== undefined ? { civSeed } : {}),
      ...(era ? { era: { name: era.name, epoch: era.epoch } } : {}),
      ...(months !== undefined ? { months } : {}),
      ...(monthNames ? { monthNames } : {}),
    };
    // 换一颗:记一步(按后退换回刚才那颗)
    navTo({ page: 'draft', id: t.id, seed, title: st.title });
    generate({ ...t, params: { ...base, seed }, edits, saved: undefined, title: st.title, pristine: st.pristine || plain, view: undefined, from: undefined, save: undefined });
  };
  /** 新建中调参数:改过的地形留着(按新参数重新生成) */
  const draftParams = (p: WorldParams) => {
    const t = draftNow();
    // 在一张地图上打造文明:地图锁着
    if (!t || t.edits.map) return;
    const st = draftState(t);
    generate({ ...t, params: { ...p, seed: t.base ? t.params.seed : p.seed }, edits: st.edits, saved: undefined, title: st.title, pristine: false, view: undefined, from: undefined, save: undefined });
  };
  /** 新建中起名(点别处 / 回车):起了名就算动过,存进我的世界("没建完") */
  const draftRename = (title: string) => {
    const t = draftNow();
    if (!t) return;
    const clean = cleanTitle(title) || undefined;
    t.title = clean;
    setDraftTitle(clean ?? '');
    if (currentWorld()?.id === t.id) renameWorld(t.id, clean ?? '');
    // 星球还在生成:同样算动过(生成好了照这个名字存下;这时按后退离开,回来名字也还在)
    else t.pristine = false;
  };
  /**
   * 创建世界:从此种子、参数、地形锁住;一直存着。从第 0 年起放一遍历史;how = 新建时选了「演绎」(step):从第 0 年起逐年推演、马上往下走;
   * 选了「照大纲」(outline):不放历史,打开概览的「大纲」页先写大纲。建成了 = true
   */
  const createWorld = (title: string, how?: 'step' | 'outline', stopAt?: number): boolean => {
    const t = draftNow();
    const cur = currentWorld();
    // 还在生成、在重推带过来的干预、在放这颗星球的形成:等它完
    if (!t || !cur || cur.id !== t.id || fresh.current || regenRef.current || civLater.current || resim || replayOn) return false;
    const clean = cleanTitle(title) || undefined;
    if ((clean ?? '') !== (cur.title ?? '')) renameWorld(t.id, clean ?? '');
    // 记成预设里的「上次用的」(不含种子)
    rememberLast(t.params, cleanEndYear(getEdits().endYear), clean ?? '');
    // 用的是「我的规则」里的一套:记一笔用它建过一个世界(这一版用过了,之后再改就是新的一版)
    noteRulesUsed(getEdits().rules);
    // 说存住了,要真的写进了浏览器(存储满了、删了旧的也写不下,或者浏览器不让存 = 只在这一页里)
    const stored = markCreated() && persistent();
    // 新建时执行过的改地形从此不能再撤销:⌘Z 也不再往回退(助手那边按锁换了,旧的确认单不能执行)
    clearEditHistory();
    // 地形锁住了:后台线程为编辑地形留着的整图放掉(没有回音,不算一件活)
    sim.tell({ type: 'release', id: 0 } satisfies WorkerRequest);
    targetRef.current = { ...t, kind: 'created', base: null, pristine: false, title: clean, from: undefined, save: undefined };
    // 这一步换成建好的世界;前面换过的几颗星球(同一个编号)按后退时跳过(见 App 的 routeNav)
    navReplace({ page: 'world', id: t.id, title: clean });
    enterStage('world');
    // 建好的世界看政区
    draftViewRef.current = null;
    applyLayer('political');
    writeWorldUrl(targetRef.current);
    if (rawRef.current) setWorldStats(aliveAtEnd(rawRef.current));
    refreshThumb();
    const keep = persistent();
    showToast({
      id: 'created',
      kind: stored ? 'ok' : 'warn',
      dot: stored,
      text: `${clean ?? '新世界'}已创建`,
      more: [stored ? '自动存在这个浏览器里，在「我的世界」里随时能找到' : keep ? `${storageFullWhy()}，没能存下；关掉页面前请存成文件` : '浏览器不让网页存数据，关掉页面前请存成文件'],
      ttl: 7000,
    });
    // 历史从第 0 年起放一遍(这次打开网页不再另外自动播放);不放(play=0、无头浏览器)时,
    // 新建时放过"这颗星球的形成"、时间停在第 0 年的,回到结束那一年。
    // 推得比 3000 年久的世界:新建时只推了 3000 年,创建以后接着往后推(重推那段),推完再放;调了拓荒、选了起源的同样创建以后重推
    takeAutoplay();
    // 选了「演绎」:换成从第 0 年起逐年推演(推到第 0 年年初就停,接着一步步往下走),不放一遍历史
    if (how === 'step') {
      storyAfterYears.current = null;
      stepAuto.current = true;
      putEditsQuiet(startStepwise(getEdits(), 0));
      return true;
    }
    const later = endParamOf(getEdits()) !== civYears.current || !sameSetup(setupFor(false, getEdits()), civSetup.current);
    // 照故事找的:停在开场那年,不从第 0 年放(推得更久的接着推完也不放);选了照大纲的照样先打开大纲
    if (stopAt !== undefined) {
      storyAfterYears.current = null;
      setCivTime({ year: stopAt, playing: false, scrubbing: false, story: false });
      if (how === 'outline') openOverview('outline');
      return true;
    }
    if (how === 'outline') {
      openOverview('outline');
      if (getCivTime().year === 0) resetCivTime();
      return true;
    }
    if (later) storyAfterYears.current = storyOk();
    if (storyOk() && !later) startCivReplay();
    else if (getCivTime().year === 0) resetCivTime();
    return true;
  };
  /**
   * 以正在看的世界为底稿新建:设定、改名、干预都带过去(还是这张图,不用重新生成);存成另一个世界。
   * 带着东西、起好了名,一开始就存(作为没建完的,刷新不丢);什么都没动就点返回,这一份删掉
   */
  const draftFromCurrent = () => {
    const t = targetRef.current;
    const cur = currentWorld();
    if (!t || !cur || cur.id !== t.id || fresh.current) return;
    // 以它为底稿新建的地图还能改:不再算原来那张地图上的(地图记录不带;文明种子照旧带过去)
    const orig = getEdits();
    const e: WorldEdits = { ...orig };
    delete e.map;
    const base: DraftBase = { id: cur.id, title: cur.title || '未命名世界', names: Object.keys(e.names).length, interventions: e.interventions.length };
    backRef.current = { ...t, kind: cur.kind, edits: orig, saved: undefined, title: cur.title, from: undefined, save: undefined, view: undefined };
    const d = draftTarget(t.params, base, e, nextTitle(base.title));
    derivedRef.current = { id: d.id, sig: draftSig(d.params, d.edits, d.title) };
    openTarget({ ...d, pristine: false, view: undefined });
  };
  /** 新建第 1 步点了「保存地图」:只存地图(没有文明),回到我的世界的「地图」页签、选中它。存下了 = true */
  const saveMap = (): boolean => {
    // 编辑地形时没起的地名接着在后台起(不等它)
    releaseNames();
    const t = draftNow();
    const cur = currentWorld();
    if (!t || !cur || cur.id !== t.id || fresh.current || regenRef.current) return false;
    if (!saveCurrentAsMap()) {
      notify({ kind: 'error', text: '没能保存地图', more: [persistent() ? storageFullWhy() : '浏览器不让网页存数据'] });
      return false;
    }
    showMapInWorlds(t.id);
    showHome();
    return true;
  };
  /**
   * 在一个世界(或只存了地图的那一份)的地图上打造新文明:进新建界面的「打造文明」(地图锁着,定文明种子、推演年数、拓荒、起源、
   * 名字、地名风格)。用的是它一开始的地图(参数、地形修改、草图;不带地形大事)和它的规则,原来的国家、人物、干预、改名……都不带;原来的不动。
   * 文明种子先随机给一个;名字先填"原名(二)"。旧版本建的世界:生成出来的地图和它存的对不上就不让打造(见 ./useWorldLoad.ts 的 readyRef)。
   * redo = 用这一版规则另存一份重推(世界设定里「用第 3 版另存一份重推」):文明种子、推演年数、天灾、拓荒、起源、地名风格都照原来的,
   * 只换规则,推出来的差别只来自规则
   */
  const startNewCiv = (id: string, redo?: RuleSet) => {
    const w = loadWorld(id);
    if (!w || w.draft) return notify({ kind: 'error', text: redo ? '没能另存一份重推' : '打不开这张地图', more: ['可能已在别的页面里删掉了'] });
    newCivOn(w.save, id, w.map ? undefined : nextTitle(w.save.title || '未命名世界'), w.save.origin ?? null, redo);
  };
  /**
   * 在一份存档的地图上打造新文明(见 startNewCiv)。from = 地图出自哪(我的世界里的编号;作品墙上的作品是 gallery:<作品编号>),
   * 同一张地图上打造的文明在我的世界的「地图」里排在一起
   */
  const newCivOn = (save: SaveFile, from: string, title: string | undefined, origin: SaveOrigin | null, redo?: RuleSet) => {
    const e = save.edits;
    const edits: WorldEdits = redo
      ? {
          ...newHistoryEdits(e, {
            civSeed: civSeedOf(e, save.params.seed),
            from,
            sum: e.map?.sum,
            rules: redo,
            ...(e.nameMix ? { nameMix: e.nameMix } : {}),
            ...(e.endYear !== undefined ? { endYear: e.endYear } : {}),
          }),
          ...(e.frontier ? { frontier: e.frontier } : {}),
          ...(e.calamity ? { calamity: e.calamity } : {}),
          ...(e.origins ? { origins: e.origins } : {}),
        }
      : newHistoryEdits(e, { civSeed: randomSeedValue(), from, sum: e.map?.sum, ...(e.rules ? { rules: e.rules } : {}) });
    const mapCheck = save.generator < GENERATOR_VERSION && save.check ? save.check : undefined;
    setNewDlg(null);
    // 一开始就存成没建完的(刷新、后退再前进都回得来;地图出自哪个世界、文明种子都在存档里),底稿出处跟着;什么都没动就返回,这一份删掉
    const d = draftTarget(save.params, null, edits, title);
    derivedRef.current = { id: d.id, sig: draftSig(d.params, d.edits, d.title) };
    openTarget({ ...d, pristine: false, origin, mapCheck });
  };
  /** 作品墙上的世界 / 地图作品「用这张地图打造(新)文明」:地形照搬,文明和历史从头推演;出处写作品 */
  const newCivOnWork = (it: GalleryItem) => {
    const p = parseSave(JSON.stringify(it.save ?? null));
    if (!p.ok) return notify({ kind: 'error', text: '打不开这张地图', more: [briefError(p.error)] });
    setWall(null);
    setWorkFor(null);
    newCivOn(p.save, `gallery:${it.id}`, it.kind === 'map' ? undefined : nextTitle(it.title || p.save.title || '未命名世界'), workOrigin(it));
  };
  const startNewCivRef = useRef(startNewCiv);
  startNewCivRef.current = startNewCiv;
  const newWorldRef = useRef(newWorldWithRules);
  newWorldRef.current = newWorldWithRules;
  useEffect(() => {
    setNewCivHandler((id, redo) => startNewCivRef.current(id, redo));
    setOpenWorldHandler((id) => openStoredRef.current(id));
    setNewWorldHandler((rules) => newWorldRef.current(rules));
    return () => {
      setNewCivHandler(null);
      setOpenWorldHandler(null);
      setNewWorldHandler(null);
    };
  }, []);
  // 先出来的首页上点的那一件(主程序那时还在下载):挂上以后接着做,和在这里点的一样(浏览器的后退已经在 useWorldLoad 打开网页时那一段接上了)
  useEffect(() => {
    const s = fromHome;
    if (!s) return;
    if (s.kind === 'open') openStored(s.id);
    else if (s.kind === 'text') openText(s.text, s.fileName);
    else if (s.kind === 'newCiv') startNewCiv(s.id);
    // 作品墙那一页、作品:首页上已经把网址换成了它,useWorldLoad 照网址已经打开了(再开一次会把开着的新建参数作品关掉、多取一次)
    else if (s.kind === 'gallery') {
      if (init.gallery === null) showGallery();
    } else if (s.kind === 'work') {
      if (init.gallery !== s.id) openWork(s.id);
    }
    else if (s.kind === 'preset') takePresetWork(s.preset);
    else startFromDialog(s.start);
    // 只在挂上时做一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** 以别的世界为底稿新建时,那个世界(没存过的也回得去) */
  const backRef = useRef<Target | null>(null);
  /** 以别的世界为底稿新建的那一份:编号和一开始的样子(返回时没动过就删掉) */
  const derivedRef = useRef<{ id: string; sig: string } | null>(null);
  /** 以底稿新建的那一份还是一开始的样子(参数、修改、名字都没动) */
  const derivedUntouched = (): string | null => {
    const d = derivedRef.current;
    const t = targetRef.current;
    const cur = currentWorld();
    if (!d || !t || !cur || t.id !== d.id || cur.id !== d.id) return null;
    return draftSig(t.params, getEdits(), cur.title) === d.sig ? d.id : null;
  };
  /** 回到"我的世界"(一个都没有时是空的那一页) */
  const showHome = () => {
    navTo({ page: 'home' });
    pausePlayback();
    setReplayOn(false);
    enterStage('home');
    wallSeq.current++;
    setWall(null);
    setWorkFor(null);
    writeHomeUrl();
  };
  const goHome = showHome;
  showHomeRef.current = showHome;
  const openStoredRef = useRef(openStored);
  openStoredRef.current = openStored;
  /**
   * 照原样打开的旧世界「按新版另存一份」(提示条、存档菜单、推演前问的窗口):原来的不动,另存一份带着 edits(不给 = 现在的修改),
   * 打开它按新版重新生成、推演;AI 写的史书、名字由来跟着复制
   */
  const saveAsNewNow = (edits?: WorldEdits) => {
    closeSaveAsNew();
    const c = currentWorld();
    if (!c || c.frozen === undefined) return;
    const from = c.title || `种子 ${c.params.seed}`;
    const id = saveAsNewVersion(c.id, edits ?? getEdits());
    if (!id) return notify({ kind: 'error', text: '没能另存', more: [storageFullWhy()] });
    const more = copyNotes(c.id, id) ? [] : ['AI 写的史书、名字由来没能一起存下（浏览器存储已满）'];
    savedCopy.current = { id, from, more };
    openStoredRef.current(id);
  };
  saveAsNewRef.current = saveAsNewNow;
  useEffect(() => {
    setSaveAsNew((e) => saveAsNewRef.current(e));
    // 照原样打开的旧世界:改历史(要用现在的规则重新推演)先问要不要另存一份;别的世界照常改。
    // 逐年推演:只能在"现在"干预(下一步生效),不改以前的历史(撤销、助手执行的都算);想改以前的事先存回推演模式
    setHistoryGate((next) => {
      if (cleanPlay(getEdits().play) && cleanPlay(next.play)) {
        showToast({ id: 'edit-block', kind: 'warn', text: '逐年推演里只能在「现在」干预', more: ['想改以前的事，先存回推演模式'], ttl: 5000 });
        return true;
      }
      const c = currentWorld();
      if (!c || c.frozen === undefined) return false;
      const now = getEdits();
      const count = Math.max(0, next.interventions.length - now.interventions.length) + Math.max(0, (next.upheavals?.length ?? 0) - (now.upheavals?.length ?? 0));
      askSaveAsNew({ next, title: c.title || `种子 ${c.params.seed}`, count });
      return true;
    });
    return () => {
      setSaveAsNew(null);
      setHistoryGate(null);
    };
  }, []);
  // 云同步:登录了就开始(account/sync.ts);正在看的世界在别的设备上、别的页面里改过,点"载入"重新打开它;账号窗里点"最近删除"回到我的世界
  useEffect(() => {
    const stop = startSync();
    setReloadHandler((id) => openStoredRef.current(id));
    setReopenHandler((id) => openStoredRef.current(id));
    setGoHome(() => {
      if (getStage().stage !== 'home') showHomeRef.current();
    });
    return () => {
      stop();
      setReloadHandler(null);
      setReopenHandler(null);
      setGoHome(null);
    };
  }, []);
  const v = useSavesVersion();
  // 正在看的世界改了名:浏览器记的这一步也换成新名字
  useEffect(() => {
    const cw = currentWorld();
    if (cw) navTitle(cw.id, cw.title || undefined);
  }, [v]);
  /**
   * 新建卡片左上的返回:底稿那个世界 / 我的世界;第一次来(没有别的世界)不显示。
   * 每次渲染现做(不 useMemo):记下来的回调会连带拉住记下那一刻的世界,编辑地形涂了几笔以后旧的主图还放不掉
   */
  const draftBack = (() => {
    if (!draft) return null;
    if (stageBase) {
      return {
        label: stageBase.title,
        onClick: () => {
          const b = backRef.current;
          const left = derivedUntouched();
          if (left) deleteWorld(left);
          // 前一步就是那个世界:退回去(和浏览器的后退一样,不多记一步)
          if (navBack({ page: 'world', id: stageBase.id })) return;
          if (isStored(stageBase.id)) openStored(stageBase.id);
          else if (b && b.id === stageBase.id) openTarget(b);
          else goHome();
        },
      };
    }
    return {
      label: '我的世界',
      onClick: () => {
        if (navBack({ page: 'home' })) return;
        // 在一张地图上打造、什么都没动就返回:那一份删掉(后退的话 App 的 routeNav 删)
        const left = derivedUntouched();
        if (left) deleteWorld(left);
        goHome();
      },
    };
  })();

  return {
    showGallery,
    openWork,
    keepWork,
    takePresetWork,
    startDraft,
    cancelDialog,
    startFromDialog,
    draftNow,
    draftState,
    draftSeed,
    draftParams,
    draftRename,
    createWorld,
    draftFromCurrent,
    saveMap,
    startNewCiv,
    newCivOnWork,
    derivedUntouched,
    showHome,
    goHome,
    openStoredRef,
    v,
    draftBack,
  };
}
