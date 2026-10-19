import { dataLegend, type ClimateLegend, type GradientLegend } from '../render/dataLegend';
import { contourNote, type ContourKind } from '../render/contours';
import type { LayerId } from '../render/layers';
import type { RGB } from '../render/common';

const css = (c: RGB) => `rgb(${c.map(Math.round).join(',')})`;

function Gradient({ spec }: { spec: GradientLegend }) {
  const { stops, unit, labels } = spec;
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

function ClimateKeys({ spec }: { spec: ClimateLegend }) {
  return (
    <>
      <div className="lg-title">
        {spec.title} <span>{spec.subtitle}</span>
      </div>
      <div className="lg-groups">
        {spec.groups.map((g) => (
          <div key={g.letter} className="lg-group">
            <span className="lg-gname">{g.name}</span>
            <span className="keys">
              {g.classes.map((c) => (
                <span key={c.code}>
                  <i style={{ background: c.css }} />
                  <b>{c.code}</b>
                  {c.short}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="lg-note">{spec.note}</div>
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
  const spec = dataLegend(layer);
  let body;
  if (spec.kind === 'climate') body = <ClimateKeys spec={spec} />;
  else if (spec.kind === 'gradient') body = <Gradient spec={spec} />;
  else
    body = (
      <div className="keys">
        {spec.keys.map((k) => (
          <span key={k.name}>
            <i style={{ background: css(k.color) }} />
            {k.name}
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
