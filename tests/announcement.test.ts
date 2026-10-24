/**
 * 网站公告(ui/announcement.ts):网站根目录 announcement.json 怎么读、缺什么就不弹
 */
import { describe, expect, it } from 'vitest';
import { parseNotice } from '../src/ui/announcement';

describe('网站公告', () => {
  it('读编号、日期、标题、正文、链接;正文一行一段,空行和前后空格去掉', () => {
    expect(
      parseNotice({
        id: '20261024-1327',
        date: '2026-10-24',
        title: ' 网站搬家通知 ',
        body: '第一段\r\n\n  第二段  \n',
        link: 'https://example.com/a',
      }),
    ).toEqual({ id: '20261024-1327', date: '10 月 24 日', title: '网站搬家通知', paras: ['第一段', '第二段'], link: 'https://example.com/a' });
  });

  it('日期、链接、编号可以不写;链接不是 https、日期认不出就不用', () => {
    const n = parseNotice({ title: '标题', body: '正文', link: 'http://example.com', date: '10月24日' });
    expect(n).toMatchObject({ date: '', link: '', paras: ['正文'] });
    // 不写编号:按标题和正文认,改了内容就是新的一条
    expect(n?.id).toBe(parseNotice({ title: '标题', body: '正文' })?.id);
    expect(n?.id).not.toBe(parseNotice({ title: '标题', body: '正文改了' })?.id);
    expect(parseNotice({ title: '标题', body: '正文', link: '不是网址', date: '2026-13-01' })).toMatchObject({ link: '', date: '' });
  });

  it('没写标题或正文、不是对象(撤下公告、本地开发拿到首页):不弹', () => {
    for (const raw of [null, '公告', [], {}, { title: '标题' }, { body: '正文' }, { title: '  ', body: '正文' }, { title: '标题', body: '\n \n' }, { title: 1, body: 2 }]) {
      expect(parseNotice(raw)).toBeNull();
    }
  });

  it('标题、正文太长时截断', () => {
    const n = parseNotice({ title: '字'.repeat(100), body: '字'.repeat(5000) });
    expect(n?.title.length).toBe(40);
    expect(n?.paras.join('').length).toBe(1000);
  });
});
