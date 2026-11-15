/**
 * 作品墙上世界、地图作品的介绍窗(作品墙那一页上点开、作品的网址打开都先到这里;点了才下载这个文件)。
 * 照新建参数窗(Gallery.tsx 的 PresetWorkDialog)那一套:封面整张 2:1、作品名、标签 + 署名、一句话、两列格子、一句小字、「举报」+ 主按钮。
 *
 *   世界  几样数(服务器给的 facts,没给的那行不列)、打开要下载多大、用的规则;「打开这个世界」在窗里下载世界文件(进度、能取消),
 *         取完窗关上进世界;断网、太频繁、服务器忙写为什么 +「再试一次」;撤下了、世界文件读不了主按钮灰,只能关窗
 *   地图  这张地图的参数(从存档里读;存档里本来没有的那项不列)、作者用笔改过地形的多一行;「看看这颗星球」「用这张地图打造文明」
 *
 * 窗一开才去取作品;关窗、换了作品以后才回来的结果扔掉。取完、点了按钮以后不关窗:换画面时作品墙那一页连窗一起收起,网址留着这个作品
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';
import { Dialog } from './AccountDialogs';
import { ReportDialog, presetRows } from './Gallery';
import { coverUrl, fetchWork, isWorkGone, loadGallery, useGallery, wasReported, type AiKind, type GalleryItem, type GalleryWork, type WorkFacts } from '../account/gallery';
import { ServerError } from '../account/server';
import { parseSave } from '../gen/savefile';
import { briefError } from './saveStore';
import { sizeText } from './sizeWords';
import { pairText } from './fullWorldView';
import type { SharedWorld } from './fullWorldPull';
import { rulesUiOn } from './rules/flag';
import { openRulesSheet } from './rules/sheetStore';
import './galleryWork.css';

type Row = [string, string];

const AI_WORDS: Record<AiKind, [string, string]> = { history: ['史书', '版'], names: ['释名', '条'], doctrine: ['教义', '篇'], customs: ['风俗', '篇'] };

/** 「AI 写的」那一格:史书 2 版、释名 14 条(只写给了的) */
export function aiText(ai: NonNullable<WorkFacts['ai']>): string {
  return ai.map(({ kind, n }) => `${AI_WORDS[kind][0]} ${n} ${AI_WORDS[kind][1]}`).join('、');
}

/** 世界作品的几行:打开时停在、历史推到、那年的国家、民族、AI 写的、打开要下载;没有的不列 */
export function worldRows(it: GalleryItem): Row[] {
  const f = it.facts ?? {};
  const rows: Row[] = [];
  if (f.year !== undefined) rows.push(['打开时停在', `第 ${f.year} 年`]);
  if (f.endYear !== undefined) rows.push(['历史推到', `第 ${f.endYear} 年`]);
  if (f.year !== undefined && f.states !== undefined) rows.push(['那年的国家', `${f.states} 个`]);
  if (f.year !== undefined && f.peoples !== undefined) rows.push(['民族', `${f.peoples} 个`]);
  if (f.ai?.length) rows.push(['AI 写的', aiText(f.ai)]);
  if (it.full) rows.push(['打开要下载', sizeText(it.full.bytes)]);
  return rows;
}

/** 新建参数窗那几格各要存档参数里的哪几样(老地图缺后来才加的参数:那一格不列,不拿现在的默认值顶上) */
const NEEDS: Record<string, string[]> = { 种子: ['seed'], 陆地比例: ['landFraction'], 大陆数量: ['continents'], 板块数量: ['plates'], 造山强度: ['mountains'], '气温、降水': ['temperature', 'rainfall'], 精细度: ['cells'] };

/** 地图作品的存档:参数那几格 + 改过地形;读不了 = 照打开地图失败时的说法 */
export function mapRows(save: unknown): { rows: Row[] } | { error: string } {
  const p = parseSave(JSON.stringify(save ?? null));
  if (!p.ok) return { error: `打不开这张地图：${briefError(p.error)}` };
  const raw = save && typeof save === 'object' ? (save as { params?: unknown }).params : undefined;
  const has = (k: string) => !!raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>)[k] === 'number';
  const sp = p.save.params;
  const rows = presetRows({ name: '', params: sp, seed: sp.seed }).filter(([k]) => NEEDS[k]?.every(has));
  const e = p.save.edits;
  if (e.terrain.length || e.sketch) rows.push(['改过地形', '作者用笔改过']);
  return { rows };
}

/** 等多久再试:服务器给了秒数写约几分钟(不到 1 分钟写约 1 分钟),没给写请稍后 */
export function waitText(after: unknown): string {
  const s = Number(after);
  return Number.isFinite(s) && s > 0 ? `约 ${Math.max(1, Math.ceil(s / 60))} 分钟后再试。` : '请稍后再试。';
}

/** 下载世界文件失败说什么;again = 能「再试一次」(撤下了、取到了读不了的不能) */
export function pullTrouble(e: unknown): { error: string; again: boolean } {
  if (isWorkGone(e)) return { error: '这个作品已经撤下了', again: false };
  if (e instanceof ServerError) {
    if (e.code === 'network') return { error: '连不上服务器，请检查网络后再试。', again: true };
    if (e.status === 429 || e.code === 'rate-limit') return { error: `下载得太频繁了，${waitText(e.data.retryAfter)}`, again: true };
    if (e.status === 503 || e.code === 'busy') return { error: `服务器这会儿太忙，${waitText(e.data.retryAfter)}`, again: true };
    // 取到了,放进世界仓库时读不了(坏了、来自更新的版本……):照打开失败时各自的说法
    if (e.status === 0) return { error: e.message, again: false };
  }
  return { error: e instanceof Error ? e.message : String(e), again: true };
}

/** 字大概占多宽(13.5px:汉字一个字宽,数字、字母、空格约半个) */
const textWidth = (t: string) => [...t].reduce((a, c) => a + (c.charCodeAt(0) < 256 ? 0.55 : 1), 0) * 13.5;

/** 排成两列:落单的、手机上半格放不下的占满一行 */
function lay(rows: Row[], phone: boolean) {
  const half = phone ? (Math.min(window.innerWidth, 560) - 32) / 2 - 24 : Infinity;
  const lines: Row[][] = [];
  let open = false;
  for (const r of rows) {
    if (textWidth(r[0]) + textWidth(r[1]) + 10 > half) {
      lines.push([r]);
      open = false;
    } else if (open) {
      lines[lines.length - 1].push(r);
      open = false;
    } else {
      lines.push([r]);
      open = true;
    }
  }
  return lines.flatMap((l, i) => l.map((row, j) => ({ row, wide: l.length === 1, left: l.length === 2 && j === 0, end: i === lines.length - 1 })));
}

function Cells({ rows, phone, rules }: { rows: Row[]; phone: boolean; rules?: ReactNode }) {
  if (!rows.length && !rules) return null;
  return (
    <div className={`acct-grp gl-pp gl-wpp${rules ? ' rl' : ''}`} data-testid="work-rows">
      {lay(rows, phone).map(({ row: [k, v], wide, left, end }) => (
        <div className={`acct-gr${wide ? ' wide' : left ? ' left' : ''}${end ? ' end' : ''}`} key={k}>
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
      {rules}
    </div>
  );
}

function Ghost({ n }: { n: number }) {
  return (
    <div className="acct-grp gl-pp ghost" aria-busy="true">
      {Array.from({ length: n }, (_, i) => (
        <div className="acct-gr" key={i}>
          <i className="gl-bar" style={{ width: '40%' }} />
        </div>
      ))}
    </div>
  );
}

type Got = { item: GalleryItem } | { error: string; gone?: boolean } | null;

/** 窗一开去取作品(打开网址时已经取好了的不再取);关了窗才回来的扔掉 */
function useWork(w: GalleryWork, item: GalleryItem | undefined): Got {
  const [got, setGot] = useState<Got>(() => (item ? { item } : null));
  useEffect(() => {
    if (item) return;
    let alive = true;
    fetchWork(w.id).then(
      (it) => alive && setGot(it.kind === w.kind ? { item: it } : { error: '服务器返回的内容看不懂' }),
      (e: unknown) => {
        if (!alive) return;
        if (isWorkGone(e)) {
          setGot({ error: '这个作品已经撤下了', gone: true });
          // 作品墙上的卡片跟着去掉
          loadGallery(true);
        } else setGot({ error: e instanceof ServerError && e.code === 'network' ? '连不上服务器，请检查网络后再试。' : e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      alive = false;
    };
  }, [w.id, w.kind, item]);
  return got;
}

function Shell({
  phone,
  w,
  tag,
  testId,
  onClose,
  report,
  setReport,
  children,
  foot,
}: {
  phone: boolean;
  w: GalleryWork;
  tag: string;
  testId: string;
  onClose: () => void;
  /** 举报窗开着 */
  report: boolean;
  setReport: (on: boolean) => void;
  children: ReactNode;
  foot: ReactNode;
}) {
  const g = useGallery();
  const reported = g.rev >= 0 && wasReported(w.id);
  const cover = coverUrl(w.id);
  const head = (
    <div className="gl-pcover" style={cover ? { backgroundImage: `url("${cover}")` } : undefined}>
      <button className="acct-x" onClick={onClose} title="关闭" aria-label="关闭">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
  return (
    <Dialog phone={phone} label={w.title || tag} width={560} onClose={onClose} head={head} testId={testId} className="gl-pdlg gl-wdlg">
      <div className="acct-head">
        <h2>{w.title || '未命名'}</h2>
      </div>
      <div className="acct-body">
        <div className="gl-who">
          <span className="gl-tag">{tag}</span>
          {w.by}
        </div>
        {w.blurb && <p className="gl-pblurb">{w.blurb}</p>}
        {children}
      </div>
      <div className="acct-foot">
        <button className="acct-btn gl-ghost" data-act="gallery-report" disabled={reported} onClick={() => setReport(true)}>
          <Icon name={reported ? 'check' : 'flag'} size={15} />
          {reported ? '已举报' : '举报'}
        </button>
        <span className="acct-sp" />
        {foot}
      </div>
      {report && <ReportDialog phone={phone} work={w} onClose={() => setReport(false)} />}
    </Dialog>
  );
}

type Pull = null | { done: number; total: number } | { error: string; again: boolean };

export interface WorkDialogProps {
  phone: boolean;
  w: GalleryWork;
  /** 打开网址时已经取好了的 */
  item?: GalleryItem;
  onClose: () => void;
  /** 世界:取完了,打开它(只存了存档的旧作品没有 file) */
  onWorld: (it: GalleryItem, file?: SharedWorld) => void;
  /** 地图:看看这颗星球 */
  onPlanet: (it: GalleryItem) => void;
  /** 地图:用这张地图打造文明 */
  onMapCiv: (it: GalleryItem) => void;
}

export function WorkDialog(p: WorkDialogProps) {
  return p.w.kind === 'map' ? <MapDialog {...p} /> : <WorldDialog {...p} />;
}

function WorldDialog({ phone, w, item, onClose, onWorld }: WorkDialogProps) {
  const got = useWork(w, item);
  const ok = got && 'item' in got ? got.item : null;
  const [pull, setPull] = useState<Pull>(null);
  const [report, setReport] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const stop = () => {
    ctl.current?.abort();
    ctl.current = null;
  };
  useEffect(() => stop, []);
  const pulling = pull && 'done' in pull ? pull : null;
  const cancel = () => {
    stop();
    setPull(null);
  };
  // 下载时按 Esc:停下下载,窗还开着(先于窗口自己的 Esc;举报窗开着时不管)
  const escRef = useRef<(() => void) | null>(null);
  escRef.current = pulling && !report ? cancel : null;
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !escRef.current) return;
      e.stopImmediatePropagation();
      escRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const close = () => {
    stop();
    onClose();
  };
  const start = async () => {
    if (!ok) return;
    if (!ok.full) {
      const r = parseSave(JSON.stringify(ok.save ?? null));
      return r.ok ? onWorld(ok) : setPull({ error: briefError(r.error), again: false });
    }
    stop();
    const c = new AbortController();
    ctl.current = c;
    const total = ok.full.bytes;
    let shown = '';
    setPull({ done: 0, total });
    try {
      const m = await import('./fullWorldPull');
      if (ctl.current !== c) return;
      const file = await m.pullWork(
        ok.id,
        total,
        (done, all) => {
          const t = all || total;
          // 字或进度条变了才重画(大文件一读一小块)
          const key = `${pairText(done, t)}|${Math.floor((done / t) * 400)}`;
          if (ctl.current !== c || key === shown) return;
          shown = key;
          setPull({ done, total: t });
        },
        c.signal,
      );
      if (ctl.current !== c) return;
      ctl.current = null;
      onWorld(ok, file);
    } catch (e) {
      if (ctl.current !== c) return;
      ctl.current = null;
      setPull(pullTrouble(e));
      if (isWorkGone(e)) loadGallery(true);
    }
  };
  const rs = ok?.rules ?? w.rules;
  const rules = rs && rulesUiOn() ? <RulesRow name={rs.name} changed={rs.changed} save={ok?.save} onClose={close} /> : undefined;
  const failed = pull && 'error' in pull ? pull : null;
  const trouble = got && 'error' in got ? got.error : failed?.error;
  const foot = pulling ? (
    <>
      <button className="acct-btn" data-act="gallery-pull-cancel" onClick={cancel}>
        取消
      </button>
      <button className="acct-btn lg gl-dl" disabled data-testid="work-pull">
        <span className="spin" aria-hidden="true" />
        正在取 {pairText(pulling.done, pulling.total)}
        <i style={{ width: `${pulling.total ? Math.min(100, (pulling.done / pulling.total) * 100) : 0}%` }} />
      </button>
    </>
  ) : (
    <button className="acct-btn lg blue" data-act="gallery-open-world" disabled={!ok || (!!failed && !failed.again)} onClick={() => void start()}>
      {failed?.again ? '再试一次' : '打开这个世界'}
    </button>
  );
  return (
    <Shell phone={phone} w={w} tag="世界" testId="gallery-world" onClose={close} report={report} setReport={setReport} foot={foot}>
      {ok ? <Cells rows={worldRows(ok)} phone={phone} rules={rules} /> : !got && <Ghost n={6} />}
      {trouble && (
        <p className="acct-err" role="alert">
          {trouble}
        </p>
      )}
      {!(got && 'gone' in got && got.gone) && <p className="acct-small">打开以后只是看看；改了才另存一份进我的世界。</p>}
    </Shell>
  );
}

/**
 * 世界用的规则(改了几项、名字)。只存了存档的旧作品手上有那一套,点了看(同新建参数窗,先关掉这个窗);
 * 带世界文件的,下载之前手上只有摘要,不能点
 */
function RulesRow({ name, changed, save, onClose }: { name: string; changed: number; save: unknown; onClose: () => void }) {
  const set = useMemo(() => {
    if (!save) return undefined;
    const r = parseSave(JSON.stringify(save));
    return r.ok ? r.save.edits.rules : undefined;
  }, [save]);
  const v = (
    <>
      <small>改了 {changed} 项</small>
      {name}
    </>
  );
  if (!set)
    return (
      <div className="acct-gr gl-prl" data-testid="work-rules">
        <span className="k">规则</span>
        <span className="v">{v}</span>
      </div>
    );
  return (
    <button
      className="acct-gr gl-prl"
      data-act="gallery-work-rules"
      onClick={() => {
        onClose();
        openRulesSheet({ kind: 'world', rules: set });
      }}
    >
      <span className="k">规则</span>
      <span className="v">
        {v}
        <Icon name="chevron" size={14} />
      </span>
    </button>
  );
}

function MapDialog({ phone, w, item, onClose, onPlanet, onMapCiv }: WorkDialogProps) {
  const got = useWork(w, item);
  const ok = got && 'item' in got ? got.item : null;
  const [report, setReport] = useState(false);
  const read = useMemo(() => (ok ? mapRows(ok.save) : null), [ok]);
  const rows = read && 'rows' in read ? read.rows : null;
  const trouble = got && 'error' in got ? got.error : read && 'error' in read ? read.error : '';
  const usable = !!ok && !!rows;
  const foot = (
    <>
      <button className="acct-btn" data-act="gallery-look-planet" disabled={!usable} onClick={() => ok && onPlanet(ok)}>
        看看这颗星球
      </button>
      <button className="acct-btn lg blue" data-act="gallery-map-civ" disabled={!usable} onClick={() => ok && onMapCiv(ok)}>
        用这张地图打造文明
      </button>
    </>
  );
  return (
    <Shell phone={phone} w={w} tag="地图" testId="gallery-map-dlg" onClose={onClose} report={report} setReport={setReport} foot={foot}>
      {rows ? <Cells rows={rows} phone={phone} /> : !got && <Ghost n={8} />}
      {trouble && (
        <p className="acct-err" role="alert">
          {trouble}
        </p>
      )}
      {!(got && 'gone' in got && got.gone) && <p className="acct-small">没有文明：拿去用就是在这张地图上从第 0 年起打造。</p>}
    </Shell>
  );
}
