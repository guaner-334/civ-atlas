/**
 * 登录以后才用得到的几个窗口(账号、退出登录、注销账号、分享),点开才下载,首页不带。
 * 窗口外壳、开关都在 AccountDialogs.tsx。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons';
import { copyText } from './clipboard';
import { currentWorld, isStored, keepWorld, listWorlds, loadWorld, notify, useSavesVersion } from './saveStore';
import { openAiSettings } from './AiSettings';
import { officialServer, refreshOfficialAccount, useOfficialAccount } from '../ai/providers/official';
import { useAiOn } from '../ai/client';
import { notesKnown, notesReady } from '../ai/library';
import { deleteAccount, displayName, getSession, sendCode, useSession } from '../account/session';
import { signOut } from '../account/sync';
import { createShare, getCloud, listShares, listTrash, shortLink, stopShare, type ShareInfo, type TrashEntry } from '../account/cloud';
import { SIGNATURE_UNITS, cleanSignature, momentHash } from '../gen/savefile';
import { MomentCheck, momentNow, useMomentOn } from './shareMoment';
import { CloseX, Dialog, closeAccountPanel, codeOf, errText, goToPanel, openTrash, sendLabel, useCountdown, type Panel } from './AccountDialogs';
import { openWorldById } from './newCivAction';
import { ShareAborted, pushForShare } from './sharePush';
import { askFull, fullDay, fullStatusOf, holdFullToasts, pairText, useFullJob, useFullNotes, useFullOverview, useFullPull, type FullJob, type FullNote } from './fullWorldView';
import { usedLine } from './fullWorldWords';
import { keepLastBy } from './submitView';

/** 开着的这个窗口。退出、换了账号时外面已经不挂它了 */
export default function AccountPanel({ panel, phone, onClose, onBack }: { panel: Exclude<Panel, { kind: 'login' | 'submit' }>; phone: boolean; onClose: () => void; onBack: () => void }) {
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

  const fo = useFullOverview();
  useEffect(() => void askFull(), []);
  useEffect(() => holdFullToasts(), []);
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
          <button className="acct-gr" data-act="open-trash" onClick={() => openTrash()}>
            <Icon name="restore" size={19} />
            <span className="main">
              <b>最近删除</b>
            </span>
            <span className="side">{trashText}</span>
            <Icon name="chevron" size={14} className="chev" />
          </button>
          {aiOn && officialServer() && (
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
        {fo && (
          <FullGroup
            shares={shares}
            onRemoved={() => {
              void listShares().then(setShares, () => {});
              void listTrash().then(setTrashList, () => {});
            }}
          />
        )}
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
// 账号窗:传到账号的世界。提示条盖不到这个窗口,进度、出错、删除确认都写在那一行里

const flow = () => import('./fullWorldFlow');

function FullGroup({ shares, onRemoved }: { shares: ShareInfo[] | null; onRemoved: () => void }) {
  const fo = useFullOverview();
  const job = useFullJob();
  const notes = useFullNotes();
  useSavesVersion();
  // 这台设备上没有的世界:名字、封面去账号里读一次(只读)
  const [info, setInfo] = useState<Record<string, { title: string; thumb: string | null }>>({});
  const missing = fo ? fo.account.filter((w) => !isStored(w.id) && !info[w.id]).map((w) => w.id) : [];
  const key = missing.join();
  useEffect(() => {
    if (!key) return;
    let live = true;
    void (async () => {
      for (const id of key.split(',')) {
        if (!live) return;
        const w = await getCloud(id).catch(() => null);
        if (live && w) setInfo((m) => ({ ...m, [id]: { title: (w.save as { title?: string } | null)?.title ?? '', thumb: w.thumb } }));
      }
    })();
    return () => {
      live = false;
    };
  }, [key]);
  if (!fo) return null;
  const inList = new Set(fo.account.map((w) => w.id));
  // 正在传、刚说过话的世界还不在账号里的也放一行
  const extra = [...(job ? [job.id] : []), ...Object.keys(notes)].filter((id, i, a) => a.indexOf(id) === i && !inList.has(id));
  const empty = !fo.account.length && !extra.length;
  return (
    <>
      <div className="acct-gh">
        传到账号的世界
        <small>{empty ? `最多 ${fo.limits.worlds} 个、共 ${Math.round(fo.limits.bytes / 1e6)} MB` : usedLine(fo)}</small>
      </div>
      <div className="acct-grp" data-testid="full-list">
        {empty && (
          <div className="acct-gr">
            <Icon name="cloudup" size={19} />
            <span className="main">
              <b>还没传过</b>
              <small style={{ whiteSpace: 'normal' }}>想换设备打开、分享看到的一模一样，到世界的「存档」里点「传到账号」</small>
            </span>
          </div>
        )}
        {[...extra, ...fo.account.map((w) => w.id)].map((id) => (
          <FullRow key={id} id={id} info={info[id] ?? null} job={job?.id === id ? job : null} note={notes[id] ?? null} shared={!!shares?.some((s) => s.worldId === id)} onRemoved={onRemoved} />
        ))}
      </div>
    </>
  );
}

function FullRow({ id, info, job, note, shared, onRemoved }: { id: string; info: { title: string; thumb: string | null } | null; job: FullJob | null; note: FullNote | null; shared: boolean; onRemoved: () => void }) {
  const w = loadWorld(id);
  const fo = useFullOverview();
  const pull = useFullPull();
  const here = isStored(id);
  const inAccount = !!fo?.account.some((x) => x.id === id);
  const entry = fo?.worlds.find((x) => x.id === id) ?? null;
  const status = fo && here ? fullStatusOf(fo, id, w?.save) : null;
  /** 正在确认删除:那一行小字 */
  const [asking, setAsking] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  /** 刚取回来:给一个「打开」 */
  const [taken, setTaken] = useState(false);
  const [taking, setTaking] = useState(false);
  const pulling = pull?.id === id ? pull : null;
  const at = entry?.uploadedAt ?? fo?.account.find((x) => x.id === id)?.updatedAt ?? '';
  const uploaded = entry ? `${fullDay(at)}传的，${(entry.bytes / 1e6).toFixed(1)} MB` : `${fullDay(at)}传的配方`;
  const small = job
    ? job.phase === 'check'
      ? '已经传完，服务器在检查里面的内容'
      : `正在传，${job.total ? pairText(job.done, job.total) : '别关页面'}`
    : pulling
      ? `正在从账号取，${pulling.total ? pairText(pulling.done, pulling.total) : ''}`
      : taking
        ? '正在从账号取'
        : asking
          ? asking
          : note
            ? [note.text, note.more].filter(Boolean).join('。')
            : err
              ? err
              : !here
                ? `${uploaded}，这台设备上没有`
                : status?.kind === 'changed'
                  ? `${fullDay(at)}传的，之后改过`
                  : uploaded;
  const askRemove = () => {
    setErr('');
    void flow().then(
      (m) => setAsking(m.removeLine(id, shared)),
      () => setErr('出错了，再试一次'),
    );
  };
  const doRemove = () => {
    setBusy(true);
    void flow()
      .then((m) => m.removeFromAccount(id))
      .then(onRemoved, (e: unknown) => setErr(errText(e)))
      .finally(() => {
        setBusy(false);
        setAsking(null);
      });
  };
  const take = () => {
    setErr('');
    setTaking(true);
    void flow()
      .then((m) => m.takeFromAccount(id))
      .then(
        () => setTaken(true),
        // 存档回来了、整个世界没取到:世界还能打开,打开时再试
        (e: unknown) => setErr(isStored(id) ? '存档取回来了，整个世界没取到。打开时会再试' : errText(e)),
      )
      .finally(() => setTaking(false));
  };
  const openIt = () => {
    closeAccountPanel();
    openWorldById(id);
  };
  const thumb = w?.thumb ?? info?.thumb;
  return (
    <div className="acct-gr" data-id={id}>
      <span className="th2" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined} />
      <span className="main">
        <b>{w?.save.title || info?.title || '未命名世界'}</b>
        <small style={{ whiteSpace: 'normal' }}>{small}</small>
      </span>
      {job ? (
        job.phase !== 'check' && (
          <button className="mini" data-act="full-row-cancel" onClick={() => void flow().then((m) => m.cancelUpload())}>
            取消
          </button>
        )
      ) : pulling || taking ? null : asking ? (
        <>
          <button className="mini" data-act="full-row-keep" disabled={busy} onClick={() => setAsking(null)}>
            取消
          </button>
          <button className="mini red" data-act="full-row-remove-yes" disabled={busy} onClick={doRemove}>
            删掉
          </button>
        </>
      ) : (
        <>
          {note?.action && (
            <button className="mini" data-act={note.action.act} onClick={note.action.onClick}>
              {note.action.label}
            </button>
          )}
          {!note?.action && taken && here && (
            <button className="mini" data-act="full-row-open" onClick={openIt}>
              打开
            </button>
          )}
          {!note?.action && !here && inAccount && (
            <button className="mini" data-act="full-row-take" onClick={take}>
              取回
            </button>
          )}
          {!note?.action && status?.kind === 'changed' && (
            <button className="mini" data-act="full-row-again" onClick={() => void flow().then((m) => m.uploadWorld(id))}>
              再传一次
            </button>
          )}
          {inAccount && (
            <button className="mini red" data-act="full-row-remove" onClick={askRemove}>
              删掉
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 退出登录

function LogoutDialog({ phone, onClose, onBack }: { phone: boolean; onClose: () => void; onBack: () => void }) {
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fo = useFullOverview();
  const [notesRead, setNotesRead] = useState(0);
  useEffect(() => {
    void notesReady(listWorlds().map((w) => w.id)).then(() => setNotesRead((n) => n + 1));
  }, []);
  // 世界不会自动进账号:没传过的、传了又改过的,从这台删掉就没了。只传了配方的、AI 写的东西还没读全的,不确知一样也算改过
  const onlyHere = useMemo(
    () =>
      listWorlds().filter((w) => {
        const s = fo ? fullStatusOf(fo, w.id, w.save) : null;
        return !notesKnown(w.id) || !(s?.kind === 'same' || (s?.kind === 'recipe' && s.same));
      }).length,
    [fo, notesRead],
  );
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
          这台设备上的世界要不要留着？
        </p>
        {choice(true, '留在这台设备上', '没登录也能接着看、接着改')}
        {choice(false, '从这台设备上删掉', onlyHere ? `在别人的电脑、网吧用完选这个。有 ${onlyHere} 个世界没传到账号，删掉就没了。先${fo ? '传到账号或' : ''}存成文件` : '在别人的电脑、网吧用完选这个')}
        {err && <p className="acct-err">{err}</p>}
      </div>
      <div className="acct-foot">
        <span className="acct-sp" />
        <button className="acct-btn lg" disabled={busy} onClick={onBack}>
          取消
        </button>
        <button className="acct-btn lg blue" data-act="logout-confirm" disabled={busy} onClick={() => void go()}>
          退出登录
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
      if (await deleteAccount(code)) onClose();
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
function sameLogin(token: string | undefined): void {
  if (!token || getSession()?.token !== token) throw new ShareAborted('账号变了');
}

/** 分享窗里那一行:对方看到的和你不一样、正在传、传没传成。提示条盖不到这个窗口 */
function FullShareRow({ worldId }: { worldId: string }) {
  const fo = useFullOverview();
  const job = useFullJob();
  const notes = useFullNotes();
  useSavesVersion();
  if (!fo) return null;
  const status = fullStatusOf(fo, worldId, loadWorld(worldId)?.save);
  const note = notes[worldId];
  const mine = job?.id === worldId ? job : null;
  const upload = () => void flow().then((m) => m.uploadWorld(worldId));
  const row = (b: string, small: string, act?: { label: string; on: () => void; name: string }, pct?: number) => (
    <div className="acct-grp" data-testid="share-full-row">
      <div className="acct-gr" style={{ minHeight: 58 }}>
        <Icon name="cloudup" size={19} />
        <span className="main">
          <b>{b}</b>
          <small style={{ whiteSpace: 'normal' }}>{small}</small>
          {pct !== undefined && (
            <i className="acct-bar">
              <i style={{ width: `${pct}%` }} />
            </i>
          )}
        </span>
        {act && (
          <button className="mini" data-act={act.name} onClick={act.on}>
            {act.label}
          </button>
        )}
      </div>
    </div>
  );
  if (mine?.phase === 'check') return row('正在核对', '已经传完，服务器在检查里面的内容');
  if (mine) {
    const pct = mine.total ? Math.round((mine.done / mine.total) * 100) : 0;
    return row('正在传到账号', `${mine.total ? pairText(mine.done, mine.total) : ''}${mine.total ? '，' : ''}别关页面`, { label: '取消', name: 'full-row-cancel', on: () => void flow().then((m) => m.cancelUpload()) }, pct);
  }
  if (note) return row(note.text, note.more, note.action ? { label: note.action.label, name: note.action.act, on: note.action.onClick } : undefined);
  if (status.kind === 'same') return null;
  // 别的世界正在传:不能再点
  const act = job ? undefined : { label: status.kind === 'changed' ? '再传一次' : '传到账号', name: 'share-full-upload', on: upload };
  if (status.kind === 'changed') return row(`对方看到的是 ${fullDay(status.entry.uploadedAt)}那份`, '之后的改动还没传。再传一次，对方刷新就能看到', act);
  return row('对方看到的可能和你不一样', '这个链接只带配方，对方打开时重新长一遍。传到账号以后就一模一样', act);
}

function ShareDialog({ phone, worldId, title, onClose }: { phone: boolean; worldId: string; title: string; onClose: () => void }) {
  const fo = useFullOverview();
  useSavesVersion();
  useEffect(() => void askFull(), []);
  useEffect(() => holdFullToasts(worldId), [worldId]);
  const fullKind = fo ? fullStatusOf(fo, worldId, loadWorld(worldId)?.save).kind : 'never';
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
        keepLastBy(share.by ?? '');
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
        keepLastBy(share.by ?? '');
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
        <FullShareRow worldId={worldId} />
        <ul className="acct-notes">
          <li>
            <Icon name="check" size={14} />
            {fullKind === 'same' ? '拿到链接的人看到的和你这里一模一样，不用登录。' : '拿到链接的人能看地图和整段历史，不用登录。'}
          </li>
          {fullKind !== 'changed' && (
            <li>
              <Icon name="check" size={14} />
              {fo ? '你之后改了，再传一次对方才看得到。' : '你之后改了，再点一次「分享…」对方才看得到。'}
            </li>
          )}
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
