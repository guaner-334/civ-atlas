/**
 * 世界概览的"世界设定"页:这个世界创建时定下的根 —— 种子、六项世界参数、改过的地形、地名风格、推演年数、
 * 拓荒(民族扩散、国家扩张、地形难走程度)、文明起源,都只能看,不能再改
 * (一改几千年的历史就要整个重来)。想换个样子:"以它为底稿新建…"(回到新建这一步,设定照原样带过去,存成另一个世界)。
 * 右栏最上面是随时能改的「纪年」(EraSettings.tsx)和「月份」(MonthSettings.tsx;窄屏单独一节放在最上面),下面还有"回放世界形成"。
 *
 * 世界参数的滑条(SLIDERS、ParamSlider)、推演年数的开关和滑条(YearsRows)在这里定义,新建世界(studio/Studio.tsx)用。
 */
import { useEffect, useState } from 'react';
import type { World, WorldParams } from '../gen/world';
import { speedText, terrainBrief as terrainCostBrief } from '../gen/civ/frontier';
import { originCiv, originSpots } from './studio/origins';
import type { Civ } from '../gen/civ/types';
import { END_YEAR_DEFAULT, END_YEAR_MAX, END_YEAR_STEP, cleanEndYear, endYearOf, type TerrainKind } from '../gen/edits';
import { setEndYear, useEdits } from './editsStore';
import { currentWorld, useSavesVersion } from './saveStore';
import { Icon } from './icons';
import { genSeconds } from './genSpeed';
import { mixSummary } from './nameMix';
import { EraSection } from './EraSettings';
import { MonthSection } from './MonthSettings';
import { useNarrow } from './device';
import { ParamField, rangeFill, type FieldSpec } from './ParamField';
import './ai.css';

interface Slider {
  key: keyof WorldParams;
  name: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  hint: string;
  /** 拖滑条时数字后面再加一句(只在新建世界的滑条上;世界设定页只写数字) */
  more?: (v: number) => string | null;
  /** 右边数值框怎么写(见 ParamField.tsx 的 FieldSpec;不给 = 原样的数、没有单位) */
  field?: FieldSpec;
  /** 拖到的位置吸到哪(只取几档的滑条;不给 = 不吸) */
  snap?: (v: number) => number;
  /** 滑条的值和框里写的数不成比例时(按对数摆的几档):值 → 框里的数、框里的数 → 值(不夹进范围);给了就不看 field 的 mul、div */
  shown?: (v: number) => number;
  fromShown?: (d: number) => number;
}

export const SLIDERS: Slider[] = [
  { key: 'landFraction', name: '陆地比例', min: 0.12, max: 0.6, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%`, hint: '陆地占整个星球的比例', field: { unit: '%', mul: 100 } },
  { key: 'plates', name: '板块数量', min: 8, max: 60, step: 1, fmt: (v) => `${v}`, hint: '板块越多,陆地越破碎、岛屿和山脉越多(板块有大有小)' },
  { key: 'mountains', name: '造山强度', min: 0.2, max: 2, step: 0.05, fmt: (v) => `${v.toFixed(2)}×`, hint: '板块碰撞隆起的力度', field: { unit: '×', digits: 2 } },
  { key: 'temperature', name: '气温', min: -12, max: 12, step: 1, fmt: (v) => `${v > 0 ? '+' : ''}${v}°C`, hint: '整体偏冷(冰河期)还是偏暖', field: { unit: '°C' } },
  { key: 'rainfall', name: '降水', min: 0.4, max: 1.8, step: 0.05, fmt: (v) => `${v.toFixed(2)}×`, hint: '整体偏干还是偏湿', field: { unit: '×', digits: 2 } },
  {
    key: 'cells',
    name: '精细度',
    min: 12000,
    max: 200000,
    step: 2000,
    fmt: (v) => `${Math.round(v / 1000)}k 地块`,
    hint: '越精细越慢',
    field: { unit: 'k', div: 1000 },
    more: (v) => {
      const sec = genSeconds(v);
      return sec === null ? null : `约 ${sec} 秒`;
    },
  },
];

/** 南北偏向写成"均匀""北 40""南 40" */
export const northText = (v: number) => (Math.round(v * 100) === 0 ? '均匀' : `${v > 0 ? '北' : '南'} ${Math.abs(Math.round(v * 100))}`);

/** 大陆的另外四样(大陆数量是分段按钮,不是滑条) */
export const CONT_SLIDERS: Slider[] = [
  { key: 'gather', name: '大陆聚拢', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}`, hint: '0 = 大陆彼此离得远;越大越往一处挤,100 常常挤成一大片,另一边留出大洋', field: { mul: 100 } },
  { key: 'rugged', name: '破碎度', min: 0.2, max: 2, step: 0.05, fmt: (v) => `${v.toFixed(2)}×`, hint: '小 = 一大块、海岸平直、岛少(像非洲);大 = 支离破碎、半岛海湾和岛多(像欧洲)', field: { unit: '×', digits: 2 } },
  { key: 'hardness', name: '板块硬度', min: 0.4, max: 2.5, step: 0.05, fmt: (v) => `${v.toFixed(2)}×`, hint: '越硬内陆越平、山脉越窄越矮;越软山越多越宽、高原多', field: { unit: '×', digits: 2 } },
  { key: 'north', name: '南北偏向', min: -1, max: 1, step: 0.05, fmt: northText, hint: '陆地多长在哪个半球', field: { mul: 100, signs: ['南', '北'], zero: '均匀' } },
];

/** 大陆五样都是默认的(= 按种子来) */
export const contDefault = (p: WorldParams) => p.continents === 0 && p.gather === 0 && p.rugged === 1 && p.hardness === 1 && p.north === 0;

/** 大陆五样的一句话:"2 块大陆，破碎 0.60×";都是默认 = null */
export function contBrief(p: WorldParams): string | null {
  const parts: string[] = [];
  if (p.continents) parts.push(`${p.continents} 块大陆`);
  if (p.gather) parts.push(`聚拢 ${Math.round(p.gather * 100)}`);
  if (p.rugged !== 1) parts.push(`破碎 ${p.rugged.toFixed(2)}×`);
  if (p.hardness !== 1) parts.push(`硬度 ${p.hardness.toFixed(2)}×`);
  if (p.north) parts.push(`偏${northText(p.north)}`);
  return parts.length ? parts.join('，') : null;
}

/** 不是世界参数的滑条(推演年数):键只用来标记 */
export type SliderLike = Omit<Slider, 'key'> & { key: string };

/** 推演到第几年(开了「推演超过 3000 年」才有):3000–60000,一格 1000 年 */
export const YEARS_SLIDER: SliderLike = {
  key: 'endYear',
  name: '推演到',
  min: END_YEAR_DEFAULT,
  max: END_YEAR_MAX,
  step: END_YEAR_STEP,
  fmt: (v) => `${v} 年`,
  hint: '历史推到第几年;年数越多,打开世界、改历史都越慢',
  field: { unit: '年', snap: END_YEAR_STEP },
};
/** 推演年数的开关 */
export const YEARS_SWITCH = `推演超过 ${END_YEAR_DEFAULT} 年`;
/** 打开开关时滑条先停在哪 */
export const YEARS_ON = 10000;
/** 开关下面一直显示的那段说明 */
export const YEARS_NOTE =
  '近现代、现代、未来整体还在开发中，帝国的衰退和科技的发展也在设计当中，历史推演超过3000年后会陷入低价值的循环，如果你理解并且接受这种情况可以选择开启该选项最高推演至6万年。';
/**
 * "三千年的历史":3000 年的世界照旧,推得更久的写真实年数("60000 年的历史")。
 * gap:接在汉字后面(不是标点后面)时数字前空一格("推演它 60000 年")
 */
export function yearsSpan(end: number, gap = false): string {
  return end === END_YEAR_DEFAULT ? '三千年' : `${gap ? ' ' : ''}${end} 年`;
}

/** 世界参数的一行简写(卡片里"世界参数"那一行右边);定了大陆数量的写大陆数量 */
export function paramsSide(p: WorldParams): string {
  return `陆地 ${Math.round(p.landFraction * 100)}%，${p.continents ? `${p.continents} 块大陆` : `${p.plates} 个板块`}`;
}

const KIND_NAME: Record<TerrainKind, string> = { volcano: '火山', range: '山脉', lake: '湖', raise: '抬起陆地', sink: '沉成海', river: '河' };

/**
 * 改过的地形:"2 处：火山 1、山脉 1";画过草图的和编辑地形里一个说法:"画了 12 笔：草图 11 笔、河 1"
 * (一笔没涂、没涂的地方都是海:"都是海");没改 = "没有"
 */
export function terrainBrief(ops: readonly { kind: TerrainKind }[], sketch?: { rest: string; strokes: readonly unknown[] }): string {
  const n = new Map<TerrainKind, number>();
  for (const o of ops) n.set(o.kind, (n.get(o.kind) ?? 0) + 1);
  const parts = [...n].map(([k, c]) => `${KIND_NAME[k]} ${c}`);
  if (!sketch) return ops.length ? `${ops.length} 处：${parts.join('、')}` : '没有';
  const k = sketch.strokes.length;
  if (!k && !ops.length) return '都是海';
  return `画了 ${k + ops.length} 笔：${[...(k ? [`草图 ${k} 笔`] : []), ...parts].join('、')}`;
}

/**
 * 一项世界参数的滑条:名字、右边能直接打字的数值框(ParamField.tsx)、下面滑条。拖动时只改数字,松手(或键盘改完)才算数;
 * changed = 和所选预设不一样(数字用主色写)
 */
export function ParamSlider({
  s,
  value,
  onCommit,
  disabled,
  changed,
}: {
  s: SliderLike;
  value: number;
  onCommit: (v: number) => void;
  disabled?: boolean;
  changed?: boolean;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="param-slider" title={s.hint} data-param={s.key}>
      <span className="param-slider-row">
        <span>{s.name}</span>
        <ParamField s={s} value={v} onCommit={onCommit} onBad={setErr} disabled={disabled} changed={changed} />
      </span>
      {err && <span className="param-slider-err">{err}</span>}
      <input
        type="range"
        aria-label={s.name}
        className={s.key === 'north' ? 'mid' : undefined}
        min={s.min}
        max={s.max}
        step={s.step}
        value={v}
        disabled={disabled}
        style={rangeFill(s, v)}
        onChange={(e) => setV(s.snap ? s.snap(Number(e.target.value)) : Number(e.target.value))}
        onPointerUp={() => v !== value && onCommit(v)}
        onKeyUp={() => v !== value && onCommit(v)}
      />
    </div>
  );
}

/**
 * 新建界面「世界参数」里最后三样:开关「推演超过 3000 年」(默认关),下面一直写着那段说明;
 * 开了才有「推演到」滑条(刚打开在 YEARS_ON 年,松手才算数)。改的是当前世界的修改(editsStore 的 setEndYear)
 */
export function YearsRows({ disabled }: { disabled?: boolean }) {
  const raw = useEdits().endYear;
  const on = raw !== undefined;
  const end = cleanEndYear(raw) ?? END_YEAR_DEFAULT;
  return (
    <>
      <button className="sb-row nw-years" role="switch" aria-checked={on} data-act="years-switch" disabled={disabled} onClick={() => setEndYear(on ? undefined : YEARS_ON)}>
        <span className="sb-row-main">
          <b>{YEARS_SWITCH}</b>
        </span>
        <span className={`ai-switch${on ? ' on' : ''}`} aria-hidden="true" />
      </button>
      <p className="nw-years-note">{YEARS_NOTE}</p>
      {on && <ParamSlider s={YEARS_SLIDER} value={end} disabled={disabled} onCommit={setEndYear} />}
    </>
  );
}

export interface SettingsProps {
  params: WorldParams;
  /** 第 0 年的星球(文明起源落在哪一州要看它;有地形大事时是大事以前的那颗) */
  world: World | null;
  civ: Civ | null;
  /** 回放世界形成:能不能点、正在放 */
  replay: { on: boolean; ready: boolean };
  /** 世界还在生成 */
  generating: boolean;
  onReplay: () => void;
  /** 以它为底稿新建 */
  onDraftFrom: () => void;
}

/** 文明起源:"自己选的 3 处：甲、乙、丙"(住不了人、推演时跳过的不列);没选 = "自动" */
function originsBrief(pts: readonly number[] | undefined, world: World | null, civ: Civ | null): string {
  if (!pts?.length) return '自动';
  const n = pts.length >> 1;
  if (!world || !civ) return `自己选的 ${n} 处`;
  const names = originSpots(world, originCiv(civ), pts)
    .filter((s) => s.ok)
    .map((s) => s.name);
  return names.length ? `自己选的 ${names.length} 处：${names.join('、')}` : `自己选的 ${n} 处都住不了人，照自动推演`;
}

export function SettingsPage(p: SettingsProps) {
  useSavesVersion();
  const edits = useEdits();
  const title = currentWorld()?.title;
  const { params } = p;
  const end = endYearOf(edits);
  const narrow = useNarrow();
  const era = (
    <>
      <EraSection civ={p.civ} end={end} />
      <MonthSection civ={p.civ} />
    </>
  );
  return (
    <div className="ov-settings">
      {narrow && <section className="ov-sec">{era}</section>}
      <section className="ov-sec">
        <h3>
          创建时定下的
          <small>
            <Icon name="lock" size={14} />
            不能再改
          </small>
        </h3>
        <div className="ov-kv">
          <div className="ov-kv-row" data-param="seed">
            <span>种子</span>
            <b>{params.seed}</b>
          </div>
          {SLIDERS.map((s) => (
            <div key={s.key} className="ov-kv-row" data-param={s.key}>
              <span>{s.name}</span>
              <b>{s.fmt(params[s.key])}</b>
            </div>
          ))}
          {/* 大陆五样:改过才列(按种子来的世界和以前一样) */}
          {!contDefault(params) && (
            <>
              <div className="ov-kv-row" data-param="continents">
                <span>大陆数量</span>
                <b>{params.continents ? `${params.continents} 块` : '自动'}</b>
              </div>
              {CONT_SLIDERS.map((s) => (
                <div key={s.key} className="ov-kv-row" data-param={s.key}>
                  <span>{s.name}</span>
                  <b>{s.fmt(params[s.key])}</b>
                </div>
              ))}
            </>
          )}
          <div className="ov-kv-row" data-param="terrain">
            <span>改过的地形</span>
            <b>{terrainBrief(edits.terrain, edits.sketch)}</b>
          </div>
          <div className="ov-kv-row" data-param="name-mix">
            <span>地名风格</span>
            <b>{mixSummary(edits.nameMix)}</b>
          </div>
          <div className="ov-kv-row" data-param="end-year">
            <span>推演年数</span>
            <b>{end} 年</b>
          </div>
          <div className="ov-kv-row" data-param="spread">
            <span>民族扩散</span>
            <b>{speedText(edits.frontier?.spread ?? 1)}</b>
          </div>
          <div className="ov-kv-row" data-param="expand">
            <span>国家扩张</span>
            <b>{speedText(edits.frontier?.expand ?? 1)}</b>
          </div>
          <div className="ov-kv-row" data-param="terrain-cost">
            <span>地形难走程度</span>
            <b>{terrainCostBrief(edits.frontier)}</b>
          </div>
          <div className="ov-kv-row" data-param="origins">
            <span>文明起源</span>
            <b>{originsBrief(edits.origins?.pts, p.world, p.civ)}</b>
          </div>
        </div>
      </section>
      <section className="ov-sec">
        {!narrow && era}
        <h3>想换个样子</h3>
        <p className="ov-txt">
          种子、参数和地形一变，{yearsSpan(end)}的历史就要整个重来。想试试别的样子，可以以{title || '它'}为底稿另建一个世界：设定全部带过去，改过的名字和干预也跟过去，
          {title || '原来的世界'}本身不变。
        </p>
        <button className="ov-btn ov-primary ov-ico-btn" data-act="draft-from" disabled={p.generating} onClick={p.onDraftFrom}>
          <Icon name="copy" size={16} />
          以它为底稿新建…
        </button>
        <h3 className="ov-gap">这颗星球是怎么来的</h3>
        <p className="ov-txt dim">从板块漂移到流水侵蚀，几秒钟看完这颗星球长成现在的样子，接着放{yearsSpan(end, true)}的历史。</p>
        <button className="ov-btn ov-ico-btn replay" data-act="replay" disabled={p.generating || p.replay.on} onClick={p.onReplay}>
          <Icon name="replay" size={16} />
          {p.replay.on ? (p.replay.ready ? '正在回放' : '正在准备回放') : '回放世界形成'}
        </button>
      </section>
    </div>
  );
}
