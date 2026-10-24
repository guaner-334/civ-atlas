/**
 * 天灾那一页:国家干预页点「天灾」、州卡片「更多」里点「天灾…」,卡片换成这一页(和灭国页同一种做法,不弹窗;下的令先进待推演的单子,
 * pendingStore.ts;推演规则见 gen/edits.ts 的干预"天灾")。
 *
 *   哪一年    −100 −10 [年份] +10,默认干预页的生效年份 / 时间轴那一年(逐年推演:固定"第 N 年年初(下一步)",不能加减)
 *   种类      瘟疫 / 饥荒 / 地震水旱:电脑一种一行(下面一句怎么闹)、选中的浅蓝底打勾;手机一排三格
 *   范围      瘟疫 = 从哪座城起:默认这州的城 / 这国的国都,「换一座」在地图上点一州(那州的城);照瘟疫的规矩传开,传到哪推演了才知道
 *             饥荒 = 一国 | 几州:一国默认这州的主人 / 这国,「换一国」在地图上点;几州在地图上点,点一下加进来、再点去掉,最多 64 州
 *             地震水旱 = 点一处,连同陆上接壤的一圈州(quakeRing),「在地图上换一处」
 *   轻重      轻 / 中 / 重,下面一句后果(城里约死一成半 / 三成 / 五成;手机只写死几成)
 *   地图      受灾的州先涂出来(civView 一直亮着的高亮),旁边小牌子"翼门之野一带 8 州";离开这一页收起
 *   底部      返回 / 加入待推演(逐年推演写「加入」)
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { Civ } from '../gen/civ/types';
import { capitalAt, polityAlive, populationLabel } from '../gen/civ/growth';
import { regionLabel } from '../gen/civ/display';
import { ownersAt } from '../gen/civ/timeline';
import {
  DISASTER_NAMES,
  DISASTER_REGIONS_MAX,
  DISASTER_TYPES,
  polityKey,
  regionKey,
  settlementKey,
  type DisasterLevel,
  type DisasterType,
  type Intervention,
} from '../gen/edits';
import { spaced, yearAt, yearSpanAt } from '../gen/era';
import { useEra } from './editsStore';
import { useNarrow } from './device';
import { queueIntervention } from './pendingStore';
import { nextYear, useStepwise } from './stepwiseStore';
import { STEP_LOOK_WHY, StepEffectTime, useStepView } from './Stepwise';
import { defaultYear, getPolityPick, nameAt, setPolityPick, usePolityPick, type PolityPick } from './Interventions';
import { YearRow, jumpTo, rgb, useYearInput } from './panelParts';
import { closeCmdPage } from './panelStore';
import { getCivHighlight, setCivHighlight } from './civView';
import { alivePolities } from './crownInfo';
import { disasterArea, disasterLevelNote, disasterQueueText, disasterToll, livingCity, type DisasterSpot } from './newIvInfo';
import './newIv.css';

/** 电脑上种类一行一种:下面那一句 */
const KIND_DESC: Record<DisasterType, string> = {
  plague: '从一座城起，照瘟疫的规矩沿路传开',
  famine: '选一国或几州，乡下饿死一片',
  quake: '点一处，连同附近一圈州',
};
const LEVELS: { l: DisasterLevel; name: string }[] = [
  { l: 1, name: '轻' },
  { l: 2, name: '中' },
  { l: 3, name: '重' },
];

/**
 * polity = 从国家干预页进来(年份范围:立国 … 亡国前一年;默认国都、整个国家);region = 从州卡片进来(默认这州)。
 * year = 时间轴那一年;from = 干预页的生效年份;onBack = 「返回」(不给 = 回到干预页)
 */
export function DisasterPage({ civ, year, from, polity, region, onBack }: { civ: Civ; year: number; from?: number; polity?: number; region?: number; onBack?: () => void }) {
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
  /** 看国土、城、人口用哪一年(逐年推演的下一步还没算出来:按"现在"看) */
  const yv = step ? Math.min(y, civ.endYear) : y;
  /** 面板标题上的国名(单子、提示条写它,和用户点的那个对得上) */
  const shown = p ? nameAt(p, year) : undefined;

  const [type, setType] = useState<DisasterType>('plague');
  const [level, setLevel] = useState<DisasterLevel>(2);
  // 换过的范围(没换过 = 默认)
  const [city, setCity] = useState<number | null>(null);
  const [fmode, setFmode] = useState<'polity' | 'regions'>(p ? 'polity' : 'regions');
  const [fpol, setFpol] = useState<number | null>(null);
  const [fregs, setFregs] = useState<number[] | null>(null);
  const [center, setCenter] = useState<number | null>(null);

  // 那一年各州的主人;默认的范围:州卡片 = 这州(它的城、它的主人),国家 = 国都(那一州)、这国
  const own = useMemo(() => ownersAt(civ, yv).polity, [civ, yv]);
  const home = useMemo(() => {
    if (region !== undefined) return { region, city: livingCity(civ, region, yv), owner: own[region] ?? -1 };
    const c = p && polityAlive(p, yv) ? capitalAt(p, yv) : -1;
    return { region: c >= 0 ? civ.settlements[c].region : -1, city: c, owner: polity ?? -1 };
  }, [civ, region, polity, p, yv, own]);
  const cityId = city ?? home.city;
  const fp = fpol ?? home.owner;
  const regs = fregs ?? (home.region >= 0 ? [home.region] : []);
  const qc = center ?? home.region;

  const spot: DisasterSpot | null =
    type === 'plague'
      ? cityId >= 0
        ? { type, city: cityId }
        : null
      : type === 'quake'
        ? qc >= 0
          ? { type, region: qc }
          : null
        : fmode === 'polity'
          ? fp >= 0
            ? { type, polity: fp }
            : null
          : { type, regions: regs };
  const spotKey = JSON.stringify(spot);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const area = useMemo(() => (spot ? disasterArea(civ, spot, yv) : []), [civ, spotKey, yv]);
  const toll = useMemo(() => disasterToll(civ, area, yv), [civ, area, yv]);

  const S = civ.settlements[cityId];
  const cityOk = !!S && livingCity(civ, S.region, yv) === cityId;
  const F = civ.polities[fp];
  const fName = F ? nameAt(F, y) : '';
  const regsName = regs.length ? `${regionLabel(civ, regs[0])}${regs.length > 1 ? `等 ${regs.length} 州` : ''}` : '';
  const R = qc >= 0 ? regionLabel(civ, qc) : '';
  /** 一州在地图上的落点:有城写在城下面,没城写在州的中心 */
  const cellOf = (r: number) => {
    const c = livingCity(civ, r, yv);
    return c >= 0 ? civ.settlements[c].cell : civ.regions.seat[r];
  };

  // 地图上的小牌子
  const tag = (() => {
    if (!spot || !area.length) return null;
    if (spot.type === 'plague') return S ? { text: `从${S.name || '那座城'}起`, cell: S.cell } : null;
    if (spot.type === 'quake') return { text: `${R}一带 ${area.length} 州`, cell: cellOf(qc) };
    if ('polity' in spot) {
      const c = F && polityAlive(F, yv) ? capitalAt(F, yv) : -1;
      return { text: `${fName} ${area.length} 州`, cell: c >= 0 ? civ.settlements[c].cell : cellOf(area[0]) };
    }
    return { text: regsName, cell: cellOf(regs[0]) };
  })();
  const tagText = tag?.text ?? '';
  const tagCell = tag?.cell ?? -1;
  // 地图上先把受灾的州涂出来(一直亮着,换了范围跟着换);离开这一页收起
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

  // 在地图上点(城所在的州、一处、一国、几州);离开这一页时收起
  const source = `disaster:${polity ?? -1}:${region ?? -1}`;
  const pk = usePolityPick();
  const picking = pk?.source === source;
  useEffect(
    () => () => {
      if (getPolityPick()?.source === source) setPolityPick(null);
    },
    [source],
  );
  const toYear = () => jumpTo(step ? Math.min(y, sw.now) : y);
  const when = `${yearAt(y, era)}`;
  const pickRegion = (prompt: string, sub: string, accept: (r: number) => string | null) => {
    clear();
    toYear();
    setPolityPick({ prompt, sub, source, target: 'region', year: yv, accept });
  };
  const pickCity = () =>
    pickRegion('点一州，瘟疫从那州的城起', `${when}起疫，照瘟疫的规矩传开`, (r) => {
      const c = livingCity(civ, r, yv);
      if (c < 0) return `${when}这州没有住人的城`;
      setCity(c);
      return null;
    });
  const pickQuake = () =>
    pickRegion('点一处，连同附近一圈州受灾', `${when}${DISASTER_NAMES.quake}`, (r) => {
      setCenter(r);
      return null;
    });
  const pickFamineRegions = () => {
    clear();
    toYear();
    const make = (list: number[]): PolityPick => ({
      prompt: `点州加进来，再点一下去掉（已选 ${list.length} 州，最多 ${DISASTER_REGIONS_MAX} 州）`,
      sub: `${when}闹饥荒`,
      source,
      target: 'region',
      year: yv,
      keep: true,
      accept: (r) => {
        const has = list.includes(r);
        if (!has && list.length >= DISASTER_REGIONS_MAX) return `最多 ${DISASTER_REGIONS_MAX} 州`;
        const next = has ? list.filter((x) => x !== r) : [...list, r];
        setFregs(next);
        setPolityPick(make(next));
        return null;
      },
    });
    setPolityPick(make(regs));
  };
  const alive = useMemo(() => new Set(alivePolities(civ, yv).map((x) => x.id)), [civ, yv]);
  const pickFaminePolity = () => {
    clear();
    toYear();
    setPolityPick({
      prompt: '选闹饥荒的国家',
      sub: `${when}还在的国家都能选`,
      source,
      eligible: alive,
      year: yv,
      accept: (q) => {
        if (!alive.has(q)) return `${when}这个国家不在`;
        setFpol(q);
        return null;
      },
    });
  };

  const why = (() => {
    if (step && look !== null) return STEP_LOOK_WHY;
    if (!step && !yi.valid) return `年份要在${spaced(yearSpanAt(lo, hi, era))}之间`;
    if (type === 'plague') {
      if (!S) return p ? '那年这国没有国都，换一座' : '这州那年没有住人的城，换一座';
      return cityOk ? null : `${when}${S.name || '那座城'}已不在`;
    }
    if (type === 'quake') return qc < 0 ? '在地图上点一处' : toll.hit ? null : '那一带那年没人住';
    if (fmode === 'polity') {
      if (!F) return '这州那年不属哪国，换一国';
      return polityAlive(F, y) ? null : y < F.founded ? `${when}${fName}还没立国` : `${when}${fName}已亡`;
    }
    if (!regs.length) return '在地图上点几州';
    return toll.hit ? null : '选的州那年都没人住';
  })();

  const go = () => {
    if (why || !spot) return;
    const base = { kind: 'disaster' as const, type, level, from: y };
    const v: Intervention =
      spot.type === 'plague'
        ? { ...base, city: settlementKey(civ, spot.city) }
        : spot.type === 'quake'
          ? { ...base, region: regionKey(civ, spot.region) }
          : 'polity' in spot
            ? { ...base, a: polityKey(civ, spot.polity) }
            : { ...base, regions: spot.regions.map((r) => regionKey(civ, r)) };
    // 饥荒一国:写面板标题上的名字(是这国的话);别的照那年的名字
    const A = spot.type === 'famine' && 'polity' in spot ? (spot.polity === polity ? shown : fName) : undefined;
    const run = polity !== undefined ? { self: polity, target: null, shown: A !== undefined && A === shown ? shown : undefined } : undefined;
    const err = queueIntervention(v, disasterQueueText(civ, v, A, toll.hit), run);
    if (err) return setMsg(err);
    back();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || picking) return;
    e.stopPropagation();
    back();
  };
  const chooseType = (t: DisasterType) => {
    clear();
    setType(t);
    if (picking) setPolityPick(null);
  };

  /** 在地图上点到一半:那一行换成"在地图上点…"和取消 */
  const pickingRow = (text: string) => (
    <div className="oc-pick picking" data-disaster="pick">
      <span className="oc-pick-empty">{text}</span>
      <span className="oc-pick-acts">
        <button className="cp-step" onClick={() => setPolityPick(null)}>
          取消
        </button>
      </span>
    </div>
  );

  const scope = (() => {
    if (type === 'plague')
      return (
        <>
          {picking ? (
            pickingRow('在地图上点一州…')
          ) : (
            <div className="oc-pick cr-pick iv-pick" data-disaster="city">
              {S ? (
                <span className="oc-pick-name">
                  <b>{S.name || '某城'}</b>
                  <span className="cr-after">{cityAfter(civ, cityId, own, yv, y)}</span>
                </span>
              ) : (
                <span className="oc-pick-empty">{p ? '那年没有国都，换一座' : '这州那年没有住人的城，换一座'}</span>
              )}
              <span className="oc-pick-acts">
                <button className="cp-step" data-act="disaster-city" onClick={pickCity}>
                  换一座
                </button>
              </span>
            </div>
          )}
          <span className="cp-note">照瘟疫的规矩沿路、沿河传开，传到哪推演了才知道。那年已经在闹瘟疫时并进那一场。</span>
        </>
      );
    if (type === 'quake')
      return picking ? (
        pickingRow('在地图上点一处…')
      ) : (
        <div className="oc-pick cr-pick iv-pick" data-disaster="quake">
          {qc >= 0 ? (
            <span className="oc-pick-name">
              <b>{R}一带</b>
              <span className="cr-after">
                {area.length} 州，{populationLabel(toll.pop)}
              </span>
            </span>
          ) : (
            <span className="oc-pick-empty">在地图上点一处</span>
          )}
          <span className="oc-pick-acts">
            <button className="cp-step" data-act="disaster-quake" onClick={pickQuake}>
              在地图上换一处
            </button>
          </span>
        </div>
      );
    return (
      <>
        <div className="cp-dur" role="radiogroup" aria-label="饥荒的范围">
          {(['polity', 'regions'] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={fmode === m}
              className={fmode === m ? 'on' : ''}
              data-act={`disaster-famine-${m}`}
              onClick={() => (clear(), setFmode(m), picking && setPolityPick(null))}
            >
              {m === 'polity' ? '一国' : '几州'}
            </button>
          ))}
        </div>
        {fmode === 'polity' ? (
          picking ? (
            pickingRow('在地图上点一国…')
          ) : (
            <div className="oc-pick cr-pick iv-pick" data-disaster="famine-polity">
              {F ? (
                <span className="oc-pick-name">
                  <i className="cr-dot lg" style={{ background: rgb(F.color) }} />
                  <b>{fName}</b>
                  <span className="cr-after">
                    {area.length} 州，{populationLabel(toll.pop)}
                  </span>
                </span>
              ) : (
                <span className="oc-pick-empty">这州那年不属哪国，换一国</span>
              )}
              <span className="oc-pick-acts">
                <button className="cp-step" data-act="disaster-famine-pick" onClick={pickFaminePolity}>
                  换一国
                </button>
              </span>
            </div>
          )
        ) : (
          <div className={`oc-pick cr-pick iv-pick${picking ? ' picking' : ''}`} data-disaster="famine-regions">
            {regs.length ? (
              <span className="oc-pick-name">
                <b>{regsName}</b>
                <span className="cr-after">{populationLabel(toll.pop)}</span>
              </span>
            ) : (
              <span className="oc-pick-empty">还没选州</span>
            )}
            <span className="oc-pick-acts">
              <button className="cp-step" data-act="disaster-famine-pick" onClick={pickFamineRegions}>
                在地图上点
              </button>
            </span>
          </div>
        )}
        <span className="cp-note">
          {fmode === 'polity' ? '那年这国境内住人的城都遭灾，乡下饿死一片。' : `在地图上点州加进来，再点一下去掉，最多 ${DISASTER_REGIONS_MAX} 州。`}
        </span>
      </>
    );
  })();

  return (
    <div className="cr-page" onKeyDown={onKey}>
      <div className="cp-body cr-form" data-disaster="form">
        {step ? (
          <StepEffectTime phone={phone} />
        ) : (
          <div className="cp-from">
            <span className="cp-k">哪一年</span>
            <YearRow yi={yi} label="天灾的年份" />
            <span className="cp-note">{phone ? '这年之前的历史不变。' : '这年之前的历史不变，之后重新推演。'}</span>
          </div>
        )}
        {phone ? (
          <div className="cp-form">
            <span className="cp-form-title">种类</span>
            <div className="cp-dur" role="radiogroup" aria-label="种类">
              {DISASTER_TYPES.map((t) => (
                <button key={t} role="radio" aria-checked={type === t} className={type === t ? 'on' : ''} data-type={t} onClick={() => chooseType(t)}>
                  {DISASTER_NAMES[t]}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="iv-h">种类</div>
            <div className="cp-cmds iv-kinds" role="radiogroup" aria-label="种类">
              {DISASTER_TYPES.map((t) => (
                <button key={t} role="radio" aria-checked={type === t} className={`cp-cmd${type === t ? ' on' : ''}`} data-type={t} onClick={() => chooseType(t)}>
                  <span className="cp-cmd-main">
                    <span className="cp-cmd-name">{DISASTER_NAMES[t]}</span>
                    <span className="cp-cmd-desc">{KIND_DESC[t]}</span>
                  </span>
                  {type === t && <span className="cr-check">✓</span>}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="cp-form" data-disaster="scope">
          <span className="cp-form-title">{type === 'plague' ? '从哪座城起' : '范围'}</span>
          {scope}
        </div>
        <div className="cp-form" data-disaster="level">
          <span className="cp-form-title">轻重</span>
          <div className="cp-dur" role="radiogroup" aria-label="轻重">
            {LEVELS.map((x) => (
              <button key={x.l} role="radio" aria-checked={level === x.l} className={level === x.l ? 'on' : ''} data-level={x.l} onClick={() => (clear(), setLevel(x.l))}>
                {x.name}
              </button>
            ))}
          </div>
          <span className="cp-note">{disasterLevelNote(level, phone)}</span>
        </div>
        {(msg || why) && <div className="cp-msg">{msg ?? why}</div>}
      </div>
      <div className="cp-foot mk-foot">
        <button className="cp-btn" data-act="disaster-back" onClick={back}>
          返回
        </button>
        <button className="cp-btn primary" data-act="disaster-go" disabled={!!why || picking} onClick={go}>
          {step ? '加入' : '加入待推演'}
        </button>
      </div>
    </div>
  );
}

/** 城后面那一句:"翼门之野，有桑皇朝国都" / "翼门之野，属有桑皇朝" / 部落地带只写州名 */
function cityAfter(civ: Civ, sid: number, own: ArrayLike<number>, yv: number, y: number): string {
  const s = civ.settlements[sid];
  if (!s) return '';
  const R = regionLabel(civ, s.region);
  const P = civ.polities[own[s.region]];
  if (!P) return R;
  return capitalAt(P, yv) === sid ? `${R}，${nameAt(P, y)}国都` : `${R}，属${nameAt(P, y)}`;
}
