/**
 * 人物页「君主」只看一国时的世系图(WorldOverviewPeople.tsx 右上「列表 | 世系图」切过来):一朝一棵家谱树。
 *
 *   左边  朝代一列(手机上换成一排横滑的按钮):一朝一行,名字、年份、几位;时间轴那一年的那一朝标「当前」;点一行换树。下面是图例
 *   右边  标题"景  2377–2794 年，27 位君主；太祖柳渺玄起兵代衍朝开国"(手机上不写开国那句),下面这一朝的树(排法见 gen/civ/lineageInfo.ts):
 *         白底方框 = 即位的君主(左边灰色数字是这一朝第几位、30 像素的圆头像,两行:称呼、在位年份);虚线框 = 没即位的宗室(生卒);
 *         时间轴那一年在位的标「当前」、蓝框,还没即位(宗室:还没出生)的变淡;从人物卡片进来的那位蓝框圈出。
 *         最后一位下面写这一朝怎么结束("2794 年，渊朝起兵代之");连不上开国那一支的远支另起一小棵,上面写"宗室远支"。点一位看他的卡片
 *         作者立的君主(让作者的人物即位):单独一棵,上面写"作者立的君主",头像是作者人物卡上的那张、描一圈他的颜色,点了开作者的人物卡;
 *         紧跟着接他位的那一棵写"继他之位"
 * 看哪一朝:人物卡片进来 = 他那一朝;别的 = 时间轴那一年的那一朝(还没立国 = 第一朝,亡了 = 最后一朝);打开时滚到圈出的那位或「当前」。
 * 树比右边宽时左右滑,长的上下滑(手机上整页上下滑)。
 */
import { Fragment, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import type { Civ, Person } from '../gen/civ/types';
import type { Raster } from '../gen/raster';
import type { World } from '../gen/world';
import type { AuthorCharacter } from '../gen/characters';
import { resolveKey } from '../gen/edits';
import { characterPortrait } from '../gen/portrait';
import { MARK_HEX } from '../render/marks';
import { characterPolity } from './characterInfo';
import { rulerAt } from '../gen/civ/peopleInfo';
import { personName } from '../gen/civ/peopleText';
import { NameFace, PersonFace, PortraitView } from './Portrait';
import { HouseBookButton } from './lifeMenu';
import { dynastyEnd, dynastyNote, dynastyRowAt, dynastyRows, layoutDynasty, lineageKin, lineageTag, reignOrder, secededFrom, treeLabel, type DynastyRow, type LineageTree } from '../gen/civ/lineageInfo';
import { polityName } from '../gen/civ/growth';
import { setPeople } from './overviewStore';
import { selectPerson } from './panelParts';
import { useNarrow } from './device';
import { useEdits, useEra } from './editsStore';
import { yearShort, yearShortAt, yearSpanAt, type Era } from '../gen/era';


/** 方框大小、间距(电脑 / 手机);FONT = 名字的字号(估名字多宽用) */
const BOX = { wide: { W: 172, H: 44, GAP: 18, STEP: 68, FONT: 13.5 }, narrow: { W: 164, H: 42, GAP: 12, STEP: 64, FONT: 13 } };
/** 方框里名字以外占的宽(左边序号、头像连同空隙 36、内边距,多留 1 像素) */
const CHROME = 75;
/** 名字很长(西幻的"多布罗斯拉夫一世")时方框最宽放到这么宽 */
const W_MAX = 224;
/** 树四周留的边 */
const PAD = 4;
/** 最后一位下面那句话占的高 */
const TAIL_H = 30;

type Box = (typeof BOX)['wide'];

let measure: { ctx: CanvasRenderingContext2D | null; family: string } | undefined;
/** 一段粗体字有多宽(按页面的字体量;量不了就按一字一个字号宽估) */
function textWidth(text: string, px: number): number {
  if (!measure) {
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = document.createElement('canvas').getContext('2d');
    } catch {
      ctx = null;
    }
    measure = { ctx, family: getComputedStyle(document.body).fontFamily };
  }
  if (!measure.ctx) return [...text].length * px * 1.05;
  measure.ctx.font = `600 ${px}px ${measure.family}`;
  return measure.ctx.measureText(text).width;
}

/** 名字连同后面的小灰字(lineageTag;字 11 号,前面空 5)有多宽 */
const topWidth = (civ: Civ, p: Person, box: Box, polity: number) => {
  const tag = lineageTag(civ, p, polity);
  return textWidth(personName(civ, p), box.FONT) + (tag ? textWidth(tag, 11) + 5 : 0);
};

/**
 * 方框里名字以外要多宽:名字那一行;第二行比它宽时按第二行算 —— 据地自立的儿子第二行写他立的国和在位年份;
 * 有"妻大澜"小标的(前面空 10、小方块连空隙 11)接在年份后面,再给「当前」挪下来时留出地方
 */
const nameWidth = (civ: Civ, p: Person, box: Box, polity: number) => {
  const w = topWidth(civ, p, box, polity);
  const sec = secededFrom(civ, p, polity);
  const kin = lineageKin(civ, p);
  if (!sec && !kin) return w;
  const from = sec ? (p.from ?? p.born) : p.born;
  const realm = sec ? `${polityName(civ.polities[p.polity], from)} ` : '';
  const line = textWidth(`${realm}${Math.floor(from)}–${p.until !== undefined || p.died !== undefined ? '0000' : ''}`, box.FONT - 1.5);
  return Math.max(w, line + (kin ? 21 + textWidth(kin.text, 11) + badgeWidth() : 0));
};
/** 「当前」小标签连同前面的空隙占多宽(字 11 号,左右内边距各 5,空隙 5) */
const badgeWidth = () => textWidth('当前', 11) + 15;

const yearSpan = (a: number, b: number | undefined, era: Era | undefined) => `${yearShort(a, era)}–${b !== undefined ? yearShort(b, era) : ''}`;
/** 一朝的起止,窄处:"2377–2794 年""2377 年起";纪年 "前 820–前 811 年""前 3–元年""前 820 年起" */
const dynSpan = (r: DynastyRow, era: Era | undefined) => (r.to !== undefined ? `${yearShort(r.from, era)}–${yearShortAt(r.to, era)}` : `${yearShortAt(r.from, era)}起`);

function inRow(row: DynastyRow, year: number) {
  return row.from <= year && (row.to === undefined || year < row.to);
}

/** 世界和底图(作者人物的头像按他的国家挑服饰:人物卡上没填国家时看出生地归哪国,要用到) */
type Place = { world: World; raster: Raster } | null;

/**
 * 作者立的君主的头像:和作者人物卡上的同一张(他的国家定服饰,年龄跟时间轴);底色和别的方框一样按这国的颜色,外面描一圈他的颜色(CSS)。
 * 女的(头像部件还没有)写名字的最后一个字
 */
function AuthorFace({ civ, x, c, year, place }: { civ: Civ; x: Person; c: AuthorCharacter; year: number; place: Place }) {
  const pol = useMemo(() => {
    if (place) return characterPolity(civ, place.world, place.raster, c);
    const k = c.polity ? resolveKey(civ, c.polity) : null;
    return k?.kind === 'polity' ? k.id : x.polity;
  }, [civ, c, x.polity, place]);
  const age = Math.floor(Math.min(Math.max(year, x.from ?? c.born), c.died ?? Infinity) - c.born);
  const p = useMemo(() => (c.female ? null : characterPortrait(civ, c, pol >= 0 ? pol : x.polity, c.born + age)), [civ, c, pol, x.polity, age]);
  const color = `rgb(${civ.polities[x.polity].color.join(',')})`;
  if (c.female) return <NameFace name={c.name} size="mini" color={color} />;
  if (!p) return null;
  return <PortraitView p={p} size="mini" color={color} />;
}

/** 一棵树:方框绝对定位,连线画在底下的 svg 里;tail = 最后一位下面那句话(这一棵里有最后一位才给) */
function Tree({
  civ,
  row,
  tree,
  box,
  year,
  cur,
  focus,
  tail,
  place,
}: {
  civ: Civ;
  row: DynastyRow;
  tree: LineageTree;
  box: Box;
  year: number;
  cur: Person | null;
  focus: number | null;
  tail: string;
  place: Place;
}) {
  const { W, H, GAP, STEP } = box;
  const era = useEra();
  const chars = useEdits().characters;
  const unit = W + GAP;
  const xs = tree.nodes.map((n) => n.x);
  const minX = Math.min(...xs);
  const maxD = Math.max(...tree.nodes.map((n) => n.depth));
  const cx = (x: number) => (x - minX) * unit + W / 2 + PAD;
  const top = (d: number) => d * STEP + PAD;
  const width = (Math.max(...xs) - minX) * unit + W + PAD * 2;
  const height = maxD * STEP + H + PAD * 2 + (tail ? TAIL_H : 0);
  const at = new Map(tree.nodes.map((n) => [n.p, n]));
  const future = (p: Person) => (p.role === 'ruler' ? (p.from ?? p.born) > year : p.born > year);
  const last = tail ? tree.nodes.filter((n) => n.p.role === 'ruler').sort((a, b) => (b.p.from ?? 0) - (a.p.from ?? 0))[0] : undefined;
  const polity = row.rulers[0]?.polity ?? -1;
  // 连线;养子那一截(横线上通到他的那段、落到他的竖线)是虚线:先画虚线,亲生的实线压在上面
  const lines: { d: string; fut: boolean; dash?: boolean }[] = [];
  for (const n of tree.nodes) {
    const ks = tree.nodes.filter((k) => k.p.parent === n.p.id && at.has(k.p));
    if (!ks.length) continue;
    const y0 = top(n.depth) + H;
    const ym = y0 + (STEP - H) / 2;
    const fx = cx(n.x);
    const own = ks.filter((k) => !k.p.adopted);
    const allFut = ks.every((k) => future(k.p));
    lines.push({ d: `M${fx} ${y0}V${ym}`, fut: allFut, dash: !own.length });
    for (const k of ks) if (k.p.adopted) lines.push({ d: `M${fx} ${ym}H${cx(k.x)}`, fut: future(k.p), dash: true });
    if (own.length) {
      const kx = own.map((k) => cx(k.x));
      lines.push({ d: `M${Math.min(...kx, fx)} ${ym}H${Math.max(...kx, fx)}`, fut: own.every((k) => future(k.p)) });
    }
    for (const k of ks) lines.push({ d: `M${cx(k.x)} ${ym}V${top(k.depth)}`, fut: future(k.p), dash: !!k.p.adopted });
  }
  lines.sort((a, b) => Number(!!b.dash) - Number(!!a.dash));
  return (
    <div className="lg-tree" style={{ width, height }}>
      <svg width={width} height={height} aria-hidden="true">
        {lines.map((l, i) => (
          <path key={i} d={l.d} className={[l.fut && 'fut', l.dash && 'dash'].filter(Boolean).join(' ') || undefined} />
        ))}
      </svg>
      {tree.nodes.map(({ p, x, depth }) => {
        const k = reignOrder(row, p);
        // 据地自立做了别国之君的儿子:实线框、不带序号,第二行写他立的国
        const sec = secededFrom(civ, p, polity);
        const on = k > 0 && p === cur;
        const cls = `lg-node${k || sec ? '' : ' lg-prince'}${on ? ' on' : ''}${future(p) ? ' fut' : ''}${p.id === focus ? ' focus' : ''}`;
        const name = personName(civ, p);
        const tag = lineageTag(civ, p, polity);
        const span = k || sec ? yearSpan(p.from ?? p.born, p.until, era) : yearSpan(p.born, p.died, era);
        const realm = sec ? polityName(civ.polities[p.polity], p.from ?? p.born) : '';
        const kin = lineageKin(civ, p);
        const kinP = kin ? civ.polities[kin.polity] : undefined;
        // 名字加「当前」放不下:「当前」挪到年份后面
        const low = on && CHROME + topWidth(civ, p, box, polity) + badgeWidth() > W;
        // 作者立的君主:头像换成作者人物卡上的那张(人物卡删掉了照旧)
        const ac = p.author !== undefined ? chars?.find((c) => c.id === p.author) : undefined;
        return (
          <button
            key={p.id}
            className={ac ? `${cls} cr-author` : cls}
            style={{ left: cx(x) - W / 2, top: top(depth), width: W, height: H, ...(ac ? ({ '--ring': MARK_HEX[ac.color] } as CSSProperties) : {}) }}
            data-person={p.id}
            title={`${name}，${sec ? `自立为${realm}之君，` : ''}${k || sec ? (era && p.until !== undefined ? `${yearSpanAt(p.from ?? p.born, p.until, era)}在位` : `${span} 年在位`) : `未即位${tag ? `（${tag}）` : ''}，${span}`}`}
            onClick={() => selectPerson(p.id)}
          >
            {(k > 0 || sec) && <span className="lg-n">{k || ''}</span>}
            {ac ? <AuthorFace civ={civ} x={p} c={ac} year={year} place={place} /> : <PersonFace civ={civ} x={p} year={year} size="mini" />}
            <span className="lg-t">
              <b>
                <span className="lg-nm">{name}</span>
                {tag && <span className="lg-tag">{tag}</span>}
                {on && !low && <em className="cp-badge">当前</em>}
              </b>
              <em>
                {realm && <span className="lg-realm">{realm}</span>}
                {span}
                {low && <em className="cp-badge">当前</em>}
                {kin && (
                  <span className="lg-kin" data-kin={kin.polity}>
                    <i style={kinP ? { background: `rgb(${kinP.color.join(',')})` } : undefined} />
                    {kin.text}
                  </span>
                )}
              </em>
            </span>
          </button>
        );
      })}
      {last && (
        <div className="lg-tail" style={{ left: cx(last.x) - 120, top: top(last.depth) + H + 8 }}>
          {tail}
        </div>
      )}
    </div>
  );
}

export function PeopleLineage({ civ, polity, dynasty, focus, year, place = null }: { civ: Civ; polity: number; dynasty: number | null; focus: number | null; year: number; place?: Place }) {
  const narrow = useNarrow();
  const era = useEra();
  const box0 = narrow ? BOX.narrow : BOX.wide;
  const rows = useMemo(() => dynastyRows(civ, polity), [civ, polity]);
  const byYear = dynastyRowAt(rows, year);
  const picked = dynasty !== null ? rows.findIndex((r) => r.index === dynasty) : -1;
  const ri = picked >= 0 ? picked : byYear;
  const row = rows[ri];
  const trees = useMemo(() => (row ? layoutDynasty(civ, row) : []), [civ, row]);
  // 这一朝最长的名字放不下就把方框放宽些(东方的名字都放得下,只有西幻的长名字会放宽)
  const box = useMemo(() => {
    const longest = Math.max(0, ...trees.flatMap((t) => t.nodes.map((n) => nameWidth(civ, n.p, box0, polity))));
    return { ...box0, W: Math.min(W_MAX, Math.max(box0.W, Math.ceil(CHROME + longest))) };
  }, [civ, trees, box0, polity]);
  const tail = useMemo(() => dynastyEnd(civ, rows, ri, era), [civ, rows, ri, era]);
  // 这一朝有掌过实权、被架空过的("掌权""虚位"),有跨国联姻的("妻大澜"):图例多一行讲它(拿这一朝第一个出现的国名举例)
  const legendHeld = useMemo(() => trees.some((t) => t.nodes.some((n) => /掌权|虚位/.test(lineageTag(civ, n.p, polity)))), [civ, trees, polity]);
  const legendKin = useMemo(() => {
    for (const t of trees) for (const n of t.nodes) {
      const k = lineageKin(civ, n.p);
      if (k) return k.text.slice(1);
    }
    return '';
  }, [civ, trees]);
  // 最后一位在哪一棵(结尾那句写在他下面)
  const lastTree = useMemo(() => {
    const lastRuler = row?.rulers[row.rulers.length - 1];
    return trees.findIndex((t) => t.nodes.some((n) => n.p === lastRuler));
  }, [trees, row]);
  const cur = rulerAt(civ, polity, year);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);

  // 换了国家、朝代、圈出的人:滚到圈出的那位(没有 = 「当前」;都没有 = 树的最上面);从最上面就看得到的不滚
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const el = sc.querySelector<HTMLElement>('.lg-node.focus') ?? sc.querySelector<HTMLElement>('.lg-node.on');
    // 手机上整页上下滑(朝代按钮、标题跟着滑走),树只左右滑
    const v = narrow ? (sc.closest('.chron-list') as HTMLElement | null) : sc;
    if (!el) {
      sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2;
      if (v) v.scrollTop = 0;
    } else {
      const tree = el.offsetParent as HTMLElement;
      sc.scrollLeft = Math.max(0, tree.offsetLeft + el.offsetLeft + el.offsetWidth / 2 - sc.clientWidth / 2);
      if (v) {
        // 在 v 里的位置(手机:树在整页里还要加上朝代按钮、标题的高)
        const y = tree.offsetTop + el.offsetTop + (v === sc ? 0 : sc.offsetTop);
        const fits = y + el.offsetHeight + 24 <= v.clientHeight;
        v.scrollTop = fits ? 0 : Math.max(0, y - v.clientHeight * 0.4);
      }
    }
    const chips = chipsRef.current;
    const on = chips?.querySelector<HTMLElement>('.lg-chip.on');
    if (chips && on) chips.scrollLeft = Math.max(0, on.offsetLeft - chips.offsetLeft - 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [civ, polity, ri, focus, narrow]);

  if (!row) return null;
  const pick = (r: DynastyRow) => setPeople({ dynasty: r.index, focus: null });
  const dyns = narrow ? (
    <div className="lg-chips" ref={chipsRef}>
      {rows.map((r, i) => (
        <button key={r.index} className={`lg-chip${i === ri ? ' on' : ''}`} data-dynasty={r.index} onClick={() => pick(r)}>
          <b>
            {r.name}
            {inRow(r, year) && <em className="cp-badge">当前</em>}
          </b>
          <span>
            {r.to !== undefined ? `${yearShort(r.from, era)}–${yearShort(r.to, era)}` : `${yearShortAt(r.from, era)}起`}，{r.rulers.length} 位
          </span>
        </button>
      ))}
    </div>
  ) : (
    <nav className="lg-dyns" aria-label="朝代">
      <h4>朝代</h4>
      {rows.map((r, i) => (
        <button key={r.index} className={`lg-dyn${i === ri ? ' on' : ''}`} data-dynasty={r.index} onClick={() => pick(r)}>
          <b>
            {r.name}
            {inRow(r, year) && <em className="cp-badge">当前</em>}
          </b>
          <small>{r.rulers.length} 位</small>
          <span>{dynSpan(r, era)}</span>
        </button>
      ))}
      <div className="lg-legend">
        <div>
          <i className="lg-key" />
          即位的君主，数字是这一朝第几位
        </div>
        <div>
          <i className="lg-key prince" />
          没即位的宗室
        </div>
        <div>
          <svg className="lg-key-line" width="18" height="12" aria-hidden="true">
            <path d="M1 6H17" />
          </svg>
          养子（虚线连着）
        </div>
        <div>名字后面的灰字是结局：争储被杀、战死、自立（下一行写他立的国）</div>
        {legendHeld && <div data-legend="held">灰字「掌权」：他掌过实权（一直没即位，或即位以前）；「虚位」：君主在位时被架空过。点开卡片看是谁、哪几年</div>}
        {legendKin && <div data-legend="kin">第二行「妻{legendKin}」「母{legendKin}」：妻子、母亲是别国宗室女（只写跨国联姻），小方块是那一国的颜色</div>}
        <div>点一位看他的卡片</div>
      </div>
    </nav>
  );
  return (
    <div className={`lg-wrap${narrow ? ' lg-phone' : ''}`} data-lineage={polity}>
      {dyns}
      <div className="lg-main">
        <div className="lg-head">
          <b>{row.name}</b>
          <span>{narrow ? dynastyNote(civ, rows, ri, era).split('；')[0] : dynastyNote(civ, rows, ri, era)}</span>
          <HouseBookButton civ={civ} polity={polity} dynasty={row.index} />
        </div>
        <div className="lg-scroll" ref={scrollRef}>
          {trees.map((t, i) => (
            <Fragment key={i}>
              {t.distant && <div className="lg-distant">{treeLabel(row, trees, i)}</div>}
              <Tree civ={civ} row={row} tree={t} box={box} year={year} cur={cur} focus={focus} tail={i === lastTree ? tail : ''} place={place} />
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
