/**
 * 工具插件存文件、选文件:扩展名、文件名、大小的检查;网站这边回调用(只留最新的一份、取消、插件停了);
 * 插件卡上那一块的状态和字(没点「保存」不下载)。沙箱换成假的。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_EDITS } from '../src/gen/edits';
import { PluginApiError } from '../src/plugin/check';
import { PERMISSIONS, PLUGIN_CAPS, permissionLines, type PermissionKey } from '../src/plugin/pluginCaps';
import type { PluginManifest } from '../src/plugin/pluginFile';
import type { PluginResponse } from '../src/plugin/protocol';
import type { SandboxOptions } from '../src/plugin/sandbox';
import { checkOpenFile, checkSaveFile, cleanFileName, openRefusal, OPEN_MAX, SAVE_EXTS, SAVE_MAX, type PickedFile } from '../src/plugin/userFile';
import { isTool } from '../src/ui/plugins/pluginText';
import { CAP_LABEL } from '../src/ui/plugins/pluginWords';
import { askOpen, askSave, clearFiles, DONE_MS, fileChosen, fileStrip, openText, saveNow, saveText, skipOpen, skipSave } from '../src/ui/plugins/tools/toolFiles';

function codeOf(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof PluginApiError) return e.code;
    throw e;
  }
  return 'no error';
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe('存文件:扩展名只收白名单', () => {
  it('表格、文字、数据、图片能存;种类由扩展名定', () => {
    expect(SAVE_EXTS).toEqual(['csv', 'tsv', 'txt', 'json', 'geojson', 'png', 'jpg', 'jpeg', 'webp']);
    expect(checkSaveFile({ name: '国力排行-第3000年.csv', content: 'a,b\n1,2' })).toMatchObject({ name: '国力排行-第3000年.csv', mime: 'text/csv', kind: '表格' });
    expect(checkSaveFile({ name: 'x.json', content: '{}' })).toMatchObject({ mime: 'application/json', kind: '数据' });
    expect(checkSaveFile({ name: 'x.geojson', content: '{}' })).toMatchObject({ mime: 'application/geo+json', kind: '地图数据' });
    expect(checkSaveFile({ name: 'x.txt', content: '' })).toMatchObject({ kind: '文字' });
    expect(checkSaveFile({ name: '地图.PNG', content: PNG })).toMatchObject({ name: '地图.png', mime: 'image/png', kind: '图片' });
  });

  it('网页、svg、脚本这类能带脚本的,和没有扩展名的,一律 bad-args', () => {
    for (const name of ['a.html', 'a.htm', 'a.xhtml', 'a.svg', 'a.js', 'a.mjs', 'a.exe', 'a.bat', 'a.xml', 'a.pdf', 'a.csv.html', 'readme', 'a.'])
      expect(codeOf(() => checkSaveFile({ name, content: 'x' })), name).toBe('bad-args');
    // 改书写方向的字藏起真扩展名:去掉以后照真扩展名查
    expect(codeOf(() => checkSaveFile({ name: 'photo\u202egnp.js', content: 'x' }))).toBe('bad-args');
  });

  it('图片要交字节、要对得上文件头;字只给文字类', () => {
    expect(codeOf(() => checkSaveFile({ name: 'a.png', content: 'iVBOR' }))).toBe('bad-args');
    expect(codeOf(() => checkSaveFile({ name: 'a.png', content: new TextEncoder().encode('<html><script>') }))).toBe('bad-args');
    expect(codeOf(() => checkSaveFile({ name: 'a.jpg', content: PNG }))).toBe('bad-args');
    expect(checkSaveFile({ name: 'a.jpg', content: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) }).mime).toBe('image/jpeg');
    expect(checkSaveFile({ name: 'a.webp', content: new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ') }).mime).toBe('image/webp');
    expect(checkSaveFile({ name: 'a.png', content: PNG.buffer }).bytes).toEqual(PNG);
    for (const content of [1, null, undefined, {}, [1, 2], new Int32Array(2)]) expect(codeOf(() => checkSaveFile({ name: 'a.csv', content })), String(content)).toBe('bad-args');
    expect(codeOf(() => checkSaveFile({ name: 1, content: 'x' }))).toBe('bad-args');
    expect(codeOf(() => checkSaveFile('a.csv'))).toBe('bad-args');
  });

  it('字存成 UTF-8;表格前面带 BOM(表格软件认得中文),别的不带', () => {
    const csv = checkSaveFile({ name: 'a.csv', content: '国,州\n甲,3' }).bytes;
    expect([...csv.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(decode(csv.slice(3))).toBe('国,州\n甲,3');
    expect(decode(checkSaveFile({ name: 'a.json', content: '{"国":1}' }).bytes)).toBe('{"国":1}');
    const raw = new Uint8Array([0x61, 0x2c, 0x62]);
    expect(checkSaveFile({ name: 'a.csv', content: raw }).bytes).toEqual(raw);
  });

  it('大小上限:2 MB 以内能存,超了 limit(字按存出来的字节算)', () => {
    expect(checkSaveFile({ name: 'a.txt', content: 'x'.repeat(SAVE_MAX) }).bytes.length).toBe(SAVE_MAX);
    expect(codeOf(() => checkSaveFile({ name: 'a.txt', content: 'x'.repeat(SAVE_MAX + 1) }))).toBe('limit');
    expect(codeOf(() => checkSaveFile({ name: 'a.txt', content: '国'.repeat(SAVE_MAX / 3 + 1) }))).toBe('limit');
    expect(codeOf(() => checkSaveFile({ name: 'a.csv', content: 'x'.repeat(SAVE_MAX - 2) }))).toBe('limit');
    expect(codeOf(() => checkSaveFile({ name: 'a.json', content: new Uint8Array(SAVE_MAX + 1) }))).toBe('limit');
    expect(checkSaveFile({ name: 'a.json', content: new Uint8Array(SAVE_MAX) }).bytes.length).toBe(SAVE_MAX);
  });
});

describe('存文件:文件名过一遍', () => {
  it('去掉路径,只留最后一段', () => {
    expect(cleanFileName('../../etc/passwd.txt')).toBe('passwd.txt');
    expect(cleanFileName('C:\\Users\\x\\桌面\\a.csv')).toBe('a.csv');
    expect(checkSaveFile({ name: '../../../a.csv', content: '' }).name).toBe('a.csv');
    expect(checkSaveFile({ name: '/abs/b.json', content: '' }).name).toBe('b.json');
  });

  it('去掉控制字符、改书写方向和看不见的字、系统不许有的字', () => {
    expect(cleanFileName('a\u0000b\u0007c\n\r\t.csv')).toBe('abc.csv');
    expect(cleanFileName('报告\u202ecsv.txt')).toBe('报告csv.txt');
    expect(cleanFileName('a\u200b\u2066b\ufeff.csv')).toBe('ab.csv');
    expect(cleanFileName('a<b>c:d"e|f?g*.csv')).toBe('abcdefg.csv');
    expect(cleanFileName('\ud800a.csv')).toBe('a.csv');
    expect(cleanFileName('😀.csv')).toBe('😀.csv');
  });

  it('头尾的点和空白去掉;系统保留的名字前面加 _;只剩扩展名的不收', () => {
    expect(cleanFileName('  .hidden.csv ')).toBe('hidden.csv');
    expect(cleanFileName('a.csv...  ')).toBe('a.csv');
    expect(cleanFileName('CON.csv')).toBe('_CON.csv');
    expect(cleanFileName('lpt1.txt')).toBe('_lpt1.txt');
    expect(cleanFileName('console.txt')).toBe('console.txt');
    expect(codeOf(() => checkSaveFile({ name: '.csv', content: '' }))).toBe('bad-args');
    expect(codeOf(() => checkSaveFile({ name: '\u202e.csv', content: '' }))).toBe('bad-args');
  });

  it('文件名最多 80 个字', () => {
    expect(checkSaveFile({ name: `${'国'.repeat(76)}.csv`, content: '' }).name).toHaveLength(80);
    expect(codeOf(() => checkSaveFile({ name: `${'国'.repeat(77)}.csv`, content: '' }))).toBe('limit');
  });
});

describe('选文件:参数', () => {
  it('accept 写扩展名(带不带点都行,换成小写);max 不给 = 16 MB', () => {
    expect(checkOpenFile(undefined)).toEqual({ accept: [], max: OPEN_MAX });
    expect(checkOpenFile({ accept: ['.CSV', 'json', 'csv'], max: 5 * 1024 * 1024 })).toEqual({ accept: ['csv', 'json'], max: 5 * 1024 * 1024 });
    for (const accept of ['csv', [1], ['*.csv'], ['text/csv'], ['c s v'], ['']]) expect(codeOf(() => checkOpenFile({ accept })), JSON.stringify(accept)).toBe('bad-args');
    expect(codeOf(() => checkOpenFile({ accept: Array.from({ length: 17 }, (_, i) => `e${i}`) }))).toBe('limit');
    for (const max of [0, -1, 1.5, '5', Infinity]) expect(codeOf(() => checkOpenFile({ max })), String(max)).toBe('bad-args');
    expect(codeOf(() => checkOpenFile({ max: OPEN_MAX + 1 }))).toBe('limit');
  });

  it('选来的文件种类不对、太大就不收', () => {
    const req = checkOpenFile({ accept: ['csv', 'json'], max: 100 });
    expect(openRefusal(req, '排行.CSV', 100)).toBeNull();
    expect(openRefusal(req, '排行.xlsx', 10)).toBe('type');
    expect(openRefusal(req, '排行', 10)).toBe('type');
    expect(openRefusal(req, '排行.csv', 101)).toBe('big');
    expect(openRefusal(checkOpenFile({}), 'any.bin', OPEN_MAX)).toBeNull();
  });
});

describe('权限框、作品墙卡片、算不算工具', () => {
  it('两样新能力各一行,排在加图层后面,不标黄;选文件那行网站写一句小字', () => {
    expect(PLUGIN_CAPS.get('file.save@1')).toBe('fileSave');
    expect(PLUGIN_CAPS.get('file.open@1')).toBe('fileOpen');
    const lines = permissionLines({ requires: ['history.read@1', 'view.read@1', 'layer.marks@1', 'file.save@1', 'file.open@1', 'ui.panel@1'], why: { 'file.save@1': '存成表格' } });
    expect(lines.map((l) => l.key)).toEqual(['history', 'view', 'layer', 'fileSave', 'fileOpen']);
    expect(lines.slice(3).map((l) => [l.text, l.loud, l.note ?? null, l.why])).toEqual([
      ['会给你文件存（你点「保存」才存）', false, null, ['存成表格']],
      ['会请你选一个文件给它', false, '它只拿得到你选的那一个文件', []],
    ]);
    for (const k of Object.keys(PERMISSIONS) as PermissionKey[]) expect(CAP_LABEL[k], k).toBeTruthy();
  });

  it('要了存文件或选文件的在「工具」里', () => {
    const m = (requires: string[]) => ({ requires }) as unknown as PluginManifest;
    expect(isTool(m(['file.save@1']))).toBe(true);
    expect(isTool(m(['history.read@1', 'file.open@1']))).toBe(true);
    expect(isTool(m(['layer.cells@1']))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 网站这边回调用(沙箱换成假的)

interface FakeSandbox {
  opts: SandboxOptions;
  sent: { id: number; res: PluginResponse; transfer?: Transferable[] }[];
  stopped: string | null;
}
const fakes: FakeSandbox[] = [];
vi.mock('../src/plugin/sandbox', () => ({
  startPluginSandbox: async (_code: string, opts: SandboxOptions) => {
    const f: FakeSandbox = { opts, sent: [], stopped: null };
    fakes.push(f);
    return {
      get stopped() {
        return f.stopped;
      },
      send() {},
      call: async () => undefined,
      ping: async () => {},
      respond(id: number, res: PluginResponse, transfer?: Transferable[]) {
        if (!f.stopped) f.sent.push({ id, res, transfer });
      },
      emit() {},
      stop() {
        if (f.stopped) return;
        f.stopped = 'stopped';
        opts.onStop?.('stopped', '');
      },
    };
  },
}));

const { startPluginHost } = await import('../src/plugin/host');
type Source = Parameters<typeof startPluginHost>[0]['source'];

async function open(requires: string[], more: Partial<Source> = {}) {
  const host = await startPluginHost({ plugin: { id: 'test', requires }, code: '', source: { world: () => null, civ: () => null, edits: () => EMPTY_EDITS, ...more } });
  const f = fakes.at(-1)!;
  let seq = 0;
  const flush = () => new Promise((r) => setTimeout(r, 0));
  /** 发一次调用,返回拿回话的函数(还没回 = undefined) */
  const send = (name: string, args?: unknown) => {
    const id = ++seq;
    f.opts.onRequest!(id, name, args);
    return () => f.sent.find((s) => s.id === id);
  };
  const call = async (name: string, args?: unknown) => {
    const got = send(name, args);
    for (let i = 0; i < 20 && !got(); i++) await flush();
    return got()?.res;
  };
  return { host, f, send, call, flush };
}

describe('网站回 file.save', () => {
  it('没要能力 = no-permission;网站这边没有插件卡 = unavailable', async () => {
    expect(await (await open(['ui.panel@1'])).call('file.save', { name: 'a.csv', content: '' })).toMatchObject({ ok: false, error: { code: 'no-permission' } });
    expect(await (await open(['file.save@1'])).call('file.save', { name: 'a.csv', content: '' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });

  it('白名单外、太大的当场回 bad-args / limit,不问用的人', async () => {
    const saveFile = vi.fn(() => new Promise<boolean>(() => {}));
    const { call } = await open(['file.save@1'], { saveFile });
    expect(await call('file.save', { name: 'x.html', content: '<script>' })).toMatchObject({ ok: false, error: { code: 'bad-args' } });
    expect(await call('file.save', { name: 'x.svg', content: '<svg/>' })).toMatchObject({ ok: false, error: { code: 'bad-args' } });
    expect(await call('file.save', { name: 'x.json', content: new Uint8Array(SAVE_MAX + 1) })).toMatchObject({ ok: false, error: { code: 'limit' } });
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('用的人点了「保存」才回;点「不要」回 cancelled', async () => {
    let answer: (v: boolean) => void = () => {};
    const saveFile = vi.fn((_f: unknown, _s: AbortSignal) => new Promise<boolean>((r) => (answer = r)));
    const { send, flush } = await open(['file.save@1'], { saveFile });
    const got = send('file.save', { name: '../排行.csv', content: 'a' });
    await flush();
    expect(saveFile.mock.calls[0][0]).toMatchObject({ name: '排行.csv', kind: '表格', replaced: false });
    for (let i = 0; i < 5; i++) await flush();
    expect(got()).toBeUndefined();
    answer(true);
    await flush();
    await flush();
    expect(got()?.res).toEqual({ ok: true, data: { name: '排行.csv' } });
    const no = send('file.save', { name: 'b.csv', content: 'b' });
    await flush();
    answer(false);
    await flush();
    await flush();
    expect(no()?.res).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  });

  it('连着交好几份只留最新的:上一份回 cancelled,新的一份带 replaced', async () => {
    const asks: { file: { name: string; replaced: boolean }; signal: AbortSignal; answer: (v: boolean) => void }[] = [];
    const saveFile = vi.fn((file: { name: string; replaced: boolean }, signal: AbortSignal) => new Promise<boolean>((answer) => asks.push({ file, signal, answer })));
    const { send, flush } = await open(['file.save@1'], { saveFile });
    const first = send('file.save', { name: '第3000年.csv', content: 'a' });
    await flush();
    const second = send('file.save', { name: '第2990年.csv', content: 'b' });
    await flush();
    await flush();
    expect(asks.map((a) => [a.file.name, a.file.replaced, a.signal.aborted])).toEqual([
      ['第3000年.csv', false, true],
      ['第2990年.csv', true, false],
    ]);
    expect(first()?.res).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(second()).toBeUndefined();
    asks[1].answer(true);
    await flush();
    await flush();
    expect(second()?.res).toEqual({ ok: true, data: { name: '第2990年.csv' } });
    // 存好了以后再交来的不算换掉
    send('file.save', { name: 'c.csv', content: 'c' });
    await flush();
    expect(asks[2].file.replaced).toBe(false);
  });

  it('插件停了:还在问的收起', async () => {
    let signal: AbortSignal | null = null;
    const { host, send, flush } = await open(['file.save@1'], { saveFile: (_f, s) => ((signal = s), new Promise<boolean>(() => {})) });
    send('file.save', { name: 'a.csv', content: '' });
    await flush();
    host.stop();
    expect(signal!.aborted).toBe(true);
  });
});

describe('网站回 file.open', () => {
  it('一次一个;不给 = cancelled;选好的字节转交给插件', async () => {
    let answer: (v: PickedFile | null) => void = () => {};
    let req: unknown = null;
    const { call, send, flush, f } = await open(['file.open@1'], { openFile: (r) => ((req = r), new Promise((res) => (answer = res))) });
    const first = send('file.open', { accept: ['csv'], max: 1000 });
    await flush();
    expect(req).toEqual({ accept: ['csv'], max: 1000 });
    expect(await call('file.open', {})).toMatchObject({ ok: false, error: { code: 'busy' } });
    const bytes = new TextEncoder().encode('国,州');
    answer({ name: '排行.csv', bytes });
    await flush();
    await flush();
    expect(first()?.res).toEqual({ ok: true, data: { name: '排行.csv', size: bytes.length, bytes } });
    expect(f.sent.find((s) => s.res === first()?.res)?.transfer).toEqual([bytes.buffer]);
    const no = send('file.open', {});
    await flush();
    answer(null);
    await flush();
    await flush();
    expect(no()?.res).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  });

  it('参数不对 bad-args / limit;界面那边漏过来不合要求的,网站不交给插件', async () => {
    let answer: (v: PickedFile | null) => void = () => {};
    const { call, send, flush } = await open(['file.open@1'], { openFile: () => new Promise((res) => (answer = res)) });
    expect(await call('file.open', { accept: ['*.csv'] })).toMatchObject({ ok: false, error: { code: 'bad-args' } });
    expect(await call('file.open', { max: OPEN_MAX + 1 })).toMatchObject({ ok: false, error: { code: 'limit' } });
    const got = send('file.open', { accept: ['csv'], max: 4 });
    await flush();
    answer({ name: 'a.csv', bytes: new Uint8Array(5) });
    await flush();
    await flush();
    expect(got()?.res).toMatchObject({ ok: false, error: { code: 'failed' } });
  });

  it('插件停了:还在问的收起', async () => {
    let signal: AbortSignal | null = null;
    const { host, send, flush } = await open(['file.open@1'], { openFile: (_r, s) => ((signal = s), new Promise(() => {})) });
    send('file.open', {});
    await flush();
    host.stop();
    expect(signal!.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 插件卡上那一块

const offer = (name: string, replaced = false) => ({ ...checkSaveFile({ name, content: 'x'.repeat(12 * 1024) }), replaced });

describe('插件卡上的「保存」', () => {
  afterEach(() => {
    clearFiles();
    vi.useRealTimers();
  });

  it('交来了只出「保存」,不下载;点了「保存」才下载一次', async () => {
    vi.useFakeTimers();
    const download = vi.fn();
    const ctl = new AbortController();
    const saved = askSave(offer('国力排行-第3000年.csv'), ctl.signal);
    const s = fileStrip.get().save!;
    expect(saveText(s)).toEqual({ tone: 'ask', icon: 'download', title: '它准备好了一个文件', small: '国力排行-第3000年.csv，表格，12 KB。点「保存」才会存到你的电脑上。', acts: ['不要', '保存'] });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(download).not.toHaveBeenCalled();
    saveNow(download);
    expect(download).toHaveBeenCalledTimes(1);
    const [blob, name] = download.mock.calls[0] as [Blob, string];
    expect(name).toBe('国力排行-第3000年.csv');
    expect(blob.type).toBe('text/csv');
    expect(blob.size).toBe(12 * 1024 + 3);
    expect(await saved).toBe(true);
    expect(saveText(fileStrip.get().save!)).toEqual({ tone: 'done', icon: 'check', title: '存好了', small: '国力排行-第3000年.csv，在浏览器的「下载」里。' });
    saveNow(download);
    expect(download).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DONE_MS);
    expect(fileStrip.get().save).toBeNull();
  });

  it('点「不要」:不下载,回 false;换成新的一份:写明上一份没存', async () => {
    const download = vi.fn();
    const no = askSave(offer('a.csv'), new AbortController().signal);
    skipSave();
    expect(await no).toBe(false);
    expect(fileStrip.get().save).toBeNull();
    const old = new AbortController();
    const first = askSave(offer('国力排行-第3000年.csv'), old.signal);
    old.abort();
    expect(await first).toBe(false);
    askSave(offer('国力排行-第2990年.csv', true), new AbortController().signal);
    expect(saveText(fileStrip.get().save!).small).toBe('国力排行-第2990年.csv，表格，12 KB。上一份没存，换成这一份了。');
    expect(saveText(fileStrip.get().save!).title).toBe('它换了一份新的');
    clearFiles();
    expect(download).not.toHaveBeenCalled();
  });
});

describe('插件卡上的「选文件…」', () => {
  afterEach(() => clearFiles());

  const file = (name: string, size: number) => ({ name, size, arrayBuffer: async () => new Uint8Array(size).buffer });

  it('不收、太大的不交给插件,说清楚让人重选;选对了交过去', async () => {
    const got = askOpen(checkOpenFile({ accept: ['csv', 'json'], max: 5 * 1024 * 1024 }), new AbortController().signal);
    expect(openText(fileStrip.get().open!)).toEqual({ tone: 'ask', icon: 'file', title: '它请你选一个文件', small: '只收 .csv、.json，最大 5 MB。它只拿得到你选的这一个。', acts: ['不给', '选文件…'] });
    await fileChosen(file('国力排行.xlsx', 100));
    expect(openText(fileStrip.get().open!)).toEqual({ tone: 'bad', icon: 'warn', title: '「国力排行.xlsx」它不收', small: '只收 .csv、.json。可以在表格软件里另存成 .csv 再选。', acts: ['不给', '重新选…'] });
    await fileChosen(file('全部年份.csv', 23 * 1024 * 1024));
    expect(openText(fileStrip.get().open!)).toEqual({ tone: 'bad', icon: 'warn', title: '「全部年份.csv」太大了', small: '它最多收 5 MB，这个有 23 MB。', acts: ['不给', '重新选…'] });
    await fileChosen(file('国力排行-第2000年.csv', 9 * 1024));
    const f = await got;
    expect(f?.name).toBe('国力排行-第2000年.csv');
    expect(f?.bytes.length).toBe(9 * 1024);
    expect(openText(fileStrip.get().open!)).toEqual({ tone: 'done', icon: 'check', title: '交给它了', small: '国力排行-第2000年.csv，9 KB。' });
  });

  it('「不给」、取消、插件停了:回 null,收起', async () => {
    const a = askOpen(checkOpenFile({}), new AbortController().signal);
    expect(openText(fileStrip.get().open!).small).toBe('最大 16 MB。它只拿得到你选的这一个。');
    skipOpen();
    expect(await a).toBeNull();
    expect(fileStrip.get().open).toBeNull();
    const ctl = new AbortController();
    const b = askOpen(checkOpenFile({}), ctl.signal);
    ctl.abort();
    expect(await b).toBeNull();
    expect(fileStrip.get().open).toBeNull();
    await fileChosen(file('a.csv', 1));
    expect(fileStrip.get().open).toBeNull();
  });
});
