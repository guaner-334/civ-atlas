/** 绑手机号(服务器要求投稿、开分享前先绑)、换手机号(账号窗里「换一个」)。点开才下载 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Dialog, codeOf, errText, sendLabel, useCountdown, type PhoneMode } from './AccountDialogs';
import { ServerError } from '../account/server';
import { getSession } from '../account/session';
import { bindPhone, cleanPhone, sendPhoneCode } from '../account/phone';
import { readBan, setKnownPhone, setSubmitBan, usePhone } from './submitView';

type Err = { at: 'phone' | 'code' | 'foot'; text: string };

interface Sent {
  /** 发到的号码(11 位) */
  num: string;
  /** 打星的写法 */
  to: string;
  until: number;
  ttl: number;
  dev?: string;
}

const OK_LABEL: Record<PhoneMode, string> = { submit: '绑定并接着投稿', share: '绑定并接着分享', account: '绑定', change: '换成新号' };

/** 填的号码按 3 4 4 隔开 */
const spaced = (d: string) => [d.slice(0, 3), d.slice(3, 7), d.slice(7)].filter(Boolean).join(' ');
/** 框里的字 → 号码(只留数字;贴进来带 86 的去掉) */
function digitsOf(s: string): string {
  const d = s.replace(/\D/g, '');
  return (d.length > 11 && d.startsWith('86') ? d.slice(2) : d).slice(0, 11);
}

function errOf(e: unknown, change: boolean, step: 'send' | 'bind'): Err {
  switch (codeOf(e)) {
    case 'bad-code':
      return { at: 'code', text: '验证码不对或者过期了。再看一眼短信，或者重发一次' };
    case 'bad-phone':
      return { at: 'phone', text: '手机号要 11 位，再看一眼' };
    case 'phone-taken':
      return { at: 'phone', text: '这个手机号已经绑了别的账号。一个手机号只能绑一个账号' };
    case 'phone-blocked':
      return { at: 'phone', text: '这个手机号不能用来绑定。有疑问请到 QQ 交流群联系我们' };
    case 'phone-same':
      return { at: 'phone', text: '这就是现在绑的号，填一个新的号' };
    case 'rate-limit':
      return { at: 'phone', text: '发得太频繁了，过一会儿再试' };
    case 'unavailable':
      return step === 'send' ? { at: 'phone', text: '短信没发出去，过一会儿再试' } : { at: 'code', text: errText(e) };
    case 'submit-banned':
      return { at: 'phone', text: change ? '你的账号已停止投稿，不能换手机号' : errText(e) };
    case 'network':
      return { at: 'foot', text: '连不上服务器，联网后再试' };
    default:
      return { at: 'foot', text: errText(e) };
  }
}

export default function PhoneDialog({ phone, mode, onDone, onClose }: { phone: boolean; mode: PhoneMode; onDone: () => void; onClose: () => void }) {
  const change = mode === 'change';
  const now = usePhone();
  const [digits, setDigits] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'bind' | null>(null);
  const [err, setErr] = useState<Err | null>(null);
  const left = useCountdown(sent?.until ?? null);
  const numRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  /** 改号码时光标前有几位数字(加空格以后放回同一位) */
  const caret = useRef<number | null>(null);
  useEffect(() => numRef.current?.focus(), []);
  useLayoutEffect(() => {
    const el = numRef.current;
    const n = caret.current;
    if (!el || n === null || document.activeElement !== el) return;
    caret.current = null;
    let at = 0;
    for (let seen = 0; at < el.value.length && seen < n; at++) if (/\d/.test(el.value[at])) seen++;
    el.setSelectionRange(at, at);
  }, [digits]);

  const num = cleanPhone(digits);
  const sentNow = !!sent && sent.num === num;
  const canSend = !!digits && !busy && !(sentNow && left > 0);
  const canOk = sentNow && /^\d{6}$/.test(code) && !busy && err?.at !== 'code' && err?.at !== 'phone';

  const fail = (e: unknown, step: 'send' | 'bind') => {
    if (e instanceof ServerError && e.code === 'submit-banned') setSubmitBan(readBan(e.data.ban));
    setErr(errOf(e, change, step));
  };
  const send = async () => {
    if (!canSend) return;
    if (!num) return setErr({ at: 'phone', text: '手机号要 11 位，再看一眼' });
    setBusy('send');
    setErr(null);
    try {
      const r = await sendPhoneCode(num);
      setSent({ num, to: r.to, until: Date.now() + r.resendAfter * 1000, ttl: r.expiresIn, dev: r.devCode });
      setCode(r.devCode ?? '');
      setTimeout(() => codeRef.current?.focus(), 0);
    } catch (e) {
      fail(e, 'send');
    } finally {
      setBusy(null);
    }
  };
  const ok = async () => {
    if (!canOk || !sent) return;
    setBusy('bind');
    setErr(null);
    const token = getSession()?.token;
    try {
      const got = await bindPhone(sent.num, code);
      // 等回话的工夫别的标签页换了账号:绑上的是原来那个账号的号,不记到新账号上、也不接着做
      if (getSession()?.token !== token) return;
      setKnownPhone(got);
      onDone();
    } catch (e) {
      if (getSession()?.token !== token) return;
      fail(e, 'bind');
      setBusy(null);
    }
  };

  const title = change ? '换手机号' : '先绑定手机号';
  const lead = change
    ? `现在绑的是 ${now?.masked ?? '原来的号'}。验证码会发到新号上，填对了才换；没换好之前，还是原来的号。`
    : '按国家规定，在网站上投稿、开分享链接，要先绑定手机号。手机号不会给别人看，作品墙上也不显示。';
  const small = change ? '一个手机号只能绑一个账号。换好以后，原来的号就解绑了。' : '只绑一次，以后投稿、分享都不用再验。一个手机号只能绑一个账号。不绑也能照常登录、传到账号、存成文件。';
  const mins = Math.max(1, Math.round((sent?.ttl ?? 600) / 60));
  const okBtn = (
    <button className={`acct-btn blue${phone ? ' full' : ''}`} data-act="phone-ok" disabled={!canOk} onClick={() => void ok()}>
      {busy === 'bind' ? (change ? '正在换' : '正在绑定') : OK_LABEL[mode]}
    </button>
  );
  return (
    <Dialog phone={phone} label={title} width={440} onClose={busy ? undefined : onClose} testId="phone-dialog">
      <div className="acct-body">
        <p className="acct-lead">{lead}</p>
        <div>
          <div className="acct-fld">
            <label className={`acct-in inv${err?.at === 'phone' ? ' bad' : ''}`}>
              <span className="pre" style={{ width: '3.2em' }}>
                +86
              </span>
              <input
                ref={numRef}
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder={change ? '新手机号' : '手机号'}
                aria-label={change ? '新手机号' : '手机号'}
                data-testid="phone-number"
                style={{ letterSpacing: '0.5px', fontWeight: 400 }}
                value={spaced(digits)}
                onChange={(e) => {
                  const el = e.target;
                  caret.current = digitsOf(el.value.slice(0, el.selectionStart ?? el.value.length)).length;
                  setDigits(digitsOf(el.value));
                  if (err?.at === 'phone' || err?.at === 'foot') setErr(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && void send()}
              />
            </label>
            <button className="acct-btn lg" data-act="phone-send" disabled={!canSend} onClick={() => void send()} style={{ flex: 'none', ...(phone ? { padding: '0 10px' } : {}) }}>
              {sendLabel(sentNow, left, busy === 'send')}
            </button>
          </div>
          {err?.at === 'phone' && <p className="acct-err">{err.text}</p>}
        </div>
        <div>
          <input
            ref={codeRef}
            className={`acct-in code${err?.at === 'code' ? ' bad' : ''}`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="6 位验证码"
            aria-label="验证码"
            data-testid="phone-code"
            disabled={!sentNow}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
              if (err?.at === 'code' || err?.at === 'foot') setErr(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && void ok()}
          />
          {err?.at === 'code' ? (
            <p className="acct-err">{err.text}</p>
          ) : (
            sentNow && (
              <p className="acct-small" style={{ marginTop: 6 }}>
                验证码发到了 {sent!.to}，{mins} 分钟内有效。
                {sent!.dev && `（开发用假服务器：验证码是 ${sent!.dev}，已经填好）`}
              </p>
            )
          )}
        </div>
        <p className="acct-small">{small}</p>
        {err?.at === 'foot' && <p className="acct-err">{err.text}</p>}
      </div>
      {phone ? (
        <div className="acct-foot col">{okBtn}</div>
      ) : (
        <div className="acct-foot">
          <span className="acct-sp" />
          <button className="acct-btn" data-act="phone-cancel" disabled={!!busy} onClick={onClose}>
            取消
          </button>
          {okBtn}
        </div>
      )}
    </Dialog>
  );
}
