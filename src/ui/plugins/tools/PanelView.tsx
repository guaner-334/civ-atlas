/**
 * 插件交来的面板,用网站自己的样子画:小标题起一节;数、下拉、滑块、开关、颜色连着的几个并成一组圆角的行(和国家卡片的概况一样);
 * 表格、列表各一组;挨着的按钮排成一排;页签只摊开选中的那一页。用的人动了控件交给 act(网站再转给插件)。
 * 链接、能点的行带 to 的交给 go;没给 go 时只有带 id 的能点。
 */
import { useEffect, useId, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { inputMax } from '../../../plugin/check';
import type { PanelLink, PanelNode, PanelTarget } from '../../../plugin/types';
import { PLUGIN_MARK_HEX } from '../../../render/pluginMarks';

type Row = Extract<PanelNode, { type: 'number' | 'select' | 'slider' | 'toggle' | 'color' }>;
type Button = Extract<PanelNode, { type: 'button' }>;
type Tabs = Extract<PanelNode, { type: 'tabs' }>;
type Block = { kind: 'rows'; rows: Row[] } | { kind: 'buttons'; buttons: Button[] } | { kind: 'node'; node: PanelNode } | { kind: 'tabs'; node: Tabs; key: string; at: number };
interface Section {
  title?: string;
  blocks: Block[];
}
type Act = (id: string, value?: unknown) => void;
type Go = (to: PanelTarget) => void;
/** 用的人在面板上留下的(打的字、选的页、挑的色):挂在整个面板上,换页签挪了位置、控件重画了也还在;插件换了 base 就作废 */
type Kept = Map<string, { base: unknown; v: unknown }>;
interface Ctx {
  act: Act;
  go?: Go;
  kept: Kept;
  choose: (n: Tabs, key: string, at: number) => void;
}

export function kept<T>(m: Kept, key: string, base: unknown, init: () => T): T {
  let e = m.get(key);
  if (!e || e.base !== base) {
    e = { base, v: init() };
    m.set(key, e);
  }
  return e.v as T;
}

function useKept<T extends object>(c: Ctx, key: string, base: unknown, init: () => T): [T, () => void] {
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  return [kept(c.kept, key, base, init), redraw];
}

/** 页签现在显示第几页;key = 页签的 id,没有 id 的按它是第几个页签 */
export type TabPick = (n: Tabs, key: string) => number;
const firstTab: TabPick = (n) => n.value ?? 0;

/** 摊成一节一节:小标题、group 的标题起新的一节;页签自成一节,后面接着摊它选中的那一页 */
export function sectionsOf(nodes: readonly PanelNode[], pick: TabPick = firstTab): Section[] {
  const out: Section[] = [{ blocks: [] }];
  const cur = () => out[out.length - 1];
  const open = (title?: string) => {
    if (!cur().blocks.length && cur().title === undefined) cur().title = title;
    else out.push({ title, blocks: [] });
  };
  let tabsSeen = 0;
  const walk = (list: readonly PanelNode[]) => {
    for (const n of list) {
      const blocks = cur().blocks;
      const last = blocks[blocks.length - 1];
      if (n.type === 'heading') open(n.text);
      else if (n.type === 'group') {
        open(n.title);
        walk(n.children);
        open();
      } else if (n.type === 'tabs') {
        const key = n.id ?? `#${tabsSeen}`;
        tabsSeen++;
        const at = Math.min(n.tabs.length - 1, Math.max(0, pick(n, key)));
        if (blocks.length) open();
        cur().blocks.push({ kind: 'tabs', node: n, key, at });
        open();
        walk(n.tabs[at].children);
        open();
      } else if (n.type === 'number' || n.type === 'select' || n.type === 'slider' || n.type === 'toggle' || n.type === 'color') {
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

/** 回车、空格当成点了一下(能点的行、链接不是真按钮) */
const pressKeys = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  fn();
};

export function PanelView({ nodes, act, go }: { nodes: readonly PanelNode[]; act: Act; go?: Go }) {
  const store = useRef<Kept>(new Map());
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  const tab = (n: Tabs, key: string) => kept(store.current, `tab:${key}`, n.value, () => ({ at: n.value ?? 0 }));
  const ctx: Ctx = {
    act,
    go,
    kept: store.current,
    choose: (n, key, at) => {
      tab(n, key).at = at;
      redraw();
      if (n.id !== undefined) act(n.id, at);
    },
  };
  const pick: TabPick = (n, key) => tab(n, key).at;
  return (
    <>
      {sectionsOf(nodes, pick).map((s, i) => (
        <section key={i} className="cp-sec plg-psec">
          {s.title && <div className="cp-sec-head">{s.title}</div>}
          {s.blocks.map((b, j) => (
            <BlockView key={b.kind === 'node' && 'id' in b.node && b.node.id !== undefined ? `id-${b.node.id}` : j} b={b} c={ctx} />
          ))}
        </section>
      ))}
    </>
  );
}

function BlockView({ b, c }: { b: Block; c: Ctx }): ReactNode {
  const { act } = c;
  if (b.kind === 'rows')
    return (
      <div className="cp-grid plg-rows">
        {b.rows.map((r, i) => (r.type === 'color' ? <ColorRow key={r.id} r={r} c={c} /> : <RowView key={'id' in r ? r.id : i} r={r} act={act} />))}
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
  if (b.kind === 'tabs') {
    const n = b.node;
    return (
      <div className="seg plg-tabs" role="tablist" data-act={n.id !== undefined ? `plugin-${n.id}` : undefined}>
        {n.tabs.map((g, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === b.at} className={i === b.at ? 'on' : undefined} onClick={() => i !== b.at && c.choose(n, b.key, i)}>
            {g.title}
          </button>
        ))}
      </div>
    );
  }
  const n = b.node;
  if (n.type === 'text') return <p className="plg-txt">{typeof n.text === 'string' ? n.text : n.text.map((s, i) => (typeof s === 'string' ? s : <LinkView key={i} l={s} c={c} />))}</p>;
  if (n.type === 'input') return <Field n={n} c={c} />;
  if (n.type === 'divider') return <hr className="plg-hr" />;
  if (n.type === 'list' || n.type === 'table') return <Rows n={n} c={c} />;
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

/** 表格、列表:带 id 的每行都能点(告诉插件第几行),带 to 的那行网站带用的人过去 */
function Rows({ n, c }: { n: Extract<PanelNode, { type: 'table' | 'list' }>; c: Ctx }) {
  const live = (i: number) => n.id !== undefined || !!(n.to?.[i] && c.go);
  const hit = (i: number) => {
    if (n.id !== undefined) c.act(n.id, i);
    const to = n.to?.[i];
    if (to && c.go) c.go(to);
  };
  const press = (i: number) => ({ tabIndex: 0, onClick: () => hit(i), onKeyDown: pressKeys(() => hit(i)), 'data-act': `plugin-${n.id ?? 'to'}`, 'data-i': i });
  if (n.type === 'list')
    return (
      <div className="cp-group plg-list">
        {n.items.map((x, i) =>
          live(i) ? (
            <div key={i} className="plg-li go" role="button" {...press(i)}>
              {x}
            </div>
          ) : (
            <div key={i} className="plg-li">
              {x}
            </div>
          ),
        )}
      </div>
    );
  const anyLive = n.rows.some((_, i) => live(i));
  return (
    <div className="cp-group plg-tbl" role="table">
      {n.columns.length > 0 && (
        <div className={`plg-tr plg-th${anyLive ? ' go-pad' : ''}`} role="row">
          {n.columns.map((x, i) => (
            <span key={i} role="columnheader">
              {x}
            </span>
          ))}
        </div>
      )}
      {n.rows.map((r, i) => {
        const on = live(i);
        return (
          <div key={i} className={`plg-tr${on ? ' go' : anyLive ? ' go-pad' : ''}`} role="row" {...(on ? press(i) : {})}>
            {r.map((x, j) => (
              <span key={j} role="cell" className={typeof x === 'number' ? 'n' : undefined}>
                {cell(x)}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** 一段字里的链接:只给了 to、网站又不带人过去的照普通的字画 */
function LinkView({ l, c }: { l: PanelLink; c: Ctx }) {
  const to = l.to && c.go ? l.to : undefined;
  if (l.id === undefined && !to) return <>{l.text}</>;
  const hit = () => {
    if (l.id !== undefined) c.act(l.id);
    if (to) c.go!(to);
  };
  return (
    <span className="plg-a" role="button" tabIndex={0} data-act={l.id !== undefined ? `plugin-${l.id}` : undefined} onClick={hit} onKeyDown={pressKeys(hit)}>
      {l.text}
    </span>
  );
}

function RowView({ r, act }: { r: Exclude<Row, { type: 'color' }>; act: Act }) {
  return (
    <>
      <span className="cp-k">{r.label}</span>
      <span className="cp-v">
        <RowValue r={r} act={act} />
      </span>
    </>
  );
}

function RowValue({ r, act }: { r: Exclude<Row, { type: 'color' }>; act: Act }) {
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
function Slider({ r, act }: { r: Extract<PanelNode, { type: 'slider' }>; act: Act }) {
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

/** 输入框:打字时只在这里,回车(单行)或点别处才交给插件 */
function Field({ n, c }: { n: Extract<PanelNode, { type: 'input' }>; c: Ctx }) {
  const fid = useId();
  const max = inputMax(n);
  const [d, redraw] = useKept(c, `input:${n.id}`, n.value, () => ({ v: n.value ?? '', sent: n.value ?? '' }));
  const change = (v: string) => {
    d.v = v;
    redraw();
  };
  const send = () => {
    const s = d.v.slice(0, max);
    if (s === d.sent) return;
    d.sent = s;
    c.act(n.id, s);
  };
  const common = {
    id: fid,
    value: d.v,
    maxLength: max,
    placeholder: n.placeholder,
    autoComplete: 'off',
    'data-act': `plugin-${n.id}`,
    onBlur: send,
  };
  return (
    <div className="plg-fld">
      <label htmlFor={fid}>{n.label}</label>
      {n.multiline ? (
        <textarea className="plg-ta" {...common} onChange={(e) => change(e.target.value)} />
      ) : (
        // 拼音还在选字时的回车不算
        <input type="text" className="plg-in" {...common} onChange={(e) => change(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && send()} />
      )}
      {d.v.length >= max * 0.9 && (
        <span className="plg-cnt">
          {numText(d.v.length)} / {numText(max)}
        </span>
      )}
    </div>
  );
}

const SWATCHES = Object.values(PLUGIN_MARK_HEX);

/** 颜色:一行,右边色点和色号;点开在这一行下面摊开几种颜色和色号框,选了马上交给插件 */
function ColorRow({ r, c }: { r: Extract<PanelNode, { type: 'color' }>; c: Ctx }) {
  const [d, redraw] = useKept(c, `color:${r.id}`, r.value, () => ({ v: r.value, typed: r.value }));
  // 插件收到颜色再交回来时不收起
  const [ui] = useKept(c, `color-open:${r.id}`, undefined, () => ({ open: false }));
  const choose = (hex: string) => {
    d.typed = hex;
    redraw();
    if (hex === d.v) return;
    d.v = hex;
    c.act(r.id, hex);
  };
  const commit = () => {
    const m = /^#?([0-9a-f]{6})$/i.exec(d.typed.trim());
    if (m) choose(`#${m[1].toLowerCase()}`);
    else {
      d.typed = d.v;
      redraw();
    }
  };
  const toggle = () => {
    ui.open = !ui.open;
    redraw();
  };
  return (
    <>
      <span className="cp-k">{r.label}</span>
      <span className="cp-v">
        <button type="button" className={`plg-colv${ui.open ? ' open' : ''}`} aria-expanded={ui.open} aria-label={`${r.label} ${d.v}`} data-act={`plugin-${r.id}`} onClick={toggle}>
          <i style={{ background: d.v }} />
          {d.v.toUpperCase()}
        </button>
      </span>
      {ui.open && (
        <div className="plg-pop">
          <div className="mk-colors">
            {SWATCHES.map((hex) => (
              <button key={hex} type="button" className={`${hex === d.v ? 'on' : ''}${hex === '#ffffff' ? ' white' : ''}`} style={{ background: hex }} aria-label={hex} aria-pressed={hex === d.v} onClick={() => choose(hex)} />
            ))}
          </div>
          <label className="plg-hex">
            色号
            <input
              className="plg-in"
              value={d.typed}
              maxLength={7}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                d.typed = e.target.value;
                redraw();
              }}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
            />
          </label>
        </div>
      )}
    </>
  );
}
