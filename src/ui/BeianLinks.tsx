/**
 * 备案号那几个链接(号码从哪来、挂在哪几处见 beian.ts):新标签页打开备案查询。没有号码时什么都不画。
 * 样子跟着所在的那排小字走,各处自己给 className(并排时的间距也在那里)
 */
import { BEIAN, type BeianRecord } from './beian';

export function BeianLinks({ className, list = BEIAN }: { className: string; list?: BeianRecord[] }) {
  if (!list.length) return null;
  return (
    <span className={className} data-beian>
      {list.map((r) => (
        <a key={r.id} href={r.href} target="_blank" rel="noreferrer" data-link={`beian-${r.id}`}>
          {r.text}
        </a>
      ))}
    </span>
  );
}
