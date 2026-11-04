/**
 * 按版本取查询读取代码。做法见 index.ts。
 */
import { READER_VERSIONS, readerBook } from './versions';
import * as current from './queryCode';

export type QueryReader = typeof current;

/** 当前版本 */
export const currentQuery: QueryReader = current;

/** 留下来的老版本(版本号 → 下载):每个都是单独的文件,打开那样的世界时才下载 */
const OLDER: Record<number, () => Promise<QueryReader>> = {};

export const queryReader = readerBook<QueryReader>('query', READER_VERSIONS.query, current, OLDER);
