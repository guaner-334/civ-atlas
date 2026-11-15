/**
 * 网站账号的几个窗口(电脑是居中的弹窗,手机是从下面升起的卡片):
 *
 *   登录       邮箱收验证码(不设密码);「手机号」那一格先置灰写"暂未开放"(网页这边还没做手机号登录);
 *              邀请制下新邮箱要邀请码:从邀请链接打开的已经填好,没填的点"获取验证码"时先说明、露出邀请码一栏(不发邮件)
 *   账号       最近删除、AI 积分(「使用 AI 功能」关着时不显示)、我的投稿(MySubmissions.tsx)、传到账号的世界、分享出去的世界(复制链接、停止分享);
 *              左下注销账号,右下退出登录
 *   退出登录   问这台设备上的世界留不留(默认留)
 *   注销账号   给自己的邮箱发验证码,填上才注销(账号里的都删掉;这台设备上的不动)
 *   分享       一个开关管开和停;署名(别人另存时写进底稿出处,默认不填);勾选「停在这一刻」(和存档菜单同一个,默认勾着:
 *              短链接后面带上 # 那段,对方打开停在这一年、选中的国家或州、同样的镜头;不经服务器,每次复制的链接各带各的);
 *              短链接、复制;手机上多一个"发给…"(系统分享)
 *
 *   openLogin() / openAccount() / openShareDialog(id, 名字)   打开它们(「我的世界」右上、AI 设置、存档菜单)
 *   openSubmitDialog(作品)   投到作品墙(存档菜单、预设菜单、调规则那一页的「···」;窗口在 SubmitDialog.tsx,点开才下载)
 *   openPhoneDialog(从哪来)   绑手机号、换手机号(窗口在 PhoneDialog.tsx,点开才下载)
 *   openTrash()   「我的世界」那一页换成最近删除(App 回到我的世界)
 *   AccountHost   窗口本身,App 里一直挂着
 *
 * 这里只留开关和窗口外壳;登录窗在 LoginDialog.tsx,登录以后才用得到的窗口在 AccountPanels.tsx,都点开才下载。
 */
import { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { closeAiSettings } from './AiSettings';
import { ServerError } from '../account/server';
import { getSession, onAccountDisabled, useSession } from '../account/session';
import { showToast } from './toastStore';
import { workKey, type SubmitWork } from './submitView';
import './account.css';

// ---------------------------------------------------------------------------
// 开关

export type Panel =
  | { kind: 'login' }
  /** to:打开时滚到哪一组 */
  | { kind: 'account'; to?: 'submissions' }
  | { kind: 'logout' }
  | { kind: 'delete' }
  | { kind: 'share'; worldId: string; title: string }
  /** 地图带不进配方的世界还没传到账号:先问一句,传好接着开分享窗 */
  | { kind: 'share-ask'; worldId: string; title: string }
  | { kind: 'submit'; work: SubmitWork; view?: SubmitView }
  /** back:绑好、取消以后回到哪个窗;then:绑好以后接着做的 */
  | { kind: 'phone'; mode: PhoneMode; back: Panel | null; then?: () => void };

// 已经登着的账号被停用(服务器的 401 带 ban):session.ts 已经退出登录,这里说一声;普通的登录过期不说
onAccountDisabled(() => showToast({ id: 'account-disabled', kind: 'warn', text: '这个账号已停用，已经退出登录', more: ['世界还在这个浏览器里'] }));

let panel: Panel | null = null;
let trash = false;
/** 账号窗、分享窗、最近删除是替哪一次登录(令牌)开的:别的标签页退出、换了账号,开着的就是原来那个账号的了,关掉 */
let openedFor: string | null = null;
const forNow = () => {
  openedFor = getSession()?.token ?? null;
};
let version = 0;
const subs = new Set<() => void>();
function emit() {
  version++;
  for (const f of subs) f();
}
function useUi() {
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => version,
    () => version,
  );
  return { panel, trash };
}

export function openLogin(): void {
  panel = { kind: 'login' };
  emit();
}
/** 也会被直接当成点击的处理函数,传进来的不是 'submissions' 就当没给 */
export function openAccount(to?: 'submissions'): void {
  panel = { kind: 'account', ...(to === 'submissions' ? { to } : {}) };
  forNow();
  emit();
}
export function openShareDialog(worldId: string, title: string): void {
  panel = { kind: 'share', worldId, title };
  forNow();
  emit();
}
export function openShareAsk(worldId: string, title: string): void {
  panel = { kind: 'share-ask', worldId, title };
  forNow();
  emit();
}
/** 账号停了投稿时先说原因:ban 从「投到作品墙…」来,ban-share 从「分享…」来(其实没停就接着开分享窗) */
export type SubmitView = 'ban' | 'ban-share';
export function openSubmitDialog(work: SubmitWork, view?: SubmitView): void {
  panel = { kind: 'submit', work, ...(view ? { view } : {}) };
  forNow();
  emit();
}
/** 绑手机号的窗从哪来:投稿、分享(绑好接着做),账号窗里的「没绑定」「换一个」(绑好、取消都回账号窗) */
export type PhoneMode = 'submit' | 'share' | 'account' | 'change';
export function openPhoneDialog(mode: PhoneMode, then?: () => void): void {
  const fromAccount = mode === 'account' || mode === 'change';
  const back = fromAccount ? { kind: 'account' as const } : panel?.kind === 'submit' || panel?.kind === 'share' ? panel : null;
  panel = { kind: 'phone', mode, back, ...(then ? { then } : {}) };
  forNow();
  emit();
}

/** 账号窗里换到退出登录、注销账号 */
export function goToPanel(kind: 'logout' | 'delete'): void {
  panel = { kind };
  emit();
}
export function closeAccountPanel(): void {
  if (!panel) return;
  panel = null;
  emit();
}

/** React:开着的是登录窗 / 账号窗(「我的世界」右上那个按钮显示按下) */
export function useAccountPanelOpen(): boolean {
  const k = useUi().panel?.kind;
  return k === 'login' || k === 'account';
}

/** 回到"我的世界"(App 登记) */
let goHome: (() => void) | null = null;
export function setGoHome(f: (() => void) | null): void {
  goHome = f;
}
/** 「我的世界」那一页换成最近删除 */
export function openTrash(): void {
  panel = null;
  trash = true;
  forNow();
  emit();
  closeAiSettings();
  goHome?.();
}
export function closeTrash(): void {
  if (!trash) return;
  trash = false;
  emit();
}
/** React:「我的世界」那一页是不是在看最近删除(只算替现在登着的这次登录开的) */
export function useTrashView(): boolean {
  const { trash: t } = useUi();
  const s = useSession();
  return t && !!s && s.token === openedFor;
}

/** 窗口:App 里挂一次 */
export function AccountHost({ phone }: { phone: boolean }) {
  const { panel: p, trash: t } = useUi();
  const s = useSession();
  // 退出了、换了账号(别的标签页里、令牌过期):开着的账号窗、分享窗、最近删除都是原来那个账号的,关掉;只留登录窗
  const stale = !s || s.token !== openedFor;
  useEffect(() => {
    if (p && p.kind !== 'login' && stale) closeAccountPanel();
    if (p?.kind === 'login' && s) closeAccountPanel();
    if (t && stale) closeTrash();
  }, [p, s, t, stale]);
  if (!p) return null;
  const close = closeAccountPanel;
  const back = () => {
    panel = { kind: 'account' };
    emit();
  };
  if (p.kind === 'login')
    return (
      <Suspense fallback={null}>
        <LoginPanel phone={phone} onClose={close} />
      </Suspense>
    );
  if (stale) return null;
  if (p.kind === 'submit')
    return (
      <Suspense fallback={null}>
        <SubmitPanel key={workKey(p.work)} phone={phone} work={p.work} view={p.view} onClose={close} />
      </Suspense>
    );
  if (p.kind === 'phone') {
    const leave = (done: boolean) => {
      panel = done || p.mode === 'account' || p.mode === 'change' ? p.back : null;
      emit();
      if (done) p.then?.();
    };
    return (
      <Suspense fallback={null}>
        <PhonePanel phone={phone} mode={p.mode} onDone={() => leave(true)} onClose={() => leave(false)} />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={null}>
      <Panels panel={p} phone={phone} onClose={close} onBack={back} />
    </Suspense>
  );
}

/** 窗口的代码下载不下来:说一句,带「重新加载」 */
export function PanelsMissing() {
  useEffect(() => {
    closeAccountPanel();
    showToast({ id: 'account-load', kind: 'error', text: '没能打开这个窗口', more: ['网络断了，或者网站刚更新过，重新加载试试'], action: { label: '重新加载', act: 'account-reload', onClick: () => location.reload() } });
  }, []);
  return null;
}

const LoginPanel = lazy(() => import('./LoginDialog').catch(() => ({ default: PanelsMissing as unknown as typeof import('./LoginDialog').default })));
const Panels = lazy(() => import('./AccountPanels').catch(() => ({ default: PanelsMissing as unknown as typeof import('./AccountPanels').default })));
const SubmitPanel = lazy(() => import('./SubmitDialog').catch(() => ({ default: PanelsMissing as unknown as typeof import('./SubmitDialog').default })));
const PhonePanel = lazy(() => import('./PhoneDialog').catch(() => ({ default: PanelsMissing as unknown as typeof import('./PhoneDialog').default })));

// ---------------------------------------------------------------------------
// 窗口外壳

/** 对话框开着时按 Esc 关掉(先于页面上别的 Esc) */
function useEscape(f: () => void) {
  const latest = useRef(f);
  latest.current = f;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      latest.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

export function Dialog({
  phone,
  label,
  width = 420,
  onClose,
  head,
  children,
  testId,
  className,
  inPlace,
}: {
  phone: boolean;
  label: string;
  width?: number;
  onClose?: () => void;
  /** 标题那一行(不给 = 标题 + 右上关闭) */
  head?: ReactNode;
  children: ReactNode;
  testId?: string;
  /** 窗口上多加的 class */
  className?: string;
  /** 就地放,窗口才盖不住顶上的提示条 */
  inPlace?: boolean;
}) {
  useEscape(() => onClose?.());
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  const body = (
    <div
      className={`acct-bg${phone ? ' sheet' : ''}`}
      onPointerDown={(e) => {
        stop(e);
        if (e.target === e.currentTarget) onClose?.();
      }}
      onClick={stop}
      onWheel={stop}
    >
      <div className={`acct-dlg${phone ? ' sheet' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={label} data-testid={testId} style={phone ? undefined : { width }}>
        {phone && <div className="acct-grip" aria-hidden="true" />}
        {head ?? (
          <div className="acct-head">
            <h2>{label}</h2>
            {onClose && <CloseX onClose={onClose} />}
          </div>
        )}
        {children}
      </div>
    </div>
  );
  return inPlace ? body : createPortal(body, document.body);
}

export function CloseX({ onClose }: { onClose: () => void }) {
  return (
    <button className="acct-x" onClick={onClose} title="关闭" aria-label="关闭">
      <Icon name="close" size={14} />
    </button>
  );
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const codeOf = (e: unknown) => (e instanceof ServerError ? e.code : '');

/** 重发倒计时:每秒刷新一次 */
export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    setNow(Date.now());
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

export const sendLabel = (sent: boolean, left: number, busy: boolean) => (busy ? '正在发送' : !sent ? '获取验证码' : left > 0 ? `重发（${left} 秒）` : '重发验证码');
