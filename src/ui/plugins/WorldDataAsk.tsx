/** 插件第一次往这个世界里存自己的数据时问的那张框、去掉插件存的数据时的确认框(askState.ts 的 dataAsk) */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { listPlugins, type InstalledPlugin } from '../../plugin/pluginStore';
import { PluginIcon, useIcons } from './pluginIcons';
import { noShareText } from './pluginWords';
import { serverBase } from '../../account/server';
import type { DataAsk } from './askState';
import './plugins.css';
import './worldData.css';

function useInstalled(id: string | null): InstalledPlugin | null {
  const [got, setGot] = useState<InstalledPlugin | null>(null);
  useEffect(() => {
    let live = true;
    if (id)
      void listPlugins().then(
        (l) => live && setGot(l.find((p) => p.id === id) ?? null),
        () => {},
      );
    return () => {
      live = false;
    };
  }, [id]);
  return got;
}

function StoreBody({ ask }: { ask: Extract<DataAsk, { kind: 'store' }> }) {
  const pl = useInstalled(ask.pluginId);
  const list = useMemo(() => (pl ? [pl] : []), [pl]);
  const icon = useIcons(list).get(ask.sum);
  return (
    <>
      <h4 className="plg-wd-h">
        <PluginIcon src={icon} size="sm" />
        「{ask.plugin}」要往这个世界里存它自己的数据
      </h4>
      <p>存的是它自己的数据，大约 {ask.kb} KB。存了以后：</p>
      <ul>
        <li>
          <b>这个世界不能公开分享</b>：{noShareText(!!serverBase())}。网站读不懂插件自己的数据，没法替你检查里面写了什么
        </li>
        <li>还能存成文件发给别人，对方装了这个插件才用得上这些数据</li>
        <li>以后想分享，到「存档」里去掉这些数据就行</li>
      </ul>
      <p className="s">同意以后，它在这个世界里接着存，不再问；别的世界第一次存时还会问。</p>
    </>
  );
}

function RemoveBody({ ask }: { ask: Extract<DataAsk, { kind: 'remove' }> }) {
  const names = ask.plugins.map((n) => `「${n}」`).join('');
  return (
    <>
      <h4 className="plg-wd-h">去掉{names}存在这个世界里的数据？</h4>
      <p>大约 {ask.kb} KB。去掉以后这个世界就能分享了；地图、历史、你写的东西都不变。</p>
      <p className="s">想留一份带数据的，先「存成文件」再去掉。</p>
    </>
  );
}

export default function WorldDataAsk({ ask, phone }: { ask: DataAsk; phone: boolean }) {
  const no = () => ask.answer(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      ask.answer(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ask]);
  const store = ask.kind === 'store';
  return createPortal(
    <div
      className={`plg-bg ask${phone ? ' phone' : ''}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) no();
      }}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className={`plg-dlg plg-wd${store ? '' : ' rm'}${phone ? ' sheet' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={store ? `「${ask.plugin}」要往这个世界里存它自己的数据` : '去掉插件存的数据'}
        data-testid={store ? 'plugin-store-ask' : 'plugin-data-remove'}
      >
        {phone && <div className="plg-grip" aria-hidden="true" />}
        <div className="plg-wd-b">{store ? <StoreBody ask={ask} /> : <RemoveBody ask={ask} />}</div>
        <div className={`plg-foot${phone ? ' pair' : ''}`}>
          <button className="plg-btn" data-act="plugin-data-no" onClick={no}>
            {store ? '这次不存' : '取消'}
          </button>
          <button className={`plg-btn pri${store ? '' : ' danger'}`} data-act="plugin-data-ok" onClick={() => ask.answer(true)}>
            {store ? '存进这个世界' : '去掉'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
