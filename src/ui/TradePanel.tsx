/**
 * 商道的面板(和信仰、国家的面板同一套样子,零件见 panelParts.tsx),按时间轴当前那一年:
 *
 *   顶部  紫色块、名字(可改)、"商道，运铁，978 年通"、关闭
 *   按钮  通的那年(时间轴跳到开通那年)/ 设为中心(转到路线正中)/ 改名 / 更多(看产地、看买方、看国都)
 *   概况  运什么(后面一句为什么运:"奥利亚王国境内不产铁")、从哪到哪(产地州 → 买方国都,都能点;"大定王朝产，运往奥利亚王国国都")、
 *         经过(从产地到国都经过的国家,都能点;几州)、现在(通 / 红字"断",从哪年、因为哪一仗;废了、还没通也写)
 *   历年通断  从开通到废(没废 = 到最后一年)的色条:紫 = 通,灰斜纹 = 断;点一段跳到那年
 *   大事  通、断、复通、废:最近 5 条(可点;交兵断的、亡国废的标成战事的红点),"全部 N 件"展开全部
 * 卡片开着时地图上这条亮、别的商道变淡(render/civ/trade.ts 的 TradeFocus)。
 */
import { useMemo, useState } from 'react';
import type { TradeRoute } from '../gen/civ/trade';
import { polityName } from '../gen/civ/growth';
import { regionLabel } from '../gen/civ/display';
import { tradeKey } from '../gen/edits';
import { goodsAt, goodsText, tradeCapital, tradeHistory, tradeStateAt, warPair } from '../gen/civ/tradeText';
import { TRADE_INK } from '../render/civ/trade';
import type { ChronicleEntry } from '../gen/civ/chronicle';
import { pickChronicleEntry, setSelection } from './civView';
import { NameEdit } from './NameEdit';
import { entriesUpTo, ownersOf } from './panelData';
import { Act, Acts, CenterAct, EntryText, Link, MoreAct, PanelHead, Row, SegBar, Stats, SubLine, jumpTo, type DetailProps, type Seg } from './panelParts';
import { evLabel } from './timelineLayout';
import { useEra } from './editsStore';
import { spaced, yearAt, yearShort, yearSpan } from '../gen/era';
import { MenuItem } from './PopMenu';
import { Icon } from './icons';

/** 断着的那几段:灰斜纹 */
const BROKEN_BG = 'repeating-linear-gradient(135deg,#d7d2c8 0 3px,#f2efe9 3px 6px)';

/** 通断的几段:[起, 止),断不断 */
function spansOf(r: TradeRoute, end: number): { from: number; to: number; broken: boolean }[] {
  const out: { from: number; to: number; broken: boolean }[] = [];
  let at = r.events[0].year;
  let broken = false;
  for (const e of r.events.slice(1)) {
    if (e.kind === 'end') break;
    const now = e.kind === 'break';
    if (now === broken) continue;
    if (e.year > at) out.push({ from: at, to: e.year, broken });
    at = e.year;
    broken = now;
  }
  if (end > at) out.push({ from: at, to: end, broken });
  return out;
}

export function TradePanel({ civ, raw, world, id, year, names }: DetailProps) {
  const r = civ.trade!.routes[id];
  const era = useEra();
  const [renaming, setRenaming] = useState(false);
  const [allEvents, setAllEvents] = useState(false);
  const open = r.events[0].year;
  const last = r.events[r.events.length - 1];
  const end = last.kind === 'end' ? last.year : civ.endYear;
  const { state, event } = tradeStateAt(r, year);
  const goods = goodsText(goodsAt(r, year));
  const buyer = civ.polities[r.buyer];
  const y = Math.max(open, Math.min(year, end));
  const buyerName = buyer ? polityName(buyer, y) : '';
  const capId = tradeCapital(civ, r, y);
  const cap = civ.settlements[capId];
  // 这一年用的那版路线;经过的国家按那一年的归属,从产地到国都
  const path = useMemo(() => {
    let v = r.paths[0];
    for (const x of r.paths) if (x.year <= y) v = x;
    return v?.regions ?? [r.from];
  }, [r, y]);
  const own = ownersOf(civ, y);
  const via: number[] = [];
  for (const g of path) {
    const q = own.polity[g] ?? -1;
    if (q >= 0 && !via.includes(q)) via.push(q);
  }
  const srcOwner = own.polity[r.from] ?? -1;
  const events = useMemo(() => tradeHistory(civ, id), [civ, id]);
  const upTo = entriesUpTo(events, year);
  const pol = (p: number) => (civ.polities[p] ? <Link to={{ kind: 'polity', id: p }}>{polityName(civ.polities[p], y)}</Link> : null);
  // 现在:通 / 断(从哪年、哪一仗)/ 废 / 还没通
  const now =
    state === 'broken' ? (
      <>
        <span style={{ color: 'var(--ev-war)', fontWeight: 600 }}>断</span>
        <em className="cp-num-note">
          {event ? yearAt(Math.floor(event.year), era) : ''}
          {event?.war !== undefined && warPair(civ, event.war) ? `${warPair(civ, event.war)}交兵起` : '起'}
        </em>
      </>
    ) : state === 'ended' ? (
      <>
        废<em className="cp-num-note">{event ? `${yearAt(Math.floor(event.year), era)}废` : ''}</em>
      </>
    ) : state === 'before' ? (
      <>
        未通<em className="cp-num-note">{yearAt(Math.floor(open), era)}才通</em>
      </>
    ) : (
      <>
        通<em className="cp-num-note">{event ? `${yearAt(Math.floor(event.year), era)}${event.kind === 'reopen' ? '复通' : '通'}` : ''}</em>
      </>
    );
  // 历年通断的色条
  const total = Math.max(1e-6, end - open);
  const segs: Seg[] = spansOf(r, end).map((s, i, all) => {
    const frac = (s.to - s.from) / total;
    const on = year >= s.from && (year < s.to || (i === all.length - 1 && year >= s.to));
    return {
      name: !s.broken && frac > 0.12 ? '通' : '',
      frac,
      background: s.broken ? BROKEN_BG : TRADE_INK,
      on,
      title: `${s.broken ? '断' : '通'} · ${yearSpan(s.from, s.to, era)}`,
      onClick: () => jumpTo(Math.ceil(s.from)),
    };
  });
  const shown = upTo.slice(-(allEvents ? upTo.length : 5)).reverse();
  // 交兵断的、亡国废的:标成战事的红点
  const warLike = (e: ChronicleEntry) => e.text.includes('交兵') || (e.text.endsWith('废') && e.text.includes('亡,'));

  return (
    <div className="cp" data-trade={id}>
      <PanelHead color={TRADE_INK}>
        <NameEdit
          k={tradeKey(civ, id)}
          kind="trade"
          shown={r.name}
          current={r.name}
          fallback={raw.trade?.routes[id]?.name ?? r.name}
          names={names}
          big
          editing={renaming}
          onEditing={setRenaming}
        />
        <SubLine className="ins-status" parts={['商道', `运${goodsText(goodsAt(r, open))}`, `${yearAt(Math.floor(open), era)}${year >= open ? '' : '才'}通`]} />
      </PanelHead>
      <Acts>
        <Act icon="history" primary act="open-year" title={`跳到${spaced(yearAt(Math.ceil(open), era))}`} onClick={() => jumpTo(Math.ceil(open))}>
          通的那年
        </Act>
        <CenterAct world={world} civ={civ} sel={{ kind: 'trade', id }} year={year} />
        <Act icon="rename" act="rename" onClick={() => setRenaming(true)}>
          改名
        </Act>
        <MoreAct>
          <MenuItem icon={<Icon name="map" size={16} />} act="source" onClick={() => setSelection({ kind: 'region', id: r.from })}>
            看产地
          </MenuItem>
          <MenuItem icon={<Icon name="flag" size={16} />} act="buyer" disabled={!buyer} onClick={() => buyer && setSelection({ kind: 'polity', id: r.buyer })}>
            看买方
          </MenuItem>
          <MenuItem icon={<Icon name="city" size={16} />} act="capital" disabled={!cap} onClick={() => cap && setSelection({ kind: 'settlement', id: capId })}>
            看国都
          </MenuItem>
        </MoreAct>
      </Acts>
      <div className="cp-body">
        <Stats items={[]}>
          <Row k="运什么">
            {goods}
            {buyerName && <em className="cp-num-note">{`${buyerName}境内不产${goods}`}</em>}
          </Row>
          <Row k="从哪到哪">
            <Link to={{ kind: 'region', id: r.from }}>{regionLabel(civ, r.from)}</Link>
            {' → '}
            {cap ? <Link to={{ kind: 'settlement', id: capId }}>{cap.name}</Link> : '—'}
            <em className="cp-num-note">
              {srcOwner >= 0 && civ.polities[srcOwner] ? `${polityName(civ.polities[srcOwner], y)}产` : '部落地带产'}
              {buyerName ? `，运往${buyerName}国都` : ''}
            </em>
          </Row>
          <Row k="经过" className="cp-links">
            {via.length ? via.map((q) => <span key={q}>{pol(q)}</span>) : <span className="cp-none">部落地带</span>}
            <em className="cp-num-note">{path.length} 州</em>
          </Row>
          <Row k="现在">{now}</Row>
        </Stats>
        {segs.length > 0 && <SegBar label="历年通断" segs={segs} years={[Math.floor(open), Math.floor(end)]} className="cp-trade-bar" />}
        <section className="cp-sec cp-events">
          <div className="cp-sec-head cp-events-head">
            <span>大事</span>
            {upTo.length > 5 ? (
              <button className="ins-link cp-more" data-act="all-events" onClick={() => setAllEvents((v) => !v)}>
                {allEvents ? '收起' : `全部 ${upTo.length} 件`}
              </button>
            ) : (
              upTo.length > 0 && <span className="cp-count">{upTo.length} 件</span>
            )}
          </div>
          <div className="cp-group">
            {shown.map((e) => (
              <button key={`${e.kind}:${e.id}`} className="cp-ev" data-ev={warLike(e) ? 'war' : 'era'} title={evLabel(e)} onClick={() => pickChronicleEntry(e)}>
                <span className={`cp-ev-year${era ? ' era' : ''}`}>{yearShort(e.year, era)}</span>
                <span className="cp-ev-text">
                  <EntryText civ={civ} e={e} />
                </span>
              </button>
            ))}
            {!shown.length && <span className="cp-none">尚未开通</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
