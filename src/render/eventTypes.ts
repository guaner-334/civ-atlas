/**
 * 史事归成的几类:时间轴、地图上的事件标签、回放字幕、故事长图共用。
 * 编年史的哪一种归哪一类见 ui/timelineLayout.ts 的 evType。
 */

/** 五类事件 + 宗教(faith)+ 时代(era)+ 思潮(thought)+ 灾异(calamity)+ 干预(order);CSS 里 [data-ev=war] 等配色 */
export type EvType = 'war' | 'dynasty' | 'found' | 'empire' | 'assim' | 'faith' | 'era' | 'thought' | 'calamity' | 'order';
