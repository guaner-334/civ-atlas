/**
 * 世界用的推演插件本机对不上时、要接着推之前问的窗(world/simNow.ts 的 askSims):
 *   没装   「要先装「魔力」第 1.0 版」:作品墙上正是这一版就给「去作品墙看看」(从那里装),不是就说向分享世界的人要文件
 *   别的版本「另存一份再推演？」:和旧版本世界问的那一个窗一样,另存「…（新版）」按本机这一版从第 0 年重推
 * 没装和别的版本都有时先说要先装;装齐了再点,才轮到另存。
 */
import { Suspense, lazy, useState } from 'react';
import type { SimPluginCheck } from '../../plugin/pluginWorld';
import { Dialog } from '../AccountDialogs';
import { newVersionTitle } from '../FrozenWorld';
import { askSims, type SimAsk } from '../world/simNow';
import { PluginIcon } from './pluginIcons';
import { versionLabel } from './pluginWords';
import { useWallRev, wallWorkOf } from './galleryWatch';
import './plugins.css';

const PluginWorkDialog = lazy(() => import('./GalleryPlugins').then((m) => ({ default: m.PluginWorkDialog })));

type Missing = Extract<SimPluginCheck, { status: 'missing' }>;
type Other = Extract<SimPluginCheck, { status: 'other' }>;

const nameOf = (c: SimPluginCheck) => c.plugin.name ?? c.id;

/** 要先装的那一句 */
export function missingText(title: string, miss: readonly Pick<SimPluginCheck, 'id' | 'plugin'>[]): string {
  const list = miss.map((c) => `「${c.plugin.name ?? c.id}」${versionLabel(c.plugin.version)}`).join('、');
  return `「${title}」用了推演插件${list}。看不用装；要接着推，得先装上同一版，推出来的历史才对得上。`;
}

/** 另存一份那两句 */
export function otherText(title: string, other: readonly Pick<Other, 'id' | 'plugin' | 'installed'>[], what: string): [string, string] {
  const one = other.length === 1 ? other[0] : null;
  const first = one
    ? `「${title}」是用推演插件「${one.plugin.name ?? one.id}」${versionLabel(one.plugin.version)}推的，你装的是${versionLabel(one.installed.version)}。推演的话，地图和你写的东西留下，历史按${versionLabel(one.installed.version)}从第 0 年重推，整段都会不一样。`
    : `「${title}」用的推演插件，你装的是别的版本：${other.map((c) => `「${c.plugin.name ?? c.id}」${versionLabel(c.plugin.version)}（你装的是${versionLabel(c.installed.version)}）`).join('、')}。推演的话，地图和你写的东西留下，历史按你装的版本从第 0 年重推，整段都会不一样。`;
  const back = one ? `要照原样接着推，得装回${versionLabel(one.plugin.version)}。` : '要照原样接着推，得装回原来那几版。';
  return [first, `原来的「${title}」不动；另存一份「${newVersionTitle(title)}」，在那一份上${what}。${back}`];
}

export default function SimAskBox({ ask, phone }: { ask: SimAsk; phone: boolean }) {
  useWallRev();
  const [look, setLook] = useState<string | null>(null);
  const close = () => askSims(null);
  if (look)
    return (
      <Suspense fallback={null}>
        <PluginWorkDialog
          id={look}
          phone={phone}
          onClose={() => {
            setLook(null);
            close();
          }}
        />
      </Suspense>
    );
  const miss = ask.checks.filter((c): c is Missing => c.status === 'missing');
  if (miss.length) {
    const label = miss.length === 1 ? `要先装「${nameOf(miss[0])}」${versionLabel(miss[0].plugin.version)}` : `要先装 ${miss.length} 个推演插件`;
    const works = miss.map((c) => wallWorkOf(c.id, c.plugin.sum));
    const go = works.find((w): w is string => !!w);
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
                  <small>{works[i] ? '作品墙上有这一版' : '作品墙上没有这一版：向分享这个世界的人要插件文件，在「插件」页从文件装'}</small>
                </span>
              </div>
            ))}
          </div>
          <p className="acct-small">不想装的话，可以在「世界设定」里以它为底稿新建一个世界，不带这个插件，从第 0 年重推。</p>
        </div>
        <div className={`acct-foot${phone ? ' col' : ''}`}>
          {!phone && <span className="acct-sp" />}
          {phone && go && (
            <button className="acct-btn full blue" data-act="sim-ask-wall" onClick={() => setLook(go)}>
              去作品墙看看
            </button>
          )}
          <button className={`acct-btn${phone ? ' full' : ''}`} data-act="sim-ask-ok" onClick={close}>
            知道了
          </button>
          {!phone && go && (
            <button className="acct-btn blue" data-act="sim-ask-wall" onClick={() => setLook(go)}>
              去作品墙看看
            </button>
          )}
        </div>
      </Dialog>
    );
  }
  const other = ask.checks.filter((c): c is Other => c.status === 'other');
  const [first, second] = otherText(ask.title, other, ask.what);
  const label = '另存一份再推演？';
  const go = () => {
    close();
    ask.copy();
  };
  return (
    <Dialog phone={phone} label={label} onClose={close} testId="sim-ask-other" className="frozen-ask" head={phone ? <div className="acct-head"><h2>{label}</h2></div> : undefined}>
      <div className="acct-body">
        <p>{first}</p>
        <p className="acct-small">{second}</p>
      </div>
      <div className={`acct-foot${phone ? ' col' : ''}`}>
        {phone ? (
          <>
            <button className="acct-btn full blue" data-act="sim-ask-save" onClick={go}>
              另存并推演
            </button>
            <button className="acct-btn full" onClick={close}>
              取消
            </button>
          </>
        ) : (
          <>
            <span className="acct-sp" />
            <button className="acct-btn" onClick={close}>
              取消
            </button>
            <button className="acct-btn blue" data-act="sim-ask-save" onClick={go}>
              另存并推演
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
