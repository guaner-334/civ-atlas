/**
 * 作品墙上的插件:「插件」页签里的卡片、点开的详情(试跑截图、要用到什么、版本和文件、举报、装上)。
 * 装上弹的是插件页那张权限框(审过的那种),装好以后详情里换成「已装上」;装着旧版的换成「更新…」。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { coverUrl, fetchWork, isWorkGone, loadGallery, reportWork, useGallery, wasReported, type GalleryWork } from '../../account/gallery';
import { serverBase } from '../../account/server';
import { PLUGIN_FILE_EXT, PluginFileError } from '../../plugin/pluginFile';
import { listPlugins, type InstalledPlugin } from '../../plugin/pluginStore';
import { Dialog } from '../AccountDialogs';
import { createListeners } from '../createStore';
import { dayText, workWho } from '../Gallery';
import ReportBox from '../ReportBox';
import { Icon } from '../icons';
import { openPlugins, subscribePluginsOpen } from './entry';
import { capChips, compareVersions, wallPlugin, wallPlugins, type WallPlugin } from './galleryPlugin';
import { noteWall, wallFile } from './galleryWatch';
import { Ico, InstallBox, Perms, SaidBox, UpdateBox, installAsk, type Ask, type Said } from './PluginWindow';
import { PluginIcon } from './pluginIcons';
import { addedLines, sizeText, versionLabel } from './pluginText';
import { useVerdicts, verdictOf } from './verdict';
import './galleryPlugins.css';

// ---------------------------------------------------------------------------
// 这个浏览器里装着哪些(卡片上的「已装上」、详情的按钮)

let installed: InstalledPlugin[] | null = null;
const installedChanged = createListeners();

function refreshInstalled(): Promise<void> {
  return listPlugins().then(
    (l) => {
      installed = l;
      installedChanged.emit();
    },
    () => {},
  );
}

function useInstalled(): InstalledPlugin[] | null {
  useEffect(() => {
    void refreshInstalled();
    // 插件页里删了、关了:关上插件页时重新看一遍
    return subscribePluginsOpen((on) => void (on || refreshInstalled()));
  }, []);
  return installedChanged.use(() => installed);
}

const iconUrl = (w: GalleryWork, p: WallPlugin): string | null => {
  const base = serverBase();
  return p.icon && base ? `${base}/v1/gallery/${encodeURIComponent(w.id)}/icon` : null;
};

const titleOf = (w: GalleryWork, p: WallPlugin) => w.title || p.name || '未命名插件';

/** 装着的和作品墙上这一版比:没装 / 一样 / 装着旧的 / 装着别的(更新或者从文件装的) */
function haveOf(list: readonly InstalledPlugin[] | null, p: WallPlugin): { kind: 'none' | 'same' | 'older' | 'other'; plugin?: InstalledPlugin } {
  const had = list?.find((x) => x.id === p.id);
  if (!had) return { kind: 'none' };
  if (had.current.sum === p.sum) return { kind: 'same', plugin: had };
  return { kind: compareVersions(p.version, had.current.manifest.version) > 0 ? 'older' : 'other', plugin: had };
}

// ---------------------------------------------------------------------------
// 卡片

function Caps({ p, license }: { p: WallPlugin; license?: boolean }) {
  return (
    <span className="pw-caps">
      {capChips(p).map((c) => (
        <span key={c.key} className={`pw-cap${c.loud ? ' y' : ''}`}>
          {c.text}
        </span>
      ))}
      {license && p.license && <span className="pw-lic">开源 {p.license}</span>}
    </span>
  );
}

/** 「插件」页签:电脑四列,手机一行一个 */
export function PluginCards({ works, phone, onOpen }: { works: readonly GalleryWork[]; phone: boolean; onOpen: (w: GalleryWork) => void }) {
  useVerdicts();
  const list = useInstalled();
  useEffect(() => noteWall(works), [works]);
  const items = wallPlugins(works).filter(({ p }) => !verdictOf(p.sum, p.id).blocked);
  if (!items.length) return <p className="gl-none">还没有插件</p>;
  return (
    <div className={phone ? 'pw-list' : 'gl-grid'} role="list" data-testid="gallery-plugins">
      {items.map(({ w, p }) => {
        const have = haveOf(list, p).kind !== 'none';
        const title = titleOf(w, p);
        const blurb = w.blurb || p.description || '';
        const cover = coverUrl(w.id);
        const bg = cover ? { backgroundImage: `url("${cover}")` } : undefined;
        if (phone)
          return (
            <button key={w.id} className="gl-card pw-card pw-row" role="listitem" data-work={w.id} data-kind="plugin" onClick={() => onOpen(w)}>
              <span className="gl-cover" style={bg} />
              <span className="pw-body">
                <span className="pw-head">
                  <PluginIcon src={iconUrl(w, p)} size="sm" className="pw-ic" />
                  <b className="gl-name">{title}</b>
                  <span className="plg-tag">{versionLabel(p.version)}</span>
                  {have && <span className="plg-tag ok">已装上</span>}
                </span>
                <span className="gl-by">
                  {w.by ? `${w.by}，` : ''}开源 {p.license}
                </span>
                {blurb && <span className="gl-blurb">{blurb}</span>}
                <Caps p={p} />
              </span>
            </button>
          );
        return (
          <button key={w.id} className="gl-card pw-card" role="listitem" data-work={w.id} data-kind="plugin" onClick={() => onOpen(w)}>
            <span className="gl-cover" style={bg}>
              <span className="gl-tags">
                <span className="gl-tag">插件</span>
              </span>
              {have && (
                <span className="pw-have">
                  <Icon name="check" size={12} />
                  已装上
                </span>
              )}
            </span>
            <span className="pw-head">
              <PluginIcon src={iconUrl(w, p)} size="md" className="pw-ic" />
              <span className="pw-tt">
                <span className="gl-row1">
                  <b className="gl-name">{title}</b>
                  <span className="gl-at">{dayText(p.updatedAt || w.addedAt)}</span>
                </span>
                <span className="gl-by pw-by">
                  {w.by}
                  <span className="plg-tag">{versionLabel(p.version)}</span>
                  <span className="plg-tag ok">审过</span>
                </span>
              </span>
            </span>
            {blurb && <span className="gl-blurb">{blurb}</span>}
            <Caps p={p} license />
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 举报

/** 插件那一组理由(只能选,不能写字) */
export const PLUGIN_REPORT_REASONS: readonly { key: string; title: string; sub?: string }[] = [
  { key: 'impersonate', title: '冒充网站，或者让人输入密码、密钥', sub: '仿网站的提示、要你填账号、AI 密钥等' },
  { key: 'mismatch', title: '做的和说的不一样', sub: '偷偷改了说明里没写的东西，或者过几天换了做法' },
  { key: 'illegal', title: '违法违规', sub: '危害国家安全、暴恐、赌博、毒品等' },
  { key: 'porn', title: '色情低俗、辱骂歧视' },
  { key: 'infringe', title: '侵权', sub: '抄了别人的插件，或者冒用别人的名字' },
  { key: 'other', title: '其他不适合放在作品墙上的' },
];

// ---------------------------------------------------------------------------
// 详情

type Step = { kind: 'ask'; a: Ask } | { kind: 'said'; said: Said };

/**
 * 点开一个插件:id = 作品编号;w / item = 已经有的(作品墙上点的、打开网址时取好的),没有就去取。
 * inPlace = 放在作品墙那一页里(提示条盖得住它);onUpdate = 在插件页里点「看看」打开的:装着旧版时「更新…」交给插件页
 */
export function PluginWorkDialog({
  id,
  w: w0,
  item,
  phone,
  inPlace,
  onClose,
  onUpdate,
}: {
  id: string;
  w?: GalleryWork;
  item?: GalleryWork;
  phone: boolean;
  inPlace?: boolean;
  onClose: () => void;
  onUpdate?: () => void;
}) {
  const [full, setFull] = useState<GalleryWork | null>(item ?? null);
  const [gone, setGone] = useState('');
  const [step, setStep] = useState<Step | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [shot, setShot] = useState(0);
  const [lic, setLic] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const g = useGallery();
  const list = useInstalled();
  useVerdicts();
  useEffect(() => {
    if (item) return;
    let alive = true;
    fetchWork(id).then(
      (it) => alive && setFull(it),
      (e: unknown) => {
        if (!alive) return;
        if (isWorkGone(e)) {
          setGone('这个插件已经撤下了');
          loadGallery(true);
        } else setGone(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [id, item]);
  // 权限框开着时 Esc 回到详情(详情窗那时不在,它的 Esc 不管用)
  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return;
      e.stopPropagation();
      setStep(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step, busy]);
  const w = full ?? w0 ?? null;
  const p = w ? wallPlugin(w.plugin) : null;

  const finish = async (a: Ask) => {
    setBusy(true);
    try {
      await installAsk(a, phone);
      setStep(null);
      await refreshInstalled();
    } catch {
      setStep({ kind: 'said', said: { kind: 'failed', name: a.opened.manifest.name } });
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!w || !p) return;
    setBusy(true);
    setErr('');
    try {
      const { bytes, opened } = await wallFile(w.id, p.sum);
      const m = opened.manifest;
      const v = verdictOf(opened.sum, m.id);
      if (v.blocked) return setStep({ kind: 'said', said: { kind: 'blocked', name: m.name, version: m.version, ...v.blocked } });
      const old = (await listPlugins().catch(() => [] as InstalledPlugin[])).find((x) => x.id === m.id);
      if (old?.current.sum === opened.sum) return void (await refreshInstalled());
      if (!old) return setStep({ kind: 'ask', a: { kind: 'install', bytes, opened, file: '从作品墙装', verdict: { reviewed: true, blocked: null }, work: w.id } });
      const a: Ask = { kind: 'update', bytes, opened, file: '', old, added: addedLines(old.current.manifest, m), work: w.id, note: p.note };
      if (a.added.length) setStep({ kind: 'ask', a });
      else await finish(a);
    } catch (e) {
      if (e instanceof PluginFileError && e.kind === 'newer') setStep({ kind: 'said', said: { kind: 'newer', name: e.plugin ?? p.name, need: e.need ?? '新版网站的东西' } });
      else setErr(`没取到插件文件：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const showLicense = async () => {
    if (lic !== null) return setLic(null);
    if (!w || !p) return;
    try {
      const { opened } = await wallFile(w.id, p.sum);
      const text = opened.files.get('LICENSE');
      setLic(text ? new TextDecoder().decode(text) : '');
    } catch (e) {
      setErr(`没取到插件文件：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (step) {
    const back = () => setStep(null);
    const box =
      step.kind === 'said' ? (
        <SaidBox said={step.said} phone={phone} onOk={back} />
      ) : step.a.kind === 'install' ? (
        <InstallBox ask={step.a} phone={phone} busy={busy} onCancel={back} onOk={() => void finish(step.a)} />
      ) : (
        <UpdateBox ask={step.a} phone={phone} icon={null} busy={busy} onCancel={back} onOk={() => void finish(step.a)} />
      );
    return createPortal(
      <div
        className={`plg-bg ask${phone ? ' phone' : ''}`}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (e.target === e.currentTarget && !busy) back();
        }}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {box}
      </div>,
      document.body,
    );
  }

  const label = w && p ? titleOf(w, p) : '插件';
  const close = (
    <button className="acct-x" onClick={onClose} title="关闭" aria-label="关闭">
      <Icon name="close" size={14} />
    </button>
  );
  if (gone || !w || !p)
    return (
      <Dialog phone={phone} label={label} width={600} onClose={onClose} head={<span />} testId="gallery-plugin" className="gl-pdlg pw-dlg" inPlace={inPlace}>
        <div className="gl-pcover pw-cover ghost">{close}</div>
        <div className="acct-body">
          {gone || (w && !p) ? (
            <p className="acct-err" role="alert">
              {gone || '这个插件读不出来了'}
            </p>
          ) : (
            <>
              <i className="gl-bar" style={{ width: '40%', height: 16 }} />
              <i className="gl-bar" style={{ width: '70%' }} />
              <i className="gl-bar" style={{ width: '90%' }} />
            </>
          )}
        </div>
        <div className="acct-foot" />
      </Dialog>
    );

  const shots = p.shots;
  const seed = shots.length ? shots[Math.min(shot, shots.length - 1)] : undefined;
  const cover = coverUrl(w.id, seed);
  const have = haveOf(list, p);
  const reported = g.rev >= 0 && wasReported(w.id);
  const vers = p.versions.length ? p.versions : [{ version: p.version, sum: p.sum, at: p.updatedAt, note: p.note }];
  const reportBtn = (
    <button className="acct-btn gl-ghost" data-act="gallery-report" disabled={reported} onClick={() => setReport(true)} title={reported ? '已举报' : '举报'} aria-label={reported ? '已举报' : '举报'}>
      <Icon name={reported ? 'check' : 'flag'} size={phone ? 19 : 15} />
      {!phone && (reported ? '已举报' : '举报')}
    </button>
  );
  const goPage = (
    <button
      className={`acct-btn gl-ghost pw-go${phone ? ' full' : ''}`}
      data-act="plugins-open"
      onClick={() => {
        onClose();
        openPlugins();
      }}
    >
      去插件页
    </button>
  );
  const main =
    have.kind === 'none' || (have.kind === 'older' && !onUpdate) ? (
      <button className={`acct-btn blue${phone ? ' full' : ''}`} data-act="gallery-plugin-install" disabled={busy} onClick={() => void start()}>
        {have.kind === 'older' ? '更新…' : '装上'}
      </button>
    ) : have.kind === 'older' ? (
      <button className={`acct-btn blue${phone ? ' full' : ''}`} data-act="gallery-plugin-install" disabled={busy} onClick={onUpdate}>
        更新…
      </button>
    ) : (
      <button className={`acct-btn pw-have-btn${phone ? ' full' : ''}`} data-act="gallery-plugin-have" disabled>
        <Icon name="check" size={15} />
        已装上
      </button>
    );
  const base = serverBase();
  const download = base ? `${base}/v1/gallery/${encodeURIComponent(w.id)}/plugin` : '';
  return (
    <Dialog phone={phone} label={label} width={600} onClose={onClose} head={<span />} testId="gallery-plugin" className="gl-pdlg pw-dlg" inPlace={inPlace}>
      <div className="pw-scroll">
        <div className="gl-pcover pw-cover" style={cover ? { backgroundImage: `url("${cover}")` } : undefined}>
          {seed !== undefined && <span className="pw-shot">审核时在种子 {seed} 上跑出来的样子</span>}
          {shots.length > 1 && (
            <span className="pw-dots">
              {shots.map((s, i) => (
                <button key={s} className={i === shot ? 'on' : ''} aria-label={`种子 ${s}`} onClick={() => setShot(i)} />
              ))}
            </span>
          )}
          {close}
        </div>
        <div className="acct-body">
          <div className="pw-title">
            <PluginIcon src={iconUrl(w, p)} size="lg" className="pw-ic" />
            <div>
              <h2>
                {label}
                <span className="plg-tag">{versionLabel(p.version)}</span>
              </h2>
              <div className="plg-by">{[w.by ? `${w.by} 写的` : '', `开源许可证 ${p.license}`, p.bytes ? sizeText(p.bytes) : ''].filter(Boolean).join('，')}</div>
            </div>
            {phone && reportBtn}
          </div>
          <div className="plg-st ok">
            <Ico name="shield" size={15} />
            作品墙审过这一版{!phone && <small>（有人看过它的代码，也在示例世界上跑过）</small>}
          </div>
          {(w.blurb || p.description) && <p className="pw-blurb">{w.blurb || p.description}</p>}
          <div className="plg-sec">它要用到</div>
          <Perms m={p} />
          <div className="plg-sec">版本和文件</div>
          <div className="plg-grp plg-kv pw-kv" data-testid="plugin-versions">
            {vers.slice(0, phone ? 2 : 3).map((v, i) => (
              <Row key={v.sum} k={i === 0 ? '这一版' : i === 1 ? '以前的' : ''}>
                <b>{versionLabel(v.version)}</b>
                {v.at && `，${dayText(v.at)}审过`}
                {v.note && `：${v.note}`}
              </Row>
            ))}
            {!phone && (
              <Row k="文件">
                {p.bytes ? `${sizeText(p.bytes)}，` : ''}开源许可证 {p.license}（
                <button className="pw-lnk" data-act="plugin-license" onClick={() => void showLicense()}>
                  {lic === null ? '看全文' : '收起'}
                </button>
                ）
                {download && (
                  <a className="pw-lnk pw-dl" href={download} download={`${p.id}${PLUGIN_FILE_EXT}`} data-link="plugin-file">
                    <Icon name="download" size={13} />
                    下载插件文件
                  </a>
                )}
              </Row>
            )}
          </div>
          {lic !== null && <pre className="pw-lictext">{lic || '插件文件里没有许可证全文'}</pre>}
          {err && (
            <p className="acct-err" role="alert">
              {err}
            </p>
          )}
        </div>
      </div>
      {phone ? (
        <div className="acct-foot col pw-foot">
          {main}
          {have.kind !== 'none' && !onUpdate && goPage}
        </div>
      ) : (
        <div className="acct-foot pw-foot">
          {reportBtn}
          <span className="acct-sp" />
          {have.kind !== 'none' && !onUpdate && goPage}
          {main}
        </div>
      )}
      {report && (
        <ReportBox
          phone={phone}
          what="plugin"
          lead={`${workWho(w)}${versionLabel(p.version)}`}
          reasons={PLUGIN_REPORT_REASONS}
          extra="算得不对、用不了，不算违规：插件详情里有作者写的说明，也可以到 QQ 交流群说。"
          send={(r) => reportWork(w.id, r)}
          onClose={() => setReport(false)}
        />
      )}
    </Dialog>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <span>{k}</span>
      <div>{children}</div>
    </>
  );
}
