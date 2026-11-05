/** 分享停了的那一页、打开别人分享的世界时地图下的说明。 */
import { Icon } from './icons';
import { PRIVACY_URL, SOURCE_URL, TERMS_URL } from './links';
import { APP_VERSION } from './version';
import { BeianLinks } from './BeianLinks';
import { BEIAN } from './beian';
import { OLD_SITE } from './oldSite';

export function ShareGone({ phone, state, onHome, onNew }: { phone: boolean; state: 'loading' | 'gone' | { error: string }; onHome: () => void; onNew: () => void }) {
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  return (
    <div className={`share-gone${phone ? ' phone' : ''}`} role="main" data-testid="share-gone" onPointerDown={stop} onClick={stop} onWheel={stop}>
      {state !== 'loading' && (
        <div className="share-gone-box">
          <span className="share-gone-ic">
            <Icon name="link" size={28} />
          </span>
          <h2>{state === 'gone' ? '这个分享已经停止了' : '暂时打不开这个分享'}</h2>
          {state === 'gone' ? (
            <p>
              分享的人关掉了这个链接，或者链接没有复制全。
              <br />
              可以请对方重新分享一次。
            </p>
          ) : (
            <p>{state.error}</p>
          )}
          <div className="share-gone-acts">
            <button className="acct-btn lg" data-act="home" onClick={onHome}>
              <Icon name="grid" size={16} />
              我的世界
            </button>
            <button className="acct-btn lg blue" data-act="new-world" onClick={onNew}>
              <Icon name="plus" size={16} />
              新建世界
            </button>
          </div>
        </div>
      )}
      {!phone && state !== 'loading' && (
        <footer className="mw-foot">
          <a href={SOURCE_URL} target="_blank" rel="noreferrer">
            源代码
          </a>
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
            隐私政策
          </a>
          <a href={TERMS_URL} target="_blank" rel="noreferrer">
            用户协议
          </a>
          <BeianLinks className="mw-beian" />
          <span className="mw-ver">版本 {APP_VERSION}</span>
        </footer>
      )}
      {phone && state !== 'loading' && BEIAN.length > 0 && (
        <footer className="mw-foot solo">
          <BeianLinks className="mw-beian" />
        </footer>
      )}
    </div>
  );
}

/**
 * 地图下的说明(手机上在时间轴胶囊上面)。short = 从分享短链接打开的(另存时写明底稿出处);by = 分享的人填的署名。
 * own = 最新版交过来的自己的世界(只在旧网站上出这条说明):换成旧网站的说法。
 * at = 链接带着"这一刻"、打开停在了那里("第 1500 年，有桑皇朝"):开头说清停在哪,多一个「从头放」(onReplay;手机上两个按钮放第二排)
 */
export function SharedHint({ phone, short, by, own, at, onReplay, onOk }: { phone: boolean; short: boolean; by: string; own?: boolean; at?: string | null; onReplay?: () => void; onOk: () => void }) {
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  const who = short ? by || '别人' : '别人';
  const keep = short ? '，并写明底稿出处' : phone ? '' : '，原来的不受影响';
  const text =
    own && OLD_SITE !== null
      ? phone
        ? '你看到的是这个世界原来的样子。改了会另存到旧版的「我的世界」，最新版里的不受影响。'
        : '你看到的是这个世界原来的样子。改了名字或历史会另存一份到旧版的「我的世界」，最新版里的不受影响。'
      : at
        ? null
        : short
          ? `${by || '别人'}分享给你的世界，随便看。改了会另存一份到你的「我的世界」，并写明底稿出处。`
          : phone
            ? '别人分享给你的世界，随便看。改了会另存一份到你的「我的世界」，原来的不受影响。'
            : '别人分享给你的世界，随便看。改了名字或历史会另存一份到你的「我的世界」，原来的不受影响。';
  const replay = at && onReplay && (
    <button data-act="shared-replay" onClick={onReplay}>
      <Icon name="again" size={15} />
      从头放
    </button>
  );
  const ok = (
    <button data-act="shared-ok" onClick={onOk}>
      知道了
    </button>
  );
  return (
    <div className={`shared-hint${replay && phone ? ' two' : ''}`} role="status" data-testid="shared-hint" onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
      <Icon name="info" size={18} />
      <span className="shared-tx">
        {text ??
          (phone ? (
            <>
              {who}分享的世界，停在对方分享时的<b>{at}</b>。改了会另存到你的「我的世界」{keep}。
            </>
          ) : (
            <>
              {who}分享给你的世界，停在对方分享时看的那一刻：<b>{at}</b>。随便看，改了{short ? '' : '名字或历史'}会另存一份到你的「我的世界」{keep}。
            </>
          ))}
      </span>
      {replay && phone ? (
        <span className="shared-acts">
          {replay}
          {ok}
        </span>
      ) : (
        <>
          {replay}
          {ok}
        </>
      )}
    </div>
  );
}
