/**
 * 举报窗(作品墙上的作品、插件,别人的分享短链接):几个理由选一个,不能打字;提交以后"收到了,谢谢"。点了举报才下载。
 */
import { useState } from 'react';
import { isWorkGone, type ReportReason } from '../account/gallery';
import { ServerError } from '../account/server';
import { Dialog } from './AccountDialogs';
import { Icon } from './icons';

/** 作品、分享的六个理由:键、说法、补一句举例 */
export const REPORT_REASONS: readonly { key: ReportReason; title: string; sub?: string }[] = [
  { key: 'illegal', title: '违法违规', sub: '危害国家安全、暴恐、赌博、毒品等' },
  { key: 'porn', title: '色情低俗' },
  { key: 'abuse', title: '辱骂、歧视、人身攻击' },
  { key: 'privacy', title: '写了真人的隐私', sub: '真实的姓名、电话、住址、照片等' },
  { key: 'infringe', title: '侵权', sub: '抄了别人的作品，或者冒用别人的署名' },
  { key: 'other', title: '其他不适合公开展示的内容' },
];

/** reasons = 这一类的理由(插件另一组);extra = 理由下面多说的一句 */
export default function ReportBox({
  phone,
  what,
  lead,
  send,
  onClose,
  reasons = REPORT_REASONS,
  extra,
}: {
  phone: boolean;
  what: 'work' | 'share' | 'plugin';
  lead: string;
  send: (r: string) => Promise<void>;
  onClose: () => void;
  reasons?: readonly { key: string; title: string; sub?: string }[];
  extra?: string;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const work = what !== 'share';
  const plugin = what === 'plugin';
  const undo = plugin ? '停用' : work ? '撤下' : '停掉这个链接';
  const ids = plugin ? 'plugin-report' : work ? 'gallery-report' : 'share-report';
  const submit = async () => {
    if (!reason || busy) return;
    setBusy(true);
    setErr('');
    try {
      await send(reason);
      setDone(true);
    } catch (e) {
      setErr(
        e instanceof ServerError && e.code === 'rate-limit'
          ? '举报太频繁，请稍后再试'
          : work && isWorkGone(e)
            ? '这个作品已经撤下了'
            : e instanceof Error
              ? e.message
              : String(e),
      );
    }
    setBusy(false);
  };
  if (done)
    return (
      <Dialog phone={phone} label="收到了，谢谢" width={400} onClose={onClose} head={<span />} testId={ids.replace('report', 'reported')} className="gw-done">
        <div className="gw-ok">
          <span className="gw-ok-ic">
            <Icon name="check" size={28} />
          </span>
          <h2>收到了，谢谢</h2>
          <p>我们会尽快看。核实有问题就{undo}，结果不另外通知。</p>
          <p className="acct-small">如果是你的{plugin ? '插件' : '作品'}被抄、署名被冒用，请到 QQ 交流群联系我们，方便核实。</p>
        </div>
        <div className="acct-foot">
          <button className="acct-btn lg blue gw-wide" data-act="report-ok" onClick={onClose}>
            好
          </button>
        </div>
      </Dialog>
    );
  const note = <span className="acct-small">不用登录，也不会告诉{work ? '作者' : '分享的人'}是谁举报的。</span>;
  return (
    <Dialog phone={phone} label={plugin ? '举报这个插件' : work ? '举报这个作品' : '举报这个分享'} width={440} onClose={busy ? undefined : onClose} testId={ids} className="gw-report">
      <div className="acct-body">
        <p className="acct-lead">
          {lead}。选一个理由，我们看过后决定要不要{undo}。
        </p>
        <div className="gw-rds" role="radiogroup" aria-label="举报理由">
          {reasons.map((r) => (
            <label key={r.key} className={`acct-radio${reason === r.key ? ' on' : ''}`} data-reason={r.key}>
              <input type="radio" name={`${what}-report`} checked={reason === r.key} onChange={() => setReason(r.key)} />
              <i className="o" aria-hidden="true" />
              <span>
                <b>{r.title}</b>
                {r.sub && <small>{r.sub}</small>}
              </span>
            </label>
          ))}
        </div>
        {extra && <p className="acct-small gw-extra">{extra}</p>}
        {phone && note}
        {err && (
          <p className="acct-err" role="alert">
            {err}
          </p>
        )}
      </div>
      <div className="acct-foot">
        {phone ? (
          <button className="acct-btn full blue" data-act="report-send" disabled={!reason || busy} onClick={() => void submit()}>
            {busy ? '正在提交' : '提交'}
          </button>
        ) : (
          <>
            {note}
            <span className="acct-sp" />
            <button className="acct-btn" data-act="report-cancel" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button className="acct-btn blue" data-act="report-send" disabled={!reason || busy} onClick={() => void submit()}>
              提交
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
