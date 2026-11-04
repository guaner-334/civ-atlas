/**
 * 网站的版本号(侧栏"更多"菜单底部、概览底部那行小字里显示)。
 * 构建时由 vite.config.ts 从 package.json 的 version 填进来;直接在 Node 里跑(检查脚本)时没有,显示 dev。
 */
declare const __APP_VERSION__: string | undefined;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** 这个版本是哪个提交构建的(世界文件的清单里记一笔);不知道 = 空串 */
declare const __APP_COMMIT__: string | undefined;
export const APP_COMMIT: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : '';
