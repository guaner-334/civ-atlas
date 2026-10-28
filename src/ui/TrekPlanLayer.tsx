/**
 * 下令「大迁徙」指定一州时,地图上那条预估的路(要画的那一条由大迁徙那一页放进 trekInfo.ts 的 planStore):
 *   - 路线:依次经过的各州治所连起来,先抹圆一点(邻点平均、再切角几遍),这一族颜色的虚线 3 像素(9 实 7 空),
 *     外面一圈浅色边(手绘纸色、写实白色);线头一个实心箭头(长 15、半宽 8,同色、浅色描边)
 *   - 目的地:箭头上面写州名(15 像素粗,这一族颜色压深),下面小字"目的地"(12 像素),字带一圈浅色边;字体用各画风自己的地名字体
 *   - 起点那一州另由 civView 的一直亮着的高亮涂出来,旁边小牌子"从这里出发"(TargetPlates.tsx 的 MapTag)
 * 每帧按"世界坐标 → 屏幕坐标"重新摆(平移、缩放、左右无限拖动都对;平面地图跨过东西接缝的那一段接上;有一处转到地球仪背面就整条不画)。
 * 不接点击。
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import type { Civ } from '../gen/civ/types';
import type { World } from '../gen/world';
import { FONT_FANTASY, FONT_REALISTIC } from '../render/labels/fonts';
import type { WorldToClient } from './EventPins';
import type { Style } from './mapLayers';
import { useTrekPlan } from './trekInfo';
import './newIv.css';

/** 邻点平均(半径 1),两头不动 */
function smooth(p: [number, number][]): [number, number][] {
  return p.map((v, i) => {
    if (i === 0 || i === p.length - 1) return v;
    const a = p[i - 1];
    const b = p[i + 1];
    return [(a[0] + v[0] + b[0]) / 3, (a[1] + v[1] + b[1]) / 3];
  });
}

/** 切角(Chaikin)n 遍,两头不动 */
function chaikin(p: [number, number][], n: number): [number, number][] {
  for (let k = 0; k < n; k++) {
    const q: [number, number][] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [x0, y0] = p[i];
      const [x1, y1] = p[i + 1];
      q.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

/** 这一族颜色压深(字用):同一色相,饱和度提一点,亮度压到 0.29 */
function dark(c: readonly number[]): string {
  const [r, g, b] = c.map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  const s0 = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const s = Math.min(1, s0 * 1.3);
  const L = 0.29;
  const C = (1 - Math.abs(2 * L - 1)) * s;
  const X = C * (1 - Math.abs((h % 2) - 1));
  const m = L - C / 2;
  const [x, y, z] = h < 1 ? [C, X, 0] : h < 2 ? [X, C, 0] : h < 3 ? [0, C, X] : h < 4 ? [0, X, C] : h < 5 ? [X, 0, C] : [C, 0, X];
  return `rgb(${[x, y, z].map((v) => Math.round((v + m) * 255)).join(',')})`;
}

export function TrekPlanLayer({ civ, world, toClient, style }: { civ: Civ | null; world: World; toClient: MutableRefObject<WorldToClient | null>; style: Style }) {
  const plan = useTrekPlan();
  const halo = useRef<SVGPathElement>(null);
  const line = useRef<SVGPathElement>(null);
  const head = useRef<SVGPathElement>(null);
  const name = useRef<SVGTextElement>(null);
  const note = useRef<SVGTextElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!plan || !civ) return;
    const seat = civ.regions.seat;
    const W = world.width;
    const pts0 = plan.route.map((r) => [world.mesh.x[seat[r]], world.mesh.y[seat[r]]] as [number, number]);
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const f = toClient.current;
      const el = svg.current;
      if (!el) return;
      const raw: [number, number][] = [];
      for (const [x, y] of pts0) {
        const at = f?.(x, y) ?? null;
        if (!at) {
          el.style.visibility = 'hidden';
          return;
        }
        raw.push([at[0], at[1]]);
      }
      // 平面地图左右相连:跨过东西接缝的点挪到和前一点同一份地图上
      const a = f?.(pts0[0][0], pts0[0][1]);
      const b = f?.(pts0[0][0] + 1, pts0[0][1]);
      const span = a && b ? (b[0] - a[0]) * W : 0;
      if (span > 0) {
        for (let i = 1; i < raw.length; i++) {
          while (raw[i][0] - raw[i - 1][0] > span / 2) raw[i][0] -= span;
          while (raw[i][0] - raw[i - 1][0] < -span / 2) raw[i][0] += span;
        }
      }
      el.style.visibility = '';
      const p = chaikin(smooth(raw), 4);
      const d = 'M' + p.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('L');
      halo.current?.setAttribute('d', d);
      line.current?.setAttribute('d', d);
      // 箭头:顺着最后 14 像素的方向
      const tip = p[p.length - 1];
      let k = p.length - 2;
      while (k > 0 && Math.hypot(tip[0] - p[k][0], tip[1] - p[k][1]) < 14) k--;
      let dx = tip[0] - p[k][0];
      let dy = tip[1] - p[k][1];
      const dd = Math.hypot(dx, dy) || 1;
      dx /= dd;
      dy /= dd;
      const bx = tip[0] - dx * 15;
      const by = tip[1] - dy * 15;
      head.current?.setAttribute('d', `M${(bx - dy * 8).toFixed(1)},${(by + dx * 8).toFixed(1)}L${tip[0].toFixed(1)},${tip[1].toFixed(1)}L${(bx + dy * 8).toFixed(1)},${(by - dx * 8).toFixed(1)}Z`);
      for (const [t, oy] of [
        [name.current, -16],
        [note.current, 24],
      ] as const) {
        t?.setAttribute('x', (tip[0] - 4).toFixed(1));
        t?.setAttribute('y', (tip[1] + oy).toFixed(1));
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [plan, civ, world, toClient]);
  if (!plan || !civ) return null;
  const color = `rgb(${plan.color.join(',')})`;
  const ink = dark(plan.color);
  const real = style !== 'fantasy';
  const bg = real ? 'rgba(255,255,255,0.95)' : 'rgba(250,244,228,0.96)';
  const font = `"${real ? FONT_REALISTIC : FONT_FANTASY}", serif`;
  const text = { fontFamily: font, stroke: bg, strokeWidth: 3.6, paintOrder: 'stroke', textAnchor: 'middle' } as const;
  return (
    <svg ref={svg} className="tk-plan" style={{ visibility: 'hidden' }} aria-hidden="true" data-trek-plan={plan.route.length}>
      <path ref={halo} fill="none" stroke={bg} strokeWidth={7.2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="9 7" />
      <path ref={line} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="9 7" />
      <path ref={head} fill={color} stroke={bg} strokeWidth={2.6} strokeLinejoin="round" style={{ paintOrder: 'stroke' }} />
      <text ref={name} fill={ink} fontSize={15} fontWeight={700} style={text}>
        {plan.dest}
      </text>
      <text ref={note} fill={ink} fontSize={12} fontWeight={500} style={text}>
        目的地
      </text>
    </svg>
  );
}
