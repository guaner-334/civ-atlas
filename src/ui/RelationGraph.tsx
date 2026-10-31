/**
 * 人物关系图(人物卡、作者人物卡「更多 → 关系图」打开):以一个人为中心,按血亲 / 姻亲 / 君臣 / 对手 / 作者的人物分簇,点谁谁居中。
 * 数据见 relationInfo.ts,摆法见 relationLayout.ts,开没开、路径见 relationStore.ts。
 *
 * 电脑  右边铺开一块(盖住地图和时间轴),左边的卡片留着、跟着中心换人(点卡片里别的人名,图也换他居中;点国家、城收起图)。
 *       上面一条:「关系图」、‹ ›、路径(前面的名字能点)、多看一层、在地图上看(收起、地图飞到他的国家)、×。
 *       每个人:圆头像(底色是他国家的颜色)、名字、和中心那位的关系(别国的人灰字写国名,有冲突的红字);没即位的宗室头像外一圈虚线,
 *       作者的人物描一圈他的颜色。鼠标停在人上:那条线变蓝加粗,旁边小卡写是什么关系、「只看他的人物卡」(左边卡片换成他,中心不换)。
 *       点一个人约 0.4 秒换过去:两张图都有的人滑到新位置,只在旧图的淡出、新图的淡入(系统设了"减少动态效果"直接换)。
 *       放不下的最后一格"还有 N 位",点开这一簇的全部名单。左下图例,右下一句提示。
 *       收起后地图左上留「回到关系图」(RelationBack;换了别的卡片就不显示)。
 * 手机  铺满整屏:上面家谱,下面一簇一条、左右滑;底下露一条中心那位的人物卡(点了收起图、看卡片)。
 *       点一个人从底下弹出同样的说明,两个按钮:以他为中心 / 看人物卡。关系少时家谱下面一个「多看一层」。
 * 一位关系都没有:只有他自己,下面一句原因,一个按钮"加一个和他有关的作者人物"(同「更多」里那一项)。
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Civ } from '../gen/civ/types';
import type { Raster } from '../gen/raster';
import type { World } from '../gen/world';
import type { AuthorCharacter } from '../gen/characters';
import { personKey, resolvePersonKey } from '../gen/characters';
import { personName } from '../gen/civ/story/peopleText';
import { heOrShe } from '../gen/civ/story/gender';
import { characterPortrait, personPortrait } from '../gen/portrait';
import { MARK_HEX } from '../render/marks';
import { NameFace, PortraitView } from './Portrait';
import { Icon } from './icons';
import { getCivTime, getSelection, setSelection, useSelection, type MapSelection } from './civView';
import { useEdits } from './editsStore';
import { characterPolity } from './characterInfo';
import { newCharacterDraft } from './characterStore';
import { requestFly, setSheet } from './panelStore';
import { DEEP_BELOW, relationGraph, warmRelations, type RelCenter, type RelNode, type RelRef } from './relationInfo';
import { CARD_H, DESK_MIN_W, PHONE_CARD_H, deskLayout, stackLayout, type EdgeKind, type LMore, type LNode, type Layout, type StackLayout } from './relationLayout';
import {
  backRelation,
  closeRelation,
  fwdRelation,
  getRelation,
  goRelation,
  jumpRelation,
  peekRelation,
  relationCenter,
  relStep,
  reopenRelation,
  setRelationDeep,
  useRelation,
  type RelStep,
} from './relationStore';
import './relation.css';

// ---------------------------------------------------------------------------
// 人 ↔ 选中

/** 路径上的一步现在是谁(重推以后按稳定键找回;找不到 = null) */
function resolveStep(civ: Civ, chars: readonly AuthorCharacter[] | undefined, s: RelStep): RelRef | null {
  if (s.ref.kind === 'character') return chars?.some((c) => c.id === s.ref.id) ? s.ref : null;
  const id = s.key ? resolvePersonKey(civ, s.key) : civ.people?.[s.ref.id] ? s.ref.id : -1;
  return id >= 0 && civ.people?.[id] ? { kind: 'person', id } : null;
}

/** 左边卡片是不是这个人(作者立的君主:卡片开的是作者的人物卡,也算) */
function sameAsSel(civ: Civ, ref: RelRef, sel: MapSelection | null): boolean {
  if (!sel) return false;
  if (sel.kind === ref.kind && sel.id === ref.id) return true;
  return ref.kind === 'person' && sel.kind === 'character' && civ.people?.[ref.id]?.author === sel.id;
}

/** 系统设了"减少动态效果" */
function reduceMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------------------------------------------------------------------------
// 量字(中心卡片多宽,线从卡片侧边连出去)

let measureCtx: CanvasRenderingContext2D | null | undefined;
function textW(text: string, font: string): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement('canvas').getContext('2d');
    } catch {
      measureCtx = null;
    }
  }
  if (!measureCtx) return [...text].length * Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 13);
  measureCtx.font = `${font} ${getComputedStyle(document.body).fontFamily}`;
  return measureCtx.measureText(text).width;
}

/** 中心卡片的宽:头像 + 名字 / 身份两行里宽的那行 + 内边距(和 relation.css 的 .rg-center 一致) */
function cardWidth(c: RelCenter, phone: boolean): number {
  if (phone) return 8 + 56 + 10 + Math.max(textW(c.name, '600 17px'), textW(c.role, '12px')) + 12;
  return 10 + 72 + 12 + Math.max(textW(c.name, '600 19px'), textW(c.role, '12.5px')) + 16;
}

// ---------------------------------------------------------------------------
// 头像

/** 关系图里的头像都按一个固定的岁数(上台那几年)画,不跟时间轴变 */
function useFace(civ: Civ, chars: readonly AuthorCharacter[] | undefined, ref: RelRef, polity: number) {
  return useMemo(() => {
    if (ref.kind === 'person') {
      const x = civ.people?.[ref.id];
      const pol = x ? civ.polities[x.polity] : undefined;
      if (!x || !pol) return null;
      const from = x.from ?? x.commands?.[0]?.from ?? x.born + 20;
      const age = Math.floor(Math.min(Math.max(from + 5, x.born + 18), x.died ?? Infinity) - x.born);
      const p = personPortrait(civ, x.id, x.born + age);
      const color = `rgb(${pol.color.join(',')})`;
      // 女性的头像部件还没画:国家色上写名字后两个字(和人物卡同一种)
      return p ? { p, color } : x.female && x.name ? { p: null, name: x.name, color } : null;
    }
    const c = chars?.find((q) => q.id === ref.id);
    if (!c) return null;
    // 女的作者人物(头像部件还没有):她的颜色上写名字(和作者人物卡同一种)
    if (c.female) return { p: null, name: c.name, color: MARK_HEX[c.color] };
    const p = characterPortrait(civ, c, polity, Math.min(c.born + 30, c.died ?? Infinity));
    const pol = polity >= 0 ? civ.polities[polity] : undefined;
    return p ? { p, name: '', color: pol ? `rgb(${pol.color.join(',')})` : MARK_HEX[c.color] } : null;
  }, [civ, chars, ref.kind, ref.id, polity]);
}

function Face({ civ, chars, n, size }: { civ: Civ; chars: readonly AuthorCharacter[] | undefined; n: RelNode; size: number }) {
  const f = useFace(civ, chars, n.ref, n.polity);
  return (
    <span className="rg-av" style={{ width: size, height: size }}>
      {f && (f.p ? <PortraitView p={f.p} size="mini" color={f.color} /> : <NameFace name={f.name} size="mini" color={f.color} chars={2} px={Math.round(size * 0.31)} />)}
    </span>
  );
}

function CenterFace({ civ, chars, c }: { civ: Civ; chars: readonly AuthorCharacter[] | undefined; c: RelCenter }) {
  const f = useFace(civ, chars, c.ref, c.polity);
  return <span className="rg-cav">{f && (f.p ? <PortraitView p={f.p} size="card" color={f.color} still /> : <NameFace name={f.name} size="card" color={f.color} px={23} />)}</span>;
}

// ---------------------------------------------------------------------------
// 线

const DASH: Partial<Record<EdgeKind, string>> = { inlaw: '6 5', friend: '1.5 4', other: '1.5 4', story: '1.5 4', author: '1.5 4.5' };

function Edge({ d, kind, color }: { d: string; kind: EdgeKind; color?: string | null }) {
  return <path className={`rg-e rg-e-${kind}`} d={d} strokeDasharray={DASH[kind]} style={color ? { stroke: color } : undefined} />;
}

/** 图例里的一小段线 */
function Swatch({ kind, w = 26 }: { kind: EdgeKind; w?: number }) {
  return (
    <svg className="rg-sw" width={w} height={8} viewBox={`0 0 ${w} 8`} aria-hidden="true">
      <path className={`rg-e rg-e-${kind}`} d={`M1 4H${w - 1}`} strokeDasharray={DASH[kind]} />
    </svg>
  );
}

const DeepIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="2.3" fill="currentColor" />
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.2 2" />
  </svg>
);

// ---------------------------------------------------------------------------
// 一个人、"还有 N 位"、中心卡片

function NodeView({
  civ,
  chars,
  l,
  hot,
  cls,
  out,
  onEnter,
  onLeave,
  onPick,
}: {
  civ: Civ;
  chars: readonly AuthorCharacter[] | undefined;
  l: LNode;
  hot?: boolean;
  /** 过渡:淡入(' rg-in') */
  cls?: string;
  /** 过渡:旧图里要淡出的 */
  out?: boolean;
  onEnter?: () => void;
  onLeave?: () => void;
  onPick: () => void;
}) {
  const n = l.n;
  const name = `rg-node${n.prince ? ' prince' : ''}${n.color ? ' char' : ''}${n.dim ? ' dim' : ''}${hot ? ' hot' : ''}${out ? ' rg-out' : (cls ?? '')}`;
  return (
    <button
      className={name}
      tabIndex={out ? -1 : undefined}
      aria-hidden={out || undefined}
      data-rk={out ? undefined : n.k}
      data-relation={out ? undefined : n.k}
      style={{ left: l.x, top: l.y - l.size / 2, ...(n.color ? ({ '--cc': n.color } as CSSProperties) : {}) }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      onClick={onPick}
    >
      <Face civ={civ} chars={chars} n={n} size={l.size} />
      <span className="rg-name">{n.name}</span>
      {n.word && (
        <span className="rg-word">
          {n.cluster === 'rival' && !n.dim ? <span className="war">{n.word}</span> : n.word}
          {n.tag && <span className="tag">{n.tag}</span>}
          {n.sub && !n.dim && <span className="pol">{n.sub}</span>}
        </span>
      )}
    </button>
  );
}

function MoreView({ m, cls, out, onOpen }: { m: LMore; cls?: string; out?: boolean; onOpen: () => void }) {
  return (
    <button
      className={`rg-node rg-more${out ? ' rg-out' : (cls ?? '')}`}
      data-act={out ? undefined : 'relation-more'}
      tabIndex={out ? -1 : undefined}
      style={{ left: m.x, top: m.y - m.size / 2 }}
      onClick={onOpen}
    >
      <span className="rg-av" style={{ width: m.size, height: m.size }}>
        +{m.count}
      </span>
      <span className="rg-name">{m.label}</span>
    </button>
  );
}

function CenterView({
  civ,
  chars,
  c,
  x,
  y,
  phone,
  cls,
  out,
}: {
  civ: Civ;
  chars: readonly AuthorCharacter[] | undefined;
  c: RelCenter;
  x: number;
  y: number;
  phone: boolean;
  cls?: string;
  out?: boolean;
}) {
  return (
    <div className={`rg-cwrap${out ? ' rg-out' : (cls ?? '')}`} data-rk={out ? undefined : c.k} style={{ left: x, top: y }}>
      <div className={`rg-center${c.color ? ' char' : ''}${phone ? ' ph' : ''}`} data-relation-center={out ? undefined : c.k} style={c.color ? ({ '--cc': c.color } as CSSProperties) : undefined}>
        <CenterFace civ={civ} chars={chars} c={c} />
        <div>
          <div className="n">{c.name}</div>
          <div className="r">{c.role}</div>
        </div>
      </div>
    </div>
  );
}

/** 悬停 / 点开的说明:头像、名字、身份年份,是什么关系 */
function WhyBody({ civ, chars, n, big }: { civ: Civ; chars: readonly AuthorCharacter[] | undefined; n: RelNode; big?: boolean }) {
  return (
    <>
      <div className="h">
        <Face civ={civ} chars={chars} n={{ ...n, dim: false }} size={big ? 52 : 44} />
        <div>
          <div className="n">{n.name}</div>
          <div className="r">{n.role}</div>
        </div>
      </div>
      <div className="k">是什么关系</div>
      {n.why.map((t, i) => (
        <div key={i} className={`l${/杀|架空|对面|徙|废|叛/.test(t) ? ' war' : ''}`}>
          {t}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// 外壳:跟着选中换人、Esc

export interface RelationGraphProps {
  civ: Civ;
  world: World;
  raster: Raster | null;
  phone: boolean;
}

export function RelationGraph(props: RelationGraphProps) {
  const { civ } = props;
  const st = useRelation();
  const { sel } = useSelection();
  const { characters: chars } = useEdits();
  const step = relationCenter(st);
  const center = useMemo(() => (step ? resolveStep(civ, chars, step) : null), [civ, chars, step]);
  const civRef = useRef(civ);
  civRef.current = civ;
  const charsRef = useRef(chars);
  charsRef.current = chars;

  // 中心换了:左边卡片跟着换成他
  const centerId = center ? `${center.kind}${center.id}` : '';
  // (等图先画到屏幕上再换卡片:点了马上看到图在动,卡片紧跟着换)
  useEffect(() => {
    if (!st.open || !center) return;
    let t = 0;
    const raf = requestAnimationFrame(() => {
      t = window.setTimeout(() => {
        if (getRelation().open && !sameAsSel(civRef.current, center, getSelection().sel)) setSelection({ kind: center.kind, id: center.id });
      }, 0);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.open, st.stamp, centerId]);

  // 空闲时先把反查的索引建好,第一次打开关系图不用等
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (f: () => void) => number; cancelIdleCallback?: (id: number) => void };
    if (!w.requestIdleCallback) return;
    const id = w.requestIdleCallback(() => warmRelations(civ));
    return () => w.cancelIdleCallback?.(id);
  }, [civ]);

  // 左边卡片换了(点了卡片里的人名、搜索……):换了别人 → 图也换他居中;换成国家、城,或者关掉卡片 → 收起图
  const selK = sel ? `${sel.kind}:${sel.id}` : '';
  useEffect(() => {
    const s = getRelation();
    if (!s.open) return;
    const cur = getSelection().sel;
    const civ = civRef.current;
    const c = relationCenter(s);
    const cref = c ? resolveStep(civ, charsRef.current, c) : null;
    if (cur && cref && sameAsSel(civ, cref, cur)) return;
    if (cur && s.peek && sameAsSel(civ, s.peek, cur)) return;
    if (cur?.kind === 'person' && civ.people?.[cur.id]) return goRelation(relStep(civ, cur));
    if (cur?.kind === 'character' && charsRef.current?.some((q) => q.id === cur.id)) return goRelation(relStep(civ, cur));
    closeRelation();
  }, [selK]);

  // 中心那位不在了(重推后找不到了):收起
  useEffect(() => {
    if (st.open && step && !center) closeRelation();
  }, [st.open, step, center]);

  if (!st.open || !center) return null;
  return <RelationPanel {...props} center={center} />;
}

/** 地图左上「回到关系图」显示不显示:收起着、左边卡片还是那张图中心那位 */
export function useRelationBack(civ: Civ | null): boolean {
  const st = useRelation();
  const { sel } = useSelection();
  const { characters: chars } = useEdits();
  const step = relationCenter(st);
  if (!civ || st.open || !step) return false;
  const ref = resolveStep(civ, chars, step);
  return !!ref && sameAsSel(civ, ref, sel);
}

/** 地图左上「回到关系图」(收起关系图以后) */
export function RelationBack({ civ }: { civ: Civ }) {
  const st = useRelation();
  const { characters: chars } = useEdits();
  const step = relationCenter(st);
  const ref = step ? resolveStep(civ, chars, step) : null;
  const name = ref ? refName(civ, chars, ref) : '';
  return (
    <button className="rg-back glass" data-act="relation-back" onClick={reopenRelation}>
      <Icon name="back" size={15} />
      回到关系图
      {name && <span className="nm">{name}</span>}
    </button>
  );
}

function refName(civ: Civ, chars: readonly AuthorCharacter[] | undefined, ref: RelRef): string {
  if (ref.kind === 'person') {
    const x = civ.people?.[ref.id];
    return x ? personName(civ, x) : '';
  }
  return chars?.find((c) => c.id === ref.id)?.name ?? '';
}

// ---------------------------------------------------------------------------
// 面板

/** 换中心的过渡:换过去以前那张图 */
interface Anim {
  stamp: number;
  /** 换过去以前那张图的 stamp */
  from: number;
  L: Layout;
  c: RelCenter;
}

interface ListOpen {
  m: LMore;
}

function RelationPanel({ civ, world, raster, phone, center }: RelationGraphProps & { center: RelRef }) {
  const st = useRelation();
  const { characters: chars, era } = useEdits();
  const charPolity = useCallback((c: AuthorCharacter) => characterPolity(civ, world, raster, c), [civ, world, raster]);
  const g = useMemo(() => relationGraph(civ, chars, center, { deep: st.deep, era, charPolity }), [civ, chars, center, st.deep, era, charPolity]);
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ W: number; H: number } | null>(null);
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setSize((s) => (s && s.W === el.clientWidth && s.H === el.clientHeight ? s : { W: el.clientWidth, H: el.clientHeight }));
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const stacked = phone || (!!size && size.W < DESK_MIN_W);
  const crumbs = st.path.slice(0, st.at + 1);
  const crumbTop = stacked && crumbs.length > 1 ? 26 : 0;
  const cardW = useMemo(() => (g ? cardWidth(g.center, stacked) : 0), [g, stacked]);
  const L = useMemo<Layout | StackLayout | null>(() => {
    if (!g || !size) return null;
    return stacked ? stackLayout(g, size.W, crumbTop) : deskLayout(g, size.W, size.H, cardW);
  }, [g, size, stacked, crumbTop, cardW]);

  /** 按性别写他 / 她(推演里的人、作者的人物都一样) */
  const ta = (ref: RelRef) => heOrShe(ref.kind === 'person' ? civ.people?.[ref.id] : chars?.find((c) => c.id === ref.id));
  // 悬停说明、名单、手机上点开的那位
  const [hot, setHot] = useState<string | null>(null);
  const [list, setList] = useState<ListOpen | null>(null);
  const [sheet, setSheetNode] = useState<RelNode | null>(null);
  const hide = useRef(0);
  const enter = (k: string) => {
    window.clearTimeout(hide.current);
    setHot(k);
  };
  const leave = () => {
    window.clearTimeout(hide.current);
    hide.current = window.setTimeout(() => setHot(null), 140);
  };
  useEffect(() => () => window.clearTimeout(hide.current), []);
  useEffect(() => {
    setHot(null);
    setList(null);
    setSheetNode(null);
  }, [st.stamp, st.deep]);

  // Esc:先收名单 / 说明,再收起图(不取消左边的卡片)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      // 卡片上的「更多」菜单开着:先收菜单(PopMenu 自己管)
      if (document.querySelector('.pm-menu')) return;
      e.stopPropagation();
      if (list || sheet) {
        setList(null);
        setSheetNode(null);
      } else closeRelation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [list, sheet]);

  const pick = (n: RelNode) => {
    setList(null);
    setSheetNode(null);
    goRelation(relStep(civ, n.ref));
  };
  const peek = (n: RelNode) => {
    peekRelation(n.ref);
    setSelection({ kind: n.ref.kind, id: n.ref.id });
  };
  const onMap = () => {
    if (!sameAsSel(civ, center, getSelection().sel)) setSelection({ kind: center.kind, id: center.id });
    closeRelation();
    requestFly('sel');
  };
  const addChar = () => {
    if (center.kind !== 'person') return;
    closeRelation();
    newCharacterDraft({ kin: [{ rel: '', person: personKey(civ, center.id) }], year: getCivTime().year ?? civ.endYear });
  };

  // ---- 换中心的过渡(约 0.4 秒):两张图都有的人滑到新位置,只在旧图的淡出、新图的淡入。
  // 旧图里要淡出的人和新图一起在同一次渲染里画(同一个键,页面上原来那个元素接着用,不重新建),过渡完再拿掉
  const layer = useRef<HTMLDivElement>(null);
  const last = useRef<{ stamp: number; L: Layout | null; c: RelCenter | null }>({ stamp: st.stamp, L: null, c: null });
  const [animState, setAnim] = useState<Anim | null>(null);
  const motion = !reduceMotion() && typeof Element.prototype.animate === 'function';
  const fresh = !!L && !!g && !!last.current.L && last.current.stamp !== st.stamp && motion;
  const anim: Anim | null = fresh ? { stamp: st.stamp, from: last.current.stamp, L: last.current.L!, c: last.current.c! } : animState?.stamp === st.stamp ? animState : null;
  useLayoutEffect(() => {
    if (!L || !g) return;
    const was = last.current;
    last.current = { stamp: st.stamp, L, c: g.center };
    if (!anim || was.stamp === st.stamp || !layer.current) return;
    setAnim(anim);
    const old = new Map<string, [number, number]>();
    for (const l of anim.L.nodes) old.set(l.n.k, [l.x, l.y]);
    old.set(anim.c.k, [anim.L.cx, anim.L.cy]);
    const now = new Map<string, [number, number]>();
    for (const l of L.nodes) now.set(l.n.k, [l.x, l.y]);
    now.set(g.center.k, [L.cx, L.cy]);
    layer.current.querySelectorAll<HTMLElement>(':scope > [data-rk]:not(.rg-out)').forEach((el) => {
      const a = old.get(el.dataset.rk!);
      const b = now.get(el.dataset.rk!);
      if (a && b && (a[0] !== b[0] || a[1] !== b[1]))
        el.animate([{ transform: `translate(${a[0] - b[0]}px, ${a[1] - b[1]}px)` }, { transform: 'translate(0, 0)' }], { duration: 400, easing: 'cubic-bezier(0.25, 0.8, 0.25, 1)' });
    });
    const t = window.setTimeout(() => setAnim(null), 420);
    return () => window.clearTimeout(t);
    // 只在换了中心(stamp)、图重排时做
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L, st.stamp]);

  const deepOn = !!g && (st.deep ?? g.own < DEEP_BELOW);
  const canBack = st.at > 0;
  const canFwd = st.at < st.path.length - 1;
  const hotNode = hot && L ? L.nodes.find((l) => l.n.k === hot) : undefined;
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

  const crumbEls = (
    <span className="rg-crumbs">
      {crumbs.length > 4 && (
        <>
          <span className="more">…</span>
          <i>›</i>
        </>
      )}
      {crumbs.map((s, i) => {
        if (crumbs.length > 4 && i < crumbs.length - 3) return null;
        const ref = resolveStep(civ, chars, s);
        const name = ref ? refName(civ, chars, ref) : '（找不到了）';
        return i < crumbs.length - 1 ? (
          <Fragment key={i}>
            <button className="lnk" data-act="relation-crumb" onClick={() => jumpRelation(i)} disabled={!ref}>
              {name}
            </button>
            <i>›</i>
          </Fragment>
        ) : (
          <b key={i}>{name}</b>
        );
      })}
    </span>
  );

  /**
   * 图(电脑、手机共用):线、簇、人、中心,放在同一排里按键对上;换中心时旧图淡出的那些(rg-out)也在这一排里,
   * 新出现的淡入(rg-in),两张图都有的人留着原来的元素、由上面滑过去
   */
  const drawn = (L: Layout, c: RelCenter): ReactNode[] => {
    const out: ReactNode[] = [];
    const k = st.stamp;
    const was = anim?.L;
    const inNew = new Set([...L.nodes.map((l) => l.n.k), c.k]);
    const inOld = was ? new Set([...was.nodes.map((l) => l.n.k), anim!.c.k]) : null;
    const cls = (key: string) => (inOld && !inOld.has(key) ? ' rg-in' : '');
    const edges = (E: Layout, key: string, extra: string, live: boolean) => (
      <svg key={key} className={`rg-edges${extra}`} width="100%" height={E.height} aria-hidden="true">
        {E.edges.map((e, i) => (
          <Edge key={i} d={e.d} kind={e.kind} color={e.color} />
        ))}
        {E.edges.map((e, i) => e.dot && <circle key={`d${i}`} className={`rg-dot rg-e-${e.kind}`} cx={e.dot[0]} cy={e.dot[1]} r={3.5} style={e.color ? { fill: e.color } : undefined} />)}
        {live && hotNode?.hover && <path className="rg-e rg-e-hot" d={hotNode.hover} />}
      </svg>
    );
    const blocks = (E: Layout, s: number, extra: string) =>
      E.blocks.map((b) => (
        <div key={`b${s}-${b.cluster}`} className={`rg-block${b.dim ? ' dim' : ''}${extra}`} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
          <div className="rg-bhead">
            {b.title}
            <em>{b.count}</em>
            {b.dim && <em>隔一层</em>}
          </div>
        </div>
      ));
    if (anim) out.push(edges(anim.L, `e${anim.from}`, ' rg-out', false), ...blocks(anim.L, anim.from, ' rg-out'));
    out.push(edges(L, `e${k}`, anim ? ' rg-in' : '', true), ...blocks(L, k, anim ? ' rg-in' : ''));
    if (anim)
      for (const l of anim.L.nodes)
        if (!inNew.has(l.n.k)) out.push(<NodeView key={l.n.k} civ={civ} chars={chars} l={l} out onPick={() => {}} />);
    for (const l of L.nodes)
      out.push(
        <NodeView
          key={l.n.k}
          civ={civ}
          chars={chars}
          l={l}
          cls={cls(l.n.k)}
          hot={hot === l.n.k || sheet?.k === l.n.k}
          onEnter={!stacked ? () => enter(l.n.k) : undefined}
          onLeave={!stacked ? leave : undefined}
          onPick={() => (stacked ? setSheetNode(l.n) : pick(l.n))}
        />,
      );
    if (anim) for (const m of anim.L.mores) out.push(<MoreView key={`m${anim.from}-${m.k}`} m={m} out onOpen={() => {}} />);
    for (const m of L.mores) out.push(<MoreView key={`m${k}-${m.k}`} m={m} cls={anim ? ' rg-in' : ''} onOpen={() => setList({ m })} />);
    if (anim && !inNew.has(anim.c.k)) out.push(<CenterView key={`c${anim.c.k}`} civ={civ} chars={chars} c={anim.c} x={anim.L.cx} y={anim.L.cy} phone={stacked} out />);
    out.push(<CenterView key={`c${c.k}`} civ={civ} chars={chars} c={c} x={L.cx} y={L.cy} phone={stacked} cls={cls(c.k)} />);
    return out;
  };

  const empty =
    g && !g.own ? (
      <div className="rg-empty" style={L ? { top: L.cy + (stacked ? PHONE_CARD_H / 2 + 58 : CARD_H / 2 + 34) } : undefined}>
        <div className="t">{center.kind === 'person' ? `推演里没记下${ta(center)}和别人的往来` : `还没写${ta(center)}和别人的关系`}</div>
        <div className="s">{g.empty}</div>
        {center.kind === 'person' && (
          <button className="rg-pri" data-act="relation-add-character" onClick={addChar}>
            加一个和{ta(center)}有关的作者人物
          </button>
        )}
      </div>
    ) : null;

  // ---- 电脑:悬停说明的位置
  let pop: ReactNode = null;
  if (!stacked && hotNode && L && size) {
    const W = 292;
    const left = hotNode.side < 0 ? hotNode.x - 350 : hotNode.x + 40;
    const x = Math.max(12, Math.min(size.W - W - 12, left));
    const y = Math.max(12, Math.min(L.height - 220, hotNode.y - 20));
    pop = (
      <div className="rg-pop" style={{ left: x, top: y }} onMouseEnter={() => enter(hotNode.n.k)} onMouseLeave={leave}>
        <WhyBody civ={civ} chars={chars} n={hotNode.n} />
        <div className="f">
          <span>点一下换{ta(hotNode.n.ref)}居中</span>
          <button className="lnk" data-act="relation-peek" onClick={() => peek(hotNode.n)}>
            只看{ta(hotNode.n.ref)}的人物卡
          </button>
        </div>
      </div>
    );
  }

  // ---- 名单("还有 N 位")
  let listEl: ReactNode = null;
  /** 手机(上下排时):名单从底下弹出来,放在滑动的那一块外面,贴着看得见的底边 */
  let listSheet: ReactNode = null;
  if (list && L && size) {
    const m = list.m;
    const H = 46 + m.list.length * 45;
    const x = Math.max(12, Math.min(size.W - 312, m.x < L.cx ? m.x + 28 - 300 : m.x - 28));
    const y = Math.max(12, Math.min(L.height - H - 12, m.y + 66));
    const body = (
      <>
        <div className="t">
          {m.title}
          <em>{m.list.length} 位</em>
        </div>
        {m.list.map((n) => (
          <button key={n.k} className="rg-lrow" data-relation={n.k} onClick={() => pick(n)}>
            <span className={`ra${n.prince ? ' prince' : ''}`} style={n.color ? ({ '--cc': n.color } as CSSProperties) : undefined}>
              <Face civ={civ} chars={chars} n={n} size={30} />
            </span>
            <span className="nw">
              <span className="n">{n.name}</span>
              <span className="w">
                {n.word}
                {n.tag && <span className="tag">，{n.tag}</span>}
              </span>
            </span>
            <span className="y">{n.years}</span>
          </button>
        ))}
      </>
    );
    if (stacked)
      listSheet = (
        <>
          <div className="rg-dim" onClick={() => setList(null)} />
          <div className="rg-sheet rg-lsheet">{body}</div>
        </>
      );
    else listEl = (
      <>
        <div className="rg-catch" onPointerDown={() => setList(null)} />
        <div className="rg-list" style={{ left: x, top: y }}>
          {body}
        </div>
      </>
    );
  }

  const deepBtn = g && (
    <button className={`rg-btn${deepOn ? ' on' : ''}`} data-act="relation-deep" disabled={!g.more} aria-pressed={deepOn} onClick={() => setRelationDeep(!deepOn)}>
      <DeepIcon />
      多看一层
    </button>
  );

  // ---- 手机:下面一簇一条
  const stack = stacked && L && 'strips' in L ? L : null;
  const deepChip = stacked && g && g.own > 0 && g.own < DEEP_BELOW && g.more > 0;
  const strips = stack && (
    <div className="rg-strips" style={{ top: stack.stripsTop }}>
      {deepChip && (
        <div className="rg-chip">
          {deepBtn}
          {deepOn && st.deep === null && <span>{ta(center)}只有 {g!.own} 位关系，自动打开</span>}
        </div>
      )}
      {stack.strips.map((s) => {
        const kind: EdgeKind = s.cluster;
        const color = s.cluster === 'author' ? s.list.find((n) => n.color)?.color : null;
        return (
          <div key={s.cluster} className="rg-strip">
            <div className="sh">
              <span className="st">
                <svg className="rg-sw" width={22} height={8} viewBox="0 0 22 8" aria-hidden="true">
                  <path className={`rg-e rg-e-${kind}`} d="M1 4H21" strokeDasharray={DASH[kind]} style={color ? { stroke: color } : undefined} />
                </svg>
                {s.title}
                <em>{s.list.length}</em>
              </span>
              {s.list.length > 4 && (
                <button className="lnk" data-act="relation-all" onClick={() => setList({ m: { k: s.cluster, x: 0, y: 0, size: 0, count: s.list.length, label: '', title: s.title, list: s.list } })}>
                  全部
                </button>
              )}
            </div>
            <div className="rg-srow">
              {s.list.map((n, i) => (
                <NodeView key={n.k} civ={civ} chars={chars} l={{ n, x: 57 + i * 88, y: 34, size: 44, hover: '', side: 1 }} hot={sheet?.k === n.k} onPick={() => setSheetNode(n)} />
              ))}
              <span className="end" style={{ left: 57 + s.list.length * 88 - 30 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
  const stripsH = stack ? stack.stripsTop + (deepChip ? 46 : 0) + stack.strips.length * 146 + 90 : 0;

  return (
    <div
      className={`rg${stacked ? ' rg-stacked' : ''}${phone ? ' rg-phone' : ''}`}
      role="dialog"
      aria-label="关系图"
      data-relation-graph={g?.center.k}
      onPointerDown={stop}
      onDoubleClick={stop}
      onWheel={stop}
    >
      {stacked ? (
        <header className="rg-head">
          <button className="rg-ib" data-act="relation-back-step" disabled={!canBack} onClick={backRelation} aria-label="退回上一个">
            <Icon name="back" size={17} />
          </button>
          <span className="rg-title">关系图</span>
          {!phone && (
            <button className="rg-ib" data-act="relation-map" onClick={onMap} title="在地图上看" aria-label="在地图上看">
              <Icon name="pin" size={16} />
            </button>
          )}
          <button className="rg-x" data-act="relation-close" onClick={closeRelation} aria-label="关闭">
            <Icon name="close" size={14} />
          </button>
        </header>
      ) : (
        <header className="rg-head">
          <span className="rg-title">关系图</span>
          <span className="rg-sep" />
          <button className="rg-ib" data-act="relation-back-step" disabled={!canBack} onClick={backRelation} title="退回上一个" aria-label="退回上一个">
            <Icon name="back" size={16} />
          </button>
          <button className="rg-ib" data-act="relation-fwd" disabled={!canFwd} onClick={fwdRelation} title="前进" aria-label="前进">
            <Icon name="chevron" size={16} />
          </button>
          {crumbEls}
          <span className="rg-sp" />
          {deepBtn}
          <button className="rg-btn" data-act="relation-map" onClick={onMap}>
            <Icon name="pin" size={15} />
            在地图上看
          </button>
          <button className="rg-x" data-act="relation-close" onClick={closeRelation} title="收起(Esc)" aria-label="收起">
            <Icon name="close" size={13} />
          </button>
        </header>
      )}
      <div className="rg-stage" ref={stageRef}>
        {L && g && (
          <div className="rg-canvas" ref={layer} style={{ height: stacked ? stripsH : L.height }}>
            {stacked && crumbs.length > 1 && <div className="rg-pcrumbs">{crumbEls}</div>}
            {drawn(L, g.center)}
            {empty}
            {strips}
            {!stacked && (
              <div className="rg-legend" style={{ top: L.height - 30 }}>
                <span>
                  <Swatch kind="blood" />
                  血亲
                </span>
                <span>
                  <Swatch kind="inlaw" />
                  姻亲
                </span>
                <span>
                  <Swatch kind="court" />
                  君臣
                </span>
                <span>
                  <Swatch kind="rival" />
                  对手、杀伐
                </span>
                <span>
                  <Swatch kind="author" />
                  作者的人物
                </span>
                <span>
                  <svg className="rg-sw" width={12} height={8} viewBox="0 0 12 8" aria-hidden="true">
                    <circle cx="6" cy="4" r="3" fill="none" stroke="var(--ink-3)" strokeWidth="1.3" strokeDasharray="1.6 1.4" />
                  </svg>
                  虚线圈：没即位的宗室
                </span>
              </div>
            )}
            {!stacked && !!g.own && size && size.W >= 1100 && (
              <div className="rg-hint" style={{ top: L.height - 30 }}>
                点一个人，换他居中；鼠标停在人上看是什么关系
              </div>
            )}
            {pop}
            {listEl}
          </div>
        )}
      </div>
      {phone && g && (
        <button
          className="rg-peek"
          data-act="relation-card"
          onClick={() => {
            closeRelation();
            setSheet('full');
          }}
        >
          <span className="pk">
            <CenterFace civ={civ} chars={chars} c={g.center} />
          </span>
          <span className="nw">
            <span className="n">{g.center.name}</span>
            <span className="r">{g.center.role}</span>
          </span>
          <span className="go">
            人物卡 <Icon name="up" size={13} />
          </span>
        </button>
      )}
      {listSheet}
      {stacked && sheet && (
        <>
          <div className="rg-dim" onClick={() => setSheetNode(null)} />
          <div className="rg-sheet" data-relation-sheet={sheet.k}>
            <WhyBody civ={civ} chars={chars} n={sheet} big />
            <div className="btns">
              <button className="pri" data-act="relation-center" onClick={() => pick(sheet)}>
                以{ta(sheet.ref)}为中心
              </button>
              <button
                data-act="relation-peek"
                onClick={() => {
                  setSelection({ kind: sheet.ref.kind, id: sheet.ref.id });
                  closeRelation();
                }}
              >
                看人物卡
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

