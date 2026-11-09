/**
 * 世界用的推演插件本机对不上时、要接着推之前问的窗(world/simNow.ts 的 askSims):
 *   没装   「要先装「魔力」第 1.0 版」:作品墙上正是这一版就给「去作品墙装同一版」(直接弹权限框),不是就说向分享世界的人要文件
 *   被停用了 「「魔力」被网站停用了」:不再跑,只给「另存一份，不带它重推」(不给去作品墙装)
 *   别的版本「另存一份再推演？」:和旧版本世界问的那一个窗一样,另存「…（新版）」按本机这一版从第 0 年重推
 * 没装的先说(另存时没装的带不上);装齐了再点,才轮到停用的、另存。
 * 网站关了插件(插件界面关着)时不跑、也装不了,只问「网站暂时关了插件」:另存一份不带它们的,或者取消。
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import type { SimPluginCheck } from '../../plugin/pluginWorld';
import { Dialog } from '../AccountDialogs';
import { askSims, type SimAsk } from '../world/simAsk';
import { PluginIcon } from './pluginIcons';
import { noWallVersionText, versionLabel } from './pluginWords';
import { serverBase } from '../../account/server';
import { OFF_LABEL, blockedLabel, blockedText, missingText, offText, otherText, simWhat } from './simWorldText';
import { pluginsUiOn } from './flag';
import { useWallRev, wallOnce, wallWorkOf } from './galleryWatch';
import './plugins.css';

const PluginWorkDialog = lazy(() => import('./GalleryPlugins').then((m) => ({ default: m.PluginWorkDialog })));

type Missing = Extract<SimPluginCheck, { status: 'missing' }>;
type Other = Extract<SimPluginCheck, { status: 'other' }>;
type Blocked = Extract<SimPluginCheck, { status: 'blocked' }>;

const nameOf = (c: SimPluginCheck) => c.plugin.name ?? c.id;

/** 两个按钮的底栏:电脑上右对齐、主按钮在右;手机上竖排、主按钮在上 */
function Foot({ phone, cancel, main }: { phone: boolean; cancel: { label: string; act?: string; onClick: () => void }; main?: { label: string; act: string; onClick: () => void } | null }) {
  const c = (
    <button className={`acct-btn${phone ? ' full' : ''}`} data-act={cancel.act} onClick={cancel.onClick}>
      {cancel.label}
    </button>
  );
  const m = main && (
    <button className={`acct-btn blue${phone ? ' full' : ''}`} data-act={main.act} onClick={main.onClick}>
      {main.label}
    </button>
  );
  return (
    <div className={`acct-foot${phone ? ' col' : ''}`}>
      {phone ? (
        <>
          {m}
          {c}
        </>
      ) : (
        <>
          <span className="acct-sp" />
          {c}
          {m}
        </>
      )}
    </div>
  );
}

export default function SimAskBox({ ask, phone }: { ask: SimAsk; phone: boolean }) {
  useWallRev();
  useEffect(() => {
    if (pluginsUiOn()) void wallOnce();
  }, []);
  const [install, setInstall] = useState<{ work: string; sum: string } | null>(null);
  const close = () => askSims(null);
  if (!pluginsUiOn()) {
    const [first, second] = offText(ask.title, ask.checks);
    const go = () => {
      close();
      ask.copy(ask.checks.map((c) => c.id));
    };
    return (
      <Dialog phone={phone} label={OFF_LABEL} onClose={close} testId="sim-ask-off" className="sim-ask" head={phone ? <div className="acct-head"><h2>{OFF_LABEL}</h2></div> : undefined}>
        <div className="acct-body">
          <p>{first}</p>
          <div className="sim-ask-list">
            {ask.checks.map((c) => (
              <div key={c.id} className="sim-ask-it" data-plugin={c.id}>
                <PluginIcon src={null} size="md" />
                <span>
                  <b>
                    {nameOf(c)} <span className="plg-tag">{versionLabel(c.plugin.version)}</span>
                  </b>
                  <small>插件关着，这一版现在不跑</small>
                </span>
              </div>
            ))}
          </div>
          <p className="acct-small">{second}</p>
        </div>
        <Foot phone={phone} cancel={{ label: '取消', act: 'sim-ask-off-cancel', onClick: close }} main={{ label: ask.checks.length > 1 ? '另存一份，不带它们重推' : '另存一份，不带它重推', act: 'sim-ask-off-copy', onClick: go }} />
      </Dialog>
    );
  }
  if (install)
    return (
      <Suspense fallback={null}>
        <PluginWorkDialog
          id={install.work}
          want={install.sum}
          phone={phone}
          direct
          onClose={() => {
            setInstall(null);
            close();
          }}
        />
      </Suspense>
    );
  const miss = ask.checks.filter((c): c is Missing => c.status === 'missing');
  if (miss.length) {
    const label = miss.length === 1 ? `要先装「${nameOf(miss[0])}」${versionLabel(miss[0].plugin.version)}` : `要先装 ${miss.length} 个推演插件`;
    const works = miss.map((c) => wallWorkOf(c.id, c.plugin.sum));
    const at = works.findIndex((w) => !!w);
    const go = at < 0 ? null : { work: works[at]!, sum: miss[at].plugin.sum };
    return (
      <Dialog phone={phone} label={label} onClose={close} testId="sim-ask-missing" className="sim-ask" head={phone ? <div className="acct-head"><h2>{label}</h2></div> : undefined}>
        <div className="acct-body">
          <p>{missingText(ask.title, miss)}</p>
          <div className="sim-ask-list">
            {miss.map((c, i) => (
              <div key={c.id} className="sim-ask-it" data-plugin={c.id}>
                <PluginIcon src={null} size="md" />
                <span>
                  <b>
                    {nameOf(c)} <span className="plg-tag">{versionLabel(c.plugin.version)}</span>
                  </b>
                  <small>{works[i] ? '作品墙上有这一版' : noWallVersionText(!!serverBase())}</small>
                </span>
              </div>
            ))}
          </div>
          <p className="acct-small">不想装的话，可以在「世界设定」里以它为底稿新建一个世界，不带这个插件，从第 0 年重推。</p>
        </div>
        <Foot phone={phone} cancel={{ label: '知道了', act: 'sim-ask-ok', onClick: close }} main={go ? { label: '去作品墙装同一版', act: 'sim-ask-wall', onClick: () => setInstall(go) } : null} />
      </Dialog>
    );
  }
  const blocked = ask.checks.filter((c): c is Blocked => c.status === 'blocked');
  if (blocked.length) {
    const label = blockedLabel(blocked);
    const [first, second] = blockedText(ask.title, blocked);
    const go = () => {
      close();
      ask.copy(blocked.map((c) => c.id));
    };
    return (
      <Dialog phone={phone} label={label} onClose={close} testId="sim-ask-blocked" className="sim-ask" head={phone ? <div className="acct-head"><h2>{label}</h2></div> : undefined}>
        <div className="acct-body">
          <p>{first}</p>
          <div className="sim-ask-list">
            {blocked.map((c) => (
              <div key={c.id} className="sim-ask-it" data-plugin={c.id}>
                <PluginIcon src={null} size="md" />
                <span>
                  <b>
                    {nameOf(c)} <span className="plg-tag">{versionLabel(c.plugin.version)}</span>
                  </b>
                  <small>{`网站停用了：${c.why}${c.day ? `（${c.day}）` : ''}`}</small>
                </span>
              </div>
            ))}
          </div>
          <p className="acct-small">{second}</p>
        </div>
        <Foot phone={phone} cancel={{ label: '取消', onClick: close }} main={{ label: blocked.length > 1 ? '另存一份，不带它们重推' : '另存一份，不带它重推', act: 'sim-ask-drop', onClick: go }} />
      </Dialog>
    );
  }
  const other = ask.checks.filter((c): c is Other => c.status === 'other');
  const [first, second] = otherText(ask.title, other, simWhat(ask.now, ask.next));
  const label = '另存一份再推演？';
  const go = () => {
    close();
    ask.copy([]);
  };
  return (
    <Dialog phone={phone} label={label} onClose={close} testId="sim-ask-other" className="frozen-ask" head={phone ? <div className="acct-head"><h2>{label}</h2></div> : undefined}>
      <div className="acct-body">
        <p>{first}</p>
        <p className="acct-small">{second}</p>
      </div>
      <Foot phone={phone} cancel={{ label: '取消', onClick: close }} main={{ label: '另存并推演', act: 'sim-ask-save', onClick: go }} />
    </Dialog>
  );
}
