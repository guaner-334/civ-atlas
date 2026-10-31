/**
 * 天灾的几样小工具(干预 disaster,见 disaster.ts):推演、编年史、界面共用,只看地形数据,不碰推演状态。纯计算,不碰 DOM。
 */
import { biomeTagged } from '../biomes';
import { AdjKind, type Regions } from './types';
import { keyed, subSeed } from './engine/rand';

/** 作者下的瘟疫(干预"天灾"):第几场 = PLAGUE_IV + 干预下标(和自己起疫的编号错开,plague.ts) */
export const PLAGUE_IV = 1_000_000;
/** 自己发生的全球大疫(pandemic.ts):第几场 = PANDEMIC_K + 第几次看全球大疫(和自己起疫、作者下的错开) */
export const PANDEMIC_K = 2_000_000;
/** 作者下的天灾,城里死几成(轻 / 中 / 重;下标 = 轻重) */
export const IV_LOSS: readonly number[] = [0, 0.15, 0.3, 0.5];
/** 编年史里写死了多少(下标 = 轻重) */
export const IV_TOLL = ['', '十之一二', '十之三', '十之五'] as const;

// ---------------------------------------------------------------------------
// 「天灾」设定(新建世界时定;CivParams.calamity、Civ.calamity)

/** 「天灾」:多 / 很多(平常 = 不写) */
export type Calamity = 'more' | 'many';
export const CALAMITIES: readonly Calamity[] = ['more', 'many'];
/** 怎么叫 */
export const CALAMITY_NAMES: Record<Calamity, string> = { more: '多', many: '很多' };

/** 「天灾」多 / 很多时各样灾的倍数(平常 = 现在的规则,不查这张表) */
export interface CalamityRates {
  /** 瘟疫起疫的几率 × */
  plague: number;
  /** 起疫时是大瘟疫的几率(平常 0.3 = plague.ts 的 GREAT_ODDS;世界调过 GREAT_ODDS 的,这里跟着按比例变) */
  great: number;
  /** 瘟疫死几成 ×(一城一次最多死 PLAGUE_LOSS_CAP) */
  plagueLoss: number;
  /** 灾年(饥荒)的几率 × */
  famine: number;
  /** 地震水旱自己发生:每国约每多少年一次 */
  quakeYears: number;
  /** 全球大疫自己发生(世上有国家能远洋以后):约每多少年一次 */
  pandemicYears: number;
  /** 自己发生的全球大疫凋敝几年:轻 → 重 */
  slump: readonly [number, number];
}

export const CALAMITY_RATES: Readonly<Record<Calamity, CalamityRates>> = {
  more: { plague: 2, great: 0.4, plagueLoss: 1.2, famine: 1.8, quakeYears: 200, pandemicYears: 600, slump: [20, 40] },
  many: { plague: 3, great: 0.5, plagueLoss: 1.4, famine: 2.5, quakeYears: 100, pandemicYears: 300, slump: [30, 50] },
};

/** 「天灾」多 / 很多时一般瘟疫一城一次最多死几成(平常照旧 0.5) */
export const PLAGUE_LOSS_CAP = 0.6;

/** 「天灾」设定的倍数(平常 / 认不出 = null) */
export function calamityRates(c: Calamity | undefined): CalamityRates | null {
  return c === 'more' || c === 'many' ? CALAMITY_RATES[c] : null;
}

/** 清理「天灾」设定:认得出的多 / 很多原样返回,别的(平常、认不出)= undefined */
export function cleanCalamity(x: unknown): Calamity | undefined {
  return x === 'more' || x === 'many' ? x : undefined;
}

// ---------------------------------------------------------------------------
// 全球大疫(pandemic.ts、plague.ts 共用的几个数)

/** 全球大疫染上的城死几成的基数(轻 / 中 / 重;下标 = 轻重);中的在 0.3–0.4 之间 */
export const PAN_LOSS: readonly number[] = [0, 0.2, 0.35, 0.5];
/** 大城(人口 ≥ PAN_CROWD_POP 千人)、港口人挤,再多死这么多 */
export const PAN_CROWD = 0.1;
export const PAN_CROWD_POP = 80;
/** 一城一次最多死几成(保底) */
export const PAN_LOSS_MAX = 0.6;
/** 疫后无人收拾几年:作者能选的几档、不选时 */
export const SLUMP_CHOICES: readonly number[] = [10, 30, 60];
export const SLUMP_DEFAULT = 30;

/** 全球大疫的随机数从这里取(pandemic.ts;plague.ts 接着推时也要算自己发生的那几场有多重) */
export function pandemicBase(seed: number): number {
  return subSeed(seed, 'civ-pandemic');
}

/**
 * 第 j 次看全球大疫起的那一场(自己发生的)有多重(1–3)、凋敝几年:
 * 多 = 轻三成、中五成、重两成;很多 = 轻两成、中五成、重三成;凋敝年数按轻重在 CalamityRates.slump 里取
 */
export function naturalPandemic(base: number, c: Calamity, j: number): { level: 1 | 2 | 3; slump: number } {
  const u = keyed(base, j, 0, U_PAN_LEVEL);
  const light = c === 'many' ? 0.2 : 0.3;
  const level = u < light ? 1 : u < light + 0.5 ? 2 : 3;
  const [lo, hi] = CALAMITY_RATES[c].slump;
  return { level, slump: lo + ((hi - lo) * (level - 1)) / 2 };
}
/** naturalPandemic 的随机数用途编号(和 pandemic.ts 的错开) */
const U_PAN_LEVEL = 9;

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

/** 干旱的地方(地震水旱写"大旱";按 Biome 下标,见地貌表的标签 arid) */
const DRY = biomeTagged('arid');

/** 地震水旱叫什么:那一处挨着大河(有跨河的邻州)写"大水",干旱的地方(荒漠、草原、稀树草原)写"大旱",别处写"地震" */
export function quakeWord(reg: Pick<Regions, 'count' | 'adjStart' | 'adjKind' | 'biome'>, r: number): '大水' | '大旱' | '地震' {
  if (!(r >= 0 && r < reg.count)) return '地震';
  for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) if (reg.adjKind[k] === AdjKind.River) return '大水';
  return DRY[reg.biome[r]] ? '大旱' : '地震';
}
