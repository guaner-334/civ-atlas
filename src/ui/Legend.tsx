import { BIOMES } from '../gen/biomes';
import { CLIMATE_CLASSES } from '../gen/koppen';
import { CURRENT_RAMP, ELEV_RAMP, PRECIP_RAMP, TEMP_RAMP, type LayerId } from '../render/layers';
import { contourNote, type ContourKind } from '../render/contours';
import type { RGB } from '../render/common';

const css = (c: RGB) => `rgb(${c.map(Math.round).join(',')})`;

function Gradient({ stops, unit, labels }: { stops: [number, RGB][]; unit: string; labels: number[] }) {
  const lo = stops[0][0];
  const hi = stops[stops.length - 1][0];
  const g = stops.map(([v, c]) => `${css(c)} ${((v - lo) / (hi - lo)) * 100}%`).join(',');
  return (
    <div className="gradient">
      <div className="bar" style={{ background: `linear-gradient(90deg, ${g})` }} />
      <div className="ticks">
        {labels.map((l) => (
          <span key={l} style={{ left: `${((l - lo) / (hi - lo)) * 100}%` }}>
            {l.toLocaleString()}
          </span>
        ))}
      </div>
      <div className="unit">{unit}</div>
    </div>
  );
}

/** 气候分类的图例按 A–E 五组排(代号的第一个字母);热带只有一类,只写代号 */
const CLIMATE_GROUPS: { name: string; letter: string }[] = [
  { name: 'A 热带', letter: 'A' },
  { name: 'B 干旱', letter: 'B' },
  { name: 'C 温带', letter: 'C' },
  { name: 'D 冷温带', letter: 'D' },
  { name: 'E 极地', letter: 'E' },
];
/** 图例里温带、冷温带的名字写短的(组名已经写了"温带""冷温带") */
const shortName = (name: string) => name.replace(/^(冷温带|温带),/, '').replace('夏季', '夏').replace('冬季', '冬');

function ClimateKeys() {
  return (
    <>
      <div className="lg-title">
        气候分类 <span>(估算,按柯本 - 盖格)</span>
      </div>
      <div className="lg-groups">
        {CLIMATE_GROUPS.map((g) => (
          <div key={g.letter} className="lg-group">
            <span className="lg-gname">{g.name}</span>
            <span className="keys">
              {CLIMATE_CLASSES.filter((c) => c.code[0] === g.letter).map((c) => (
                <span key={c.code}>
                  <i style={{ background: c.color }} />
                  <b>{c.code}</b>
                  {c.code.length > 1 ? shortName(c.name) : ''}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="lg-note">由年均温、年降水和离海远近推算;世界里没有逐月降水,不分干湿季(f / s / w)。</div>
    </>
  );
}

/** 等值线的说明:细线、粗线的线样 + 单位和间隔 */
function ContourKey({ kind, ink, zoom }: { kind: ContourKind; ink: string; zoom: number }) {
  return (
    <div className="lg-contour">
      <svg width="22" height="8" aria-hidden="true">
        <line x1="1" y1="4" x2="21" y2="4" stroke={ink} strokeWidth={0.85} />
      </svg>
      <svg width="22" height="8" aria-hidden="true">
        <line x1="1" y1="4" x2="21" y2="4" stroke={ink} strokeWidth={2} />
      </svg>
      <span>{contourNote(kind, zoom)}</span>
    </div>
  );
}

/**
 * 地图左上角的图例:数据图层的色阶 / 色块(layer = null:不是数据图层,只有等值线的说明);
 * 开着等值线时下面加一行线的说明(contours = 哪种线,ink = 线的颜色,zoom = 放大倍数)
 */
export function Legend({ layer, contours = null, ink = '#333', zoom = 1 }: { layer: LayerId | null; contours?: ContourKind | null; ink?: string; zoom?: number }) {
  const key = contours ? <ContourKey kind={contours} ink={ink} zoom={zoom} /> : null;
  if (!layer)
    return key ? <div className="legend">{key}</div> : null;
  let body;
  if (layer === 'climate') body = <ClimateKeys />;
  else if (layer === 'elevation') body = <Gradient stops={ELEV_RAMP} unit="海拔 米" labels={[-4000, 0, 2200, 5500]} />;
  else if (layer === 'temperature') body = <Gradient stops={TEMP_RAMP} unit="年均温 °C" labels={[-30, -15, 0, 15, 30]} />;
  else if (layer === 'precipitation')
    body = (
      <>
        <Gradient stops={PRECIP_RAMP} unit="年降水 mm · 白箭头 = 盛行风" labels={[0, 600, 1200, 2000, 3200]} />
      </>
    );
  else if (layer === 'currents')
    body = <Gradient stops={CURRENT_RAMP} unit="水温和同纬度比（°C），箭头是洋流方向" labels={[-6, -3, 0, 3, 6]} />;
  else if (layer === 'plates')
    body = (
      <div className="keys">
        <span>
          <i style={{ background: '#c8281e' }} />
          碰撞带(造山)
        </span>
        <span>
          <i style={{ background: '#1e5adc' }} />
          张裂带(裂谷 / 洋中脊)
        </span>
        <span>
          <i style={{ background: '#222' }} />
          箭头 = 漂移方向
        </span>
        <span>
          <i style={{ background: '#56687d' }} />
          偏暗 = 大洋板块
        </span>
      </div>
    );
  else
    body = (
      <div className="keys">
        {BIOMES.slice(1, -1).map((b) => (
          <span key={b.name}>
            <i style={{ background: css(b.real) }} />
            {b.name}
          </span>
        ))}
      </div>
    );
  return (
    <div className={`legend${layer === 'climate' ? ' wide' : ''}`}>
      {body}
      {key && <div className="lg-sep" />}
      {key}
    </div>
  );
}
