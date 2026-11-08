/**
 * 插件页:装了哪些、开关、能拿到什么、删除、投到作品墙;从文件装(查文件 → 权限框 → 装上)。
 * 电脑是居中的窗,左边列表右边详情;手机是从下面升起的一页,点一行进详情。
 * 权限框和装不上的说明换掉插件页显示,关掉回到插件页。
 * 开发者模式打开以后多一个「载入正在写的插件…」:选了文件就收起插件页,载入、权限框、日志都在地图左下角的小卡(DevCard.tsx)。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PLUGIN_CAPS, permissionFooter, permissionLines, type PermissionKey, type PermissionLine } from '../../plugin/pluginCaps';
import { PLUGIN_FILE_EXT, PLUGIN_MAX_BYTES, PluginFileError, openPluginFile, type OpenedPlugin, type PluginManifest } from '../../plugin/pluginFile';
import { installPlugin, listPlugins, pluginFileBytes, removePlugin, setPluginOn, type InstalledPlugin } from '../../plugin/pluginStore';
import { openSubmitDialog } from '../AccountDialogs';
import { isCoarse } from '../device';
import { Icon, type IconName } from '../icons';
import { showToast } from '../toastStore';
import { askPhone, phoneRequired, submitBan, useSubmitOn } from '../submitView';
import { knownAuthOptions } from '../../account/session';
import { pluginSubmitOn } from '../submitPlugin';
import { loadDev, pickDevFile, setDevMode, useDevMode, type DevAsk } from './dev';
import { addedLines, addsRows, askByLine, dayText, moreText, pageByLine, toolWhere, versionLabel, versionText } from './pluginText';
import { PluginIcon, useIcons, useOpenedIcon } from './pluginIcons';
import { verdictOf, type PluginVerdict } from './verdict';
import './plugins.css';

type Ask =
  | { kind: 'install'; bytes: Uint8Array; opened: OpenedPlugin; file: string; verdict: PluginVerdict }
  | { kind: 'update'; bytes: Uint8Array; opened: OpenedPlugin; file: string; old: InstalledPlugin; added: PermissionLine[] };

type Said =
  | { kind: 'broken'; file: string }
  | { kind: 'newer'; name: string; need: string }
  | { kind: 'blocked'; name: string; version: string; why: string; day: string }
  | { kind: 'failed'; name: string };

export default function PluginWindow({ phone, onClose }: { phone: boolean; onClose: () => void }) {
  const [list, setList] = useState<InstalledPlugin[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 选的文件拿去装,还是拿去载入正在写的插件 */
  const picking = useRef<'install' | 'dev'>('install');
  const dev = useDevMode();
  const icons = useIcons(list);
  // 登录、服务器的选项变了都会重画(useSubmitOn 盯着)
  const submitOn = useSubmitOn(true) && pluginSubmitOn(knownAuthOptions()?.features);

  const reload = async (pick?: string) => {
    const l = await listPlugins().catch(() => [] as InstalledPlugin[]);
    setList(l);
    setSel((s) => pick ?? (s && l.some((p) => p.id === s) ? s : (l[0]?.id ?? null)));
  };
  useEffect(() => void reload(), []);

  const back = () => {
    setAsk(null);
    setSaid(null);
  };
  useEscape(() => (ask || said ? back() : onClose()));

  const onFile = async (f: File) => {
    if (f.size > PLUGIN_MAX_BYTES) return setSaid({ kind: 'broken', file: f.name });
    setBusy(true);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let opened: OpenedPlugin;
      try {
        opened = await openPluginFile(bytes);
      } catch (e) {
        if (e instanceof PluginFileError && e.kind === 'newer') setSaid({ kind: 'newer', name: e.plugin ?? f.name, need: e.need ?? '新版网站的东西' });
        else setSaid({ kind: 'broken', file: f.name });
        return;
      }
      const m = opened.manifest;
      const verdict = verdictOf(opened.sum);
      if (verdict.blocked) return setSaid({ kind: 'blocked', name: m.name, version: m.version, ...verdict.blocked });
      const old = list?.find((p) => p.id === m.id);
      if (old?.current.sum === opened.sum) return void setSel(old.id);
      if (old) return setAsk({ kind: 'update', bytes, opened, file: f.name, old, added: addedLines(old.current.manifest, m) });
      setAsk({ kind: 'install', bytes, opened, file: f.name, verdict });
    } catch {
      setSaid({ kind: 'broken', file: f.name });
    } finally {
      setBusy(false);
    }
  };

  const install = async (a: Ask) => {
    setBusy(true);
    try {
      const r = await installPlugin(new File([a.bytes], a.file));
      await reload(r.plugin.id);
      setAsk(null);
      setDetail(false);
      const where = toolWhere(r.plugin.current.manifest, phone);
      showToast({ id: 'plugins', kind: 'ok', text: '装好了', ...(where ? { more: [where] } : {}) });
    } catch {
      setAsk(null);
      setSaid({ kind: 'failed', name: a.opened.manifest.name });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (id: string, on: boolean) => {
    setList((l) => l && l.map((p) => (p.id === id ? { ...p, on } : p)));
    await setPluginOn(id, on).catch(() => {});
    await reload();
  };

  const remove = async (id: string) => {
    await removePlugin(id).catch(() => false);
    setDetail(false);
    await reload();
  };

  /** 投到作品墙:交的就是装着的这一份文件 */
  const submit = async (p: InstalledPlugin) => {
    const bytes = await pluginFileBytes(p.current.sum).catch(() => null);
    if (!bytes) return showToast({ id: 'plugins', kind: 'error', text: '没读到这个插件的文件', more: ['从文件再装一次再投'] });
    const m = p.current.manifest;
    const go = () =>
      openSubmitDialog({
        kind: 'plugin',
        plugin: {
          id: m.id,
          name: m.name,
          version: m.version,
          sum: p.current.sum,
          file: p.current.file ?? `${m.id}${PLUGIN_FILE_EXT}`,
          bytes,
          license: m.license,
          description: m.description ?? '',
          icon: icons.get(p.current.sum) ?? null,
          lines: permissionLines(m).map((l) => l.key),
          capLines: Object.fromEntries(PLUGIN_CAPS),
        },
      });
    if (!submitBan() && phoneRequired()) askPhone({ for: 'submit', then: go });
    else go();
  };

  const pick = () => {
    picking.current = 'install';
    fileRef.current?.click();
  };
  const loadPicked = (f: File, h: Parameters<typeof loadDev>[1]) => {
    onClose();
    void loadDev(f, h);
  };
  const pickDev = async () => {
    picking.current = 'dev';
    const got = await pickDevFile();
    if (got === undefined) fileRef.current?.click();
    else if (got) loadPicked(got.file, got.handle);
  };
  const input = (
    <input
      ref={fileRef}
      type="file"
      accept={pickAccept()}
      hidden
      data-testid="plugin-file-input"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        if (picking.current === 'dev') loadPicked(f, null);
        else void onFile(f);
      }}
    />
  );

  const cur = list?.find((p) => p.id === sel) ?? null;
  let body: ReactNode;
  let mode: 'page' | 'ask' = 'ask';
  if (said) body = <SaidBox said={said} phone={phone} onOk={back} />;
  else if (ask?.kind === 'install') body = <InstallBox ask={ask} phone={phone} busy={busy} onCancel={back} onOk={() => void install(ask)} />;
  else if (ask?.kind === 'update') body = <UpdateBox ask={ask} phone={phone} icon={icons.get(ask.old.current.sum)} busy={busy} onCancel={back} onOk={() => void install(ask)} />;
  else {
    mode = 'page';
    const onSubmit = submitOn ? (p: InstalledPlugin) => void submit(p) : null;
    const props = { list, cur, icons, busy, dev, onPick: pick, onPickDev: () => void pickDev(), onSel: setSel, onToggle: toggle, onRemove: remove, onSubmit, onClose };
    body = phone ? <PhonePage {...props} detail={detail} onDetail={setDetail} /> : <DeskPage {...props} />;
  }
  return createPortal(
    <div
      className={`plg-bg ${mode}${phone ? ' phone' : ''}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) (ask || said ? back : onClose)();
      }}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {body}
      {input}
    </div>,
    document.body,
  );
}

/** 手机和 Safari 上不限文件类型:.civplugin 系统不认识,写了可能灰掉不让选 */
export function pickAccept(): string | undefined {
  const ua = navigator.userAgent;
  if (isCoarse() || /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || (/Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua))) return undefined;
  return PLUGIN_FILE_EXT;
}

function useEscape(f: () => void) {
  const latest = useRef(f);
  latest.current = f;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 上面盖着投稿窗这些账号的窗时,Esc 只关那个窗
      if (e.key !== 'Escape' || document.querySelector('.acct-bg')) return;
      e.stopPropagation();
      latest.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

// ---------------------------------------------------------------------------
// 小零件

/** 本网站图标里没有的几样 */
const MORE_ICONS = {
  route: (
    <>
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <path d="M8.2 18H14a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h5.8" />
    </>
  ),
  box: <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9" />,
  shield: <path d="M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6zM9 12l2.2 2.2 4-4.2" />,
  reload: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
};

export function Ico({ name, size = 18 }: { name: IconName | keyof typeof MORE_ICONS; size?: number }) {
  if (!(name in MORE_ICONS)) return <Icon name={name as IconName} size={size} />;
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {MORE_ICONS[name as keyof typeof MORE_ICONS]}
    </svg>
  );
}

const PERM_ICON: Record<PermissionKey, IconName | keyof typeof MORE_ICONS> = {
  map: 'globe',
  history: 'book',
  authorRead: 'bubble',
  authorWrite: 'pen',
  view: 'pin',
  layer: 'route',
  storeWorld: 'box',
};

function Perm({ line }: { line: PermissionLine }) {
  return (
    <div className={`plg-perm${line.loud ? ' hi' : ''}`} data-perm={line.key}>
      <Ico name={PERM_ICON[line.key]} />
      <span>
        {line.loud ? <b>{line.text}</b> : line.text}
        {line.note && <small>{line.note}</small>}
        {line.why.length > 0 && <small>作者说：{line.why.join('；')}</small>}
      </span>
    </div>
  );
}

function Perms({ m }: { m: PluginManifest }) {
  const lines = permissionLines(m);
  return (
    <>
      {lines.length > 0 && (
        <div className="plg-grp">
          {lines.map((l) => (
            <Perm key={l.key} line={l} />
          ))}
        </div>
      )}
      <div className="plg-safe">
        <Icon name="lock" size={16} />
        <span>{permissionFooter(lines)}</span>
      </div>
    </>
  );
}

function Switch({ on, disabled, small, label, onChange }: { on: boolean; disabled?: boolean; small?: boolean; label: string; onChange?: (on: boolean) => void }) {
  return (
    <button
      className={`plg-sw${on ? ' on' : ''}${small ? ' sm' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.(!on);
      }}
    />
  );
}

function StatusTag({ v }: { v: PluginVerdict }) {
  if (v.blocked) return <span className="plg-tag err">网站停用了</span>;
  return v.reviewed ? <span className="plg-tag ok">审过</span> : <span className="plg-tag warn">没审核</span>;
}

export function CloseBtn({ onClose, round }: { onClose: () => void; round?: boolean }) {
  return (
    <button className={round ? 'plg-xr' : 'plg-x'} onClick={onClose} title="关闭" aria-label="关闭">
      {round ? <Icon name="close" size={14} /> : '✕'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 插件页

interface PageProps {
  list: InstalledPlugin[] | null;
  cur: InstalledPlugin | null;
  icons: Map<string, string | null>;
  busy: boolean;
  /** 开发者模式开着 */
  dev: boolean;
  onPick: () => void;
  onPickDev: () => void;
  onSel: (id: string) => void;
  onToggle: (id: string, on: boolean) => void;
  onRemove: (id: string) => void;
  /** 投到作品墙;没登录、服务器不收插件 = null */
  onSubmit: ((p: InstalledPlugin) => void) | null;
  onClose: () => void;
}

/** 开发者模式那一行;关掉时载入的插件一起停掉 */
function DevRow({ on, phone }: { on: boolean; phone?: boolean }) {
  return (
    <div className={phone ? 'plg-devr' : 'plg-dev'}>
      <span>
        <b>开发者模式</b>
        <small>写插件的人用：重新载入、看日志</small>
      </span>
      <Switch on={on} small={!phone} label="开发者模式" onChange={setDevMode} />
    </div>
  );
}

function Empty() {
  return (
    <div className="plg-empty">
      <b>还没装插件</b>
      <span>有插件文件（{PLUGIN_FILE_EXT}）的话，点「从文件装…」</span>
    </div>
  );
}

/** 列表一行的名字和版本;是个按钮,键盘也选得到(点这一行别处一样) */
function ItemText({ p, v }: { p: InstalledPlugin; v: PluginVerdict }) {
  return (
    <button type="button" className="plg-it-t">
      <b>{p.current.manifest.name}</b>
      <small>
        <span>{versionLabel(p.current.manifest.version)}</span>
        <StatusTag v={v} />
      </small>
    </button>
  );
}

function DeskPage({ list, cur, icons, busy, dev, onPick, onPickDev, onSel, onToggle, onRemove, onSubmit, onClose }: PageProps) {
  return (
    <div className="plg-page" role="dialog" aria-modal="true" aria-label="插件" data-testid="plugin-page">
      <div className="plg-page-h">
        <h2>插件</h2>
        <span className="plg-page-sub">装在这个浏览器里，所有世界都能用</span>
        <CloseBtn onClose={onClose} />
      </div>
      <div className="plg-cols">
        <div className="plg-lcol">
          <div className="plg-items">
            {list?.map((p) => {
              const v = verdictOf(p.current.sum);
              return (
                <div key={p.id} className={`plg-it${p.id === cur?.id ? ' on' : ''}${v.blocked ? ' off' : ''}`} data-plugin={p.id} onClick={() => onSel(p.id)}>
                  <PluginIcon src={icons.get(p.current.sum)} size="md" />
                  <ItemText p={p} v={v} />
                  <Switch on={p.on && !v.blocked} disabled={!!v.blocked} label={p.current.manifest.name} onChange={(on) => onToggle(p.id, on)} />
                </div>
              );
            })}
          </div>
          <div className="plg-lfoot">
            <button className="plg-btn" data-act="plugin-from-file" disabled={busy} onClick={onPick}>
              <Icon name="file" size={16} />
              从文件装…
            </button>
            {dev && (
              <button className="plg-btn" data-act="plugin-dev-load" disabled={busy} onClick={onPickDev}>
                <Ico name="reload" size={16} />
                载入正在写的插件…
              </button>
            )}
            <DevRow on={dev} />
          </div>
        </div>
        <div className="plg-rcol">{cur ? <Detail p={cur} icon={icons.get(cur.current.sum)} onToggle={onToggle} onRemove={onRemove} onSubmit={onSubmit} /> : list && <Empty />}</div>
      </div>
    </div>
  );
}

function Detail({
  p,
  icon,
  phone,
  onToggle,
  onRemove,
  onSubmit,
}: {
  p: InstalledPlugin;
  icon: string | null | undefined;
  phone?: boolean;
  onToggle: PageProps['onToggle'];
  onRemove: PageProps['onRemove'];
  onSubmit: PageProps['onSubmit'];
}) {
  const m = p.current.manifest;
  const v = verdictOf(p.current.sum);
  const ops = (
    <div className="plg-ops">
      <Switch on={p.on && !v.blocked} disabled={!!v.blocked} label={m.name} onChange={(on) => onToggle(p.id, on)} />
      {p.on && !v.blocked ? '开着' : '关着'}
      {onSubmit && !v.reviewed && !v.blocked && (
        <button className="plg-btn sm" data-act="plugin-submit" onClick={() => onSubmit(p)}>
          <Icon name="export" size={14} />
          投到作品墙…
        </button>
      )}
      <button className="plg-btn sm red" data-act="plugin-remove" onClick={() => onRemove(p.id)}>
        <Icon name="trash" size={14} />
        删除
      </button>
    </div>
  );
  const status = v.blocked ? (
    <div className="plg-st err">
      <Icon name="ban" size={16} />
      网站停用了这一版：{v.blocked.why}
    </div>
  ) : v.reviewed ? (
    <div className="plg-st ok">
      <Ico name="shield" size={16} />
      作品墙审过这一版{!phone && <small>（和审过的文件一个字不差）</small>}
    </div>
  ) : (
    <div className="plg-st warn">
      <Icon name="warn" size={16} />
      没经过审核
    </div>
  );
  return (
    <div className="plg-detail" data-plugin={p.id}>
      <div className="plg-hd">
        <PluginIcon src={icon} size="lg" />
        <div>
          <h3>
            {m.name} <span className="plg-tag">{versionLabel(m.version)}</span>
          </h3>
          <div className="plg-by">{pageByLine(m, p.current.bytes)}</div>
          {!phone && status}
        </div>
        {!phone && ops}
      </div>
      {phone && status}
      {phone && ops}
      {m.description && <p className="plg-desc">{m.description}</p>}
      <div className="plg-sec">它能拿到什么</div>
      <Perms m={m} />
      <div className="plg-sec">它加了什么</div>
      <div className="plg-grp">
        {addsRows(m, !!phone).map((r) => (
          <div key={r.k} className="plg-row">
            <span className="k">{r.k}</span>
            <span className="v">
              {r.v}
              {r.small && <small>{r.small}</small>}
            </span>
          </div>
        ))}
      </div>
      <div className="plg-sec">从哪来</div>
      <div className="plg-grp plg-kv">
        <span>装的时候</span>
        {dayText(p.current.at)}，从文件装{p.current.file ? `（${p.current.file}）` : ''}
        <span>更新</span>
        不自动更新；有新文件时再从文件装一次
      </div>
    </div>
  );
}

function PhonePage(props: PageProps & { detail: boolean; onDetail: (on: boolean) => void }) {
  const { list, cur, icons, busy, dev, onPick, onPickDev, onSel, onToggle, onRemove, onSubmit, onClose, detail, onDetail } = props;
  if (detail && cur)
    return (
      <div className="plg-page" role="dialog" aria-modal="true" aria-label={cur.current.manifest.name} data-testid="plugin-page">
        <div className="plg-grip" aria-hidden="true" />
        <div className="plg-ptop back">
          <button className="plg-back" onClick={() => onDetail(false)}>
            <Icon name="back" size={16} />
            插件
          </button>
          <CloseBtn onClose={onClose} round />
        </div>
        <div className="plg-pscroll">
          <Detail p={cur} icon={icons.get(cur.current.sum)} phone onToggle={onToggle} onRemove={onRemove} onSubmit={onSubmit} />
        </div>
      </div>
    );
  return (
    <div className="plg-page" role="dialog" aria-modal="true" aria-label="插件" data-testid="plugin-page">
      <div className="plg-grip" aria-hidden="true" />
      <div className="plg-ptop">
        <b>插件</b>
        <CloseBtn onClose={onClose} round />
      </div>
      <div className="plg-pscroll">
        <div className="plg-page-sub">装在这个浏览器里，所有世界都能用</div>
        {list && list.length > 0 ? (
          <div className="plg-grp plg-lst">
            {list.map((p) => {
              const v = verdictOf(p.current.sum);
              return (
                <div
                  key={p.id}
                  className={`plg-it${v.blocked ? ' off' : ''}`}
                  data-plugin={p.id}
                  onClick={() => {
                    onSel(p.id);
                    onDetail(true);
                  }}
                >
                  <PluginIcon src={icons.get(p.current.sum)} size="md" />
                  <ItemText p={p} v={v} />
                  <Switch on={p.on && !v.blocked} disabled={!!v.blocked} label={p.current.manifest.name} onChange={(on) => onToggle(p.id, on)} />
                  <span className="plg-chev">
                    <Icon name="chevron" size={16} />
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          list && <Empty />
        )}
        <button className="plg-fbtn" data-act="plugin-from-file" disabled={busy} onClick={onPick}>
          <Icon name="file" size={18} />
          从文件装…
        </button>
        {dev && (
          <button className="plg-fbtn" data-act="plugin-dev-load" disabled={busy} onClick={onPickDev}>
            <Ico name="reload" size={18} />
            载入正在写的插件…
          </button>
        )}
        <DevRow on={dev} phone />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 权限框、更新、装不上

function Buttons({ phone, left, cancel, ok, busy, onCancel, onOk }: { phone: boolean; left?: string; cancel?: string; ok: string; busy?: boolean; onCancel?: () => void; onOk: () => void }) {
  return (
    <div className={`plg-foot${phone ? ' pair' : ''}`}>
      {left && !phone && <span className="left">{left}</span>}
      {cancel && (
        <button className="plg-btn" data-act="plugin-cancel" onClick={onCancel}>
          {cancel}
        </button>
      )}
      <button className="plg-btn pri" data-act="plugin-ok" disabled={busy} onClick={onOk}>
        {ok}
      </button>
    </div>
  );
}

function AskShell({ phone, label, tight, narrow, testId, children }: { phone: boolean; label: string; tight?: boolean; narrow?: boolean; testId: string; children: ReactNode }) {
  return (
    <div className={`plg-dlg${phone ? ' sheet' : ''}${tight ? ' tight' : ''}${narrow ? ' narrow' : ''}`} role="dialog" aria-modal="true" aria-label={label} data-testid={testId}>
      {phone && <div className="plg-grip" aria-hidden="true" />}
      {children}
    </div>
  );
}

function InstallBox({ ask, phone, busy, onCancel, onOk }: { ask: Pick<Extract<Ask, { kind: 'install' }>, 'opened' | 'file' | 'verdict'>; phone: boolean; busy: boolean; onCancel: () => void; onOk: () => void }) {
  const m = ask.opened.manifest;
  const icon = useOpenedIcon(ask.opened);
  const lines = permissionLines(m);
  const reviewed = ask.verdict.reviewed;
  return (
    <AskShell phone={phone} label={`装「${m.name}」？`} tight={lines.length > 4} testId="plugin-ask">
      <div className="plg-scroll">
        <div className="plg-ask-hd">
          <PluginIcon src={icon} size="xl" />
          <div>
            <h2>装「{m.name}」？</h2>
            <div className="plg-by">{askByLine(m, ask.opened.bytes, phone)}</div>
          </div>
        </div>
        {reviewed ? (
          <div className="plg-ok">
            <Ico name="shield" size={16} />
            作品墙审过这一版：有人看过它的代码，也在示例世界上跑过
          </div>
        ) : (
          <div className="plg-warn">
            <Icon name="warn" size={20} />
            <span>
              <b>这个插件没经过审核</b>
              它照样断网、碰不到密钥，但可能算错、显示不合适的内容。只装你信得过的人给的文件。
            </span>
          </div>
        )}
        {lines.length > 0 && <div className="plg-lab">它要用到</div>}
        <Perms m={m} />
        {phone && <div className="plg-fn">{ask.file}</div>}
      </div>
      <Buttons phone={phone} left={ask.file} cancel="取消" ok={reviewed ? '装上' : '仍然装上'} busy={busy} onCancel={onCancel} onOk={onOk} />
    </AskShell>
  );
}

/** 开发者模式载入时的权限框:和装的时候那张一样,盖在整页上 */
export function DevAskBox({ ask, phone }: { ask: DevAsk; phone: boolean }) {
  const no = () => ask.answer(false);
  useEscape(no);
  return createPortal(
    <div
      className={`plg-bg ask${phone ? ' phone' : ''}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) no();
      }}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <InstallBox ask={{ opened: ask.opened, file: ask.file, verdict: verdictOf(ask.opened.sum) }} phone={phone} busy={false} onCancel={no} onOk={() => ask.answer(true)} />
    </div>,
    document.body,
  );
}

/** 两个版本号比大小:新的大于旧的 = 1 */
function newerThan(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

function UpdateBox({ ask, phone, icon, busy, onCancel, onOk }: { ask: Extract<Ask, { kind: 'update' }>; phone: boolean; icon: string | null | undefined; busy: boolean; onCancel: () => void; onOk: () => void }) {
  const m = ask.opened.manifest;
  const opened = useOpenedIcon(ask.opened);
  const v = versionText(m.version);
  const title = newerThan(m.version, ask.old.current.manifest.version) < 0 ? `把「${m.name}」换回第 ${v} 版？` : `把「${m.name}」更新到第 ${v} 版？`;
  return (
    <AskShell phone={phone} label={title} narrow testId="plugin-update">
      <div className="plg-scroll">
        <h4>
          <PluginIcon src={opened ?? icon} size="sm" />
          {title}
        </h4>
        {ask.added.length > 0 && (
          <>
            <p>{moreText(ask.added.length)}</p>
            <div className="plg-grp">
              {ask.added.map((l) => (
                <Perm key={l.key} line={l} />
              ))}
            </div>
          </>
        )}
        <p>
          <small>不更新就接着用{versionLabel(ask.old.current.manifest.version)}。不会自动更新。</small>
        </p>
      </div>
      <Buttons phone={phone} cancel="不更新" ok="更新" busy={busy} onCancel={onCancel} onOk={onOk} />
    </AskShell>
  );
}

function SaidBox({ said, phone, onOk }: { said: Said; phone: boolean; onOk: () => void }) {
  let head: ReactNode;
  let text: ReactNode;
  let small: string;
  if (said.kind === 'broken') {
    head = (
      <>
        <Icon name="warn" size={20} />
        装不上「{said.file}」
      </>
    );
    text = '这个文件不是插件，或者坏了。';
    small = `插件文件以 ${PLUGIN_FILE_EXT} 结尾，最大 ${PLUGIN_MAX_BYTES / 1024 / 1024} MB。是别人发给你的，请对方再发一次。`;
  } else if (said.kind === 'newer') {
    head = (
      <>
        <Icon name="info" size={20} />
        「{said.name}」要等网站更新才能装
      </>
    );
    text = `它要用到「${said.need}」，这个网站还不认识。网站更新以后再从文件装一次。`;
    small = '插件文件不用改，也不用找作者。';
  } else if (said.kind === 'blocked') {
    head = (
      <>
        <Icon name="ban" size={20} />
        装不上：网站停用了这个插件
      </>
    );
    text = `「${said.name}」${versionLabel(said.version)}${said.why}，${said.day}停用。`;
    small = '作者改好、新版审过以后才能再装。';
  } else {
    head = (
      <>
        <Icon name="warn" size={20} />
        没装上「{said.name}」
      </>
    );
    text = '这个浏览器没让存插件。';
    small = '空间满了，或者开着无痕模式时会这样。';
  }
  return (
    <AskShell phone={phone} label="插件" narrow testId="plugin-said">
      <div className="plg-scroll">
        <h4 data-said={said.kind}>{head}</h4>
        <p>
          {text}
          <br />
          <small>{small}</small>
        </p>
      </div>
      <Buttons phone={phone} ok="好" onOk={onOk} />
    </AskShell>
  );
}
