/**
 * 传到账号:切块和指纹、传块的重试和取消、给人看的字。
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { replaceNotes } from '../src/ai/library';
import { ServerError } from '../src/account/server';
import { _setFullNet, sendBlocks, type BlockPlan } from '../src/account/fullWorlds';
import { Sha256, blockRanges, hashBlocks } from '../src/ui/fullBlocks';
import { fullMark, fullStatusOf, markRecipe, pairText, refusalOf, type FullLimits, type FullOverview } from '../src/ui/fullWorldView';
import { saveMark } from '../src/ui/spaceFacts';
import { errorNote, menuItem, refusalNote, removeWords, shareItem, textNote, usedLine, type MenuFacts, type NoteActs } from '../src/ui/fullWorldWords';
import { homeAccountLine } from '../src/ui/syncWords';

const hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** 一个不压缩的 ZIP:几个条目 + 末尾一段目录 */
function zipOf(entries: { name: string; size: number }[], tail = 40): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const e of entries) {
    const name = new TextEncoder().encode(e.name);
    const head = new Uint8Array(30 + name.length + e.size);
    const dv = new DataView(head.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint32(18, e.size, true);
    dv.setUint32(22, e.size, true);
    dv.setUint16(26, name.length, true);
    head.set(name, 30);
    head.fill(e.size & 0xff, 30 + name.length);
    parts.push(head);
  }
  parts.push(new Uint8Array(tail).fill(7));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('切块和指纹', () => {
  it('SHA-256 一边读一边算,和标准的一样,怎么分段都一样', () => {
    const data = new Uint8Array(200_003).map((_, i) => (i * 31) & 0xff);
    for (const len of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 200_003]) {
      const piece = data.subarray(0, len);
      const whole = new Sha256();
      whole.update(piece);
      expect(whole.hex()).toBe(hex(piece));
      const split = new Sha256();
      for (let at = 0; at < len; at += 37) split.update(piece.subarray(at, at + 37));
      expect(split.hex()).toBe(hex(piece));
    }
  });

  it('在条目边界上切:头到内容结束算一段,末尾的目录单独一段', async () => {
    const zip = zipOf([
      { name: 'a', size: 100 },
      { name: 'bb', size: 50 },
    ]);
    const r = await blockRanges(new Blob([zip as BlobPart]), 1000, 512);
    expect(r).toEqual([
      { start: 0, bytes: 131 },
      { start: 131, bytes: 82 },
      { start: 213, bytes: 40 },
    ]);
  });

  it('一个条目太长再按上限切', async () => {
    const zip = zipOf([{ name: 'a', size: 250 }]);
    const r = await blockRanges(new Blob([zip as BlobPart]), 100, 512);
    expect(r.map((x) => x.bytes)).toEqual([100, 100, 81, 40]);
  });

  it('前面的条目改了,后面没变的块切出来一样', async () => {
    const one = zipOf([{ name: 'a', size: 100 }, { name: 'b', size: 200 }]);
    const two = zipOf([{ name: 'a', size: 101 }, { name: 'b', size: 200 }]);
    const planOf = async (z: Uint8Array) => {
      const f = new Blob([z as BlobPart]);
      return hashBlocks(f, await blockRanges(f, 1000, 512));
    };
    const [a, b] = [await planOf(one), await planOf(two)];
    expect(a.blocks[1].sum).toBe(b.blocks[1].sum);
    expect(a.blocks[0].sum).not.toBe(b.blocks[0].sum);
    expect(a.sum).toBe(hex(one));
    expect(a.blocks[0].sum).toBe(hex(one.subarray(0, a.blocks[0].bytes)));
  });

  it('块太多、不是 ZIP:按上限等分', async () => {
    const zip = zipOf(Array.from({ length: 10 }, (_, i) => ({ name: `n${i}`, size: 3 })));
    const r = await blockRanges(new Blob([zip as BlobPart]), 100, 4);
    expect(r.every((x) => x.bytes <= 100)).toBe(true);
    expect(r.reduce((n, x) => n + x.bytes, 0)).toBe(zip.length);
    const other = new Uint8Array(250);
    expect((await blockRanges(new Blob([other as BlobPart]), 100, 512)).map((x) => x.bytes)).toEqual([100, 100, 50]);
  });
});

describe('传块', () => {
  afterEach(() => _setFullNet({}));
  const plan = (n: number, bytes = 10): BlockPlan => ({ sum: 'all', bytes: n * bytes, blocks: Array.from({ length: n }, (_, i) => ({ sum: `s${i}`, bytes, start: i * bytes })) });
  const file = new Blob([new Uint8Array(1000)]);
  const noWait = async () => {};

  it('只传要的块,最多同时 4 块,进度传到底', async () => {
    let now = 0;
    let top = 0;
    const seen: string[] = [];
    _setFullNet({
      sleep: noWait,
      sender: async (sum, _d, { onBytes }) => {
        seen.push(sum);
        top = Math.max(top, ++now);
        await new Promise((r) => setTimeout(r, 2));
        onBytes(5);
        now--;
      },
    });
    const told: number[] = [];
    const need = plan(10).blocks.slice(1).map((b) => b.sum);
    await sendBlocks(file, plan(10), need, { signal: new AbortController().signal, onSent: (n) => told.push(n) });
    expect(seen.sort()).toEqual([...need].sort());
    expect(top).toBeLessThanOrEqual(4);
    expect(told.at(-1)).toBe(90);
  });

  it('断了先自己重试,好了就接着传', async () => {
    let tries = 0;
    _setFullNet({
      sleep: noWait,
      sender: async () => {
        if (++tries < 3) throw new ServerError(0, 'network', '断了');
      },
    });
    await sendBlocks(file, plan(1), ['s0'], { signal: new AbortController().signal });
    expect(tries).toBe(3);
  });

  it('重试几次还不行才说断线;别的错不重试', async () => {
    let tries = 0;
    _setFullNet({
      sleep: noWait,
      sender: async () => {
        tries++;
        throw new ServerError(0, 'network', '断了');
      },
    });
    await expect(sendBlocks(file, plan(1), ['s0'], { signal: new AbortController().signal })).rejects.toMatchObject({ code: 'network' });
    expect(tries).toBe(4);
    tries = 0;
    _setFullNet({
      sleep: noWait,
      sender: async () => {
        tries++;
        throw new ServerError(429, 'full-daily', '今天够了');
      },
    });
    await expect(sendBlocks(file, plan(1), ['s0'], { signal: new AbortController().signal })).rejects.toMatchObject({ code: 'full-daily' });
    expect(tries).toBe(1);
  });

  it('一处出错别的也停下,报的是真正的原因', async () => {
    const stopped: string[] = [];
    _setFullNet({
      sleep: noWait,
      sender: (sum, _d, { signal }) =>
        new Promise((_, reject) => {
          if (sum === 's0') return reject(new ServerError(507, 'storage-full', '满了'));
          signal.addEventListener('abort', () => {
            stopped.push(sum);
            reject(new DOMException('取消了', 'AbortError'));
          });
        }),
    });
    await expect(sendBlocks(file, plan(4), ['s0', 's1', 's2', 's3'], { signal: new AbortController().signal })).rejects.toMatchObject({ code: 'storage-full' });
    expect(stopped.length).toBe(3);
  });

  it('取消:正在传的停下', async () => {
    const ac = new AbortController();
    _setFullNet({
      sleep: noWait,
      sender: (_s, _d, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('取消了', 'AbortError')))),
    });
    const p = sendBlocks(file, plan(2), ['s0', 's1'], { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

const LIMITS: FullLimits = { worlds: 20, bytes: 200e6, perDay: 30, worldBytes: 150e6, blockBytes: 16777216, blocksPerFile: 512 };
const save = (title: string) => ({ params: { seed: 7 }, title, edits: {}, origin: null });
const AT = new Date(new Date().getFullYear(), 10, 3, 12).toISOString();
const overview = (o: Partial<FullOverview> = {}): FullOverview => ({ limits: LIMITS, used: { worlds: 1, bytes: 4.9e6, today: 1 }, storeFull: false, worlds: [{ id: 'wa', rev: 1, sum: 's', bytes: 4.9e6, uploadedAt: AT, mark: fullMark('wa', save('a')), public: true }], account: [{ id: 'wa', rev: 1 }, { id: 'wr', rev: 1, updatedAt: AT }], ...o });
const facts = (o: Partial<MenuFacts> = {}): MenuFacts => ({ id: 'wn', status: { kind: 'never' }, refusal: null, job: null, bytes: 4.9e6, overview: overview(), recipeOnly: false, failed: false, pending: false, kept: false, ...o });

describe('账号里那份和现在一样吗', () => {
  it('记号对得上才算一样;账号里只有配方的、没传过的分得开', () => {
    const o = overview();
    expect(fullStatusOf(o, 'wa', save('a')).kind).toBe('same');
    expect(fullStatusOf(o, 'wa', save('改过')).kind).toBe('changed');
    expect(fullStatusOf(o, 'wr', save('a')).kind).toBe('recipe');
    expect(fullStatusOf(o, 'wn', save('a')).kind).toBe('never');
  });

  it('AI 写的东西改过也算改过', () => {
    const o = overview();
    const seen = () => fullStatusOf(o, 'wa', save('a')).kind;
    expect(seen()).toBe('same');
    replaceNotes('wa', [{ key: 'k', kind: '史书', title: '大昌', text: '第一版', createdAt: '2026-10-05T00:00:00Z', provider: 'mock', model: 'm' }]);
    expect(seen()).toBe('changed');
    const up = overview({ worlds: [{ ...o.worlds[0], mark: fullMark('wa', save('a')) }] });
    expect(fullStatusOf(up, 'wa', save('a')).kind).toBe('same');
    replaceNotes('wa', [{ key: 'k', kind: '史书', title: '大昌', text: '第二版', createdAt: '2026-10-05T00:00:00Z', provider: 'mock', model: 'm' }]);
    expect(fullStatusOf(up, 'wa', save('a')).kind).toBe('changed');
    replaceNotes('wa', null);
  });

  it('同一份配方、新版重算过的也算改过;以前的记号没记版本的不比版本', () => {
    const at = (generator: number) => ({ ...save('a'), generator });
    const withMark = (mark: string) => overview({ worlds: [{ ...overview().worlds[0], mark }] });
    expect(fullStatusOf(withMark(fullMark('wa', at(56))), 'wa', at(56)).kind).toBe('same');
    expect(fullStatusOf(withMark(fullMark('wa', at(56))), 'wa', at(57)).kind).toBe('changed');
    expect(fullStatusOf(withMark(`${saveMark(save('a'))}|`), 'wa', at(57)).kind).toBe('same');
  });

  it('取回时只看记号里配方那一半(之前传的记号只有配方)', () => {
    replaceNotes('wa', [{ key: 'k', kind: '史书', title: '大昌', text: '第一版', createdAt: '2026-10-05T00:00:00Z', provider: 'mock', model: 'm' }]);
    expect(fullMark('wa', save('a'))).not.toBe(saveMark(save('a')));
    expect(markRecipe(fullMark('wa', save('a')))).toBe(saveMark(save('a')));
    expect(markRecipe(saveMark(save('a')))).toBe(saveMark(save('a')));
    replaceNotes('wa', null);
  });

  it('知道传不了的:再传不多占个数,大小按新的减旧的算', () => {
    const full = overview({ used: { worlds: 20, bytes: 196e6, today: 3 } });
    expect(refusalOf(full, 'wn', 1e6)).toBe('count');
    expect(refusalOf(full, 'wa', 8e6)).toBe(null);
    expect(refusalOf(full, 'wa', 9e6)).toBe('bytes');
    expect(refusalOf(overview(), 'wn', 151e6)).toBe('big');
    expect(refusalOf(overview({ used: { worlds: 1, bytes: 0, today: 30 } }), 'wn', 1e6)).toBe('today');
    expect(refusalOf(overview({ storeFull: true }), 'wn', 1e6)).toBe('store');
    // 问不到多大:不灰,点了听服务器的
    expect(refusalOf(overview(), 'wn', null)).toBe(null);
  });
});

describe('字', () => {
  const noActs: NoteActs = (a) => ({ label: a, act: a, onClick() {} });
  it('存档菜单的各种样子', () => {
    expect(menuItem(facts())).toMatchObject({ title: '传到账号', small: '传上整个世界（约 5 MB），换设备、分享都一模一样', off: false, act: 'upload' });
    expect(menuItem(facts({ kept: true })).small).toBe('这张地图只在这台设备上。传上整个世界（约 5 MB），别的设备、别人才打得开');
    const entry = overview().worlds[0];
    expect(menuItem(facts({ status: { kind: 'same', entry } }))).toMatchObject({ title: '已传到账号', small: '11 月 3 日传的，和现在一样。换设备、分享都看到这一份', act: 'account' });
    expect(menuItem(facts({ status: { kind: 'changed', entry } }))).toMatchObject({ title: '再传一次', small: '账号里是 11 月 3 日那份，之后又改过。再传就换成现在的，约 5 MB' });
    expect(menuItem(facts({ refusal: 'count' }))).toMatchObject({ off: true, act: 'refuse', small: '账号里已经放满 20 个。删掉一个不要的再传' });
    expect(menuItem(facts({ refusal: 'today' })).small).toBe('今天传够 30 次了，明天再传');
    expect(menuItem(facts({ pending: true }))).toMatchObject({ off: true, small: '还在推演，推完再传' });
    expect(menuItem(facts({ failed: true }))).toMatchObject({ off: true, small: '内容没存下来。「再存一次」以后能传' });
    expect(menuItem(facts({ recipeOnly: true }))).toMatchObject({ off: false, act: 'upload', small: '只有配方，传上去只有几 KB。换设备打开时重新长一遍' });
    expect(menuItem(facts({ recipeOnly: true, status: { kind: 'recipe', at: AT, same: false } }))).toMatchObject({ title: '再传一次', small: '账号里是 11 月 3 日传的配方。再传就换成现在的' });
    const job = { id: 'wn', title: '塞雷尼亚', phase: 'send' as const, done: 2.1e6, total: 4.9e6 };
    expect(menuItem(facts({ job }))).toMatchObject({ title: '正在传到账号', small: '2.1 / 4.9 MB', off: true });
    expect(menuItem(facts({ id: 'wo', job }))).toMatchObject({ title: '传到账号', small: '「塞雷尼亚」正在传，传完再点这个', off: true });
  });

  it('分享那一项', () => {
    const entry = overview().worlds[0];
    expect(shareItem({ kind: 'never' }, false)).toEqual({ small: '生成链接，随时能停。对方打开时重新长一遍，可能和你看到的不一样', off: false });
    expect(shareItem({ kind: 'recipe', at: AT, same: false }, true)).toMatchObject({ off: false, ask: true });
    expect(shareItem({ kind: 'never' }, false).ask).toBeUndefined();
    expect(shareItem({ kind: 'same', entry }, true)).toEqual({ small: '生成链接，随时能停。对方看到的和你这里一模一样', off: false });
    expect(shareItem({ kind: 'changed', entry }, false).small).toBe('生成链接，随时能停。对方看到的是 11 月 3 日传的那份');
    expect(shareItem({ kind: 'same', entry: { ...entry, public: false, reason: 'opaque' } }, false)).toEqual({ small: '带着插件的附加数据，不能公开分享。可以存成文件发给对方', off: true });
  });

  it('到了限额', () => {
    expect(refusalNote('count', LIMITS, {}, noActs)).toMatchObject({ text: '账号里已经放满 20 个', more: '删掉一个，就能传这个', action: { act: 'look' } });
    expect(refusalNote('bytes', LIMITS, { bytes: 35e6, left: 12e6 }, noActs)).toMatchObject({ text: '账号里放不下这个世界', more: '它约 35 MB，账号里只剩 12 MB。删掉几个就能传' });
    expect(refusalNote('big', LIMITS, { bytes: 170e6 }, noActs)).toMatchObject({ text: '这个世界太大，传不了', more: '它约 170 MB，一个世界最多 150 MB。可以存成文件', action: { act: 'file' } });
    expect(refusalNote('today', LIMITS, {}, noActs)).toMatchObject({ text: '今天传够 30 次了', more: '明天再传。世界在本机没事' });
    expect(refusalNote('store', LIMITS, {}, noActs)).toMatchObject({ text: '账号服务器放满了', more: '不是你的账号满了。世界在本机没事，可以先存成文件' });
  });

  it('服务器说的错都有对应的话,不说文件坏了', () => {
    const note = (code: string, data: Record<string, unknown> = {}, sending = false) => errorNote(new ServerError(400, code, '服务器的话', data), LIMITS, sending, noActs);
    expect(note('full-bytes', { worldBytes: 35e6, leftBytes: 12e6 }).more).toBe('它约 35 MB，账号里只剩 12 MB。删掉几个就能传');
    expect(note('world-too-big', { worldBytes: 170e6, maxBytes: 150e6 }).text).toBe('这个世界太大，传不了');
    expect(note('full-daily', { max: 30 }).text).toBe('今天传够 30 次了');
    expect(note('full-daily').text).toBe('今天传的内容太多了');
    expect(note('storage-full').text).toBe('账号服务器放满了');
    for (const c of ['world-invalid', 'world-newer']) expect(note(c).more).toBe('服务器核对没通过，可能是网站刚更新。刷新页面再传一次');
    for (const c of ['check-limit', 'busy', 'pending-full']) expect(note(c).more).toBe('服务器这会儿太忙，没核对完。等一会儿再试');
    expect(note('network').more).toBe('连不上服务器，联网后再试');
    expect(note('network', {}, true)).toMatchObject({ text: '传到一半断线了', more: '世界在本机没事，传上去的不用重传', action: { act: 'retry' } });
    expect(note('auth').text).toBe('登录过期了，请重新登录');
  });

  it('文字审核:说是哪个名字;网页自己写的改不了,给存成文件', () => {
    const hit = (by: 'author' | 'ai' | 'site', kind: string, text: string) => ({ by, kind, text });
    expect(textNote([hit('author', '国名', '奥利亚王国')], 1, noActs).more).toBe('国名「奥利亚王国」没通过文字审核，改个名再传');
    expect(textNote([hit('author', '世界名', '某')], 1, noActs).more).toBe('世界名「某」没通过文字审核，改个名再传');
    expect(textNote([hit('author', '国名', '奥利亚王国'), hit('site', '历史', 'x')], 3, noActs).more).toBe('国名「奥利亚王国」等 3 处没通过文字审核，改掉再传');
    expect(textNote([hit('ai', 'AI 写的', '大昌书')], 1, noActs).more).toBe('AI 写的「大昌书」没通过文字审核。删掉或重写再传');
    const site = textNote([hit('site', '历史', 'x')], 1, noActs);
    expect(site.more).toBe('网页自己写的历史没过文字审核，改不了。可以存成文件');
    expect(site.action?.act).toBe('file');
  });

  it('从账号里删、用了多少、标题下那句、进度', () => {
    expect(removeWords({ here: true, shared: false })).toBe('删掉账号里这一份？这台设备上的世界不动。');
    expect(removeWords({ here: true, shared: true })).toBe('删掉账号里这一份？这台设备上的世界不动。分享的链接会打不开');
    expect(removeWords({ here: false, shared: false })).toBe('这台设备上没有它。删掉以后 30 天内能在「最近删除」里找回');
    expect(usedLine(overview({ used: { worlds: 2, bytes: 9.8e6, today: 0 } }))).toBe('2 / 20 个，9.8 / 200 MB');
    expect(homeAccountLine(6, 2, false)).toBe('6 个世界存在这个浏览器里，传到账号的 2 个换设备也能打开。');
    expect(homeAccountLine(6, 0, false)).toBe('6 个世界存在这个浏览器里。想换设备打开，到「存档」里传到账号。');
    expect(homeAccountLine(6, 2, true)).toBe('6 个世界，2 个传到了账号');
    expect(homeAccountLine(6, 0, true)).toBe('6 个世界，都在这个浏览器里');
    expect(pairText(2.1e6, 4.9e6)).toBe('2.1 / 4.9 MB');
    expect(pairText(50e6, 133e6)).toBe('50 / 133 MB');
  });
});
