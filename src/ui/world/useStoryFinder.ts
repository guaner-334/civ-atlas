/**
 * 照故事找世界(App 用;那一页是 ../FinderPage.tsx,条件、结果在 ../finderStore.ts,照故事找的那一组在 ../foundStore.ts):
 *   - 新建世界第 1 步点「照故事找世界」进去、「‹ 新建世界」离开;选中一个结果,新建中的世界换成那个世界,停在开场那年、地图飞过去
 *   - 「用这个世界」回到新建第 2 步(那几样设定锁着);建好以后加标记、记一组「照故事找的」、地图飞到故事里的几国
 *   - 侧栏「照故事找的」点「再找」、大纲页「找更合的世界」
 * App 的状态按块传进来(见 ./worldRefs.ts);这里的函数每次渲染新建(和原来写在 App 里一样),交回 App 的画面(新建界面、找世界那一页、地图上的小牌子)要用的几样
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { World, WorldParams } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import type { Civ } from '../../gen/civ/types';
import { EMPTY_EDITS, cleanCivSeed, cleanEndYear, type WorldEdits } from '../../gen/edits';
import { cleanCalamity } from '../../gen/civ/calamity';
import { cleanFrontier, cleanOrigins } from '../../gen/civ/frontier';
import { worldTuning } from '../../gen/civ/ruleSet';
import { ownersAt } from '../../gen/civ/engine/timeline';
import { summarize } from '../../gen/finder/query';
import { worldKey } from '../../gen/savefile';
import { sketchGrid } from '../../gen/sketch';
import { closeAssistant } from '../astPanel';
import { setCivHighlight, setCivShow, setCivTime } from '../civView';
import { addMark, getEdits, setOutlinePlots } from '../editsStore';
import { foundDetail, storyPoints } from '../finderInfo';
import { pickedOf, variantOf, type FinderFlyTo, type FinderPreview } from '../FinderResults';
import { closeFinder, getFinder, openFinder, resetFinder, selectFinder, setFinderMap, setQuery, type FinderBase, type FinderUi } from '../finderStore';
import { foundPickOf, putFound, setFindAgainHandler, type FoundPick } from '../foundStore';
import type { BaseId, FillId } from '../mapLayers';
import { moveOutline, outlineFrom, outlineRoles, type OutlineFrom } from '../outlineMove';
import { setOutlineFinder } from '../outlineStore';
import { closeOverview, openOverview } from '../overviewStore';
import { getProjection, setGraticule, setGraticuleStep, setProjection } from '../projection';
import { currentWorld, isStored } from '../saveStore';
import type { StudioFound } from '../studio/Studio';
import { carryStudioView, takeStudioView } from '../studio/studioStore';
import { setTerrainTool } from '../TerrainTools';
import { showToast } from '../Toast';
import type { useWorldLoad } from './useWorldLoad';
import type { useWorldPages } from './useWorldPages';
import type { GenProgress, GenRefs, Ref, WorldViewRefs } from './worldRefs';
import { draftTarget, type Target } from './worldTarget';

/** 生成这张地图用的(参数、地形、草图):照故事找世界「用这个世界」以后,这几样变了就不再是找到的那个世界 */
function genSigOf(params: WorldParams, edits: Pick<WorldEdits, 'terrain' | 'sketch'>): string {
  return JSON.stringify([worldKey(params), edits.terrain, edits.sketch ?? null]);
}

/** useStoryFinder 要的 App 状态(按块) */
export interface StoryFinderDeps {
  gen: Pick<GenRefs, 'targetRef' | 'genParams'>;
  view: Pick<WorldViewRefs, 'mapViewRef' | 'applyMapView'>;
  /** useWorldLoad 交回的:生成、打开 */
  load: Pick<ReturnType<typeof useWorldLoad>, 'generate' | 'openTarget' | 'openStored'>;
  /** useWorldPages 交回的:新建中的世界、它现在的样子 */
  pages: Pick<ReturnType<typeof useWorldPages>, 'draftNow' | 'draftState'>;
  /** 地图上这个世界(地图那一段)、历史(套上改名的那一份)、生成进度 */
  world: {
    data: { world: World; raster: Raster } | null;
    rawCiv: Civ | null;
    realCiv: Civ | null;
    realCivRef: Ref<Civ | null>;
    progress: GenProgress | null;
  };
  /** 新建中、找世界那一页、新建界面退场到哪一步;新建中的世界的参数和修改;窄屏 */
  page: {
    draft: boolean;
    finder: FinderUi;
    finderOn: boolean;
    studioOut: 0 | 1 | 2;
    params: WorldParams;
    edits: WorldEdits;
    narrowRef: Ref<boolean>;
  };
  /** App 后面才定义的(飞到某处,见 ../map/useMapFly.ts),经这里调 */
  later: {
    flyToPoints: (pts: readonly (readonly [number, number])[], where: 'finder' | 'world', zoom?: number) => void;
  };
}

export function useStoryFinder(deps: StoryFinderDeps) {
  const { targetRef, genParams } = deps.gen;
  const { mapViewRef, applyMapView } = deps.view;
  const { generate, openTarget, openStored } = deps.load;
  const { draftNow, draftState } = deps.pages;
  const { data, rawCiv, realCiv, realCivRef, progress } = deps.world;
  const { draft, finder, finderOn, studioOut, params, edits, narrowRef } = deps.page;
  const { flyToPoints } = deps.later;
  // 新建世界第 1 步点「照故事找世界」进去:新建界面收起,平常的地图露出来(手绘、国家);选中一个结果,新建中的世界换成那个世界
  // (地图、文明种子照搜的时候的),停在开场那年,两国描边、交界那州圈出来;「用这个世界」回到新建第 2 步(那几样设定锁着);
  // 「‹ 新建世界」离开时新建中的世界换回原来的样子
  /** 打开找世界那一页时:新建中的世界原来的样子、地图原来的样式(新建界面的)、搜的时候照它生成的设定 */
  const finderBack = useRef<{ target: Target; view: { base: BaseId; fill: FillId }; base: FinderBase; moved: boolean } | null>(null);
  /** 「用这个世界」以后:新建第 2 步锁着的那几样、建好以后停在哪年、加哪几个标记(从大纲页来的:搬哪份大纲) */
  const [found, setFound] = useState<(StudioFound & { pick: FoundPick; pts: [number, number][]; gen: string; from?: OutlineFrom }) | null>(null);
  /**
   * 从大纲页「找更合的世界」进来的:原来那个世界的大纲(建好以后搬过去,outlineMove.ts)、点之前地图的样式;
   * 找世界那一页的「‹ 大纲」回原来那个世界的大纲
   */
  const [outlineSrc, setOutlineSrc] = useState<{ from: OutlineFrom; view: { base: BaseId; fill: FillId } } | null>(null);
  /** 一张地图认是不是同一张:参数、地形、草图(在哪张地图上打造的那条出处不算:地图本身一样) */
  const mapKeyOf = (p: WorldParams, e: WorldEdits) => JSON.stringify([worldKey(p), e.terrain, e.sketch ?? null]);
  /** 新建中的世界 → 搜的时候照它生成的设定(世界参数、地形和草图(都用这张地图时)、推演年数、拓荒、起源、天灾、规则、地名风格) */
  const finderBaseOf = (t: Target, e: WorldEdits): FinderBase => {
    const endYear = cleanEndYear(e.endYear);
    const frontier = cleanFrontier(e.frontier);
    const origins = cleanOrigins(e.origins);
    const calamity = cleanCalamity(e.calamity);
    const tuning = worldTuning(e.rules);
    const civ = { ...(endYear ? { endYear } : {}), ...(frontier ? { frontier } : {}), ...(origins ? { origins } : {}), ...(calamity ? { calamity } : {}), ...(e.nameMix ? { names: e.nameMix } : {}) };
    const sketch = sketchGrid(e.sketch);
    return {
      key: JSON.stringify([worldKey(t.params), e.terrain, e.sketch ?? null, civ, ...(tuning ? [tuning] : [])]),
      setup: { world: t.params, ...(Object.keys(civ).length ? { civ } : {}), ...(tuning ? { tuning } : {}), ...(e.terrain.length ? { terrain: [...e.terrain] } : {}), ...(sketch ? { sketch } : {}) },
    };
  };
  /** 新建第 1 步点「照故事找世界」(again:「用这个世界」以后点「回去换一个」,回到上次的结果) */
  const openFinderPage = (again = false) => {
    // 新建中的世界还在生成也能进(「再找」新建的那一个):地图生成好了再露出来
    const t = draftNow();
    if (!t) return;
    if (!again || !finderBack.current) {
      const st = draftState(t);
      const back: Target = { ...t, edits: st.edits, title: st.title, pristine: st.pristine, saved: undefined, view: undefined, from: undefined, save: undefined };
      finderBack.current = { target: back, view: { base: mapViewRef.current.base, fill: mapViewRef.current.fill }, base: finderBaseOf(t, st.edits), moved: false };
    }
    setTerrainTool({ on: false });
    closeAssistant();
    // 新建界面收起时,投影、经纬网先留着(回来接着用;离开新建时再换回进新建之前的)
    carryStudioView();
    applyMapView({ base: 'fantasy', fill: 'polities' });
    if (!again) setCivTime({ year: null, playing: false, scrubbing: false, story: false });
    openFinder(finderBack.current.base, narrowRef.current);
  };
  /** 选中的一个结果:新建中的世界换成它(地图种子 = 它,或者都用这张地图、只换文明种子);已经是它就不动 */
  const finderPreview = (seed: number) => {
    const back = finderBack.current;
    const t = draftNow();
    const run = getFinder().run;
    if (!back || !t || !run) return;
    const fixed = run.setup.map === 'fixed';
    const be = back.target.edits;
    const params = fixed ? back.target.params : { ...back.target.params, seed };
    const { nameMix, endYear, frontier, origins, calamity, rules, era, months, monthNames } = be;
    const keep: Partial<WorldEdits> = {
      ...(nameMix ? { nameMix } : {}),
      ...(endYear ? { endYear } : {}),
      ...(frontier ? { frontier } : {}),
      ...(origins ? { origins } : {}),
      ...(calamity ? { calamity } : {}),
      ...(rules ? { rules } : {}),
      ...(era ? { era } : {}),
      ...(months !== undefined ? { months } : {}),
      ...(monthNames ? { monthNames } : {}),
    };
    // 都用这张地图:文明种子照搜的时候明写(和地图种子一样也写:改过地形的地图上,写没写推出来的不一样)
    const edits: WorldEdits = fixed ? { ...be, civSeed: seed } : { ...EMPTY_EDITS, ...keep };
    const cur = targetRef.current;
    if (cur?.fullCiv && genParams.current && worldKey(genParams.current) === worldKey(params) && cleanCivSeed(cur.edits.civSeed) === cleanCivSeed(edits.civSeed)) return;
    back.moved = true;
    generate({ ...t, params, edits, saved: undefined, title: back.target.title, pristine: back.target.pristine, view: undefined, from: undefined, save: undefined, fullCiv: true });
  };
  /** 「‹ 新建世界」:新建中的世界换回原来的样子,地图换回新建界面的样式;从大纲页来的「‹ 大纲」回原来那个世界的大纲 */
  const exitFinder = () => {
    const back = finderBack.current;
    const src = outlineSrc;
    finderBack.current = null;
    closeFinder();
    selectFinder(null);
    setCivHighlight(null);
    setFound(null);
    setOutlineSrc(null);
    if (src && isStored(src.from.world)) {
      applyMapView(src.view);
      openStored(src.from.world);
      openOverview('outline');
      return;
    }
    if (!back) return;
    applyMapView(back.view);
    if (back.moved && draftNow()) generate({ ...back.target });
  };
  /** 找世界那一页上选中的结果、那种配法 */
  const finderSum = useMemo(
    () => (finderOn && finder.run ? summarize(finder.run.query, finder.run.reports, finder.variant, finder.sort) : null),
    [finderOn, finder.run?.query, finder.run?.reports, finder.variant, finder.sort], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const finderPick = useMemo(() => (finderSum ? pickedOf([...finderSum.full, ...finderSum.near], finder.sel) : null), [finderSum, finder.sel]);
  /** 选中的那个世界生成好了(地图和文明种子对得上):地图上贴小牌子、写名字用 */
  const finderPreviewData: FinderPreview | null = (() => {
    const back = finderBack.current;
    if (!finderOn || !finderPick || !back || !data || !rawCiv || !realCiv || progress || !targetRef.current?.fullCiv) return null;
    const seed = finderPick.row.seed;
    const fixed = finder.run?.setup.map === 'fixed';
    if (rawCiv.seed !== seed || data.world.params.seed !== (fixed ? back.target.params.seed : seed)) return null;
    return { seed, world: data.world, civ: realCiv };
  })();
  // 选中了就换过去(还在生成上一个也换:后台只认最新的)
  useEffect(() => {
    if (finderOn && finder.sel) finderPreview(finder.sel.seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finderOn, finder.sel?.seed]);
  // 搜完了还没选:选上最合的那个(没有全合的选差一条里最近的)
  const finderDone = finder.run?.progress?.state === 'done';
  useEffect(() => {
    const first = finderSum?.full[0] ?? finderSum?.near[0];
    if (!finderOn || !finderDone || getFinder().sel || !first) return;
    selectFinder({ seed: first.seed, alt: -1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finderOn, finderDone]);
  /** 生成好了:停在开场那年,两国描边、交界那州圈出来,地图飞过去看全两国(同一个结果只飞一次) */
  const finderShown = useRef('');
  const finderPreviewKey = finderPreviewData && finderPick ? `${finderPick.row.seed}:${finderPick.cand.year}:${finderPick.cand.roles.join(',')}:${finder.variant}` : '';
  useEffect(() => {
    if (!finderPreviewKey || !finderPreviewData || !finderPick) return;
    const { cand, places } = finderPick;
    setCivTime({ year: cand.year, playing: false, scrubbing: false, story: false });
    setCivShow({ polities: true });
    const junction = places.filter((p) => p.kind === 'junction').map((p) => p.region);
    setCivHighlight({ regions: junction, polities: cand.roles, year: cand.year, steady: true });
    if (finderShown.current === finderPreviewKey) return;
    finderShown.current = finderPreviewKey;
    flyToPoints(storyPoints(finderPreviewData.world, finderPreviewData.civ, cand, places), 'finder');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finderPreviewKey]);
  // 点开一个结果的细节:地图再放大到故事里最小的那一国和隘口、交界(两国里多半是要守的那一个)
  const finderDetail = finderOn && finder.page === 'detail';
  useEffect(() => {
    if (!finderDetail || !finderPreviewData || !finderPick) return;
    const { cand, places } = finderPick;
    const near = places.filter((p) => p.kind !== 'port');
    let small = 0;
    cand.sizes.forEach((s, i) => s < cand.sizes[small] && (small = i));
    const one = cand.roles.length ? { ...cand, roles: [cand.roles[small]], capitals: cand.capitals.slice(small, small + 1) } : cand;
    flyToPoints(storyPoints(finderPreviewData.world, finderPreviewData.civ, one, near), 'finder');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finderDetail, finderPreviewKey]);
  // 离开新建(回我的世界、打开别的世界):找世界那一页收起,结果不要了
  useEffect(() => {
    if (draft) return;
    finderBack.current = null;
    setFound(null);
    setOutlineSrc(null);
    if (getFinder().open || getFinder().run) resetFinder();
    // 新建界面收起着(在找世界那一页)就离开了新建:进新建之前的投影、经纬网换回来(平常是新建界面卸下时自己换)
    const c = takeStudioView();
    if (c) {
      if (c.proj !== 'equirect' && getProjection() === 'equirect') setProjection(c.proj, c.flat);
      setGraticule(c.grat.on);
      setGraticuleStep(c.grat.step);
    }
  }, [draft]);
  /** 「谁是谁」点一行:地图飞到那一国 / 那一处 */
  const finderFly = (to: FinderFlyTo) => {
    const pv = finderPreviewData;
    if (!pv || !finderPick) return;
    const { cand, places } = finderPick;
    if ('role' in to) {
      const one = { ...cand, roles: [cand.roles[to.role]], capitals: cand.capitals.slice(to.role, to.role + 1) };
      flyToPoints(storyPoints(pv.world, pv.civ, one, []), 'finder');
    } else {
      const d = foundDetail(pv.world, pv.civ, cand, places).places[to.place];
      if (d) flyToPoints([[d.x, d.y]], 'finder', 4);
    }
  };
  /** 「用这个世界」:新建中的世界就是它(还没生成好就接着生成),回到新建第 2 步,种子和推演设定锁着 */
  const takeFinderPick = () => {
    const back = finderBack.current;
    const pick = finderPick;
    const run = getFinder().run;
    if (!back || !pick || !run) return;
    finderPreview(pick.row.seed);
    // 放宽了一点的:记下的说法、交界几国、撑多少年照放宽以后的门槛(就是判它合的那一套)
    const q = variantOf(run.query, getFinder().variant);
    const { cand, places } = pick;
    const pv = finderPreviewData;
    const fixed = run.setup.map === 'fixed';
    const fp = foundPickOf(q, cand, places, pv ? foundDetail(pv.world, pv.civ, cand, places) : null, { map: fixed ? 'fixed' : 'each', params: back.target.params });
    setFound({
      mapSeed: fixed ? back.target.params.seed : pick.row.seed,
      civSeed: pick.row.seed,
      year: cand.year,
      roles: fp.roles.map((r) => ({ role: r.role, name: r.name })),
      places: [...new Set(fp.places.map((p) => p.title))],
      pick: fp,
      pts: pv ? storyPoints(pv.world, pv.civ, cand, places) : [],
      gen: genSigOf(targetRef.current!.params, targetRef.current!.edits),
      ...(outlineSrc ? { from: outlineSrc.from, outline: outlineSrc.from.plots.length } : {}),
    });
    closeFinder();
    setCivHighlight(null);
    applyMapView(back.view);
  };
  /** 从大纲页来的:大纲搬到建好的这个世界,国家换成找到的那几国,对不上的标「要重新指」(outlineMove.ts);不是 = null */
  const moveFoundOutline = (f: NonNullable<typeof found>) => {
    const civNow = realCivRef.current;
    const t = targetRef.current;
    if (!f.from || !civNow || !t || civNow.seed !== f.civSeed) return null;
    const moved = moveOutline(f.from, f.pick.query, f.pick.roles.map((r) => r.polity), civNow, f.pick.map === 'fixed' && f.from.mapKey === mapKeyOf(t.params, getEdits()));
    if (moved.plots.length) setOutlinePlots(moved.plots);
    return moved;
  };
  /**
   * 照故事找的世界建好了:隘口、交界加成作者标记,侧栏顶上记一组「照故事找的」(foundStore.ts),提示一次;
   * 新建界面淡出以后地图飞到故事里的几国
   */
  const foundCreated = (f: NonNullable<typeof found>) => {
    const id = targetRef.current?.id;
    const w = data?.world;
    if (!id || !w) return;
    const spots = f.pick.places.map((p) => {
      const mark = addMark({ title: p.title, color: p.kind === 'pass' ? 'orange' : 'purple', from: f.year, at: [w.mesh.x[p.cell], w.mesh.y[p.cell]], note: `照故事找的：${p.note}` });
      return { ...p, mark };
    });
    putFound(id, { ...f.pick, places: spots });
    const moved = moveFoundOutline(f);
    setFound(null);
    if (isStored(id))
      showToast({
        id: 'created',
        kind: 'ok',
        dot: true,
        text: `建好了，停在第 ${f.year} 年`,
        more: [
          ...(f.places.length ? [`${f.places.join('、')}加成了地图上的标记，不要了在「标记」里删`] : []),
          ...(moved?.plots.length ? [`大纲带过来了${moved.redo ? `，${moved.redo} 条有对不上的，在「大纲」里标着「要重新指」` : ''}`] : []),
        ],
        ttl: 7000,
      });
    foundFly.current = { id, polities: f.pick.roles.map((r) => r.polity), year: f.year, pts: f.pts };
  };
  /** 侧栏「照故事找的」点「再找」:照搜的时候的世界参数新建一个世界,打开找世界那一页,条件照这次的(还没走的那批结果接着用) */
  const findAgainNow = (p: FoundPick) => {
    openTarget(draftTarget(p.params));
    if (!draftNow()) return;
    setQuery(p.query);
    setFinderMap(p.map);
    openFinderPage();
  };
  const findAgainRef = useRef(findAgainNow);
  findAgainRef.current = findAgainNow;
  useEffect(() => {
    setFindAgainHandler((p) => findAgainRef.current(p));
    return () => setFindAgainHandler(null);
  }, []);
  /**
   * 大纲页「找更合的世界」:照这个世界新建一个(世界参数、地形、推演年数、拓荒、起源、天灾、规则、地名风格、纪年照原来的),打开找世界那一页;
   * 大纲里写到最多的几国先列成故事里的国家(叫法用大纲里的国名,条件空着让作者加)。建好以后大纲搬过去(foundCreated)
   */
  const findForOutlineNow = () => {
    const cur = currentWorld();
    const t = targetRef.current;
    const civNow = realCivRef.current;
    const e = getEdits();
    if (!cur || !t || t.kind === 'draft' || !civNow || !e.outline?.plots.length) return;
    const from = outlineFrom({ civ: civNow, plots: e.outline.plots, marks: e.marks, characters: e.characters }, cur.id, mapKeyOf(t.params, e));
    const view = { base: mapViewRef.current.base, fill: mapViewRef.current.fill };
    const { endYear, frontier, origins, calamity, rules, nameMix, era, months, monthNames, sketch } = e;
    const keep: WorldEdits = {
      ...EMPTY_EDITS,
      terrain: [...e.terrain],
      ...(sketch ? { sketch } : {}),
      ...(nameMix ? { nameMix } : {}),
      ...(endYear ? { endYear } : {}),
      ...(frontier ? { frontier } : {}),
      ...(origins ? { origins } : {}),
      ...(calamity ? { calamity } : {}),
      ...(rules ? { rules } : {}),
      ...(era ? { era } : {}),
      ...(months !== undefined ? { months } : {}),
      ...(monthNames ? { monthNames } : {}),
    };
    closeOverview();
    openTarget(draftTarget(t.params, null, keep));
    if (!draftNow()) return;
    setQuery({ roles: outlineRoles(from), together: [] });
    setFinderMap('each');
    setOutlineSrc({ from, view });
    openFinderPage();
  };
  const findOutlineRef = useRef(findForOutlineNow);
  findOutlineRef.current = findForOutlineNow;
  useEffect(() => {
    setOutlineFinder(() => findOutlineRef.current());
    return () => setOutlineFinder(null);
  }, []);
  /** 照故事找的世界建好、新建界面淡出以后:地图飞到故事里的几国 */
  const foundFly = useRef<{ id: string; polities: number[]; year: number; pts: [number, number][] } | null>(null);
  useEffect(() => {
    const ff = foundFly.current;
    if (!ff || studioOut !== 0 || draft || !data || !realCiv || currentWorld()?.id !== ff.id) return;
    foundFly.current = null;
    // 「用这个世界」时按那个世界算好的那一块;没算好(还在生成就点了)按几国那年的州
    let pts = ff.pts;
    if (!pts.length) {
      const own = ownersAt(realCiv, ff.year).polity;
      const seat = realCiv.regions.seat;
      pts = [];
      for (let r = 0; r < own.length; r++) if (ff.polities.includes(own[r])) pts.push([data.world.mesh.x[seat[r]], data.world.mesh.y[seat[r]]]);
    }
    flyToPoints(pts, 'world');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioOut, draft, data, realCiv]);
  /** 「用这个世界」以后、新建中的世界还是找到的那个(换了种子、文明种子就不算了) */
  // (改了世界参数、地形、草图也不算:国家、地方对不上了)
  const foundNow =
    found && draft && !finderOn && found.gen === genSigOf(params, edits) && (cleanCivSeed(edits.civSeed) ?? params.seed) === found.civSeed ? found : null;
  return { finderBack, outlineSrc, openFinderPage, exitFinder, finderPreviewData, finderFly, takeFinderPick, moveFoundOutline, foundCreated, foundNow };
}
