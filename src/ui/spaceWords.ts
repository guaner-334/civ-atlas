/** 点开窗口才下载,不进首页。 */
import { sizeText, aboutSize } from './sizeWords';
import { roomLeft, type AppleDevice, type FileStatus, type RoomFacts, type SpaceBarState } from './spaceFacts';

export const SIZE_NOTE = '这里的大小比存成文件时大，因为浏览器里多留了一份备用。同一张地图上的文明共用一份地图，删掉其中一个，腾出来的比写的少一点。';
export const CHROME_NOTE = '硬盘快满时，浏览器可能先清掉这里的世界。存成文件就不会丢。';
export const FIREFOX_NOTE = '你没有答应 Firefox 长期保存。硬盘快满时，它可能先清掉这里的世界。存成文件就不会丢。';
export const KEPT_NOTE = '这个浏览器答应长期保存这里的世界。清理浏览器数据还是会删掉。';
export const NEAR_NOTE = '不常看的世界存成文件再删掉，就能腾出地方。这台设备剩的地方不多，别的应用也在用。';
export const FULL_NOTE = '标着「没存上」的世界现在还能看。存成文件就不会丢，或者删掉几个世界，腾出地方后会接着存。';
export const FULL_NONE_NOTE = '存成文件就不会丢，或者删掉几个世界，腾出地方后会接着存。';
export const CABINET_NOTE = '放世界名字、封面和 AI 写的文字的地方满了。这部分浏览器只给约 5 MB，和上面的数字不是一回事。删掉几个世界就能腾出来，存成文件腾不出来。';

export const UNSAVED_NOW = '改动没存上，关掉页面就没了';
export const UNSAVED_CONTENT = '内容没存上，以后要重新算';

/** cabinet:只是 localStorage 满了,世界仓库还有地方 */
export type FullKind = 'vault' | 'cabinet' | null;

export interface WindowFacts {
  used: number | null;
  room: RoomFacts | null;
  full: FullKind;
  near: boolean;
  unsaved: number;
  device: AppleDevice | null;
  firefoxNo: boolean;
  loggedIn: boolean;
  persisted: boolean | null;
  allSaved: boolean;
  bigger: boolean;
  gone: boolean;
}

export function sumLine(f: WindowFacts): string {
  // 硬盘真的满了时 WebKit 连库都打不开,读不出占了多少
  if (f.used === null) return f.full === 'vault' ? '这个浏览器已经放不下了。' : '';
  if (f.full === 'vault') return `这个浏览器里占了 ${sizeText(f.used)}，已经放不下了。`;
  if (f.room) return `这个浏览器里占了 ${sizeText(f.room.usage)}，最多还能存${aboutSize(roomLeft(f.room))}。`;
  return `这个浏览器里占了 ${sizeText(f.used)}。`;
}

/** 苹果设备上没有能信的额度,不画 */
export function meterOf(f: WindowFacts): number | null {
  if (!f.room) return null;
  if (f.full === 'vault') return 100;
  if (!f.near) return null;
  return Math.min(100, Math.round((f.room.usage / f.room.quota) * 100));
}

export function windowNotes(f: WindowFacts): string[] {
  if (f.full === 'vault') return [f.unsaved > 0 ? FULL_NOTE : FULL_NONE_NOTE];
  if (f.full === 'cabinet') return [CABINET_NOTE];
  if (f.near) return [NEAR_NOTE];
  const size = f.bigger ? [SIZE_NOTE] : [];
  if (f.loggedIn) return size;
  if (f.persisted) return [...size, KEPT_NOTE];
  if (f.device) return [`${riskLine(f.device)}${f.allSaved ? '你已经存过文件，清掉了也能放回来。' : keepLine(f.device)}`, ...size];
  if (f.firefoxNo) return [FIREFOX_NOTE, ...size];
  return f.gone ? size : [...size, CHROME_NOTE];
}

export function saveAllBlue(f: WindowFacts, phone: boolean): boolean {
  if (f.full || f.near) return true;
  return phone && !!f.device && !f.loggedIn && f.persisted === false && !f.allSaved;
}

export function dayWords(at: number, now: number): string {
  const d = new Date(at);
  const t = new Date(now);
  if (d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate()) return '今天';
  const year = d.getFullYear() === t.getFullYear() ? '' : `${d.getFullYear()} 年 `;
  return `${year}${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function fileLine(st: FileStatus, now: number): string {
  if (st.kind === 'never') return '还没存过文件';
  return st.kind === 'same' ? `${dayWords(st.at, now)}存过文件` : `${dayWords(st.at, now)}存过，之后改过`;
}

/** 传到账号过的世界那行小字。changed:传了以后又改过 */
export function fullLine(at: number, changed: boolean, now: number): string {
  return `${dayWords(at, now)}传到账号${changed ? '，之后改过' : ''}`;
}

/** 窗口小字第一句(登录了、服务器开了传到账号才有):上面的数字和账号里的不是一回事 */
export const ACCOUNT_APART_NOTE = '上面的数字只算这个浏览器。在这里删掉世界，账号里那份还在。';

export function trashLine(count: number, clearBy: number, loggedIn: boolean, stuck: number, now: number): string {
  const by = `${dayWords(clearBy, now)}前自己清掉`;
  const base = loggedIn ? `${count} 个，还能在「最近删除」里找回，${by}` : `${count} 个，${by}`;
  return stuck > 0 ? `${base}。有 ${stuck} 个现在还不能清：撤销提示还开着，或者别的页面、别的世界在用它` : base;
}

export function riskLine(d: AppleDevice): string {
  if (d === 'safari') return '用 Safari 时，连续 7 天没打开这个网站，世界可能会被清掉。';
  return `在 ${d === 'iphone' ? 'iPhone' : 'iPad'} 上，连续 7 天没打开这个网站，世界可能会被清掉。`;
}

export function keepLine(d: AppleDevice): string {
  if (d === 'safari') return '存成文件放在电脑里，就不会丢。';
  return `存成文件放进${d === 'iphone' ? '手机' : ' iPad'}，就不会丢。`;
}

export interface BarWords {
  warn: boolean;
  title: string;
  body: string;
  saveAll: boolean;
  look: boolean;
}

export function barWords(b: SpaceBarState, maxWorlds: number): BarWords {
  switch (b.kind) {
    case 'full':
      return b.unsaved > 0
        ? { warn: true, title: `浏览器存储已满，${b.unsaved} 个世界没存上`, body: `${b.unsaved > 1 ? '它们' : '它'}现在还能看。全部存成文件就不会丢，或者删掉几个世界`, saveAll: true, look: true }
        : { warn: true, title: '浏览器存储已满', body: '存好的世界不受影响，新的改动存不进去。存成文件就不会丢，或者删掉几个世界', saveAll: true, look: true };
    case 'count':
      return { warn: true, title: `「我的世界」最多存 ${maxWorlds} 个，已经存满了`, body: '新的世界存不进来，现在的不受影响。存成文件再删掉几个，就能接着存', saveAll: true, look: false };
    case 'near':
      return { warn: true, title: `快放不下了，最多还能存${aboutSize(b.left)}`, body: '一个世界约 10 MB。不常看的世界存成文件再删掉，就能腾出地方', saveAll: false, look: true };
    case 'lose-never':
      return { warn: false, title: b.all ? (b.n > 1 ? `这 ${b.n} 个世界还没存成文件` : '这个世界还没存成文件') : `有 ${b.n} 个世界还没存成文件`, body: `${riskLine(b.device)}${keepLine(b.device)}`, saveAll: true, look: false };
    case 'lose-changed':
      return { warn: false, title: `有 ${b.n} 个世界上次存文件以后又改过`, body: `上次存文件是 ${b.days} 天前。${riskLine(b.device)}再存一次就不会丢。`, saveAll: true, look: false };
    case 'lose-small':
      return { warn: false, title: '这个小窗口里的世界可能留不久', body: '到手机浏览器里打开这个网站，新建的世界才留得住。', saveAll: false, look: false };
  }
}
