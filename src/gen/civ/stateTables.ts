/**
 * 政局的数表(control.ts 建引擎、每年算一步):各州"中央管得到几成""离国都多远"、乡村人口,各国的"动荡"和钱粮。
 * 规则用数表的公式语言写(tables/compile.ts),意思见 control.ts、unrest.ts、population.ts 的文件头;
 * 事件层(打仗、分裂、割据、民变、大崩解……)读的是最近一次算出来的值(每年年初算一次,年里的事下一年才算进去)。
 *
 * 一步里的先后(after):管得到几成、离国都多远、开垦了几成、兵祸 → 地力 → 挤不挤 → 乡村人口 → 钱粮(应缴、实收 → 岁入、岁出 → 国库 → 窘迫)
 * → 动荡底(读这一步刚算完的离国都多远、窘迫)→ 动荡(压到 0 以上、加上割据)。
 * 输入表(事件层每年填好):国(编号表,州 → 国);各州离国都的路程、是不是国都、是不是异族、被征服了几年、有没有大城、是不是割据的地盘、
 * 乡村人口上限、长得多快、上一步以来的兵灾几件、有几个邻州有人住过、地经不经得住种、上一步以来的饥荒水旱几件;
 * 各国国都所在州的行政能力、危机、当朝几年、近年闹饥荒 / 染疫的州数、在讨伐的民变、割据几处、有几州、在打几场仗、纳贡收贡。
 * 每 FISCAL_EVERY 年填一次(只给按州的三样收入用):各州城的人口、生产和运输能力、有没有港口、大河。
 *
 * **乡村人口**(每 POP_EVERY 年算一次,千人;population.ts):
 *   开垦了几成(垦,0–1):这州建了第一座城起从 1 / (1 + GROWTH_A) 按 S 形曲线长(速度 = 那座城的增长速度),是"太平年景该有多少人"的底子;
 *   地力(0–1,开头是 1):每年养回来缺的 LAND_REST,耗掉 WEAR × 垦 × 脆(荒漠、草原的地经不住种,挨着大河的有淤泥补,减半),
 *   兵祸荒了田再耗 SCORCH × 兵祸;上一步以来每有一件饥荒、大水、大旱扣 BLIGHT;不低于 LAND_FLOOR。
 *   乡村人口每年往"上限 × 垦 × 地力"靠拢 1 / RECOVER(死伤、逃散以后几十年长回来;多出来的慢慢退回去);
 *   再往邻州搬(move):①人往不挤的地方去:自己比邻州挤(人口 ÷ 该有的)多少,每年搬 MIG × 那么多成;
 *   ②逃兵灾:本州兵祸比邻州重多少,每年再搬 FLEE × 那么多成(分给有人住的邻州)。
 *   跨国打 ABROAD 折,翻山 MOUNTAIN_W、过海峡 STRAIT_W,远洋航线不走。兵祸 = 上一步的 × FADE^年数 + HIT × 上一步以来的兵灾件数(最多 1)。
 *   洗劫、毁城、饥荒、瘟疫时乡村当即折损一截(事件层写回)。
 *
 * **钱粮**(一年一算,单位是"千石",只比大小):
 *   各州三样收入(每 FISCAL_EVERY 年算一次):
 *     田赋 = 乡村人口 × 地力(上面两张表;地薄了收成也少)× LAND × (1 + LAND_PROD × 生产能力)
 *     工商 = 城的人口 × CRAFT × (1 + CRAFT_PROD × 生产能力)
 *     市税 = 城的人口 × TRADE × (1 + TRADE_MOVE × 运输能力) × (1 + PORT_W × 港口 + RIVER_W × 大河)
 *   应缴 = 全国三样之和;实收 = 各州 × 交上来几成(REMIT_0 + (1 − REMIT_0) × 管得到几成;割据的地盘一文不交),其余地方截留(拖欠)。
 *   第四样贡赋:藩属每年把实收的 TRIBUTE 交给宗主(纳贡算岁出,收贡算岁入)。
 *   岁入 = 实收 + 收贡;岁出 = 养官 OFFICE × 应缴 + 军费 ARMY × 应缴 × 在打几场仗 + 纳贡。
 *   国库 = 上一年的 + 岁入 − 岁出,压在 0 到 RESERVE 年的应缴之间。
 *   窘迫(0–1):国库空了还入不敷出时 = 缺口占岁出的几成 × GAIN(最多 1);新朝初立 GRACE 年内不算。
 *   窘迫加进动荡(FISCAL_W × 窘迫),也让宣战少、战事早罢(wars.ts 读)。
 */
import type { TableCard } from './tables';
import { NEVER } from './devTables';

/** 管得到几成、离国都多远的常数(control.ts 给;名字和那边一样) */
export interface ControlRuleConsts {
  REACH: number;
  ADMIN_GAIN: number;
  FOREIGN: number;
  RECENT: number;
  RECENT_CUT: number;
  BIG_CITY: number;
  FAR_REACH: number;
  ADMIN_REF: number;
  REMOTE_MAX: number;
  LORD_U: number;
  LORD_U_MAX: number;
}

/** 动荡的常数(unrest.ts 给;名字和那边一样) */
export interface UnrestRuleConsts {
  FAR_0: number;
  FAR_W: number;
  FOREIGN_W: number;
  AGE_0: number;
  AGE_SPAN: number;
  AGE_W: number;
  NEW_YEARS: number;
  NEW_W: number;
  FAMINE_FULL: number;
  FAMINE_FULL_MIN: number;
  FAMINE_W: number;
  PLAGUE_FULL: number;
  PLAGUE_W: number;
  REVOLT_W: number;
}

/** 钱粮的常数(control.ts 给;名字和那边一样) */
export interface FiscalRuleConsts {
  LAND: number;
  LAND_PROD: number;
  CRAFT: number;
  CRAFT_PROD: number;
  TRADE: number;
  TRADE_MOVE: number;
  PORT_W: number;
  RIVER_W: number;
  REMIT_0: number;
  TRIBUTE: number;
  OFFICE: number;
  ARMY: number;
  RESERVE: number;
  GAIN: number;
  GRACE: number;
  FISCAL_W: number;
  FISCAL_EVERY: number;
}

/** 乡村人口的常数(population.ts 给;名字和那边一样) */
export interface PopRuleConsts {
  GROWTH_A: number;
  POP_EVERY: number;
  RECOVER: number;
  MIG: number;
  FLEE: number;
  HIT: number;
  FADE: number;
  FADE_STEP: number;
  ABROAD: number;
  MOUNTAIN_W: number;
  STRAIT_W: number;
  LAND_REST: number;
  WEAR: number;
  SCORCH: number;
  BLIGHT: number;
  LAND_FLOOR: number;
}

/** 输入表的上下限(只是写在卡上;输入表由事件层直接填,不压) */
const BIG = 1e15;

/** 政局的全部表(输入表在前) */
export function stateCards(c: ControlRuleConsts, u: UnrestRuleConsts, f: FiscalRuleConsts, h: PopRuleConsts): TableCard[] {
  const num = (id: string, name: string): TableCard => ({ id, name, unit: 'region', input: true, min: -BIG, max: BIG, off: 0 });
  const pol = (id: string, name: string): TableCard => ({ ...num(id, name), unit: 'polity' });
  const consts = { ...c, ...u, ...f, ...h, NEVER };

  const inputs: TableCard[] = [
    { id: '国', name: '归哪国', unit: 'region', kind: 'id', min: -1, max: 1e9, off: -1 },
    num('路程', '离国都的路程(走不到 = NEVER)'),
    num('是国都', '是不是国都所在的州'),
    num('异族', '是不是异族的州'),
    num('新征', '从别国打下来几年了(不是 = NEVER)'),
    num('大城', '有没有大城(城的人口上限有国都的一半以上)'),
    num('割据州', '是不是割据的地盘'),
    num('乡容', '乡村人口上限(千人;这州还没建过城 = 0)'),
    num('乡速', '乡村人口长得多快(这州第一座城的增长速度)'),
    num('新祸', '上一步以来本州的战役、攻占、洗劫、毁城、饥荒有几件'),
    num('有人邻州', '有几个邻州有人住过(乡村人口上限 > 0)'),
    num('脆', '地力经不经得住种(荒漠 1,草原 0.7……;挨着大河减半)'),
    num('新荒', '上一步以来本州的饥荒、大水、大旱有几件'),
    num('城民', '城的人口(千人;每 FISCAL_EVERY 年填一次)'),
    num('生产', '生产能力(同上)'),
    num('运输', '运输能力(同上)'),
    num('港口', '有没有港口(同上)'),
    num('大河', '有没有大河(同上)'),
    pol('国都行政', '国都所在州的行政能力'),
    pol('危机', '危机(国土大、刚丢了国都 / 迁了都、正在打仗、接连丢州)'),
    pol('当朝', '当朝几年了'),
    pol('饥荒', '近年闹饥荒的州数'),
    pol('疫病', '近年染疫的州数'),
    pol('平叛', '在讨伐的民变有几处'),
    pol('割据', '割据几处'),
    pol('州数', '国家有几州'),
    pol('战事', '在打几场仗'),
    pol('纳贡', '交给宗主的贡赋'),
    pol('收贡', '藩属交来的贡赋'),
  ];

  /** 行政越强,远处的州也管得住:管得到的远近、离国都远近的折算都乘它 */
  const admin = 'let 行政 = 1 + ADMIN_GAIN * max(0, 国都行政)';
  const control: TableCard = {
    id: '管辖',
    name: '中央管得到几成',
    unit: 'region',
    min: 0,
    max: 1,
    off: 0,
    builtin: true,
    consts,
    rule: [
      admin,
      'let x = if(路程 >= NEVER, 4, 路程 / (REACH * 行政))',
      // 异族、刚被征服(随年数淡去)、当地有大城都打折
      'let c = 1 / (1 + x * x) * if(异族, FOREIGN, 1) * if(新征 < RECENT, 1 - RECENT_CUT * (1 - 新征 / RECENT), 1) * if(大城, BIG_CITY, 1)',
      'if(not has(国), 0, if(是国都, 1, c))',
    ].join('\n'),
  };
  const remote: TableCard = {
    id: '边远',
    name: '离国都多远(按行政折算)',
    unit: 'region',
    min: 0,
    max: c.REMOTE_MAX,
    off: 0,
    builtin: true,
    consts,
    rule: [
      admin,
      // 行政能力在 ADMIN_REF 时就是"路程 ÷ FAR_REACH"
      'let 折算 = 行政 / (1 + ADMIN_GAIN * ADMIN_REF)',
      'if(not has(国), 0, if(路程 >= NEVER, REMOTE_MAX, min(REMOTE_MAX, 路程 / (FAR_REACH * 折算))))',
    ].join('\n'),
  };
  // ---- 乡村人口 ----
  const region = (id: string, name: string, max: number, rule: string, after?: string[]): TableCard => ({ id, name, unit: 'region', every: h.POP_EVERY, min: 0, max, off: 0, builtin: true, consts, rule, ...(after ? { after } : {}) });
  const settle = region('垦', '开垦了几成(0–1)', 1, 'if(乡容 <= 0, 0, if(垦 <= 0, 1 / (1 + GROWTH_A), 垦 + dt * 乡速 * 垦 * (1 - 垦)))');
  // 每步都隔 POP_EVERY 年(第一步兵祸还是 0),FADE^年数 用算好的 FADE_STEP(逐格算乘方太慢)
  const strife = region('兵祸', '兵祸(0–1)', 1, 'min(1, 兵祸 * FADE_STEP + HIT * 新祸)');
  // 地力:慢慢养回来;种得越满、地越脆耗得越多,兵祸荒了田,饥荒、水旱一件扣一截
  const soil: TableCard = {
    ...region(
      '地力',
      '地力(0–1;收成、能养多少人都乘它)',
      1,
      'if(乡容 <= 0, 1, max(LAND_FLOOR, min(1, 地力 + dt * (LAND_REST * (1 - 地力) - WEAR * 垦 * 脆 - SCORCH * 兵祸) - BLIGHT * 新荒)))',
      ['垦', '兵祸'],
    ),
    off: 1,
  };
  // 挤不挤 = 乡村人口(这一步开头的)÷ 该有的:搬家时每条邻边两头都要,先按州算好
  const crowd = region('挤', '挤不挤(乡村人口 ÷ 该有的)', 1e30, '乡口 / max(乡容 * 垦 * 地力, 1e-9)', ['垦', '地力']);
  const rural: TableCard = {
    ...region('乡口', '乡村人口(千人)', 1e9, ['let 该有 = 乡容 * 垦 * 地力', 'if(该有 <= 0, 0, if(乡口 <= 0, 该有, 乡口 + dt * (该有 - 乡口) / RECOVER))'].join('\n'), ['垦', '兵祸', '地力', '挤']),
    // 往邻州搬:人往不挤的地方去、逃兵灾(这一步开头的值;没人住过的州不去,远洋航线不走)
    move: [
      'let 路 = if(nb.乡容 <= 0 or edge.kind == 4, 0, if(edge.kind == 3, STRAIT_W, if(edge.kind == 2, MOUNTAIN_W, 1))) * if(nb.国 == 国, 1, ABROAD)',
      '路 * 乡口 * (MIG * max(0, 挤 - nb.挤) + FLEE * max(0, 兵祸 - nb.兵祸) / max(1, 有人邻州))',
    ].join('\n'),
  };

  // ---- 钱粮 ----
  const BIGF = 1e12;
  const income = (id: string, name: string, rule: string): TableCard => ({ id, name, unit: 'region', every: f.FISCAL_EVERY, min: 0, max: BIGF, off: 0, builtin: true, consts, rule });
  const ledger = (id: string, name: string, after: string[], rule: string, max = BIGF): TableCard => ({ id, name, unit: 'polity', min: 0, max, off: 0, builtin: true, after, consts, rule });
  const sources = ['田赋', '工商', '市税'];
  const fiscal: TableCard[] = [
    { ...income('田赋', '田赋', 'if(not has(国), 0, 乡口 * 地力 * LAND * (1 + LAND_PROD * 生产))'), after: ['乡口'] },
    income('工商', '工商', 'if(not has(国), 0, 城民 * CRAFT * (1 + CRAFT_PROD * 生产))'),
    income('市税', '市税', 'if(not has(国), 0, 城民 * TRADE * (1 + TRADE_MOVE * 运输) * (1 + PORT_W * 港口 + RIVER_W * 大河))'),
    { ...income('税', '三样收入之和', '田赋 + 工商 + 市税'), after: sources },
    ledger('应缴', '应缴(全国三样收入之和)', ['税'], 'sumof(税)'),
    // 交上来几成跟着管得到几成;割据的地盘一文不交
    ledger('实收', '实收(各州交上来的)', ['税', '管辖'], 'sumof(税 * if(割据州, 0, REMIT_0 + (1 - REMIT_0) * 管辖))'),
    ledger('岁入', '岁入', ['实收'], '实收 + 收贡'),
    ledger('岁出', '岁出', ['应缴'], '应缴 * (OFFICE + ARMY * 战事) + 纳贡'),
    ledger('国库', '国库', ['岁入', '岁出'], 'max(0, min(RESERVE * 应缴, 国库 + dt * (岁入 - 岁出)))'),
    ledger('窘迫', '国用不足(0–1)', ['国库'], 'if(国库 > 0 or 岁出 <= 0 or 当朝 < GRACE, 0, min(1, GAIN * max(0, 岁出 - 岁入) / 岁出))', 1),
  ];

  const base: TableCard = {
    id: '动荡底',
    name: '动荡(压到 0 以上之前、不算割据)',
    unit: 'polity',
    min: -100,
    max: 100,
    off: 0,
    builtin: true,
    after: ['边远', '窘迫'],
    consts,
    rule: [
      'let N = 州数',
      // 危机 + 边远的州多 + 异族多;王朝老了渐涨,新朝初立反倒减;近年闹了饥荒、瘟疫;民变还没平;国用不足
      'let u = 危机 + FAR_W * max(0, sumof(边远) / N - FAR_0) + FOREIGN_W * sumof(异族) / N +',
      '  if(当朝 < NEW_YEARS, -NEW_W, AGE_W * min(1, max(0, (当朝 - AGE_0) / AGE_SPAN))) +',
      '  if(饥荒 > 0, FAMINE_W * min(1, 饥荒 / max(FAMINE_FULL_MIN, FAMINE_FULL * N)), 0) +',
      '  if(疫病 > 0, PLAGUE_W * min(1, 疫病 / max(FAMINE_FULL_MIN, PLAGUE_FULL * N)), 0) +',
      '  REVOLT_W * 平叛 + FISCAL_W * 窘迫',
      'if(N > 0, u, 0)',
    ].join('\n'),
  };
  const unrest: TableCard = {
    id: '动荡',
    name: '动荡',
    unit: 'polity',
    min: 0,
    max: 100,
    off: 0,
    builtin: true,
    after: ['动荡底'],
    consts,
    // 不到 0 按 0 算;每有一处割据再加一点
    rule: 'max(0, 动荡底) + min(LORD_U_MAX, LORD_U * 割据)',
  };
  return [...inputs, control, remote, settle, strife, soil, crowd, rural, ...fiscal, base, unrest];
}
