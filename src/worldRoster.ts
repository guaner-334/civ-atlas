/**
 * 世界内容在仓库里、却不在「我的世界」名单上时,怎么判断这个世界还要不要。
 * 名单和删除记录在 localStorage,可能被回退(硬盘真满时 WebKit 写了也会丢,重开浏览器就回到以前的样子)、被用的人清掉一部分;
 * 所以删除、撤销在仓库的小状态里也记一笔(几个记号见 RosterMarks)。值都是那次删除记录上的时间,只比相等不比先后:时钟跳了也不会认错。
 *
 *   有删除记录,撤销的就是这一次       撤销过,撤销被回退了    认回来
 *   有删除记录,别的                  删了                  不认
 *   没有记录,仓库记着删了、没撤销     删了,记录丢了          不认,把记录补回去,照常到期清
 *   没有记录,仓库记着在名单上过       名单丢了              认回来(登录了不认:账号里有,同步会取回来)
 *   什么记号都没有                   说不清                不认,也不清
 *
 * 宁可不认:认错了是用的人删掉的世界变回来。没有「在名单上过」这个记号的内容(打开文件时先写的仓库、还没写名单)不会被当成丢了的。
 * 这个文件首页也用(ui/lostWorlds.ts),别带东西进来。
 */

/** 库名 */
export const VAULT_DB = 'civ-atlas:worlds';

export interface RosterMarks {
  /** 这个世界在名单上时存进过仓库、被看到过(时间):还在名单外就是名单丢了 */
  listed?: number;
  /** 名单上记的现存几国:认回来时卡片上用 */
  alive?: number;
  /** 用的人删了(那次删除记录上的时间) */
  deleted?: number;
  /** 那次删除不能再撤销了(撤销提示收起了、别的设备上删的) */
  settled?: number;
  /** 撤销了哪一次删除 */
  undid?: number;
}

/**
 * rescue:认回来;remark:删了,记录丢了,补回去;deleted:删了;unsure:说不清;account:名单丢了,等同步从账号取回来
 */
export type RosterStep = 'rescue' | 'remark' | 'deleted' | 'unsure' | 'account';

/** 删除记录上的这一次撤销过,之后也没有再删:回退到更早那次删除记录时,仓库里记着的后来那次删除还算数 */
export function undidThis(marks: RosterMarks | null | undefined, trashedAt: number): boolean {
  return marks?.undid === trashedAt && (marks.deleted === undefined || marks.deleted === trashedAt);
}

/** trashedAt = 这个世界的删除记录(没有 = undefined);只问不在名单上的世界 */
export function rosterStep(marks: RosterMarks | null | undefined, trashedAt: number | undefined, signedIn: boolean): RosterStep {
  if (trashedAt !== undefined) return undidThis(marks, trashedAt) ? 'rescue' : 'deleted';
  if (marks?.deleted !== undefined && marks.deleted !== marks.undid) return 'remark';
  if (marks?.listed === undefined) return 'unsure';
  return signedIn ? 'account' : 'rescue';
}
