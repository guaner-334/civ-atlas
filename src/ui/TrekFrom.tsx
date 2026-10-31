/**
 * 国家卡片、人物卡「来历」里大迁徙的出发地(第 m 次大迁徙的第一州):点了跳到动身那年 ——
 * 和点编年史里那一件一样,地图上那一州闪、标签钉在那里,箭头从那里往外长。
 */
import type { Civ } from '../gen/civ/types';
import { regionLabel } from '../gen/civ/story/display';
import { pickChronicleEntry } from './civView';
import { departureEntry } from './migrationInfo';

export function TrekFrom({ civ, m }: { civ: Civ; m: number }) {
  const M = civ.migrations?.[m];
  if (!M?.route.length) return null;
  return (
    <button
      className="ins-link"
      data-act="trek-from"
      onClick={() => {
        const e = departureEntry(civ, m);
        if (e) pickChronicleEntry(e);
      }}
    >
      {regionLabel(civ, M.route[0])}
    </button>
  );
}
