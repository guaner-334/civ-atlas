/**
 * 作品墙搜索(src/ui/gallerySearch.ts):搜哪几段字、怎么切词、每个词都要对上(可以分在不同段)、
 * 不分大小写和全角半角、每个词搜到的地方各自标出来、只有空格不算在搜、最多 40 个字。
 */
import { describe, expect, it } from 'vitest';
import type { GalleryWork } from '../src/account/gallery';
import { FIND_MAX, findHit, findKeys, findLead, findPieces, findWords, fold, workTexts } from '../src/ui/gallerySearch';

const SUM = 'a'.repeat(64);

function work(o: Partial<GalleryWork>): GalleryWork {
  return { id: 'w1', kind: 'world', title: '', by: '', blurb: '', version: 1, addedAt: '2026-11-14T00:00:00Z', ...o };
}

const plugin = (o: Partial<GalleryWork>, p: Record<string, unknown> = {}) =>
  work({
    kind: 'plugin',
    version: null,
    ...o,
    plugin: { id: 'p', name: '', version: '1.0.0', sum: SUM, bytes: 1, requires: [], license: 'MIT', icon: false, updatedAt: '', note: '', versions: [], shots: [], ...p },
  });

/** 拿框里的字搜这个作品 */
const hits = (w: GalleryWork, q: string) => findHit(workTexts(w).map(fold), findKeys(findWords(q)));

/** 标出来的几截写成「[搜到的]」 */
const marked = (text: string, q: string) =>
  findPieces(text, findKeys(findWords(q)))
    .map((p) => (p.hit ? `[${p.text}]` : p.text))
    .join('');

describe('搜哪几段字', () => {
  const w = work({ title: '金阳洋两岸', by: '砚山', blurb: '两岸七个王朝打了三百年。' });

  it('作品名、署名、一句话介绍', () => {
    expect(hits(w, '金阳')).toBe(true);
    expect(hits(w, '砚山')).toBe(true);
    expect(hits(w, '王朝')).toBe(true);
    expect(hits(w, '伊索尼斯')).toBe(false);
  });

  it('插件另搜插件名和说明', () => {
    const p = plugin({ title: '离海多远', by: '文明与地图示例', blurb: '加一个地块图层' }, { name: 'coast distance', description: '每块陆地走到海边多少公里' });
    expect(hits(p, 'coast')).toBe(true);
    expect(hits(p, '公里')).toBe(true);
    expect(workTexts(plugin({ title: '潮汐' }, { name: '潮汐' }))).toEqual(['潮汐', '潮汐']);
    // plugin 里没有名字、说明(或者不是字)的,只搜作品自己的字
    expect(workTexts(work({ kind: 'plugin', title: '坏插件', plugin: { id: 1, name: 2 } }))).toEqual(['坏插件']);
    expect(workTexts(work({ kind: 'plugin', title: '坏插件', plugin: null }))).toEqual(['坏插件']);
  });

  it('规则作品另搜规则名和摘要;别的作品带着规则也不搜它', () => {
    const r = work({ kind: 'rules', title: '乱世', rules: { name: '战国七雄', changed: 6, brief: '宣战更容易、灭国更难' } });
    expect(hits(r, '七雄')).toBe(true);
    expect(hits(r, '灭国')).toBe(true);
    expect(hits(work({ kind: 'world', title: '九州', rules: { name: '战国七雄', changed: 6, brief: '' } }), '七雄')).toBe(false);
  });

  it('日期、版本这些不搜', () => {
    expect(hits(w, '2026')).toBe(false);
  });
});

describe('切词', () => {
  it('去掉头尾空格,连着几个空格当一个', () => {
    expect(findWords('  海   图层 ')).toEqual(['海', '图层']);
    expect(findWords('海　图层')).toEqual(['海', '图层']);
    expect(findWords('海\t图层')).toEqual(['海', '图层']);
  });

  it('只有空格 = 没在搜', () => {
    expect(findWords('')).toEqual([]);
    expect(findWords('   ')).toEqual([]);
    expect(findWords('　 ')).toEqual([]);
  });

  it(`最多看前 ${FIND_MAX} 个字`, () => {
    expect(FIND_MAX).toBe(40);
    expect(findWords('字'.repeat(50))).toEqual(['字'.repeat(40)]);
  });
});

describe('每个词都要对上,可以分在不同地方', () => {
  it('「人口 密度」搜得到「人口密度」', () => {
    expect(hits(work({ title: '人口密度' }), '人口 密度')).toBe(true);
    expect(hits(work({ title: '人口密度' }), '密度 人口')).toBe(true);
  });

  it('「示例 战」搜得到署名「文明与地图示例」的「厌战」', () => {
    const p = plugin({ title: '厌战', by: '文明与地图示例' });
    expect(hits(p, '示例 战')).toBe(true);
    expect(hits(plugin({ title: '潮汐', by: '文明与地图示例' }), '示例 战')).toBe(false);
  });

  it('一个词不能拆到两段里拼起来', () => {
    // 作品名结尾「两」+ 署名开头「岸」不算「两岸」
    expect(hits(work({ title: '金阳两', by: '岸边人' }), '两岸')).toBe(false);
  });
});

describe('不分大小写、全角半角当一样', () => {
  it('英文字母不分大小写', () => {
    const p = plugin({ title: '量路程' }, { name: 'Route Days' });
    expect(hits(p, 'route')).toBe(true);
    expect(hits(p, 'ROUTE DAYS')).toBe(true);
  });

  it('全角半角当一样', () => {
    expect(hits(work({ title: 'ＡＢＣ王国' }), 'abc')).toBe(true);
    expect(hits(work({ title: 'ABC王国' }), 'ａｂｃ')).toBe(true);
    expect(hits(work({ blurb: '每 50 年一份' }), '５０')).toBe(true);
    expect(hits(work({ blurb: '大陆架越宽，潮差越大' }), ',潮差')).toBe(true);
  });

  it('换算不改长度,别的字照旧', () => {
    expect(fold('ＡＢ，Cd　中文')).toBe('ab,cd 中文');
    expect(fold('İ').length).toBe(1);
  });
});

describe('每个词搜到的地方各自标出来', () => {
  it('两个词、每处都标', () => {
    expect(marked('算出近岸每块海的潮差：大陆架越宽、海湾越封闭，只画一张图层', '海 图层')).toBe('算出近岸每块[海]的潮差：大陆架越宽、[海]湾越封闭，只画一张[图层]');
  });

  it('标的是原文(全角、大写照原样)', () => {
    expect(marked('Ｒoute Days', 'route')).toBe('[Ｒoute] Days');
  });

  it('重叠、挨着的合成一处', () => {
    expect(marked('人口密度', '人口 密度')).toBe('[人口密度]');
    expect(marked('人口密度', '人口 口密')).toBe('[人口密]度');
    expect(marked('aaa', 'aa')).toBe('[aaa]');
  });

  it('没搜到的段原样一截', () => {
    expect(findPieces('潮汐', findKeys(['海']))).toEqual([{ text: '潮汐', hit: false }]);
    expect(findPieces('', findKeys(['海']))).toEqual([{ text: '', hit: false }]);
  });
});

describe('「搜到 N 个」旁边那句', () => {
  it('一个词、两个词、三个词', () => {
    expect(findLead(['图层'])).toBe('名字、作者、介绍里有「图层」');
    expect(findLead(['海', '图层'])).toBe('名字、作者、介绍里同时有「海」和「图层」');
    expect(findLead(['a', 'b', 'c'])).toBe('名字、作者、介绍里同时有「a」、「b」和「c」');
  });
});
