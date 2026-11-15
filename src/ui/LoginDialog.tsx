/**
 * 登录窗口(点开才下载;外壳和开关都在 AccountDialogs.tsx)。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons';
import { PRIVACY_URL, TERMS_URL } from './links';
import { refreshOfficialAccount } from '../ai/providers/official';
import { ServerError } from '../account/server';
import { fetchAuthOptions, login, pendingInvite, sendCode, type AuthOptions } from '../account/session';
import { Dialog, codeOf, errText, sendLabel, useCountdown } from './AccountDialogs';
import './account.css';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Sent {
  to: string;
  until: number;
  /** 验证码几秒内有效 */
  ttl: number;
  dev?: string;
}

type Shut = { head: string; sub: string };

/** 登录被拒是因为账号停用了(401 带 ban):红底那块的两句。注销前停用的邮箱再注册,照服务器的话 */
function shutOf(e: unknown): Shut | null {
  if (!(e instanceof ServerError) || e.code !== 'auth' || !e.data.ban || typeof e.data.ban !== 'object') return null;
  const ban = e.data.ban as { reasonText?: unknown; carried?: unknown };
  if (ban.carried === true) {
    const [head, ...rest] = e.message.split('。');
    return { head, sub: rest.join('。') };
  }
  const why = typeof ban.reasonText === 'string' ? ban.reasonText.replace(/[。.]$/, '') : '';
  return { head: '这个账号已停用，登录不了', sub: `${why ? `原因：${why}。` : ''}账号里的世界还在服务器上留着。觉得弄错了，请到 QQ 交流群联系我们。` };
}

export default function LoginDialog({ phone, onClose }: { phone: boolean; onClose: () => void }) {
  const [opts, setOpts] = useState<AuthOptions | null>(null);
  useEffect(() => {
    let live = true;
    void fetchAuthOptions().then((o) => live && setOpts(o));
    return () => {
      live = false;
    };
  }, []);
  const linkInvite = useMemo(() => pendingInvite(), []);
  const [email, setEmail] = useState('');
  const [invite, setInvite] = useState(linkInvite ?? '');
  const [showInvite, setShowInvite] = useState(!!linkInvite);
  const [needInvite, setNeedInvite] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [code, setCode] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState<'send' | 'login' | null>(null);
  const [err, setErr] = useState<{ at: 'email' | 'invite' | 'code'; text: string } | null>(null);
  /** 账号停用了:登录被拒时服务器说的 */
  const [shut, setShut] = useState<Shut | null>(null);
  const left = useCountdown(sent?.until ?? null);
  const emailRef = useRef<HTMLInputElement>(null);
  const inviteRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  useEffect(() => emailRef.current?.focus(), []);

  const inviteOnly = opts?.inviteOnly ?? !!linkInvite;
  const okEmail = EMAIL.test(email.trim());
  const sentNow = !!sent && sent.to === email.trim();
  const canSend = okEmail && !busy && !(sentNow && left > 0);
  const canLogin = sentNow && /^\d{6}$/.test(code.trim()) && agree && !busy;

  const send = async () => {
    if (!canSend) return;
    setBusy('send');
    setErr(null);
    try {
      const r = await sendCode(email, showInvite ? invite : undefined);
      setSent({ to: email.trim(), until: Date.now() + r.resendAfter * 1000, ttl: r.expiresIn ?? opts?.codeTtlSec ?? 600, dev: r.devCode });
      setNeedInvite(false);
      if (r.devCode) setCode(r.devCode);
      setTimeout(() => codeRef.current?.focus(), 0);
    } catch (e) {
      const c = codeOf(e);
      if (c === 'need-invite') {
        setNeedInvite(true);
        setShowInvite(true);
        setTimeout(() => inviteRef.current?.focus(), 0);
      } else if (c === 'bad-invite') {
        setShowInvite(true);
        setErr({ at: 'invite', text: errText(e) });
      } else setErr({ at: 'email', text: errText(e) });
    } finally {
      setBusy(null);
    }
  };
  const submit = async () => {
    if (!canLogin) return;
    setBusy('login');
    setErr(null);
    try {
      await login(email, code, showInvite ? invite : undefined);
      void refreshOfficialAccount();
      onClose();
    } catch (e) {
      const c = codeOf(e);
      const off = shutOf(e);
      if (off) {
        setShut(off);
        setSent(null);
        setCode('');
      } else if (c === 'need-invite' || c === 'bad-invite') {
        setShowInvite(true);
        setErr({ at: 'invite', text: errText(e) });
      } else setErr({ at: 'code', text: errText(e) });
      setBusy(null);
    }
  };
  const fromLink = !!linkInvite && invite === linkInvite && err?.at !== 'invite';
  const mins = Math.max(1, Math.round((sent?.ttl ?? 600) / 60));

  return (
    <Dialog phone={phone} label="登录" onClose={busy ? undefined : onClose} testId="login-dialog">
      <div className="acct-body">
        <div className="acct-seg" role="tablist" aria-label="登录方式">
          <button className="on" role="tab" aria-selected="true">
            邮箱
          </button>
          {/* 手机号登录网页这边还没做:服务器开了也先置灰 */}
          <button role="tab" aria-selected="false" disabled title="手机号登录暂未开放">
            手机号<em>暂未开放</em>
          </button>
        </div>
        <p className="acct-lead">
          {inviteOnly ? '用邮箱收验证码登录，不用设密码。现在是邀请制，新邮箱第一次登录要填邀请码。' : '用邮箱收验证码登录，不用设密码。第一次登录会自动注册。'}
        </p>
        <div>
          <div className="acct-fld">
            <input
              ref={emailRef}
              className="acct-in"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="邮箱"
              aria-label="邮箱"
              data-testid="login-email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (err?.at === 'email') setErr(null);
                if (needInvite) setNeedInvite(false);
                if (shut) setShut(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && void send()}
            />
            <button className="acct-btn lg" data-act="send-code" disabled={!canSend} onClick={() => void send()} style={phone ? { padding: '0 10px' } : undefined}>
              {sendLabel(sentNow, left, busy === 'send')}
            </button>
          </div>
          {err?.at === 'email' && <p className="acct-err">{err.text}</p>}
        </div>
        {shut && (
          <div className="acct-callout bad" data-testid="login-shut">
            <Icon name="ban" size={16} />
            <span>
              <b>{shut.head}</b>
              {shut.sub && (
                <>
                  <br />
                  <span className="sub">{shut.sub}</span>
                </>
              )}
            </span>
          </div>
        )}
        {needInvite && (
          <div className="acct-callout" data-testid="need-invite">
            <Icon name="info" size={16} />
            <span>
              这个邮箱还没有账号。现在只开放给收到邀请的人，填上邀请码就能注册。
              <br />
              <span className="sub">没有邀请码也没关系：不登录照样什么都能用，世界存在这个浏览器里。</span>
            </span>
          </div>
        )}
        {showInvite && (
          <div>
            <label className="acct-in inv">
              <span className="pre">邀请码</span>
              <input
                ref={inviteRef}
                autoComplete="off"
                spellCheck={false}
                data-testid="login-invite"
                value={invite}
                onChange={(e) => {
                  setInvite(e.target.value);
                  if (err?.at === 'invite') setErr(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && void send()}
              />
            </label>
            {fromLink && (
              <p className="acct-okl">
                <Icon name="check" size={14} />
                从邀请链接带过来的，已经填好
              </p>
            )}
            {err?.at === 'invite' && <p className="acct-err">{err.text}</p>}
          </div>
        )}
        <div>
          <input
            ref={codeRef}
            className="acct-in code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="6 位验证码"
            aria-label="验证码"
            data-testid="login-code"
            disabled={!sentNow}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
              if (err?.at === 'code') setErr(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
          {sentNow && (
            <p className="acct-small" style={{ marginTop: 6 }}>
              验证码已发到 {sent!.to}，{mins} 分钟内有效。没收到的话，看看垃圾邮件。
              {sent!.dev && `（开发用假服务器：验证码是 ${sent!.dev}，已经填好）`}
            </p>
          )}
          {err?.at === 'code' && <p className="acct-err">{err.text}</p>}
        </div>
        <label className="acct-chk">
          <input type="checkbox" data-testid="login-agree" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <i className="b" aria-hidden="true">
            {agree && <Icon name="check" size={12} />}
          </i>
          <span>
            已阅读并同意{' '}
            <a href={TERMS_URL} target="_blank" rel="noreferrer">
              用户协议
            </a>{' '}
            和{' '}
            <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
              隐私政策
            </a>
          </span>
        </label>
        {phone && <LoginFoot busy={busy === 'login'} disabled={!canLogin} onLogin={submit} phone />}
      </div>
      {!phone && <LoginFoot busy={busy === 'login'} disabled={!canLogin} onLogin={submit} />}
    </Dialog>
  );
}

function LoginFoot({ busy, disabled, onLogin, phone }: { busy: boolean; disabled: boolean; onLogin: () => void; phone?: boolean }) {
  const line = '登录不会上传世界，世界还存在这个浏览器里。';
  const btn = (
    <button className="acct-btn blue full" data-act="login" disabled={disabled} onClick={onLogin}>
      {busy ? '正在登录' : '登录'}
    </button>
  );
  if (phone)
    return (
      <>
        <div style={{ marginTop: 2 }}>{btn}</div>
        <p className="acct-small center" style={{ marginTop: -4 }}>
          {line}
        </p>
      </>
    );
  return (
    <div className="acct-foot col">
      {btn}
      <p className="acct-small center">{line}</p>
    </div>
  );
}
