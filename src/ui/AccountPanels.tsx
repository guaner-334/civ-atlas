/**
 * 登录以后才用得到的几个窗口(账号、退出登录、注销账号、分享),点开才下载,首页不带。
 * 窗口外壳、开关都在 AccountDialogs.tsx。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons';
import { when } from './worldParts';
import { copyText } from './clipboard';
import { currentUnsaved, currentWorld, isStored, keepWorld, listWorlds, loadWorld, notify, useSavesVersion } from './saveStore';
import { openAiSettings } from './AiSettings';
import { refreshOfficialAccount, useOfficialAccount } from '../ai/providers/official';
import { useAiOn } from '../ai/client';
import { ServerError } from '../account/server';
import { deleteAccount, displayName, getSession, sendCode, useSession } from '../account/session';
import { accountDeleted, behindCloud, signOut, syncNow, unsyncedCount, useSyncView } from '../account/sync';
import { createShare, listShares, listTrash, shortLink, stopShare, type ShareInfo, type TrashEntry } from '../account/cloud';
import { SIGNATURE_UNITS, cleanSignature, momentHash } from '../gen/savefile';
import { MomentCheck, momentNow, useMomentOn } from './shareMoment';
import { CloseX, Dialog, codeOf, errText, goToPanel, openTrash, sendLabel, useCountdown, type Panel } from './AccountDialogs';

/** 开着的这个窗口。退出、换了账号时外面已经不挂它了 */
export default function AccountPanel({ panel, phone, onClose, onBack }: { panel: Exclude<Panel, { kind: 'login' }>; phone: boolean; onClose: () => void; onBack: () => void }) {
  if (panel.kind === 'account') return <AccountDialog phone={phone} onClose={onClose} />;
  if (panel.kind === 'logout') return <LogoutDialog phone={phone} onClose={onClose} onBack={onBack} />;
  if (panel.kind === 'delete') return <DeleteDialog phone={phone} onClose={onClose} onBack={onBack} />;
  return <ShareDialog key={panel.worldId} phone={phone} worldId={panel.worldId} title={panel.title} onClose={onClose} />;
}

// ---------------------------------------------------------------------------
// 账号

/** "10月3日"(不是今年的带年份) */
function day(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()}年`;
  return `${y}${d.getMonth() + 1}月${d.getDate()}日`;
}

function AccountDialog({ phone, onClose }: { phone: boolean; onClose: () => void }) {
  const s = useSession()!;
  const sync = useSyncView();
  const acct = useOfficialAccount();
  const aiOn = useAiOn();
  useSavesVersion();
  const [trashList, setTrashList] = useState<TrashEntry[] | null>(null);
  const [shares, setShares] = useState<ShareInfo[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    void listTrash()
      .then((t) => live && setTrashList(t))
      .catch(() => {});
    void listShares()
      .then((l) => live && setShares(l))
      .catch(() => live && setShares([]));
    void refreshOfficialAccount();
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const n = listWorlds().length;
  const unsynced = unsyncedCount(sync);
  const syncText =
    sync.phase === 'syncing' || sync.busy.size
      ? { text: '正在同步', warn: false }
      : unsynced
        ? { text: `${unsynced} 个世界还没同步上`, warn: true }
        : sync.phase === 'offline' || sync.phase === 'error'
          ? { text: sync.message ?? '连不上服务器，联网后会自动同步', warn: true }
          : !n
            ? { text: '还没有世界', warn: false }
            : { text: `${n} 个世界都已同步${sync.lastOk ? `，${when(sync.lastOk)}` : ''}`, warn: false };
  const trashText = trashList === null ? '' : trashList.length ? `${trashList.length} 个，30 天内能找回` : '没有';

  const go = goToPanel;
  return (
    <Dialog
      phone={phone}
      label="账号"
      width={500}
      onClose={onClose}
      testId="account-dialog"
      head={
        <div className="acct-head acct-who">
          <Icon name="personc" size={44} />
          <div className="acct-who-text">
            <h2>{displayName(s.user)}</h2>
            <div className="acct-small">
              {s.user.account.includes('@') ? '邮箱' : '手机号'} {s.user.account}
            </div>
          </div>
          <CloseX onClose={onClose} />
        </div>
      }
    >
      <div className="acct-body" style={{ gap: 18 }}>
        <div className="acct-grp">
          <div className="acct-gr" data-row="sync">
            <Icon name="cloudok" size={19} />
            <span className="main">
              <b>云同步</b>
            </span>
            <span className={`side${syncText.warn ? ' warn' : ''}`}>{syncText.text}</span>
          </div>
          <button className="acct-gr" data-act="open-trash" onClick={() => openTrash()}>
            <Icon name="restore" size={19} />
            <span className="main">
              <b>最近删除</b>
            </span>
            <span className="side">{trashText}</span>
            <Icon name="chevron" size={14} className="chev" />
          </button>
          {aiOn && (
            <button
              className="acct-gr"
              data-act="open-credits"
              onClick={() => {
                onClose();
                openAiSettings('settings');
              }}
            >
              <Icon name="sparkle" size={19} />
              <span className="main">
                <b>AI 积分</b>
              </span>
              <span className="side">{acct.credits !== undefined ? `剩 ${acct.credits}` : ''}</span>
              <Icon name="chevron" size={14} className="chev" />
            </button>
          )}
        </div>
        {!!shares?.length && (
          <>
            <div className="acct-gh">
              分享出去的世界<small>拿到链接的人能看，不能改</small>
            </div>
            <div className="acct-grp" data-testid="share-list">
              {shares.map((sh) => {
                const thumb = loadWorld(sh.worldId)?.thumb;
                return (
                  <div className="acct-gr" key={sh.code}>
                    <span className="th2" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined} />
                    <span className="main">
                      <b>{sh.title || '未命名世界'}</b>
                      <small>
                        {day(sh.createdAt)}开始分享，打开过 {sh.opens} 次
                      </small>
                    </span>
                    <button
                      className="mini"
                      onClick={() =>
                        void copyText(shortLink(sh.code)).then((ok) => (ok ? setCopied(sh.code) : setErr(`没能自动复制，请手动复制：${shortLink(sh.code)}`)))
                      }
                    >
                      {copied === sh.code ? '已复制' : '复制链接'}
                    </button>
                    <button
                      className="mini red"
                      onClick={() =>
                        void stopShare(sh.worldId)
                          .then(() => setShares((l) => (l ?? []).filter((x) => x.code !== sh.code)))
                          .catch((e) => setErr(errText(e)))
                      }
                    >
                      停止分享
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {err && <p className="acct-err">{err}</p>}
      </div>
      <div className="acct-foot">
        <button className="acct-link red" data-act="delete-account" onClick={() => go('delete')}>
          注销账号
        </button>
        <span className="acct-sp" />
        <button className="acct-btn lg" data-act="logout" onClick={() => go('logout')}>
          <Icon name="logout" size={16} />
          退出登录
        </button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 退出登录

function LogoutDialog({ phone, onClose, onBack }: { phone: boolean; onClose: () => void; onBack: () => void }) {
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const n = useMemo(() => listWorlds().length, []);
  const go = async () => {
    setBusy(true);
    setErr('');
    const r = await signOut(keep);
    if (r.ok) return onClose();
    setErr(r.message);
    setBusy(false);
  };
  const choice = (v: boolean, title: string, sub: string) => (
    <label className={`acct-radio${keep === v ? ' on' : ''}`}>
      <input type="radio" name="logout-keep" checked={keep === v} onChange={() => setKeep(v)} />
      <i className="o" aria-hidden="true" />
      <span>
        <b>{title}</b>
        <small>{sub}</small>
      </span>
    </label>
  );
  return (
    <Dialog phone={phone} label="退出登录？" width={440} onClose={busy ? undefined : onBack} testId="logout-dialog" head={<div className="acct-head"><h2>退出登录？</h2></div>}>
      <div className="acct-body" style={{ gap: 10 }}>
        <p className="acct-lead" style={{ marginBottom: 4 }}>
          {n ? `账号里的 ${n} 个世界都还在，下次登录会回来。` : '账号里的世界都还在，下次登录会回来。'}这台设备上的要不要留着？
        </p>
        {choice(true, '留在这台设备上', '没登录也能接着看、接着改，下次登录再同步')}
        {choice(false, '从这台设备上删掉', '在别人的电脑、网吧用完选这个')}
        {err && <p className="acct-err">{err}</p>}
      </div>
      <div className="acct-foot">
        <span className="acct-sp" />
        <button className="acct-btn lg" disabled={busy} onClick={onBack}>
          取消
        </button>
        <button className="acct-btn lg blue" data-act="logout-confirm" disabled={busy} onClick={() => void go()}>
          {busy && !keep ? '正在同步' : '退出登录'}
        </button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 注销账号(照退出登录那个窗的样子)

function DeleteDialog({ phone, onClose, onBack }: { phone: boolean; onClose: () => void; onBack: () => void }) {
  const s = useSession()!;
  const [until, setUntil] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'delete' | null>(null);
  const [err, setErr] = useState('');
  const left = useCountdown(until);
  const send = async () => {
    setBusy('send');
    setErr('');
    try {
      const r = await sendCode(s.user.account);
      setUntil(Date.now() + r.resendAfter * 1000);
      if (r.devCode) setCode(r.devCode);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const go = async () => {
    setBusy('delete');
    setErr('');
    try {
      // 等回话的工夫别的标签页换了账号:这个窗已经关了,新登录的那个账号的同步不动
      if (await deleteAccount(code)) {
        accountDeleted();
        onClose();
      }
      notify({ kind: 'ok', text: '账号已注销', more: ['这台设备上的世界还在'] });
    } catch (e) {
      setErr(errText(e));
      setBusy(null);
    }
  };
  return (
    <Dialog phone={phone} label="注销账号？" width={440} onClose={busy ? undefined : onBack} testId="delete-dialog" head={<div className="acct-head"><h2>注销账号？</h2></div>}>
      <div className="acct-body" style={{ gap: 10 }}>
        <p className="acct-lead" style={{ marginBottom: 4 }}>
          账号里的世界（连同最近删除）、分享出去的链接和 AI 积分都会删掉，不能恢复。这台设备上的世界不动。
        </p>
        <div className="acct-fld">
          <input
            className="acct-in code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="6 位验证码"
            aria-label="验证码"
            disabled={until === null}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <button className="acct-btn lg" disabled={!!busy || left > 0} onClick={() => void send()}>
            {sendLabel(until !== null, left, busy === 'send')}
          </button>
        </div>
        <p className="acct-small">{until === null ? `验证码会发到 ${s.user.account}` : `验证码已发到 ${s.user.account}`}</p>
        {err && <p className="acct-err">{err}</p>}
      </div>
      <div className="acct-foot">
        <span className="acct-sp" />
        <button className="acct-btn lg" disabled={!!busy} onClick={onBack}>
          取消
        </button>
        <button className="acct-btn lg red" data-act="delete-confirm" disabled={!!busy || !/^\d{6}$/.test(code)} onClick={() => void go()}>
          注销账号
        </button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 分享

/** error 时带着 share = 链接还开着(停分享没成功),开关和链接照旧显示开着 */
type ShareState = { phase: 'prep' } | { phase: 'on'; share: ShareInfo } | { phase: 'off' } | { phase: 'error'; message: string; share?: ShareInfo };

/** 分享是替哪一次登录做的:等的工夫别的标签页退出、换了账号就停下(后面的请求会带上新账号的令牌,链接就开到新账号名下了) */
class ShareAborted extends Error {}
function sameLogin(token: string | undefined): void {
  if (!token || getSession()?.token !== token) throw new ShareAborted('账号变了');
}

/** 正在看的这个世界最新的改动没写进浏览器(存储满了,只在这个页面里):也就存不进账号,分享出去的会是旧的 */
const UNSAVED_WHY = '这个世界最新的改动没能存进浏览器（存储满了），也就没存进账号。先删掉几个世界腾出地方，再分享';
const unsavedHere = (worldId: string) => currentWorld()?.id === worldId && currentUnsaved();

/**
 * 分享前同步一遍(全看一遍,改过的存上去):这个世界没存上就不开分享(不然链接给出去的是账号里的旧样子);
 * 账号里的比这里新(别的设备改过、还没「载入」)也不开(不然给出去的不是眼前这个)
 */
async function pushForShare(worldId: string, token: string | undefined): Promise<void> {
  sameLogin(token);
  if (unsavedHere(worldId)) throw new Error(UNSAVED_WHY);
  const v = await syncNow();
  sameLogin(token);
  if (v.phase === 'offline') throw new ServerError(0, 'network', v.message ?? '连不上服务器');
  // 没同步完(服务器出错之类):不知道账号里是不是眼前这个样子,先不开
  if (v.phase !== 'idle') throw new Error(v.message ?? '没能和账号同步，稍后再试');
  const why = v.failed.get(worldId);
  if (why !== undefined) throw new Error(`这个世界最新的样子还没存进账号：${why}`);
  if (unsavedHere(worldId)) throw new Error(UNSAVED_WHY);
  if (behindCloud(worldId)) throw new Error('这个世界在另一台设备上改过，账号里的比这里新：先点「载入」换成那边的样子，再分享');
}

function ShareDialog({ phone, worldId, title, onClose }: { phone: boolean; worldId: string; title: string; onClose: () => void }) {
  const [st, setSt] = useState<ShareState>({ phase: 'prep' });
  /** 正在开 / 停分享 */
  const [busy, setBusy] = useState(false);
  /** 同一件事,给不等重新渲染就要看的地方(刚离开署名框就点了开关) */
  const busyRef = useRef(false);
  /** 正在存署名 */
  const [savingBy, setSavingBy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  /** 刚改的署名存好了,但系统的分享面板没让打开(等存的时候"刚点过"过期了):请再点一次 */
  const [again, setAgain] = useState(false);
  /** 署名输入框里的字(链接开着时按链接上的填好) */
  const [by, setBy] = useState('');
  useEffect(() => {
    let live = true;
    const token = getSession()?.token;
    // 每个请求发出去之前都看一眼:窗口还开着(关了就不再替用户打开分享)、还是同一次登录(请求带的是发出去那一刻登着的令牌)
    const still = () => {
      if (!live) throw new ShareAborted('关了');
      sameLogin(token);
    };
    void (async () => {
      // 世界要先在账号里:只是看看的(别人分享的)先存进"我的世界",再把改过的存上去
      if (!isStored(worldId)) keepWorld(worldId);
      await pushForShare(worldId, token);
      still();
      const list = await listShares();
      still();
      const share = list.find((x) => x.worldId === worldId) ?? (await createShare(worldId));
      still();
      setSt({ phase: 'on', share });
      setBy(share.by ?? '');
    })().catch((e) => {
      if (!live || e instanceof ShareAborted) return;
      const c = codeOf(e);
      setSt({ phase: 'error', message: c === 'not-found' || c === 'network' ? '这个世界还没存进账号，联网以后再试' : errText(e) });
    });
    return () => {
      live = false;
    };
  }, [worldId]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  /** 开着的链接(停分享失败时还开着) */
  const live = st.phase === 'on' || st.phase === 'error' ? st.share : undefined;
  const on = !!live || st.phase === 'prep';
  // 「停在这一刻」:打开分享窗那一刻的年份、选中的国家或州、镜头(看的就是这个世界时才有)
  const [at] = useState(() => (currentWorld()?.id === worldId ? momentNow() : null));
  const [momentOn, setMomentOn] = useMomentOn();
  const url = live ? shortLink(live.code) + (at && momentOn ? momentHash(at.moment) : '') : '';
  const toggle = async () => {
    if (busyRef.current || st.phase === 'prep') return;
    const token = getSession()?.token;
    busyRef.current = true;
    setBusy(true);
    try {
      // 刚离开署名框就点了开关:署名那次先存完再停 / 开(两个请求一起发的话,后回来的会把开关改回去)
      if (pendingBy.current) await pendingBy.current;
      if (live) {
        sameLogin(token);
        await stopShare(worldId);
        setSt({ phase: 'off' });
      } else {
        // 停了再开是一个新链接:署名跟着框里的
        await pushForShare(worldId, token);
        sameLogin(token);
        const share = await createShare(worldId, cleanSignature(by));
        sameLogin(token);
        setSt({ phase: 'on', share });
        setBy(share.by ?? '');
      }
    } catch (e) {
      if (e instanceof ShareAborted) return;
      // 停没停成:链接照旧算开着(服务器出错时确实还开着;断网时不知道,按开着说)
      setSt({ phase: 'error', message: errText(e), share: live });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  /** 正在存的署名(离开输入框时开始存、紧接着点了完成:等这一次) */
  const pendingBy = useRef<Promise<boolean> | null>(null);
  /** 署名改完(离开输入框、回车):和链接上的不一样就存上去;没存成的说一声,框里换回原来的。返回存好了没有(没改 = 存好了) */
  const saveBy = (): Promise<boolean> => {
    if (pendingBy.current) return pendingBy.current;
    if (!live) return Promise.resolve(true);
    const next = cleanSignature(by);
    if (next === (live.by ?? '')) {
      setBy(next);
      return Promise.resolve(true);
    }
    if (busyRef.current) return Promise.resolve(false);
    const token = getSession()?.token;
    setSavingBy(true);
    const p = (async () => {
      try {
        sameLogin(token);
        const share = await createShare(worldId, next);
        sameLogin(token);
        setSt({ phase: 'on', share });
        setBy(share.by ?? '');
        return true;
      } catch (e) {
        // 换了账号、退出了:这个窗口本来就该关
        if (e instanceof ShareAborted) return true;
        setSt({ phase: 'error', message: errText(e), share: live });
        setBy(live.by ?? '');
        return false;
      } finally {
        setSavingBy(false);
        pendingBy.current = null;
      }
    })();
    pendingBy.current = p;
    return p;
  };
  /** 关窗口(完成、Esc、点外面):署名还没存的先存上,存好了再关;没存成就留着窗口,上面说为什么 */
  const done = () => {
    void saveBy().then((ok) => {
      if (ok) onClose();
    });
  };
  const name = title || '未命名世界';
  /** 复制链接、发给别人:署名刚改了的先存好(发出去的链接打开就是新署名);没存成就不发,上面说为什么 */
  const copy = async () => {
    if (!url || !(await saveBy())) return;
    const ok = await copyText(url);
    setCopied(ok);
    setManual(!ok);
    (window as unknown as { __wfShortShare?: { url: string; copied: boolean } }).__wfShortShare = { url, copied: ok };
  };
  const sendTo = async () => {
    if (!url) return;
    setAgain(false);
    // 署名没改:马上打开系统的分享面板(要在点按钮的那一下里打开)
    const dirty = !!pendingBy.current || cleanSignature(by) !== (live?.by ?? '');
    if (dirty && !(await saveBy())) return;
    const act = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (dirty && act && !act.isActive) return setAgain(true);
    await navigator.share({ title: `「${name}」`, url }).catch((e: unknown) => {
      if (dirty && e instanceof DOMException && e.name === 'NotAllowedError') setAgain(true);
    });
  };
  const canSend = phone && typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const urlBox = (
    <div className={`url${live ? '' : ' off'}`} data-testid="share-url">
      <Icon name="link" size={15} />
      <span>{live ? url.replace(/^https?:\/\//, '') : st.phase === 'prep' ? '正在生成链接' : '分享已停止，链接打不开了'}</span>
    </div>
  );
  const copyBtn = (
    <button className={`acct-btn lg blue${phone ? ' full' : ''}`} data-act="copy-short-link" disabled={!live} onClick={() => void copy()}>
      <Icon name="copy" size={phone ? 17 : 16} />
      {copied ? '已复制' : '复制链接'}
    </button>
  );
  return (
    <Dialog phone={phone} label={`分享「${name}」`} width={480} onClose={done} testId="share-dialog">
      <div className="acct-body" style={{ paddingTop: phone ? 8 : 10, gap: phone ? 14 : 16 }}>
        <div className="acct-grp">
          <div className="acct-gr" style={{ minHeight: phone ? 58 : 56 }}>
            <Icon name="link" size={19} />
            <span className="main">
              <b>用链接分享</b>
              <small>{phone ? '关掉就停止分享，链接马上打不开' : '关掉就停止分享，发出去的链接马上打不开'}</small>
            </span>
            <button
              className={`acct-tg${on ? ' on' : ''}`}
              role="switch"
              aria-checked={on}
              aria-label="用链接分享"
              data-act="share-toggle"
              disabled={busy || st.phase === 'prep'}
              onClick={() => void toggle()}
            />
          </div>
          <div className="acct-gr" style={{ minHeight: phone ? 58 : 56 }}>
            <Icon name="person" size={19} />
            <span className="main">
              <b>署名</b>
              <small>别人另存时写进出处，可以不填</small>
            </span>
            <input
              className="acct-in sm"
              data-act="share-by"
              aria-label="署名"
              value={by}
              // 只防太长;按看到的字截到 20 个由 cleanSignature 做(maxLength 按 UTF-16 算,一个组合表情就占好几个)
              maxLength={SIGNATURE_UNITS}
              disabled={!live || busy || savingBy}
              onChange={(e) => setBy(e.target.value)}
              onBlur={() => void saveBy()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </div>
        </div>
        {at && <MomentCheck at={at} on={momentOn} onChange={setMomentOn} className="in-dlg" />}
        {phone ? (
          <>
            <div className="acct-linkbox">{urlBox}</div>
            <div className="acct-pair">
              {copyBtn}
              {canSend && (
                <button
                  className="acct-btn full"
                  style={{ fontWeight: 500 }}
                  disabled={!live}
                  onClick={() => void sendTo()}
                >
                  <Icon name="share" size={17} />
                  发给…
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="acct-linkbox">
            {urlBox}
            {copyBtn}
          </div>
        )}
        {manual && url && (
          <p className="acct-small" style={{ userSelect: 'all' }}>
            没能自动复制，请手动复制：{url}
          </p>
        )}
        {again && <p className="acct-small">署名存好了，再点一次「发给…」</p>}
        {st.phase === 'error' && <p className="acct-err">{st.message}</p>}
        <ul className="acct-notes">
          <li>
            <Icon name="check" size={14} />
            拿到链接的人能看地图和整段历史，不用登录。
          </li>
          <li>
            <Icon name="check" size={14} />
            你之后的改动，对方刷新就能看到。
          </li>
          <li>
            <Icon name="check" size={14} />
            对方想改，会另存一份到自己的「我的世界」，写明底稿来自你的「{name}」，动不到你的。
          </li>
        </ul>
      </div>
      {!phone ? (
        <div className="acct-foot">
          <span className="acct-sp" />
          <button className="acct-btn lg" onClick={done}>
            完成
          </button>
        </div>
      ) : (
        <div style={{ height: 6 }} />
      )}
    </Dialog>
  );
}
