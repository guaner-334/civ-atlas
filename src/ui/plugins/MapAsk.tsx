/**
 * 世界用的地图插件本机对不上时、要改地形(地形大事、改地形)之前问的窗(world/mapAsk.ts 的 askMaps):
 *   没装     「要先装「环形山」第 1.0 版」:作品墙上正是这一版就给「去作品墙装同一版」(直接弹权限框),不是就说向分享世界的人要文件
 *   被停用了 「「环形山」被网站停用了」
 *   别的版本 「改地形要装回第 1.0 版」
 * 没装的先说;装齐了再改,才轮到停用的、别的版本。看、接着推都不问(地图存着,推历史用不着长地图)
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import type { MapPluginCheck } from '../../plugin/pluginWorld';
import { Dialog } from '../AccountDialogs';
import { askMaps, type MapAsk } from '../world/mapAsk';
import { openPlugins } from './entry';
import { PluginIcon } from './pluginIcons';
import { noWallVersionText, versionLabel } from './pluginWords';
import { serverBase } from '../../account/server';
import { useWallRev, wallOnce, wallWorkOf } from './galleryWatch';
import './plugins.css';

const PluginWorkDialog = lazy(() => import('./GalleryPlugins').then((m) => ({ default: m.PluginWorkDialog })));

type Missing = Extract<MapPluginCheck, { status: 'missing' }>;
type Other = Extract<MapPluginCheck, { status: 'other' }>;
type Blocked = Extract<MapPluginCheck, { status: 'blocked' }>;

const nameOf = (c: MapPluginCheck) => c.plugin.name ?? c.id;
const listOf = (cs: readonly MapPluginCheck[]) => cs.map((c) => `「${nameOf(c)}」${versionLabel(c.plugin.version)}`).join('、');

/** 这次要做的:加地形大事,还是改地形 */
const whatOf = (a: MapAsk) => (JSON.stringify(a.now.upheavals ?? []) !== JSON.stringify(a.next.upheavals ?? []) ? '地形大事' : '改地形');

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

function Item({ c, small }: { c: MapPluginCheck; small: string }) {
  return (
    <div className="sim-ask-it" data-plugin={c.id}>
      <PluginIcon src={null} size="md" />
      <span>
        <b>
          {nameOf(c)} <span className="plg-tag">{versionLabel(c.plugin.version)}</span> <span className="plg-tag">地图</span>
        </b>
        <small>{small}</small>
      </span>
    </div>
  );
}

export default function MapAskBox({ ask, phone }: { ask: MapAsk; phone: boolean }) {
  useWallRev();
  useEffect(() => void wallOnce(), []);
  const [install, setInstall] = useState<{ work: string; sum: string } | null>(null);
  const close = () => askMaps(null);
  const what = ask.what ?? whatOf(ask);
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
  const head = (label: string) => (phone ? <div className="acct-head"><h2>{label}</h2></div> : undefined);
  const miss = ask.checks.filter((c): c is Missing => c.status === 'missing');
  if (miss.length) {
    const label = miss.length === 1 ? `要先装「${nameOf(miss[0])}」${versionLabel(miss[0].plugin.version)}` : `要先装 ${miss.length} 个地图插件`;
    const works = miss.map((c) => wallWorkOf(c.id, c.plugin.sum));
    const at = works.findIndex((w) => !!w);
    const go = at < 0 ? null : { work: works[at]!, sum: miss[at].plugin.sum };
    return (
      <Dialog phone={phone} label={label} onClose={close} testId="map-ask-missing" className="sim-ask" head={head(label)}>
        <div className="acct-body">
          <p>{`「${ask.title}」的地图是用地图插件${listOf(miss)}长的。看、接着推都不用装；${what}要把地图重新长一遍，得先装上同一版，长出来的地形才对得上。`}</p>
          <div className="sim-ask-list">
            {miss.map((c, i) => (
              <Item key={c.id} c={c} small={works[i] ? '作品墙上有这一版' : noWallVersionText(!!serverBase())} />
            ))}
          </div>
          <p className="acct-small">不想装的话，可以在「世界设定」里以它为底稿新建一个世界，不带这个插件。</p>
        </div>
        <Foot phone={phone} cancel={{ label: '知道了', act: 'map-ask-ok', onClick: close }} main={go ? { label: '去作品墙装同一版', act: 'map-ask-wall', onClick: () => setInstall(go) } : null} />
      </Dialog>
    );
  }
  const blocked = ask.checks.filter((c): c is Blocked => c.status === 'blocked');
  if (blocked.length) {
    const label = blocked.length === 1 ? `「${nameOf(blocked[0])}」被网站停用了` : `${blocked.length} 个地图插件被网站停用了`;
    return (
      <Dialog phone={phone} label={label} onClose={close} testId="map-ask-blocked" className="sim-ask" head={head(label)}>
        <div className="acct-body">
          <p>{`「${ask.title}」的地图是用地图插件${listOf(blocked)}长的，${blocked.length > 1 ? '它们' : '它'}被网站停用了，不再跑。这个世界照样能看、接着推；要${what}，只能以它为底稿新建一个世界，照官方的长法重新长地图。`}</p>
          <div className="sim-ask-list">
            {blocked.map((c) => (
              <Item key={c.id} c={c} small={`网站停用了：${c.why}${c.day ? `（${c.day}）` : ''}`} />
            ))}
          </div>
        </div>
        <Foot phone={phone} cancel={{ label: '知道了', act: 'map-ask-ok', onClick: close }} />
      </Dialog>
    );
  }
  const other = ask.checks.filter((c): c is Other => c.status === 'other');
  const one = other.length === 1 ? other[0] : null;
  const label = one ? `${what}要装回${versionLabel(one.plugin.version)}` : `${what}要装回原来那几版`;
  return (
    <Dialog phone={phone} label={label} onClose={close} testId="map-ask-other" className="sim-ask" head={head(label)}>
      <div className="acct-body">
        <p>
          {one
            ? `「${ask.title}」的地图是用地图插件「${nameOf(one)}」${versionLabel(one.plugin.version)}长的，你装的是${versionLabel(one.installed.version)}。${what}要把地图重新长一遍，换了版本长出来的地图会不一样。`
            : `「${ask.title}」的地图用的地图插件，你装的是别的版本：${other.map((c) => `「${nameOf(c)}」${versionLabel(c.plugin.version)}（你装的是${versionLabel(c.installed.version)}）`).join('、')}。${what}要把地图重新长一遍，换了版本长出来的地图会不一样。`}
        </p>
        <p className="acct-small">{`在「插件」页换回原来那一版，就能照原样${what}；看、接着推不用换。`}</p>
      </div>
      <Foot
        phone={phone}
        cancel={{ label: '知道了', act: 'map-ask-ok', onClick: close }}
        main={{
          label: '去插件页',
          act: 'map-ask-plugins',
          onClick: () => {
            close();
            openPlugins();
          },
        }}
      />
    </Dialog>
  );
}
