/**
 * 大迁徙那一页:州卡片「更多」里点「大迁徙…」、国家干预页点「大迁徙」,卡片换成这一页(和天灾页同一套,不弹窗;下的令先进待推演的单子,
 * pendingStore.ts;推演规则见 gen/edits.ts 的干预"大迁徙""不许迁"、gen/civ/migration.ts)。
 *
 *   哪一年    −100 −10 [年份] +10,默认干预页的生效年份 / 时间轴那一年(逐年推演:固定"第 N 年年初(下一步)",不能加减)
 *   怎么做    迁往某处 / 不许迁:一种一行(下面一句怎么样),选中的浅蓝底打勾(手机上也是一行一种)
 *   哪一族    族色小方块 + 族名 + "游牧民族，从诺敏塔拉出发"(不许迁、没定从哪州走:"住诺敏塔拉等 10 州");「换一族」在地图上点它住的一州
 *             (换成那州的民族、从那州出发)。默认:州卡片 = 这州那年的民族、从这州出发;国家 = 这国的主体民族(从本族离目的地最近的一州走)
 *   往哪去    (迁往某处)推演挑 / 指定一州,默认推演挑:
 *             推演挑 = 再选走多远(近 / 中 / 远),推演照常理找走得到的、崩了乱了的富地;
 *             指定一州 = 州名 + "百尾皇朝，约 13 州远",「换一州」在地图上点(地图压暗、陆路走得到、有城、不是本族的州浮出名牌)
 *   持续到    (不许迁)一直有效 / 到某一年(−100 −10 [年份] +10 +100,默认生效年份 + 100)
 *   地图      出发的那一州先涂出来(civView 一直亮着的高亮),旁边小牌子"从这里出发"(不许迁、还不知道从哪州走:族名);
 *             指定一州时画一条预估的虚线到目的地,箭头旁写州名和"目的地"(TrekPlanLayer.tsx;和推演同一套找路);离开这一页收起
 *   底部      返回 / 加入待推演(逐年推演写「加入」)
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { Civ } from '../gen/civ/types';
import { KIND_INFO, cultureLabel, regionLabel } from '../gen/civ/display';
import { capitalAt, polityAlive } from '../gen/civ/growth';
import { ownersAt } from '../gen/civ/timeline';
import { END_YEAR_MAX, TREK_REACHES, cultureKey, regionKey, type Intervention, type TrekReach } from '../gen/edits';
import { spaced, yearAt, yearSpanAt } from '../gen/era';
import { useEra } from './editsStore';
import { useNarrow } from './device';
import { queueIntervention } from './pendingStore';
import { nextYear, useStepwise } from './stepwiseStore';
import { STEP_LOOK_WHY, StepEffectTime, useStepView } from './Stepwise';
import { defaultYear, getPolityPick, interventionText, nameAt, setPolityPick, usePolityPick } from './Interventions';
import { YearRow, jumpTo, rgb, useYearInput } from './panelParts';
import { closeCmdPage } from './panelStore';
import { getCivHighlight, setCivHighlight } from './civView';
import { TREK_REACH_NAMES, folkRegions, getTrekPlan, livingCityIn, setTrekPlan, trekReach, trekRoute, trekTargets } from './trekInfo';
import './newIv.css';

/** 推演挑时各档走多远(说明里的一句) */
const REACH_NOTE: Record<TrekReach, string> = {
  near: '五到十州',
  mid: '十到二十州',
  far: '二三十州，横穿大陆',
};

/**
 * polity = 从国家干预页进来(年份范围:立国 … 亡国前一年;默认这国的主体民族);region = 从州卡片进来(默认这州的民族、从这州出发)。
 * year = 时间轴那一年;from = 干预页的生效年份;onBack = 「返回」(不给 = 回到干预页)
 */
export function TrekPage({ civ, year, from, polity, region, onBack }: { civ: Civ; year: number; from?: number; polity?: number; region?: number; onBack?: () => void }) {
  const era = useEra();
  const phone = useNarrow();
  const sw = useStepwise();
  const step = sw.on;
  const look = useStepView().look;
  const back = onBack ?? closeCmdPage;
  const p = polity !== undefined ? civ.polities[polity] : undefined;
  // 年份的范围:国家 = 立国那年 … 亡国前一年(同干预页);州 = 0 … 历史推到的前一年
  const last = Math.max(0, Math.ceil(civ.endYear) - 1);
  const lo = p ? Math.ceil(p.founded) : 0;
  const hi = p ? Math.max(lo, Math.min(last, p.ended !== undefined ? Math.ceil(p.ended) - 1 : last)) : last;
  const [msg, setMsg] = useState<string | null>(null);
  const clear = () => setMsg(null);
  const yi = useYearInput(from ?? (p ? defaultYear(p, year) : year), lo, hi, clear);
  const y = step ? nextYear(sw) : yi.y;
  /** 看各州住着谁、走得到哪用哪一年(逐年推演的下一步还没算出来:按"现在"看) */
  const yv = step ? Math.min(y, civ.endYear) : y;
  const when = `${yearAt(y, era)}`;

  const [stay, setStay] = useState(false);
  // 换过的民族和出发的州(没换过 = 默认)
  const [picked, setPicked] = useState<{ c: number; start: number } | null>(null);
  const [dmode, setDmode] = useState<'pick' | 'set'>('pick');
  const [reach, setReach] = useState<TrekReach>('mid');
  const [dest, setDest] = useState<number | null>(null);
  // 不许迁的持续到:一直有效 / 到某一年(截止那年不含,至少是生效年份的下一年)
  const [limited, setLimited] = useState(false);
  const ui = useYearInput(y + 100, step ? y + 1 : Math.min(y + 1, civ.endYear), step ? END_YEAR_MAX : civ.endYear, clear);

  const owners = useMemo(() => ownersAt(civ, yv), [civ, yv]);
  const culture = owners.culture;
  const own = owners.polity;
  const folk = picked ? picked.c : region !== undefined ? (culture[region] ?? -1) : p ? p.culture : -1;
  const C = folk >= 0 ? civ.cultures[folk] : undefined;
  const homes = useMemo(() => (folk >= 0 ? folkRegions(civ, folk, yv) : []), [civ, folk, yv]);
  // 从哪州出发:换过的 = 点的那州;州卡片 = 这州;国家 = 不定(推演从本族离目的地最近的一州走)。那一年那州不是这一族的 = 不定
  const start0 = picked ? picked.start : region !== undefined ? region : -1;
  const start = start0 >= 0 && culture[start0] === folk ? start0 : -1;
  const targets = useMemo(() => (homes.length ? trekTargets(civ, yv, folk, start) : new Set<number>()), [civ, yv, folk, start, homes.length]);
  const route = useMemo(() => (!stay && dmode === 'set' && dest !== null && homes.length ? trekRoute(civ, yv, folk, start, dest) : null), [civ, yv, folk, start, dest, dmode, stay, homes.length]);
  /** 地图上标的那一州:出发的州 / 指定一州时路线的起点 / 这国国都所在的州(住的是这一族的话)/ 这一族住的第一州 */
  const anchor = (() => {
    if (start >= 0) return start;
    if (route) return route[0];
    if (p && polityAlive(p, yv)) {
      const r = civ.settlements[capitalAt(p, yv)]?.region ?? -1;
      if (r >= 0 && culture[r] === folk) return r;
    }
    return homes[0] ?? -1;
  })();
  const knowsStart = !stay && (start >= 0 || !!route);

  const F = C ? cultureLabel(C) : '';
  const kind = C ? `${KIND_INFO[C.kind]?.name ?? ''}民族` : '';
  const folkAfter = !C ? '' : knowsStart && anchor >= 0 ? `${kind}，从${regionLabel(civ, anchor)}出发` : anchor >= 0 ? `${kind}，住${regionLabel(civ, anchor)}${homes.length > 1 ? `等 ${homes.length} 州` : ''}` : kind;
  const D = dest !== null ? regionLabel(civ, dest) : '';
  const destOwner = dest !== null ? civ.polities[own[dest]] : undefined;
  const hops = route ? route.length - 1 : 0;

  // 地图上:出发的那州涂出来,旁边小牌子;指定一州时画预估的虚线(离开这一页收起)
  const tagText = knowsStart ? '从这里出发' : F;
  const tagCell = anchor >= 0 ? (() => {
    const c = livingCityIn(civ, anchor, yv);
    return c >= 0 ? civ.settlements[c].cell : civ.regions.seat[anchor];
  })() : -1;
  useEffect(() => {
    if (anchor < 0) {
      if (getCivHighlight()?.steady) setCivHighlight(null);
      return;
    }
    setCivHighlight({ regions: [anchor], polities: [], year: yv, steady: true, tag: tagCell >= 0 && tagText ? { text: tagText, cell: tagCell } : undefined });
  }, [anchor, yv, tagText, tagCell]);
  const color = C?.color;
  useEffect(() => {
    setTrekPlan(route && color ? { route, color, dest: D } : null);
  }, [route, color, D]);
  useEffect(
    () => () => {
      if (getCivHighlight()?.steady) setCivHighlight(null);
      if (getTrekPlan()) setTrekPlan(null);
    },
    [],
  );

  // 在地图上点(换一族、换一州);离开这一页时收起
  const source = `trek:${polity ?? -1}:${region ?? -1}`;
  const pk = usePolityPick();
  const picking = pk?.source === source ? (pk.eligible ? 'dest' : 'folk') : null;
  useEffect(
    () => () => {
      if (getPolityPick()?.source === source) setPolityPick(null);
    },
    [source],
  );
  const toYear = () => jumpTo(step ? Math.min(y, sw.now) : y);
  const pickFolk = () => {
    clear();
    toYear();
    setPolityPick({
      prompt: '点一州，换成住在那里的民族',
      sub: stay ? `${when}起不许迁` : `${when}从那州出发`,
      source,
      target: 'region',
      year: yv,
      accept: (r) => {
        const c = culture[r] ?? -1;
        if (c < 0) return `${when}这州没人住`;
        setPicked({ c, start: r });
        return null;
      },
    });
  };
  const pickDest = () => {
    clear();
    toYear();
    const { hops: far } = trekReach(civ, yv, folk, start);
    setPolityPick({
      prompt: `点一州，${F}往那里去`,
      sub: `${when}动身，浮出名牌的州走得到`,
      source,
      target: 'region',
      eligible: targets,
      year: yv,
      accept: (r) => {
        if (targets.has(r)) {
          setDest(r);
          setDmode('set');
          return null;
        }
        if (culture[r] === folk) return `那是${F}住的地方`;
        if (!(far[r] > 0)) return '陆路走不到那里';
        return `${when}那州没有住人的城`;
      },
    });
  };

  const why = (() => {
    if (step && look !== null) return STEP_LOOK_WHY;
    if (!step && !yi.valid) return `年份要在${spaced(yearSpanAt(lo, hi, era))}之间`;
    if (!C) return region !== undefined ? '这州那年没人住，换一族' : '这国没有主体民族，换一族';
    if (!homes.length) return C.born > yv ? `${when}${F}还没出现，换一族` : `${when}${F}已不在，换一族`;
    if (stay) return limited && !ui.valid ? `持续到的年份要在${spaced(yearSpanAt(ui.lo, ui.hi, era))}之间` : null;
    if (dmode === 'set') {
      if (dest === null) return '在地图上点一州，往那里去';
      if (!route) return culture[dest] === folk ? `${D}住的就是${F}，换一州` : `陆路走不到${D}，换一州`;
      return null;
    }
    return targets.size ? null : '走得到的地方里没有能去的（有城、不是本族的州）';
  })();

  const go = () => {
    if (why || !C) return;
    const folkKey = cultureKey(civ, folk);
    const v: Intervention = stay
      ? { kind: 'stay', folk: folkKey, from: y, ...(limited ? { until: ui.y } : {}) }
      : {
          kind: 'trek',
          folk: folkKey,
          from: y,
          ...(start >= 0 ? { region: regionKey(civ, start) } : {}),
          ...(dmode === 'set' && dest !== null ? { to: regionKey(civ, dest) } : reach !== 'mid' ? { reach: reach as 'near' | 'far' } : {}),
        };
    const run = polity !== undefined ? { self: polity, target: null } : undefined;
    const err = queueIntervention(v, interventionText(civ, v), run);
    if (err) return setMsg(err);
    back();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || picking) return;
    e.stopPropagation();
    back();
  };
  const chooseMode = (s: boolean) => {
    clear();
    setStay(s);
    if (picking) setPolityPick(null);
  };

  /** 在地图上点到一半:那一行换成"在地图上点…"和取消 */
  const pickingRow = (text: string) => (
    <div className="oc-pick picking" data-trek="pick">
      <span className="oc-pick-empty">{text}</span>
      <span className="oc-pick-acts">
        <button className="cp-step" onClick={() => setPolityPick(null)}>
          取消
        </button>
      </span>
    </div>
  );

  return (
    <div className="cr-page" onKeyDown={onKey}>
      <div className="cp-body cr-form" data-trek="form">
        {step ? (
          <StepEffectTime phone={phone} />
        ) : (
          <div className="cp-from">
            <span className="cp-k">哪一年</span>
            <YearRow yi={yi} label="大迁徙的年份" />
            <span className="cp-note">这年之前的历史不变，之后重新推演。</span>
          </div>
        )}
        <div className="iv-h">怎么做</div>
        <div className="cp-cmds iv-kinds" role="radiogroup" aria-label="怎么做">
          {[
            { s: false, name: '迁往某处', desc: '分出一支举族远走，路上洗劫，到了在那一带立国' },
            { s: true, name: '不许迁', desc: '这些年里推演不会让这一族大迁徙' },
          ].map((x) => (
            <button key={x.name} role="radio" aria-checked={stay === x.s} className={`cp-cmd${stay === x.s ? ' on' : ''}`} data-mode={x.s ? 'stay' : 'go'} onClick={() => chooseMode(x.s)}>
              <span className="cp-cmd-main">
                <span className="cp-cmd-name">{x.name}</span>
                <span className="cp-cmd-desc">{x.desc}</span>
              </span>
              {stay === x.s && <span className="cr-check">✓</span>}
            </button>
          ))}
        </div>
        <div className="cp-form" data-trek="folk">
          <span className="cp-form-title">哪一族</span>
          {picking === 'folk' ? (
            pickingRow('在地图上点一州…')
          ) : (
            <div className="oc-pick cr-pick iv-pick">
              {C ? (
                <span className="oc-pick-name">
                  <i className="tk-sw" style={{ background: rgb(C.color) }} />
                  <b>{F}</b>
                  <span className="cr-after">{folkAfter}</span>
                </span>
              ) : (
                <span className="oc-pick-empty">{region !== undefined ? '这州那年没人住，换一族' : '这国没有主体民族，换一族'}</span>
              )}
              <span className="oc-pick-acts">
                <button className="cp-step" data-act="trek-folk" onClick={pickFolk}>
                  换一族
                </button>
              </span>
            </div>
          )}
        </div>
        {stay ? (
          <div className="cp-form" data-trek="until">
            <span className="cp-form-title">持续到</span>
            <div className="cp-dur" role="radiogroup" aria-label="持续到">
              <button role="radio" aria-checked={!limited} className={limited ? '' : 'on'} data-act="trek-until-off" onClick={() => (clear(), setLimited(false))}>
                一直有效
              </button>
              <button
                role="radio"
                aria-checked={limited}
                className={limited ? 'on' : ''}
                data-act="trek-until-on"
                onClick={() => {
                  if (limited) return;
                  clear();
                  // 每次打开都从生效年份 + 100 起
                  ui.nudge(y + 100 - ui.y);
                  setLimited(true);
                }}
              >
                到某一年
              </button>
            </div>
            {limited && <YearRow yi={ui} label="持续到的年份" wide />}
            <span className="cp-note">已经在路上的照走。避兵外迁这类小股的搬家不受影响。</span>
          </div>
        ) : (
          <div className="cp-form" data-trek="dest">
            <span className="cp-form-title">往哪去</span>
            <div className="cp-dur" role="radiogroup" aria-label="往哪去">
              {(['pick', 'set'] as const).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={dmode === m}
                  className={dmode === m ? 'on' : ''}
                  data-act={`trek-dest-${m}`}
                  onClick={() => (clear(), setDmode(m), picking && setPolityPick(null))}
                >
                  {m === 'pick' ? '推演挑' : '指定一州'}
                </button>
              ))}
            </div>
            {dmode === 'pick' ? (
              <>
                <div className="cp-dur" role="radiogroup" aria-label="走多远">
                  {TREK_REACHES.map((r) => (
                    <button key={r} role="radio" aria-checked={reach === r} className={reach === r ? 'on' : ''} data-reach={r} onClick={() => (clear(), setReach(r))}>
                      {TREK_REACH_NAMES[r]}
                    </button>
                  ))}
                </div>
                <span className="cp-note">照常理往走得到的、附近崩了乱了的富地去，走{REACH_NOTE[reach]}。落在哪，推演了才知道。</span>
              </>
            ) : (
              <>
                {picking === 'dest' ? (
                  pickingRow('在地图上点一州…')
                ) : (
                  <div className="oc-pick cr-pick iv-pick" data-trek="to">
                    {dest !== null ? (
                      <span className="oc-pick-name">
                        <b>{D}</b>
                        <span className="cr-after">
                          {[destOwner ? nameAt(destOwner, y) : '部落地带', route ? `约 ${hops} 州远` : ''].filter(Boolean).join('，')}
                        </span>
                      </span>
                    ) : (
                      <span className="oc-pick-empty">还没选目的地</span>
                    )}
                    <span className="oc-pick-acts">
                      <button className="cp-step" data-act="trek-dest" onClick={pickDest} disabled={!homes.length}>
                        {dest !== null ? '换一州' : '选一州'}
                      </button>
                    </span>
                  </div>
                )}
                <span className="cp-note">地图上的虚线是大致的路：草原上快，林地、山地慢，不过海。走几年、打不打得下，推演了才知道。</span>
              </>
            )}
          </div>
        )}
        {(msg || why) && <div className="cp-msg">{msg ?? why}</div>}
      </div>
      <div className="cp-foot mk-foot">
        <button className="cp-btn" data-act="trek-back" onClick={back}>
          返回
        </button>
        <button className="cp-btn primary" data-act="trek-go" disabled={!!why || !!picking} onClick={go}>
          {step ? '加入' : '加入待推演'}
        </button>
      </div>
    </div>
  );
}
