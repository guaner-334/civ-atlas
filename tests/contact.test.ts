/**
 * 「联系我们」(ui/contact.ts):网站根目录 contact.json 怎么读、缺什么就不显示、二维码按加群链接画
 */
import { describe, expect, it } from 'vitest';
import { encode } from 'uqr';
import { makeQr, parseContact, qrPath } from '../src/ui/contact';

const URL_ = 'https://qm.qq.com/q/xXrrfGrKso';

describe('联系我们', () => {
  it('读群名、群号、链接;群名不写用「QQ 交流群」,前后空格去掉', () => {
    expect(parseContact({ name: '《文明与地图》项目交流群', qq: '925687934', url: URL_ })).toEqual({
      name: '《文明与地图》项目交流群',
      qq: '925687934',
      url: URL_,
    });
    expect(parseContact({ qq: ' 925687934 ', url: ` ${URL_}\n`, name: '  ' })).toEqual({ name: 'QQ 交流群', qq: '925687934', url: URL_ });
    // 群号写成数字也认
    expect(parseContact({ qq: 925687934, url: URL_ })?.qq).toBe('925687934');
  });

  it('缺群号、缺链接、群号不是数字、链接不是 https、不是对象:不显示', () => {
    for (const raw of [
      null,
      '925687934',
      [],
      {},
      { qq: '925687934' },
      { url: URL_ },
      { qq: '92568', url: '' },
      { qq: '9256', url: URL_ },
      { qq: '92568793a', url: URL_ },
      { qq: '925687934', url: 'http://qm.qq.com/q/xXrrfGrKso' },
      { qq: '925687934', url: 'javascript:alert(1)' },
      { qq: '925687934', url: 'qm.qq.com/q/xXrrfGrKso' },
    ]) {
      expect(parseContact(raw)).toBeNull();
    }
  });

  it('群名太长截到 40 个字', () => {
    expect(parseContact({ qq: '925687934', url: URL_, name: '群'.repeat(60) })?.name).toHaveLength(40);
  });

  it('二维码路径:一行里连着的深色格子并成一段', () => {
    const q = qrPath([
      [true, true, false, true],
      [false, false, false, false],
      [true, true, true, true],
      [false, true, false, false],
    ]);
    expect(q.size).toBe(4);
    expect(q.d).toBe('M0 0h2v1h-2zM3 0h1v1h-1zM0 2h4v1h-4zM1 3h1v1h-1z');
  });

  it('按加群链接画二维码:格子和二维码库算的一样多', async () => {
    const qr = await makeQr(URL_);
    const cells = encode(URL_, { ecc: 'M', border: 0 }).data;
    expect(qr?.size).toBe(cells.length);
    const dark = cells.flat().filter(Boolean).length;
    const drawn = [...qr!.d.matchAll(/h(\d+)v1/g)].reduce((s, m) => s + Number(m[1]), 0);
    expect(drawn).toBe(dark);
  });
});
