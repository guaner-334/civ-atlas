/**
 * 界面小 store 的通用部分(src/ui/createStore.ts):订阅、取消订阅、值没变不通知、组件里取到的是新值。
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createListeners, createStore } from '../src/ui/createStore';

describe('createStore', () => {
  it('get / set / update', () => {
    const s = createStore({ n: 1 });
    expect(s.get()).toEqual({ n: 1 });
    s.set({ n: 2 });
    expect(s.get()).toEqual({ n: 2 });
    s.update((v) => ({ n: v.n + 1 }));
    expect(s.get()).toEqual({ n: 3 });
  });

  it('变了才通知;取消订阅后不再通知', () => {
    const s = createStore<number | null>(0);
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.set(1);
    expect(calls).toBe(1);
    s.set(1);
    s.update((v) => v);
    expect(calls).toBe(1);
    s.set(null);
    expect(calls).toBe(2);
    off();
    s.set(5);
    expect(calls).toBe(2);
    expect(s.get()).toBe(5);
  });

  it('同一个对象 set 回去不通知,内容一样的新对象照样通知', () => {
    const a = { x: 1 };
    const s = createStore(a);
    let calls = 0;
    s.subscribe(() => calls++);
    s.set(a);
    expect(calls).toBe(0);
    s.set({ x: 1 });
    expect(calls).toBe(1);
  });

  it('通知时 get 已经是新值;按订阅先后调', () => {
    const s = createStore('a');
    const seen: string[] = [];
    s.subscribe(() => seen.push(`1:${s.get()}`));
    s.subscribe(() => seen.push(`2:${s.get()}`));
    s.set('b');
    expect(seen).toEqual(['1:b', '2:b']);
  });

  it('组件里 use() 取到的是新值;给了 select 取选出来的那部分', () => {
    const s = createStore({ name: '甲', age: 3 });
    const Whole = () => createElement('i', null, `${s.use().name}${s.use().age}`);
    const Part = () => createElement('b', null, s.use((v) => v.name));
    expect(renderToStaticMarkup(createElement(Whole))).toBe('<i>甲3</i>');
    s.set({ name: '乙', age: 4 });
    expect(renderToStaticMarkup(createElement(Whole))).toBe('<i>乙4</i>');
    expect(renderToStaticMarkup(createElement(Part))).toBe('<b>乙</b>');
  });
});

describe('createListeners', () => {
  it('emit 挨个通知;同一个函数订阅两次只算一次;取消后不再调', () => {
    const l = createListeners();
    let a = 0;
    let b = 0;
    const fa = () => a++;
    const offA = l.subscribe(fa);
    l.subscribe(fa);
    const offB = l.subscribe(() => b++);
    l.emit();
    expect([a, b]).toEqual([1, 1]);
    offA();
    l.emit();
    expect([a, b]).toEqual([1, 2]);
    offB();
    l.emit();
    expect([a, b]).toEqual([1, 2]);
  });

  it('通知途中取消的不再调,新订阅的这一轮也调到(和 Set 的遍历一样)', () => {
    const l = createListeners();
    const seen: string[] = [];
    let offB = () => {};
    l.subscribe(() => {
      seen.push('a');
      offB();
      if (seen.length === 1) l.subscribe(() => seen.push('c'));
    });
    offB = l.subscribe(() => seen.push('b'));
    l.emit();
    expect(seen).toEqual(['a', 'c']);
  });

  it('组件里 use(取值) 取到的是现在的值', () => {
    const l = createListeners();
    let n = 1;
    const C = () => createElement('i', null, String(l.use(() => n * 10)));
    expect(renderToStaticMarkup(createElement(C))).toBe('<i>10</i>');
    n = 2;
    l.emit();
    expect(renderToStaticMarkup(createElement(C))).toBe('<i>20</i>');
  });
});
