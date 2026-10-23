/**
 * 天灾的几样小工具(干预 disaster,见 disaster.ts):推演、编年史、界面共用,只看地形数据,不碰推演状态。纯计算,不碰 DOM。
 */
import { Biome } from '../biomes';
import { AdjKind, type Regions } from './types';

/** 作者下的瘟疫(干预"天灾"):第几场 = PLAGUE_IV + 干预下标(和自己起疫的编号错开,plague.ts) */
export const PLAGUE_IV = 1_000_000;
/** 作者下的天灾,城里死几成(轻 / 中 / 重;下标 = 轻重) */
export const IV_LOSS: readonly number[] = [0, 0.15, 0.3, 0.5];
/** 编年史里写死了多少(下标 = 轻重) */
export const IV_TOLL = ['', '十之一二', '十之三', '十之五'] as const;

/** 地震水旱:那一处连同陆上接壤的一圈州(陆路、跨河、翻山;不过海峡、航线),州号升序 */
export function quakeRing(reg: Pick<Regions, 'count' | 'adjStart' | 'adj' | 'adjKind'>, r: number): number[] {
  if (!(r >= 0 && r < reg.count)) return [];
  const out = new Set<number>([r]);
  for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
    const kind = reg.adjKind[k];
    const j = reg.adj[k];
    if (kind === AdjKind.Strait || kind === AdjKind.SeaRoute || j >= reg.count) continue;
    out.add(j);
  }
  return [...out].sort((a, b) => a - b);
}

/** 干旱的地方(地震水旱写"大旱") */
const DRY = new Set<number>([Biome.HotDesert, Biome.TemperateDesert, Biome.ColdDesert, Biome.Steppe, Biome.Savanna]);

/** 地震水旱叫什么:那一处挨着大河(有跨河的邻州)写"大水",干旱的地方(荒漠、草原、稀树草原)写"大旱",别处写"地震" */
export function quakeWord(reg: Pick<Regions, 'count' | 'adjStart' | 'adjKind' | 'biome'>, r: number): '大水' | '大旱' | '地震' {
  if (!(r >= 0 && r < reg.count)) return '地震';
  for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) if (reg.adjKind[k] === AdjKind.River) return '大水';
  return DRY.has(reg.biome[r]) ? '大旱' : '地震';
}
