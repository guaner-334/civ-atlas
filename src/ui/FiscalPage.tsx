/**
 * 国家的钱粮:概况里「钱粮」一行(FiscalRow)和点进来的钱粮页(FiscalPage;卡片换页,和方针页同一种做法,只看不改)。
 * 数从推演记下的账本来(fiscalInfo.ts);那一年以前最近一行的账,档位和在打几场仗是那一年的。
 *
 *   「钱粮」一行  近 16 次(每 20 年一次)国库攒到几成的小柱(不到五成黄,见底红一道)+ 国库怎么样 + 一年岁入;
 *                 国用不足时写红字「国用不足」+ 每年亏多少。点了换成钱粮页
 *   钱粮页        国库块:第几年、国库多少万石、档位标签、一句话(攒到几成 / 每年结余或亏多少;国用不足写后果)、
 *                 历年国库攒到几成的曲线(红点 = 记过国用不足的年份,蓝线 = 时间轴这一年,以后的淡)
 *                 进项:田赋、工商、市税(带比例条)、各地截留(交上来几成)、收贡(有才写);小计写实收
 *                 开销:养官、军费(和谁交战 / 在打几场仗 / 没在打仗)、纳贡(有才写);小计写岁出
 *                 截留在哪:按管辖四档(颜色和管辖填色一样)各几州、截留多少;「在地图上看」把填色切到管辖
 *                 底部「返回」回到信息页
 */
import { useMemo } from 'react';
import type { Civ } from '../gen/civ/types';
import { polityName } from '../gen/civ/growth';
import { ownersAt } from '../gen/civ/timeline';
import { CONTROL_TIERS } from '../gen/civ/control';
import { yearAt, yearFull, yearShort } from '../gen/era';
import { CONTROL_COLORS, controlTiersAt } from '../render/civ/control';
import { useEra } from './editsStore';
import { openInfoPage, setSheet } from './panelStore';
import { setCivShow } from './civView';
import { fillShow } from './mapLayers';
import { Row, rgb } from './panelParts';
import { MOOD_NAMES, chengText, fiscalAlarms, fiscalHistory, fiscalView, wan } from './fiscalInfo';
import './fiscal.css';

/** 概况「钱粮」一行里的小柱有几根 */
const ROW_BARS = 16;

function SparkBars({ civ, id, year, n }: { civ: Civ; id: number; year: number; n: number }) {
  const hist = useMemo(() => fiscalHistory(civ, id), [civ, id]);
  const bars = hist.filter((h) => h.year <= year).slice(-n);
  return (
    <span className="cp-spark fs-spark" aria-hidden="true">
      {bars.map((b, i) => (
        <i key={i} className={b.fill < 0.01 ? 'zero' : b.fill < 0.5 ? 'low' : undefined} style={{ height: `${b.fill < 0.01 ? 2 : Math.max(2, Math.round(b.fill * 16))}px` }} />
      ))}
    </span>
  );
}

/** 概况里「钱粮」一行(没有账本的旧历史不显示) */
export function FiscalRow({ civ, id, year }: { civ: Civ; id: number; year: number }) {
  const v = fiscalView(civ, id, year);
  if (!v) return null;
  const open = () => {
    openInfoPage('fiscal');
    setSheet('full');
  };
  const bad = v.mood === 3;
  return (
    <Row k="钱粮" className="cp-terr fs-row">
      <SparkBars civ={civ} id={id} year={year} n={ROW_BARS} />
      <button className={`ins-link fs-open${bad ? ' bad' : ''}`} data-act="fiscal" onClick={open} title="看这一国的钱粮">
        {bad ? '国用不足' : `国库${MOOD_NAMES[v.mood]}`}
      </button>
      <em className="cp-num-note">{bad ? `每年亏 ${wan(-v.net)} 万石` : `岁入 ${wan(v.income)} 万石`}</em>
    </Row>
  );
}

/** 一行:名目(带小字)、比例条(可选)、数 */
function Line({ k, note, n, bar, minus, dot }: { k: string; note?: string; n: number; bar?: number; minus?: boolean; dot?: string }) {
  return (
    <div className="fs-li">
      {dot && <i className="fs-dot" style={{ background: dot }} />}
      <span className="fs-k">
        {k}
        {note && <small>{note}</small>}
      </span>
      {bar !== undefined && (
        <span className="fs-bar">
          <i style={{ width: `${Math.round(bar * 100)}%` }} />
        </span>
      )}
      <span className={`fs-n${minus ? ' minus' : ''}`}>
        {minus && wan(n) > 0 ? '−' : ''}
        {wan(n)}
        <small>万石</small>
      </span>
    </div>
  );
}

/** 历年国库攒到几成:面积图 + 国用不足的红点 + 这一年的蓝线 */
function History({ civ, id, year }: { civ: Civ; id: number; year: number }) {
  const era = useEra();
  const p = civ.polities[id];
  const hist = useMemo(() => fiscalHistory(civ, id), [civ, id]);
  const alarms = useMemo(() => fiscalAlarms(civ, id), [civ, id]);
  const from = p.founded;
  const to = Math.max(from + 1, p.ended ?? civ.endYear);
  const x = (y: number) => ((y - from) / (to - from)) * 1000;
  const H = 30;
  const area = (pts: typeof hist) =>
    pts.length ? `M${x(pts[0].year)},${H} ` + pts.map((h) => `L${x(h.year).toFixed(1)},${(H - h.fill * (H - 2)).toFixed(1)}`).join(' ') + ` L${x(pts[pts.length - 1].year)},${H} Z` : '';
  const past = hist.filter((h) => h.year <= year);
  const later = hist.filter((h) => h.year >= (past.length ? past[past.length - 1].year : -Infinity));
  return (
    <div className="fs-hist">
      <div className="fs-chart">
        <svg viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {later.length > 1 && <path d={area(later)} className="fs-later" />}
          {past.length > 0 && <path d={area(past)} className="fs-past" vectorEffect="non-scaling-stroke" />}
        </svg>
        <i className="fs-now" style={{ left: `${x(Math.min(to, Math.max(from, year))) / 10}%` }} />
        {alarms
          .filter((y) => y <= year)
          .map((y, i) => (
            <i key={i} className="fs-alarm" style={{ left: `${x(y) / 10}%` }} title={`${yearAt(y, era)}国用不足`} />
          ))}
      </div>
      <div className="fs-axis">
        <span>{yearAt(from, era)}立国</span>
        <span>
          历年国库攒到几成 <i className="fs-alarm-key" /> 国用不足
        </span>
        <span>{yearShort(to, era)}</span>
      </div>
    </div>
  );
}

export function FiscalPage({ civ, id, year }: { civ: Civ; id: number; year: number }) {
  const era = useEra();
  const v = fiscalView(civ, id, year);
  // 截留在哪:这一年各档几州(管辖快照)
  const counts = useMemo(() => {
    const own = ownersAt(civ, year).polity;
    const tiers = controlTiersAt(civ, year);
    const c = [0, 0, 0, 0];
    for (let r = 0; r < own.length; r++) if (own[r] === id && tiers[r] >= 0) c[tiers[r]]++;
    return c;
  }, [civ, id, year]);
  const back = (
    <div className="cp-foot">
      <button className="cp-btn" data-act="fiscal-back" onClick={() => openInfoPage(null)}>
        返回
      </button>
    </div>
  );
  if (!v) {
    return (
      <div className="cr-page">
        <div className="cp-body">
          <div className="cp-msg fs-none">这一年还没有账(还没立国,或是旧版本推演的历史)。</div>
        </div>
        {back}
      </div>
    );
  }
  const bad = v.mood === 3;
  const say = bad
    ? `国库空了,每年还亏 ${wan(-v.net)} 万石:国内更不安稳、少开战、仗容易罢兵。`
    : `${v.fill >= 0.995 ? '攒满了' : `攒到${chengText(v.fill)}`}(最多攒一年半的应缴)。每年${v.net >= 0 ? `结余 ${wan(v.net)}` : `亏 ${wan(-v.net)}`} 万石。`;
  const foe = v.foes[0] !== undefined ? civ.polities[v.foes[0]] : undefined;
  const armyNote = v.wars <= 0 ? '没在打仗' : v.foes.length === 1 && foe ? `和${polityName(foe, year)}交战` : `在打 ${Math.max(v.wars, v.foes.length)} 场仗`;
  const owed = Math.max(1e-9, v.owed);
  return (
    <div className="cr-page fs-page" data-fiscal={id}>
      <div className="cp-body">
        <div className="cp-from fs-top">
          <div className="fs-lbl">
            <span>{yearFull(year, era)}</span>
            <span>每年的数,单位万石</span>
          </div>
          <div className="fs-big">
            <span className="fs-u">国库</span>
            <b>{wan(v.treasury)}</b>
            <span className="fs-u">万石</span>
            <span className={`fs-chip${bad ? ' bad' : v.mood === 0 ? ' ok' : ''}`} data-mood={v.mood}>
              {MOOD_NAMES[v.mood]}
            </span>
          </div>
          <div className={`fs-say${bad ? ' bad' : ''}`}>{say}</div>
          <History civ={civ} id={id} year={year} />
        </div>
        <section className="cp-sec">
          <div className="cp-sec-head">
            <span>进项</span>
            <span className="fs-sum">
              实收 <b>{wan(v.got)}</b> 万石
            </span>
          </div>
          <div className="cp-group fs-group">
            <Line k="田赋" note="乡村" n={v.land} bar={v.land / owed} />
            <Line k="工商" note="城里" n={v.craft} bar={v.craft / owed} />
            <Line k="市税" note="商路港口" n={v.trade} bar={v.trade / owed} />
            <Line k="各地截留" note={`交上来${chengText(v.got / owed)}`} n={v.kept} minus />
            {wan(v.tribIn) > 0 && <Line k="收贡" note="藩属交来" n={v.tribIn} />}
          </div>
        </section>
        <section className="cp-sec">
          <div className="cp-sec-head">
            <span>开销</span>
            <span className="fs-sum">
              岁出 <b>{wan(v.spent)}</b> 万石
            </span>
          </div>
          <div className="cp-group fs-group">
            <Line k="养官" n={v.office} />
            <Line k="军费" note={armyNote} n={v.army} />
            {wan(v.tribOut) > 0 && <Line k="纳贡" note="交给宗主" n={v.tribOut} />}
          </div>
        </section>
        <section className="cp-sec">
          <div className="cp-sec-head">
            <span>截留在哪</span>
            <button className="ins-link fs-map" data-act="fiscal-map" onClick={() => setCivShow(fillShow('control'))}>
              在地图上看
            </button>
          </div>
          <div className="cp-group fs-group">
            {/* 截留多的在上 */}
            {CONTROL_TIERS.map((t, i) => ({ t, i }))
              .filter(({ i }) => counts[i] > 0 || v.keptBy[i] > 0.5)
              .sort((a, b) => v.keptBy[b.i] - v.keptBy[a.i])
              .map(({ t, i }) => (
                <Line key={t} k={t} note={i === 3 ? `${counts[i]} 州,一文不交` : `${counts[i]} 州`} n={v.keptBy[i]} dot={rgb(CONTROL_COLORS[i] as [number, number, number])} />
              ))}
          </div>
        </section>
      </div>
      {back}
    </div>
  );
}
