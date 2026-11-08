/**
 * 世界文件的格式定义(第 1 版):后缀、清单的字段、有哪几块、读不了时的几种错。这一层只有定义,打包和读在 worldFile.ts,逐项核对在 worldValidate.ts。
 *
 * 文件是一个不压缩的 ZIP(zipStore.ts),任何解压软件都打得开:
 *
 *   manifest.json        清单(UTF-8 的 JSON,缩进两格,人也能读)
 *   parts/map.gz         地图(World,不带形成过程的回放快照)
 *   parts/eras.gz        地形大事以后的各段世界(没有地形大事就不写)
 *   parts/civ.gz         整段历史(Civ)
 *   parts/chronicle.gz   编年史(第 2 版 ChronicleBlock:名字写成占位符,gen/civ/story/nameTokens.ts;第 1 版是算好的文字 ChronicleEntry[])
 *   parts/flags.gz       各国历代的旗(FlagBook)
 *   parts/author.gz      作者的内容:AI 写的正文(可选)
 *   parts/thumb.jpg      封面(可选)
 *   parts/planet.gz      没改地形的星球参照(可选,见 PlanetValue)
 *   parts/ext.xxx.gz     插件存的数据(可选,见 PLUGIN_DATA_PREFIX)
 *   parts/sim.xxx.gz     推演插件推到哪的状态(可选,见 SIM_STATE_PREFIX)
 *   parts/layer.xxx.yyy.gz  存进世界的插件图层(可选,见 PLUGIN_LAYER_PREFIX)
 *
 * 带 .gz 的块:字节是 gzip 压缩过的 CIVSNAP1(snapshot.ts 的 packValue)。外壳不再压缩。
 * ZIP 里只能有清单和清单列出的块,多一个、少一个都不认:每一个字节都有清单担保,校验、审核才能看全。
 *
 * 清单的字段(WorldManifest):
 * - app:固定是 WORLD_APP
 * - kind:这个文件是什么。现在只有 world(整个世界);以后的种子作品之类用别的值,认不出的提示更新软件
 * - format:外壳和清单的版本。只有旧软件读了会读错才加一;加可选字段不算(认不出的字段原样留着,另存也带着)
 * - id、title:世界的编号、名字
 * - made:什么时候用哪一版软件做的(app 软件版本、generator 生成器版本、commit 提交、at 时间)
 * - readers:读这个世界要用第几版读取规则(terrain 铺地形、query 查某年的归属和人口)。比软件新的提示更新软件
 * - parts:每一块一项(WorldPartInfo)
 * - recipe:存档的全部内容(savefile.ts 的 SaveFile:参数、作者的修改、投影、出处……)
 * - plugins:用过的插件(WorldPlugin):只记编号、第几版、文件指纹,**绝不放插件的代码**。看世界永远不需要插件,接着推才需要
 * - revision:第几次修订(n)、上一份清单的指纹(parent:上一份 manifest.json 字节的 SHA-256;第一份没有)
 *
 * 每一块(WorldPartInfo):
 * - name:块名。file:块在 ZIP 里的路径。两者都只认 parts/ 底下的小写字母、数字、点、连字符
 * - schema:这一块的结构版本。读的时候逐级迁移到现在的结构(worldMigrate.ts)
 * - sum、bytes:解压后字节的 SHA-256、字节数(和 snapshot.ts 的 SnapshotPart 一样);zip:gzip / none
 * - need:view = 看世界必须有;extra = 可选。by(可选):哪个插件放的
 *
 * 版本的规矩:比软件新的 format、kind、readers、need 是 view 的 schema,读的时候报「要更新软件」(newer),不当文件坏了。
 * need 是 extra 的块读不懂也不碍事:认不出的、结构比软件新的只当字节,**不解开、不执行**,另存时原样带着。
 *
 * 纯定义,不碰 DOM,网页、worker、Node(服务器)共用一份。
 */
import type { SaveFile } from './savefile';
import type { PlanetNames, PlanetTempo } from './civ/types';

/** 文件的后缀 */
export const WORLD_FILE_EXT = '.civworld';
/** 清单里 app 的值 */
export const WORLD_APP = '文明与地图';
/** 清单里 kind 的值(现在只有这一种) */
export const WORLD_KIND = 'world';
/** 这一版软件读写的外壳和清单版本 */
export const WORLD_FORMAT = 1;
/** 清单在 ZIP 里的路径 */
export const MANIFEST_FILE = 'manifest.json';

/** 看世界必须有 / 可选 */
export type PartNeed = 'view' | 'extra';

/** 清单里的一块 */
export interface WorldPartInfo {
  name: string;
  /** 在 ZIP 里的路径 */
  file: string;
  /** 这一块的结构版本 */
  schema: number;
  /** 解压后字节的 SHA-256(十六进制) */
  sum: string;
  /** 解压后的字节数 */
  bytes: number;
  /** 压缩方式:gzip / none;need 是 extra 的块可以是认不出的写法(只当字节留着) */
  zip: string;
  need: PartNeed;
  /** 哪个插件放的 */
  by?: string;
}

/** 什么时候用哪一版软件做的 */
export interface WorldMade {
  /** 软件版本("1.6.0") */
  app: string;
  /** 生成器版本(GENERATOR_VERSION) */
  generator: number;
  /** 提交(不知道 = 空串) */
  commit: string;
  /** 时间(ISO 8601) */
  at: string;
}

/** 读这个世界要用第几版读取规则 */
export type WorldReaders = {
  terrain: number;
  query: number;
};

/** 插件编号:小写字母开头,小写字母、数字,中间可以有单个连字符 */
export const PLUGIN_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** 插件编号最长几个字:块名最长 64,还要放得下 ext.<编号> 和以后的 layer.<编号>.<图层> */
export const PLUGIN_ID_MAX = 32;

/**
 * 插件存进世界的自己的数据:一个插件一块,块名 ext.<插件编号>,need 是 extra,by 写这个插件的编号,
 * schema 是插件自己的结构版本,内容是 packValue 打的值。网站不解开、不检查里面,带着它的世界不能公开分享
 */
export const PLUGIN_DATA_PREFIX = 'ext.';
/** 一个插件存进一个世界的数据最多多少字节(解压后) */
export const PLUGIN_DATA_MAX_BYTES = 1024 * 1024;
export const pluginDataPart = (pluginId: string): string => `${PLUGIN_DATA_PREFIX}${pluginId}`;

/**
 * 推演插件推到哪的状态(Civ.simPlugins 的一项,engine/plugin.ts 的 SimPluginState):一个插件一块,块名 sim.<插件编号>,
 * 按插件出手的先后排;need 是 extra(看世界用不着,接着推才用),by 写这个插件的编号,schema 是 SIM_STATE_SCHEMA。
 * 内容是 packValue 打的值,只有数和数表的名字,网站逐项核对(worldValidate.ts 的 validateSimState),不算只当字节留着的块
 */
export const SIM_STATE_PREFIX = 'sim.';
export const SIM_STATE_SCHEMA = 1;
/** 一块最多多少字节(解压后):20 万地块的世界约 5000 州,插件 64 栏按州的表每格存三份约 8 MB,留四倍 */
export const SIM_STATE_MAX_BYTES = 32 * 1000 * 1000;
export const simStatePart = (pluginId: string): string => `${SIM_STATE_PREFIX}${pluginId}`;

/**
 * 存进世界的插件图层:一个图层一块,块名 layer.<插件编号>.<图层编号>,need 是 extra,by 写这个插件的编号,schema 是 PLUGIN_LAYER_SCHEMA,
 * 内容是 packValue 打的 PluginLayerValue。网站认得、逐项核对(worldValidate.ts 的 validatePluginLayer)、由网站来画,不算只当字节留着的块。
 * 同一个文件里有 sim.<插件编号> 的是推演插件推出来的,跟着历史走:读的时候接回 Civ.simLayers,换了历史就整批换掉
 */
export const PLUGIN_LAYER_PREFIX = 'layer.';
/** 第 1 版已对外定下(docs/plugins/layer-format.md,样本测试守着):结构要变只能出新版本,第 1 版照旧读、照旧画 */
export const PLUGIN_LAYER_SCHEMA = 1;
/** 图层编号:块名最长 64,放下 layer.<最长 32 字的插件编号>. 还剩 25 个字 */
export const PLUGIN_LAYER_ID = /^[a-z0-9][a-z0-9-]{0,24}$/;
/** 一块最多多少字节(解压后) */
export const PLUGIN_LAYER_MAX_BYTES = 8 * 1000 * 1000;
/** 一个世界最多存几个插件图层 */
export const PLUGIN_LAYERS_MAX = 16;
export const pluginLayerPart = (pluginId: string, layerId: string): string => `${PLUGIN_LAYER_PREFIX}${pluginId}.${layerId}`;

/**
 * 工具插件交的图层编号(字母、数字、- 和 _,最长 32)存进世界时块名里写成什么:合 PLUGIN_LAYER_ID 的原样用,
 * 有大写、下划线或太长的换成 h + 编号的 8 位十六进制散列(FNV-1a)
 */
export function savedLayerId(layerId: string): string {
  if (PLUGIN_LAYER_ID.test(layerId)) return layerId;
  let h = 0x811c9dc5;
  for (let i = 0; i < layerId.length; i++) h = Math.imul(h ^ layerId.charCodeAt(i), 0x01000193) >>> 0;
  return `h${h.toString(16).padStart(8, '0')}`;
}

/** 块名 → [插件编号, 图层编号];不是合规矩的图层块名 = null */
export function pluginLayerOf(name: string): [string, string] | null {
  if (!name.startsWith(PLUGIN_LAYER_PREFIX)) return null;
  const rest = name.slice(PLUGIN_LAYER_PREFIX.length);
  const dot = rest.indexOf('.');
  const plugin = rest.slice(0, dot);
  const layer = rest.slice(dot + 1);
  return dot > 0 && plugin.length <= PLUGIN_ID_MAX && PLUGIN_ID.test(plugin) && PLUGIN_LAYER_ID.test(layer) ? [plugin, layer] : null;
}

/**
 * 插件图层那一块的内容。画第 y 年时用 years 里不晚于 y 的最后一份,比第一份早不画;
 * 颜色写成小写的 #rrggbb,标题、图例、分类的名字最长 40 字(和工具插件交的地块图层同一套,layerLook.ts 的 checkLayerLook)
 */
export interface PluginLayerValue {
  title: string;
  /** 一格是什么:cell 地图的地块,region 历史里的州(Civ.regions) */
  unit: 'cell' | 'region';
  /** 每一份是哪一年的(升序、不重复);不给 = 只有一份,哪一年都画它 */
  years?: number[];
  /** 份数 × 格数,第 k 份接在第 k − 1 份后面;NaN = 这一格不画 */
  values: Float32Array;
  /** 渐变(和 classes 给且只给一个):2–16 个颜色,从 min 到 max(不给 = 按数据的最小最大) */
  ramp?: { colors: string[]; min?: number; max?: number };
  /** 分类:值等于 value 的格子涂这种颜色,1–32 类 */
  classes?: { value: number; color: string; label: string }[];
  legend?: string;
  /** 0–1 */
  opacity?: number;
}

/**
 * 一个地图插件在世界里的那一串(World.mapPlugins 的一项,线程里的世界键、生成的缓存也按它认):
 * 「编号@文件指纹」,有滑条的后面接按名字排好的 [名字, 值] 串(滑条照清单补齐以后的)
 */
export function mapPluginKey(p: { id: string; sum: string; params?: Readonly<Record<string, number>> }): string {
  const params = Object.entries(p.params ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  return `${p.id}@${p.sum}${params.length ? JSON.stringify(params) : ''}`;
}

/** 用过的插件:世界里只记这些,绝不放插件的代码 */
export interface WorldPlugin {
  id: string;
  /** 第几版("1.2.0") */
  version: string;
  /** 插件文件的 SHA-256(十六进制) */
  sum: string;
  /** 它干什么用的(sim 换推演规则之类) */
  role: string;
  /** 插件叫什么(清单里的 name;没装这个插件的人看到的就是它),最长 40 字 */
  name?: string;
  /** 插件的参数(只有数据,大小有上限) */
  params?: Record<string, unknown>;
}

/** 第几次修订 */
export interface WorldRevision {
  n: number;
  /** 上一份 manifest.json 字节的 SHA-256;第一份没有 */
  parent?: string;
}

/** 清单 */
export interface WorldManifest {
  app: typeof WORLD_APP;
  kind: typeof WORLD_KIND;
  format: typeof WORLD_FORMAT;
  id: string;
  title?: string;
  made: WorldMade;
  readers: WorldReaders;
  parts: WorldPartInfo[];
  recipe: SaveFile;
  plugins: WorldPlugin[];
  revision: WorldRevision;
}

/** 这一版软件认得的块:路径照这个写;required = 一个世界必须有 */
export const KNOWN_PARTS: ReadonlyMap<string, { file: string; required: boolean; need: PartNeed }> = new Map([
  ['map', { file: 'parts/map.gz', required: true, need: 'view' }],
  ['eras', { file: 'parts/eras.gz', required: false, need: 'view' }],
  ['civ', { file: 'parts/civ.gz', required: true, need: 'view' }],
  ['chronicle', { file: 'parts/chronicle.gz', required: true, need: 'view' }],
  ['flags', { file: 'parts/flags.gz', required: true, need: 'view' }],
  ['author', { file: 'parts/author.gz', required: false, need: 'extra' }],
  ['thumb', { file: 'parts/thumb.jpg', required: false, need: 'extra' }],
  ['planet', { file: 'parts/planet.gz', required: false, need: 'extra' }],
]);

/**
 * planet 那一块:用地图插件长、改过地形的世界,推历史要照"没改地形的同一颗星球"的两样,存的时候(插件在手)算好,
 * 没装插件的人推历史用它,不用重长那颗星球。不给的那一样 = 没存
 */
export interface PlanetValue {
  /** 扩张节拍和城的人口折算(gen/civ 的 planetTempo;null = 那颗星球长不出文明) */
  tempo?: PlanetTempo | null;
  /** 山海湖岛照着沿用的地名:只对得上起它的那套设定(key) */
  names?: PlanetNames;
}

/** 作者内容里的一条 AI 正文(和浏览器里存的 AiNote 同样的字段) */
export interface AuthorNote {
  /** 功能内唯一的键 */
  key: string;
  /** 哪个功能写的:"史书""释名"…… */
  kind: string;
  /** 显示用的标题 */
  title: string;
  text: string;
  /** ISO 时间 */
  createdAt: string;
  provider: string;
  model: string;
}

/** author 这一块:作者的内容。作者的改名、标记、人物在清单的 recipe 里,这里放的是配方以外的正文 */
export interface AuthorContent {
  notes: AuthorNote[];
}

/**
 * 读世界文件的错分几种,调用方照这个告诉用的人不同的话:
 * - broken:文件坏了(或者被改过),这个文件打不开
 * - newer:文件比这一版软件新,**更新软件就能打开**,文件本身没问题
 * - readonly:文件是好的,但这一版软件没法把它转成现在的结构,只能只读提示,原件不动
 * - memory:这台设备内存不够,读不下这么大的世界。文件可能是好的,不能说成坏了(用的人会把它删掉)
 */
export type WorldFileErrorKind = 'broken' | 'newer' | 'readonly' | 'memory';

/** 读世界文件的错 */
export class WorldFileError extends Error {
  readonly kind: WorldFileErrorKind;
  constructor(kind: WorldFileErrorKind, message: string) {
    super(message);
    this.name = 'WorldFileError';
    this.kind = kind;
  }
}

/** 文件坏了:报错 */
export function broken(message: string): never {
  throw new WorldFileError('broken', message);
}

/** 比软件新:报错 */
export function newer(message: string): never {
  throw new WorldFileError('newer', message);
}

/**
 * 不管抛出来的是什么,都折成 WorldFileError:底下的解压、JSON、读包函数抛的普通错一律算文件坏了,
 * 只有开不出内存这一种(各家浏览器的说法:Array buffer allocation failed、Out of memory)算 memory。
 * 浏览器读不出文件的字节(NotReadableError)也算 memory:Chromium 内存不够时就报这个,文件被挪走了也报这个,都不能说文件坏了
 */
export function asWorldFileError(err: unknown): WorldFileError {
  if (err instanceof WorldFileError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const noRoom = (err instanceof RangeError && /alloc|memory/i.test(message)) || (err as { name?: unknown } | null)?.name === 'NotReadableError';
  return new WorldFileError(noRoom ? 'memory' : 'broken', message);
}
