/** 开发者模式载入的插件:地图左下角一块小卡,插件名、重新载入、日志。只在这个浏览器里,别人看不到 */
import { useEffect, useRef, useState } from 'react';
import { copyText } from '../clipboard';
import { clearDevLogs, closeDev, loadDev, reloadDev, useDevAsk, useDevPlugin } from './dev';
import { CloseBtn, DevAskBox, Ico, pickAccept } from './PluginWindow';
import { clockText, devLoadLine, devLogCopy, devLogOrder, levelText, versionLabel } from './pluginText';
import './plugins.css';

export default function DevCard({ phone }: { phone: boolean }) {
  const s = useDevPlugin();
  const ask = useDevAsk();
  const fileRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  if (!s) return null;

  const m = s.manifest;
  const rows = devLogOrder(s.logs);
  // 没记着文件的浏览器要在这一下点击里直接打开选文件
  const reload = () => (s.reread ? void reloadDev() : fileRef.current?.click());
  const copy = async () => setCopied(await copyText(devLogCopy(s.logs)));
  return (
    <div className={`plg-devc${phone ? ' phone' : ''}`} data-testid="plugin-dev">
      <div className="plg-devc-h">
        <span className="plg-tag dev">开发中</span>
        <b>{m ? `${m.name} ${versionLabel(m.version)}` : s.file}</b>
        <button className="plg-btn sm pri" data-act="plugin-dev-reload" disabled={s.busy} onClick={reload}>
          <Ico name="reload" size={14} />
          重新载入
        </button>
        <CloseBtn onClose={closeDev} />
      </div>
      <div className="plg-devc-t">{s.load ? devLoadLine(s.load.at, s.load.again, s.load.ms, s.file) : `正在载入（${s.file}）`}</div>
      {rows.length > 0 && (
        <div className="plg-logs" role="log">
          {rows.map((l, i) => (
            <div key={i} className={l.level}>
              <span>{clockText(l.at)}</span>
              <span>{levelText(l.level)}</span>
              <span>{l.text}</span>
            </div>
          ))}
        </div>
      )}
      <div className="plg-devc-f">
        <button data-act="plugin-dev-clear" disabled={!rows.length} onClick={clearDevLogs}>
          清空
        </button>
        <button data-act="plugin-dev-copy" disabled={!rows.length} onClick={() => void copy()}>
          {copied ? '已复制' : '复制全部'}
        </button>
        <span>只有你看得到</span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={pickAccept()}
        hidden
        data-testid="plugin-dev-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void loadDev(f, null);
        }}
      />
      {ask && <DevAskBox ask={ask} phone={phone} />}
    </div>
  );
}
