/**
 * 作品墙上的两个弹窗(点开才下载):「怎么上作品墙」和新建参数作品的介绍窗。
 */
import { useEffect, useState } from 'react';
import { Icon } from './icons';
import { Dialog } from './AccountDialogs';
import { useContact } from './contact';
import { decodePresetHash } from './presetLink';
import type { SharedPreset } from './presetStore';
import { openRulesSheet } from './rules/sheetStore';
import { rulesUiOn } from './rules/flag';
import { pluginsUiOn } from './plugins/flag';
import { coverUrl, fetchWork, isWorkGone, loadGallery, useGallery, wasReported, type GalleryItem, type GalleryWork } from '../account/gallery';
import { useFullOverview } from './fullWorldView';
import { useServerSubmit } from './submitView';
import { TERMS } from './submitTerms';
import { ReportDialog, presetRows } from './Gallery';
import './gallery.css';

// ---------------------------------------------------------------------------
// 怎么上作品墙

export function HowToDialog({ phone, onClose }: { phone: boolean; onClose: () => void }) {
  const contact = useContact();
  const fullOn = !!useFullOverview();
  const site = useServerSubmit();
  const plugins = site.plugin && pluginsUiOn();
  const three = (
    <div className="acct-grp gl-three">
      <div className="acct-gr">
        <b>作品</b>
        <dl className="gl-kinds">
          <dt>世界</dt>
          <dd>存档菜单里「存成文件」，把文件发给管理员；只会复制配方链接也行，管理员替你存成文件{fullOn ? '；传到账号后发分享链接也行' : ''}</dd>
          <dt>地图</dt>
          <dd>在这张地图上打造一个文明，打开它，在存档菜单里点「复制配方链接」（历史没改过，我们当地图收）</dd>
          <dt>新建参数</dt>
          <dd>预设菜单里的「复制分享链接…」，连规则一起的也行</dd>
          <dt>规则</dt>
          <dd>调规则那一页右上的「分享」，复制链接</dd>
        </dl>
      </div>
      <div className="acct-gr">
        <b>署名</b>
        <span>作品墙上显示的名字，用笔名就行</span>
      </div>
      <div className="acct-gr">
        <b>一句话介绍</b>
        <span>40 字以内，说说它特别在哪</span>
      </div>
    </div>
  );
  const terms = (
    <ol className="gl-ol">
      {TERMS.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ol>
  );
  return (
    <Dialog phone={phone} label="怎么上作品墙" width={600} onClose={onClose} testId="gallery-howto" className="gl-howto">
      {site.on ? (
        <div className="acct-body">
          <p className="acct-lead">作品墙上的作品都是作者投来、我们看过才放上去的。有两种投法：</p>
          <h3 className="gl-h3 gl-way">
            有网站账号：在网站上直接投{site.inviteOnly && <small>现在只开放给收到邀请的人</small>}
          </h3>
          <div className="acct-grp gl-three" data-testid="howto-site">
            <div className="acct-gr">
              <b>在哪投</b>
              <dl className="gl-kinds">
                <dt>世界</dt>
                <dd>存档菜单里的「投到作品墙…」</dd>
                <dt>地图</dt>
                <dd>「我的世界」的「地图」里点开它，点「投到作品墙…」</dd>
                <dt>新建参数</dt>
                <dd>预设菜单里的「投到作品墙…」</dd>
                <dt>规则</dt>
                <dd>调规则那一页右上「···」里</dd>
                {plugins && (
                  <>
                    <dt>插件</dt>
                    <dd>插件页里选中你装上的插件，点「投到作品墙…」</dd>
                  </>
                )}
              </dl>
            </div>
            <div className="acct-gr">
              <b>之后</b>
              <span>结果发邮件告诉你，也在账号窗的「我的投稿」里看；没审之前能撤回</span>
            </div>
          </div>
          <h3 className="gl-h3 gl-way">没有账号：到 QQ 交流群找管理员，带上三样{plugins && <small>插件不收，要在网站上投</small>}</h3>
          {three}
          <p className="acct-small gl-agree">在群里投时回一句“同意在作品墙展示”就行，我们会记下是哪天、在哪同意的。</p>
          <h3 className="gl-h3">投之前请知道</h3>
          {terms}
        </div>
      ) : (
        <div className="acct-body">
          <p className="acct-lead">作品墙上的作品都是作者投来、我们看过才放上去的。网站上不收稿，请到 QQ 交流群里找管理员，带上三样：</p>
          {three}
          <h3 className="gl-h3">投之前请知道</h3>
          {terms}
          <p className="acct-small">投稿时回一句“同意在作品墙展示”就行，我们会记下是哪天、在哪同意的。</p>
        </div>
      )}
      <div className="acct-foot">
        <span className="acct-sp" />
        <button className="acct-btn" data-act="howto-ok" onClick={onClose}>
          知道了
        </button>
        {contact && (
          <a className="acct-btn blue" href={contact.url} target="_blank" rel="noreferrer" data-link="contact">
            <Icon name="bubble" size={15} />
            加交流群
          </a>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 新建参数作品

export function PresetWorkDialog({ phone, w, item, onClose, onUse }: { phone: boolean; w: GalleryWork; item?: GalleryItem; onClose: () => void; onUse: (p: SharedPreset) => void }) {
  const [got, setGot] = useState<{ p: SharedPreset } | { error: string; gone?: boolean } | null>(() => (item ? read(item) : null));
  const [report, setReport] = useState(false);
  const g = useGallery();
  const reported = g.rev >= 0 && wasReported(w.id);
  useEffect(() => {
    if (item) return;
    let alive = true;
    fetchWork(w.id).then(
      (it) => alive && setGot(read(it)),
      (e: unknown) => {
        if (!alive) return;
        if (isWorkGone(e)) {
          setGot({ error: '这个作品已经撤下了', gone: true });
          loadGallery(true);
        } else setGot({ error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      alive = false;
    };
  }, [w.id, item]);
  const ok = got && 'p' in got ? got.p : null;
  // 调规则的入口关着时不露
  const okRules = rulesUiOn() ? ok?.rules : undefined;
  const head = (
    <div className="gl-pcover" style={{ backgroundImage: coverUrl(w.id) ? `url("${coverUrl(w.id)}")` : undefined }}>
      <button className="acct-x" onClick={onClose} title="关闭" aria-label="关闭">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
  return (
    <Dialog phone={phone} label={w.title || '新建参数'} width={560} onClose={onClose} head={head} testId="gallery-preset" className="gl-pdlg">
      <div className="acct-head">
        <h2>{w.title || '未命名'}</h2>
      </div>
      <div className="acct-body">
        <div className="gl-who">
          <span className="gl-tag">新建参数</span>
          {w.by}
        </div>
        {w.blurb && <p className="gl-pblurb">{w.blurb}</p>}
        {ok ? (
          <div className={`acct-grp gl-pp${okRules ? ' rl' : ''}`} data-testid="preset-rows">
            {presetRows(ok).map(([k, v], i, all) => (
              <div className={`acct-gr${i === all.length - 1 && all.length % 2 ? ' wide' : ''}`} key={k}>
                <span className="k">{k}</span>
                <span className="v">{v}</span>
              </div>
            ))}
            {okRules && (
              <button
                className="acct-gr gl-prl"
                data-act="gallery-preset-rules"
                onClick={() => {
                  // 先关掉这张卡:规则那一页盖不住它,在那一页点「用它新建世界」也要回到作品墙上
                  onClose();
                  openRulesSheet({ kind: 'shared', rules: okRules, from: 'link' });
                }}
              >
                <span className="k">规则</span>
                <span className="v">
                  <small>改了 {Object.keys(okRules.values).length + Object.keys(okRules.biomes ?? {}).length} 项</small>
                  {okRules.name}
                  <Icon name="chevron" size={14} />
                </span>
              </button>
            )}
          </div>
        ) : got ? (
          <p className="acct-err" role="alert">
            {(got as { error: string }).error}
          </p>
        ) : (
          <div className="acct-grp gl-pp ghost" aria-busy="true">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div className="acct-gr" key={i}>
                <i className="gl-bar" style={{ width: '40%' }} />
              </div>
            ))}
          </div>
        )}
        {ok && (
          <p className="acct-small">
            {ok.seed !== undefined
              ? '带着种子：新建出来就是上面这颗星球。在新建窗口里换个种子，大陆的样子照这套参数、位置会不一样。'
              : '没带种子：新建时随机一个种子，大陆的样子照这套参数，每次都不一样。'}
            {okRules && `带着规则：打造文明时先选好「${okRules.name}」，到那一步还能换。`}
          </p>
        )}
      </div>
      <div className="acct-foot">
        <button className="acct-btn gl-ghost" data-act="gallery-report" disabled={reported} onClick={() => setReport(true)}>
          <Icon name={reported ? 'check' : 'flag'} size={15} />
          {reported ? '已举报' : '举报'}
        </button>
        <span className="acct-sp" />
        <button className="acct-btn lg blue" data-act="gallery-use-preset" disabled={!ok} onClick={() => ok && onUse(ok)}>
          用这套参数新建
        </button>
      </div>
      {report && <ReportDialog phone={phone} work={w} onClose={() => setReport(false)} />}
    </Dialog>
  );
}

/** 作品里的预设串 → 分享来的那一套(名字用作品名,带上署名) */
function read(it: GalleryItem): { p: SharedPreset } | { error: string } {
  const r = decodePresetHash(`#${it.preset ?? ''}`);
  if (!r.ok) return { error: r.error };
  return { p: { ...r.preset, name: it.title || r.preset.name, gallery: { by: it.by, id: it.id, title: it.title } } };
}
