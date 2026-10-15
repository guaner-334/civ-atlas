/**
 * 新建世界的「文明起源」页:左边「文明」组里点「文明起源」进来,换掉左边(手机上是卡片里换页),左上返回,底部(手机右上)「完成」。
 *
 *   自动 / 自己选   默认自动(程序挑最宜居的地方,头 400 年里陆续出现);自己选 = 在星球上点几处,第一批民族从那里出发、第 0 年出现
 *   我选的起源      一处一行:编号、州名、地形(落到海里、住不了人、和前面同一州的标灰写原因,创建时跳过),叉拿掉
 *   开关            「别处也自动长出民族」开着 = 总数照自动的,点的几支替掉其中几支;关掉 = 只有点的这几支
 *
 * 在星球上点放、点圆点拿掉、点到住不了人的地方提示原因,都在 Studio.tsx(圆点和提示跟着星球摆)。
 * 切到「自己选」但一处没点:不算改动,还是自动;切回「自动」把点的几处收起来,再切回来还在(Studio 记着)。
 */
import type { Civ } from '../../gen/civ/types';
import type { World } from '../../gen/world';
import { ORIGINS_MAX, cleanOrigins } from '../../gen/civ/frontier';
import { setOrigins, useEdits } from '../editsStore';
import { Icon } from '../icons';
import { autoPeoples, originSpots } from './origins';

/** 自动的民族在头几年里陆续出现(推演里民族诞生年份的跨度,gen/civ/cultures.ts 的 BIRTH_SPAN;这里不引那一整个文件) */
const BIRTH_SPAN = 400;

export interface OriginsPageProps {
  /** 左上返回的字(新建世界 / 以某世界为底稿新建) */
  backLabel: string;
  onBack: () => void;
  /** 这颗星球(按默认推演出来的文明,州名、宜居度、自动的民族数从这里看);还没有 = null */
  world: World | null;
  civ: Civ | null;
  phone: boolean;
  /** 星球画不出来(没有 WebGL):没法在上面点 */
  noMap: boolean;
  /** 选的是「自己选」(一处没点时也是;Studio 管着,在星球上点要看它) */
  custom: boolean;
  onCustom: (on: boolean) => void;
  /** 「别处也自动长出民族」关着(一处没点时也记着,点了第一处才存进修改) */
  only: boolean;
  onOnly: (only: boolean) => void;
}

export function OriginsPage(p: OriginsPageProps) {
  const origins = useEdits().origins;
  const custom = p.custom || !!origins;
  const pts = origins?.pts ?? [];
  const only = p.only;
  const spots = p.world && p.civ ? originSpots(p.world, p.civ, pts) : [];
  const used = spots.filter((s) => s.ok).length;
  const total = p.civ ? autoPeoples(p.civ) : 0;

  const pickSeg = (on: boolean) => {
    if (on !== custom) p.onCustom(on);
  };
  const remove = (i: number) => setOrigins(cleanOrigins({ pts: pts.filter((_, k) => k >> 1 !== i), only: only || undefined }));
  const toggleOnly = () => p.onOnly(!only);

  const n = spots.length;
  const add = p.noMap
    ? '这台设备画不了地球仪，没法在地图上点'
    : n >= ORIGINS_MAX
      ? `最多 ${ORIGINS_MAX} 处，拿掉一处才能再点`
      : n
        ? `在地图上再点一处（最多 ${ORIGINS_MAX} 处）`
        : `在地图上点一处（最多 ${ORIGINS_MAX} 处）`;
  const k = Math.max(used, 1);
  const rest = Math.max(0, total - used);
  const note = !p.civ
    ? ''
    : !used
      ? `开着：你点的几支第 0 年出现，其余照常在头 ${BIRTH_SPAN} 年里陆续出现在别处，这颗星球一共约 ${total} 支民族。关掉：整个世界只有你点的这几支。`
      : rest
        ? `开着：这颗星球一共约 ${total} 支民族，你点的 ${k} 支第 0 年出现，其余 ${rest} 支照常在头 ${BIRTH_SPAN} 年里陆续出现在别处。关掉：整个世界只有你点的这 ${k} 支。`
        : `开着：你点的 ${k} 支第 0 年出现，已经比这颗星球自动的 ${total} 支多，别处不再另长。关掉：整个世界只有你点的这 ${k} 支。`;

  return (
    <>
      <div className="st-top">
        <button className="nw-back" data-act="origins-back" onClick={p.onBack}>
          <Icon name="back" size={18} />
          {p.backLabel}
        </button>
        {p.phone && (
          <button className="og-done" data-act="origins-done" onClick={p.onBack}>
            完成
          </button>
        )}
      </div>
      <div className="nw-title-row">
        <div className="nw-title">文明起源</div>
      </div>
      {!p.phone && <div className="nw-intro">在地图上点几处，第一批民族就从那里出发，第 0 年一起出现。</div>}
      <div className="nm-seg" role="radiogroup" aria-label="文明起源">
        <button role="radio" aria-checked={!custom} className={custom ? '' : 'on'} data-act="origins-auto" onClick={() => pickSeg(false)}>
          自动
        </button>
        <button role="radio" aria-checked={custom} className={custom ? 'on' : ''} data-act="origins-custom" onClick={() => pickSeg(true)}>
          自己选
        </button>
      </div>
      {!custom ? (
        p.civ && (
          <div className="nm-note og-auto">
            程序挑最宜居的地方，这颗星球一共约 {total} 支民族，头 {BIRTH_SPAN} 年里陆续出现。
          </div>
        )
      ) : (
        <>
          <section className="sb-sec">
            {!p.phone && (
              <div className="sb-sec-head">
                <span>我选的起源</span>
                {n > 0 && <small>{n} 处</small>}
              </div>
            )}
            <div className="sb-group og-list">
              {spots.map((s, i) => (
                <div key={`${s.x},${s.y}`} className={`sb-row static og-row${s.ok ? '' : ' off'}`} data-origin={i + 1}>
                  <span className="og-no">{i + 1}</span>
                  <span className="sb-row-main">
                    <b>{s.name}</b>
                    <small>{s.note}</small>
                  </span>
                  <button className="og-x" data-act="origin-remove" aria-label={`拿掉第 ${i + 1} 处`} onClick={() => remove(i)}>
                    <Icon name="close" size={11} />
                  </button>
                </div>
              ))}
              {(!p.phone || !n) && <div className="og-add">{add}</div>}
              {p.phone && (
                <button className="sb-row og-only" role="switch" aria-checked={!only} data-act="origins-only" onClick={toggleOnly}>
                  <span className="sb-row-main">
                    <b>别处也自动长出民族</b>
                  </span>
                  <span className={`ai-switch${only ? '' : ' on'}`} aria-hidden="true" />
                </button>
              )}
            </div>
          </section>
          {!p.phone && (
            <>
              <div className="sb-group og-only-grp">
                <button className="sb-row og-only" role="switch" aria-checked={!only} data-act="origins-only" onClick={toggleOnly}>
                  <span className="sb-row-main">
                    <b>别处也自动长出民族</b>
                  </span>
                  <span className={`ai-switch${only ? '' : ' on'}`} aria-hidden="true" />
                </button>
              </div>
              {note && <div className="nm-note og-note">{note}</div>}
            </>
          )}
        </>
      )}
    </>
  );
}
