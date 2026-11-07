/** 官方三组数表在总登记(CivSim.tables)里的组名:读口和插件按「组名.表名」找表,定了不改 */
export const TABLE_GROUP = {
  /** 政局:管辖、钱粮、乡村人口、动荡、国力(control.ts) */
  state: 'state',
  /** 发展度:五种能力、时代、物产(development.ts) */
  dev: 'dev',
  /** 思潮(ideology.ts) */
  ideology: 'ideology',
} as const;
