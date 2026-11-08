/**
 * 投插件的窗(插件页「投到作品墙…」点开才下载):交的就是装着的那一份文件,名字、版本照文件。
 * 这个插件上过墙就是「投新的一版」:要写这一版改了什么,署名跟第一次的。插件投稿须知和作品的分开。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './icons';
import { Dialog } from './AccountDialogs';
import { cleanSignature } from '../gen/savefile';
import { useSession } from '../account/session';
import type { Submission, SubmitLimits } from '../account/submissions';
import { TERMS_VERSION } from './submitTerms';
import { askPhone, keepLastBy, lastBy, submitBan, useSubmitBan, useSubmitJob, workKey, type PluginWork } from './submitView';
import { askLimits, clearSubmitResult, holdSubmitToasts, startSubmit, useSubmitResult } from './submitFlow';
import { draftOf, keepDraft, type Draft } from './submitDrafts';
import { PLUGIN_REFUSAL_HEAD, openNotice, type FailAct, type SubmitFail, type SubmitField } from './submitWords';
import { PLUGIN_SHOW, PLUGIN_TERMS, PLUGIN_TERMS_CHECKS, PLUGIN_TERMS_VERSION, addedLines, nextVersion, pluginWall, wallCaps, type PluginWall } from './submitPlugin';
import { CAP_LABEL, moreText, sizeText, versionLabel } from './plugins/pluginWords';
import { PuzzleIcon } from './plugins/entry';
import { ACT_LABEL, DoneNotice, FailBlock, LimitNotice, Notice, NoticeBtn, chars, clip } from './SubmitDialog';
import './submit.css';

const BY_MAX = 20;
const BLURB_MAX = 40;
const NOTE_MAX = 40;
/** 问「我的投稿」太久就先按新插件出窗 */
const ASK_WAIT_MS = 1500;

export default function SubmitPluginDialog({ phone, work, onClose }: { phone: boolean; work: { kind: 'plugin'; plugin: PluginWork }; onClose: () => void }) {
  const p = work.plugin;
  const key = workKey(work);
  useEffect(() => () => clearSubmitResult(key), [key]);
  const session = useSession();
  useEffect(() => holdSubmitToasts(), []);

  const [asked, setAsked] = useState(false);
  const [list, setList] = useState<readonly Submission[]>([]);
  const [wall, setWall] = useState<PluginWall | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [limits, setLimits] = useState<SubmitLimits | null>(null);
  const cachedBan = useSubmitBan();
  const [notice, setNotice] = useState<SubmitFail | null>(() => (submitBan() ? { kind: 'notice', which: 'ban', ban: submitBan()! } : null));
  const [form, setForm] = useState<Draft>(() => draftOf(key) ?? { title: p.name, by: clip(lastBy(), BY_MAX), blurb: clip(p.description, BLURB_MAX), note: '' });
  const [checked, setChecked] = useState(false);
  const [terms, setTerms] = useState(false);
  const [bad, setBad] = useState<SubmitField[]>([]);
  const [noteAsked, setNoteAsked] = useState(false);
  const job = useSubmitJob();
  const mine = job?.id === key ? job : null;
  const result = useSubmitResult(key);

  useEffect(() => {
    let live = true;
    const late = setTimeout(() => setAsked(true), ASK_WAIT_MS);
    void askLimits().then(
      (r) => {
        if (!live) return;
        const w = pluginWall(r.submissions, p.id);
        setLimits(r.limits);
        setList(r.submissions);
        setWall(w);
        setAsked(true);
        const n = openNotice({ limits: r.limits, ban: submitBan() });
        if (n) setNotice(n);
        if (w.up?.status === 'live' && w.up.workId) void wallCaps(w.up.workId).then((caps) => live && caps && setAdded(addedLines(p, caps)));
      },
      () => live && setAsked(true),
    );
    return () => {
      live = false;
      clearTimeout(late);
    };
  }, []);

  const fail = result?.kind === 'fail' ? result.fail : null;
  useEffect(() => {
    if (!fail) return;
    void askLimits().then((r) => {
      setLimits(r.limits);
      setList(r.submissions);
    }, () => {});
    if (fail.kind === 'notice' || fail.kind === 'plugin') setNotice(fail);
    if (fail.kind === 'hits') setBad(fail.fields);
    if (fail.kind === 'note') {
      setNoteAsked(true);
      setBad(['note']);
    }
    if (fail.kind === 'phone') askPhone({ for: 'submit', then: () => clearSubmitResult(key) });
  }, [fail]);

  const up = wall?.up ?? null;
  const needNote = !!up || noteAsked;
  const fixedBy = up && wall?.by ? wall.by : null;
  const set = (k: 'by' | 'blurb' | 'note', v: string, max: number) => {
    const next = { ...form, [k]: clip(v, max) };
    setForm(next);
    keepDraft(key, next);
    if (bad.includes(k)) setBad(bad.filter((x) => x !== k));
  };
  const clean = { by: cleanSignature(fixedBy ?? form.by, BY_MAX), blurb: cleanSignature(form.blurb, BLURB_MAX), note: cleanSignature(form.note ?? '', NOTE_MAX) };
  const filled = !!clean.by && !!clean.blurb && (!needNote || !!clean.note);
  const busy = !!job;
  const canSubmit = filled && checked && !busy;

  const submit = () => {
    if (!canSubmit) return;
    if (!fixedBy) keepLastBy(clean.by);
    setBad([]);
    void startSubmit({
      id: key,
      kind: 'plugin',
      title: p.name,
      form: { title: p.name, by: clean.by, blurb: clean.blurb, terms: TERMS_VERSION },
      moment: null,
      small: { kind: 'plugin', file: p.bytes, ...(needNote ? { note: clean.note } : {}), pluginTerms: PLUGIN_TERMS_VERSION },
      thumb: p.icon,
    });
  };
  const failAct = (a: FailAct) => (a === 'reload' ? location.reload() : submit());

  if (!session || !asked) return null;
  if (result?.kind === 'done') return <DoneNotice phone={phone} left={result.left} email={session.user.account} onClose={onClose} />;
  if (notice?.kind === 'notice') return <LimitNotice phone={phone} fail={notice} ban={notice.ban ?? cachedBan} onClose={onClose} />;
  if (notice?.kind === 'plugin') return <RefusalNotice phone={phone} fail={notice} p={p} list={list} onClose={onClose} />;
  if (terms) return <TermsView phone={phone} onBack={() => setTerms(false)} />;

  const block = fail && !mine && (fail.kind === 'hits' || fail.kind === 'block') ? fail : null;
  const line = fail && !mine && fail.kind === 'line' ? fail.text : null;
  const dim = !!mine;
  const left = limits ? `今天还能投 ${Math.max(0, limits.perDay - limits.usedToday)} 次` : '';
  const primary = mine ? '正在投稿' : block ? ACT_LABEL[block.kind === 'hits' ? 'retry' : block.act] : '投稿';
  const onPrimary = block?.kind === 'block' ? () => failAct(block.act) : submit;
  const primaryOff = mine ? true : block?.kind === 'block' && block.act !== 'retry' ? false : !canSubmit;

  const n = (s: string) => chars(s).length;
  const field = (label: string, side: string, input: ReactNode) => (
    <div className="sub-f">
      <div className="lab">
        {label}
        <small>{side}</small>
      </div>
      {input}
    </div>
  );
  const inCls = (k: SubmitField) => `acct-in${bad.includes(k) ? ' bad' : ''}`;
  const noteIn =
    needNote &&
    field(
      '这一版改了什么',
      `${n(form.note ?? '')} / ${NOTE_MAX}`,
      <input className={inCls('note')} data-act="submit-note" aria-label="这一版改了什么" value={form.note ?? ''} disabled={dim} autoFocus={!phone} onChange={(e) => set('note', e.target.value, NOTE_MAX)} />,
    );
  const byIn = field(
    '署名',
    phone ? '用笔名就行' : '作品墙上显示，用笔名就行',
    <input className={inCls('by')} data-act="submit-by" aria-label="署名" value={fixedBy ?? form.by} disabled={dim || !!fixedBy} onChange={(e) => set('by', e.target.value, BY_MAX)} />,
  );
  const nameIn = field('插件名', '照文件里的', <input className="acct-in" aria-label="插件名" value={p.name} disabled />);
  const blurbIn = field(
    '一句话介绍',
    `${n(form.blurb)} / ${BLURB_MAX}`,
    <textarea className={inCls('blurb')} data-act="submit-blurb" aria-label="一句话介绍" placeholder="说说它特别在哪" rows={2} value={form.blurb} disabled={dim} onChange={(e) => set('blurb', e.target.value.replace(/\n/g, ''), BLURB_MAX)} />,
  );
  const upText = up?.plugin ? versionLabel(up.plugin.version) : '';
  const fileLine = `${p.file}，${sizeText(p.bytes.length)}，开源许可证 ${p.license}。`;
  const whatNote = !up ? '名字、版本、说明照插件文件里的，交上去的就是这个文件，一个字不改。' : up.status === 'live' ? `作品墙上现在是${upText}，新版审过之前照旧是它。` : `${upText}已经不在作品墙上了，这一版审过以后再上墙。`;

  const foot = phone ? (
    <div className="acct-foot col">
      <button className="acct-btn full blue" data-act="submit-go" disabled={primaryOff} onClick={onPrimary}>
        {primary}
      </button>
      {left && (
        <span className="acct-small center" style={{ marginTop: 2 }}>
          {left}
        </span>
      )}
    </div>
  ) : (
    <div className="acct-foot">
      <span className="acct-small">{left}</span>
      <span className="acct-sp" />
      <button className="acct-btn" data-act="submit-close" onClick={onClose}>
        取消
      </button>
      <button className="acct-btn blue" data-act="submit-go" disabled={primaryOff} onClick={onPrimary}>
        {primary}
      </button>
    </div>
  );

  return (
    <Dialog phone={phone} label={up ? '投新的一版' : '投到作品墙'} width={520} onClose={onClose} testId="submit-plugin-dialog">
      <div className="acct-body" style={{ gap: phone ? 12 : 14 }}>
        <div className="sub-what" data-testid="submit-plugin-what">
          {p.icon ? (
            <img className="sub-pic" src={p.icon} alt="" draggable={false} />
          ) : (
            <span className="sub-pic none">
              <PuzzleIcon size={22} />
            </span>
          )}
          <span className="main">
            <span className="t1">
              <span className="sub-k">插件</span>
              <b>{p.name}</b>
              {up ? (
                <span className="sub-vv">
                  {upText}
                  <Icon name="chevron" size={13} />
                  {versionLabel(p.version)}
                </span>
              ) : (
                <span className="sub-ver">{versionLabel(p.version)}</span>
              )}
            </span>
            <small>
              {fileLine}
              {whatNote}
            </small>
            {p.lines.length > 0 && (
              <span className="sub-caps">
                {p.lines.map((k) => (
                  <span key={k} className={`sub-cap${added.includes(k) ? ' new' : ''}`}>
                    {CAP_LABEL[k] ?? k}
                    {added.includes(k) ? '（新）' : ''}
                  </span>
                ))}
              </span>
            )}
          </span>
        </div>
        {!phone && added.length > 0 && (
          <div className="acct-callout sub-warn" data-testid="submit-plugin-more">
            <Icon name="warn" size={16} />
            <span>
              {moreText(added.length)}
              <b>{added.map((k) => CAP_LABEL[k] ?? k).join('、')}</b>。装了旧版的人更新时会再问他们一次。
            </span>
          </div>
        )}
        {noteIn}
        {phone ? (
          byIn
        ) : (
          <div className="sub-row2">
            {byIn}
            {nameIn}
          </div>
        )}
        {blurbIn}
        {block && <FailBlock fail={block} kind="plugin" />}
        <div className={`acct-callout sub-show${dim ? ' sub-dim' : ''}`}>
          <Icon name="info" size={16} />
          <span>{PLUGIN_SHOW}</span>
        </div>
        <label className={`acct-chk${dim ? ' sub-dim' : ''}`}>
          <input type="checkbox" data-act="submit-agree" checked={checked} disabled={dim} onChange={(e) => setChecked(e.target.checked)} />
          <i className="b" aria-hidden="true">
            {checked && <Icon name="check" size={12} />}
          </i>
          <span>
            我看过
            <button type="button" className="sub-link" data-act="submit-terms" onClick={(e) => (e.preventDefault(), setTerms(true))}>
              插件投稿须知
            </button>
            （{PLUGIN_TERMS.length} 条）
          </span>
        </label>
        {line && <p className="acct-err">{line}</p>}
      </div>
      {foot}
    </Dialog>
  );
}

/** 插件投稿须知:换掉投稿窗显示,「知道了」回去 */
function TermsView({ phone, onBack }: { phone: boolean; onBack: () => void }) {
  return (
    <Dialog phone={phone} label="插件投稿须知" width={500} onClose={onBack} testId="submit-plugin-terms">
      <div className="acct-body sub-tight">
        <p className="acct-lead">投插件之前请看完。和投世界、地图那份须知不一样，第 {PLUGIN_TERMS_VERSION} 版。</p>
        <div className="sub-terms">
          <div className="hd">
            插件投稿须知<small>第 {PLUGIN_TERMS_VERSION} 版</small>
          </div>
          <ol className="gl-ol">
            {PLUGIN_TERMS.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </div>
        <p className="acct-small">{PLUGIN_TERMS_CHECKS}</p>
      </div>
      <div className={`acct-foot${phone ? ' col' : ''}`}>
        <span className="acct-sp" />
        <button className={`acct-btn blue ${phone ? 'full' : 'lg'}`} data-act="submit-terms-ok" onClick={onBack}>
          知道了
        </button>
      </div>
    </Dialog>
  );
}

/** 插件才有的四种投不成 */
function RefusalNotice({ phone, fail, p, list, onClose }: { phone: boolean; fail: Extract<SubmitFail, { kind: 'plugin' }>; p: PluginWork; list: readonly Submission[]; onClose: () => void }) {
  const h = PLUGIN_REFUSAL_HEAD[fail.which];
  const ok = (
    <NoticeBtn phone={phone} blue act="submit-ok" onClick={onClose}>
      好
    </NoticeBtn>
  );
  const common = { phone, h, btns: ok, onClose, testId: `submit-plugin-${fail.which}` };
  if (fail.which === 'taken')
    return (
      <Notice
        {...common}
        icon="ban"
        tone="sub-red"
        p={`作品墙上已经有编号 ${p.id} 的插件，是别的账号投的。`}
        small="改一下插件文件里的编号（plugin.json 的 id）再打包投；你就是原作者、换了账号的，到 QQ 交流群找管理员。"
      />
    );
  if (fail.which === 'version')
    return (
      <Notice
        {...common}
        icon="info"
        tone="sub-blue"
        p={fail.version ? `作品墙上「${p.name}」已经是${versionLabel(fail.version)}，新投的要比它大，比如 ${nextVersion(fail.version)}。` : `新投的版本号要比作品墙上「${p.name}」那一版大。`}
        small="改插件文件里的版本号（version）再打包投。"
      />
    );
  if (fail.which === 'license')
    return (
      <Notice
        {...common}
        icon="warn"
        tone="sub-amber"
        p={`清单里的许可证写的是「${p.license}」。作品墙只收开源许可证（MIT、Apache-2.0、GPL-3.0 这类），包里还要带许可证全文（LICENSE）。`}
        small="还没上墙之前，从文件装照样能用。"
      />
    );
  const waiting = (fail.waitingId !== undefined ? list.find((s) => s.id === fail.waitingId) : null) ?? pluginWall(list, p.id).waiting;
  return (
    <Notice
      {...common}
      icon="clock"
      tone="sub-grey"
      p={`「${p.name}」${waiting?.plugin ? versionLabel(waiting.plugin.version) : '有一版'}还在等审，审完了再投下一版。`}
      small="要改就先到账号窗「我的投稿」里撤回它，再投新的。"
    />
  );
}
