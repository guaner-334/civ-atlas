/**
 * 地区模式两面(平面图、立体)共用的几样:
 *   FaceSwitch  「平面图 | 立体」(电脑在底条上,手机在底下卡片最上面一行;同一个框来回切)
 *   AreaTitle   这一块叫什么 + 多大;平面图上点标题能改名(回车 / 点别处改好,Esc 不改;改成空的 = 回到按地名起的)
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { setRegionTitle, setReliefFace, type AreaFace } from '../terrain3dStore';

export function FaceSwitch({ face }: { face: AreaFace }) {
  return (
    <div className="ab-seg" role="group" aria-label="怎么看这一块">
      <button type="button" className={face === 'flat' ? 'on' : ''} data-face="flat" aria-pressed={face === 'flat'} onClick={() => setReliefFace('flat')}>
        <Icon name="flatmap" size={15} />
        平面图
      </button>
      <button type="button" className={face === 'relief' ? 'on' : ''} data-face="relief" aria-pressed={face === 'relief'} onClick={() => setReliefFace('relief')}>
        <Icon name="mount" size={15} />
        立体
      </button>
    </div>
  );
}

/**
 * 标题 + 小字。editable:点标题能改名(平面图;立体上只显示)。
 * phone:手机顶上居中那一块(class 换成手机的)
 */
export function AreaTitle({ title, sub, editable, phone }: { title: string; sub: string; editable?: boolean; phone?: boolean }) {
  const [edit, setEdit] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const editing = edit !== null;
  // 开始改的那一下全选
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const done = (save: boolean) => {
    if (save && edit !== null && edit.trim() !== title) setRegionTitle(edit);
    setEdit(null);
  };
  const cls = phone ? 'rv-ttl' : 'rv-t';
  if (edit !== null)
    return (
      <span className={`${cls} ab-edit`}>
        <input
          ref={input}
          value={edit}
          maxLength={40}
          aria-label="地区图的标题"
          onChange={(e) => setEdit(e.target.value)}
          onBlur={() => done(true)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') done(true);
            else if (e.key === 'Escape') done(false);
          }}
        />
        <small>{sub}</small>
      </span>
    );
  return (
    <span className={cls}>
      {editable ? (
        <b className="ab-name" role="button" tabIndex={0} title="点一下改标题" onClick={() => setEdit(title)} onKeyDown={(e) => e.key === 'Enter' && setEdit(title)}>
          {title}
          <Icon name="pen" size={13} className="ab-pen" />
        </b>
      ) : (
        <b>{title}</b>
      )}
      <small>{sub}</small>
    </span>
  );
}
