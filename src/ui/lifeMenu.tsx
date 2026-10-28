/**
 * AI 写列传、家传的两个入口(写、存、读和写史书同一套,见 bookStore.ts):
 * - 人物卡、作者人物卡「更多」最下面,隔一条线:「让 AI 写列传」。还没设置 AI 右边小字"需设置"(点了提示去设置);
 *   写过了小字"已写",点了直接打开那篇(阅读页里有「重写」)
 * - 世系图那一行右边:「让 AI 写这一朝的家传」(手机上在那一行下面)
 * 「使用 AI 功能」关着时都不显示
 */
import type { Civ } from '../gen/civ/types';
import { useAiOn } from '../ai/client';
import type { LifeScope } from '../ai/prompts/lives';
import { useLifeNote, writeLife } from './bookStore';
import { closeOverview } from './overviewStore';
import { AiMenuItem, MenuSep } from './PopMenu';
import { Icon } from './icons';

/** 「更多」菜单最下面的一条线 +「让 AI 写列传」 */
export function LifeMenuItem({ civ, scope }: { civ: Civ; scope: LifeScope }) {
  const on = useAiOn();
  const written = useLifeNote(civ, on ? scope : null);
  if (!on) return null;
  return (
    <>
      <MenuSep />
      <AiMenuItem icon={<Icon name="book" size={16} />} act="life-book" note={written ? '已写' : undefined} onClick={() => writeLife(scope, written, civ)}>
        让 AI 写列传
      </AiMenuItem>
    </>
  );
}

/** 世系图那一行右边的「让 AI 写这一朝的家传」:先关上世界概览(窗口、提示条在它下面会被挡住) */
export function HouseBookButton({ civ, polity, dynasty }: { civ: Civ; polity: number; dynasty: number }) {
  const on = useAiOn();
  if (!on) return null;
  return (
    <button
      className="lg-ai"
      data-act="house-book"
      onClick={() => {
        closeOverview();
        writeLife({ kind: 'house', polity, dynasty }, null, civ);
      }}
    >
      让 AI 写这一朝的家传
    </button>
  );
}
