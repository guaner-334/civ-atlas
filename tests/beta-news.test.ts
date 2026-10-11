/**
 * 版本号上的「测试版新功能」(ui/betaNews.ts):whats-new.json 怎么读、两个网站的清单怎么对、预计哪天更新到正式网站
 */
import { describe, expect, it } from 'vitest';
import { NEWS_MAX, aheadOf, beijingDay, dayText, linkText, makeNews, nextSync, parseNews, type NewsItem } from '../src/ui/betaNews';
import { WHATS_NEW } from '../src/ui/whatsNew';

const item = (pr: number): NewsItem => ({ pr, title: `功能 ${pr}`, text: `第 ${pr} 号改动` });

describe('测试版新功能', () => {
  it('读构建日期和清单;单条不对的跳过,整份不对 = null', () => {
    expect(parseNews({ built: '2026-10-11', news: [item(76), item(75)] })).toEqual({ built: '2026-10-11', news: [item(76), item(75)] });
    const f = parseNews({
      built: '2026-10-11',
      news: [item(76), null, { pr: '75', title: 'a', text: 'b' }, { pr: 1.5, title: 'a', text: 'b' }, { pr: 3, title: ' ', text: 'b' }, { pr: 4, title: ' 标题 ', text: ' 说明 ' }],
    });
    expect(f?.news).toEqual([item(76), { pr: 4, title: '标题', text: '说明' }]);
    for (const raw of [null, 'x', [], {}, { built: '10-11', news: [] }, { built: '2026-10-11' }, { built: '2026-10-11', news: {} }]) {
      expect(parseNews(raw)).toBeNull();
    }
  });

  it('测试网站多出来的:按 PR 号对,保持测试网站的先后', () => {
    expect(aheadOf([item(76), item(75), item(74), item(70)], [item(70), item(66)])).toEqual([item(76), item(75), item(74)]);
    expect(aheadOf([item(70)], [item(70)])).toEqual([]);
  });

  it('预计日期:测试网站发布那天之后的第一个周日;过了还没同步,顺延到今天或以后的第一个周日', () => {
    // 2026-10-11 是周日
    expect(nextSync('2026-10-11', '2026-10-11')).toBe('2026-10-18');
    expect(nextSync('2026-10-12', '2026-10-14')).toBe('2026-10-18');
    expect(nextSync('2026-10-17', '2026-10-17')).toBe('2026-10-18');
    expect(nextSync('2026-10-12', '2026-10-18')).toBe('2026-10-18');
    expect(nextSync('2026-10-12', '2026-10-19')).toBe('2026-10-25');
    expect(nextSync('2026-10-12', '2026-10-25')).toBe('2026-10-25');
    // 跨月、跨年
    expect(nextSync('2026-12-28', '2026-12-28')).toBe('2027-01-03');
    expect(dayText('2026-10-18')).toBe('10 月 18 日');
    expect(dayText('2027-01-03')).toBe('1 月 3 日');
  });

  it('北京时间的日期:UTC 16 点以后算第二天', () => {
    expect(beijingDay(Date.parse('2026-10-11T15:59:00Z'))).toBe('2026-10-11');
    expect(beijingDay(Date.parse('2026-10-11T16:00:00Z'))).toBe('2026-10-12');
  });

  it('卡片内容:正式网站上给测试地址,测试网站上给正式网站;两边一样 = null;太多只列几条', () => {
    const beta = { built: '2026-10-11', news: [item(76), item(75), item(74)] };
    expect(makeNews(false, beta, [item(74)], '2026-10-11', 'https://atlas.gerdor.top/beta/')).toEqual({
      items: [item(76), item(75)],
      more: 0,
      when: '10 月 18 日',
      beta: false,
      link: 'https://atlas.gerdor.top/beta/',
    });
    expect(makeNews(true, beta, [], '2026-10-11', 'https://atlas.gerdor.top/')?.items).toHaveLength(3);
    expect(makeNews(false, beta, beta.news, '2026-10-11', '')).toBeNull();
    const many = { built: '2026-10-11', news: Array.from({ length: NEWS_MAX + 3 }, (_, i) => item(100 - i)) };
    const n = makeNews(false, many, [], '2026-10-11', '');
    expect(n?.items).toHaveLength(NEWS_MAX);
    expect(n?.more).toBe(3);
    expect(linkText('https://atlas.gerdor.top/beta/')).toBe('atlas.gerdor.top/beta');
    expect(linkText('https://atlas.gerdor.top/')).toBe('atlas.gerdor.top');
  });

  it('自己的清单:PR 号不重复,标题和说明都写了、不太长', () => {
    const prs = WHATS_NEW.map((n) => n.pr);
    expect(new Set(prs).size).toBe(prs.length);
    for (const n of WHATS_NEW) {
      expect(Number.isInteger(n.pr) && n.pr > 0).toBe(true);
      expect(n.title.trim().length).toBeGreaterThan(0);
      expect(n.title.length).toBeLessThanOrEqual(20);
      expect(n.text.length).toBeLessThanOrEqual(80);
    }
    // 读回来和写出去的一样(构建时写成 whats-new.json)
    expect(parseNews(JSON.parse(JSON.stringify({ built: '2026-10-11', news: WHATS_NEW })))?.news).toEqual(WHATS_NEW);
  });
});
