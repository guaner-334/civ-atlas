/**
 * 推一把发展那一页:国家干预页点「推一把发展」(方针下面)、国家卡片「推一把」一行,卡片换成这一页(和天灾页同一种做法,不弹窗;
 * 下的令先进待推演的单子,pendingStore.ts;推演规则见 gen/civ/boost.ts)。
 *
 *   从哪年起    −100 −10 [年份] +10,默认干预页的生效年份 / 时间轴那一年(逐年推演:固定"第 N 年年初(下一步)",不能加减)
 *   力度        快 3 倍 / 快 10 倍(默认)/ 直接进下一个时代:一种一行(下面一句后果)、选中的浅蓝底打勾(电脑、手机一样)
 *   管多久      快几倍才有:20 / 50 / 100 年(默认 50),下面"到 1550 年为止。之后照常长……"
 *   进到哪个时代  直接进才有:以国都为准的下一个时代("国都现在是青铜时代，进下一个");国都已在最后一个时代 = 用不了,写原因
 *   推哪里      整国 | 几州:整国默认这国,「换一国」在地图上点;几州在地图上点,点一下加进来、再点去掉,最多 BOOST_REGIONS_MAX 州
 *   缺物产      快几倍、要跨的门槛治下一州都没有那样物产:黄字先说清(只长到门口,要等邻国传过来;要当即进选直接进)
 *   推完大约会怎样  电脑一块灰底(现在、物产、方针 / 编年史、之后);手机不放
 *   地图        推的州先涂出来(civView 一直亮着的高亮),旁边小牌子"大澜王朝 93 州" / "青月坞一带 9 州";离开这一页收起
 *   底部        返回 / 加入待推演(逐年推演写「加入」)
 */
import { Fragment, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { Civ } from '../gen/civ/types';
import { cnNumber } from '../gen/civ/chronicle';
import { capitalAt, polityAlive } from '../gen/civ/growth';
import { ERAS } from '../gen/civ/development';
import { ownersAt } from '../gen/civ/timeline';
import { BOOST_REGIONS_MAX, BOOST_YEARS, BOOST_YEARS_DEFAULT, polityKey, regionKey, type BoostMul, type Intervention } from '../gen/edits';
import { spaced, yearAt, yearSpanAt } from '../gen/era';
import { useEra } from './editsStore';
import { useNarrow } from './device';
import { queueIntervention } from './pendingStore';
import { nextAt, nextYear, useStepwise } from './stepwiseStore';
import { STEP_LOOK_WHY, StepEffectTime, useStepView } from './Stepwise';
import { defaultYear, getPolityPick, nameAt, setPolityPick, usePolityPick, type PolityPick } from './Interventions';
import { YearRow, jumpTo, rgb, useYearInput } from './panelParts';
import { closeCmdPage } from './panelStore';
import { getCivHighlight, setCivHighlight } from './civView';
import { alivePolities } from './crownInfo';
import { livingCity } from './newIvInfo';
import { FOCUS_NAMES, policyAt } from './policyInfo';
import { boostLook, boostQueueText, boostRegionsName, gatesText, type BoostIv } from './boostInfo';
import './newIv.css';

/** 力度的三档:快 3 倍、快 10 倍、直接进下一个时代(下面一句后果) */
const KINDS: { mul: BoostMul | null; name: string; desc: string }[] = [
  { mul: 3, name: '快 3 倍', desc: '比别国明显快，国都一带先进一步' },
  { mul: 10, name: '快 10 倍', desc: '几十年里大半个国家进下一个时代' },
  { mul: null, name: '直接进下一个时代', desc: '这一年当即进，治下各州都拉到那个时代开头' },
];

/** id = 从哪国的干预页进来(年份范围:立国 … 亡国前一年);year = 时间轴那一年;from = 干预页的生效年份;onBack = 「返回」(不给 = 回到干预页) */
export function BoostPage({ civ, id, year, from, onBack }: { civ: Civ; id: number; year: number; from?: number; onBack?: () => void }) {
  const era = useEra();
  const phone = useNarrow();
  const sw = useStepwise();
  const step = sw.on;
  const look = useStepView().look;
  const back = onBack ?? closeCmdPage;
  const p = civ.polities[id];
  const last = Math.max(0, Math.ceil(civ.endYear) - 1);
  const lo = Math.ceil(p.founded);
  const hi = Math.max(lo, Math.min(last, p.ended !== undefined ? Math.ceil(p.ended) - 1 : last));
  const [msg, setMsg] = useState<string | null>(null);
  const clear = () => setMsg(null);
  const yi = useYearInput(from ?? defaultYear(p, year), lo, hi, clear);
  const y = step ? nextYear(sw) : yi.y;
  /** 看国土、时代用哪一年(逐年推演的下一步还没算出来:按"现在"看) */
  const yv = step ? Math.min(nextAt(sw), civ.endYear) : y;
  /** 面板标题上的国名(单子、提示条写它,和用户点的那个对得上) */
  const shown = nameAt(p, year);

  const [kind, setKind] = useState(1);
  const mul = KINDS[kind].mul;
  const [years, setYears] = useState<number>(BOOST_YEARS_DEFAULT);
  const [mode, setMode] = useState<'polity' | 'regions'>('polity');
  const [bpol, setBpol] = useState<number | null>(null);
  const [bregs, setBregs] = useState<number[] | null>(null);
  const pid = bpol ?? id;
  const P = civ.polities[pid];
  const pName = P ? nameAt(P, y) : '';
  const capR = useMemo(() => {
    const c = P && polityAlive(P, yv) ? capitalAt(P, yv) : -1;
    return c >= 0 ? civ.settlements[c].region : -1;
  }, [civ, P, yv]);
  const regs = useMemo(() => bregs ?? (capR >= 0 ? [capR] : []), [bregs, capR]);
  const regsKey = regs.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const info = useMemo(() => boostLook(civ, pid, mode === 'regions' ? regs : null, yv), [civ, pid, mode, regsKey, yv]);
  const area = mode === 'polity' ? info.lands : regs;
  const regsName = useMemo(() => boostRegionsName(civ, regs, yv), [civ, regsKey, yv]); // eslint-disable-line react-hooks/exhaustive-deps
  const peopled = useMemo(() => {
    const own = ownersAt(civ, yv).culture;
    return regs.some((r) => own[r] >= 0);
  }, [civ, regsKey, yv]); // eslint-disable-line react-hooks/exhaustive-deps
  /** 一州在地图上的落点:有城写在城下面,没城写在州的中心 */
  const cellOf = (r: number) => {
    const c = livingCity(civ, r, yv);
    return c >= 0 ? civ.settlements[c].cell : civ.regions.seat[r];
  };

  // 地图上先把推的州涂出来(一直亮着,换了范围跟着换);离开这一页收起
  const tagText = mode === 'polity' ? (area.length ? `${pName} ${area.length} 州` : '') : regsName;
  const tagCell = area.length ? (mode === 'polity' && capR >= 0 ? cellOf(capR) : cellOf(regs[0])) : -1;
  useEffect(() => {
    if (!area.length) {
      if (getCivHighlight()?.steady) setCivHighlight(null);
      return;
    }
    setCivHighlight({ regions: area, polities: [], year: yv, steady: true, tag: tagCell >= 0 ? { text: tagText, cell: tagCell } : undefined });
  }, [area, yv, tagText, tagCell]);
  useEffect(
    () => () => {
      if (getCivHighlight()?.steady) setCivHighlight(null);
    },
    [],
  );

  // 在地图上点(一国、几州);离开这一页时收起
  const source = `boost:${id}`;
  const pk = usePolityPick();
  const picking = pk?.source === source;
  useEffect(
    () => () => {
      if (getPolityPick()?.source === source) setPolityPick(null);
    },
    [source],
  );
  const toYear = () => jumpTo(step ? Math.min(y, sw.now) : y);
  const when = yearAt(y, era);
  const pickRegions = () => {
    clear();
    toYear();
    const make = (list: number[]): PolityPick => ({
      prompt: `点州加进来，再点一下去掉（已选 ${list.length} 州，最多 ${BOOST_REGIONS_MAX} 州）`,
      sub: `${when}起推一把发展`,
      source,
      target: 'region',
      year: yv,
      keep: true,
      accept: (r) => {
        const has = list.includes(r);
        if (!has && list.length >= BOOST_REGIONS_MAX) return `最多 ${BOOST_REGIONS_MAX} 州`;
        const next = has ? list.filter((x) => x !== r) : [...list, r];
        setBregs(next);
        setPolityPick(make(next));
        return null;
      },
    });
    setPolityPick(make(regs));
  };
  const alive = useMemo(() => new Set(alivePolities(civ, yv).map((x) => x.id)), [civ, yv]);
  const pickPolity = () => {
    clear();
    toYear();
    setPolityPick({
      prompt: '选推一把发展的国家',
      sub: `${when}还在的国家都能选`,
      source,
      eligible: alive,
      year: yv,
      accept: (q) => {
        if (!alive.has(q)) return `${when}这个国家不在`;
        setBpol(q);
        setBregs(null);
        return null;
      },
    });
  };

  const why = (() => {
    if (step && look !== null) return STEP_LOOK_WHY;
    if (!step && !yi.valid) return `年份要在${spaced(yearSpanAt(lo, hi, era))}之间`;
    if (!P || !polityAlive(P, y)) return P && y < P.founded ? `${when}${pName}还没立国` : `${when}${pName || '这国'}已亡`;
    if (mode === 'regions') {
      if (!regs.length) return '在地图上点几州';
      if (!peopled) return '选的州那年都没人住';
    }
    if (mul === null && info.next < 0) return `${pName}已在${ERAS[ERAS.length - 1]}时代，没有下一个了`;
    return null;
  })();

  const go = () => {
    if (why) return;
    const v: BoostIv = { kind: 'boost', a: polityKey(civ, pid), from: y };
    if (mul !== null) {
      v.mul = mul;
      v.until = y + years;
    }
    if (mode === 'regions') v.regions = regs.map((r) => regionKey(civ, r));
    // 这国:写面板标题上的名字;换过的照那年的名字
    const A = pid === id ? shown : pName;
    const run = { self: id, target: null, shown: pid === id ? shown : undefined };
    const err = queueIntervention(v as Intervention, boostQueueText(civ, v, A, info.next, era), run);
    if (err) return setMsg(err);
    back();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || picking) return;
    e.stopPropagation();
    back();
  };
  const chooseKind = (k: number) => {
    clear();
    setKind(k);
  };

  /** 在地图上点到一半:那一行换成"在地图上点…"和取消 */
  const pickingRow = (text: string) => (
    <div className="oc-pick picking" data-boost="pick">
      <span className="oc-pick-empty">{text}</span>
      <span className="oc-pick-acts">
        <button className="cp-step" onClick={() => setPolityPick(null)}>
          取消
        </button>
      </span>
    </div>
  );

  const nextName = info.next >= 0 ? ERAS[info.next] : '';
  const scopeWord = mode === 'regions' ? '这几州' : '治下各州';
  /** 几州后面那一句:国都 / 国都附近 / 这国境内 / 跨几国 */
  const regsAfter = (() => {
    if (!regs.length) return '';
    if (regs.length === 1 && regs[0] === capR) return '国都';
    if (regs.includes(capR)) return '国都附近';
    const own = ownersAt(civ, yv).polity;
    const ps = new Set(regs.map((r) => own[r]));
    return ps.size === 1 && ps.has(pid) ? `${pName}境内` : `跨 ${ps.size} 处`;
  })();

  // 推完大约会怎样(电脑):现在、物产、方针 / 编年史、之后
  const sum: [string, string][] = (() => {
    const after: [string, string] = ['之后', '人口上限、兵力跟着涨，打仗更强；国界、兴亡照规矩跟着变'];
    if (mul === null) {
      const where = mode === 'regions' ? regsName : pName;
      const line = mode === 'regions' ? `「${where.replace(/ (\d+) 州$/, (_, n: string) => `${cnNumber(Number(n))}州`)}变法图强，一时并进」` : `「${pName}变法图强，诸州一时并进」`;
      const then = (mode === 'polity' || regs.includes(capR)) && nextName ? `，接着照常记「始入${nextName}时代」` : '';
      return [
        ['现在', info.now],
        ['物产', '不看物产：缺铜缺铁也照样进'],
        ['编年史', `${line}${then}`],
        ['之后', '这一年起照常长；人口上限、兵力跟着涨，国界、兴亡照规矩跟着变'],
      ];
    }
    if (mode === 'regions' || info.lack) return [['现在', info.now], after];
    const pol = policyAt(civ, pid, y);
    const focus = pol?.focus ? `发展重点「${FOCUS_NAMES[pol.focus]}」：挑中那样再快一些、别的略慢（两样相乘）` : '没定发展重点；定了的话挑中那样再快一些（两样相乘）';
    const gates = gatesText(info);
    return [['现在', info.now], ...(gates ? [['物产', gates] as [string, string]] : []), ['方针', focus], after];
  })();

  const until = y + years;
  return (
    <div className="cr-page bk-page" onKeyDown={onKey}>
      <div className="cp-body cr-form" data-boost="form">
        {step ? (
          <StepEffectTime phone={phone} />
        ) : (
          <div className="cp-from">
            <span className="cp-k">从哪年起</span>
            <YearRow yi={yi} label="推一把的年份" />
            <span className="cp-note">这年之前的历史不变，之后重新推演。</span>
          </div>
        )}
        <div className="iv-h">力度</div>
        <div className="cp-cmds iv-kinds" role="radiogroup" aria-label="力度">
          {KINDS.map((x, k) => (
            <button key={k} role="radio" aria-checked={kind === k} className={`cp-cmd${kind === k ? ' on' : ''}`} data-boost-kind={x.mul ?? 'jump'} onClick={() => chooseKind(k)}>
              <span className="cp-cmd-main">
                <span className="cp-cmd-name">{x.name}</span>
                <span className="cp-cmd-desc">{x.desc}</span>
              </span>
              {kind === k && <span className="cr-check">✓</span>}
            </button>
          ))}
        </div>
        {mul === null ? (
          <div className="cp-form" data-boost="era">
            <span className="cp-form-title">进到哪个时代</span>
            <div className="bk-era">
              {info.next >= 0 ? (
                <>
                  <b>{nextName}时代</b>
                  <span className="cr-after">国都现在是{ERAS[info.capEra]}时代，进下一个</span>
                </>
              ) : (
                <>
                  <b>没有下一个时代</b>
                  <span className="cr-after">国都已在{ERAS[info.capEra]}时代</span>
                </>
              )}
            </div>
            <span className="cp-note">
              {info.next >= 0 ? `${scopeWord}都拉到${nextName}时代开头，本来就在的不动。想再往后进，过些年再下一条。` : '已经走到最后一个时代，用不了。'}
            </span>
          </div>
        ) : (
          <div className="cp-form" data-boost="years">
            <span className="cp-form-title">管多久</span>
            <div className="cp-dur" role="radiogroup" aria-label="管多久">
              {BOOST_YEARS.map((n) => (
                <button key={n} role="radio" aria-checked={years === n} className={years === n ? 'on' : ''} data-years={n} onClick={() => (clear(), setYears(n))}>
                  {n} 年
                </button>
              ))}
            </div>
            <span className="cp-note">到{spaced(yearAt(until, era))}为止。之后照常长，长上去的不会退回去。</span>
          </div>
        )}
        <div className="cp-form" data-boost="scope">
          <span className="cp-form-title">推哪里</span>
          <div className="cp-dur" role="radiogroup" aria-label="推哪里">
            {(['polity', 'regions'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} data-act={`boost-${m}`} onClick={() => (clear(), setMode(m), picking && setPolityPick(null))}>
                {m === 'polity' ? '整国' : '几州'}
              </button>
            ))}
          </div>
          {mode === 'polity' ? (
            picking ? (
              pickingRow('在地图上点一国…')
            ) : (
              <div className="oc-pick cr-pick iv-pick" data-boost="polity">
                {P ? (
                  <span className="oc-pick-name">
                    <i className="cr-dot lg" style={{ background: rgb(P.color) }} />
                    <b>{pName}</b>
                    <span className="cr-after">{info.lands.length} 州</span>
                  </span>
                ) : (
                  <span className="oc-pick-empty">换一国</span>
                )}
                <span className="oc-pick-acts">
                  <button className="cp-step" data-act="boost-pick-polity" onClick={pickPolity}>
                    换一国
                  </button>
                </span>
              </div>
            )
          ) : (
            <div className={`oc-pick cr-pick iv-pick${picking ? ' picking' : ''}`} data-boost="regions">
              {regs.length ? (
                <span className="oc-pick-name">
                  <b>{regsName}</b>
                  <span className="cr-after">{regsAfter}</span>
                </span>
              ) : (
                <span className="oc-pick-empty">还没选州</span>
              )}
              <span className="oc-pick-acts">
                <button className="cp-step" data-act="boost-pick-regions" onClick={pickRegions}>
                  在地图上点
                </button>
              </span>
            </div>
          )}
          <span className="cp-note">{mode === 'polity' ? '这些年里新打下的州也跟着推；丢掉的州不再推。' : '在地图上点州加进来，再点一下去掉。只推这几州，别的州照常。'}</span>
        </div>
        {mul !== null && info.lack && (
          <span className="iv-warn" data-boost="lack">
            {mode === 'regions' ? '这几州连同' : ''}
            {pName}治下一州{info.lack.res}都没有：快几倍也只长到{ERAS[info.lack.era]}时代门口，要等邻国把{ERAS[info.lack.era]}传过来才进得去。要当即进，选「直接进下一个时代」（不看物产）。
          </span>
        )}
        {!phone && (
          <div className="iv-sum" data-boost="sum">
            {sum.map(([k, v]) => (
              <Fragment key={k}>
                <span>{k}</span>
                <span>{v}</span>
              </Fragment>
            ))}
          </div>
        )}
        {(msg || why) && <div className="cp-msg">{msg ?? why}</div>}
      </div>
      <div className="cp-foot mk-foot">
        <button className="cp-btn" data-act="boost-back" onClick={back}>
          返回
        </button>
        <button className="cp-btn primary" data-act="boost-go" disabled={!!why || picking} onClick={go}>
          {step ? '加入' : '加入待推演'}
        </button>
      </div>
    </div>
  );
}
