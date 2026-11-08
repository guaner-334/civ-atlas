/**
 * 新建界面星球上那张「长不出这张地图」的卡(深色,底色照确认框;出错时才下载):哪个插件、第几版、哪一步、什么错;
 * 「复制给作者」「不带它生成」,合计算太久的列出各用了多久、按钮换成「改选插件」。不挡左边:改了选的、拨了滑条、换了种子就重新长,卡收起
 */
import { copyText } from '../clipboard';
import { Icon } from '../icons';
import { showToast } from '../toastStore';
import { MAP_STAGE_TEXT } from './mapText';
import { openPlugins } from './entry';
import { versionLabel } from './pluginWords';
import type { MapFail } from '../world/mapFail';
import './mapFail.css';

const stageText = (s: string | null) => (s ? (MAP_STAGE_TEXT[s] ?? s) : '');
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;

/** 「复制给作者」:插件名、第几版、文件指纹、种子和滑条、哪一步、那句错 */
export function mapFailReport(f: MapFail): string {
  const params = Object.entries(f.params ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('、');
  return [
    `地图插件「${f.name}」（${f.plugin}）${f.version ? versionLabel(f.version) : ''}`,
    ...(f.sum ? [`文件指纹：${f.sum}`] : []),
    `种子：${f.seed}${params ? `，滑条：${params}` : ''}`,
    ...(f.stage ? [`哪一步：${stageText(f.stage)}`] : []),
    `错：${f.why}`,
    ...(f.spent ?? []).map((x) => `${x.name} ${stageText(x.stage)}：${sec(x.ms)}`),
  ].join('\n');
}

export function MapFailCard({ f, onDrop, onPick }: { f: MapFail; onDrop: () => void; onPick: () => void }) {
  const ver = f.version ? versionLabel(f.version) : '';
  const who = `地图插件「${f.name}」${ver}`;
  const at = f.stage ? `在「${stageText(f.stage)}」那一步` : '';
  const copy = async () => {
    const ok = await copyText(mapFailReport(f));
    showToast({ id: 'map-fail-copy', kind: ok ? 'ok' : 'warn', text: ok ? '已复制' : '没能复制', ttl: 3000 });
  };
  let body;
  if (f.kind === 'total') {
    const rows = f.spent ?? [];
    body = (
      <>
        <p>这一次长地图，地图插件一共算了 15 秒还没算完，停下了。各用了多久：</p>
        <table className="mf-tm">
          <tbody>
            {rows.map((x, i) => (
              <tr key={`${x.id}-${x.stage}`} className={i === rows.length - 1 ? 'bad' : undefined}>
                <td>
                  「{x.name}」{stageText(x.stage)}
                </td>
                <td>{i === rows.length - 1 ? `算到 ${sec(x.ms)}停下` : sec(x.ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sm">每个都不算太慢，合起来太慢了。少选一两个，或者换台快一点的设备。</p>
      </>
    );
  } else if (f.kind === 'slow') {
    body = (
      <>
        <p>
          {who}
          {at}算了 5 秒还没算完，停下了。
        </p>
        <p className="sm">在这台设备上它太慢。换台快一点的设备再试，或者不带它接着建。</p>
      </>
    );
  } else if (f.kind === 'missing' || f.kind === 'load') {
    body = (
      <>
        <p>
          {who}用不了：{f.why}。星球先照上一次的样子放着。
        </p>
        <p className="sm">装上同一版再试，或者不带它接着建。</p>
      </>
    );
  } else {
    const bad = f.kind === 'bad';
    body = (
      <>
        <p>
          {who}
          {at}
          {bad ? '交回的数网站用不了，这张地图没长成。' : '出错了，这张地图没长成。星球先照上一次的样子放着。'}
        </p>
        <div className="mf-err">
          <small>{bad ? '网站查出来的' : '插件报的错'}</small>
          <span className={bad ? undefined : 'mono'}>{f.why}</span>
        </div>
        <p className="sm">{bad ? '这是插件的毛病，可以把这句话发给作者。' : '这是插件的毛病，不是你做错了，可以把这句话发给作者。不带它也能接着建：移出它，照剩下的插件和参数重新长。'}</p>
      </>
    );
  }
  return (
    <div className="mf-card" role="alert" data-testid="map-fail" data-kind={f.kind} onPointerDown={(e) => e.stopPropagation()}>
      <h4>
        <Icon name="warn" size={19} />
        长不出这张地图
      </h4>
      {body}
      <div className="mf-bs">
        {f.kind === 'missing' ? (
          <button className="mf-btn" data-act="map-fail-plugins" onClick={openPlugins}>
            去插件页
          </button>
        ) : (
          <button className="mf-btn" data-act="map-fail-copy" onClick={() => void copy()}>
            复制给作者
          </button>
        )}
        {f.kind === 'total' ? (
          <button className="mf-btn pri" data-act="map-fail-pick" onClick={onPick}>
            改选插件
          </button>
        ) : (
          <button className="mf-btn pri" data-act="map-fail-drop" onClick={onDrop}>
            不带它生成
          </button>
        )}
      </div>
    </div>
  );
}
