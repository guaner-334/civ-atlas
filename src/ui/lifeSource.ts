/**
 * AI 写列传、家传要的人物材料(ai/prompts/lives.ts 的 LifeSource):推演里的人照他的人物卡(PersonPanel.tsx 的 personCard),
 * 作者的人物照他的人物卡(地名、出生地归哪国要地图才算得出,所以放在界面层)。HistoryBook.tsx 组好交给 bookStore。
 */
import type { Civ } from '../gen/civ/types';
import type { Raster } from '../gen/raster';
import type { World } from '../gen/world';
import { polityName } from '../gen/civ/growth';
import { regionLabel } from '../gen/civ/story/display';
import { lifeInOrder, resolvePersonKey, type AuthorCharacter } from '../gen/characters';
import type { ChronicleEntry } from '../gen/civ/story/chronicle';
import type { CharacterCard, LifeSource, PersonCard } from '../ai/prompts/lives';
import { characterPolity, eventOfKey, kinList, placeOf } from './characterInfo';
import { getEdits } from './editsStore';
import { personCard } from './PersonPanel';

/** 作者的人物 → 写列传的材料:作者写的原样,地方写成地名,勾上的推演里的事、人找出来(重推以后找不到的不列) */
export function characterCard(civ: Civ, world: World, raster: Raster | null, c: AuthorCharacter, chars: readonly AuthorCharacter[]): CharacterCard {
  const p = characterPolity(civ, world, raster, c);
  const at = (y: number) => Math.min(civ.endYear, Math.max(0, y));
  let birthplace = '';
  if (c.birthplace) {
    const pl = placeOf(civ, world, raster, c.birthplace, c.born);
    if (!pl.missing) birthplace = `${pl.name}${pl.kind === 'city' && pl.region !== undefined ? `（${regionLabel(civ, pl.region)}）` : ''}`;
  }
  const life = lifeInOrder(c).map(({ e }) => {
    const where = e.where ? placeOf(civ, world, raster, e.where, e.year) : null;
    return {
      year: e.year,
      text: e.text,
      where: where && !where.missing ? where.name : '',
      events: (e.events ?? []).map((k) => eventOfKey(civ, k)).filter((x): x is ChronicleEntry => !!x),
      people: (e.people ?? []).map((k) => resolvePersonKey(civ, k)).filter((id) => id >= 0),
    };
  });
  return {
    name: c.name,
    ...(c.female ? { female: true as const } : {}),
    born: c.born,
    died: c.died,
    role: c.role ?? '',
    polity: p >= 0 && civ.polities[p] ? polityName(civ.polities[p], at(c.born)) : '',
    birthplace,
    note: c.note ?? '',
    kin: kinList(civ, c, chars)
      .filter((k) => !k.missing)
      .map((k) => ({ rel: k.rel, name: k.name, ...(k.person !== undefined ? { person: k.person } : {}) })),
    life,
  };
}

/** 一个世界的材料来源:人物卡按人缓存(同一份历史里不变);作者的人物每次现取(作者随时在改) */
export function lifeSource(civ: Civ, world: World | null, raster: Raster | null): LifeSource {
  const cards = new Map<number, PersonCard | null>();
  return {
    person(id) {
      if (!cards.has(id)) {
        const x = civ.people?.[id];
        cards.set(id, x && civ.polities[x.polity] ? personCard(civ, x) : null);
      }
      return cards.get(id)!;
    },
    character(id) {
      const chars = getEdits().characters ?? [];
      const c = chars.find((x) => x.id === id);
      return c && world ? characterCard(civ, world, raster, c, chars) : null;
    },
  };
}
