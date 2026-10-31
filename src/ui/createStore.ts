/**
 * 界面里的小 store:一份状态 + 一组订阅者 + 组件里取值的 hook(React 的 useSyncExternalStore)。纯状态,不碰 DOM。
 *
 *   createStore(初值)   只有一份值的:get / set / update / subscribe / use。
 *                       set 进来的和现在的是同一个值(Object.is)就不改、不通知
 *   createListeners()   只管订阅者:状态自己用变量存着(好几份、第一次读才去取、改完好几处再一起通知、
 *                       没变也要通知的),改完调 emit;组件里 use(取值函数) 按取出来的值变没变决定重画
 *
 * 通知按订阅的先后挨个调;同一个函数订阅两次只算一次;通知途中有人订阅 / 取消,照 Set 的遍历规则
 * (新订阅的这一轮也会调到,取消了的不再调)。
 * use 的取值函数对同样的状态要返回同一个值(原始值,或者没变就是同一个对象),不然组件会一直重画。
 */
import { useSyncExternalStore } from 'react';

export interface Listeners {
  /** 有变化时调 f;返回取消订阅 */
  subscribe: (f: () => void) => () => void;
  /** 挨个通知订阅者 */
  emit: () => void;
  /** 组件里取值:get() 的结果变了(Object.is)才重画 */
  use: <S>(get: () => S) => S;
}

export function createListeners(): Listeners {
  const subs = new Set<() => void>();
  const subscribe = (f: () => void) => {
    subs.add(f);
    return () => void subs.delete(f);
  };
  const emit = () => {
    for (const f of subs) f();
  };
  const use = <S>(get: () => S): S => {
    // 取值函数每次渲染都新包一层:React 18 的 useSyncExternalStore 在组件渲染途中 setState、重跑一遍组件时,
    // 订阅函数和取值函数都没换就不再记下这次渲染取到的值,之后再变回原来的值不会重画(漏一次通知)
    const snap = () => get();
    return useSyncExternalStore(subscribe, snap, snap);
  };
  return { subscribe, emit, use };
}

export interface Store<T> {
  get: () => T;
  /** 换成 next;和现在的是同一个值(Object.is)就什么都不做 */
  set: (next: T) => void;
  /** 照现在的值算出新值再 set */
  update: (fn: (prev: T) => T) => void;
  /** 值变了时调 f;返回取消订阅 */
  subscribe: (f: () => void) => () => void;
  /** 组件里取值;给了 select 就只在选出来的那部分变了(Object.is)时重画 */
  use: {
    (): T;
    <S>(select: (v: T) => S): S;
  };
}

export function createStore<T>(init: T): Store<T> {
  let value = init;
  const { subscribe, emit, use: useSnapshot } = createListeners();
  const get = () => value;
  const set = (next: T) => {
    if (Object.is(next, value)) return;
    value = next;
    emit();
  };
  const update = (fn: (prev: T) => T) => set(fn(value));
  function use(): T;
  function use<S>(select: (v: T) => S): S;
  function use<S>(select?: (v: T) => S): T | S {
    return useSnapshot<T | S>(select ? () => select(value) : get);
  }
  return { get, set, update, subscribe, use };
}
