/** 推演线程里跑推演插件的 QuickJS;只经 import() 取(地图插件另经 import() 取 map.ts,不跟着这一包) */
export { QUICKJS_LIMITS, quickjsPlugin, type QuickJSLimits, type QuickJSPlugin, type QuickJSPluginSpec, type SimSetup } from './sim';
export { quickjsWasm } from './wasm';
