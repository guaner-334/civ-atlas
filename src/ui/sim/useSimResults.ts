/**
 * 后台线程交回的推演结果换上界面(App 用;和线程打交道的那一层见 ./simClient.ts):
 *   - 重推好的历史(civ):州、宜居度沿用原来那一份,选中的东西按稳定键换过去,时间轴从改的那年接着放,顶上说一声(带撤销)
 *   - 逐年推演走完一步(turn)、再推好了(extended)、照大纲推演的进度和结果(outlineProgress、outlined)
 *   - 历史换了一份时,选中的东西、编年史和人物页的国家筛选按稳定键换成新历史里的编号;地图上的地名表换了时,选中的地方跟着换
 * 界面的状态还在 App 里,要读、要改的 ref 和 setter 由 App 传进来(SimResultsDeps)。这里的函数每次渲染新建(和原来写在 App 里一样),
 * 线程的回调经返回的 xxxRef.current 调到最新的那一份。
 */
import { useEffect, useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { EraWorld, WorkerRequest } from '../../worker';
import type { Civ } from '../../gen/civ/types';
import { noteExtendSpeed, setExtendBusy, setExtendFresh } from '../extendStore';
import { enterStepwise, getStepGesture, getStepwise, onStepGestureEnd, stepLost, stepwiseActions } from '../stepwiseStore';
import { clearChroniclePick, clearSelection, getChronicle, getCivTime, getSelection, setChronicle, setCivTime, setSelection, startCivReplay, getCivHighlight, setCivHighlight, type MapSelection } from '../civView';
import { YEAR_TICKS, applyNames, cleanEndAt, cleanPlay, cultureKey, faithKey, ownInterventions, placeKeyOf, playAt, playFromOf, polityKey, resolveKey, sameInterventions, settlementKey, treatyKey, tradeKey, type Intervention, type PlayState, type PlotReview, type Plot, type TerrainOp, type Upheaval } from '../../gen/edits';
import { sameUpheavals } from '../../gen/terrainEdits';
import { baseRegions, eraMapsOf, reuseRegions, type EraMaps } from '../eras';
import { getEdits, putOutlineResult, putPlay, removeEditsBatch, removeIntervention, removeUpheaval, setEndYear } from '../editsStore';
import { eraText, monthNamesInUse, monthsOf, spaced, yearAt, yearFull } from '../../gen/era';
import { momentFull } from '../stepTime';
import { currentWorld, refreshThumb } from '../saveStore';
import { interventionActorThen, interventionDoneText, setPolityPick } from '../Interventions';
import { policyDoneText } from '../policyInfo';
import { disasterDoneArea, newIvDoneText } from '../newIvInfo';
import { personKey, resolvePersonKey } from '../flyTo';
import { applyCharacters } from '../../gen/characters';
import { crownDoneText, crownWho, type CrownResimNote } from '../crownInfo';
import { postDoneText } from '../authorIvInfo';
import { getPanel } from '../panelStore';
import { getPeople, openOverview, setPeople } from '../overviewStore';
import { setOutlineRun } from '../outlineStore';
import { outlineDoneToast, outlineRunToast } from '../OutlineSide';
import { isNarrow } from '../device';
import { filterChronicle, interventionOutcome } from '../../gen/civ/story/chronicle';
import { fullChronicle } from '../../gen/civ/story/religionText';
import { clearToast, showToast } from '../Toast';
import { timelineAfterResim, upheavalName } from '../upheavalStore';
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import type { RewriteNote } from '../rewriteStore';
import type { SimClient } from './simClient';

/** 再推好了的提示条停多久(和加干预以后的一样);推之前那一份(撤销用)多留一会儿再放掉 */
const EXTEND_TOAST_MS = 7000;
const EXTEND_UNDO_MS = EXTEND_TOAST_MS + 1000;

/** 改名里有几处在这份历史里找不到(找不到的先保留着) */
export const lostRenames = (civ: Civ, names: Record<string, string>) => Object.keys(names).filter((k) => !resolveKey(civ, k)).length;
/** 打开世界时提示条上说改名对不上的那一句 */
export const lostRenamesNote = (n: number) => `${n} 处改名没对上,先保留`;

/** 逐年推演切到了别的一支:from = 原来那支的编号,fromRef / toRef = 两支在句子里的叫法,year = 切到的那一支的"现在" */
export interface SwitchNote {
  from: number;
  fromRef: string;
  toRef: string;
  year: number;
}
/** 切到别的一支了(停在那一支的"现在"):说一声,带「切回」原来那支 */
export function switchedToast(sw: SwitchNote) {
  showToast({
    id: 'step-switched',
    kind: 'ok',
    text: `已切到${sw.toRef}，${yearFull(sw.year, getEdits().era)}`,
    action: { label: `切回${sw.fromRef}`, act: 'step-switch-back', onClick: () => stepwiseActions()?.switchBranch(sw.from) },
    ttl: 8000,
  });
}

/** 正在重推的这一次:第几次、从哪一年起变、什么时候发出去的,推完怎么说(App 的 resimInfo) */
export interface ResimInfo {
  seq: number;
  year: number;
  t0: number;
  workerMs?: number;
  arrived?: number;
  /** 这次重推是新加了一条干预 / 撤销了一条(推完在顶部提示"…,已从 N 年起重新推演""已撤销") */
  added?: Intervention;
  removed?: Intervention;
  /** 这次重推是待推演的单子一次加了几条(干预、地形大事;推完提示"N 条命令已生效",撤销一次撤掉整批) */
  batch?: { ivs: Intervention[]; ups: Upheaval[] };
  /** 这次重推是改 / 删人物时他的即位跟着改了(推完提示"林小满的即位跟着改了；已从 N 年起重新推演";删人物的带撤销) */
  crown?: CrownResimNote;
  /** 这次重推是新加了一件地形大事 / 撤销了一件 */
  upAdded?: Upheaval;
  upRemoved?: Upheaval;
  left?: number;
  /** 读档 / 自动恢复套上的干预:推完不提示、不打断自动播放 */
  quiet?: boolean;
  /** 这次重推是一次 AI 改写 / 撤销改写(推完说"已按你说的改写",带撤销) */
  note?: RewriteNote;
  /** 这次只换了推演年数(刚创建的世界接着往后推) */
  years?: boolean;
}

/** 打开世界时等着重推完再核对的改名(App 的 renameCheck) */
export type RenameCheck = { id: string; terrain: readonly TerrainOp[]; show: (line: string) => void };
/** 正在再推的这一次(App 的 extendRef) */
export type ExtendJob = { xid: number; from: number; to: number; t0: number; endYear: number | undefined };
/** 再推好了、提示条上「撤销」要换回去的那一份(App 的 extendUndo) */
export type ExtendUndo = { before: Civ; after: Civ; from: number; endYear: number | undefined; timer: number };
/** 正在照大纲推演的这一次(App 的 outlineRef) */
export type OutlineJob = { oid: number; plots: Plot[]; own: Intervention[]; marks: string; characters: string; t0: number };

type Ref<T> = MutableRefObject<T>;
type Setter<T> = Dispatch<SetStateAction<T>>;

/** App 传进来的:换上结果要读、要改的界面状态 */
export interface SimResultsDeps {
  sim: SimClient;
  reqId: Ref<number>;
  rawRef: Ref<Civ | null>;
  setRawCiv: Setter<Civ | null>;
  rawUps: Ref<readonly Upheaval[] | undefined>;
  civUps: Ref<readonly Upheaval[] | undefined>;
  civEdits: Ref<readonly Intervention[]>;
  civPlay: Ref<PlayState | undefined>;
  civYears: Ref<number | undefined>;
  genTerrain: Ref<readonly TerrainOp[]>;
  baseRef: Ref<{ world: World; raster: Raster } | null>;
  eraMapsRef: Ref<EraMaps | null>;
  setEraMaps: Setter<EraMaps | null>;
  resimInfo: Ref<ResimInfo | null>;
  setResim: Setter<{ year: number; end?: number; text?: string } | null>;
  renameCheck: Ref<RenameCheck | null>;
  rewindNote: Ref<{ year: number } | null>;
  stepAuto: Ref<boolean>;
  switchNote: Ref<SwitchNote | null>;
  storyAfterYears: Ref<boolean | null>;
  extendRef: Ref<ExtendJob | null>;
  extendUndo: Ref<ExtendUndo | null>;
  outlineRef: Ref<OutlineJob | null>;
  endOutline: () => void;
  realCiv: Civ | null;
  realCivRef: Ref<Civ | null>;
  narrowRef: Ref<boolean>;
  shownRaw: Civ | null;
}

export function useSimResults(d: SimResultsDeps) {
  const { sim, reqId, rawRef, setRawCiv, rawUps, civUps, civEdits, civPlay, civYears, genTerrain, baseRef, eraMapsRef, setEraMaps, resimInfo, setResim, renameCheck, rewindNote, stepAuto, switchNote, storyAfterYears, extendRef, extendUndo, outlineRef, endOutline, realCiv, realCivRef, narrowRef, shownRaw } = d;
  /**
   * 历史换了一份(重推完、在地图上看试推演 / 回到现在):选中的东西、编年史和人物页的国家筛选按稳定键换成新历史里的编号(指不到就取消)。
   * 选中的地方(山海河湖)在下面跟着地图上的地名表换
   */
  const remapSelection = (old: Civ, civ: Civ) => {
    const { sel } = getSelection();
    if (sel) {
      const key =
        sel.kind === 'polity' && old.polities[sel.id]
          ? polityKey(old, sel.id)
          : sel.kind === 'settlement' && old.settlements[sel.id]
            ? settlementKey(old, sel.id)
            : sel.kind === 'faith' && old.religion?.faiths[sel.id]
              ? faithKey(old, sel.id)
              : sel.kind === 'culture' && old.cultures[sel.id]
                ? cultureKey(old, sel.id)
                : sel.kind === 'treaty'
                  ? treatyKey(old, sel.id) || null
                  : sel.kind === 'trade'
                    ? tradeKey(old, sel.id) || null
                  : null;
      if (key) {
        const r = resolveKey(civ, key);
        if (r && r.kind === sel.kind) setSelection({ kind: sel.kind, id: r.id } as MapSelection);
        else clearSelection();
      } else if (sel.kind === 'person') {
        // 人物:同一国、同名、同年生的还在就还选着他(重推后历史变了,多半找不到了)
        const id = old.people?.[sel.id] ? resolvePersonKey(civ, personKey(old, sel.id)) : -1;
        if (id >= 0) setSelection({ kind: 'person', id });
        else clearSelection();
      }
    }
    const cp = getChronicle().polity;
    if (cp !== null) {
      const r = old.polities[cp] ? resolveKey(civ, polityKey(old, cp)) : null;
      setChronicle({ polity: r && r.kind === 'polity' ? r.id : null });
    }
    const pp = getPeople().polity;
    if (pp !== null) {
      const r = old.polities[pp] ? resolveKey(civ, polityKey(old, pp)) : null;
      // 世系图看哪一朝、圈出谁跟着旧历史的编号,作废
      setPeople({ polity: r && r.kind === 'polity' ? r.id : null, dynasty: null, focus: null });
    }
  };
  // 地图上的地名表换了一份(重推完、看试推演、时间轴跨过地形大事):选中的地方按稳定键换成这一份里的编号;
  // 锚点挪了的(海扩大了……)找同种类同名的那一处(大事前后同一处地方沿用地名),都没有就取消。换了世界的不管
  const shownRef = useRef<Civ | null>(null);
  useLayoutEffect(() => {
    const was = shownRef.current;
    shownRef.current = shownRaw;
    if (!was || !shownRaw || was.places === shownRaw.places || baseRegions(was) !== baseRegions(shownRaw)) return;
    const { sel } = getSelection();
    const p = sel?.kind === 'place' ? was.places[sel.id] : undefined;
    if (!sel || !p) return;
    const r = resolveKey(shownRaw, placeKeyOf(was, sel.id));
    const id = r && r.kind === 'place' ? r.id : shownRaw.places.findIndex((q) => q.kind === p.kind && q.name === p.name);
    if (id < 0) clearSelection();
    else if (id !== sel.id) setSelection({ kind: 'place', id });
  }, [shownRaw]);
  /**
   * 推好的一份历史换上之前(重推、逐年推演走一步、再推):州、宜居度沿用 old(地图上这一份;地理没变,时间轴、地图按它认"还是同一个世界";
   * 没有 = 原样用 next),记下这份带的地形大事;地形大事以后各段的世界和现在一样(只改了干预)就不换,地图不用重画
   */
  const adoptCiv = (old: Civ | null, next: Civ, eras: EraWorld[] | undefined, baseKey: string): Civ => {
    const sameUps = sameUpheavals(civUps.current, rawUps.current);
    const civ: Civ = old ? reuseRegions(old, next, sameUps, true) : next;
    rawUps.current = civUps.current;
    const base = baseRef.current;
    const cur = eraMapsRef.current;
    if (!eras?.length || !base) setEraMaps(null);
    else if (!cur || cur.baseKey !== baseKey || cur.keys.join('|') !== eras.map((e) => e.key).join('|')) setEraMaps(eraMapsOf(base.world, baseKey, eras));
    return civ;
  };
  /**
   * 重推好的文明换上去(阶段 4 干预):州、宜居度沿用原来那一份(地理没变;时间轴、地图按它认"还是同一个世界"),
   * 选中的东西、编年史的国家筛选按稳定键换成新历史里的编号(指不到就取消),时间轴从干预那一年接着放(地形大事卡片开着时不动)
   */
  const applyResim = (next: Civ, workerMs: number, eras: EraWorld[] | undefined, baseKey: string) => {
    const old = rawRef.current;
    const civ = adoptCiv(old, next, eras, baseKey);
    if (old) remapSelection(old, civ);
    clearChroniclePick();
    setPolityPick(null);
    const info = resimInfo.current;
    if (info) {
      info.workerMs = workerMs;
      info.arrived = performance.now() - info.t0;
      // 平常从生效年份起接着放;地形大事卡片开着时时间轴不动、停下播放(upheavalStore.ts 的 timelineAfterResim)
      if (!info.quiet) timelineAfterResim(Math.min(civ.endYear, Math.max(0, info.year)));
      // 已生效(停 7 秒,带撤销)/ 已撤销(停 4 秒)
      const y = Math.max(0, Math.floor(info.year));
      // 年份照作者的纪年写:"从 1650 年起" / "从公元前 850 年起"
      const era = getEdits().era;
      const at = (n: number) => yearAt(n, era);
      if (info.note) {
        const n = info.note;
        if (n.kind === 'apply') {
          // 这一批新加的命令里有几条没生效(两国不接壤、州里没人住……;原因在概览"我的干预"页)
          const ks = (l: readonly Intervention[]) => l.map((v) => JSON.stringify(v));
          const had = ks(n.before.interventions);
          const done = ks(civ.interventions ?? []);
          const failed = ks(n.after.interventions)
            .filter((k) => !had.includes(k))
            .map((k) => done.indexOf(k))
            .filter((i) => i >= 0 && !interventionOutcome(civ, i).ok).length;
          showToast({
            id: 'resim-done',
            kind: failed ? 'warn' : 'ok',
            text: `已按你说的改写 · 从${spaced(at(y))}重新推演`,
            more: failed ? [`${failed} 条命令没生效,原因见概览的"我的干预"`] : undefined,
            action: n.undo && {
              label: '撤销',
              act: 'rw-undo',
              onClick: () => {
                n.undo?.();
                clearToast('resim-done');
              },
            },
            ttl: 7000,
          });
        } else {
          showToast({ id: 'resim-done', kind: 'ok', text: info.left ? `已撤销改写,从${spaced(at(y))}起重新推演` : `已撤销改写,${at(y)}之后恢复原历史`, ttl: 4000 });
        }
      } else if (info.crown) {
        const undo = info.crown.undo;
        showToast({
          id: 'resim-done',
          kind: 'ok',
          text: `${info.crown.text}；已从${spaced(at(y))}起重新推演`,
          action: undo && {
            label: '撤销',
            act: 'character-restore',
            onClick: () => {
              clearToast('resim-done');
              undo();
            },
          },
          ttl: 7000,
        });
      } else if (info.batch) {
        // 待推演的单子一次推完:几条没生效(两国不接壤、州里没人住……)的原因在概览"我的干预"页
        const { ivs, ups } = info.batch;
        const done = (civ.interventions ?? []).map((x) => JSON.stringify(x));
        const failed = ivs.map((v) => done.indexOf(JSON.stringify(v))).filter((i) => i >= 0 && !interventionOutcome(civ, i).ok).length;
        const n = ivs.length + ups.length;
        showToast({
          id: 'resim-done',
          kind: failed ? 'warn' : 'ok',
          text: `${n - failed} 条命令已生效,已从${spaced(at(y))}起重新推演`,
          more: failed ? [`${failed} 条没生效,原因见概览的"我的干预"`] : undefined,
          action: {
            label: '撤销',
            act: 'iv-batch-undo',
            onClick: () => {
              removeEditsBatch(ivs, ups);
              clearToast('resim-done');
            },
          },
          ttl: 7000,
        });
      } else if (info.added) {
        const v = info.added;
        const named = applyNames(civ, getEdits().names);
        const idx = (civ.interventions ?? []).findIndex((x) => JSON.stringify(x) === JSON.stringify(v));
        // 国家面板下的令:写面板标题上的名字(用户点的那个);那一年它叫别的名字,第二行补一句
        const run = getPanel().run;
        const shown = run && run.from === v.from ? run.shown : undefined;
        const then = interventionActorThen(named, v);
        // 即位:写人物的名字、到哪年下台;没即位成(那年国已亡、他还没出生……)黄色,写原因
        // 方针:"大澜王朝定方针「扩张」",没生效的黄色写原因(同即位)
        // 灭国、让人物去世、改倾向、等下台再即位:"东定国亡，13 州并入大定";将领、名臣去世历史不变,写"历史不变",不写重新推演
        const chars = getEdits().characters;
        const crowned =
          v.kind === 'crown' && !v.after
            ? crownDoneText(applyCharacters(named, chars), v, idx, chars, era)
            : v.kind === 'appoint' || (v.kind === 'regent' && v.char !== undefined)
              ? postDoneText(named, v, idx, crownWho(named, v.char, chars), era)
              : v.kind === 'policy'
              ? policyDoneText(named, v, idx, shown ?? then ?? '', era)
              : newIvDoneText(v.kind === 'crown' ? applyCharacters(named, chars) : named, v, idx, shown ?? then ?? '', era, v.kind === 'crown' ? crownWho(named, v.char, chars) : '');
        showToast({
          id: 'resim-done',
          kind: crowned && !crowned.ok ? 'warn' : 'ok',
          text: crowned
            ? crowned.ok && 'same' in crowned && crowned.same
              ? crowned.text
              : `${crowned.text}；已从${spaced(at(y))}起重新推演`
            : `${eraText(interventionDoneText(named, v, idx, shown), era)},已从${spaced(at(y))}起重新推演`,
          more: !crowned && shown && then && then !== shown ? [`${at(v.from)}时它叫${then}`] : undefined,
          action: {
            label: '撤销',
            onClick: () => {
              const i = getEdits().interventions.findIndex((x) => JSON.stringify(x) === JSON.stringify(v));
              if (i >= 0) removeIntervention(i);
              clearToast('resim-done');
            },
          },
          ttl: 7000,
        });
        // 天灾:提示条开着时,受灾的州在地图上淡淡涂着(地图转过去),提示条收起时一起收起
        const hit = v.kind === 'disaster' && crowned?.ok ? disasterDoneArea(named, v) : [];
        if (hit.length) {
          setCivHighlight({ regions: hit, polities: [], year: v.from, steady: true, faint: true });
          const st = getCivHighlight()?.stamp;
          window.setTimeout(() => getCivHighlight()?.stamp === st && setCivHighlight(null), 7000);
        }
      } else if (info.upAdded) {
        const u = info.upAdded;
        showToast({
          id: 'resim-done',
          kind: 'ok',
          text: `${at(u.year)}${upheavalName(u)} · 从这一年起重新推演`,
          action: {
            label: '撤销',
            onClick: () => {
              const i = (getEdits().upheavals ?? []).findIndex((x) => JSON.stringify(x) === JSON.stringify(u));
              if (i >= 0) removeUpheaval(i);
              clearToast('resim-done');
            },
          },
          ttl: 7000,
        });
      } else if (info.removed || info.upRemoved) {
        showToast({ id: 'resim-done', kind: 'ok', text: info.left ? `已撤销,从${spaced(at(y))}起重新推演` : `已撤销,${at(y)}之后恢复原历史`, ttl: 4000 });
      }
    }
    setRawCiv(civ);
    setResim(null);
    // 打开世界时等着重推完再核对的改名:按推好的历史数对不上的,有就补进打开时那条提示(换了世界、改了地形的不算了)
    const rn = renameCheck.current;
    renameCheck.current = null;
    if (rn && rn.id === currentWorld()?.id && rn.terrain === genTerrain.current) {
      const lost = lostRenames(civ, getEdits().names);
      if (lost) rn.show(lostRenamesNote(lost));
    }
    // 逐年推演的世界推到"现在"了:时间轴只放这一段,播放头停在"现在";刚点了「开始演绎」的接着就往下走
    const play = civPlay.current;
    const rw = rewindNote.current;
    rewindNote.current = null;
    if (play && rw && rw.year === playAt(play) / YEAR_TICKS && getStepwise().on && getStepwise().now === rw.year) {
      // 刚从这一年重新演绎:界面早就停在这一年了(推的时候点了「接着演绎」的照走),这里只说一声
      const e = getEdits();
      showToast({
        id: 'step-rewound',
        kind: 'ok',
        dot: true,
        text: `已回到${momentFull(rw.year, monthsOf(e.months), e.era, monthNamesInUse(e.monthNames), false)}`,
        ttl: 7000,
      });
    } else if (play && cleanPlay(getEdits().play)) {
      enterStepwise(playFromOf(getEdits()), playAt(play) / YEAR_TICKS);
      setCivTime({ year: playAt(play) / YEAR_TICKS, playing: stepAuto.current, scrubbing: false, story: false });
      stepAuto.current = false;
      // 刚切到别的一支:停在那一支的"现在",说一声,带「切回」原来那支
      const sw = switchNote.current;
      switchNote.current = null;
      if (sw && sw.year === play.year) switchedToast(sw);
    }
    // 刚创建的世界接着往后推完了:缩略图按推完的样子重截,该放历史的从第 0 年放一遍
    if (info?.years && !play) {
      refreshThumb();
      if (storyAfterYears.current) startCivReplay();
      storyAfterYears.current = null;
    }
  };
  const applyResimRef = useRef(applyResim);
  applyResimRef.current = applyResim;

  /**
   * 逐年推演走完一步(worker 的 turn):推得更远的历史换上去(州、宜居度沿用;以前的历史一点没变,选中的东西编号不变),
   * 修改里的进度跟着换(不重推);没收下的干预说一声。是不是该停一下由 Stepwise.tsx 看
   */
  const applyTurn = (next: Civ, play: PlayState, rejected: unknown[], eras: EraWorld[] | undefined, baseKey: string) => {
    // 用的人正按着地图:松开再换上(换历史要重画整张地图,拖着的时候会卡一下)
    if (getStepGesture()) {
      onStepGestureEnd(() => applyTurnRef.current(next, play, rejected, eras, baseKey));
      return;
    }
    const now = cleanPlay(getEdits().play);
    // 换了世界、另开了一次逐年推演、这一步不是接着现在这份进度走的:不要
    if (!now || !getStepwise().on || !getStepwise().busy || playAt(play) <= playAt(now)) return stepLost();
    const civ = adoptCiv(rawRef.current, next, eras, baseKey);
    civPlay.current = play;
    putPlay(play);
    setRawCiv(civ);
    if (rejected.length) showToast({ id: 'step-rejected', kind: 'warn', text: `${rejected.length} 条干预没能下`, more: ['只能在「现在」干预'], ttl: 5000 });
  };
  const applyTurnRef = useRef(applyTurn);
  applyTurnRef.current = applyTurn;

  /**
   * 再推 N 年推好了(worker 的 extend):前面的历史一点没变,州、宜居度沿用,选中的东西编号不变;
   * 推演年数存进修改(存档、自动存、分享链接都记着推到哪),播放头停在原处。
   * 顶上提示条「从第 N 年接着看」(从原来的结束年份按现在的速度往后放,导播开着就导播放)、「撤销」(换回推之前那一份)
   */
  const applyExtended = (xid: number, next: Civ, to: number, ms: number, eras: EraWorld[] | undefined, baseKey: string) => {
    const x = extendRef.current;
    const old = rawRef.current;
    if (!x || x.xid !== xid || !old) return;
    // 用的人正按着地图(拖、捏合、滚轮):松开再换上(换历史要重画整张地图、重排时间轴,拖着的时候会卡一下)
    if (getStepGesture()) {
      onStepGestureEnd(() => applyExtendedRef.current(xid, next, to, ms, eras, baseKey));
      return;
    }
    extendRef.current = null;
    setExtendBusy(null);
    const civ = adoptCiv(old, next, eras, baseKey);
    // 有地形大事的世界是从第 0 年整段推的
    noteExtendSpeed(civUps.current?.length ? 0 : x.from, to, ms);
    // 先记下推到哪年,修改里的推演年数跟着换时不再重推一遍
    civYears.current = cleanEndAt(to);
    // 播放头停在原处:推的时候放到了原来的结束年份(停在"现在")的,钉在那一年(不然换上以后"现在"成了新的结尾)
    if (getCivTime().year === null) setCivTime({ year: x.from });
    setRawCiv(civ);
    setEndYear(to);
    setExtendFresh({ from: x.from, to });
    refreshThumb();
    dropExtendUndo();
    extendUndo.current = { before: old, after: civ, from: x.from, endYear: x.endYear, timer: window.setTimeout(dropExtendUndo, EXTEND_UNDO_MS) };
    // 提示条等新的历史画上去以后再出(新添几件大事要数整段编年史,时间轴那时已经算好了,不再算一遍)
    extendDone.current = { xid, from: x.from, to, ms, t0: x.t0, arrived: performance.now() - x.t0 };
  };
  const applyExtendedRef = useRef(applyExtended);
  applyExtendedRef.current = applyExtended;
  /** 刚推好、提示条还没出的那一次 */
  const extendDone = useRef<{ xid: number; from: number; to: number; ms: number; t0: number; arrived: number } | null>(null);
  useEffect(() => {
    const d = extendDone.current;
    if (!d || !realCiv || realCiv.endYear !== d.to) return;
    extendDone.current = null;
    // 新添几件大事(和时间轴上默认画的"大事"同一个口径)
    const fresh = filterChronicle(fullChronicle(realCiv), { major: true, polity: null }).filter((e) => e.year > d.from).length;
    // 推到一年中间的(停在年中存回的世界)写到月,正好在年初的只写年
    const e = getEdits();
    const at = (y: number) => momentFull(y, monthsOf(e.months), e.era, monthNamesInUse(e.monthNames), false);
    showToast({
      id: 'extend-done',
      kind: 'ok',
      dot: true,
      text: `已推到${at(d.to)}`,
      more: [`新添 ${fresh} 件大事`],
      actions: [
        {
          label: narrowRef.current ? '接着看' : `从${at(d.from)}接着看`,
          primary: true,
          act: 'extend-watch',
          onClick: () => {
            clearToast('extend-done');
            setCivTime({ year: d.from, playing: true, scrubbing: false, story: false });
          },
        },
        { label: '撤销', act: 'extend-undo', onClick: () => undoExtendRef.current() },
      ],
      ttl: EXTEND_TOAST_MS,
    });
    (window as unknown as { __wfExtend: unknown }).__wfExtend = { xid: d.xid, from: d.from, to: d.to, workerMs: d.ms, arrivedMs: d.arrived, shownMs: performance.now() - d.t0, fresh };
  }, [realCiv]);
  /** 提示条收起以后不能撤销了:推之前那一份放掉 */
  const dropExtendUndo = () => {
    const u = extendUndo.current;
    if (u) clearTimeout(u.timer);
    extendUndo.current = null;
  };
  /** 提示条上的「撤销」:回到推之前 —— 历史换回推之前那一份(一模一样),推演年数改回去 */
  const undoExtend = () => {
    clearToast('extend-done');
    const u = extendUndo.current;
    dropExtendUndo();
    if (!u || extendRef.current) return;
    setExtendFresh(null);
    const t = getCivTime();
    if (t.year !== null && t.year > u.from) setCivTime({ year: u.from, playing: false, scrubbing: false, story: false });
    if (rawRef.current === u.after) {
      civYears.current = cleanEndAt(u.from);
      remapSelection(u.after, u.before);
      setRawCiv(u.before);
      refreshThumb();
    }
    // 推完以后又改过别的(干预……):只把推演年数改回去,照常重推。修改里原来没写推演年数的(3000 年)照样不写
    setEndYear(u.endYear);
  };
  const undoExtendRef = useRef(undoExtend);
  undoExtendRef.current = undoExtend;
  /** 照大纲推演查完一条 / 开始查一条 / 开始硬改:侧栏、大纲页的进度,顶上的提示条 */
  const outlineProgress = (oid: number, done: number, total: number, review: PlotReview[], at?: { id: number; fix: number | null; trial?: { n: number; of: number } }) => {
    const o = outlineRef.current;
    if (!o || o.oid !== oid) return;
    const run = { oid, done, total, review, at: at?.id ?? null, fix: at?.fix ?? null, trial: at?.trial ?? null };
    setOutlineRun(run);
    const c = realCivRef.current;
    if (c) showToast(outlineRunToast(run, { civ: c, plots: o.plots, review, marks: getEdits().marks, characters: getEdits().characters }, getEdits().era, stopOutlineRun, isNarrow()));
  };
  const outlineProgressRef = useRef(outlineProgress);
  outlineProgressRef.current = outlineProgress;
  /**
   * 照大纲推演好了:干预串(作者的 + 硬改出来的)、批改记进修改(一步,⌘Z 回到推之前),整段历史直接换上(不再重推一遍);
   * 推的时候大纲、作者自己的干预、标记、人物变了:不换上(批改是照推之前那一份算的;大纲、干预变了那边会照新的重推)
   */
  const applyOutlined = (oid: number, next: Civ, ivs: Intervention[], review: PlotReview[], ms: number, eras: EraWorld[] | undefined, baseKey: string) => {
    const o = outlineRef.current;
    if (!o || o.oid !== oid) return;
    if (getStepGesture()) {
      onStepGestureEnd(() => applyOutlinedRef.current(oid, next, ivs, review, ms, eras, baseKey));
      return;
    }
    endOutline();
    const e = getEdits();
    if (JSON.stringify(e.outline?.plots ?? null) !== JSON.stringify(o.plots) || !sameInterventions(ownInterventions(e.interventions), o.own)) return;
    if (JSON.stringify(e.marks ?? null) !== o.marks || JSON.stringify(e.characters ?? null) !== o.characters) {
      showToast({ id: 'outline-done', kind: 'warn', text: '推的时候改了标记或人物，结果没换上', more: ['再点一次「照大纲推演」'], ttl: 7000 });
      return;
    }
    // 先记下这串干预推好了,修改换上时不再重推
    const before = civEdits.current;
    civEdits.current = ivs;
    if (!putOutlineResult(o.plots, review, ivs)) {
      civEdits.current = before;
      return;
    }
    resimInfo.current = null;
    applyResim(next, ms, eras, baseKey);
    showToast(outlineDoneToast(review, () => openOverview('outline')));
  };
  const applyOutlinedRef = useRef(applyOutlined);
  applyOutlinedRef.current = applyOutlined;
  /** 叫停照大纲推演:世界还是推之前那样 */
  const stopOutlineRun = () => {
    const o = outlineRef.current;
    if (!o) return;
    endOutline();
    // 叫停不算一件活(线程不回音):直接发
    sim.tell({ type: 'outlineStop', id: reqId.current, oid: o.oid } satisfies WorkerRequest);
  };

  return { remapSelection, applyResimRef, applyTurnRef, applyExtendedRef, extendDone, dropExtendUndo, outlineProgress, outlineProgressRef, applyOutlinedRef, stopOutlineRun };
}
