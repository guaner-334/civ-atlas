/**
 * 插件交来的面板,用网站自己的样子画:小标题起一节;数、下拉、滑块、开关连着的几个并成一组圆角的行(和国家卡片的概况一样);
 * 表格、列表各一组;挨着的按钮排成一排。用的人动了控件交给 act(网站再转给插件)。
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { PanelNode } from '../../../plugin/types';

type Row = Extract<PanelNode, { type: 'number' | 'select' | 'slider' | 'toggle' }>;
type Button = Extract<PanelNode, { type: 'button' }>;
type Block = { kind: 'rows'; rows: Row[] } | { kind: 'buttons'; buttons: Button[] } | { kind: 'node'; node: PanelNode };
interface Section {
  title?: string;
  blocks: Block[];
}

/** 摊成一节一节:小标题、group 的标题起新的一节 */
export function sectionsOf(nodes: readonly PanelNode[]): Section[] {
  const out: Section[] = [{ blocks: [] }];
  const cur = () => out[out.length - 1];
  const open = (title?: string) => {
    if (!cur().blocks.length && cur().title === undefined) cur().title = title;
    else out.push({ title, blocks: [] });
  };
  const walk = (list: readonly PanelNode[]) => {
    for (const n of list) {
      const blocks = cur().blocks;
      const last = blocks[blocks.length - 1];
      if (n.type === 'heading') open(n.text);
      else if (n.type === 'group') {
        open(n.title);
        walk(n.children);
        open();
      } else if (n.type === 'number' || n.type === 'select' || n.type === 'slider' || n.type === 'toggle') {
        if (last?.kind === 'rows') last.rows.push(n);
        else blocks.push({ kind: 'rows', rows: [n] });
      } else if (n.type === 'button') {
        if (last?.kind === 'buttons') last.buttons.push(n);
        else blocks.push({ kind: 'buttons', buttons: [n] });
      } else blocks.push({ kind: 'node', node: n });
    }
  };
  walk(nodes);
  return out.filter((s) => s.blocks.length || s.title);
}

/** 数:千分位,小数最多两位 */
export function numText(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

const cell = (v: string | number) => (typeof v === 'number' ? numText(v) : v);

export function PanelView({ nodes, act }: { nodes: readonly PanelNode[]; act: (id: string, value?: unknown) => void }) {
  return (
    <>
      {sectionsOf(nodes).map((s, i) => (
        <section key={i} className="cp-sec plg-psec">
          {s.title && <div className="cp-sec-head">{s.title}</div>}
          {s.blocks.map((b, j) => (
            <BlockView key={j} b={b} act={act} />
          ))}
        </section>
      ))}
    </>
  );
}

function BlockView({ b, act }: { b: Block; act: (id: string, value?: unknown) => void }): ReactNode {
  if (b.kind === 'rows')
    return (
      <div className="cp-grid plg-rows">
        {b.rows.map((r, i) => (
          <RowView key={'id' in r ? r.id : i} r={r} act={act} />
        ))}
      </div>
    );
  if (b.kind === 'buttons')
    return (
      <div className="plg-bts">
        {b.buttons.map((x) => (
          <button key={x.id} type="button" className="plg-pbtn" data-act={`plugin-${x.id}`} disabled={x.disabled} onClick={() => act(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
    );
  const n = b.node;
  if (n.type === 'text') return <p className="plg-txt">{n.text}</p>;
  if (n.type === 'divider') return <hr className="plg-hr" />;
  if (n.type === 'list')
    return (
      <div className="cp-group plg-list">
        {n.items.map((x, i) => (
          <div key={i} className="plg-li">
            {x}
          </div>
        ))}
      </div>
    );
  if (n.type === 'table')
    return (
      <div className="cp-group plg-tbl" role="table">
        {n.columns.length > 0 && (
          <div className="plg-tr plg-th" role="row">
            {n.columns.map((c, i) => (
              <span key={i} role="columnheader">
                {c}
              </span>
            ))}
          </div>
        )}
        {n.rows.map((r, i) => (
          <div key={i} className="plg-tr" role="row">
            {r.map((c, j) => (
              <span key={j} role="cell" className={typeof c === 'number' ? 'n' : undefined}>
                {cell(c)}
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  if (n.type === 'legend')
    return (
      <div className="plg-lg">
        {n.items.map((x, i) => (
          <span key={i}>
            <i style={{ background: x.color }} />
            {x.label}
          </span>
        ))}
      </div>
    );
  if (n.type === 'progress')
    return (
      <div className="plg-pg">
        {n.label && <span>{n.label}</span>}
        <i>
          <b style={{ width: `${Math.round(Math.min(1, Math.max(0, n.value)) * 100)}%` }} />
        </i>
      </div>
    );
  return null;
}

function RowView({ r, act }: { r: Row; act: (id: string, value?: unknown) => void }) {
  return (
    <>
      <span className="cp-k">{r.label}</span>
      <span className="cp-v">
        <RowValue r={r} act={act} />
      </span>
    </>
  );
}

function RowValue({ r, act }: { r: Row; act: (id: string, value?: unknown) => void }) {
  if (r.type === 'number')
    return (
      <>
        {numText(r.value)}
        {r.unit ? ` ${r.unit}` : ''}
      </>
    );
  if (r.type === 'select')
    return (
      <select className="plg-sel" data-act={`plugin-${r.id}`} value={r.value ?? r.options[0]?.value ?? ''} onChange={(e) => act(r.id, e.target.value)} aria-label={r.label}>
        {r.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  if (r.type === 'toggle')
    return <button type="button" role="switch" aria-checked={r.value} aria-label={r.label} className={`plg-tg${r.value ? ' on' : ''}`} data-act={`plugin-${r.id}`} onClick={() => act(r.id, !r.value)} />;
  return <Slider r={r} act={act} />;
}

/** 滑块:拖的时候跟手,松手才交给插件 */
function Slider({ r, act }: { r: Extract<PanelNode, { type: 'slider' }>; act: (id: string, value?: unknown) => void }) {
  const [v, setV] = useState(r.value);
  useEffect(() => setV(r.value), [r.value]);
  const send = () => v !== r.value && act(r.id, v);
  return (
    <span className="plg-sl">
      <input
        type="range"
        className="plg-range"
        data-act={`plugin-${r.id}`}
        min={r.min}
        max={r.max}
        step={r.step ?? 'any'}
        value={v}
        aria-label={r.label}
        style={{ ['--p' as string]: `${r.max > r.min ? ((v - r.min) / (r.max - r.min)) * 100 : 0}%` }}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={send}
        onKeyUp={send}
        onBlur={send}
      />
      <span className="plg-slv">{numText(v)}</span>
    </span>
  );
}
