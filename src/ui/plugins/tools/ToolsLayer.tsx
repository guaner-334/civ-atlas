/**
 * 插件的工具:「工具」按钮点开的菜单(电脑在按钮左边弹出,手机从下面升起)、插件卡(在卡片的位置,内容是插件交来的面板)、
 * 工具模式(顶上那条和放标记时一样的提示条,前面固定「插件」两个字;点、框由网站处理,插件只拿到结果)。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getPlugin, listPlugins, removePlugin, type InstalledPlugin } from '../../../plugin/pluginStore';
import { clearSelection, useSelection } from '../../civView';
import { copyText } from '../../clipboard';
import { useCoarse } from '../../device';
import { noteDismiss } from '../../dismissClick';
import { Icon } from '../../icons';
import { usePolityPick } from '../../Interventions';
import { getMarkUi, subscribeMarkUi } from '../../markStore';
import { setSheet } from '../../panelStore';
import { peekSide } from '../../sideStore';
import { useRelief } from '../../terrain3dStore';
import { clearToast, showToast } from '../../toastStore';
import { PuzzleIcon, openPlugins, usePluginsOpen } from '../entry';
import { PluginIcon, useIcons } from '../pluginIcons';
import { isTool, versionLabel } from '../pluginText';
import { setToolCloser, toolSlot, toolsMenu, type ToolsProps } from '../toolsState';
import { verdictOf } from '../verdict';
import { BoxPick, cellsInBox } from './BoxPick';
import { PanelView } from './PanelView';
import { cancelPick, dismissRefusal, panelAction, pickBox, startTool, stopTool, toolRun, type ToolRun, type ToolTrouble } from './toolRun';
import './tools.css';

export default function ToolsLayer(p: ToolsProps) {
  const env = useRef(p);
  env.current = p;
  const run = toolRun.use();
  const menu = toolsMenu.use();
  const slot = toolSlot.use();
  const coarse = useCoarse();
  const pluginsOpen = usePluginsOpen();

  useEffect(() => {
    setToolCloser(stopTool);
    return () => {
      setToolCloser(null);
      toolsMenu.set(false);
    };
  }, []);
  // 不能用工具了(回放、导出、地区图……)、换了世界:插件停下
  useEffect(() => {
    if (!p.active) {
      stopTool();
      toolsMenu.set(false);
    }
  }, [p.active]);
  useEffect(() => () => stopTool(), [p.root]);
  // 侧栏收起着:插件卡弹出来(选中的东西关掉以后又轮到插件卡)
  const cardOn = !!run;
  const sel = useSelection().sel;
  useEffect(() => {
    if (!p.phone) peekSide(cardOn);
  }, [cardOn, sel, p.phone]);
  // 插件页里关掉、删掉、换了版本的:关上插件页以后停下
  const runId = run?.dev ? undefined : run?.plugin.id;
  const runSum = run?.plugin.current.sum;
  useEffect(() => {
    if (pluginsOpen || !runId) return;
    let live = true;
    getPlugin(runId).then(
      (pl) => live && (!pl || !pl.on || pl.current.sum !== runSum) && stopTool(),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [pluginsOpen, runId, runSum]);

  // 开始放标记、在地图上选目标、框地区:不再请用的人点
  useEffect(() => subscribeMarkUi(() => getMarkUi().placing && cancelPick()), []);
  const polityPick = usePolityPick();
  useEffect(() => {
    if (polityPick) cancelPick();
  }, [polityPick]);
  const relief = useRelief().phase;
  useEffect(() => {
    if (relief !== 'off') cancelPick();
  }, [relief]);

  // Esc:收起菜单;正在点就不点了(插件页开着时归插件页)
  const pick = run?.pick ?? null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || pluginsOpen) return;
      if (toolsMenu.get()) toolsMenu.set(false);
      else if (toolRun.get()?.pick) cancelPick();
      else return;
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pluginsOpen]);

  // 工具模式:顶上那一条
  const name = run?.plugin.current.manifest.name ?? '';
  const hasBox = !!run?.box;
  useEffect(() => {
    if (!pick) return clearToast('plugin-pick');
    const box = pick.kind === 'box';
    const more = box ? (hasBox ? '拖框里面挪动，拖边角改大小' : '在地图上拖出一个框') : p.phone ? '' : '拖地图、缩放照常；点的位置由网站交给插件';
    showToast({
      id: 'plugin-pick',
      kind: 'info',
      tag: '插件',
      text: `${name}：${pick.hint || (box ? '框一片地方' : '点地图上的一处')}`,
      ...(more ? { more: [more] } : {}),
      action: { label: coarse ? '退出' : '退出 · Esc', act: 'plugin-pick-exit', onClick: cancelPick },
    });
  }, [pick, hasBox, name, coarse, p.phone]);
  useEffect(() => () => clearToast('plugin-pick'), []);

  const start = (pl: InstalledPlugin) => {
    toolsMenu.set(false);
    clearSelection();
    setSheet('half');
    void startTool(pl, () => env.current);
  };
  const stage = p.stage.current;
  return (
    <>
      {menu && <ToolsMenu phone={p.phone} onStart={start} />}
      {run && slot && createPortal(<ToolCard run={run} phone={p.phone} onAgain={() => (run.dev ? run.dev.again() : start(run.plugin))} />, slot)}
      {pick?.kind === 'box' &&
        stage &&
        createPortal(
          <BoxPick
            key={pick.hint + String(hasBox)}
            world={p.world}
            api={p.api}
            box={run?.box ?? null}
            onLost={cancelPick}
            onDone={(b) => {
              const x0 = (((b.cx - b.w / 2) % p.world.width) + p.world.width) % p.world.width;
              pickBox(b, { x0, y0: b.cy - b.h / 2, x1: x0 + b.w, y1: b.cy + b.h / 2, cells: cellsInBox(p.world, b) });
            }}
          />,
          stage,
        )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 工具菜单

function ToolsMenu({ phone, onStart }: { phone: boolean; onStart: (p: InstalledPlugin) => void }) {
  const [list, setList] = useState<InstalledPlugin[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<CSSProperties | undefined>(undefined);
  const icons = useIcons(list);
  useEffect(() => {
    let live = true;
    listPlugins().then(
      (l) => live && setList(l),
      () => live && setList([]),
    );
    return () => {
      live = false;
    };
  }, []);
  // 电脑:在「工具」按钮左边,底边和按钮齐
  useLayoutEffect(() => {
    if (phone) return;
    const b = document.querySelector('.map-controls [data-act=tools]')?.getBoundingClientRect();
    if (b) setAt({ right: window.innerWidth - b.left + 12, bottom: window.innerHeight - b.bottom });
  }, [phone, list]);
  // 点外面收起(点在地图上的这一下只收起菜单)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (ref.current?.contains(t) || t?.closest?.('[data-act=tools]')) return;
      toolsMenu.set(false);
      noteDismiss(e);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);
  if (!list) return null;
  const tools = list.filter((x) => x.on && isTool(x.current.manifest));
  const manage = () => {
    toolsMenu.set(false);
    openPlugins();
  };
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  const empty = !tools.length;
  const head = phone ? (
    <div className="plg-mh">
      <b>工具</b>
      {!empty && <small>插件带来的</small>}
    </div>
  ) : (
    <div className="plg-mh">{empty ? '工具' : '工具（插件带来的）'}</div>
  );
  const manageLabel = list.length ? '管理插件…' : '去插件页装…';
  let body: ReactNode;
  if (empty)
    body = (
      <>
        <div className="plg-emp">
          <span className="plg-emp-ic">
            <PuzzleIcon size={phone ? 23 : 22} />
          </span>
          <b>{list.length ? '你装的插件没有带工具' : '还没有工具'}</b>
          <p>工具都来自插件，比如点两个点算路程、框一片看合计。装了带工具的插件，就会列在这里。</p>
          {!phone && (
            <button type="button" className="plg-btn" data-act="plugin-manage" onClick={manage}>
              <PuzzleIcon size={16} />
              {manageLabel}
            </button>
          )}
        </div>
        {phone && (
          <button type="button" className="plg-go" data-act="plugin-manage" onClick={manage}>
            <PuzzleIcon size={20} />
            {manageLabel}
          </button>
        )}
      </>
    );
  else
    body = (
      <>
        <div className="plg-tl">
          {tools.map((x) => {
            const m = x.current.manifest;
            const v = verdictOf(x.current.sum);
            return (
              <button key={x.id} type="button" className={`plg-ti${v.blocked ? ' off' : ''}`} data-act="plugin-tool" data-plugin={x.id} onClick={() => onStart(x)}>
                <PluginIcon src={icons.get(x.current.sum)} size={phone ? 'md' : 'sm'} />
                <span className="plg-tt">
                  <b>
                    {m.name}
                    {v.blocked ? <span className="plg-tag err">网站停用了</span> : !v.reviewed && <span className="plg-tag warn">没审核</span>}
                  </b>
                  <small>{v.blocked ? '点了看为什么' : (m.description ?? '')}</small>
                </span>
              </button>
            );
          })}
        </div>
        {phone ? (
          <button type="button" className="plg-go left" data-act="plugin-manage" onClick={manage}>
            <PuzzleIcon size={20} />
            管理插件
          </button>
        ) : (
          <>
            <div className="plg-msep" />
            <button type="button" className="plg-mi" data-act="plugin-manage" onClick={manage}>
              <PuzzleIcon size={16} />
              管理插件…
            </button>
          </>
        )}
      </>
    );
  return createPortal(
    <div ref={ref} className={`plg-menu${phone ? ' phone' : ''}${empty ? ' empty' : ''}`} style={at} role="menu" aria-label="工具" data-testid="tools-menu" onPointerDown={stop} onClick={stop} onWheel={stop}>
      {phone && <span className="plg-grip" aria-hidden="true" />}
      {head}
      {body}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// 插件卡:头是网站的(插件改不了),下面是插件交来的面板;网站要说的话放在面板上面

function ToolCard({ run, phone, onAgain }: { run: ToolRun; phone: boolean; onAgain: () => void }) {
  const pl = run.plugin;
  const m = pl.current.manifest;
  const list = useMemo(() => [pl], [pl]);
  const icon = useIcons(list).get(pl.current.sum);
  const v = verdictOf(pl.current.sum);
  const writes = [...m.requires, ...(m.optional ?? [])].includes('author.write@1');
  const label = `插件「${m.name}」${versionLabel(m.version)}`;
  const t = run.trouble;
  return (
    <div className={`cp plg-card${phone ? ' phone' : ''}`} data-testid="plugin-card" data-plugin={pl.id}>
      <div className="cp-head">
        <PluginIcon src={icon} size="md" className={`plg-ci${v.blocked ? ' dim' : ''}`} />
        <div className="cp-title">
          <div className="plg-cn">
            <span>{m.name}</span>
            <span className="plg-tag">插件</span>
            {run.dev ? <span className="plg-tag dev">开发中</span> : !v.reviewed && !v.blocked && <span className="plg-tag warn">没审核</span>}
          </div>
          <span className="cp-sub">
            {m.author?.name ? `${m.author.name} 写的，` : ''}
            {versionLabel(m.version)}
          </span>
        </div>
        <button className="cp-x" data-act="plugin-close" onClick={stopTool} title="关掉插件" aria-label="关掉插件">
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="cp-body plg-cb">
        {t ? (
          <Trouble t={t} label={label} onAgain={onAgain} onRemove={() => void removePlugin(pl.id).finally(stopTool)} />
        ) : (
          <>
            {run.refusal && (
              <Msg
                icon={<Icon name="warn" size={phone ? 20 : 19} />}
                tone="warn"
                title="它要改的没改成，世界没变"
                lines={[run.refusal.bad ? `插件交来的修改有 ${run.refusal.bad} 处不对，网站一处都没改。这是插件的问题，可以告诉作者。` : '插件交来的修改不对，网站一处都没改。这是插件的问题，可以告诉作者。']}
                box={{ head: run.refusal.bad ? `网站查到的（${run.refusal.total} 处里有 ${run.refusal.bad} 处不对）` : '网站查到的', lines: run.refusal.lines }}
                acts={
                  <>
                    <CopyButton text={`${label}提的修改没照办：\n${run.refusal.lines.join('\n')}`} />
                    <button type="button" className="plg-btn pri" data-act="plugin-refusal-ok" onClick={dismissRefusal}>
                      知道了
                    </button>
                  </>
                }
              />
            )}
            {run.panel && <PanelView nodes={run.panel} act={panelAction} />}
            {run.phase === 'running' && <p className="plg-cfoot">{writes ? '这个插件能改你写的东西：改了顶上会说一声，能撤销。' : '这是插件算的，关掉就没了，世界不变。'}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function Trouble({ t, label, onAgain, onRemove }: { t: ToolTrouble; label: string; onAgain: () => void; onRemove: () => void }) {
  if (t.kind === 'slow')
    return (
      <Msg
        icon={<Clock />}
        tone="warn"
        title={`它 ${t.secs} 秒没有回应，已经停下了`}
        lines={['地图和世界都没受影响，拖、点照常。']}
        small="老是这样，可以在插件页把它关掉，或者告诉作者。"
        acts={
          <>
            <button type="button" className="plg-btn" data-act="plugin-close" onClick={stopTool}>
              关掉
            </button>
            <button type="button" className="plg-btn pri" data-act="plugin-again" onClick={onAgain}>
              再试一次
            </button>
          </>
        }
      />
    );
  if (t.kind === 'crashed')
    return (
      <Msg
        icon={<Icon name="warn" size={19} />}
        tone="err"
        title="它出错了，已经停下"
        lines={['这是插件自己的问题，不是你的世界坏了。']}
        box={{ head: t.site ? '网站查到的' : '插件报的错', lines: [t.text] }}
        acts={
          <>
            <CopyButton text={`${label}出错了：${t.text}`} />
            <button type="button" className="plg-btn pri" data-act="plugin-again" onClick={onAgain}>
              再试一次
            </button>
          </>
        }
      />
    );
  return (
    <Msg
      icon={<Icon name="ban" size={19} />}
      tone="err"
      title="网站停用了这个插件"
      lines={[`原因：${t.why}（${t.day}）。`, '它不会再启动。用过它的世界照常能看，它存下的图层还在。']}
      small="作者改好、新版审过以后，可以装新版。"
      acts={
        <>
          <button type="button" className="plg-btn red" data-act="plugin-remove" onClick={onRemove}>
            删掉它
          </button>
          <button type="button" className="plg-btn pri" data-act="plugin-close" onClick={stopTool}>
            知道了
          </button>
        </>
      }
    />
  );
}

function Msg({ icon, tone, title, lines, small, box, acts }: { icon: ReactNode; tone: 'warn' | 'err'; title: string; lines: string[]; small?: string; box?: { head: string; lines: string[] }; acts: ReactNode }) {
  return (
    <section className="cp-sec">
      <div className="plg-msg" data-testid="plugin-msg">
        <h4 className={tone}>
          {icon}
          {title}
        </h4>
        {lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
        {small && <p className="s">{small}</p>}
        {box && (
          <div className="plg-err">
            <small>{box.head}</small>
            {box.lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        )}
        <div className="plg-mbs">{acts}</div>
      </div>
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState<boolean | null>(null);
  useEffect(() => {
    if (done === null) return;
    const id = setTimeout(() => setDone(null), 2000);
    return () => clearTimeout(id);
  }, [done]);
  return (
    <button type="button" className="plg-btn" data-act="plugin-copy" onClick={() => void copyText(text).then(setDone)}>
      <Icon name="copy" size={14} />
      {done === null ? '复制给作者' : done ? '已复制' : '没复制上'}
    </button>
  );
}

function Clock() {
  return (
    <svg className="icon" width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2M9.5 2.5h5" />
    </svg>
  );
}
