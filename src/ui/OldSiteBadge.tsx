/**
 * 旧版网站、测试网站左上一直挂着的标记(地图左上和「我的世界」页顶上;从 Corners.tsx 分出来,我的世界页不用带上地图上的按钮)。
 */
import { Icon } from './icons';
import { BETA_SITE, OLD_SITE, OLD_UNTIL, latestUrl } from './oldSite';

/**
 * 旧版网站:地图左上(和「我的世界」页顶上)一直挂着的标记,写明是旧版、哪天以前的,带回最新版的链接;
 * 测试网站同一个位置、同一个样子,写明是测试版,带回正式版的链接。正式网站不放
 */
export function OldSiteBadge() {
  if (BETA_SITE) {
    return (
      <div className="glass old-badge" data-testid="beta-site">
        <Icon name="flask" size={16} />
        <b>测试版</b>
        <span className="old-badge-when">新功能先在这里试</span>
        <a className="old-badge-go" href={latestUrl().href} data-act="beta-latest">
          到正式版
        </a>
      </div>
    );
  }
  if (OLD_SITE === null) return null;
  return (
    <div className="glass old-badge" data-testid="old-site">
      <Icon name="history" size={16} />
      <b>旧版</b>
      {OLD_UNTIL && <span className="old-badge-when">{OLD_UNTIL}更新以前</span>}
      <a className="old-badge-go" href={latestUrl().href} data-act="old-latest">
        到最新版
      </a>
    </div>
  );
}
