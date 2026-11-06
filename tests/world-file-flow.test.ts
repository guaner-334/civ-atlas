/**
 * 存成文件、打开文件的界面这一层(src/ui/worldFileFlow.ts):什么情况说什么、文件交不交到手上、取消了有没有文件。
 * 真的存、开见 tests/world-files.test.ts;真点按钮、真出事见 scripts/world-file-ui-check.ts。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSave } from '../src/gen/savefile';
import { DEFAULT_PARAMS } from '../src/gen/world';
import { setOpenWorldHandler } from '../src/ui/newCivAction';
import { takeFileTrouble, takeOpenNote } from '../src/ui/openNote';
import { answerSameWorld, sameWorldAsk } from '../src/ui/sameWorldAsk';
import { changedAt, sideLines, type WorldSide } from '../src/ui/SameWorldDialog';
import * as saveStore from '../src/ui/saveStore';
import { fileRecords, saveMark } from '../src/ui/spaceFacts';
import { setStage } from '../src/ui/stageStore';
import { _resetToasts, getToast, peekToast } from '../src/ui/toastStore';

const wf = vi.hoisted(() => ({
  saveWorldFile: vi.fn(),
  saveAllWorldFiles: vi.fn(),
  lookWorldFile: vi.fn(),
  lookWorldFiles: vi.fn(),
  placeWorldFile: vi.fn(),
  sidesOf: vi.fn(),
  openWorldFiles: vi.fn(),
  worldFileBytes: vi.fn(),
  knownWorldFileBytes: vi.fn((): number | null => null),
  checkTimeout: vi.fn((bytes: number) => 20_000 + Math.ceil((bytes / 1e6) * 400)),
}));
vi.mock('../src/ui/worldFiles', () => wf);

const again = vi.fn<(id: string) => Promise<boolean>>();
vi.mock('../src/ui/worldStore', () => ({ saveContentAgain: again }));

const { aboutSize, fileSizeNote, openPickedFiles, saveAgain, saveAllToFile, saveCurrentToFile, saveForOldSite, saveRecipeFile, saveWorldRecipe, saveWorldToFile, sizeText } = await import('../src/ui/worldFileFlow');

class FakeStorage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const TOAST = 'world-file';
const MB = 1e6;
const blob = (bytes: number) => new Blob([new Uint8Array(bytes)]);
const toast = () => peekToast(TOAST);
const flush = () => new Promise<void>((r) => setImmediate(r));

/** 下载了哪几个文件 */
let downloads: string[] = [];
let narrow = false;

beforeEach(() => {
  downloads = [];
  narrow = false;
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = {
    ...((g.window as object) ?? {}),
    matchMedia: (q: string) => ({ matches: narrow && q.includes('max-width'), addEventListener() {}, removeEventListener() {} }),
  };
  g.localStorage = new FakeStorage();
  g.sessionStorage = new FakeStorage();
  g.document = {
    body: { appendChild() {} },
    createElement: () => ({
      click(this: { download: string }) {
        downloads.push(this.download);
      },
      remove() {},
    }),
  };
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('navigator', { userAgent: 'test' });
  saveStore._resetForTest();
  _resetToasts();
  for (const f of Object.values(wf)) f.mockReset();
  wf.knownWorldFileBytes.mockReturnValue(null);
  wf.checkTimeout.mockImplementation((bytes: number) => 20_000 + Math.ceil((bytes / 1e6) * 400));
  setOpenWorldHandler(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const stored = (title = '塞雷尼亚') => saveStore.importSave(makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { names: {}, interventions: [], terrain: [] }, '', title))!;

describe('大小的写法', () => {
  it('存好了写准数,还没存写大概', () => {
    expect(sizeText(4.9 * MB)).toBe('4.9 MB');
    expect(sizeText(139.6 * MB)).toBe('140 MB');
    expect(sizeText(2.3e9)).toBe('2.3 GB');
    expect(sizeText(3200)).toBe('3 KB');
    expect(aboutSize(4.9 * MB)).toBe('约 5 MB');
    expect(aboutSize(139 * MB)).toBe('约 140 MB');
    expect(aboutSize(0.4 * MB)).toBe('不到 1 MB');
  });

  it('还没有内容的世界菜单上不写大小', async () => {
    wf.worldFileBytes.mockResolvedValue(null);
    expect(await fileSizeNote('w1')).toBe(null);
    wf.worldFileBytes.mockResolvedValue(5 * MB);
    expect(await fileSizeNote('w1')).toBe('约 5 MB');
  });
});

describe('一个世界存成文件', () => {
  it('电脑:下载,说多大、别人怎么打开', async () => {
    wf.saveWorldFile.mockResolvedValue({ ok: true, file: blob(4900), name: '文明与地图-塞雷尼亚.civworld', stale: false });
    await saveWorldToFile('w1');
    expect(downloads).toEqual(['文明与地图-塞雷尼亚.civworld']);
    expect(toast()).toMatchObject({ kind: 'ok', text: '已存成文件', more: ['文明与地图-塞雷尼亚.civworld，5 KB。发给别人时，让对方到这个网站点「打开存档文件」选它'] });
  });

  it('手机:打包完不自动下载,点「存到手机」才下载', async () => {
    narrow = true;
    wf.saveWorldFile.mockResolvedValue({ ok: true, file: blob(1000), name: 'a.civworld', stale: false });
    await saveWorldToFile('w1');
    expect(downloads).toEqual([]);
    expect(toast()).toMatchObject({ text: '文件准备好了，1 KB', more: ['a.civworld'], ttl: 0 });
    toast()!.action!.onClick();
    await flush();
    expect(downloads).toEqual(['a.civworld']);
    expect(toast()!.text).toBe('已存成文件');
    expect(toast()!.more![0]).toContain('在手机的「下载」里，1 KB');
  });

  it('手机:能分享文件的走分享菜单;点了取消提示条留着', async () => {
    narrow = true;
    const share = vi.fn().mockRejectedValueOnce(new DOMException('no', 'AbortError')).mockResolvedValueOnce(undefined);
    vi.stubGlobal('navigator', { userAgent: 'test', canShare: () => true, share });
    wf.saveWorldFile.mockResolvedValue({ ok: true, file: blob(1000), name: 'a.civworld', stale: false });
    await saveWorldToFile('w1');
    toast()!.action!.onClick();
    await flush();
    expect(share).toHaveBeenCalledTimes(1);
    expect(toast()!.text).toBe('文件准备好了，1 KB');
    toast()!.action!.onClick();
    await flush();
    expect((share.mock.calls[1][0] as { files: File[] }).files[0].name).toBe('a.civworld');
    expect(toast()).toBe(null);
    expect(downloads).toEqual([]);
  });

  it('手机:超过 50 MB 多说一句不花流量', async () => {
    narrow = true;
    const file = { size: 140 * MB, type: '' } as Blob;
    wf.saveWorldFile.mockResolvedValue({ ok: true, file, name: 'a.civworld', stale: false });
    await saveWorldToFile('w1');
    expect(toast()).toMatchObject({ text: '文件准备好了，140 MB', more: ['存到手机不花流量，发给别人才花'] });
  });

  it('快的不出进度;过 1 秒出进度,取消了没有文件', async () => {
    vi.useFakeTimers();
    let finish!: (v: unknown) => void;
    wf.saveWorldFile.mockReturnValue(new Promise((r) => (finish = r)));
    wf.knownWorldFileBytes.mockReturnValue(140 * MB);
    const id = stored();
    const run = saveWorldToFile(id);
    await vi.advanceTimersByTimeAsync(900);
    expect(toast()).toBe(null);
    await vi.advanceTimersByTimeAsync(200);
    expect(toast()).toMatchObject({ kind: 'progress', text: '正在存成文件', more: ['「塞雷尼亚」有 140 MB，别关页面'] });
    wf.saveWorldFile.mock.calls[0][1].onProgress(0.45);
    expect(toast()!.progress).toBe(0.45);
    toast()!.action!.onClick();
    expect(toast()!.text).toBe('已取消，没有存下文件');
    finish({ ok: true, file: blob(10), name: 'a.civworld', stale: false });
    await run;
    expect(downloads).toEqual([]);
    expect(toast()!.text).toBe('已取消，没有存下文件');
  });

  it('没有内容可存:存 .json,明说只是配方;没建完的照旧说只带上了配方', async () => {
    const id = stored();
    for (const kind of ['old', 'missing', 'full', 'unavailable', 'corrupt', 'failed']) {
      downloads = [];
      wf.saveWorldFile.mockResolvedValue({ ok: false, kind, message: 'x' });
      await saveWorldToFile(id);
      expect(downloads).toEqual(['文明与地图-塞雷尼亚.json']);
      expect(toast()).toMatchObject({ kind: 'ok', text: '已存成配方文件', more: ['只有几 KB。对方打开时重新长一遍，可能和你看到的不一样'] });
    }
    downloads = [];
    wf.saveWorldFile.mockResolvedValue({ ok: false, kind: 'draft', message: 'x' });
    await saveWorldToFile(id);
    expect(toast()!.more![0]).toContain('只带上了配方，打开时要重新算');
    downloads = [];
    saveRecipeFile(saveStore.loadWorld(id)!.save, '到最新版打开');
    expect(downloads).toEqual(['文明与地图-塞雷尼亚.json']);
    expect(toast()!.more![0]).toContain('到最新版打开');
  });

  it('存配方文件:不等转存,直接存;别的页面删了说一声', () => {
    const id = stored();
    downloads = [];
    wf.saveWorldFile.mockClear();
    saveWorldRecipe(id);
    expect(wf.saveWorldFile).not.toHaveBeenCalled();
    expect(downloads).toEqual(['文明与地图-塞雷尼亚.json']);
    expect(toast()).toMatchObject({ kind: 'ok', text: '已存成配方文件' });
    saveWorldRecipe('没有这个');
    expect(peekToast('save')).toMatchObject({ kind: 'error', text: '打不开这个存档' });
  });

  it('看原样打不开:存的是给的那份原文,存好了说怎么打开,给「去旧版网站」', () => {
    const id = stored();
    const open = vi.fn();
    (globalThis as unknown as { window: { open: unknown } }).window.open = open;
    const save = saveStore.loadWorld(id)!.save;
    downloads = [];
    saveForOldSite(save, 'https://atlas.gerdor.top/v22/');
    expect(downloads).toEqual(['文明与地图-塞雷尼亚.json']);
    const t = toast()!;
    expect(t).toMatchObject({ kind: 'ok', ttl: 0, text: '已存成配方文件', more: ['文明与地图-塞雷尼亚.json。到旧版网站点「打开存档文件」选它'] });
    expect(t.action?.label).toBe('去旧版网站');
    t.action!.onClick();
    expect(open).toHaveBeenCalledWith('https://atlas.gerdor.top/v22/', '_blank', 'noopener');
  });

  it('再存一次:等的时候转圈;成了、还是不行说的不一样', async () => {
    const id = stored();
    again.mockResolvedValueOnce(true);
    const run = saveAgain(id);
    expect(toast()).toMatchObject({ kind: 'progress', text: '正在存「塞雷尼亚」' });
    await run;
    expect(toast()).toMatchObject({ kind: 'ok', text: '「塞雷尼亚」存好了', more: ['以后网站更新也不会变'] });
    again.mockResolvedValueOnce(false);
    await saveAgain(id);
    expect(toast()).toMatchObject({ kind: 'warn', text: '还是没能存下来', more: ['世界本身没事，现在还能打开。网站下次更新时会再试'] });
  });

  it('内存不够、线程崩了:世界都还在,再试一次', async () => {
    wf.saveWorldFile.mockResolvedValueOnce({ ok: false, kind: 'memory', message: 'x' });
    await saveWorldToFile('w1');
    expect(toast()).toMatchObject({ kind: 'error', text: '没能存成文件', more: ['内存不够，世界都还在。关掉别的页面再试'] });
    expect(downloads).toEqual([]);
    wf.saveWorldFile.mockResolvedValueOnce({ ok: true, file: blob(10), name: 'a.civworld', stale: false });
    toast()!.action!.onClick();
    await flush();
    expect(downloads).toEqual(['a.civworld']);
    wf.saveWorldFile.mockResolvedValueOnce({ ok: false, kind: 'crash', message: 'x' });
    await saveWorldToFile('w1');
    expect(toast()!.more).toEqual(['存的时候出错了，世界都还在，再试一次']);
  });

  it('文件比世界落后:说刚才的改动没带上', async () => {
    wf.saveWorldFile.mockResolvedValue({ ok: true, file: blob(1000), name: 'a.civworld', stale: true });
    await saveWorldToFile('w1');
    expect(toast()).toMatchObject({ kind: 'warn', more: ['a.civworld，1 KB。刚才的改动还没算完，没带上'] });
  });

  it('存过文件的记录:交到手上才记;文件比世界落后的不算', async () => {
    const id = saveStore.importSave(makeSave({ ...DEFAULT_PARAMS, seed: 5 }, { names: {}, interventions: [], terrain: [] }, '', '甲'))!;
    wf.saveWorldFile.mockResolvedValueOnce({ ok: true, file: blob(10), name: 'a.civworld', stale: true, behind: 'memory' });
    await saveWorldToFile(id);
    expect(fileRecords()[id]).toBeUndefined();
    wf.saveWorldFile.mockResolvedValueOnce({ ok: true, file: blob(10), name: 'a.civworld', stale: false });
    await saveWorldToFile(id);
    expect(fileRecords()[id]).toMatchObject({ mark: saveMark(saveStore.loadWorld(id)!.save) });
  });

  it('文件比世界落后:内存不够、写不下分开说', async () => {
    wf.saveWorldFile.mockResolvedValueOnce({ ok: true, file: blob(1000), name: 'a.civworld', stale: true, behind: 'memory' });
    await saveWorldToFile('w1');
    expect(toast()).toMatchObject({ kind: 'warn', more: ['a.civworld，1 KB。内存不够，刚才的改动没带上。关掉别的页面再存一次'] });
    wf.saveWorldFile.mockResolvedValueOnce({ ok: true, file: blob(1000), name: 'a.civworld', stale: true, behind: 'full' });
    await saveWorldToFile('w1');
    expect(toast()).toMatchObject({ kind: 'warn', more: ['a.civworld，1 KB。里面是上次存下的样子，刚才的改动没带上'] });
    wf.saveWorldFile.mockResolvedValueOnce({ ok: true, file: blob(1000), name: 'a.civworld', stale: true, behind: 'timeout' });
    await saveWorldToFile('w1');
    expect(toast()).toMatchObject({ kind: 'warn', more: ['a.civworld，1 KB。刚才的改动还没算完，没带上'] });
  });

  it('一次只做一件:正在存时再点不开第二件', async () => {
    let finish!: (v: unknown) => void;
    wf.saveWorldFile.mockReturnValue(new Promise((r) => (finish = r)));
    const run = saveWorldToFile('w1');
    await saveWorldToFile('w2');
    expect(wf.saveWorldFile).toHaveBeenCalledTimes(1);
    finish({ ok: true, file: blob(10), name: 'a.civworld', stale: false });
    await run;
  });

  it('没有正开着的世界:什么也不做', async () => {
    await saveCurrentToFile();
    expect(wf.saveWorldFile).not.toHaveBeenCalled();
  });

  it('微信、QQ 的小窗口:说存不了,不打包', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 MicroMessenger/8.0' });
    await saveWorldToFile('w1');
    expect(toast()).toMatchObject({ kind: 'warn', text: '这里存不了文件', more: ['微信、QQ 里的小窗口不让存'] });
    await saveAllToFile();
    expect(wf.saveWorldFile).not.toHaveBeenCalled();
    expect(wf.saveAllWorldFiles).not.toHaveBeenCalled();
  });
});

describe('全部世界存成文件', () => {
  const one = (o: Record<string, unknown> = {}) => ({ ok: true, files: [{ file: blob(10), name: '文明与地图-全部世界-2026-11-04.civworld', part: 1, parts: 1, worlds: 48 }], count: 48, whole: 48, recipeOnly: [], olderLeft: [], bytes: 312 * MB, ...o });

  it('电脑:下载,说有几个世界', async () => {
    wf.saveAllWorldFiles.mockResolvedValue(one());
    await saveAllToFile();
    expect(downloads).toEqual(['文明与地图-全部世界-2026-11-04.civworld']);
    expect(toast()).toMatchObject({ kind: 'ok', dot: true, text: '48 个世界已存成一个文件', more: ['文明与地图-全部世界-2026-11-04.civworld，312 MB。以后点「打开存档文件」选它，这些世界都会回来'] });
  });

  it('手机:点「存到手机」才下载', async () => {
    narrow = true;
    wf.saveAllWorldFiles.mockResolvedValue(one());
    await saveAllToFile();
    expect(downloads).toEqual([]);
    expect(toast()).toMatchObject({ text: '文件准备好了，312 MB', more: ['48 个世界。以后点「打开存档文件」选它，都会回来'] });
    toast()!.action!.onClick();
    await flush();
    expect(downloads).toHaveLength(1);
    expect(toast()!.more![0]).toBe('在手机的「下载」里，312 MB。以后点「打开存档文件」选它，这些世界都会回来');
  });

  it('刚才的改动打开时要重新算的也说', async () => {
    wf.saveAllWorldFiles.mockResolvedValue(one({ behind: [{ id: 'a', kind: 'memory' }] }));
    await saveAllToFile();
    expect(toast()).toMatchObject({ kind: 'warn' });
    expect(toast()!.more).toEqual([expect.stringContaining('312 MB'), '其中 1 个里面是上次存下的样子，刚才的改动打开时要重新算']);
  });

  it('只带上配方的、AI 写的东西没读出来的都说', async () => {
    wf.saveAllWorldFiles.mockResolvedValue(one({ recipeOnly: ['a', 'b'], notesUnread: ['a'] }));
    await saveAllToFile();
    expect(toast()).toMatchObject({ kind: 'warn' });
    expect(toast()!.more).toEqual([expect.stringContaining('312 MB'), '其中 2 个只带上了配方，打开时要重新算', '其中 1 个世界的 AI 写的东西这次没读出来，文件里可能不全。刷新页面再存一次']);
  });

  it('留着的旧版本太大、没带上的也说', async () => {
    wf.saveAllWorldFiles.mockResolvedValue(one({ olderLeft: ['a'] }));
    await saveAllToFile();
    expect(toast()!.kind).toBe('warn');
    expect(toast()!.more).toContain('其中 1 个留着的旧版本太大，没带上，世界本身带上了');
  });

  it('进度:第几个、一共约多大;取消了没有文件', async () => {
    vi.useFakeTimers();
    let finish!: (v: unknown) => void;
    wf.saveAllWorldFiles.mockReturnValue(new Promise((r) => (finish = r)));
    const run = saveAllToFile();
    await vi.advanceTimersByTimeAsync(1100);
    const { onProgress, signal } = wf.saveAllWorldFiles.mock.calls[0][0];
    onProgress({ done: 6, total: 48, bytes: 39 * MB, totalBytes: null });
    expect(toast()).toMatchObject({ kind: 'progress', text: '正在存成文件：第 7 / 48 个', more: ['一共约 310 MB，别关页面'], progress: 6 / 48 });
    toast()!.action!.onClick();
    expect(signal.aborted).toBe(true);
    expect(toast()!.text).toBe('已取消，没有存下文件');
    finish(one());
    await run;
    expect(downloads).toEqual([]);
  });

  it('空间不够:说存到第几个,世界都还在,再试一次', async () => {
    wf.saveAllWorldFiles.mockImplementationOnce(async (o: { onProgress: (p: unknown) => void }) => {
      o.onProgress({ done: 30, total: 48, bytes: 1, totalBytes: null });
      return { ok: false, kind: 'full', message: 'x' };
    });
    await saveAllToFile();
    expect(toast()).toMatchObject({ kind: 'error', text: '没能存成文件', more: ['存到第 31 个时空间不够了。世界都还在，腾出地方再试'] });
    wf.saveAllWorldFiles.mockResolvedValueOnce(one());
    toast()!.action!.onClick();
    await flush();
    expect(downloads).toHaveLength(1);
  });

  it('一个文件放不下:分几个,下一个点一下才存', async () => {
    const files = [1, 2, 3].map((part) => ({ file: blob(10), name: `f-${part}of3.civworld`, part, parts: 3, worlds: 16 }));
    wf.saveAllWorldFiles.mockResolvedValue(one({ files, bytes: 2.3e9 }));
    await saveAllToFile();
    expect(downloads).toEqual(['f-1of3.civworld']);
    expect(toast()).toMatchObject({ text: '第 1 个文件存好了，还有 2 个', more: ['一共 2.3 GB，一个文件放不下，分成 3 个。打开时都选上'] });
    toast()!.action!.onClick();
    expect(downloads).toEqual(['f-1of3.civworld', 'f-2of3.civworld']);
    expect(toast()!.text).toBe('第 2 个文件存好了，还有 1 个');
    toast()!.action!.onClick();
    expect(downloads).toHaveLength(3);
    expect(toast()).toMatchObject({ text: '48 个世界已存成 3 个文件' });
  });
});

describe('打开文件', () => {
  const named = (name: string, bytes = 10) => new File([new Uint8Array(bytes)], name);
  const pick = (f: File, kind: string) => wf.lookWorldFiles.mockResolvedValue({ files: [{ file: f, name: f.name, kind, packed: [], recipes: null }], sets: [] });
  const looked = (o: Record<string, unknown> = {}) => ({ ok: true, match: { kind: 'new' }, title: '塞雷尼亚', seed: 7, warnings: [], file: new Blob(), facts: { save: { title: '塞雷尼亚' } }, ...o });
  const kept = (o: Record<string, unknown> = {}) => ({ ok: true, id: 'x', notesLost: false, memOnly: false, olderLost: 0, ...o });
  const FILE = '文明与地图-塞雷尼亚.civworld';

  it('旧文件:走原来那条路;叫 .civworld 却不是:说可能没存完整;太大的不读', async () => {
    const onText = vi.fn();
    const json = named('a.json');
    pick(json, 'other');
    await openPickedFiles([json], onText);
    expect(onText).toHaveBeenCalledWith(expect.any(String), 'a.json');
    onText.mockClear();
    const fake = named(FILE);
    pick(fake, 'other');
    await openPickedFiles([fake], onText);
    expect(onText).not.toHaveBeenCalled();
    expect(toast()).toMatchObject({ kind: 'error', text: `打不开 ${FILE}`, more: ['这个文件可能没存完整，或者被改过。网站没有动它，先别删'] });
    const big = { name: 'v.mp4', size: 3e9, text: vi.fn() } as unknown as File;
    pick(big, 'other');
    await openPickedFiles([big], onText);
    expect(big.text).not.toHaveBeenCalled();
    expect(peekToast('save')).toMatchObject({ kind: 'error', more: ['不是「文明与地图」的存档'] });
  });

  it('本机没有:存进去,世界打开时说已存进「我的世界」,记下来自文件', async () => {
    const id = stored();
    const open = vi.fn();
    setOpenWorldHandler(open);
    const f = named(FILE);
    pick(f, 'world');
    wf.lookWorldFile.mockResolvedValue(looked());
    wf.placeWorldFile.mockResolvedValue({ ok: true, status: 'added', id, title: '塞雷尼亚', kept: kept() });
    await openPickedFiles([f], vi.fn());
    expect(open).toHaveBeenCalledWith(id);
    expect(takeOpenNote(id)).toEqual({ kind: 'ok', text: '已打开存档「塞雷尼亚」', more: ['已存进「我的世界」，下次不用再选文件'] });
    expect(saveStore.loadWorld(id)!.fromFile).toBeTruthy();
    expect(toast()).toBe(null);
  });

  it('内容一样:打开原来的,名字用本机的;不记来自文件', async () => {
    const id = stored('塞雷尼亚（二）');
    const open = vi.fn();
    setOpenWorldHandler(open);
    const f = named(FILE);
    pick(f, 'world');
    wf.lookWorldFile.mockResolvedValue(looked());
    wf.placeWorldFile.mockResolvedValue({ ok: true, status: 'same', id, title: '塞雷尼亚' });
    await openPickedFiles([f], vi.fn());
    expect(takeOpenNote(id)).toEqual({ kind: 'ok', text: '「塞雷尼亚（二）」已经在「我的世界」里了', more: ['和文件内容一样，打开的就是它'] });
    expect(saveStore.loadWorld(id)!.fromFile).toBeUndefined();
  });

  describe('内容不一样:先问', () => {
    const side = (title: string, o: Partial<WorldSide> = {}): WorldSide => ({ save: makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { names: {}, interventions: [], terrain: [] }, '', title, '2026-11-03T13:40:00.000Z'), thumb: null, alive: 11, notes: 0, ...o });
    /** 打开文件,停在问的窗口上 */
    async function asking(orig: string, o: { fileTitle?: string } = {}) {
      const open = vi.fn();
      setOpenWorldHandler(open);
      const f = named(FILE);
      pick(f, 'world');
      const fileTitle = o.fileTitle ?? '塞雷尼亚';
      wf.lookWorldFile.mockResolvedValue(looked({ match: { kind: 'different', id: orig }, title: fileTitle, facts: { save: { title: fileTitle } } }));
      wf.placeWorldFile.mockImplementation(async (l: { title: string }, opt: { different?: string }) =>
        opt.different === 'ask' ? { ok: true, status: 'different', id: orig, title: l.title, looked: l } : { ok: true, status: 'copied', id: 'wcopy', of: orig, title: '塞雷尼亚（二）', kept: kept() },
      );
      wf.sidesOf.mockResolvedValue({ mine: side('塞雷尼亚'), theirs: side(fileTitle, { alive: 14 }) });
      const run = openPickedFiles([f], vi.fn());
      for (let i = 0; i < 10 && !sameWorldAsk(); i++) await flush();
      return { open, run };
    }

    it('先不放,弹窗口:两份并排、另存的名字先写好', async () => {
      const orig = stored();
      const { open, run } = await asking(orig);
      expect(wf.placeWorldFile).toHaveBeenCalledTimes(1);
      expect(wf.placeWorldFile.mock.calls[0][1]).toEqual({ different: 'ask' });
      const a = sameWorldAsk()!;
      expect(a).toMatchObject({ title: '塞雷尼亚', copyTitle: '塞雷尼亚（二）', open: false, alike: false });
      expect(a.mine.lines.map((l) => l.text)).toContain('现存 11 国');
      expect(a.theirs.lines.find((l) => l.text === '现存 14 国')?.bold).toBe(true);
      expect(open).not.toHaveBeenCalled();
      expect(toast()).toBe(null);
      answerSameWorld('cancel');
      await run;
    });

    it('另存一份并打开:打开另存的,提示条没有按钮', async () => {
      const orig = stored();
      const { open, run } = await asking(orig);
      answerSameWorld('copy');
      await run;
      expect(wf.placeWorldFile.mock.calls[1][1]).toEqual({ different: 'copy' });
      expect(open).toHaveBeenCalledWith('wcopy');
      expect(takeOpenNote('wcopy')).toEqual({ kind: 'ok', text: '已打开「塞雷尼亚（二）」', more: ['另存了一份，原来的「塞雷尼亚」没动'] });
    });

    it('打开原来的:不存文件里的那份,说一句', async () => {
      const orig = stored();
      const { open, run } = await asking(orig);
      answerSameWorld('original');
      await run;
      expect(wf.placeWorldFile).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith(orig);
      expect(takeOpenNote(orig)).toEqual({ kind: 'ok', text: '已打开原来的「塞雷尼亚」', more: ['文件里的那份没存进「我的世界」'] });
      expect(fileRecords()[orig]).toBeUndefined();
    });

    it('取消:什么都不动,没有提示;之后照样能再打开', async () => {
      const orig = stored();
      const first = await asking(orig);
      answerSameWorld('cancel');
      await first.run;
      expect(wf.placeWorldFile).toHaveBeenCalledTimes(1);
      expect(first.open).not.toHaveBeenCalled();
      expect(takeOpenNote(orig)).toBe(null);
      expect(toast()).toBe(null);
      const second = await asking(orig);
      expect(sameWorldAsk()).not.toBe(null);
      answerSameWorld('cancel');
      await second.run;
    });

    it('拖到正开着的那个世界上:没有「打开原来的」', async () => {
      const orig = stored();
      const w = saveStore.loadWorld(orig)!;
      saveStore.attachWorld({ id: orig, params: w.save.params, check: '', kind: 'created', title: w.save.title, saved: w.save.edits });
      setStage('world');
      const { run } = await asking(orig);
      expect(sameWorldAsk()!.open).toBe(true);
      answerSameWorld('cancel');
      await run;
      setStage('home');
    });
  });

  it('文件里有读不进来的东西、AI 写的东西存不下、浏览器不让存:要紧的话放第二行', async () => {
    const id = stored();
    setOpenWorldHandler(vi.fn());
    const f = named(FILE);
    pick(f, 'world');
    wf.lookWorldFile.mockResolvedValue(looked());
    wf.placeWorldFile.mockResolvedValue({ ok: true, status: 'added', id, title: '塞雷尼亚', kept: kept({ memOnly: true }) });
    await openPickedFiles([f], vi.fn());
    expect(takeOpenNote(id)).toMatchObject({ kind: 'warn', more: ['浏览器不让网页存数据，世界只留在这个页面里，这个文件先别删'] });
    wf.placeWorldFile.mockResolvedValue({ ok: true, status: 'added', id, title: '塞雷尼亚', kept: kept({ notesLost: true }) });
    await openPickedFiles([f], vi.fn());
    expect(takeOpenNote(id)!.more[0]).toContain('有的 AI 写的东西没能放回来');
    wf.lookWorldFile.mockResolvedValue(looked({ warnings: ['读不进来'] }));
    wf.placeWorldFile.mockResolvedValue({ ok: true, status: 'added', id, title: '塞雷尼亚', kept: kept() });
    await openPickedFiles([f], vi.fn());
    expect(takeOpenNote(id)).toMatchObject({ kind: 'warn', more: ['读不进来'] });
  });

  it('浏览器存不下:世界照样打开(文字那条路)', async () => {
    const onText = vi.fn();
    const f = named(FILE);
    pick(f, 'world');
    wf.lookWorldFile.mockResolvedValue(looked());
    const lines: [string, string][] = [
      ['full', '浏览器存储已满，这个世界没存进去，这个文件先别删'],
      ['count', `「我的世界」最多存 ${saveStore.MAX_WORLDS} 个，这个世界没存进去，这个文件先别删`],
      ['unavailable', '浏览器不让网页存数据，这个世界没存进去，这个文件先别删'],
    ];
    for (const [kind, line] of lines) {
      onText.mockClear();
      wf.placeWorldFile.mockResolvedValue({ ok: false, kind, message: 'x' });
      await openPickedFiles([f], onText);
      expect(onText).toHaveBeenCalledWith(JSON.stringify({ title: '塞雷尼亚' }), FILE);
      expect(takeFileTrouble()).toBe(line);
    }
  });

  it('打不开:每种情况的话;好文件不说坏了', async () => {
    const f = named(FILE);
    pick(f, 'world');
    const cases: [string, string, boolean][] = [
      ['broken', '这个文件可能没存完整，或者被改过。网站没有动它，先别删', false],
      ['readonly', '文件是好的，只是这一版网站读不了它。网站没有动它，先别删', false],
      ['memory', '内存不够，读不下这个世界。文件没有坏，关掉别的页面再试', true],
      ['crash', '读的时候出错了。不一定是文件的问题，先别删', true],
    ];
    for (const [kind, line, retry] of cases) {
      wf.lookWorldFile.mockResolvedValue({ ok: false, kind, message: 'x' });
      await openPickedFiles([f], vi.fn());
      expect(toast()).toMatchObject({ kind: 'error', text: `打不开 ${FILE}`, more: [line] });
      expect(!!toast()!.action).toBe(retry);
    }
  });

  it('超时:写真的等了多久,再试一次时限放宽', async () => {
    const f = named(FILE, 1000);
    pick(f, 'world');
    wf.lookWorldFile.mockResolvedValue({ ok: false, kind: 'timeout', message: 'x' });
    await openPickedFiles([f], vi.fn());
    expect(wf.lookWorldFile.mock.calls[0][1]).toEqual({ timeoutMs: 20_001 });
    expect(toast()!.more).toEqual(['核对了 20 秒还没完，先停下了。不一定是文件的问题，先别删']);
    toast()!.action!.onClick();
    await flush();
    expect(wf.lookWorldFile.mock.calls[1][1]).toEqual({ timeoutMs: 40_002 });
    expect(toast()!.more).toEqual(['核对了 40 秒还没完，先停下了。不一定是文件的问题，先别删']);
  });

  it('比网站新:刷新一次;刷新以后还是,不再叫人刷新', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    const f = named(FILE);
    pick(f, 'world');
    wf.lookWorldFile.mockResolvedValue({ ok: false, kind: 'newer', message: 'x' });
    await openPickedFiles([f], vi.fn());
    expect(toast()).toMatchObject({ text: '打不开「塞雷尼亚」', more: ['它是新版存的，这个页面还是旧的。刷新后再打开一次这个文件，世界没有丢'] });
    toast()!.action!.onClick();
    expect(reload).toHaveBeenCalled();
    await openPickedFiles([f], vi.fn());
    expect(toast()).toMatchObject({ text: '打不开「塞雷尼亚」', more: ['它比这个网站的版本还新，网站更新后就能打开。世界没有丢'] });
    expect(toast()!.action).toBeUndefined();
  });

  it('核对要等:过 0.5 秒出提示,能取消;取消了不放进本机', async () => {
    vi.useFakeTimers();
    let finish!: (v: unknown) => void;
    wf.lookWorldFile.mockReturnValue(new Promise((r) => (finish = r)));
    const f = named(FILE, 1000);
    pick(f, 'world');
    const run = openPickedFiles([f], vi.fn());
    await vi.advanceTimersByTimeAsync(400);
    expect(toast()).toBe(null);
    await vi.advanceTimersByTimeAsync(200);
    expect(toast()).toMatchObject({ kind: 'progress', text: `正在打开 ${FILE}`, more: ['这个世界有 1 KB，要核对一会儿'] });
    expect(toast()!.progress).toBeUndefined();
    toast()!.action!.onClick();
    expect(toast()).toBe(null);
    finish(looked());
    await run;
    expect(wf.placeWorldFile).not.toHaveBeenCalled();
  });

  describe('放回全部世界', () => {
    const none = { added: [], copied: [], same: [], different: [], skipped: [], cut: false, cancelled: false, sets: [], recipes: null, notesLost: [], memOnly: false };
    const backup = (f: File) => wf.lookWorldFiles.mockResolvedValue({ files: [{ file: f, name: f.name, kind: 'backup', packed: [], recipes: null }], sets: [] });
    const w = (id: string) => ({ id, title: id });
    const FILE2 = '文明与地图-全部世界-2026-11-04.civworld';

    it('放好了:另存的、原来就有的、跳过的都说', async () => {
      const f = named(FILE2);
      backup(f);
      const skipped = [{ name: 'worlds/a', kind: 'broken', message: 'x' }, { name: 'worlds/b', kind: 'broken', message: '有 1 份旧修订读不了,没放回来' }];
      wf.openWorldFiles.mockResolvedValue({ ...none, added: Array.from({ length: 44 }, (_, i) => w(`a${i}`)), copied: [{ ...w('c'), of: 'd' }], same: [w('s1'), w('s2')], skipped });
      await openPickedFiles([f], vi.fn());
      expect(toast()).toMatchObject({ kind: 'warn', text: '已放回 45 个世界', more: ['其中 1 个和原来的内容不一样，另存成了新的', '2 个原来就有，没重复放', '1 个读不出来，跳过了', '1 个世界留着的旧版本没放回来，这个文件先别删'] });
    });

    it('本机已有的世界缺文件里带的旧版本:说文件先别删', async () => {
      const f = named(FILE2);
      backup(f);
      wf.openWorldFiles.mockResolvedValue({ ...none, same: [{ ...w('a'), olderMissing: 2 }] });
      await openPickedFiles([f], vi.fn());
      expect(toast()).toMatchObject({ kind: 'warn', text: '这些世界都已经在「我的世界」里了', more: ['1 个世界留着的旧版本没放回来，这个文件先别删'] });
    });

    it('取消:已放回的留着', async () => {
      const f = named(FILE2);
      backup(f);
      wf.openWorldFiles.mockResolvedValue({ ...none, added: [w('a'), w('b')], cancelled: true });
      await openPickedFiles([f], vi.fn());
      expect(toast()).toMatchObject({ kind: 'ok', text: '已放回 2 个世界', more: ['剩下的没有放'] });
    });

    it('都已经有了;分几个文件还差哪个;放不下说先删几个', async () => {
      const f = named(FILE2);
      backup(f);
      wf.openWorldFiles.mockResolvedValue({ ...none, same: [w('a')] });
      await openPickedFiles([f], vi.fn());
      expect(toast()).toMatchObject({ kind: 'ok', text: '这些世界都已经在「我的世界」里了', more: [] });
      wf.openWorldFiles.mockResolvedValue({ ...none, added: [w('a')], sets: [{ batch: 'x', parts: 3, have: [1], missing: [2, 3] }] });
      await openPickedFiles([f], vi.fn());
      expect(toast()!.more).toEqual(['分成 3 个文件的还差第 2、3 个，一起选上再打开一次']);
      wf.openWorldFiles.mockResolvedValue({ ...none, skipped: [{ name: 'worlds/a', kind: 'full', message: 'x' }] });
      await openPickedFiles([f], vi.fn());
      expect(toast()).toMatchObject({ kind: 'error', text: '没能放回来', more: ['还有 1 个没放进去：浏览器存储已满，先删掉几个世界再打开一次'] });
    });

    it('一个世界都读不出来:照那个文件的情况说', async () => {
      const f = named(FILE2);
      backup(f);
      wf.openWorldFiles.mockResolvedValue({ ...none, skipped: [{ name: FILE2, kind: 'newer', message: 'x' }] });
      await openPickedFiles([f], vi.fn());
      expect(toast()!.more![0]).toContain('它是新版存的');
    });

    it('放回来的记下来自文件', async () => {
      const id = stored();
      const f = named(FILE2);
      backup(f);
      wf.openWorldFiles.mockResolvedValue({ ...none, added: [w(id)] });
      await openPickedFiles([f], vi.fn());
      expect(saveStore.loadWorld(id)!.fromFile).toBeTruthy();
    });

    it('世界文件和旧文件一起选:取消了旧文件也不放', async () => {
      vi.useFakeTimers();
      const world = named(FILE2);
      const old = new File([JSON.stringify(makeSave({ ...DEFAULT_PARAMS, seed: 1 }, { names: {}, interventions: [], terrain: [] }, '', '甲'))], 'a.json');
      wf.lookWorldFiles.mockResolvedValue({
        files: [
          { file: world, name: world.name, kind: 'backup', packed: [], recipes: null },
          { file: old, name: old.name, kind: 'other', packed: [], recipes: null },
        ],
        sets: [],
      });
      let finish!: (v: unknown) => void;
      wf.openWorldFiles.mockReturnValue(new Promise((r) => (finish = r)));
      const run = openPickedFiles([world, old], vi.fn());
      await vi.advanceTimersByTimeAsync(1100);
      toast()!.action!.onClick();
      finish({ ...none, cancelled: true });
      vi.useRealTimers();
      await run;
      expect(saveStore.listWorlds()).toHaveLength(0);
      expect(toast()).toMatchObject({ text: '已放回 0 个世界', more: ['剩下的没有放'] });
    });

    it('旧文件放回来 AI 写的东西存不下、浏览器不让存:照样说', async () => {
      const bundle = new File(['{}'], 'all.json');
      const save = makeSave({ ...DEFAULT_PARAMS, seed: 3 }, { names: {}, interventions: [], terrain: [] }, '', '丙');
      const text = JSON.stringify({ app: '文明与地图', bundle: 1, savedAt: new Date().toISOString(), worlds: [{ id: 'wold000', save, meta: {}, notes: [{ key: 'a', kind: '史书', title: 't', text: 'x', createdAt: new Date().toISOString(), provider: '', model: '' }] }] });
      const file = new File([text], bundle.name);
      wf.lookWorldFiles.mockResolvedValue({ files: [{ file, name: file.name, kind: 'other', packed: [], recipes: null }, { file, name: file.name, kind: 'other', packed: [], recipes: null }], sets: [] });
      wf.openWorldFiles.mockResolvedValue(none);
      vi.spyOn(saveStore, 'persistent').mockReturnValue(false);
      await openPickedFiles([file, file], vi.fn());
      expect(toast()!.kind).toBe('warn');
      expect(toast()!.more![0]).toContain('只留在这个页面里');
    });

    it('放回来了,文件里 AI 写的东西读不进来:也说一句,文件先别删', async () => {
      const f = named(FILE2);
      backup(f);
      wf.openWorldFiles.mockResolvedValue({ ...none, added: [w('a'), w('b')], notesUnread: ['a'] });
      await openPickedFiles([f], vi.fn());
      expect(toast()).toMatchObject({ kind: 'warn', text: '已放回 2 个世界', more: ['1 个世界的 AI 写的东西这次没读进来。世界不受影响，文件先别删'] });
    });

    it('几个旧文件一起选:都放进「我的世界」', async () => {
      const a = new File([JSON.stringify(makeSave({ ...DEFAULT_PARAMS, seed: 1 }, { names: {}, interventions: [], terrain: [] }, '', '甲'))], 'a.json');
      const b = new File([JSON.stringify(makeSave({ ...DEFAULT_PARAMS, seed: 2 }, { names: {}, interventions: [], terrain: [] }, '', '乙'))], 'b.json');
      const c = new File(['不是存档'], 'c.json');
      wf.lookWorldFiles.mockResolvedValue({ files: [a, b, c].map((file) => ({ file, name: file.name, kind: 'other', packed: [], recipes: null })), sets: [] });
      wf.openWorldFiles.mockResolvedValue(none);
      await openPickedFiles([a, b, c], vi.fn());
      expect(saveStore.listWorlds().map((x) => x.save.title).sort()).toEqual(['乙', '甲']);
      expect(toast()).toMatchObject({ kind: 'warn', text: '已放回 2 个世界', more: ['1 个读不出来，跳过了'] });
    });
  });

  it('出了没想到的事:说一声,以后还能点', async () => {
    const f = named(FILE);
    wf.lookWorldFiles.mockRejectedValueOnce(new Error('x'));
    await openPickedFiles([f], vi.fn());
    expect(toast()).toMatchObject({ kind: 'error', text: `打不开 ${FILE}` });
    expect(getToast()).not.toBe(null);
    wf.saveWorldFile.mockResolvedValue({ ok: true, file: blob(10), name: 'a.civworld', stale: false });
    await saveWorldToFile('w1');
    expect(downloads).toEqual(['a.civworld']);
  });
});

describe('内容不一样时并排的几行', () => {
  const NOW = new Date(2026, 10, 6, 15, 0).getTime();
  const at = (y: number, m: number, d: number, h = 21, min = 40) => new Date(y, m - 1, d, h, min).toISOString();
  const save = (o: { savedAt?: string; edits?: number } = {}) => {
    const s = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { names: {}, interventions: [], terrain: [] }, '', '塞雷尼亚', o.savedAt ?? at(2026, 11, 3));
    for (let i = 0; i < (o.edits ?? 0); i++) s.edits.names[`p:${i}`] = `名${i}`;
    return s;
  };
  const side = (o: Partial<WorldSide> & { savedAt?: string; edits?: number } = {}): WorldSide => ({ thumb: null, alive: 11, notes: 0, ...o, save: save(o) });
  const texts = (ls: { text: string; bold: boolean }[]) => ls.map((l) => (l.bold ? `*${l.text}*` : l.text));

  it('改的时间:今天、昨天写几点;今年的写月日几点;往年的只写到日', () => {
    expect(changedAt(at(2026, 11, 6, 9, 5), NOW)).toBe('今天 9:05 改过');
    expect(changedAt(at(2026, 11, 5), NOW)).toBe('昨天 21:40 改过');
    expect(changedAt(at(2026, 11, 3), NOW)).toBe('11 月 3 日 21:40 改过');
    expect(changedAt(at(2025, 11, 3), NOW)).toBe('2025 年 11 月 3 日改过');
    expect(changedAt('', NOW)).toBe('');
  });

  it('同一分钟改的:写出来一样,时间都不加粗', () => {
    const r = sideLines(side({ savedAt: at(2026, 11, 3, 21, 40) }), side({ savedAt: new Date(new Date(2026, 10, 3, 21, 40).getTime() + 30_000).toISOString() }), NOW);
    expect(r.left[0]).toEqual({ text: '11 月 3 日 21:40 改过', bold: false });
    expect(r.right[0]).toEqual({ text: '11 月 3 日 21:40 改过', bold: false });
  });

  it('不一样的几行两边都加粗,时间只加粗新的那边', () => {
    const r = sideLines(side({ edits: 23 }), side({ savedAt: at(2026, 10, 30, 15, 12), alive: 14, edits: 17 }), NOW);
    expect(texts(r.left)).toEqual(['*11 月 3 日 21:40 改过*', '推到第 3000 年', '*现存 11 国*', '*23 处改动*']);
    expect(texts(r.right)).toEqual(['10 月 30 日 15:12 改过', '推到第 3000 年', '*现存 14 国*', '*17 处改动*']);
    expect(r.alike).toBe(false);
  });

  it('AI 写的段数不一样才多一行;看得到的都一样时说差在细节', () => {
    const ai = sideLines(side({ notes: 5 }), side({ savedAt: at(2026, 11, 3, 20, 5), notes: 0 }), NOW);
    expect(texts(ai.left).at(-1)).toBe('*AI 写了 5 段*');
    expect(texts(ai.right).at(-1)).toBe('*AI 没写过*');
    expect(ai.alike).toBe(false);
    const same = sideLines(side({ notes: 2 }), side({ notes: 2 }), NOW);
    expect(same.left).toHaveLength(4);
    expect([...same.left, ...same.right].some((l) => l.bold)).toBe(false);
    expect(same.alike).toBe(true);
    const renamed = side({ notes: 2 });
    renamed.save.title = '塞雷尼亚甲';
    expect(sideLines(renamed, side({ notes: 2 }), NOW).alike).toBe(false);
  });

  it('不知道现存几国、AI 写的读不出来:那一行不写;没有文明照卡片写', () => {
    const r = sideLines(side({ alive: undefined, notes: 3 }), side({ notes: undefined }), NOW);
    expect(r.left.map((l) => l.text)).toEqual(['11 月 3 日 21:40 改过', '推到第 3000 年', '0 处改动']);
    expect(texts(sideLines(side({ alive: 0 }), side(), NOW).left)[2]).toBe('*没有文明*');
  });

  it('逐年推演的世界照卡片的写法', () => {
    const s = save();
    s.edits.play = { year: 1549, commands: [] };
    const r = sideLines({ save: s, thumb: null }, side(), NOW);
    expect(r.left[1]).toEqual({ text: '演绎到第 1549 年', bold: true });
  });
});
