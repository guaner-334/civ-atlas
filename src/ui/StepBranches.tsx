/**
 * 逐年推演的支线(数据在 gen/stepwise.ts 的 branchList、renameBranch、deleteBranch,格式见 gen/edits.ts 文件头"支线"):
 *
 *   StepBranches            侧栏 / 手机世界卡片「这个故事」下面一组「支线」,每支一行:圆点、名字(在用的这支标"在这支")、
 *                           从第几年分出演到第几年、最后一件大事、行尾「…」。只有一支时不出现。
 *                           点别的一行 = 切过去(App 的 switchBranch:在后台照那一支从第 0 年重推,那一行转圈带进度,
 *                           顶上提示条带进度;算的时候地图还是原来那支,照样能拖能点)。
 *                           「…」:在用的这支 = 改名、存回推演模式、删除(灰着,在用的这支不能删);别的支 = 切到这一支、改名、删除(先问一句)。
 *                           改名就地改:回车改好,Esc 不改
 *   StepBranchDeleteDialog  删掉一支之前先问一句:删掉哪一段历史、几条干预,删了找不回来
 *   branchNote              切走、重新演绎时给原来那支记下的"最后一件大事"(列表里显示)
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Civ } from '../gen/civ/types';
import type { ChronicleEntry } from '../gen/civ/chronicle';
import { fullChronicle } from '../gen/civ/religionText';
import { BRANCH_NAME_MAX, BRANCH_NOTE_MAX, type Intervention } from '../gen/edits';
import { branchList, deleteBranch, renameBranch, type BranchInfo } from '../gen/stepwise';
import { eraText, spaced, yearAt, yearFull, yearShort, yearShortAt, type Era } from '../gen/era';
import { getEdits, putEditsQuiet, useEdits, useEra } from './editsStore';
import { openStepDialog, stepwiseActions, useStepwise, type StepSwitch } from './stepwiseStore';
import { REVIEW_WEIGHT } from './stepwisePlan';
import { entryWeight } from './timelineLayout';
import { useToastProgress } from './toastStore';
import { interventionText } from './Interventions';
import { useNarrow } from './device';
import { Icon, type IconName } from './icons';
import './stepBranches.css';

// ---------------------------------------------------------------------------
// 文字

/** 一支的名字:没起名的叫"第 N 支"(N = 编号) */
export function branchLabel(b: Pick<BranchInfo, 'id' | 'name'>): string {
  return b.name || `第 ${b.id} 支`;
}

/** 写进句子里的名字:起了名的加书名号,"第 N 支"不加 */
export function branchRef(b: Pick<BranchInfo, 'id' | 'name'>): string {
  return b.name ? `「${b.name}」` : `第 ${b.id} 支`;
}

/** 汉字的几(一到十,再多写数字) */
function cnCount(n: number): string {
  return n === 2 ? '两' : n >= 1 && n <= 10 ? '一二三四五六七八九十'[n - 1] : String(n);
}

/**
 * 一支从哪来、演到哪:"1500 年起演绎，演到 1525 年""1510 年从第 1 支分出，演到 1550 年";
 * full = 弹窗里的写法("从第 1500 年起演绎，演到第 1525 年")
 */
export function branchSpan(b: BranchInfo, all: readonly BranchInfo[], era: Era | null | undefined, full = false): string {
  const y = (n: number) => (full ? yearFull(n, era) : yearAt(n, era));
  const to = `演到${spaced(y(b.year))}`;
  if (b.forkAt === undefined) return `${full ? '从' : ''}${y(b.playFrom)}起演绎，${to}`;
  const parent = b.forkOf !== undefined && b.forkOf !== b.id ? all.find((x) => x.id === b.forkOf) : undefined;
  return `${y(b.forkAt)}${parent ? `从${branchRef(parent)}` : ''}分出，${to}`;
}

/** 这一段历史里最后一件大事(停一下时卡片会列的那么大),写成"1523 卢纳维亚帝国始入青铜时代";没有 = undefined */
function lastEntry(civ: Civ, before: number): ChronicleEntry | null {
  let e: ChronicleEntry | null = null;
  for (const x of fullChronicle(civ)) if (x.year < before && entryWeight(x) >= REVIEW_WEIGHT && (!e || x.year > e.year || (x.year === e.year && x.id > e.id))) e = x;
  return e;
}

/** 切走、重新演绎时给原来那支记下的最后一件大事("年份 正文",最多 BRANCH_NOTE_MAX 个字,长了截断带"…");没有 = undefined */
export function branchNote(civ: Civ | null, now: number): string | undefined {
  if (!civ || !civ.viable) return undefined;
  const e = lastEntry(civ, now);
  if (!e) return undefined;
  const cs = [...`${Math.floor(e.year)} ${e.text}`];
  return cs.length > BRANCH_NOTE_MAX ? `${cs.slice(0, BRANCH_NOTE_MAX - 1).join('')}…` : cs.join('');
}

/** 记下的最后一件大事拆成年份和正文(年份按纪年写;认不出年份的整句当正文,y = null) */
function splitNote(s: string, era: Era | null | undefined): { y: number | null; year: string; text: string } {
  const m = /^(\d+) (.+)$/.exec(s);
  return m ? { y: Number(m[1]), year: yearShort(Number(m[1]), era), text: m[2] } : { y: null, year: '', text: s };
}

/** 这一支自己加的干预(分出来以后下的;最早的那一支 = 起演以后下的) */
function ownCommands(b: BranchInfo): Intervention[] {
  const at = b.forkAt ?? b.playFrom;
  return b.play.commands.filter((v) => v.from >= at);
}

// ---------------------------------------------------------------------------
// 「…」菜单(挂在按钮下面、右对齐;放不下就往上翻)。挂在 body 上:侧栏的分组会裁掉伸出去的部分

interface MenuItemDef {
  icon: IconName;
  text: string;
  act: string;
  note?: string;
  disabled?: boolean;
  danger?: boolean;
  sep?: boolean;
  onClick?: () => void;
}

function BranchMenu({ anchor, items, onClose }: { anchor: HTMLElement; items: readonly MenuItemDef[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const r = anchor.getBoundingClientRect();
    const w = m.offsetWidth;
    const h = m.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
    const below = r.bottom + 6;
    setAt({ left, top: below + h > window.innerHeight - 8 ? Math.max(8, r.top - 6 - h) : below });
  }, [anchor]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);
  return createPortal(
    // 挂在 body 上,React 里的点击照样冒泡到那一行(点一行 = 切过去):在这里拦住
    <div className="pm-menu br-menu" ref={ref} role="menu" style={at ? { left: at.left, top: at.top } : { visibility: 'hidden' }} onClick={(e) => e.stopPropagation()}>
      {items.map((x, i) =>
        x.sep ? (
          <hr key={i} className="pm-sep" />
        ) : (
          <button
            key={i}
            className={`pm-item${x.danger ? ' danger' : ''}`}
            role="menuitem"
            data-act={x.act}
            disabled={x.disabled}
            onClick={() => {
              onClose();
              x.onClick?.();
            }}
          >
            <Icon name={x.icon} size={16} />
            <span className="pm-text">{x.text}</span>
            {x.note && <small className="pm-note">{x.note}</small>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// 列表

/** 切换中那一行的进度(顶上提示条的那一份;还没出来时先给一点,看得出在走) */
function SwitchBar() {
  const p = useToastProgress('resim');
  return (
    <span className="br-bar">
      <i style={{ width: `${Math.round(Math.max(0.04, p ?? 0.04) * 100)}%` }} />
    </span>
  );
}

function RenameField({ b, onDone }: { b: BranchInfo; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const i = ref.current;
    if (!i) return;
    i.focus();
    i.setSelectionRange(i.value.length, i.value.length);
  }, []);
  const commit = (ok: boolean) => {
    if (done.current) return;
    done.current = true;
    const v = ref.current?.value.trim() ?? '';
    // 原样没改("第 N 支"也算没起名)= 不动
    if (ok && v !== branchLabel(b)) {
      const e = renameBranch(getEdits(), b.id, v === `第 ${b.id} 支` ? '' : v);
      if (e) putEditsQuiet(e);
    }
    onDone();
  };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      commit(false);
    }
  };
  return (
    <input
      ref={ref}
      className="br-edit"
      defaultValue={branchLabel(b)}
      maxLength={BRANCH_NAME_MAX}
      aria-label="支线的名字"
      data-act="branch-rename-input"
      onKeyDown={onKey}
      onBlur={() => commit(true)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function BranchRow({
  b,
  all,
  on,
  sw,
  last,
  editing,
  setEditing,
  era,
}: {
  b: BranchInfo;
  all: readonly BranchInfo[];
  /** 列表里标"在这支"的(切换中 = 原来那支) */
  on: boolean;
  sw: StepSwitch | null;
  last: string | undefined;
  editing: boolean;
  setEditing: (id: number | null) => void;
  era: Era | null | undefined;
}) {
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const busy = sw?.to === b.id;
  const go = () => {
    if (on || sw || editing) return;
    stepwiseActions()?.switchBranch(b.id);
  };
  const items: MenuItemDef[] = on
    ? [
        { icon: 'rename', text: '改名', act: 'branch-rename', onClick: () => setEditing(b.id) },
        { icon: 'save', text: '存回推演模式…', act: 'branch-save', onClick: () => openStepDialog({ kind: 'save' }) },
        { icon: 'trash', text: '', act: '', sep: true },
        { icon: 'trash', text: '删除这一支', act: 'branch-delete', disabled: true, note: '在用的这支不能删' },
      ]
    : [
        { icon: 'swap', text: '切到这一支', act: 'branch-switch', onClick: go },
        { icon: 'rename', text: '改名', act: 'branch-rename', onClick: () => setEditing(b.id) },
        { icon: 'trash', text: '', act: '', sep: true },
        { icon: 'trash', text: '删除这一支…', act: 'branch-delete', danger: true, onClick: () => openStepDialog({ kind: 'branch-delete', id: b.id }) },
      ];
  const note = last ? splitNote(last, era) : null;
  let title: ReactNode;
  if (editing) title = <RenameField b={b} onDone={() => setEditing(null)} />;
  else
    title = (
      <b>
        <span className="br-name">{branchLabel(b)}</span>
        {on && <em>在这支</em>}
        {busy && (
          <em className="br-busy">
            <i className="br-spin" />
            正在切过去
          </em>
        )}
      </b>
    );
  return (
    <div
      className={`sb-row br-row${on ? ' on' : ''}${sw ? ' wait' : ''}`}
      role="button"
      tabIndex={on ? -1 : 0}
      aria-current={on || undefined}
      data-branch={b.id}
      data-act={on ? undefined : 'branch-go'}
      onClick={go}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          go();
        }
      }}
    >
      <span className="br-dot" />
      <span className="sb-row-main">
        {title}
        <small className={editing ? 'br-edit-hint' : undefined}>{editing ? '回车改好，Esc 不改' : branchSpan(b, all, era)}</small>
        {note && (
          <small className="br-last">
            {note.year && <span>{note.year}</span>}
            <i>{note.text}</i>
          </small>
        )}
      </span>
      <button
        ref={moreRef}
        className={`br-more${menu ? ' on' : ''}`}
        aria-label="更多"
        aria-haspopup="menu"
        aria-expanded={menu}
        data-act="branch-more"
        disabled={!!sw}
        onClick={(e) => {
          e.stopPropagation();
          setMenu((m) => !m);
        }}
      >
        <Icon name="more" size={17} />
      </button>
      {menu && moreRef.current && <BranchMenu anchor={moreRef.current} items={items} onClose={() => setMenu(false)} />}
      {busy && <SwitchBar />}
    </div>
  );
}

/** 侧栏 / 手机世界卡片里「支线」一组;只有一支时不出现 */
export function StepBranches({ civ }: { civ: Civ | null }) {
  const phone = useNarrow();
  const edits = useEdits();
  const era = useEra();
  const s = useStepwise();
  const sw = s.switching;
  const all = useMemo(() => branchList(edits), [edits]);
  const [editing, setEditing] = useState<number | null>(null);
  const cur = all.find((b) => b.current);
  // 在用的这支的最后一件大事按地图上这份历史写;切换中修改里已经是切到的那一支,地图上还是原来那支:那一支用它切走时记下的
  const now = cur?.year ?? 0;
  const live = useMemo(() => (civ && !sw ? branchNote(civ, now) : undefined), [civ, now, sw]);
  if (all.length < 2) return null;
  const onId = sw ? sw.from : cur?.id;
  return (
    <section className="sb-sec br-sec" data-step-branches>
      <div className="sb-sec-head">
        <span>支线</span>
        <em>{all.length} 支</em>
      </div>
      <div className="sb-group">
        {all.map((b) => (
          <BranchRow
            key={b.id}
            b={b}
            all={all}
            on={b.id === onId}
            sw={sw}
            last={b.current ? (sw ? sw.last : live) : b.last}
            editing={editing === b.id}
            setEditing={setEditing}
            era={era}
          />
        ))}
      </div>
      <div className="br-note">{phone ? '点一支就切过去，要从头重算几秒。存回推演模式存的是在用的这一支。' : '点一支就切过去，要从头重算几秒，算的时候地图照样能拖。存回推演模式存的是在用的这一支。'}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 删掉一支之前先问一句

/** 写出几条干预(再多写"等 N 条") */
const DELETE_LIST_MAX = 4;

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

export function StepBranchDeleteDialog({ phone, civ }: { phone: boolean; civ: Civ | null }) {
  const s = useStepwise();
  if (s.dialog?.kind !== 'branch-delete' || !civ) return null;
  return <DeleteDialog phone={phone} civ={civ} id={s.dialog.id} />;
}

function DeleteDialog({ phone, civ, id }: { phone: boolean; civ: Civ; id: number }) {
  const edits = useEdits();
  const era = useEra();
  const all = useMemo(() => branchList(edits), [edits]);
  const b = all.find((x) => x.id === id && !x.current);
  const close = () => openStepDialog(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      openStepDialog(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  // 那一支已经没了 / 切成了在用的:不问了
  useEffect(() => {
    if (!b) openStepDialog(null);
  }, [b]);
  if (!b) return null;
  const go = () => {
    close();
    const e = deleteBranch(getEdits(), b.id);
    if (e) putEditsQuiet(e);
  };
  const parent = b.forkOf !== undefined && b.forkOf !== b.id ? all.find((x) => x.id === b.forkOf) : undefined;
  const a = b.forkAt ?? b.playFrom;
  const lead =
    b.forkAt === undefined
      ? `这一支从${yearFull(b.playFrom, era)}起演绎，演到${spaced(yearFull(b.year, era))}。`
      : `这一支${parent ? `从${branchRef(parent)}的` : ''}${yearFull(b.forkAt, era)}分出，演到${spaced(yearFull(b.year, era))}。`;
  const cmds = ownCommands(b);
  const texts = cmds.map((v) => `${yearShortAt(v.from, era)}${eraText(interventionText(civ, v), era)}`);
  const ivSmall = texts.length > DELETE_LIST_MAX ? `${texts.slice(0, DELETE_LIST_MAX).join('；')}……等 ${texts.length} 条` : texts.join('；');
  const note = b.last ? splitNote(b.last, era) : null;
  // 最后一件大事(去掉开头的【干预】这类小标签)
  const histSmall = `${note ? `${note.y !== null ? yearShortAt(note.y, era) : ''}${note.text.replace(/^【[^】]*】/, '')}……` : ''}编年史里这一段`;
  const why = `删了找不回来。别的${cnCount(all.length - 1)}支照旧${parent ? `；${branchRef(parent)}${yearFull(b.forkAt!, era)}以前的事本来就在它自己那里，不受影响` : ''}。`;
  const rows = (
    <div className={`sw-grp${phone ? ' white' : ''}`}>
      {b.year > a && (
        <div className="sw-r top">
          <span className="sw-r-main">
            <span>{eraText(`第 ${a}–${b.year} 年`, era)}演绎出来的历史</span>
            <small>{histSmall}</small>
          </span>
          <span className="sw-r-side br-side">{b.year - a} 年</span>
        </div>
      )}
      {cmds.length > 0 && (
        <div className="sw-r top">
          <span className="sw-r-main">
            <span>这一支加的干预</span>
            <small>{ivSmall}</small>
          </span>
          <span className="sw-r-side br-side">{cmds.length} 条</span>
        </div>
      )}
    </div>
  );
  const head = `删掉「${branchLabel(b)}」？`;
  const hasRows = b.year > a || cmds.length > 0;
  if (phone)
    return (
      <>
        <div className="sw-scrim" onClick={close} />
        <section className="sw-psheet" role="dialog" aria-label={head} onPointerDown={stop} onClick={stop}>
          <div className="sw-grip" />
          <div className="sw-psheet-top">
            <b>{head}</b>
          </div>
          <div className="sw-lead">{lead}</div>
          <div className="sw-psheet-body">
            {hasRows && rows}
            <div className="sw-why">{why}</div>
          </div>
          <div className="sw-psheet-btns">
            <button className="sw-big" data-act="branch-delete-cancel" onClick={close}>
              取消
            </button>
            <button className="sw-big pri br-danger" data-act="branch-delete-go" onClick={go}>
              删掉这一支
            </button>
          </div>
        </section>
      </>
    );
  return (
    <>
      <div className="sw-scrim" onClick={close} />
      <div className="sw-dlg-wrap">
        <div className="sw-dlg sw-save-dlg br-del-dlg" role="dialog" aria-label={head} onPointerDown={stop} onClick={stop}>
          <h2>{head}</h2>
          <p className="sw-lead">{lead}</p>
          <div className="sw-sec first">
            {hasRows && rows}
            <div className="sw-why">{why}</div>
          </div>
          <div className="sw-foot save">
            <span className="sw-sp" />
            <button className="sw-btn2" data-act="branch-delete-cancel" onClick={close}>
              取消
            </button>
            <button className="sw-btn2 pri br-danger" data-act="branch-delete-go" onClick={go}>
              删掉这一支
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
