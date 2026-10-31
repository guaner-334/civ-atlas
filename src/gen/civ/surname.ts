/**
 * 东方中式全名拆姓(人物、名臣、女性人物起名时用;界面、编年史从 story/peopleText.ts 取)。
 * 单独一个小文件:推演只用得到这一样,不用跟着带上称呼、头衔那些文字。
 */

/** 东方中式的全名拆出姓(复姓两个字) */
export function splitSurname(full: string): string {
  const two = full.slice(0, 2);
  return COMPOUND.has(two) && full.length > 2 ? two : full.slice(0, 1);
}
const COMPOUND = new Set(['司马', '欧阳', '上官', '慕容', '宇文', '长孙', '独孤', '皇甫', '令狐', '尉迟', '南宫', '司空', '东方', '端木', '百里']);
