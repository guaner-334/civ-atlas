/**
 * 「新建世界」的两步弹窗(在「我的世界」点「新建世界」时弹):
 *
 *   第 1 步  怎么生成:随机生成 / 照手绘图生成(两张带图的卡片,默认随机;双击一张 = 选它并下一步)。
 *            选好以后进新建界面,两种不能互换
 *   第 2 步  基础参数(就是新建界面「世界参数」那几样,默认值不变)。随机的有种子(随机给一个,能换);
 *            照图的先选一张图(拖进来或「选一张图」),不列陆地比例(海陆照图定),种子随机给,进去以后在「山河、地名换一种」里换。
 *            最后一组「历史」:开关「推演超过 3000 年」(默认关),组下面一直写着那段说明;开了多一条「推演到」(刚打开 10000 年)。
 *            底下一句说进去以后这些都还能改
 *
 * 点「开始」才交给 App(存下没建完的世界、进新建界面;照图的把读好的图交过去,进去直接是第 1 步「认出海陆」)。
 * 「取消」、Esc、点窗口外面:什么都不留下(读好的图也扔掉)。
 * 电脑上是浮在页面正中的窗口;手机上从底部升起、几乎占满屏:顶上一排(取消 / 上一步、标题、第几步),底部一个大按钮。
 */
import { Fragment, useEffect, useRef, useState } from 'react';
import type { WorldParams } from '../gen/world';
import { CONT_SLIDERS, SLIDERS, YEARS_NOTE, YEARS_ON, YEARS_SLIDER, YEARS_SWITCH, contBrief, type SliderLike } from './WorldOverviewGenesis';
import { CONT_RESET, ContinentSeg, ParamField, rangeFill } from './ParamField';
import { PresetPicker, type PresetPick } from './PresetPicker';
import { changedKeys, choiceParams, getPresets, usePresets } from './presetStore';
import { isImageFile, loadImage, type LoadedImage } from './ImportImage';
import { Icon } from './icons';
import './ai.css';
import './newWorld.css';

export type NewWorldMode = 'random' | 'image';

export interface NewWorldStart {
  mode: NewWorldMode;
  params: WorldParams;
  /** 照手绘图:读好的那张图(交给 App 以后由它管,不再收回) */
  picture: LoadedImage | null;
  /** 推演到第几年(没开「推演超过 3000 年」= 不给) */
  endYear?: number;
}

/** 从哪一步开始(刷新了照手绘图还没选好图的新建:回到它的第 2 步,参数、推演年数照网址) */
export interface NewWorldInit {
  mode: NewWorldMode;
  params: WorldParams;
  step: 1 | 2;
  endYear?: number;
}

export interface NewWorldDialogProps {
  phone: boolean;
  init?: NewWorldInit;
  /** 随机一个种子 */
  randomSeed: () => number;
  onCancel: () => void;
  onStart: (s: NewWorldStart) => void;
}

const PIC_RANDOM = `${import.meta.env.BASE_URL}new-random.jpg`;
const PIC_SKETCH = `${import.meta.env.BASE_URL}new-sketch.jpg`;

/** 第 1 步的两张卡片 */
const CARDS: { mode: NewWorldMode; name: string; desc: string }[] = [
  { mode: 'random', name: '随机生成', desc: '程序按一个种子长出整颗星球。不满意就换一颗，也能再用笔改地形。' },
  { mode: 'image', name: '照手绘图生成', desc: '导入你画的地图或高度图。海和陆地照着图长，山、河、气候由程序补上。' },
];

/** 第 2 步的几组参数:组名、组名右边一句(电脑上)、哪几样;「大陆」一组另外写(只有随机生成有) */
function groups(mode: NewWorldMode): { name: string; note?: string; keys: (keyof WorldParams)[] }[] {
  return [
    mode === 'random'
      ? {
          name: '陆地',
          note: '海和陆地怎么分',
          keys: ['landFraction', 'plates', 'mountains'],
        }
      : // 照图的海陆照图定;板块硬度管山怎么长,照样有
        {
          name: '陆地',
          note: '山脉、高原怎么长',
          keys: ['plates', 'mountains', 'hardness'],
        },
    { name: '气候', keys: ['temperature', 'rainfall'] },
    { name: '精细度', note: '越精细越慢', keys: ['cells'] },
  ];
}

const sliderOf = (k: keyof WorldParams) => (SLIDERS.find((x) => x.key === k) ?? CONT_SLIDERS.find((x) => x.key === k))!;

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

/**
 * 一项参数:名字、滑条、能直接打字的数值框。打的字不对时这一行下面一句红字(超出范围:按回车会改成哪个数)
 */
function ParamRow({ s, value, onChange, phone, changed }: { s: SliderLike; value: number; onChange: (v: number) => void; phone: boolean; changed?: boolean }) {
  const k = s.key;
  const [err, setErr] = useState<string | null>(null);
  const name = k === 'cells' ? '地块' : s.name;
  return (
    <>
      <label className={`nd-pr${err ? ' has-err' : ''}`} title={s.hint} data-param={k}>
        <span className="nd-n">{name}</span>
        <span className="tp-range">
          <input
            type="range"
            aria-label={s.name}
            className={k === 'north' ? 'mid' : undefined}
            min={s.min}
            max={s.max}
            step={s.step}
            value={value}
            style={rangeFill(s, value)}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </span>
        <ParamField s={s} value={value} onCommit={onChange} onBad={setErr} changed={changed} />
      </label>
      {err && <div className={`nd-err${phone ? ' phone' : ''}`}>{err}</div>}
    </>
  );
}

/** 打开弹窗时的参数:停在上次选的预设上(存了种子的连种子) */
function startParams(randomSeed: () => number): {
  params: WorldParams;
  endYear?: number;
} {
  const c = choiceParams(getPresets(), getPresets().chosen);
  return {
    params: { ...c.params, seed: c.seed ?? randomSeed() },
    endYear: c.endYear,
  };
}

export function NewWorldDialog(p: NewWorldDialogProps) {
  const [step, setStep] = useState<1 | 2>(p.init?.step ?? 1);
  const [mode, setMode] = useState<NewWorldMode>(p.init?.mode ?? 'random');
  const [first] = useState(() => (p.init ? { params: p.init.params, endYear: p.init.endYear } : startParams(p.randomSeed)));
  const [params, setParams] = useState<WorldParams>(first.params);
  const [seedText, setSeedText] = useState(String(params.seed));
  const [seedBad, setSeedBad] = useState(false);
  const [picture, setPicture] = useState<LoadedImage | null>(null);
  /** 推演到第几年(开关关着 = undefined,就是 3000 年) */
  const [years, setYears] = useState<number | undefined>(first.endYear);
  /** 「大陆」一组展开了没有(平时收着,像打印窗口的「显示详细信息」) */
  const [contOpen, setContOpen] = useState(false);
  const presets = usePresets();
  /** 和所选预设不一样的几样(数字用主色写) */
  const changed = changedKeys(presets, presets.chosen, params);
  /** 选了一个预设:参数换成它的;存了种子的连种子换 */
  const applyPreset = (c: PresetPick) => {
    const seed = c.seed ?? params.seed;
    setParams({ ...c.params, seed });
    setSeedText(String(seed));
    setSeedBad(false);
    setYears(c.endYear);
  };
  const [over, setOver] = useState(false);
  const loading = useRef(0);
  /** 还没交出去的那张图(关掉弹窗、换一张时扔掉) */
  const held = useRef<LoadedImage | null>(null);
  const given = useRef(false);
  useEffect(
    () => () => {
      // 还在读的图读完时窗口已经关了:算作过时的,读好就扔掉
      loading.current++;
      if (!given.current && held.current) URL.revokeObjectURL(held.current.url);
    },
    [],
  );

  const choose = async (file: File | undefined) => {
    if (!file) return;
    const req = ++loading.current;
    const l = await loadImage(file);
    if (!l) return;
    if (req !== loading.current) return URL.revokeObjectURL(l.url);
    if (held.current) URL.revokeObjectURL(held.current.url);
    held.current = l;
    setPicture(l);
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = () => fileRef.current?.click();

  const commitSeed = () => {
    const n = Math.floor(Number(seedText));
    if (n > 0) setParams((q) => ({ ...q, seed: n }));
    else setSeedText(String(params.seed));
  };
  const reroll = () => {
    const seed = p.randomSeed();
    setSeedBad(false);
    setSeedText(String(seed));
    setParams((q) => ({ ...q, seed }));
  };
  const canStart = mode === 'random' || !!picture;
  const start = () => {
    if (!canStart) return;
    const n = Math.floor(Number(seedText));
    // 照手绘图:海岸照图,大陆一组里只露出板块硬度;预设带来的其余几样不显示,也不用
    const final = mode === 'random' ? (n > 0 ? { ...params, seed: n } : params) : { ...params, ...CONT_RESET, hardness: params.hardness };
    given.current = true;
    if (mode !== 'image' && held.current) URL.revokeObjectURL(held.current.url);
    p.onStart({ mode, params: final, picture: mode === 'image' ? picture : null, ...(years ? { endYear: years } : {}) });
  };
  const next = (m: NewWorldMode = mode) => {
    setMode(m);
    setStep(2);
  };

  // Esc = 取消(第 2 步也是,"上一步"用按钮)
  const cancelRef = useRef(p.onCancel);
  cancelRef.current = p.onCancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 把图拖进窗口:第 2 步照手绘图时收下(别处松手不当成打开存档)
  const dropOk = step === 2 && mode === 'image';
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = dropOk ? 'copy' : 'none';
    if (dropOk !== over) setOver(dropOk);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (dropOk && f && isImageFile(f)) void choose(f);
  };

  const title = step === 1 ? '新建世界' : mode === 'random' ? '随机生成' : '照手绘图生成';
  const sub =
    step === 1
      ? '先选这颗星球的地形从哪来。选好以后不能换成另一种。'
      : mode === 'random'
        ? '先定几样大的。拿不准就用默认的，进去以后看着星球再调。'
        : '选一张图，再定几样大的。海和陆地照图来，所以这里不用定陆地比例。';
  const info =
    mode === 'random'
      ? p.phone
        ? '进去以后这些都还能改，还能用笔改地形；点「创建世界」以后才定下来。'
        : '进去以后，这些在左边「世界参数」里都还能改，还能用笔改地形；点「创建世界」以后才定下来。'
      : '进去以后先认出图里的海和陆地，再用笔修。这些参数在「参数和名字」那一步都还能改；点「创建世界」以后才定下来。';

  const cards = (
    <div className="nd-cards" role="radiogroup" aria-label="怎么生成">
      {CARDS.map((c) => (
        <button
          key={c.mode}
          className={`nd-card${mode === c.mode ? ' on' : ''}`}
          role="radio"
          aria-checked={mode === c.mode}
          data-mode={c.mode}
          onClick={() => setMode(c.mode)}
          onDoubleClick={() => next(c.mode)}
        >
          <span className={`nd-pic ${c.mode}`}>
            <img src={c.mode === 'random' ? PIC_RANDOM : PIC_SKETCH} alt="" draggable={false} />
            {mode === c.mode ? (
              <span className="nd-check">
                <Icon name="check" size={14} />
              </span>
            ) : (
              <span className="nd-ring" />
            )}
          </span>
          <b>{c.name}</b>
          <span className="nd-d">{c.desc}</span>
        </button>
      ))}
    </div>
  );

  const seedGroup = (
    <>
      <div className="nd-lab">星球</div>
      <div className="nd-grp">
        <div className="nd-pr">
          <span className="nd-n">种子</span>
          <input
            className="nd-fld"
            aria-label="种子"
            data-act="dlg-seed"
            value={seedText}
            inputMode="numeric"
            onChange={(e) => {
              const v = e.target.value;
              const d = v.replace(/\D/g, '');
              setSeedBad(d !== v);
              setSeedText(d.slice(0, 9));
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            onBlur={() => {
              setSeedBad(false);
              commitSeed();
            }}
          />
          {!p.phone && <span className={`nd-seed-tip${seedBad ? ' bad' : ''}`}>{seedBad ? '只能填数字' : '同一个种子总长出同一颗星球'}</span>}
          <button className="nd-sbtn" data-act="dlg-reroll" onClick={reroll}>
            <Icon name="dice" size={15} />
            换一个
          </button>
        </div>
      </div>
    </>
  );

  const imageBox = picture ? (
    <div className="nd-picked" data-act="dlg-picked">
      <img src={picture.url} alt="" draggable={false} />
      <div className="nd-picked-tx">
        <b title={picture.name}>{picture.name}</b>
        <span>
          {picture.w} × {picture.h}，{picture.pic.colorful ? '彩色' : '灰度'}
        </span>
        <button className="nd-link" data-act="dlg-repick" onClick={pick}>
          换一张
        </button>
      </div>
    </div>
  ) : (
    <div className={`nd-drop${over ? ' over' : ''}`} data-act="dlg-drop">
      <Icon name="image" size={30} />
      {!p.phone && <b>把图片拖到这里</b>}
      <button className="nd-btn b2 nd-pick" data-act="dlg-pick" onClick={pick}>
        选一张图
      </button>
      <span className="nd-fine">手画的地图、彩色地图、只描了海岸的铅笔线稿、灰度高度图都行。图片只在这台{p.phone ? '手机' : '电脑'}上认，不会上传。</span>
    </div>
  );

  const setKey = (k: keyof WorldParams) => (v: number) => setParams((q) => ({ ...q, [k]: v }));
  const row = (k: keyof WorldParams) => <ParamRow key={k} s={sliderOf(k)} value={params[k]} phone={p.phone} changed={changed.has(k)} onChange={setKey(k)} />;
  // 大陆这几样和选中的预设(或默认)一样就不显示「恢复默认」;点它回到选中的那一套
  const contKeys = Object.keys(CONT_RESET) as (keyof typeof CONT_RESET)[];
  const contPlain = !contKeys.some((k) => changed.has(k));
  const resetCont = () => {
    const c = choiceParams(presets, presets.chosen).params;
    setParams((q) => ({ ...q, ...Object.fromEntries(contKeys.map((k) => [k, c[k]])) }));
  };
  // 「大陆」一组(只有随机生成):平时收成一行,右边写改了哪些;展开是大陆数量(分段按钮)和四个滑条
  const contSec = mode === 'random' && (
    <div className="nd-sec" data-sec="continents">
      <div className="nd-lab">
        大陆
        {!contOpen ? (
          <small>可选</small>
        ) : contPlain ? (
          !p.phone && <small>数量、形状和分布</small>
        ) : (
          <button className="nd-lab-a" data-act="dlg-cont-reset" onClick={resetCont}>
            恢复默认
          </button>
        )}
      </div>
      <div className="nd-grp">
        {!contOpen ? (
          <button className="nd-pr nd-more" data-act="dlg-cont" aria-expanded={false} onClick={() => setContOpen(true)}>
            <span className="nd-more-n">数量、聚拢、破碎、软硬、南北</span>
            <span className="nd-more-s">{contBrief(params) ?? '都按种子来'}</span>
            <Icon name="chevron" size={14} />
          </button>
        ) : (
          <>
            <div className="nd-pr" data-param="continents">
              <span className="nd-n">大陆数量</span>
              <ContinentSeg value={params.continents} onChange={setKey('continents')} plates={params.plates} land={params.landFraction} />
            </div>
            {CONT_SLIDERS.map((x) => row(x.key))}
          </>
        )}
      </div>
      {contOpen && <p className="nd-foot">这几样改的是大陆怎么长：同一个种子配上不同的设置，会长出不一样的星球。</p>}
    </div>
  );

  const paramsBody = (
    <>
      {mode === 'random' ? seedGroup : imageBox}
      {groups(mode).map((g, i) => (
        <Fragment key={g.name}>
          <div className="nd-sec">
            <div className="nd-lab">
              {g.name}
              {g.note && (!p.phone || g.keys[0] === 'cells') && <small>{g.note}</small>}
            </div>
            <div className="nd-grp">{g.keys.map(row)}</div>
          </div>
          {i === 0 && contSec}
        </Fragment>
      ))}
      <div className="nd-sec">
        <div className="nd-lab">
          历史
          <small>年数越多，打开越慢</small>
        </div>
        <div className="nd-grp">
          <label className="nd-pr">
            <span className="nd-n wide">{YEARS_SWITCH}</span>
            <button className={`ai-switch${years ? ' on' : ''}`} role="switch" aria-checked={!!years} data-act="dlg-years" onClick={() => setYears(years ? undefined : YEARS_ON)} />
          </label>
          {years && <ParamRow s={YEARS_SLIDER} value={years} phone={p.phone} onChange={setYears} />}
        </div>
        <p className="nd-foot">{YEARS_NOTE}</p>
      </div>
      {(mode === 'random' || picture) && (
        <div className="nd-info">
          <Icon name="info" size={17} />
          <span>{info}</span>
        </div>
      )}
    </>
  );
  const presetRow = (
    <div className="ps-row nd-preset">
      <span className="ps-l">预设</span>
      <PresetPicker params={params} endYear={years} onPick={applyPreset} phone={p.phone} saveLink={!p.phone} />
    </div>
  );

  const startBtn = (
    <button className="nd-btn b1" data-act={step === 1 ? 'dlg-next' : 'dlg-start'} disabled={step === 2 && !canStart} autoFocus onClick={() => (step === 1 ? next() : start())}>
      {step === 1 ? '下一步' : '开始'}
    </button>
  );
  const file = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        void choose(f);
      }}
    />
  );

  return (
    <div className="nd-scrim" onPointerDown={stop} onClick={p.onCancel} onDragOver={onDragOver} onDragLeave={() => setOver(false)} onDrop={onDrop} onWheel={stop}>
      {p.phone ? (
        <div className="nd-psheet" role="dialog" aria-modal="true" aria-label={title} data-step={step} data-mode={mode} onClick={stop}>
          <div className="nd-pnav">
            {step === 1 ? (
              <button className="nd-pl" data-act="dlg-cancel" onClick={p.onCancel}>
                取消
              </button>
            ) : (
              <button className="nd-pl" data-act="dlg-back" onClick={() => setStep(1)}>
                <Icon name="back" size={18} />
                上一步
              </button>
            )}
            <b>{title}</b>
            {step === 1 ? (
              <span className="nd-pr-r">1 / 2</span>
            ) : (
              <button className="nd-pl r" data-act="dlg-cancel" onClick={p.onCancel}>
                取消
              </button>
            )}
          </div>
          {step === 2 && presetRow}
          <div className="nd-pbody">
            {step === 1 && <p className="nd-sub">{sub}</p>}
            {step === 1 ? cards : paramsBody}
          </div>
          <div className="nd-pfoot">{startBtn}</div>
          {file}
        </div>
      ) : (
        <div
          className={`nd-sheet${step === 2 ? ' tall' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="nd-title"
          data-step={step}
          data-mode={mode}
          onClick={stop}
        >
          <div className="nd-hd">
            <h2 id="nd-title">{title}</h2>
            <span className="nd-step">第 {step} 步，共 2 步</span>
          </div>
          <p className="nd-sub">{sub}</p>
          {step === 1 ? (
            cards
          ) : (
            <>
              {presetRow}
              {/* 预设一行和底下的按钮不动,中间的参数滚 */}
              <div className="nd-scroll">{paramsBody}</div>
            </>
          )}
          <div className="nd-ft">
            <button className="nd-btn b2" data-act="dlg-cancel" onClick={p.onCancel}>
              取消
            </button>
            <span className="nd-sp" />
            {step === 2 && (
              <button className="nd-btn b2" data-act="dlg-back" onClick={() => setStep(1)}>
                上一步
              </button>
            )}
            {startBtn}
          </div>
          {file}
        </div>
      )}
    </div>
  );
}
