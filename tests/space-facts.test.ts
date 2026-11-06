import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aboutSize, sizeText } from '../src/ui/sizeWords';
import {
  NEAR_FULL_BYTES,
  appleDevice,
  askPersisted,
  askRoom,
  closeLose,
  closeNear,
  fileRecords,
  fileStatus,
  firstHintSaid,
  inSmallWindow,
  isNearFull,
  loseBar,
  loseOffAt,
  nearBar,
  nearOffAt,
  nearOver,
  noteFileSaved,
  noteFirstHint,
  onSpaceChange,
  pickBar,
  saveMark,
  type FileStatus,
  type LoseFacts,
} from '../src/ui/spaceFacts';
import { barWords, dayWords, fileLine, meterOf, saveAllBlue, sumLine, trashLine, windowNotes, CABINET_NOTE, CHROME_NOTE, FIREFOX_NOTE, FULL_NONE_NOTE, FULL_NOTE, KEPT_NOTE, NEAR_NOTE, SIZE_NOTE, type WindowFacts } from '../src/ui/spaceWords';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1',
  ipadOld: 'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
  /** iPad 的 Safari 默认自称 Mac */
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  wechat: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50',
  qq: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 QQ/9.0.0',
};

const DAY = 24 * 3600_000;
const NOW = Date.UTC(2026, 10, 5, 4);

class FakeStorage {
  map = new Map<string, string>();
  full = false;
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.full) throw new Error('quota');
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

describe('认设备', () => {
  it('苹果手机、苹果平板、Safari 算;别的不算', () => {
    expect(appleDevice({ userAgent: UA.iphone })).toBe('iphone');
    expect(appleDevice({ userAgent: UA.iphoneChrome })).toBe('iphone');
    expect(appleDevice({ userAgent: UA.ipadOld })).toBe('ipad');
    expect(appleDevice({ userAgent: UA.mac, maxTouchPoints: 0 })).toBe('safari');
    expect(appleDevice({ userAgent: UA.macChrome, maxTouchPoints: 0 })).toBe(null);
    expect(appleDevice({ userAgent: UA.macFirefox, maxTouchPoints: 0 })).toBe(null);
    expect(appleDevice({ userAgent: UA.winEdge })).toBe(null);
    expect(appleDevice({ userAgent: UA.androidChrome, maxTouchPoints: 5 })).toBe(null);
    expect(appleDevice({})).toBe(null);
  });

  it('iPad 自称 Mac:有触摸屏的才是 iPad', () => {
    expect(appleDevice({ userAgent: UA.mac, maxTouchPoints: 5 })).toBe('ipad');
    // 电脑上模拟手机的 Chrome 也自称 Mac,带触摸点,不是 iPad
    expect(appleDevice({ userAgent: UA.macChrome, maxTouchPoints: 5 })).toBe(null);
  });

  it('QQ、微信的小窗口', () => {
    expect(inSmallWindow({ userAgent: UA.wechat })).toBe(true);
    expect(inSmallWindow({ userAgent: UA.qq })).toBe(true);
    expect(inSmallWindow({ userAgent: UA.iphone })).toBe(false);
  });
});

describe('还有多少地方', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('还能存的不到 500 MB 算快满了', () => {
    expect(isNearFull({ usage: 10e9, quota: 10e9 + NEAR_FULL_BYTES - 1 })).toBe(true);
    expect(isNearFull({ usage: 10e9, quota: 10e9 + NEAR_FULL_BYTES })).toBe(false);
    expect(isNearFull({ usage: 55e6, quota: 11e9 })).toBe(false);
  });

  it('额度不到 500 MB 的设备平时不算快满了,真的快满了才算', () => {
    expect(isNearFull({ usage: 10e6, quota: 400e6 })).toBe(false);
    expect(isNearFull({ usage: 200e6, quota: 400e6 })).toBe(false);
    expect(isNearFull({ usage: 310e6, quota: 400e6 })).toBe(true);
    // 稿子上那个情况:额度 1 GB,用了 840 MB
    expect(isNearFull({ usage: 840e6, quota: 1e9 })).toBe(true);
  });

  it('苹果设备上不问浏览器(用量不变小、额度跟着涨),别的设备问', async () => {
    const estimate = vi.fn(() => Promise.resolve({ usage: 100, quota: 1000 }));
    vi.stubGlobal('navigator', { userAgent: UA.iphone, storage: { estimate } });
    expect(await askRoom()).toBe(null);
    expect(estimate).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', { userAgent: UA.mac, maxTouchPoints: 0, storage: { estimate } });
    expect(await askRoom()).toBe(null);
    vi.stubGlobal('navigator', { userAgent: UA.macChrome, maxTouchPoints: 0, storage: { estimate } });
    expect(await askRoom()).toEqual({ usage: 100, quota: 1000 });
  });

  it('问不到、问的时候出错:没有数字,不是 0', async () => {
    vi.stubGlobal('navigator', { userAgent: UA.macChrome });
    expect(await askRoom()).toBe(null);
    expect(await askPersisted()).toBe(false);
    vi.stubGlobal('navigator', { userAgent: UA.macChrome, storage: { estimate: () => Promise.reject(new Error('x')), persisted: () => Promise.reject(new Error('x')) } });
    expect(await askRoom()).toBe(null);
    expect(await askPersisted()).toBe(false);
  });

  it('快放不下了:关了以后剩下的再少一半才再说', () => {
    const room = (left: number) => ({ usage: 10e9, quota: 10e9 + left });
    expect(nearBar(room(600e6), null)).toBe(null);
    expect(nearBar(room(160e6), null)).toEqual({ kind: 'near', left: 160e6 });
    expect(nearBar(room(160e6), 160e6)).toBe(null);
    expect(nearBar(room(81e6), 160e6)).toBe(null);
    expect(nearBar(room(79e6), 160e6)).toEqual({ kind: 'near', left: 79e6 });
    expect(nearBar(null, null)).toBe(null);
  });
});

describe('防丢说不说', () => {
  const never: FileStatus = { kind: 'never' };
  const same: FileStatus = { kind: 'same', at: NOW - DAY };
  const changedAt = (days: number): FileStatus => ({ kind: 'changed', at: NOW - days * DAY });
  const base: LoseFacts = { device: 'iphone', small: false, loggedIn: false, persisted: false, files: [never, never], offAt: null, now: NOW };

  it('全都满足才说', () => {
    expect(loseBar(base)).toEqual({ kind: 'lose-never', n: 2, all: true, device: 'iphone' });
    expect(loseBar({ ...base, device: 'ipad' })).toMatchObject({ device: 'ipad' });
    expect(loseBar({ ...base, device: 'safari' })).toMatchObject({ device: 'safari' });
  });

  it('不是苹果设备不说', () => {
    expect(loseBar({ ...base, device: null })).toBe(null);
  });

  it('登录了不说', () => {
    expect(loseBar({ ...base, loggedIn: true })).toBe(null);
  });

  it('浏览器答应长期保存了不说;还没问到先不说', () => {
    expect(loseBar({ ...base, persisted: true })).toBe(null);
    expect(loseBar({ ...base, persisted: null })).toBe(null);
  });

  it('都存过、之后没改过不说;一个世界都没有不说', () => {
    expect(loseBar({ ...base, files: [same, same] })).toBe(null);
    expect(loseBar({ ...base, files: [] })).toBe(null);
  });

  it('有的存过、有的没存过:说没存过的那几个', () => {
    expect(loseBar({ ...base, files: [same, never, never] })).toEqual({ kind: 'lose-never', n: 2, all: false, device: 'iphone' });
  });

  it('存过又改过:过了 14 天才说,写上次存文件是几天前', () => {
    expect(loseBar({ ...base, files: [same, changedAt(13)] })).toBe(null);
    expect(loseBar({ ...base, files: [same, changedAt(14)] })).toEqual({ kind: 'lose-changed', n: 1, days: 14, device: 'iphone' });
    expect(loseBar({ ...base, files: [changedAt(18), changedAt(40)] })).toEqual({ kind: 'lose-changed', n: 2, days: 18, device: 'iphone' });
  });

  it('关掉以后 14 天再说', () => {
    expect(loseBar({ ...base, offAt: NOW - 13 * DAY })).toBe(null);
    expect(loseBar({ ...base, offAt: NOW - 14 * DAY })).not.toBe(null);
  });

  it('QQ、微信的小窗口:不分系统,换一句话', () => {
    expect(loseBar({ ...base, small: true })).toEqual({ kind: 'lose-small' });
    expect(loseBar({ ...base, device: null, small: true })).toEqual({ kind: 'lose-small' });
    expect(loseBar({ ...base, small: true, files: [same] })).toBe(null);
    expect(loseBar({ ...base, small: true, loggedIn: true })).toBe(null);
  });
});

describe('同一时间只有一条', () => {
  const lose = { kind: 'lose-never', n: 1, all: true, device: 'iphone' } as const;
  const near = { kind: 'near', left: 1 } as const;
  const off = { full: false, count: false };

  it('满了 > 个数到上限 > 快满了 > 防丢', () => {
    expect(pickBar({ full: { unsaved: 2 }, atCount: true, near, lose, off })).toEqual({ kind: 'full', unsaved: 2 });
    expect(pickBar({ full: null, atCount: true, near, lose, off })).toEqual({ kind: 'count' });
    expect(pickBar({ full: null, atCount: false, near, lose, off })).toEqual(near);
    expect(pickBar({ full: null, atCount: false, near: null, lose, off })).toEqual(lose);
    expect(pickBar({ full: null, atCount: false, near: null, lose: null, off })).toBe(null);
  });

  it('满了关掉:这次打开什么都不说,不接着催', () => {
    expect(pickBar({ full: { unsaved: 2 }, atCount: true, near, lose, off: { full: true, count: false } })).toBe(null);
  });

  it('到上限关掉:别的照说', () => {
    expect(pickBar({ full: null, atCount: true, near: null, lose, off: { full: false, count: true } })).toEqual(lose);
  });
});

describe('那一条的字', () => {
  const MAX = 60;
  const words = (b: Parameters<typeof barWords>[0]) => barWords(b, MAX);

  it('满了', () => {
    expect(words({ kind: 'full', unsaved: 2 })).toMatchObject({ warn: true, title: '浏览器存储已满，2 个世界没存上', body: '它们现在还能看。全部存成文件就不会丢，或者删掉几个世界', saveAll: true, look: true });
    expect(words({ kind: 'full', unsaved: 1 }).body).toBe('它现在还能看。全部存成文件就不会丢，或者删掉几个世界');
    expect(words({ kind: 'full', unsaved: 0 })).toMatchObject({ title: '浏览器存储已满', body: '存好的世界不受影响，新的改动存不进去。存成文件就不会丢，或者删掉几个世界', saveAll: true, look: true });
  });

  it('到上限', () => {
    expect(words({ kind: 'count' })).toMatchObject({ warn: true, title: '「我的世界」最多存 60 个，已经存满了', body: '新的世界存不进来，现在的不受影响。存成文件再删掉几个，就能接着存', saveAll: true, look: false });
  });

  it('快满了', () => {
    expect(words({ kind: 'near', left: 160e6 })).toMatchObject({ warn: true, title: '快放不下了，最多还能存约 160 MB', body: '一个世界约 10 MB。不常看的世界存成文件再删掉，就能腾出地方', saveAll: false, look: true });
  });

  it('防丢:iPhone、iPad、Safari 各写各的', () => {
    expect(words({ kind: 'lose-never', n: 6, all: true, device: 'iphone' })).toMatchObject({ warn: false, title: '这 6 个世界还没存成文件', body: '在 iPhone 上，连续 7 天没打开这个网站，世界可能会被清掉。存成文件放进手机，就不会丢。', saveAll: true });
    expect(words({ kind: 'lose-never', n: 6, all: true, device: 'ipad' }).body).toBe('在 iPad 上，连续 7 天没打开这个网站，世界可能会被清掉。存成文件放进 iPad，就不会丢。');
    expect(words({ kind: 'lose-never', n: 6, all: true, device: 'safari' }).body).toBe('用 Safari 时，连续 7 天没打开这个网站，世界可能会被清掉。存成文件放在电脑里，就不会丢。');
    expect(words({ kind: 'lose-never', n: 1, all: true, device: 'iphone' }).title).toBe('这个世界还没存成文件');
    expect(words({ kind: 'lose-never', n: 2, all: false, device: 'iphone' }).title).toBe('有 2 个世界还没存成文件');
  });

  it('防丢:存过又改过', () => {
    expect(words({ kind: 'lose-changed', n: 2, days: 18, device: 'iphone' })).toMatchObject({ title: '有 2 个世界上次存文件以后又改过', body: '上次存文件是 18 天前。在 iPhone 上，连续 7 天没打开这个网站，世界可能会被清掉。再存一次就不会丢。', saveAll: true });
  });

  it('小窗口:没有按钮', () => {
    expect(words({ kind: 'lose-small' })).toMatchObject({ title: '这个小窗口里的世界可能留不久', body: '到手机浏览器里打开这个网站，新建的世界才留得住。', saveAll: false, look: false });
  });
});

describe('窗口的字', () => {
  const base: WindowFacts = { used: 54.7e6, room: { usage: 54.7e6, quota: 10.75e9 }, full: null, near: false, unsaved: 0, device: null, firefoxNo: false, loggedIn: false, persisted: false, allSaved: false, bigger: true, gone: false };

  it('第一句', () => {
    expect(sumLine(base)).toBe('这个浏览器里占了 55 MB，最多还能存约 11 GB。');
    expect(sumLine({ ...base, used: 840e6, room: { usage: 840e6, quota: 1e9 }, near: true })).toBe('这个浏览器里占了 840 MB，最多还能存约 160 MB。');
    expect(sumLine({ ...base, used: 1e9, room: { usage: 1e9, quota: 1e9 }, full: 'vault' })).toBe('这个浏览器里占了 1 GB，已经放不下了。');
    // 问不到、苹果设备上:只写占了多少
    expect(sumLine({ ...base, room: null })).toBe('这个浏览器里占了 55 MB。');
    expect(sumLine({ ...base, room: null, device: 'iphone', full: 'vault' })).toBe('这个浏览器里占了 55 MB，已经放不下了。');
    expect(sumLine({ ...base, used: null, room: null })).toBe('');
    expect(sumLine({ ...base, used: null, room: null, full: 'vault' })).toBe('这个浏览器已经放不下了。');
  });

  it('放名字的地方满了:第一句照常', () => {
    expect(sumLine({ ...base, full: 'cabinet' })).toBe('这个浏览器里占了 55 MB，最多还能存约 11 GB。');
    expect(windowNotes({ ...base, full: 'cabinet' })).toEqual([CABINET_NOTE]);
  });

  it('进度条:快满了、满了才有;苹果设备上不画', () => {
    expect(meterOf(base)).toBe(null);
    expect(meterOf({ ...base, room: { usage: 840e6, quota: 1e9 }, near: true })).toBe(84);
    expect(meterOf({ ...base, room: { usage: 1e9, quota: 1e9 }, full: 'vault' })).toBe(100);
    expect(meterOf({ ...base, full: 'cabinet' })).toBe(null);
    expect(meterOf({ ...base, room: null, full: 'vault', device: 'iphone' })).toBe(null);
  });

  it('小字:平常', () => {
    expect(windowNotes(base)).toEqual([SIZE_NOTE, CHROME_NOTE]);
    expect(windowNotes({ ...base, bigger: false })).toEqual([CHROME_NOTE]);
    expect(windowNotes({ ...base, gone: true })).toEqual([SIZE_NOTE]);
    expect(windowNotes({ ...base, persisted: true })).toEqual([SIZE_NOTE, KEPT_NOTE]);
    expect(windowNotes({ ...base, loggedIn: true })).toEqual([SIZE_NOTE]);
  });

  it('小字:苹果设备、Firefox', () => {
    expect(windowNotes({ ...base, device: 'iphone', room: null })).toEqual(['在 iPhone 上，连续 7 天没打开这个网站，世界可能会被清掉。存成文件放进手机，就不会丢。', SIZE_NOTE]);
    expect(windowNotes({ ...base, device: 'iphone', room: null, allSaved: true })).toEqual(['在 iPhone 上，连续 7 天没打开这个网站，世界可能会被清掉。你已经存过文件，清掉了也能放回来。', SIZE_NOTE]);
    expect(windowNotes({ ...base, firefoxNo: true })).toEqual([FIREFOX_NOTE, SIZE_NOTE]);
    // 登录了的人不说防丢
    expect(windowNotes({ ...base, device: 'iphone', loggedIn: true })).toEqual([SIZE_NOTE]);
  });

  it('小字:快满了、满了', () => {
    expect(windowNotes({ ...base, near: true })).toEqual([NEAR_NOTE]);
    expect(windowNotes({ ...base, full: 'vault', unsaved: 2 })).toEqual([FULL_NOTE]);
    expect(windowNotes({ ...base, full: 'vault', unsaved: 0 })).toEqual([FULL_NONE_NOTE]);
  });

  it('全部存成文件要不要蓝', () => {
    expect(saveAllBlue(base, false)).toBe(false);
    expect(saveAllBlue({ ...base, near: true }, false)).toBe(true);
    expect(saveAllBlue({ ...base, full: 'cabinet' }, false)).toBe(true);
    expect(saveAllBlue({ ...base, device: 'iphone' }, true)).toBe(true);
    expect(saveAllBlue({ ...base, device: 'iphone', allSaved: true }, true)).toBe(false);
    expect(saveAllBlue({ ...base, device: 'iphone', loggedIn: true }, true)).toBe(false);
  });

  it('每个世界名字下面那行', () => {
    const now = new Date(2026, 10, 5, 12).getTime();
    expect(fileLine({ kind: 'never' }, now)).toBe('还没存过文件');
    expect(fileLine({ kind: 'same', at: new Date(2026, 10, 1, 8).getTime() }, now)).toBe('11 月 1 日存过文件');
    expect(fileLine({ kind: 'same', at: new Date(2026, 10, 5, 1).getTime() }, now)).toBe('今天存过文件');
    expect(fileLine({ kind: 'changed', at: new Date(2026, 10, 1, 8).getTime() }, now)).toBe('11 月 1 日存过，之后改过');
    expect(dayWords(new Date(2025, 11, 31, 8).getTime(), now)).toBe('2025 年 12 月 31 日');
  });

  it('删掉的世界那一行', () => {
    const now = new Date(2026, 10, 5, 12).getTime();
    const by = new Date(2026, 11, 4, 12).getTime();
    expect(trashLine(3, by, false, 0, now)).toBe('3 个，12 月 4 日前自己清掉');
    expect(trashLine(3, by, true, 0, now)).toBe('3 个，还能在「最近删除」里找回，12 月 4 日前自己清掉');
    expect(trashLine(3, by, false, 1, now)).toContain('有 1 个现在还不能清');
  });
});

describe('只在这个浏览器里的记录', () => {
  let store: FakeStorage;
  beforeEach(() => {
    store = new FakeStorage();
    vi.stubGlobal('localStorage', store);
  });
  afterEach(() => {
    nearOver();
    store.full = false;
    vi.unstubAllGlobals();
  });

  it('存过文件:记时间和内容记号;改过名字、修改算改过,投影、存档时间不算', () => {
    const s = { params: { seed: 7 }, title: '塞雷尼亚', edits: { names: {} }, savedAt: 'a', view: { x: 1 } };
    const mark = saveMark(s);
    noteFileSaved([{ id: 'w1', mark }], () => true, NOW);
    expect(fileRecords()).toEqual({ w1: { at: NOW, mark } });
    expect(fileStatus(fileRecords().w1, saveMark({ ...s, savedAt: 'b', view: { x: 2 } } as typeof s))).toEqual({ kind: 'same', at: NOW });
    expect(fileStatus(fileRecords().w1, saveMark({ ...s, title: '别的' }))).toEqual({ kind: 'changed', at: NOW });
    expect(fileStatus(fileRecords().w1, saveMark({ ...s, edits: { names: { a: 1 } } }))).toEqual({ kind: 'changed', at: NOW });
    expect(fileStatus(undefined, mark)).toEqual({ kind: 'never' });
  });

  it('不认得的世界顺手去掉,再存一次留最新的', () => {
    noteFileSaved([{ id: 'a', mark: '1' }, { id: 'b', mark: '2' }], () => true, 1);
    noteFileSaved([{ id: 'b', mark: '3' }], (id) => id !== 'a', 2);
    expect(fileRecords()).toEqual({ b: { at: 2, mark: '3' } });
  });

  it('记录坏了:当没存过,不报错', () => {
    store.map.set('civ-atlas:file-saved', '{坏了');
    expect(fileRecords()).toEqual({});
  });

  it('放名字的地方满了:这次打开还算数', () => {
    store.full = true;
    noteFileSaved([{ id: 'a', mark: '1' }], () => true, 1);
    expect(fileRecords()).toEqual({ a: { at: 1, mark: '1' } });
    closeLose(5);
    expect(loseOffAt()).toBe(5);
    store.full = false;
    noteFileSaved([{ id: 'b', mark: '2' }], () => true, 2);
    expect(JSON.parse(store.map.get('civ-atlas:file-saved')!)).toEqual({ a: { at: 1, mark: '1' }, b: { at: 2, mark: '2' } });
  });

  it('关掉提示:记下来,说过的只说一次;都会通知', () => {
    const seen = vi.fn();
    const off = onSpaceChange(seen);
    closeNear(160e6);
    expect(nearOffAt()).toBe(160e6);
    nearOver();
    expect(nearOffAt()).toBe(null);
    closeLose(NOW);
    noteFileSaved([], () => true);
    off();
    expect(seen).toHaveBeenCalledTimes(3);
    expect(firstHintSaid()).toBe(false);
    noteFirstHint();
    expect(firstHintSaid()).toBe(true);
  });
});

describe('大小的写法', () => {
  it('存好了的大小', () => {
    expect(sizeText(4.9e6)).toBe('4.9 MB');
    expect(sizeText(54.7e6)).toBe('55 MB');
    expect(sizeText(999.9e6)).toBe('1 GB');
    expect(sizeText(1e9)).toBe('1 GB');
    expect(sizeText(2.34e9)).toBe('2.3 GB');
    expect(sizeText(10.7e9)).toBe('11 GB');
    expect(sizeText(500)).toBe('1 KB');
  });

  it('大概的大小', () => {
    expect(aboutSize(4.9e6)).toBe('约 5 MB');
    expect(aboutSize(164e6)).toBe('约 160 MB');
    expect(aboutSize(10.7e9)).toBe('约 11 GB');
    expect(aboutSize(1.2e9)).toBe('约 1.2 GB');
    expect(aboutSize(998e6)).toBe('约 1 GB');
    expect(aboutSize(5e5)).toBe('不到 1 MB');
  });
});
