/**
 * 开发者模式载入的插件:地图左下角一块小卡,插件名、重新载入、日志。只在这个浏览器里,别人看不到。
 * 载入的是推演插件:多一个「试推 300 年」(推的时候换成进度条和「停」),推完列每个插件出手几回、一共多久、最慢一次,
 * 命令和编年史几条、分段推和一口气推一不一样,日志按年份(手机上「重新载入」挪到底下那一行)。
 * 载入的是地图插件:同样的位置是「试生成」,试完两张小图并排、每一口多久改了几块、几样数、两条自动查(手机上并成几行,日志收着)
 */
import { useEffect, useRef, useState } from 'react';
import { copyText } from '../clipboard';
import { Icon } from '../icons';
import { DEV_TRY_YEARS, clearDevLogs, closeDev, loadDev, reloadDev, showGen, stopTry, tryDev, tryGen, useDevAsk, useDevPlugin, type DevGenTried } from './dev';
import { CloseBtn, DevAskBox, Ico, pickAccept } from './PluginWindow';
import { devMapView, devRoot } from './devSlot';
import {
  clockText,
  devGenBrief,
  devGenChecks,
  devGenCopy,
  devGenLine,
  devGenRows,
  devGenStage,
  devGenTally,
  devLoadLine,
  devLogCopy,
  devLogOrder,
  devTryCopy,
  devTryCounts,
  devTryLine,
  devTryResume,
  devTryRows,
  devTryYear,
  levelText,
  versionLabel,
} from './pluginText';
import './plugins.css';

const HALF = Math.floor(DEV_TRY_YEARS / 2);

export default function DevCard({ phone }: { phone: boolean }) {
  const s = useDevPlugin();
  const ask = useDevAsk();
  const root = devRoot.use();
  const fileRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  if (!s) return null;

  const m = s.manifest;
  const sim = s.sim;
  const gen = s.map;
  const tried = sim?.last ?? null;
  const result = tried?.result ?? null;
  // 换了地图:之前试生成的那次不算
  const genTried = gen?.last && gen.last.root === root ? gen.last : null;
  const rows = devLogOrder(s.logs);
  const tryLogs = result?.logs ?? [];
  const genLogs = genTried?.result?.logs ?? [];
  const hasLogs = rows.length > 0 || tryLogs.length > 0 || genLogs.length > 0;
  // 没记着文件的浏览器要在这一下点击里直接打开选文件
  const reload = () => (s.reread ? void reloadDev() : fileRef.current?.click());
  const copy = async () => setCopied(await copyText([tried ? devTryCopy(tried, HALF) : '', genTried ? devGenCopy(genTried) : '', devLogCopy(s.logs)].filter(Boolean).join('\n')));
  const running = sim?.pct != null || gen?.pct != null;
  const pct = sim?.pct ?? gen?.pct ?? 0;
  const slot = sim ?? gen;
  // 手机上试生成完日志收着,「复制全部」带上
  const logsShown = hasLogs && !(phone && genTried);
  const reloadBtn = (
    <button className={`plg-btn sm${slot ? '' : ' pri'}`} data-act="plugin-dev-reload" disabled={s.busy || running} onClick={reload}>
      <Ico name="reload" size={14} />
      重新载入
    </button>
  );
  const resume = tried ? devTryResume(tried, HALF, phone) : null;
  return (
    <div className={`plg-devc${phone ? ' phone' : ''}${gen ? ' map' : ''}`} data-testid="plugin-dev">
      <div className="plg-devc-h">
        <span className="plg-tag dev">开发中</span>
        <b>{m ? `${m.name} ${versionLabel(m.version)}` : s.file}</b>
        {gen && !phone && <span className="plg-tag">地图</span>}
        {slot &&
          (running ? (
            <span className="plg-try" data-testid="plugin-dev-trying">
              <span className="plg-try-bar" role="progressbar" aria-label={gen ? '试生成' : '试推'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
                <i style={{ width: `${Math.round(pct * 100)}%` }} />
              </span>
              <button className="plg-btn sm" data-act="plugin-dev-try-stop" onClick={stopTry}>
                停
              </button>
            </span>
          ) : gen ? (
            <button className="plg-btn sm pri" data-act="plugin-dev-gen" disabled={s.busy} onClick={tryGen}>
              <Icon name="play" size={14} />试生成
            </button>
          ) : (
            <button className="plg-btn sm pri" data-act="plugin-dev-try" disabled={s.busy} onClick={() => void tryDev()}>
              <Icon name="play" size={14} />试推 {DEV_TRY_YEARS} 年
            </button>
          ))}
        {(!slot || !phone) && reloadBtn}
        <CloseBtn onClose={closeDev} />
      </div>
      <div className="plg-devc-t">
        {tried ? devTryLine(tried, phone) : genTried ? devGenLine(genTried, phone) : s.load ? devLoadLine(s.load.at, s.load.again, s.load.ms, s.file) : `正在载入（${s.file}）`}
      </div>
      {tried?.alone && <div className="plg-devc-t">这个世界用的推演插件本机对不上，这次只带了它</div>}
      {genTried?.alone && <div className="plg-devc-t">这个世界用的地图插件本机对不上，这次只带了它</div>}
      {genTried?.result && <GenBody t={genTried} phone={phone} />}
      {result && (
        <>
          <table className="plg-tt">
            <thead>
              <tr>
                <th>插件</th>
                <th>出手</th>
                <th>一共</th>
                <th>最慢一次</th>
              </tr>
            </thead>
            <tbody>
              {devTryRows(tried!, phone).map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.turns}</td>
                  <td>{r.total}</td>
                  <td>{r.worst}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="plg-devc-n">{devTryCounts(tried!, phone)}</div>
          {resume && (
            <div className={`plg-chk${resume.ok ? ' ok' : ' bad'}`} data-testid="plugin-dev-resume">
              <Ico name={resume.ok ? 'ok2' : 'x2'} size={16} />
              {resume.text}
            </div>
          )}
        </>
      )}
      {logsShown && (
        <div className="plg-logs" role="log">
          {tryLogs.map((l, i) => (
            <div key={`t${i}`} className={l.level}>
              <span>{devTryYear(l.year)}</span>
              <span>{levelText(l.level)}</span>
              <span>{l.text}</span>
            </div>
          ))}
          {genLogs.map((l, i) => (
            <div key={`g${i}`} className={l.level}>
              <span>{devGenStage(l.stage)}</span>
              <span>{levelText(l.level)}</span>
              <span>{l.text}</span>
            </div>
          ))}
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
        {slot && phone && (
          <button data-act="plugin-dev-reload" disabled={s.busy || running} onClick={reload}>
            重新载入
          </button>
        )}
        <button data-act="plugin-dev-clear" disabled={!hasLogs} onClick={clearDevLogs}>
          清空
        </button>
        <button data-act="plugin-dev-copy" disabled={!hasLogs && !result && !genTried} onClick={() => void copy()}>
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

/** 试生成完:两张小图、每一口多久改了几块、几样数、两条自动查(手机上并成几行) */
function GenBody({ t, phone }: { t: DevGenTried; phone: boolean }) {
  const rows = devGenRows(t);
  const tally = devGenTally(t);
  const checks = devGenChecks(t, phone);
  const shown = devMapView.use() === t.big && !!t.big;
  return (
    <>
      <div className="plg-thumbs">
        <figure>
          <div className="plg-thumb">{t.thumbs.official && <img src={t.thumbs.official} alt="" draggable={false} />}</div>
          <figcaption>
            <span>{phone ? '不带' : '不带地图插件'}</span>
          </figcaption>
        </figure>
        <figure>
          <div className="plg-thumb">{t.thumbs.plugin && <img src={t.thumbs.plugin} alt="" draggable={false} />}</div>
          <figcaption>
            <span>{phone ? '带' : '带地图插件'}</span>
            {t.big && (
              <button className="plg-lk" data-act="plugin-dev-gen-show" aria-pressed={shown} onClick={() => showGen(!shown)}>
                {shown ? '换回来' : '放到地图上看'}
              </button>
            )}
          </figcaption>
        </figure>
      </div>
      {phone ? (
        devGenBrief(t).map((line, i) => (
          <div key={i} className="plg-devc-n">
            {line}
          </div>
        ))
      ) : (
        <div className="plg-two">
          <table className="plg-tt plg-gen">
            <thead>
              <tr>
                <th>插件</th>
                <th>哪一步</th>
                <th>用时</th>
                <th>改了</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.name}</td>
                  <td>{r.stage}</td>
                  <td className={r.slow ? 'slow' : undefined}>{r.time}</td>
                  <td>{r.changed}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {tally.length > 0 && (
            <table className="plg-tt plg-tally">
              <thead>
                <tr>
                  <th />
                  <th>不带</th>
                  <th>带</th>
                </tr>
              </thead>
              <tbody>
                {tally.map((r) => (
                  <tr key={r.key}>
                    <td>{r.name}</td>
                    <td className="d">{r.off}</td>
                    <td>{r.on}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {checks.map((c) => (
        <div key={c.key} className={`plg-chk${c.ok ? ' ok' : ' bad'}`} data-testid={`plugin-dev-gen-${c.key}`}>
          <Ico name={c.ok ? 'ok2' : 'x2'} size={16} />
          {c.text}
        </div>
      ))}
    </>
  );
}
