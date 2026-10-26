/**
 * 经纬网的度数:"图层与投影"里的经纬网开着时,把看得见的经线、纬线标上度数(算法见 graticuleLabels.ts)。
 *
 * 放在舞台(.stage)外面、和它一样大一样位置的一层里,不接鼠标:
 *   - 新建世界摊平改地形(frame):地图在中间一个固定的框里,度数写在框外的深色空边上 ——
 *     电脑四边都写(照手绘图新建时框上边紧挨切换条,只写下、左、右三边);手机框左右没空,经度写在框下面,纬度写进地图里贴着左边
 *   - 平常的世界页(map):地图铺满屏幕,写在地图里 —— 纬度贴着左边(电脑让出侧栏卡片)、经度贴着下边(时间轴、手机的底部卡片上面),右下角的按钮让开
 * 写在地图里的字衬底:手绘、数据图层深字浅光晕,写实白字暗影。
 */
import type { MapProj } from '../render/projection';
import { layoutGratLabels, type GratSpec } from './graticuleLabels';
import type { MapView, StageBox } from './mapWrap';

export function GratLabels({
  W,
  H,
  view,
  sb,
  mp,
  step,
  spec,
  ink,
  pos,
}: {
  W: number;
  H: number;
  view: MapView;
  sb: StageBox;
  mp: MapProj | null;
  step: number;
  spec: GratSpec;
  /** 地图里的字按哪种底色衬:'realistic' 白字暗影,其它深字浅光晕 */
  ink: string;
  /** 舞台在页面里的位置(新建世界摊平时舞台只占中间一块) */
  pos?: { x: number; y: number };
}) {
  const g = layoutGratLabels(W, H, view, sb, mp, step, spec);
  if (!g) return null;
  const skin = ink === 'realistic' ? 'realistic' : 'light';
  return (
    <div className="grat-labels" aria-hidden="true" style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, width: sb.sw, height: sb.sh, fontSize: spec.fs }} data-lon={g.lonEvery} data-lat={g.latEvery}>
      {g.ticks.map((k, i) => (
        <i key={`t${i}`} style={{ left: Math.round(k.x), top: Math.round(k.y), width: k.w, height: k.h }} />
      ))}
      {g.texts.map((s, i) => (
        <span
          key={i}
          className={`${s.out ? 'out' : skin}${s.eq ? ' eq' : ''}`}
          style={{ left: Math.round(s.x), top: Math.round(s.y), transform: s.ax || s.ay ? `translate(${-s.ax * 100}%, ${-s.ay * 100}%)` : undefined }}
        >
          {s.text}
        </span>
      ))}
    </div>
  );
}
