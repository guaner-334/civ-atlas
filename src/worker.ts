/// <reference lib="webworker" />
/**
 * 后台线程:生成世界 + 文明骨架 + 铺像素 + 回放帧 + 带着干预重推文明,不卡界面。
 * 铺像素里最慢的沟和山脊分给几个帮手线程(gullyPool.ts;核多的电脑最多 3 个),和推文明同时算。
 * 主线程要生成新世界时如果本线程还在忙,会直接 terminate() 再开一个新的;
 * 回放帧、重推文明这些短活不打断,排在后面(消息按先后处理)。每个线程只需要把手头的活按顺序干完。
 * 例外是编辑地形时只换地形、不推历史的生成(skipCiv):主线程不关线程,这边生成时一段一段算、每隔一会儿让一下,
 * 后面排上了新的世界就半路放下(回音 aborted),记着的网格、板块、前一半、整图都留着给新的一笔用。
 *
 * 改地形(阶段 4):世界 = 参数 + 草图(sketch)+ 地形修改(terrain)。改了地形、画了草图就带着它们重新 generate(连同当时的干预一起推文明);
 * 回放帧、重推文明也带着它们,线程被重开过时按"参数 + 草图 + 地形修改"重新生成(同样的输入 = 同一个世界)。
 * 生成的前一半(网格、板块、侵蚀)记在 baseCache 里:只加了湖、河、气候笔、高度笔时跳过它,只算后一半(gen/world.ts 的 TerrainBase)。
 * 试推演(助手)和重推一样算,只是结果单独交回,主线程不换上它。
 * 推文明的头两步(宜居度、划州)只跟地形和文明种子有关,记在 civMemo 里:改干预、拓荒、地名风格……重推时不再重算。
 *
 * 地形大事(gen/civ/upheaval.ts):推文明时带着作者的地形大事(upheavals),每件大事以后的世界(原来的地形修改 + 前几件大事的修改)
 * 照样从头生成,记在线程里(同样的输入不再生成);推完把各段的世界交给主线程(eras:地图、地名、河按时间轴换段)。
 * 各段的主图太大,不整张交:交完文明以后在后台逐段铺整张主图、和上一段比,只交回变了的那一块(gen/rasterPatch.ts 的补丁,
 * 主线程有了的不再交);后台的活排在消息后面,有新消息先处理消息。
 * "会怎么样"预览(upPreview):照"那一年的地形 + 这几笔"生成一遍,和那一年的地形、州逐地块比(previewUpheaval)。
 *
 * 原件(gen/snapshot.ts):生成、重推完,在后台把这次的世界、各段世界、整段历史打成一份原件交回去(snapshot),
 * 主线程对得上建好的世界存着的存档才存进浏览器(ui/resultStore.ts),以后生成器升级了也有当时的结果可读。
 * 新建中的世界也打(点了「创建」不一定再重推,那时用的就是这一份);换世界的时候排着的作废。排在各段主图补丁后面;
 * 地图那一块按世界的键记着,只重推历史时不用再打一遍。
 * 原件打好以后接着打编年史、国旗,连同原件那几块的一份拷贝交回去(worldParts),主线程转给世界仓库(ui/worldStore.ts、worldVault.ts);这边出错只是这次没存进仓库,原件和世界照常。
 * 用的人要把页面里的世界存成文件、仓库又没跟上(写不下、还没打)时(packParts),排着队当场打一份同样的内容交回去,不存也不算线程的错(packed);推好的历史记着就不重推。
 *
 * 读存下的内容打开(load):「我的世界」里存过内容的世界不再生成,读世界仓库的修订(worldOpen.ts,没有、读不了时主线程退回读原件、按存档生成),
 * 编年史、国旗也用存的(读不出来、人物卡的性别改过就现算);
 * 铺像素的代码按世界记的版本取(gen/readers/),比现在旧的世界就是原来的样子。读到的世界钉在线程里(frozen),后面重推、接着推都用它。
 *
 * 逐年推演(gen/civ/play.ts):请求带着进度(play:推到哪年 + 命令串)的,推到那一年年初,命令接在干预后面;
 * 一步(turn)在那一刻下命令、接着推几年。上一步的结果记在线程里(held),下一步从它接着推,不从第 0 年重算。
 *
 * 再推 N 年(extend,gen/civ/extend.ts):在推完的世界上接着推到第 to 年,前面的历史一点不变。推好的历史记在线程里(held,
 * 和原件用同一份复制),从它接着推;推演那一步分段推,每段之间报进度(extendProgress)、先让新到的消息排进来:
 * 来了新的再推、重推、生成、读档、逐年推演的一步,或者叫停(extendStop),这次就不推了(extendStopped)。
 * 只把推演年数调大的重推(resim)也从记着的历史接着推。结果都和从第 0 年一口气推到那一年一样。
 *
 * 地图插件(请求带的 mapPlugins,按先后):生成、改地形、地形大事、回放形成过程、重长没改地形的星球都带着它们长;世界键带上它们(没用的和以前一样)。
 * 插件文件用到才装(mapPluginRun.ts,装好的记着);插件出错、这台没有世界记的那一版,这件活交 mapFailed,不当线程的错。
 * 改过地形的世界存进仓库时带上没改地形那颗星球的参照(planet 那一块),读进来推历史用存下的,这台没有插件也推得了。
 *
 * 照大纲推演(outline,gen/outline.ts):照常推、逐条查情节,没发生的硬改,每查完一条报进度(outlineProgress)、先让新到的消息排进来;
 * 来了新的推演请求或叫停(outlineStop)就不推了(outlineStopped),已经定下来的几条记着(outlineCache)。推完交整段历史和新的干预串(outlined),结果和带着这串干预从第 0 年推完一样。
 * 每一步的样子记在线程里(outlineCache),改了后面几条情节再推时,前面没改的不重算;换世界时放掉。
 */
import { generateWorld, generateWorldSteps, type BaseCache, type World, type WorldParams } from './gen/world';
import { dropGullyBuffers, rasterizeDeferred, rasterizeDeferredSteps, type Raster } from './gen/raster';
import { GullyPool } from './gullyPool';
import { buildHistoryFrames, type HistoryFrames } from './gen/history';
import { DEFAULT_CIV_PARAMS, civBase, civTransferables, planetNames, planetTempo, type Civ, type CivBase, type PlanetNames, type PlanetTempo, type Regions } from './gen/civ';
import { extendCiv } from './gen/civ/extend';
import { breakAt, growEngine } from './gen/civ/grow';
import { civOrStuck, continueOrStuck, type StuckOptions } from './gen/civ/stuck';
import { END_YEAR_DEFAULT, GENERATOR_VERSION, cleanEndAt, ownInterventions, type AuthorMark, type Intervention, type PlayState, type PlotReview, type TerrainOp, type Upheaval } from './gen/edits';
import { runOutline, type OutlineCache } from './gen/outline';
import type { AuthorCharacter } from './gen/characters';
import { sketchGrid, type SketchEdit } from './gen/sketch';
import { mergeUpheavals, previewUpheaval, type UpheavalPreview, type UpheavalStep } from './gen/civ/upheaval';
import { computeHabitat } from './gen/civ/habitat';
import { buildRegions, reshapeRegions } from './gen/civ/regions';
// 地形大事各段的州(画地图、预览用)按官方的那套数划:世界还不带自己的一套数
import { OFFICIAL_KNOBS } from './gen/civ/engine/knobs';
import { applyPatch, composeOnto, cutExact, diffRaster, exactDiff, exactDiffBefore, patchTransferables, type RasterPatch } from './gen/rasterPatch';
import { rasterizePatch, rasterizePatchSteps, type PatchJob, type PatchProgress, type RasterKeep } from './gen/rasterEdit';
import type { PixelBox } from './gen/pixelBox';
import { planGlyphs, type Plan } from './render/fantasy';
import { realisticPaintedTransferables, type RealisticPainted } from './render/realistic';
import type { SurfaceLook } from './render/surface';
import type { NameMix } from './gen/names';
import type { Frontier, Origins } from './gen/civ/frontier';
import type { Calamity } from './gen/civ/calamity';
import type { WorldTuning } from './gen/civ/tuning';
import { SNAPSHOT_FORMAT, makePart, readLocalPart, recipeKey, recipeText, recipeTuning, type Recipe, type Snapshot, type SnapshotPart } from './gen/snapshot';
import { playStop, playTicks, playTurn, type PlayContinue } from './gen/civ/play';
import { subSeed } from './gen/util';
import { chronicleOf, type ChroniclePart } from './chronicleParts';
import type { FlagBook } from './gen/civ/story/flags';
import type { ChronicleBlock } from './gen/civ/story/nameTokens';
import { splitCiv, type CivPart, type CivSplit } from './civParts';
import { eraWorlds as eraWorldsOf, keyOf, mapKeyOf, mapLayerParts, mapValue, namesOpt, playOpt, setupOpt, simKeyOf, upOpt, worldChronicle, worldFlags, yearsOpt } from './worldRun';
import type { WorldPartsOffer } from './worldVault';
import type { PlanetValue, WorldPlugin } from './gen/worldFormat';
import type { SimPluginFile } from './plugin/pluginWorld';
import type { DevTryResult } from './plugin/devTry';
import type { SimPluginsOn } from './simPluginRun';
import { MapPluginError, timedMapPlugins, type MapPlugin, type MapStage } from './gen/mapHooks';
import { mapPluginKey } from './gen/worldFormat';
import type { MapPluginFile } from './plugin/pluginWorld';
import { olderTerrainOf } from './gen/readers/older';
import type { TerrainReader } from './gen/readers/terrainReader';
import { FIRST_READERS, READER_VERSIONS, UnknownReaderError, type ReaderVersions } from './gen/readers/versions';
import type { OpenRefusal, StoredOpen } from './worldOpen';

/**
 * 一组参数 + 草图(没改地形的星球)的扩张节拍和城的人口折算(gen/civ 的 planetTempo;null = 长不出文明),key = 这颗星球在线程里的键。
 * 线程推文明后回报给主线程,主线程下次生成、重推时带回来:线程被重开过也不用多生成一遍没改过的地形
 */
export interface TempoNote {
  key: string;
  tempo: PlanetTempo | null;
}

/**
 * 地形大事以后的一段世界(按年份先后;第 k 段 = 套上前 k + 1 件大事以后的)。key = 这一段在线程里的键(主图补丁按它对上);
 * world 不带网格(和原来的世界是同一套,主线程接上自己那份)、不带回放快照
 */
export interface EraWorld {
  key: string;
  world: World;
}

/** 推文明的请求里共有的:地形修改、草图、干预、地形大事、主线程记着的扩张节拍 */
interface CivInput {
  params: WorldParams;
  terrain?: TerrainOp[];
  sketch?: SketchEdit;
  /** 地形大事(不给 = 没有) */
  upheavals?: Upheaval[];
  /** 整个世界的地名风格(gen/edits.ts 的 WorldEdits.nameMix;不给 = 自动) */
  names?: NameMix;
  /** 历史推到第几年(gen/edits.ts 的 endParamOf;年中停下存回的普通世界带小数,推到那一年的那一格;不给 = 3000) */
  endYear?: number;
  /** 拓荒(gen/edits.ts 的 WorldEdits.frontier;不给 = 默认) */
  frontier?: Frontier;
  /** 自己选的文明起源(gen/edits.ts 的 WorldEdits.origins;不给 = 自动) */
  origins?: Origins;
  /** 「天灾」(gen/edits.ts 的 WorldEdits.calamity;不给 = 平常) */
  calamity?: Calamity;
  /** 这个世界的规则里改过的规则项和换算版本(gen/edits.ts 的 WorldEdits.rules,gen/civ/ruleSet.ts 的 worldTuning;不给 = 官方规则):推演前照世界记的那一版换成一套旋钮 */
  tuning?: WorldTuning;
  /** 文明种子(gen/edits.ts 的 WorldEdits.civSeed;不给 = 地图种子) */
  civSeed?: number;
  /** 地图留着的世界:地图那一块的校验(gen/edits.ts 文件头"地图留着的世界"):地图只从存下的内容读,线程手上没有就不算(checkKept) */
  keptMap?: string;
  /** 逐年推演的进度(gen/edits.ts 的 WorldEdits.play;不给 = 没在逐年推演):推到进度那一刻,命令接在干预后面 */
  play?: PlayState;
  tempo?: TempoNote;
  /** 主线程已经有了的主图补丁("上一段的键>这一段的键");没给的才在后台铺 */
  have?: string[];
  /** 用户的改名(gen/edits.ts 的 WorldEdits.names;不给 = 没有):交回历史之前先交套上它的编年史(chronicle) */
  renames?: Record<string, string>;
  /** 作者的人物(gen/edits.ts 的 WorldEdits.characters):存进世界的编年史按人物卡的性别写 */
  characters?: readonly AuthorCharacter[];
  /** 推演插件(按出手的先后;不给 = 没有)。用到推演的活都带着推 */
  simPlugins?: SimPluginFile[];
  /** 地图插件(按出手的先后;不给 = 没有)。没带字节的:世界认得出,要长地图时长不出来(交 mapFailed) */
  mapPlugins?: MapPluginFile[];
}

/**
 * 编辑地形(新建世界时)按块重铺:keep = 这次铺好的整张主图留在线程里(下一笔接着按块重铺;不给 = 不留,留着的也扔掉);
 * from = 主线程地图上现在那张整图是哪个世界的(上一次 done 的 baseKey):线程留着的正是它,就只铺变了的那块、只交回那一块
 * (gen/rasterEdit.ts、gen/rasterPatch.ts 的 exactPatch),主线程贴到自己那张上,和整张交回来逐位相同
 */
interface PatchInput {
  keep?: boolean;
  from?: string;
}

/**
 * 读存下的世界打开(见 WorkerRequest 的 load):vault = 从世界仓库读这一份(worldOpen.ts);parts = 主线程读好的原件。
 * original = 这个世界这一版还没有原件:读完交一份回去(snapshot),主线程存上,旧的路还留着
 */
export type LoadRequest = { type: 'load'; id: number; scale: number; parts?: SnapshotPart[]; vault?: StoredOpen; original?: boolean; interventions?: Intervention[] } & CivInput;

export type WorkerRequest =
  /**
   * 生成世界。terrain = 地形修改(不给 = 没改);sketch = 草图(不给 = 没画);interventions = 推文明时带上的干预(改地形重新生成时用;不给 = 没有);
   * tempo = 主线程记着的扩张节拍(星球对不上就不用);skipCiv = 只生成地形、铺像素,不推文明(编辑地形时:交回的 done 不带历史,
   * 收起编辑地形以后用 civOnly 补推);mapFirst = 地图先交:整张铺好就交 map(沟壑本线程也领一段,不等推文明),
   * 历史推完再交 done(mapSent,不带地图)。推几千年的历史比生成地形、铺像素慢,新建世界时地图不用等它。
   * paint(mapFirst 时):写实画风这几种画法的整张像素层也在这边画好(帮手一起分带子画),随 map 一起交,主线程换上之前只要贴上
   */
  | ({ type: 'generate'; id: number; scale: number; interventions?: Intervention[]; skipCiv?: true; mapFirst?: true; paint?: SurfaceLook[] } & CivInput & PatchInput)
  /**
   * 补推上一次 skipCiv 生成的世界的文明:世界是线程手上那一个(线程被重开过就按参数重新生成),推法和 generate 里一模一样
   * (同样的输入 = 同一份历史、同样的地名)。nid = 第几次补推(主线程只认最新的)
   */
  | ({ type: 'civOnly'; id: number; nid: number; interventions?: Intervention[] } & CivInput)
  /** 回放帧。带上参数:线程被重开过、手里没有这个世界时,按参数重新生成(同参数 = 同世界) */
  | { type: 'history'; id: number; params: WorldParams; terrain?: TerrainOp[]; sketch?: SketchEdit; mapPlugins?: MapPluginFile[] }
  /**
   * 阶段 4 干预:只重推文明(世界已在线程里,不重新生成地形;线程被重开过就按参数重新生成)。
   * seq = 第几次重推(主线程只认最新的一次)
   */
  | ({ type: 'resim'; id: number; seq: number; interventions: Intervention[] } & CivInput)
  /** 试推演(助手用):和 resim 一样重推(同样带节拍),但只把结果交回去,主线程不换上它;tid = 第几次试推演 */
  | ({ type: 'trial'; id: number; tid: number; interventions: Intervention[] } & CivInput)
  /** 开发者模式试推(plugin/devTry.ts):带着 simPlugins 从第 0 年推 years 年,只交回量到的,不记、不换上;did = 第几次 */
  | ({ type: 'devTry'; id: number; did: number; interventions: Intervention[]; years: number } & CivInput)
  /**
   * 读存下的世界打开:不生成,读这个世界存着的内容(世界仓库的修订,或者原件,gen/snapshot.ts 的各块:地图、各段世界、整段历史),
   * 铺像素以后照 generate 一样交 done。铺像素的代码按世界记的版本取(gen/readers/)。
   * 参数、地形修改、草图、地形大事、干预是存档里的(对上存着的键、排出各段;原件的配方已经在主线程核对过,修订的在线程里核对)。读不了交 loadFailed
   */
  | LoadRequest
  /**
   * 线程被重开过(出错换了一个、叫停再推换了一个;见 src/ui/sim/simClient.ts):读存下的内容打开的那个世界(load 是当初打开它的请求)
   * 重新钉住 —— 地图、各段世界、历史那一块,和 load 一样,只是不铺像素、不交回什么。后面排着的活照它算。没有回音
   */
  | { type: 'pin'; id: number; load: LoadRequest }
  /**
   * 逐年推演的一步(gen/civ/play.ts 的 playTurn):在进度那一刻下 commands(只收正是这一刻的),接着推 years 年;
   * 给了 ticks 就按格走(playTicks:走 ticks 格,能停在年中),不看 years。
   * 线程里记着这份进度的结果就接着推;没有(线程被重开过、换了世界)就从第 0 年推到这一刻再接着推(结果一样,只是慢)
   */
  | ({ type: 'turn'; id: number; play: PlayState; commands: unknown[]; years: number; ticks?: number; interventions?: Intervention[] } & CivInput)
  /**
   * 再推 N 年:在推完的世界上接着推到第 to 年(gen/edits.ts 的 extendedEndYear 算;年中停下存回的世界带小数,停在 N 年以后的同一格;到 END_YEAR_MAX 为止),前面的历史一点不变。
   * 其余各项和推这个世界时一样(推演年数不带:线程记着推好的那份历史,从它接着推);逐年推演中的世界不用这个(用 turn)。
   * xid = 第几次再推(主线程只认最新的)。推的时候交 extendProgress;推完交 extended(随后照常排原件 snapshot,配方里的推演年数是 to);
   * 被顶掉、叫停交 extendStopped。线程里没有推好的历史(被重开过)就从第 0 年推(结果一样,只是慢、不分段)
   */
  | ({ type: 'extend'; id: number; xid: number; to: number; interventions?: Intervention[] } & Omit<CivInput, 'endYear' | 'play'>)
  /** 叫停再推:xid 和它以前的再推都不推了(在推的停下,排着的不推);没在推就什么也不做 */
  | { type: 'extendStop'; id: number; xid: number }
  /**
   * 照大纲推演(gen/outline.ts 的 runOutline):plots = 大纲的情节;interventions = 这个世界现在的干预(上一次照大纲硬改出来的那几条先去掉再重新算);
   * characters、marks = 作者的人物、标记(即位、一片地方要读);tries = 没自然发生的情节硬改前最多试几版顺着引(不给 = 不引)。
   * 其余各项和推这个世界时一样(逐年推演中的世界不用这个)。
   * oid = 第几次照大纲推演(主线程只认最新的)。推的时候每查完一条交 outlineProgress(试引法时 at.trial = 第几版 / 最多几版);推完交 outlined(随后照常排原件 snapshot,配方里的干预是新的那一串);
   * 被顶掉、叫停交 outlineStopped。上一次照大纲推演每一步的样子记在线程里:前面几条情节没改,就从第一条改了的那条接着算
   */
  | ({ type: 'outline'; id: number; oid: number; plots: unknown[]; interventions?: Intervention[]; characters?: AuthorCharacter[]; marks?: AuthorMark[]; tries?: number } & Omit<CivInput, 'play'>)
  /** 叫停照大纲推演:oid 和它以前的都不推了;没在推就什么也不做 */
  | { type: 'outlineStop'; id: number; oid: number }
  /**
   * 不再编辑地形了(新建的世界建好了,地形锁住):编辑地形时留着的整张主图和铺像素的输入放掉。没有回音
   * (主线程直接发,不算一件活)
   */
  | { type: 'release'; id: number }
  /**
   * 用户改了名(gen/edits.ts 的 WorldEdits.names;id = 这个世界的请求编号):不排队,收到就记下。之后交历史之前先交的编年史
   * 按它算(同一个世界的;比发请求时带的 renames 新),推的时候改了名,换上时就不用再算一遍。没有回音(主线程直接发,不算一件活)
   */
  | { type: 'renames'; id: number; names: Record<string, string> }
  /** 页面藏起来、要关了:逐年推演等着打的那份原件现在就打,不等停够 TURN_SNAPSHOT_IDLE。没有回音 */
  | { type: 'packNow'; id: number }
  /**
   * 冒烟检查、截图用(网址带 simFail):之后的推演推过第 year 年就故意出错,看推不下去时的样子;
   * 负数 = 生成世界、重推、再推、逐年推演、照大纲推演时线程直接出错(看线程没撑住时的样子);0 = 照常。不排队,没有回音
   */
  | { type: 'simFail'; id: number; year: number }
  /**
   * 把这份配方的世界打成存进仓库、存成文件用的几块,交回来(packed;fid = 第几次,主线程按它认)。
   * 排在手上的活后面,所以刚才的修改推完了才打。出错不算线程出错:一定有一声回音
   */
  | ({ type: 'packParts'; id: number; fid: number; interventions?: Intervention[] } & CivInput)
  /**
   * 编辑地形按块交回的那一笔(key = 它的 baseKey)主线程换上了:之后的笔照它比,线程不用再留着怎么改回上一张(见 KeptUndo)。
   * 不排队,没有回音(主线程直接发,不算一件活)
   */
  | { type: 'shown'; id: number; key: string }
  /** 地形大事的预览:upheavals = 已经有的大事,在 year 那一年再加上 ops 会怎么样;pid = 第几次预览(主线程只认最新的) */
  | { type: 'upPreview'; id: number; pid: number; params: WorldParams; terrain?: TerrainOp[]; sketch?: SketchEdit; upheavals?: Upheaval[]; civSeed?: number; year: number; ops: TerrainOp[]; mapPlugins?: MapPluginFile[] };

export type WorkerResponse =
  | { type: 'progress'; id: number; stage: string; pct: number }
  /** 下一条交历史的消息那份历史推不下去(停在 at 年):推演里抛的错,记进问题记录 */
  | { type: 'simError'; id: number; at: number; message: string; stack?: string }
  /**
   * 下一条交历史的消息(done、civ、civOnly、turn、extended)那份历史的编年史,按请求里的改名算,分块先交(src/chronicleParts.ts);
   * 交历史的那条带着同一个编号(chron)
   */
  | ({ type: 'chronicle'; id: number } & ChroniclePart)
  /** 这份编年史(编号 key)存进世界的那一块:名字是占位符,主线程改名时直接换名字(ui/chronicleHandoff.ts)。后台自己排的活,不算回音 */
  | { type: 'chronicleBlock'; id: number; key: number; part: SnapshotPart }
  /**
   * 下一条交历史的消息(done、civ、civOnly、turn、extended、trial)那份历史里条数多的几个列表,切成段先交(src/civParts.ts);
   * 交历史的那条带着同一个编号(split),那几个列表在它里面是空的,收齐拼回去才能用
   */
  | ({ type: 'civPart'; id: number } & CivPart)
  /**
   * ms = 线程里花的时间(生成 + 文明 + 铺像素),genMs = 其中生成世界那一步(reused = 前一半是接着上一次的,genMs 只是后一半),
   * rasterMs = 铺像素(推文明之前那一段,沟壑和细沟不算);civMs = 其中推文明那一步(再推的界面拿它估这台电脑推演要多久;读原件的没有);
   * tempo = 这组参数的扩张节拍(知道的话);eras = 地形大事以后的各段世界(没有大事 = 不给)。
   * 主图:raster = 整张;按块重铺的不带 raster,带 patch(比 from 那张整图变了的那一块,null = 一个像素也没变),见 PatchInput;
   * 按块重铺的另带手绘风的符号规划(plan,render/fantasy.ts 的 planGlyphs:主线程按块重画手绘地图要用,精细度高时要算一两百毫秒,在这里算);
   * 整张交的推了文明的(打开世界、新建)也带(等帮手算沟壑的工夫里算好):主线程换上之前备手绘地图、缩略图都要用。
   * civ = null:请求带了 skipCiv,没推文明。
   * mapSent:请求带了 mapFirst,世界和地图已经随 map 先交了,这条只交历史(不带 world、地图)。
   * mapSum:读世界仓库打开的:地图那一块的指纹
   */
  | ({ type: 'done'; id: number; civ: Civ | null; split?: CivSplit; chron?: number; flags?: FlagBook; ms: number; genMs: number; rasterMs: number; civMs?: number; reused?: true; tempo?: TempoNote; eras?: EraWorld[]; baseKey: string; mapSum?: string } & (
      | { world: World; raster: Raster; patch?: undefined; from?: undefined; plan?: Plan; mapSent?: undefined }
      | { world: World; raster?: undefined; patch: RasterPatch | null; from: string; plan: Plan; mapSent?: undefined }
      | { world?: undefined; raster?: undefined; patch?: undefined; from?: undefined; plan?: undefined; mapSent: true }
    ))
  /**
   * 请求带了 mapFirst 的生成:整张主图铺好了先交(还没推文明;历史随后的 done 交)。各项同 done;
   * painted = 请求的 paint 那几种画法画好的写实像素层(render/realistic.ts 的 takeRealisticPainted)。
   * 不算一件回音(随后的 done / aborted 才算)
   */
  | { type: 'map'; id: number; world: World; raster: Raster; plan?: Plan; painted?: RealisticPainted; genMs: number; rasterMs: number; reused?: true; eras?: EraWorld[]; baseKey: string }
  | ({ type: 'history'; id: number } & HistoryFrames)
  /** 重推好的文明;ms = 线程里花的时间(含按参数重新生成世界);tempo、eras 同 done */
  | { type: 'civ'; id: number; seq: number; civ: Civ; split?: CivSplit; chron?: number; ms: number; tempo?: TempoNote; eras?: EraWorld[]; baseKey: string }
  /** 补推好的文明(civOnly);ms 同 civ,civMs = 其中推文明那一步;tempo、eras 同 done */
  | { type: 'civOnly'; id: number; nid: number; civ: Civ; split?: CivSplit; chron?: number; ms: number; civMs: number; tempo?: TempoNote; eras?: EraWorld[]; baseKey: string }
  /** 逐年推演一步的结果:推到下一步年初的历史、新的进度(play)、没收下的命令(rejected);ms、tempo、eras 同 civ */
  | { type: 'turn'; id: number; civ: Civ; split?: CivSplit; chron?: number; play: PlayState; rejected: unknown[]; ms: number; tempo?: TempoNote; eras?: EraWorld[]; baseKey: string }
  /**
   * 再推的进度:推演已经推到第 year 年,整体进度 pct(0–1,只增不减)。开始时交一次(year = 推好的那年,pct = 0);
   * 推演那一步推完(year = to)以后还有推完以后的整理(起名、人物、道路……),pct 在那时停一会儿(3000→4000 年约停在 0.4)
   */
  | { type: 'extendProgress'; id: number; xid: number; year: number; pct: number }
  /** 再推好了:推到第 to 年的整段历史(civ.endYear = to);ms(线程里花的时间)、tempo、eras 同 civ */
  | { type: 'extended'; id: number; xid: number; civ: Civ; split?: CivSplit; chron?: number; to: number; ms: number; tempo?: TempoNote; eras?: EraWorld[]; baseKey: string }
  /** 这次再推没推完就停了(被新请求顶掉、被叫停):世界还是原来的样子 */
  | { type: 'extendStopped'; id: number; xid: number }
  /**
   * 照大纲推演的进度:查完了 done 条(一共 total 条),到现在的批改(按查的先后);
   * at = 正在查的那一条(情节编号)、fix = 它没自然发生,正在第几年硬改(还在查 = null)
   */
  | { type: 'outlineProgress'; id: number; oid: number; done: number; total: number; review: PlotReview[]; at?: { id: number; fix: number | null; trial?: { n: number; of: number } } }
  /**
   * 照大纲推演好了:整段历史、新的干预串(作者的干预 + 硬改出来的,带 plot)、每条情节的批改(按情节的先后);
   * ms(线程里花的时间)、tempo、eras 同 civ
   */
  | { type: 'outlined'; id: number; oid: number; civ: Civ; split?: CivSplit; chron?: number; interventions: Intervention[]; review: PlotReview[]; ms: number; tempo?: TempoNote; eras?: EraWorld[]; baseKey: string }
  /** 这次照大纲推演没推完就停了(被新请求顶掉、被叫停):世界还是原来的样子 */
  | { type: 'outlineStopped'; id: number; oid: number }
  /** 试推演的结果;tempo 同 done */
  | { type: 'trial'; id: number; tid: number; civ: Civ; split?: CivSplit; ms: number; tempo?: TempoNote }
  /** 开发者模式试推:推到哪了(0–1)、推完的结果(网站这头出的错 = error) */
  | { type: 'devTryProgress'; id: number; did: number; pct: number }
  | { type: 'devTry'; id: number; did: number; result?: DevTryResult; error?: string }
  /** 一段的主图补丁:key 这一段比 prev 那一段(原来的世界或上一件大事以后)变了的那一块;null = 看不出变化 */
  | { type: 'eraPatch'; id: number; key: string; prev: string; patch: RasterPatch | null }
  /** 地形大事的预览;water = 加上这几笔以后各地块的海陆(0 陆地 / 1 海 / 2 湖) */
  | { type: 'upPreview'; id: number; pid: number; preview: UpheavalPreview; water: Uint8Array; ms: number }
  /** 这次生成 / 重推的原件(后台打好的) */
  | { type: 'snapshot'; id: number; snapshot: Snapshot }
  /** 这次生成 / 重推的完整内容(后台打好的,存进世界仓库用) */
  | { type: 'worldParts'; id: number; offer: WorldPartsOffer }
  /** packParts 的回音;kind = memory:内存不够,东西没问题 */
  | ({ type: 'packed'; id: number; fid: number } & ({ ok: true; offer: WorldPartsOffer } | { ok: false; kind: 'memory' | 'failed'; message: string }))
  /** 存下的内容读不了(why,见 worldOpen.ts 的 OpenRefusal;recipe:只读打开要的修订的配方):主线程退回旧的路 */
  | { type: 'loadFailed'; id: number; why: OpenRefusal; recipe?: unknown }
  /** 这次生成没算完就不算了:后面已经排着新的世界(编辑地形连着涂,新的一笔顶掉上一笔)。只是一声回音,主线程不用管 */
  | { type: 'aborted'; id: number }
  /**
   * 这件活要长地图,地图插件长不下去(这一件的回音,地图上还是原来那份):plugin = 哪个插件,stage = 哪一口(装的时候、这台没有那一版 = null),why = 为什么
   */
  | { type: 'mapFailed'; id: number; plugin: string; stage: MapStage | null; why: string };

/** 上一个生成的世界(含回放快照),回放时直接用 */
let last: { key: string; world: World } | null = null;
/**
 * 编辑地形时留着的整张主图和它的输入(下一笔按块重铺,gen/rasterEdit.ts);key = 这张图是哪个世界的(同 baseKey)。
 * 只在请求带 keep 时留(新建世界、能编辑地形的时候),别的时候不占这份内存
 */
let kept: { key: string; keep: RasterKeep; undo?: KeptUndo } | null = null;
/**
 * 编辑地形按块交出去的那一笔怎么改回去(交出去以后留着,到主线程说换上了(shown)或者下一笔开始为止):主线程还没换上它就又涂了一笔时,
 * 新的一笔是照主线程地图上那张(key,上一笔之前的那张)比的 —— 把上一笔就地改的那块(before,改之前的原样)贴回 raster
 * (上一笔之前那张主图,数组和留着的这张共用;细沟是它自己的),输入变了的框(changed)记进 dirty,照样按块重铺、按块交。
 * 不留的话对不上,这一笔要整张铺、整张交,主线程整张重画
 */
interface KeptUndo {
  key: string;
  raster: Raster;
  before: RasterPatch | null;
  changed: PixelBox | null;
}
/** 整张铺的(变得多)也比一比:变的那块不到整张图的这么多,就只交那一块(主线程按块重画还是划算) */
const PATCH_SEND = 0.7;

/**
 * 主图各数组拷一份(整张交给主线程时数组 transfer 走了,线程里留的是这一份)。
 * into = 一张用不着了的同样大的主图(编辑地形时上一笔留着的那张,比完补丁就没用了):拷进它的数组里,不另开一整张
 * (和 r 共用的数组除外:r 的要交出去,只能另拷)
 */
function copyRaster(r: Raster, into?: Raster | null): Raster {
  const cp = <T extends Float32Array | Uint8Array | Int32Array>(a: T, b: T | undefined): T => {
    if (b && b !== a && b.constructor === a.constructor && b.length === a.length && b.buffer !== a.buffer && b.byteLength === b.buffer.byteLength) {
      b.set(a);
      return b;
    }
    return a.slice() as T;
  };
  const o = into && into.w === r.w && into.h === r.h ? into : null;
  return {
    ...r,
    elev: cp(r.elev, o?.elev),
    temp: cp(r.temp, o?.temp),
    precip: cp(r.precip, o?.precip),
    water: cp(r.water, o?.water),
    biome: cp(r.biome, o?.biome),
    cell: cp(r.cell, o?.cell),
    ice: cp(r.ice, o?.ice),
    iceConc: cp(r.iceConc, o?.iceConc),
    iceTone: cp(r.iceTone, o?.iceTone),
    wet: cp(r.wet, o?.wet),
    gully: r.gully && cp(r.gully, o?.gully),
    bank: r.bank && cp(r.bank, o?.bank),
    vein: r.vein && cp(r.vein, o?.vein),
    veinLines: r.veinLines && { off: r.veinLines.off.slice(), x: r.veinLines.x.slice(), y: r.veinLines.y.slice(), a: r.veinLines.a.slice() },
  };
}
/** 上一次生成的前一半(网格、板块、侵蚀;见 gen/world.ts 的 TerrainBase):编辑地形只改了湖、河、气候、高度时接着用 */
const baseCache: BaseCache = { base: null };

const post = (m: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(m, { transfer });

/** 交出去的历史切段编号到几了 */
let splitSeq = 0;
/** 整张主图交给主线程时 transfer 走的数组 */
function rasterTransferables(raster: Raster): ArrayBuffer[] {
  const vl = raster.veinLines!;
  return [raster.elev, raster.temp, raster.precip, raster.water, raster.biome, raster.cell, raster.ice, raster.iceConc, raster.iceTone, raster.wet, raster.gully!, raster.bank!, raster.vein!, vl.off, vl.x, vl.y, vl.a].map((a) => a.buffer as ArrayBuffer);
}

/**
 * 交历史的消息:历史里条数多的几个列表先切成段一条一条交(src/civParts.ts;主线程每段单独拆包,不在这一条上一口气拆整份),
 * 这一条带着编号、那几个列表是空的。短的历史不切,原样交
 */
function postCiv(m: Extract<WorkerResponse, { split?: CivSplit }>, transfer: Transferable[]) {
  if (m.civ?.stuck && simError !== null) {
    const e = simError as { message?: unknown; stack?: unknown } | null;
    post({ type: 'simError', id: m.id, at: m.civ.stuck.at, message: String(e?.message ?? e ?? ''), ...(typeof e?.stack === 'string' ? { stack: e.stack } : {}) });
  }
  simError = null;
  if (!m.civ) return post(m, transfer);
  const key = ++splitSeq;
  const { parts, civ } = splitCiv(m.civ, key);
  if (!parts.length) return post(m, transfer);
  for (const p of parts) post({ type: 'civPart', id: m.id, ...p });
  post({ ...m, civ, split: { key, parts: parts.length } } as WorkerResponse, transfer);
}

/** 交出去的编年史编号到几了 */
let chronSeq = 0;
/** 主线程最近一次告诉的改名(renames 消息) */
let renamesNow: { id: number; names: Record<string, string> } | null = null;
/**
 * 这份历史(交历史之前,数组还没 transfer 走)套上改名的编年史:分块先交给主线程(src/chronicleParts.ts),返回编号(交历史时带上)。
 * 长历史的编年史要算好一会儿,在这里算,主线程换上时不用再整段算。改名用主线程最近告诉的(同一个世界的),没有就用请求带的
 */
function chronicleNow(id: number, civ: Civ, m: ChronicleAsk, stored?: ChronicleBlock | null): number {
  const key = ++chronSeq;
  const names = renamesNow?.id === id ? renamesNow.names : (m.renames ?? {});
  const { block, parts } = chronicleOf(civ, names, key, m.characters, stored);
  // 算好的这一块留给随后打包的内容(queueSnapshot),不用再算一遍
  lastBlock = { key, block };
  for (const p of parts) post({ type: 'chronicle', id, ...p }, [p.build.buffer as ArrayBuffer]);
  return key;
}
/** 算编年史要的:改名、作者的人物 */
type ChronicleAsk = Pick<CivInput, 'renames' | 'characters'>;
/** 最近算好、还没打包的那一块和它的编号 */
let lastBlock: { key: number; block: ChronicleBlock } | null = null;
/** 让一下:这期间到了的消息排进来(推的时候改了名的,记下最新的改名) */
const tick = () => new Promise((r) => setTimeout(r, 0));
/** 同 chronicleNow,先让一下 */
async function postChronicle(id: number, civ: Civ, m: ChronicleAsk, stored?: ChronicleBlock | null): Promise<number> {
  await tick();
  return chronicleNow(id, civ, m, stored);
}
/**
 * 同 postChronicle:让一下以后,已经排着会换掉这份历史的请求(superseded)时,主线程不会换上它,
 * 编年史就不算了(返回 undefined),好早点去推新的那一次
 */
async function postChronicleUnlessSuperseded(id: number, civ: Civ, m: ChronicleAsk, superseded: () => boolean): Promise<number | undefined> {
  await tick();
  if (!superseded()) return chronicleNow(id, civ, m);
  lastBlock = null;
  return undefined;
}

// ---------------------------------------------------------------------------
// 地图插件

/** 装地图插件的那一份(请求带了插件文件才 import) */
let mapRun: typeof import('./mapPluginRun') | null = null;

/** 请求带的地图插件在世界键上的那一串(MapPlugin.key,按先后;没带 = 空) */
const mapKeys = (m: { mapPlugins?: readonly MapPluginFile[] }): string[] => m.mapPlugins?.map(mapPluginKey) ?? [];

/** 装插件的代码下载不了(下次带着插件再试) */
let mapRunFailed = false;

/** 装好请求带的、带了字节的地图插件(装过的不再装);装不上的要长地图时才报。没带字节的不再用记着的那一份 */
async function loadMapsFor(m: { mapPlugins?: readonly MapPluginFile[] }): Promise<void> {
  if (!m.mapPlugins?.length) return;
  if (!m.mapPlugins.some((f) => f.bytes)) return void mapRun?.loadMaps(m.mapPlugins, mapRun.quickjsMapBox);
  try {
    mapRun ??= await import('./mapPluginRun');
    mapRunFailed = false;
  } catch {
    mapRunFailed = true;
    return;
  }
  await mapRun.loadMaps(m.mapPlugins, mapRun.quickjsMapBox);
}

/** 世界是用地图插件长的,这台没有那一版(或者装不上):长不出同一张地图 */
class MapsMissing extends Error {
  constructor(
    readonly plugin: string,
    readonly why: string,
  ) {
    super(`地图插件「${plugin}」用不了:${why}`);
    this.name = 'MapsMissing';
  }
}

/** 装好的那一串(按先后);有用不了的抛错(装的时候出的错照原样抛) */
function mapPlugins(keys: readonly string[]): MapPlugin[] {
  const ps = mapRun?.mapPluginsOf(keys);
  if (ps) return ps;
  const k = keys.find((x) => !mapRun?.loadedMap(x)) ?? keys[0];
  const id = k.slice(0, k.indexOf('@'));
  const err = mapRun?.loadError(k);
  if (err) throw err;
  throw new MapsMissing(id, mapRunFailed ? '装插件的代码下载不了' : '这台设备没有世界记的那一版');
}

/** 长地图带的地图插件:每次生成另起一次计时;没用 = undefined */
const genMaps = (keys: readonly string[]): MapPlugin[] | undefined => (keys.length ? timedMapPlugins(mapPlugins(keys)) : undefined);

/** 起地名照着的那一份按哪套设定认(推文明时带的这几样要和这里一样) */
const refOpt = (m: CivInput) => ({ ...namesOpt(m.names), ...setupOpt(m), ...frozenOpt(m) });

/** 推文明时带的地图插件和存下的地名:存下的对不上这次的设定、这台又长不出没改地形的那颗星球,就抛错(交 mapFailed) */
function mapOpt(world: World, m: CivInput): { mapPlugins?: MapPlugin[]; planetNames?: PlanetNames } {
  const keys = world.mapPlugins;
  if (!keys?.length) return {};
  const kept = frozen?.planet?.value.names;
  const names = kept ? { planetNames: kept } : {};
  const ps = mapRun?.mapPluginsOf(keys);
  if (ps) return { mapPlugins: timedMapPlugins(ps), ...names };
  if (planetNames(world, { ...refOpt(m), ...names }, false) === null) mapPlugins(keys);
  return names;
}

/** 存进世界的星球参照(和 worldConvert.ts 存的一样):手里没有、插件也不在手的那一样这次不存 */
function planetOffer(world: World, m: CivInput): PlanetValue | null {
  const keys = world.mapPlugins;
  if (!keys?.length || !(world.terrain?.length || world.sketch)) return null;
  const ps = mapRun?.mapPluginsOf(keys);
  const kept = frozen?.planet?.value.names;
  const known = ps || tempos.has(keyOf(m.params, undefined, m.sketch, mapKeys(m))) || storedTempo(m.params, m.sketch, mapKeys(m)) !== undefined;
  let tempo: PlanetTempo | null | undefined;
  let names: PlanetNames | undefined;
  try {
    tempo = known ? tempoOf(m.params, m.terrain, m.sketch, m.civSeed, mapKeys(m)) : undefined;
    names = planetNames(world, { ...refOpt(m), ...(kept ? { planetNames: kept } : {}), ...(ps ? { mapPlugins: timedMapPlugins(ps) } : {}) }, !!ps) ?? undefined;
  } catch {
    names = undefined;
  }
  return tempo !== undefined || names ? { ...(tempo !== undefined ? { tempo } : {}), ...(names ? { names } : {}) } : null;
}

/** 地图插件长不下去的错:哪个插件、哪一口、为什么;别的错 = null */
function mapFailure(e: unknown): { plugin: string; stage: MapStage | null; why: string; dead: boolean } | null {
  if (e instanceof MapPluginError) return { plugin: e.plugin, stage: e.stage, why: e.why, dead: true };
  if (e instanceof MapsMissing) return { plugin: e.plugin, stage: null, why: e.why, dead: false };
  const x = e as { name?: unknown; plugin?: unknown; why?: unknown } | null;
  if (x && x.name === 'MapPluginLoadError' && typeof x.plugin === 'string') return { plugin: x.plugin, stage: null, why: String(x.why ?? ''), dead: false };
  return null;
}

/**
 * 存进世界仓库的地图插件那几样:清单里记的几条、插件出的图层(有地形大事的按年份一段一份)。
 * 线程不知道(读进来的世界、这台没有同一版)= null:仓库照上一份记的
 */
async function mapOffer(keys: readonly string[], world: World, steps: readonly Step[]): Promise<{ mapPlugins: WorldPlugin[]; layers: SnapshotPart[] } | null> {
  if (!keys.length) return world.mapPlugins?.length ? null : { mapPlugins: [], layers: [] };
  const got = keys.map((k) => mapRun?.loadedMap(k));
  if (got.some((l) => !l) || JSON.stringify(world.mapPlugins ?? []) !== JSON.stringify(keys)) return null;
  // 读进来的地图、各段不带图层:地形大事一件没变的照上一份;加了、改了、去掉了的,读进来的那几段按现在的版本再长一遍取图层
  // (旧版本算的、地图留着的长出来不是它,照上一份)
  const read = new Set<World>(frozen ? [frozen.world, ...frozen.eras.values()] : []);
  const same = !!frozen && steps.length === frozen.eras.size && steps.every((s) => read.has(s.world));
  if (read.has(world) && (same || frozen!.old || frozen!.kept)) return null;
  const again = (w: World, ops: readonly TerrainOp[] | undefined): World => (read.has(w) ? generateWorld(w.params, undefined, ops, w.sketch, undefined, genMaps(keys)) : w);
  const base = again(world, world.terrain);
  const eras = steps.map((s) => ({ year: s.year, world: again(s.world, s.all) }));
  const records = got.map((l) => l!.record);
  const layers: SnapshotPart[] = [];
  for (const p of mapLayerParts(got.map((l) => ({ id: l!.record.id, looks: l!.looks })), base, eras)) layers.push(await makePart(p.name, p.value));
  return { mapPlugins: records, layers };
}

/**
 * 各颗星球(参数 + 草图,没改地形)的扩张节拍和城的人口折算(gen/civ 的 planetTempo;null = 长不出文明):改过地形的世界推文明时要用。
 * 生成没改过地形的世界时顺手记下(线程不改 pace,civ.spreadYears 就是节拍、civ.capNorm 就是折算),新建时先看原样再改地形就不用多生成一遍
 */
const tempos = new Map<string, PlanetTempo | null>();
const TEMPO_KEEP = 32;
function rememberTempo(params: WorldParams, sketch: SketchEdit | undefined, maps: readonly string[], tempo: PlanetTempo | null) {
  const key = keyOf(params, undefined, sketch, maps);
  tempos.delete(key);
  tempos.set(key, tempo);
  if (tempos.size > TEMPO_KEEP) tempos.delete(tempos.keys().next().value!);
}
/** 主线程带回来的节拍:星球对得上才记 */
function takeTempo(params: WorldParams, sketch: SketchEdit | undefined, maps: readonly string[], note?: TempoNote) {
  if (note && note.key === keyOf(params, undefined, sketch, maps) && !tempos.has(note.key)) rememberTempo(params, sketch, maps, note.tempo);
}
/** 回报给主线程的节拍(手里没有 = 不给) */
function noteOf(params: WorldParams, sketch: SketchEdit | undefined, maps: readonly string[]): TempoNote | undefined {
  const key = keyOf(params, undefined, sketch, maps);
  const tempo = tempos.get(key);
  return tempo === undefined ? undefined : { key, tempo };
}
/**
 * 推文明时带的节拍:没改地形 = 不用(按世界自己标定);改过 = 这颗星球(参数 + 草图 + 地图插件)的节拍,手里没有就现算。
 * 给了文明种子的(一张地图上新开的历史)按地图本身标定,也不用
 */
function tempoOf(params: WorldParams, terrain: TerrainOp[] | undefined, sketch: SketchEdit | undefined, civSeed: number | undefined, maps: readonly string[]): PlanetTempo | null | undefined {
  if (!terrain?.length || civSeed !== undefined) return undefined;
  const stored = storedTempo(params, sketch, maps);
  if (stored !== undefined) return stored;
  const key = keyOf(params, undefined, sketch, maps);
  if (!tempos.has(key)) rememberTempo(params, sketch, maps, planetTempo(params, undefined, sketchGrid(sketch), genMaps(maps)) ?? null);
  return tempos.get(key);
}

/** 读进来的世界存着的这颗星球的节拍(没存、不是这颗星球 = undefined):存着的就用它,装没装地图插件推出来都一样 */
function storedTempo(params: WorldParams, sketch: SketchEdit | undefined, maps: readonly string[]): PlanetTempo | null | undefined {
  const p = frozen?.planet;
  return p && p.key === keyOf(params, undefined, sketch, maps) ? p.value.tempo : undefined;
}

/**
 * 读存下的内容打开的世界(load):地图和各段世界按键钉住,不丢、不重新生成。old = 是更旧的版本算的(照原样打开的旧世界):
 * 重新生成用的是现在的生成器,和它不一样;不是 old 的,重新生成也是它,钉住只是省得算。
 * 换世界(generate、下一次 load)时换掉。
 * kept = 地图留着的世界(gen/edits.ts 文件头"地图留着的世界";old 也算,按种子长的不是它):地图那一块的字节、结构版本、世界记的读取版本,重推以后存进仓库的还是这一块
 */
interface KeptPin {
  part: SnapshotPart;
  schema: number;
  readers: ReaderVersions;
}
/** 世界存着的星球参照(planet 那一块);key = 那颗星球(参数 + 草图 + 地图插件)在线程里的键 */
interface PlanetPin {
  key: string;
  value: PlanetValue;
}
let frozen: { key: string; world: World; eras: Map<string, World>; old: boolean; kept?: KeptPin; planet?: PlanetPin } | null = null;
/** 这个键的世界是照原样打开的旧世界 */
const frozenOld = (key: string) => !!frozen && frozen.old && frozen.key === key;
/** 铺整张主图、比主图的几样:当前版本就是上面 import 的 */
const NOW_TERRAIN = { rasterizeDeferred, composeOnto, diffRaster };
/** 这个世界用哪一版:读存下的内容打开的世界按它记的版本(gen/readers/),别的是当前版本 */
let terrain = NOW_TERRAIN;

/** 这组参数(+ 草图 + 地形修改 + 地图插件)的世界:手里有就用,没有(线程被重开过)就重新生成(同样的输入 = 同一个世界) */
function worldOf(params: WorldParams, terrain: TerrainOp[] | undefined, sketch: SketchEdit | undefined, maps: readonly string[]): World {
  const key = keyOf(params, terrain, sketch, maps);
  if (frozen?.key === key) return frozen.world;
  if (!last || last.key !== key) {
    // 换下来的世界的推文明底子一起放掉(不拉住旧世界)
    if (civMemo && civMemo.world === last?.world) civMemo = null;
    last = { key, world: generateWorld(params, undefined, terrain, sketchGrid(sketch), baseCache, genMaps(maps)) };
  }
  return last.world;
}

/**
 * 推文明的底子(宜居度和州,gen/civ 的 civBase):只跟地形和文明种子有关,改干预、拓荒、起源、地名风格、推演年数重推时直接用。
 * 只留一份(手上这个世界、这个文明种子的):生成(新世界、编辑地形涂一笔)、读档一开始就放掉,换了世界、换了文明种子就重算、换掉。
 * 按世界对象认(重新生成的世界是另一个对象,不会用错);generateCiv 用的是复制的一份,留着的这份不随结果交出去
 */
let civMemo: CivBase | null = null;
/** 这个世界、这个文明种子的底子:留着的对得上就用,对不上就现算(一定要从第 0 年推的时候用) */
function baseOf(world: World, civSeed: number | undefined): CivBase {
  if (civMemo?.world === world && civMemo.seed === (civSeed ?? world.params.seed)) return civMemo;
  // 先放掉旧的,算新的时候不同时占着两份
  civMemo = null;
  return (civMemo = civBase(world, civSeed === undefined ? {} : { civSeed }));
}
/** 留着的、对得上的底子(没有 = 不带):接着推的时候多半用不上,不为它现算 */
const memoOpt = (world: World, civSeed: number | undefined) => (civMemo?.world === world && civMemo.seed === (civSeed ?? world.params.seed) ? { base: civMemo } : {});

/**
 * 回放世界形成用的世界(带形成过程的快照)。照原样打开的世界原件里没存形成过程:现在的生成器生成出来的地形和原件一模一样,
 * 就用它的形成过程;不一样(生成器改了地形)就只放原件里现在的样子这一帧,不拿别的星球的形成过程顶替
 */
function formationOf(params: WorldParams, terrain: TerrainOp[] | undefined, sketch: SketchEdit | undefined, maps: readonly string[]): World {
  const key = keyOf(params, terrain, sketch, maps);
  if (frozen?.key !== key) return worldOf(params, terrain, sketch, maps);
  const now = frozen.world;
  // 这台没有长它的地图插件:只放现在这一帧
  if (maps.length && !mapRun?.mapPluginsOf(maps)) return { ...now, history: [now.elevation] };
  const fresh = generateWorld(params, undefined, terrain, sketchGrid(sketch), undefined, genMaps(maps));
  const a = fresh.elevation;
  const b = now.elevation;
  const same = a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return same ? fresh : { ...now, history: [now.elevation] };
}

// ---------------------------------------------------------------------------
// 地形大事:各段的世界、州(同样的输入不再算)

/** 地形大事以后的世界、预览生成的世界(不带回放快照);最多记 WORLD_KEEP 个,先丢最久没用的 */
const WORLD_KEEP = 8;
const worlds = new Map<string, World>();
function cachedWorld(params: WorldParams, ops: readonly TerrainOp[], sketch: SketchEdit | undefined, maps: readonly string[]): { key: string; world: World } {
  const key = keyOf(params, ops, sketch, maps);
  const pinned = frozen?.eras.get(key);
  if (pinned) return { key, world: pinned };
  // 地图留着的世界只有存下的那几段,新的地形长不出来(按种子长的是另一颗星球)
  if (frozen?.kept) throw new Error('地图留着的世界没有这一段地形');
  let w = worlds.get(key);
  if (w) worlds.delete(key);
  else {
    w = generateWorld(params, undefined, ops, sketchGrid(sketch), undefined, genMaps(maps));
    w.history = [];
  }
  worlds.set(key, w);
  if (worlds.size > WORLD_KEEP) worlds.delete(worlds.keys().next().value!);
  return { key, world: w };
}

/** 推演里的一步,外加它在线程里的键、套上它以后的全部地形修改 */
type Step = UpheavalStep & { key: string; all: TerrainOp[] };

/** 作者的地形大事 → 推演用的几步(gen/civ/upheaval.ts 的 upheavalSteps,世界按键记着) */
function stepsOf(params: WorldParams, terrain: readonly TerrainOp[] | undefined, sketch: SketchEdit | undefined, list: readonly Upheaval[] | undefined, maps: readonly string[], onStep?: (k: number, n: number) => void): Step[] {
  if (!list?.length) return [];
  const merged = mergeUpheavals(list);
  let all: TerrainOp[] = [...(terrain ?? [])];
  return merged.map((m, k) => {
    onStep?.(k, merged.length);
    all = [...all, ...m.ops];
    const { key, world } = cachedWorld(params, all, sketch, maps);
    return { ...m, key, all, world };
  });
}

/** 推这个世界用的输入(推演年数、逐年推演的进度除外) */
type CivRecipe = Omit<CivInput, 'endYear' | 'play'> & { interventions?: Intervention[] };

/**
 * 上一次推好的历史和它的配方(不算推演年数):逐年推演的下一步、再推 N 年、只调大推演年数的重推,配方对得上就从它接着推
 * (gen/civ/index.ts 的 continueCiv,不改传进去的历史;结果和从第 0 年推一样)。civ = 交给主线程之前复制的那一份
 * (交出去的数组 transfer 走了),原件也用这一份打;照原样打开的旧世界先只记原件里历史那一块(part),要接着推时才读出来。
 * 照原样打开的旧世界另记(键前加 frozen:,地形和按现在的版本生成的不一样)
 */
let held: { key: string; civ?: Civ; part?: SnapshotPart; fromPart?: (value: unknown) => Civ; plugins?: WorldPlugin[] } | null = null;
/** 上一次照大纲推演每一步的样子(gen/outline.ts 的 OutlineCache):改了几条情节再推时,前面没改的直接用 */
let outlineCache: OutlineCache | null = null;
function heldKey(m: CivRecipe, play: PlayState | undefined): string {
  const r: Recipe = { params: m.params, terrain: m.terrain, sketch: m.sketch, interventions: m.interventions, upheavals: m.upheavals, names: m.names, frontier: m.frontier, origins: m.origins, calamity: m.calamity, ...recipeTuning(m.tuning), civSeed: m.civSeed, keptMap: m.keptMap, play };
  return `${frozenOld(keyOf(m.params, m.terrain, m.sketch, mapKeys(m))) ? 'frozen:' : ''}${recipeText(r)}${simKeyOf(m.simPlugins)}${mapKeyOf(mapKeys(m))}`;
}
/** 推好了一份历史(复制的那一份,交给主线程之前调用;没复制成 = null):记下来。plugins = 世界清单里记推这份历史的推演插件的那几条 */
function keepCiv(m: CivRecipe, play: PlayState | undefined, civ: Civ | null, plugins?: WorldPlugin[]) {
  held = civ ? { key: heldKey(m, play), civ, ...(plugins ? { plugins } : {}) } : null;
}
/** 记着的、配方对得上的推好的历史(没有、对不上、原件读不出来 = null) */
async function heldCiv(m: CivRecipe, play: PlayState | undefined): Promise<Civ | null> {
  const h = held;
  if (!h || h.key !== heldKey(m, play)) return null;
  if (h.civ) return h.civ;
  try {
    const value = await readLocalPart(h.part!);
    const civ = h.fromPart ? h.fromPart(value) : (value as Civ);
    if (held === h) held = { key: h.key, civ, ...(h.plugins ? { plugins: h.plugins } : {}) };
    return civ;
  } catch {
    if (held === h) held = null;
    return null;
  }
}

/**
 * 照原样打开的旧世界(frozen)重推时:山海湖岛的地名不照"没改过地形的星球"起 —— 按现在的版本生成的那一颗不一定是它原来的
 * (gen/civ 的 CivParams.placeRef)
 */
const frozenOpt = (m: Pick<CivInput, 'params' | 'terrain' | 'sketch' | 'mapPlugins'>) => (frozenOld(keyOf(m.params, m.terrain, m.sketch, mapKeys(m))) ? { placeRef: false as const } : {});

/**
 * 生成世界时推这个世界的文明(generate 和补推的 civOnly 共用这一份,同样的输入 = 同一份历史)。
 * 没改过地形、没调民族扩散、没另起文明种子的,顺手记下这颗星球的扩张节拍(见 tempos)
 */
function civOf(world: World, m: CivInput & { interventions?: Intervention[] }, steps: Step[], sims: SimPluginsOn | null): Civ {
  const maps = mapKeys(m);
  const c = civOrStuck(world, { interventions: m.interventions?.length ? m.interventions : undefined, tempo: tempoOf(m.params, m.terrain, m.sketch, m.civSeed, maps), ...upOpt(steps), ...namesOpt(m.names), ...yearsOpt(m.endYear), ...setupOpt(m), ...simOpt(sims), ...mapOpt(world, m), ...playOpt(m), base: baseOf(world, m.civSeed) }, stuckOpt(m.play));
  // 调了民族扩散的,civ.spreadYears 不是节拍(÷ 了倍数);另起文明种子的,州和民族不是这颗星球原来的那一份:都不记
  if (!m.terrain?.length && !m.frontier?.spread && m.civSeed === undefined) rememberTempo(m.params, m.sketch, maps, c.spreadYears !== undefined && c.capNorm !== undefined ? { spread: c.spreadYears, capNorm: c.capNorm } : null);
  return c;
}

/** 这件活装好的推演插件:推完放掉;半路不推了没放的,下一件活装之前放掉 */
let simsLive: SimPluginsOn | null = null;
function dropSims() {
  simsLive?.dispose();
  simsLive = null;
}
/** 装好请求带的推演插件(没带 = null) */
async function simsFor(m: Pick<CivInput, 'simPlugins' | 'params' | 'civSeed'>): Promise<SimPluginsOn | null> {
  dropSims();
  if (!m.simPlugins?.length) return null;
  const { simPluginsOn, quickjsBox } = await import('./simPluginRun');
  return (simsLive = await simPluginsOn(m.simPlugins, m.civSeed ?? m.params.seed, quickjsBox));
}
/** 推文明时带的推演插件 */
const simOpt = (s: SimPluginsOn | null) => (s ? { plugins: s.plugins } : {});
/** 世界清单里记推这份历史的推演插件的那几条(没带 = 空) */
const simRecords = (s: SimPluginsOn | null): WorldPlugin[] => s?.records ?? [];

/** 各段的世界交给主线程 */
const eraWorlds = (steps: Step[]): EraWorld[] | undefined => eraWorldsOf(steps);

/** 州的划分(按一路过来的几段世界的键记着:大事以后的沿用上一段的(reshapeRegions),同样的地形分几步走到的划分不一样) */
const REGION_KEEP = 8;
const regionsMemo = new Map<string, Regions>();
const REGION_AREA = DEFAULT_CIV_PARAMS.regionArea;
function remember(key: string, r: Regions): Regions {
  regionsMemo.delete(key);
  regionsMemo.set(key, r);
  if (regionsMemo.size > REGION_KEEP) regionsMemo.delete(regionsMemo.keys().next().value!);
  return r;
}
/** 第 year 年的地形和州(upheavalBase:同一年已有的大事地形算在内、州不算),和那时的全部地形修改 */
function baseAt(params: WorldParams, terrain: TerrainOp[] | undefined, sketch: SketchEdit | undefined, steps: Step[], year: number, seed: number, maps: readonly string[]): { world: World; regions: Regions; ops: TerrainOp[] } {
  // 照原样读进来的旧世界和现在的版本生成的同一个世界键一样、地形不一样:州分开记;同一张地图上的几段历史州也不一样(文明种子)
  const k0 = `${frozenOld(keyOf(params, terrain, sketch, maps)) ? 'frozen:' : ''}${seed === params.seed ? '' : `civ${seed}:`}${keyOf(params, terrain, sketch, maps)}`;
  let w = worldOf(params, terrain, sketch, maps);
  let r = regionsMemo.get(k0) ?? remember(k0, buildRegions(w, computeHabitat(w), { regionArea: REGION_AREA, seed, knobs: OFFICIAL_KNOBS }));
  let ops: TerrainOp[] = [...(terrain ?? [])];
  let chain = k0;
  for (const s of steps) {
    if (s.year > year) break;
    w = s.world;
    ops = s.all;
    if (s.year === year) break;
    const prev = r;
    chain = `${chain}>${s.key}`;
    r = regionsMemo.get(chain) ?? remember(chain, reshapeRegions(w, computeHabitat(w), prev, { regionArea: REGION_AREA, seed, knobs: OFFICIAL_KNOBS }));
  }
  return { world: w, regions: r, ops };
}

// ---------------------------------------------------------------------------
// 各段的主图补丁(后台慢慢铺)

/**
 * 最近两段"主线程拼好的"主图(原来的主图按先后贴上各段补丁,和 ui/eras.ts 的 eraData 拼出来的一样),
 * 按一路过来的几段世界的键记着(第 0 段 = 原来的主图,键就是它的世界键)。下一段的补丁和它比、不和上一段真正的主图比:
 * 框外看不出来的小差别主线程沿用上一段,一段段各自和真图比的话,几件大事的小差别会攒成看得出来的(gen/rasterPatch.ts 文件头)
 */
const rasters = new Map<string, Raster>();
function keepRaster(chain: string, r: Raster): Raster {
  rasters.delete(chain);
  rasters.set(chain, r);
  while (rasters.size > 2) rasters.delete(rasters.keys().next().value!);
  return r;
}

/** 铺一张整图 */
async function rasterOf(world: World): Promise<Raster> {
  await pool.up;
  pool.prepare(world);
  const d = terrain.rasterizeDeferred(world, 1);
  await pool.finish(d);
  return d.raster;
}

/** 长字符串的短指纹(两个 32 位散列拼起来):世界键带着草图可能很长,一路过来的键、补丁的键记着只为认"是不是同一个" */
const digest = (s: string) => `${subSeed(1, s).toString(36)}.${subSeed(2, s).toString(36)}`;

/** 一路过来的一段:键(第 0 段 = 原来的世界键,往后每段 = 前一段的键接上这一段的世界键取指纹)、世界 */
interface Link {
  chain: string;
  world: () => World;
}

/** 第 i 段拼好的主图:记着就用;没记着就铺出那一段,和第 i - 1 段拼好的比出补丁、贴上 */
async function shownAt(links: readonly Link[], i: number): Promise<Raster> {
  const { chain } = links[i];
  const hit = rasters.get(chain);
  if (hit) return keepRaster(chain, hit);
  if (!i) return keepRaster(chain, await rasterOf(links[0].world()));
  const a = await shownAt(links, i - 1);
  const b = await rasterOf(links[i].world());
  return keepRaster(chain, terrain.composeOnto(a, b, terrain.diffRaster(a, b)));
}

/**
 * 交出去的补丁是照哪一路拼的(补丁的键的指纹 → 一路过来的键)。补丁的键只有前后两段的世界键,同样两段、前面几段分法不同
 * (同一年的两件大事改成先后两年……)拼出来的上一段不一样,补丁也不一样:主线程留着的不是这一路的,照样重交
 */
const posted = new Map<string, string>();
const POSTED_KEEP = 64;

/** 推完文明:主线程手里没有的各段补丁排进后台(之前排着、现在用不上的作废) */
function queuePatches(id: number, m: CivInput, steps: Step[]) {
  bg.length = 0;
  const have = new Set(m.have ?? []);
  const maps = mapKeys(m);
  const baseKey = keyOf(m.params, m.terrain, m.sketch, maps);
  const links: Link[] = [{ chain: baseKey, world: () => worldOf(m.params, m.terrain, m.sketch, maps) }];
  for (const s of steps) links.push({ chain: digest(`${links[links.length - 1].chain}>${s.key}`), world: () => s.world });
  const prevOf = (i: number) => (i ? steps[i - 1].key : baseKey);
  const pairs = steps.map((s, i) => `${prevOf(i)}>${s.key}`);
  // 主线程手里有没有以它说的为准(它会丢掉用不着的旧补丁,丢了的再要就重新铺)
  const want = pairs.map((pair, i) => !(have.has(pair) && posted.get(digest(pair)) === links[i + 1].chain));
  // 缺的那几段以前的各段也得拼出来(拼好的才能比);一段一件活,做完一件先看有没有新消息
  const last = want.lastIndexOf(true);
  for (let i = 0; i <= last; i++) {
    const s = steps[i];
    const chain = links[i + 1].chain;
    bg.push(async () => {
      if (!want[i]) return void (await shownAt(links, i + 1));
      const a = await shownAt(links, i);
      // 这一段拼好的还记着:和它比跟和真图比出来的补丁一样(框外它就是 a,框里它就是真图),不用再铺
      const hit = rasters.get(chain);
      const b = hit ?? (await rasterOf(s.world));
      const patch = terrain.diffRaster(a, b);
      keepRaster(chain, hit ?? terrain.composeOnto(a, b, patch));
      const pair = digest(pairs[i]);
      posted.delete(pair);
      posted.set(pair, chain);
      while (posted.size > POSTED_KEEP) posted.delete(posted.keys().next().value!);
      post({ type: 'eraPatch', id, key: s.key, prev: prevOf(i), patch }, patch ? patchTransferables(patch) : []);
    });
  }
}

// ---------------------------------------------------------------------------
// 原件(后台打)

/** 原件的地图那一块,按世界的键记着最近两个(只重推历史时不用再打一遍) */
const mapParts = new Map<string, Promise<SnapshotPart>>();
function mapPart(key: string, world: World): Promise<SnapshotPart> {
  let p = mapParts.get(key);
  if (p) mapParts.delete(key);
  else {
    // 形成过程的回放快照太大,不进原件
    p = makePart('map', mapValue(world));
    // 打坏了的不留着(下次再打)
    p.catch(() => mapParts.delete(key));
  }
  mapParts.set(key, p);
  while (mapParts.size > 2) mapParts.delete(mapParts.keys().next().value!);
  return p;
}

/** 交给主线程之前复制一份历史给原件用;浏览器复制不了就不做这次的原件(世界照常交回去) */
function cloneCiv(civ: Civ): Civ | null {
  try {
    return structuredClone(civ);
  } catch {
    return null;
  }
}

/**
 * 推完的这次排一份原件:配方指纹(这次用到的全部输入)+ 地图 + 各段世界 + 整段历史。
 * civ 要在交给主线程(transfer 以后这边的数组就空了)之前复制一份传进来;没复制成(null)就不排。
 * plugins = 世界清单里记推这份历史的推演插件的那几条(不给 = 线程不知道,仓库照上一份记的)
 */
function queueSnapshot(id: number, m: CivInput & { interventions?: Intervention[] }, world: World, steps: Step[], civ: Civ | null, plugins?: WorldPlugin[]) {
  const chron = lastBlock;
  lastBlock = null;
  if (!civ) return;
  const maps = mapKeys(m);
  const baseKey = keyOf(m.params, m.terrain, m.sketch, maps);
  const pin = m.keptMap && frozen?.key === baseKey ? frozen.kept : undefined;
  // 用了地图插件的世界不打原件:原件是旧的路,旧的路按种子重新长的是没有插件的那一颗
  const original = !pin && !maps.length && !world.mapPlugins?.length;
  const planet = planetOffer(world, m);
  bg.push(async () => {
    let snapshot: Snapshot;
    let eras: SnapshotPart;
    let civPart: SnapshotPart;
    let mapsIn: Awaited<ReturnType<typeof mapOffer>>;
    let planetPart: SnapshotPart[];
    try {
      const recipe = await recipeKey({ params: m.params, terrain: m.terrain, sketch: m.sketch, interventions: m.interventions, upheavals: m.upheavals, names: m.names, endYear: m.endYear, frontier: m.frontier, origins: m.origins, calamity: m.calamity, ...recipeTuning(m.tuning), civSeed: m.civSeed, keptMap: m.keptMap, play: m.play });
      // 地图留着的世界:地图那一块就是存下的字节,不重打(配方里记着它的校验)
      const map = pin ? pin.part : await mapPart(baseKey, world);
      eras = await makePart('eras', { baseKey, eras: eraWorlds(steps) ?? [] });
      civPart = await makePart('civ', civ);
      snapshot = { format: SNAPSHOT_FORMAT, generator: GENERATOR_VERSION, recipe, formation: false, parts: [map, eras, civPart] };
      mapsIn = await mapOffer(maps, world, steps);
      planetPart = planet ? [await makePart('planet', planet)] : [];
    } catch {
      // 打不了(不是 https 的网页算不了校验之类):这次就没有原件,世界照常用
      return;
    }
    // 世界仓库要的再复制一份:原件的字节交出去就没了;两边不共用,这边出了什么事碍不着原件。复制不了(内存不够)就这次不存进仓库
    let kept: SnapshotPart[] | null = null;
    try {
      kept = [snapshot.parts[0], ...(steps.length ? [eras] : []), civPart].map((p) => ({ ...p, data: p.data.slice(0) }));
    } catch {
      kept = null;
    }
    // 地图那一块还记着(下次重推用),不交出去,复制一份。地图留着的世界不打原件:只存进仓库(原件是旧的路,旧的路会按种子重新长)
    if (original) post({ type: 'snapshot', id, snapshot }, [eras.data, civPart.data]);
    if (kept) queueWorldParts(id, { generator: snapshot.generator, recipe: snapshot.recipe, parts: [...kept, ...(mapsIn?.layers ?? []), ...planetPart], ...(pin ? { readers: { terrain: pin.readers.terrain, query: READER_VERSIONS.query }, schemas: { map: pin.schema } } : {}), ...(plugins ? { plugins } : {}), ...(mapsIn ? { mapPlugins: mapsIn.mapPlugins } : {}) }, world, civ, chron, m.characters);
  });
}

/**
 * 原件打好以后,接着打世界内容里剩下的两块(编年史、国旗),连同原件那几块一起交给主线程存进世界仓库(worldVault.ts)。
 * 单独一件后台的活:换了世界、又推了一次就作废,不耽误新来的消息。这里出错只是这次没存进仓库,世界照常用,不当线程的错
 */
function queueWorldParts(id: number, offer: WorldPartsOffer, world: World, civ: Civ, chron: typeof lastBlock, characters: readonly AuthorCharacter[] | undefined) {
  bg.push(async () => {
    try {
      const chronicle = await makePart('chronicle', chron?.block ?? worldChronicle(civ, characters));
      if (chron) postBlock(id, chron.key, chronicle);
      const flags = await makePart('flags', worldFlags(world, civ));
      const parts = [...offer.parts, chronicle, flags];
      post({ type: 'worldParts', id, offer: { ...offer, parts } }, parts.map((p) => p.data));
    } catch {
      /* 这次没有,下次推完、下次打开再存 */
    }
  });
}

/** 把线程手上的世界打成完整的内容(见文件头 packParts):和 queueSnapshot、queueWorldParts 打出来的一样,只是当场打 */
async function packedOffer(m: Extract<Queued, { type: 'packParts' }>): Promise<WorldPartsOffer> {
  const baseKey = keyOf(m.params, m.terrain, m.sketch, mapKeys(m));
  const pin = m.keptMap && frozen?.key === baseKey ? frozen.kept : undefined;
  // 照原样打开的旧世界:这一版算出来的不是它原来的样子,算不了。地图留着的世界,线程手上不是那张地图:按种子长的是另一颗星球
  if (frozenOld(baseKey) && !pin) throw new Error('照原样打开的旧世界不重新打');
  if (m.keptMap && pin?.part.sum !== m.keptMap) throw new Error('线程手上不是那张地图');
  const world = worldOf(m.params, m.terrain, m.sketch, mapKeys(m));
  const steps = stepsOf(m.params, m.terrain, m.sketch, m.upheavals, mapKeys(m));
  // 推好的历史记着就用(推演年数不算在配方的键里,另外比);没记着就按这份配方推一遍(和重推一样),结果一样
  const had = await heldCiv(m, m.play);
  const use = had && (m.play || had.endYear === (cleanEndAt(m.endYear) ?? END_YEAR_DEFAULT) || had.stuck?.to === (cleanEndAt(m.endYear) ?? END_YEAR_DEFAULT));
  const sims = use ? null : await simsFor(m);
  const civ = use
    ? had
    : civOrStuck(world, { interventions: m.interventions, tempo: tempoOf(m.params, m.terrain, m.sketch, m.civSeed, mapKeys(m)), ...upOpt(steps), ...namesOpt(m.names), ...yearsOpt(m.endYear), ...setupOpt(m), ...simOpt(sims), ...mapOpt(world, m), ...frozenOpt(m), ...playOpt(m), base: baseOf(world, m.civSeed) }, stuckOpt(m.play));
  const plugins = use ? held?.plugins : simRecords(sims);
  dropSims();
  const recipe = await recipeKey({ params: m.params, terrain: m.terrain, sketch: m.sketch, interventions: m.interventions, upheavals: m.upheavals, names: m.names, endYear: m.endYear, frontier: m.frontier, origins: m.origins, calamity: m.calamity, ...recipeTuning(m.tuning), civSeed: m.civSeed, keptMap: m.keptMap, play: m.play });
  const map = pin ? pin.part : await mapPart(baseKey, world);
  const mapsIn = await mapOffer(mapKeys(m), world, steps);
  const planet = planetOffer(world, m);
  const parts = [
    // 地图那一块还记着(下次重推用),不交出去,复制一份
    { ...map, data: map.data.slice(0) },
    ...(steps.length ? [await makePart('eras', { baseKey, eras: eraWorlds(steps) ?? [] })] : []),
    await makePart('civ', civ),
    await makePart('chronicle', worldChronicle(civ, m.characters)),
    await makePart('flags', worldFlags(world, civ)),
    ...(mapsIn?.layers ?? []),
    ...(planet ? [await makePart('planet', planet)] : []),
  ];
  return { generator: GENERATOR_VERSION, recipe, parts, ...(pin ? { readers: { terrain: pin.readers.terrain, query: READER_VERSIONS.query }, schemas: { map: pin.schema } } : {}), ...(plugins ? { plugins } : {}), ...(mapsIn ? { mapPlugins: mapsIn.mapPlugins } : {}) };
}

/** 编年史那一块复制一份交给主线程(改名时直接换名字用):传进来的字节这边还要用 */
function postBlock(id: number, key: number, part: SnapshotPart) {
  const copy = { ...part, data: part.data.slice(0) };
  post({ type: 'chronicleBlock', id, key, part: copy }, [copy.data]);
}

// ---------------------------------------------------------------------------
// 帮手线程(gullyPool.ts):整张主图的沟和山脊分给它们算,本线程同时推文明。开线程时就起好
const pool = new GullyPool();

/** 原件里的一块(没有就抛错) */
function partOf(m: LoadRequest, name: string): Promise<unknown> {
  const p = m.parts?.find((x) => x.name === name);
  if (!p) throw new Error(`原件缺 ${name}`);
  return readLocalPart(p);
}

/** 读到的、要打开的世界 */
interface LoadedWorld {
  key: string;
  world: World;
  eras: Map<string, World>;
  steps: Step[];
  /** 没要历史时(pin)可能是 null */
  civ: Civ | null;
  /** 世界记的读取版本 */
  readers: ReaderVersions;
  /** 记的是老版本:那一版的地貌读取代码;当前版本 = null */
  older: TerrainReader | null;
  /** 是更旧的版本算的(照原样打开的旧世界) */
  old: boolean;
  /** 历史那一块的字节(接着推时再解开) */
  civPart?: SnapshotPart;
  fromPart?: (value: unknown) => Civ;
  /** 地图那一块的指纹 */
  mapSum?: string;
  /** 这个世界这一版的原件的几块(请求要了 original 才有) */
  snapshot?: Snapshot;
  /** 地图留着的世界(见 frozen) */
  kept?: KeptPin;
  /** 存的编年史、国旗(世界仓库里读到的,读不出来 = 没有;原件里没有这两块) */
  chronicle?: ChronicleBlock | null;
  flags?: FlagBook | null;
  /** 存的编年史那一块的字节(存的就是现在的结构才有,不用重新打包) */
  chroniclePart?: SnapshotPart;
  planet?: PlanetPin;
}

/**
 * 读存下的内容打开的世界(load、pin):地图、各段世界(和地图同一套网格,存的时候没带)、历史,每件地形大事对上一段。读不了、对不上抛错。
 * wantCiv = false:不要历史(pin);世界仓库里校验过的不解开,原件也不解开
 */
async function loadedOf(m: LoadRequest, wantCiv: boolean): Promise<LoadedWorld> {
  const key = keyOf(m.params, m.terrain, m.sketch, mapKeys(m));
  // 打开世界才要的代码(校验器、世界文件)单独一个文件,只新建世界的不用下载。下载不下来和读不了一样,退回旧的路
  const fromVault = m.vault ? await (await import('./worldOpen')).openStoredWorld(m.vault, wantCiv, !wantCiv && !!m.keptMap) : null;
  const world = fromVault ? fromVault.world : ((await partOf(m, 'map')) as World);
  if (world.params.seed !== m.params.seed || world.params.cells !== m.params.cells) throw new Error('存的不是这个世界');
  const e = fromVault ? (fromVault.eras ?? { baseKey: key, eras: [] }) : ((await partOf(m, 'eras')) as { baseKey: string; eras: EraWorld[] });
  if (e.baseKey !== key) throw new Error('存的不是这个世界');
  const eras = new Map(e.eras.map((x) => [x.key, { ...x.world, mesh: world.mesh } as World]));
  let all: TerrainOp[] = [...(m.terrain ?? [])];
  const steps = mergeUpheavals(m.upheavals ?? []).map((u) => {
    all = [...all, ...u.ops];
    const k = keyOf(m.params, all, m.sketch, mapKeys(m));
    const w = eras.get(k);
    if (!w) throw new Error('存的内容里少一段');
    return { ...u, key: k, all, world: w };
  });
  if (fromVault) {
    const parts = fromVault.parts;
    const civPart = parts.get('civ');
    const map = parts.get('map');
    if (m.keptMap && map?.sum !== m.keptMap) throw new Error('存的不是这张地图');
    // 地图留着的世界不管是哪一版算的,都当旧世界:按参数重新生成的不是它
    const old = fromVault.head.generator < GENERATOR_VERSION || !!m.keptMap;
    let snapshot: Snapshot | undefined;
    // 用了地图插件的世界不打原件(同 queueSnapshot)
    if (wantCiv && m.original && !old && map && civPart && !world.mapPlugins?.length) {
      const eraPart = parts.get('eras') ?? (await makePart('eras', { baseKey: key, eras: [] }));
      snapshot = { format: SNAPSHOT_FORMAT, generator: fromVault.head.generator, recipe: fromVault.head.recipeKey, formation: false, parts: [map, eraPart, civPart] };
    }
    const planet = fromVault.planet ? { planet: { key: keyOf(m.params, undefined, m.sketch, mapKeys(m)), value: fromVault.planet } } : {};
    return { key, world, eras, steps, civ: fromVault.civ, readers: fromVault.readers, older: fromVault.older, old, civPart, fromPart: fromVault.fromCiv, mapSum: map?.sum, snapshot, chronicle: fromVault.chronicle, flags: fromVault.flags, chroniclePart: fromVault.chronicleIsCurrent ? parts.get('chronicle') : undefined, ...(m.keptMap && map ? { kept: { part: map, schema: fromVault.mapSchema, readers: fromVault.readers } } : {}), ...planet };
  }
  // 原件是世界文件有版本以前打的,读取代码都是第 1 版
  const readers = { ...FIRST_READERS };
  return { key, world, eras, steps, civ: wantCiv ? ((await partOf(m, 'civ')) as Civ) : null, readers, older: await olderTerrainOf({ readers }), old: true, civPart: m.parts?.find((x) => x.name === 'civ') };
}

/** 读存下的内容打开的世界:历史那一块留着(接着推时再读;要先钉住 frozen,键才对) */
function holdPart(m: LoadRequest, f: LoadedWorld): void {
  held = f.civPart ? { key: heldKey(m, m.play), part: f.civPart, fromPart: f.fromPart } : null;
}

/** 换上这个读到的世界(钉住、铺像素按它记的版本) */
function pinLoaded(f: LoadedWorld): void {
  frozen = { key: f.key, world: f.world, eras: f.eras, old: f.old, ...(f.kept ? { kept: f.kept } : {}), ...(f.planet ? { planet: f.planet } : {}) };
  terrain = f.older ?? NOW_TERRAIN;
  pool.use(f.older ? { read: f.older, version: f.readers.terrain } : undefined);
}

/** 读不了的说法(worldOpen.ts 的 OpenRefusal);读原件时、对不上时抛的是别的错 */
function loadFailure(e: unknown): { why: OpenRefusal; recipe?: unknown } {
  // worldOpen.ts 的 OpenRefused(那个文件是下载的,这里不 import 它)
  const r = e as { name?: string; why?: OpenRefusal; recipe?: unknown } | null;
  if (r?.name === 'OpenRefused' && r.why) return { why: r.why, ...(r.recipe !== undefined ? { recipe: r.recipe } : {}) };
  return { why: e instanceof UnknownReaderError && e.needsUpdate ? 'newer' : 'broken' };
}

/** 排队处理的消息(改名不排队,见 onmessage) */
type Queued = Exclude<WorkerRequest, { type: 'renames' | 'shown' | 'packNow' | 'simFail' }>;
/**
 * 消息按先后一件件处理(生成要等帮手线程,等的时候后面来的消息排着,不插进来);
 * 后台的活(各段主图)排在所有消息后面,每做完一件先看有没有新消息
 */
const fg: Queued[] = [];
const bg: (() => Promise<void>)[] = [];
let running = false;
/**
 * 处理一件活时出了错:这个线程不再接活、排着的也不做了(主线程收到 error 事件就关掉它,另开一个重发还没回音的,
 * 见 src/ui/sim/simClient.ts)。不然后面几件照样交回,主线程分不清哪件没回音
 */
let broken = false;
/** 网址带 simFail 时推过这一年就故意出错(见 WorkerRequest 的 simFail) */
let simFail: number | undefined;
/** 推不下去时推演里抛的错:随停住的那份历史一起交给主线程记进问题记录(postCiv) */
let simError: unknown = null;
/** play = 逐年推演的进度:推不下去时停在年初,进度停得住 */
const stuckOpt = (play?: PlayState): StuckOptions => ({
  engine: simFail !== undefined && simFail > 0 ? breakAt(simFail) : growEngine,
  failed: (e) => (simError = e),
  ...(play ? { snap: (y: number) => playStop(y) } : {}),
});
self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  if (broken) return;
  // 改名不排队:在推的那一次推完要按它算编年史
  if (e.data.type === 'renames') return void (renamesNow = { id: e.data.id, names: e.data.names });
  if (e.data.type === 'packNow') return turnSnapNow?.();
  if (e.data.type === 'simFail') return void (simFail = e.data.year || undefined);
  // 交回的那一笔换上了:不用留着怎么改回上一张
  if (e.data.type === 'shown') {
    if (kept?.undo && kept.key === e.data.key) kept = { key: kept.key, keep: kept.keep };
    return;
  }
  fg.push(e.data);
  if (wake && (e.data.type === 'generate' || e.data.type === 'load')) {
    const f = wake;
    wake = null;
    f();
  }
  void pump();
};
async function pump() {
  if (running) return;
  running = true;
  try {
    while (fg.length || bg.length) {
      const m = fg.shift();
      try {
        if (m) await handle(m);
        else await bg.shift()!();
      } catch (err) {
        // 和以前同步处理时一样,出错报到线程的 error 事件上;这个线程不再接活(见 broken)
        broken = true;
        fg.length = 0;
        bg.length = 0;
        setTimeout(() => {
          throw err;
        });
      }
      // 让一下:这期间到了的消息先排进来
      if (!fg.length && bg.length) await new Promise((r) => setTimeout(r, 0));
    }
    // 手头的活都干完了:不在编辑地形(没留着整图)就把只在铺像素时用的大数组放掉 ——
    // 记沟壑像素的那几张(约 50 MB)、和下一段比的整图(有地形大事时最多两张,每张六十多 MB)。下次要用再分配、再铺
    if (!kept) {
      dropGullyBuffers();
      rasters.clear();
    }
  } finally {
    running = false;
  }
}

/** 后面排着新的世界(生成、打开):手上这次生成不用算完了 */
const superseded = () => fg.some((r) => r.type === 'generate' || r.type === 'load');

/** 让一下(排到下一个任务再接着算),这期间到了的消息先排进 fg。用 MessageChannel:没有 setTimeout(0) 连着用时的 4 毫秒下限 */
const slice = new MessageChannel();
const slices: (() => void)[] = [];
slice.port1.onmessage = () => slices.shift()?.();
const yieldTask = () =>
  new Promise<void>((r) => {
    slices.push(r);
    slice.port2.postMessage(0);
  });
/** 生成世界时最多连着算多久就让一下(毫秒) */
const GEN_SLICE = 25;

/**
 * 生成世界(参数同 generateWorld),一段一段算,每隔 GEN_SLICE 毫秒让一下;让的时候后面排上了新的世界就不算了(null)。
 * 算完的结果和 generateWorld 一模一样
 */
async function generateUnlessSuperseded(...args: Parameters<typeof generateWorld>): Promise<World | null> {
  const r = await stepsUnlessSuperseded(generateWorldSteps(...args));
  return r && r.value;
}

/** 一段一段做的活(yield 隔开),每隔 GEN_SLICE 毫秒让一下;让的时候后面排上了新的世界就不做了(null,做到一半的留给调用方收拾) */
async function stepsUnlessSuperseded<T>(it: Generator<void, T>): Promise<{ value: T } | null> {
  let t = performance.now();
  for (;;) {
    const r = it.next();
    if (r.done) return { value: r.value };
    if (performance.now() - t < GEN_SLICE) continue;
    await yieldTask();
    if (superseded()) return null;
    t = performance.now();
  }
}

/** 等着"后面排上了新的世界"的(onmessage 收到生成、打开时叫醒,见 untilSuperseded) */
let wake: (() => void) | null = null;
/** 后面排上了新的世界时兑现的 p(已经排着就马上兑现);不等了叫 done(不留着叫醒它) */
function untilSuperseded(): { p: Promise<void>; done: () => void } {
  if (superseded()) return { p: Promise.resolve(), done: () => {} };
  let f!: () => void;
  const p = new Promise<void>((r) => (f = r));
  wake = f;
  return { p, done: () => void (wake === f && (wake = null)) };
}

/** 逐年推演走完一步以后过多久(没有下一步了)才打这一份原件(毫秒);等着的那一次 */
const TURN_SNAPSHOT_IDLE = 2500;
let turnSnap: ReturnType<typeof setTimeout> | undefined;
/** 逐年推演等着打的那一份,现在就打(packNow);没有等着的 = null */
let turnSnapNow: (() => void) | null = null;
const dropTurnSnap = () => {
  clearTimeout(turnSnap);
  turnSnapNow = null;
};

/**
 * 地图留着的世界:线程手上不是那张地图(线程重开过、钉住没成)就不往下做,往下做就按种子重新长了。
 * 抛错 = 线程出错:主线程开新线程、钉住、再发一次(sim/simClient.ts),还不行就收起这件活
 */
function checkKept(m: Queued): void {
  // 打内容(packParts)对不上时只是这次打不成,线程没坏,见 packedOffer
  if (m.type === 'load' || m.type === 'pin' || m.type === 'packParts' || !('keptMap' in m) || !m.keptMap) return;
  if (m.type === 'generate' || frozen?.kept?.part.sum !== m.keptMap) throw new Error('地图留着的世界:线程手上没有那张地图');
}

/** 一件活:要长地图的先装好带的地图插件;地图插件长不下去交 mapFailed(这一件的回音),不当线程的错 */
async function handle(m: Queued): Promise<void> {
  try {
    if (m.type !== 'load' && 'mapPlugins' in m) await loadMapsFor(m);
    await handleOne(m);
  } catch (e) {
    const f = mapFailure(e);
    if (!f) throw e;
    if (f.dead) mapRun?.forgetMap(f.plugin);
    post({ type: 'mapFailed', id: m.id, plugin: f.plugin, stage: f.stage, why: f.why });
  }
}

async function handleOne(m: Queued): Promise<void> {
  simError = null;
  dropSims();
  if (simFail !== undefined && simFail < 0 && ((m.type === 'generate' && !m.skipCiv) || m.type === 'resim' || m.type === 'extend' || m.type === 'turn' || m.type === 'outline')) throw new Error('故意让线程出错');
  checkKept(m);
  // 有了新的活:逐年推演上一步等着打的原件不要了(新的一步、换了世界、重推会各自再排)
  if (m.type !== 'history' && m.type !== 'upPreview' && m.type !== 'extendStop' && m.type !== 'outlineStop' && m.type !== 'trial' && m.type !== 'devTry' && m.type !== 'release' && m.type !== 'pin' && m.type !== 'packParts') dropTurnSnap();
  if (m.type !== 'history' && m.type !== 'upPreview' && m.type !== 'extendStop' && m.type !== 'outlineStop' && m.type !== 'release' && m.type !== 'pin') takeTempo(m.params, m.sketch, mapKeys(m), m.tempo);
  if (m.type === 'generate') {
    // 后面已经排着新的世界(编辑地形连着涂了几笔):这一次不用算了
    if (superseded()) return void post({ type: 'aborted', id: m.id });
    // 地图插件用不了就不动手上的世界
    if (m.mapPlugins?.length) mapPlugins(mapKeys(m));
    // 换了世界:后台排着的补丁和记着的整图、推文明的底子都作废
    bg.length = 0;
    rasters.clear();
    civMemo = null;
    outlineCache = null;
    // 刚才是照原样读进来的旧世界:州的划分是按旧地形算的,同样的键这回要按新生成的重算
    if (frozen) regionsMemo.clear();
    frozen = null;
    terrain = NOW_TERRAIN;
    pool.use();
    // 编辑地形:上一笔交出去了、主线程还没换上就又涂了这一笔(照上一笔之前那张比的):上一笔改回去(见 KeptUndo)
    const undo = kept?.undo;
    if (kept && undo) {
      if (m.keep && m.from !== undefined && m.from !== kept.key && m.from === undo.key) {
        if (undo.before) applyPatch(undo.raster, undo.before);
        kept = { key: undo.key, keep: { raster: undo.raster, inputs: kept.keep.inputs, dirty: undo.changed } };
      } else kept = { key: kept.key, keep: kept.keep };
    }
    await pool.up;
    const t0 = performance.now();
    const had = baseCache.base;
    // 一段一段算,中间让一下:新的一笔来了就不算了(线程不用关掉重开,记着的网格、板块、前一半、整图都还在)
    const world = await generateUnlessSuperseded(m.params, (stage, pct) => post({ type: 'progress', id: m.id, stage, pct }), m.terrain, sketchGrid(m.sketch), baseCache, genMaps(mapKeys(m)));
    if (!world) return void post({ type: 'aborted', id: m.id });
    const reused = !!had && baseCache.base === had;
    last = { key: keyOf(m.params, m.terrain, m.sketch, mapKeys(m)), world };
    const steps = stepsOf(m.params, m.terrain, m.sketch, m.upheavals, mapKeys(m), (k, n) => post({ type: 'progress', id: m.id, stage: '地形大事', pct: 0.9 + (0.03 * k) / n }));
    const genMs = performance.now() - t0;
    if (superseded()) return void post({ type: 'aborted', id: m.id });
    // 推文明那一步是同步的(和帮手算沟壑同时):推演插件先装好
    const sims = m.skipCiv ? null : await simsFor(m);
    if (superseded()) return void post({ type: 'aborted', id: m.id });
    // 先铺像素(山坡上的沟和山脊、细沟交给帮手线程),同时推文明。
    // 编辑地形:主线程地图上那张整图线程里还留着,就只重铺变了的那块(gen/rasterEdit.ts)
    post({ type: 'progress', id: m.id, stage: '铺展地图', pct: 0.93 });
    const t1 = performance.now();
    let prev = m.keep && m.from !== undefined && m.scale === 1 && kept?.key === m.from ? kept : null;
    const cover = kept?.keep.inputs.cover;
    // 留着的整图对不上这次的(主线程地图上那张不是它):不拿它比,整张交;它的数组下面留一份拷贝时接着用
    let spare = !prev && m.keep ? (kept?.keep.raster ?? null) : null;
    // 留着的这份先放掉:按块重铺就地改它的数组,改到一半出了错,下一笔也不会接着用改了一半的那张
    kept = null;
    pool.prepare(world, m.scale);
    // 按块重铺直接改上一张整图的数组(不另拷一整张;改之前那块的样子记在 before 里,比补丁时用)。
    // 编辑地形时(skipCiv)一段一段铺、中间让一下:新的一笔来了就放下,就地改了的那块贴回原样,留着的整图照旧是主线程地图上那张
    let tried: ReturnType<typeof rasterizePatch> = null;
    if (prev && m.skipCiv) {
      const at: PatchProgress = {};
      const r = await stepsUnlessSuperseded(rasterizePatchSteps(world, prev.keep, undefined, true, at));
      if (!r) {
        if (at.before?.box) applyPatch(prev.keep.raster, at.before.box);
        kept = prev;
        return void post({ type: 'aborted', id: m.id });
      }
      tried = r.value;
    } else if (prev) tried = rasterizePatch(world, prev.keep, undefined, true);
    const pj = tried && 'job' in tried ? tried : null;
    // 上一张铺像素的输入比完了(覆盖表已经接到这一份里):只留下比补丁要用的整图,别的先放掉 ——
    // 要整张铺的,铺之前就放(铺的时候、推文明的时候不和新的一份同时占着)
    let old = prev && { key: prev.key, raster: prev.keep.raster };
    prev = null;
    // 要重铺的那块太大(比如海里放火山,侵蚀整个重算):整张铺,已经算好的输入接着用。
    // 编辑地形时同样一段一段铺,新的一笔来了就放下(铺的是新开的数组,留着的整图没动;同下面 giveUp 整张铺的那样记下)
    const whole = tried && 'whole' in tried ? tried.whole : undefined;
    let d: PatchJob | ReturnType<typeof rasterizeDeferred>;
    if (pj) d = pj;
    else if (m.skipCiv && old && whole) {
      const r = await stepsUnlessSuperseded(rasterizeDeferredSteps(world, m.scale, undefined, cover, whole));
      if (!r) {
        kept = { key: old.key, keep: { raster: old.raster, inputs: whole.inputs, dirty: { x0: 0, y0: 0, w: old.raster.w, h: old.raster.h } } };
        return void post({ type: 'aborted', id: m.id });
      }
      d = r.value;
    } else d = rasterizeDeferred(world, m.scale, undefined, cover, whole);
    const raster = d.raster;
    const rasterMs = performance.now() - t1;
    /**
     * 编辑地形时(skipCiv)铺完(或算完沟壑)以后新的一笔已经排上了:这次不交了,线程留着的整图回到主线程地图上那张(old)的样子 ——
     * 就地改的那块改回原样;和这次的输入对不上的那块记进 dirty(下一笔一起重铺)。下一笔照样只重铺、只交回变了的那块。
     * dirty 记输入变了的框(pj.changed,已经并上了之前的 dirty),不记往外扩过的重铺范围:下一笔会照它再往外扩,
     * 记扩过的话连涂几笔就一圈圈扩大,两三笔以后超过半张图、改成整张铺
     */
    const giveUp = (): boolean => {
      if (!m.skipCiv || !old || !superseded()) return false;
      const r0 = old.raster;
      if (pj) {
        if (pj.before?.box) applyPatch(r0, pj.before.box);
        kept = { key: old.key, keep: { raster: r0, inputs: d.inputs, dirty: pj.changed } };
      } else kept = { key: old.key, keep: { raster: r0, inputs: d.inputs, dirty: { x0: 0, y0: 0, w: r0.w, h: r0.h } } };
      post({ type: 'aborted', id: m.id });
      return true;
    };
    if (giveUp()) return;
    let civMs: number | undefined;
    // 编辑地形时(skipCiv)不推文明:等帮手线程把沟和山脊算完就交回,文明等收起编辑地形以后补推(civOnly)
    // 手绘风的符号规划(按块换上时交给主线程):按块重铺的,等帮手算细沟的工夫里先算好(精细度高时一两百毫秒,不占等的时间)
    let plan: Plan | undefined;
    const pushCiv = () => {
      // 文明骨架(宜居度、州……)只读 World,之后的文明步骤都在 gen/civ/index.ts 里接
      post({ type: 'progress', id: m.id, stage: '文明', pct: 0.95 });
      const tc = performance.now();
      const c = civOf(world, m, steps, sims);
      civMs = performance.now() - tc;
      dropSims();
      return c;
    };
    // 回放快照体积大且主线程用不上,不随世界一起发送
    const { history: _history, ...rest } = world;
    void _history;
    const baseKey = keyOf(m.params, m.terrain, m.sketch, mapKeys(m));
    // 地图先交(mapFirst,整张铺的):沟壑本线程也领一段,铺完就交 map,再推文明。
    // 推文明的时候本线程收不到消息(帮手算好的沟壑也收不到),和推文明同时算沟壑的话,地图要等推完才交得出去
    const early = !!m.mapFirst && !m.skipCiv && !pj && !old;
    if (early) {
      await pool.finish(d, undefined, () => void (plan = planGlyphs(world)));
      if (superseded()) return void post({ type: 'aborted', id: m.id });
      // 写实画风的整张像素层也在这边画好(帮手一起分带子画),主线程换上之前只要贴上
      const painted = m.paint?.length && m.scale === 1 ? await pool.paintRealistic(raster, m.paint, superseded) : undefined;
      if (superseded()) return void post({ type: 'aborted', id: m.id });
      // 整张交出去的数组 transfer 走了,留的是一份拷贝(同下面整张交的)
      if (m.keep && m.scale === 1) kept = { key: baseKey, keep: { raster: copyRaster(raster, spare), inputs: d.inputs } };
      spare = null;
      if (kept?.key === baseKey) rasters.set(baseKey, kept.keep.raster);
      post(
        { type: 'map', id: m.id, world: { ...rest, history: [] }, raster, ...(plan ? { plan } : {}), ...(painted ? { painted } : {}), genMs, rasterMs, ...(reused ? { reused: true as const } : {}), eras: eraWorlds(steps), baseKey },
        [...rasterTransferables(raster), ...(plan ? [plan.forest.buffer as ArrayBuffer] : []), ...(painted ? realisticPaintedTransferables(painted) : [])],
      );
      // 交了地图以后后面又排上了新的世界(按了后退……):这个世界的历史不用推了
      if (superseded()) return void post({ type: 'aborted', id: m.id });
    }
    // 编辑地形等帮手的时候新的一笔来了:不等帮手算完就放下(沟壑、细沟没叠回去也没关系,giveUp 把留着的整图改回原样)
    const sup = m.skipCiv && old ? untilSuperseded() : null;
    const civ = m.skipCiv
      ? await pool.finish(d, undefined, pj && old ? () => void (plan = planGlyphs(world)) : undefined, sup?.p).then(() => null)
      : early
        ? pushCiv()
        : await pool.finish(
            d,
            pushCiv,
            // 手绘风的符号规划:主线程换上之前备地图要用(200k 地块要算一百多毫秒),等帮手的工夫里先算好
            () => void (plan = planGlyphs(world)),
          );
    sup?.done();
    if (giveUp()) return;
    if (early) {
      const transfer = civTransferables(civ!);
      const cloned = cloneCiv(civ!);
      keepCiv(m, m.play, cloned, simRecords(sims));
      const ms = performance.now() - t0;
      const chron = await postChronicle(m.id, civ!, m);
      postCiv({ type: 'done', id: m.id, mapSent: true, civ, chron, ms, genMs, rasterMs, ...(civMs !== undefined ? { civMs } : {}), ...(reused ? { reused: true as const } : {}), tempo: noteOf(m.params, m.sketch, mapKeys(m)), baseKey }, transfer);
      queuePatches(m.id, m, steps);
      queueSnapshot(m.id, m, world, steps, cloned, simRecords(sims));
      return;
    }
    const transfer: ArrayBuffer[] = [];
    let map: { raster: Raster } | { patch: RasterPatch | null; from: string; plan: Plan };
    // 主线程有那张整图:只交回变了的那一块(逐位比),主线程按块重画;整张留在线程里,下一笔接着用。
    // 按块重铺的只在重铺的那块里比;整张铺的(变得多)整张比,变的那块不到 PATCH_SEND 张图也照样只交那一块。
    // 先只比出框:太大、要整张交的,不白拷一份补丁。按块重铺的上一张已经就地改了:拿改之前记下的那块比
    const diff = old && m.scale === 1 ? (pj?.before ? exactDiffBefore(pj.before, raster, pj.win) : exactDiff(old.raster, raster, pj ? pj.win : undefined)) : undefined;
    const send = !!old && diff !== undefined && (!!pj || !diff?.box || diff.box.w * diff.box.h <= PATCH_SEND * raster.w * raster.h);
    const from = old?.key;
    // 编辑地形按块重铺的:记下怎么改回上一张(主线程还没换上这一笔就又涂了一笔时用,见 KeptUndo)
    const undoTo: KeptUndo | undefined = m.skipCiv && pj && old ? { key: old.key, raster: old.raster, before: pj.before?.box ?? null, changed: pj.changed } : undefined;
    // 比完了,上一张整图用不着了:按块的这次不再拉着它(它的数组就是这一张的;编辑地形时上面记着它的细沟,改回去时用);
    // 整张交的这次留拷贝时拷进它的数组
    if (!pj) spare ??= old?.raster ?? null;
    old = null;
    if (send && from !== undefined) {
      spare = null;
      const patch = diff ? cutExact(raster, diff) : null;
      if (patch) transfer.push(...patchTransferables(patch));
      plan ??= planGlyphs(world);
      transfer.push(plan.forest.buffer as ArrayBuffer);
      map = { patch, from, plan };
    } else {
      transfer.push(...rasterTransferables(raster));
      if (plan) transfer.push(plan.forest.buffer as ArrayBuffer);
      map = plan ? { raster, plan } : { raster };
    }
    // 整张交出去的数组 transfer 走了,留的是一份拷贝(拷进上一张用不着了的整图的数组里,不另开一整张)
    if (m.keep && m.scale === 1) kept = { key: baseKey, keep: { raster: 'patch' in map ? raster : copyRaster(raster, spare), inputs: d.inputs }, ...(undoTo && 'patch' in map ? { undo: undoTo } : {}) };
    spare = null;
    // 地形大事的补丁要和这张整图比:直接用留着的这一份,不用再铺一遍
    if (kept?.key === baseKey) rasters.set(baseKey, kept.keep.raster);
    if (civ) transfer.push(...civTransferables(civ));
    // 没推文明的:记着的上一份历史是别的地形的,放掉;原件等补推完再打
    const cloned = civ && cloneCiv(civ);
    keepCiv(m, m.play, cloned, simRecords(sims));
    const ms = performance.now() - t0;
    const chron = civ ? await postChronicle(m.id, civ, m) : undefined;
    postCiv({ type: 'done', id: m.id, world: { ...rest, history: [] }, ...map, civ, ...(chron !== undefined ? { chron } : {}), ms, genMs, rasterMs, ...(civMs !== undefined ? { civMs } : {}), ...(reused ? { reused: true as const } : {}), tempo: noteOf(m.params, m.sketch, mapKeys(m)), eras: eraWorlds(steps), baseKey }, transfer);
    queuePatches(m.id, m, steps);
    queueSnapshot(m.id, m, world, steps, cloned, simRecords(sims));
  } else if (m.type === 'civOnly') {
    // 补推 skipCiv 生成的那个世界的文明(和 generate 里那一步同一个推法);地形大事的补丁 generate 时已经排过,不再排
    const t0 = performance.now();
    const world = worldOf(m.params, m.terrain, m.sketch, mapKeys(m));
    const steps = stepsOf(m.params, m.terrain, m.sketch, m.upheavals, mapKeys(m));
    const sims = await simsFor(m);
    const tc = performance.now();
    const civ = civOf(world, m, steps, sims);
    const civMs = performance.now() - tc;
    dropSims();
    const cloned = cloneCiv(civ);
    keepCiv(m, m.play, cloned, simRecords(sims));
    const ms = performance.now() - t0;
    const chron = await postChronicle(m.id, civ, m);
    postCiv({ type: 'civOnly', id: m.id, nid: m.nid, civ, chron, ms, civMs, tempo: noteOf(m.params, m.sketch, mapKeys(m)), eras: eraWorlds(steps), baseKey: keyOf(m.params, m.terrain, m.sketch, mapKeys(m)) }, civTransferables(civ));
    queueSnapshot(m.id, m, world, steps, cloned, simRecords(sims));
  } else if (m.type === 'load') {
    bg.length = 0;
    rasters.clear();
    civMemo = null;
    outlineCache = null;
    // 州的划分按读进来的旧地形重算,不沿用按新版生成时记下的
    regionsMemo.clear();
    frozen = null;
    await pool.up;
    const t0 = performance.now();
    post({ type: 'progress', id: m.id, stage: '读取', pct: 0.3 });
    const baseKey = keyOf(m.params, m.terrain, m.sketch, mapKeys(m));
    let f: LoadedWorld;
    try {
      f = await loadedOf(m, true);
      if (!f.civ) throw new Error('存的内容里没有历史');
    } catch (e) {
      post({ type: 'loadFailed', id: m.id, ...loadFailure(e) });
      return;
    }
    pinLoaded(f);
    const { world, steps } = f;
    const civ = f.civ!;
    const genMs = performance.now() - t0;
    post({ type: 'progress', id: m.id, stage: '铺展地图', pct: 0.93 });
    // 照原样打开的世界不编辑地形:不留整张主图
    kept = null;
    const t1 = performance.now();
    pool.prepare(world, m.scale);
    const d = terrain.rasterizeDeferred(world, m.scale);
    const raster = d.raster;
    const rasterMs = performance.now() - t1;
    post({ type: 'progress', id: m.id, stage: '铺展地图', pct: 0.96 });
    // 手绘风的符号规划同 generate:等帮手的工夫里先算好,一起交
    let plan: Plan | undefined;
    await pool.finish(d, undefined, () => void (plan = planGlyphs(world)));
    const transfer = rasterTransferables(raster);
    if (plan) transfer.push(plan.forest.buffer as ArrayBuffer);
    transfer.push(...civTransferables(civ));
    // 历史那一块字节留着(读出来的那份交给主线程了):接着推时再读
    holdPart(m, f);
    const ms = performance.now() - t0;
    // 存的编年史直接换上名字;读不出来、人物卡的性别改过就现算一块
    const chron = await postChronicle(m.id, civ, m, f.chronicle);
    const blockNow = lastBlock;
    lastBlock = null;
    postCiv({ type: 'done', id: m.id, world: { ...world, history: [], readers: f.readers }, raster, ...(plan ? { plan } : {}), civ, chron, ms, genMs, rasterMs, eras: eraWorlds(steps), baseKey, ...(f.mapSum ? { mapSum: f.mapSum } : {}), ...(f.flags ? { flags: f.flags } : {}) }, transfer);
    queuePatches(m.id, m, steps);
    // 改名时主线程直接换名字要用这一块:存的就是现在的结构时字节现成的
    if (blockNow) {
      bg.push(async () => {
        try {
          postBlock(m.id, blockNow.key, blockNow.block === f.chronicle && f.chroniclePart ? f.chroniclePart : await makePart('chronicle', blockNow.block));
        } catch {
          /* 没有这一块,改名时在主线程上现算 */
        }
      });
    }
    // 这个世界这一版还没有原件:交一份回去存上(字节和仓库里的一样,不用重新打)。历史那块上面留着接着推用,复制一份
    const snap = f.snapshot;
    if (snap) {
      bg.push(async () => {
        const parts = snap.parts.map((p) => ({ ...p, data: p.data.slice(0) }));
        post({ type: 'snapshot', id: m.id, snapshot: { ...snap, parts } }, parts.map((p) => p.data));
      });
    }
  } else if (m.type === 'pin') {
    // 线程被重开过:读存下的内容打开的世界重新钉住(地图、各段世界、历史那一块);读不出来就和没钉一样,按参数重新生成
    try {
      const f = await loadedOf(m.load, false);
      regionsMemo.clear();
      pinLoaded(f);
      // 地图留着的世界打开以后可能重推过:读到的历史不是打开时那份配方的,不记
      if (m.load.keptMap) held = null;
      else holdPart(m.load, f);
    } catch {
      frozen = null;
    }
  } else if (m.type === 'packParts') {
    try {
      const offer = await packedOffer(m);
      post({ type: 'packed', id: m.id, fid: m.fid, ok: true, offer }, offer.parts.map((p) => p.data));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      post({ type: 'packed', id: m.id, fid: m.fid, ok: false, kind: e instanceof RangeError ? 'memory' : 'failed', message });
    }
  } else if (m.type === 'history') {
    const h = buildHistoryFrames(formationOf(m.params, m.terrain, m.sketch, mapKeys(m)));
    post({ type: 'history', id: m.id, ...h }, h.frames.map((f) => f.buffer));
  } else if (m.type === 'resim' || m.type === 'trial') {
    const t0 = performance.now();
    const world = worldOf(m.params, m.terrain, m.sketch, mapKeys(m));
    const steps = stepsOf(m.params, m.terrain, m.sketch, m.upheavals, mapKeys(m));
    const sims = await simsFor(m);
    const params = { interventions: m.interventions, tempo: tempoOf(m.params, m.terrain, m.sketch, m.civSeed, mapKeys(m)), ...upOpt(steps), ...namesOpt(m.names), ...yearsOpt(m.endYear), ...setupOpt(m), ...simOpt(sims), ...mapOpt(world, m), ...frozenOpt(m) };
    // 只调大了推演年数(别的都没变):从记着的那份接着推(和从第 0 年推一样;接不上的 continueCiv 自己从第 0 年推)
    const base = m.type === 'resim' && !m.play ? await heldCiv(m, undefined) : null;
    const civ =
      base && base.endYear < (cleanEndAt(m.endYear) ?? END_YEAR_DEFAULT)
        ? continueOrStuck(world, base, { ...params, ...memoOpt(world, m.civSeed) }, stuckOpt())
        : civOrStuck(world, { ...params, ...playOpt(m), base: baseOf(world, m.civSeed) }, stuckOpt(m.play));
    dropSims();
    const ms = performance.now() - t0;
    const tempo = noteOf(m.params, m.sketch, mapKeys(m));
    if (m.type === 'resim') {
      const cloned = cloneCiv(civ);
      keepCiv(m, m.play, cloned, simRecords(sims));
      // 主线程只换上最新的一次重推;换了世界的也不换
      const chron = await postChronicleUnlessSuperseded(m.id, civ, m, () => fg.some((r) => r.type === 'generate' || r.type === 'load' || r.type === 'resim'));
      postCiv({ type: 'civ', id: m.id, seq: m.seq, civ, ...(chron !== undefined ? { chron } : {}), ms, tempo, eras: eraWorlds(steps), baseKey: keyOf(m.params, m.terrain, m.sketch, mapKeys(m)) }, civTransferables(civ));
      queuePatches(m.id, m, steps);
      queueSnapshot(m.id, m, world, steps, cloned, simRecords(sims));
    } else postCiv({ type: 'trial', id: m.id, tid: m.tid, civ, ms, tempo }, civTransferables(civ));
  } else if (m.type === 'devTry') {
    try {
      const world = worldOf(m.params, m.terrain, m.sketch, mapKeys(m));
      const steps = stepsOf(m.params, m.terrain, m.sketch, m.upheavals, mapKeys(m));
      const params = { interventions: m.interventions.length ? m.interventions : undefined, tempo: tempoOf(m.params, m.terrain, m.sketch, m.civSeed, mapKeys(m)), ...upOpt(steps), ...namesOpt(m.names), ...setupOpt(m), ...mapOpt(world, m), ...frozenOpt(m), base: baseOf(world, m.civSeed) };
      const [{ devTry }, { quickjsBox }] = await Promise.all([import('./plugin/devTry'), import('./simPluginRun')]);
      const years = Math.max(1, Math.floor(m.years));
      const result = await devTry(world, params, m.simPlugins ?? [], m.civSeed ?? m.params.seed, { years, half: Math.floor(years / 2), box: quickjsBox, progress: (pct) => post({ type: 'devTryProgress', id: m.id, did: m.did, pct }) });
      post({ type: 'devTry', id: m.id, did: m.did, result });
    } catch (e) {
      post({ type: 'devTry', id: m.id, did: m.did, error: e instanceof Error ? e.message : String(e) });
    }
  } else if (m.type === 'turn') {
    const t0 = performance.now();
    const world = worldOf(m.params, m.terrain, m.sketch, mapKeys(m));
    const steps = stepsOf(m.params, m.terrain, m.sketch, m.upheavals, mapKeys(m));
    const sims = await simsFor(m);
    const params = { interventions: m.interventions, tempo: tempoOf(m.params, m.terrain, m.sketch, m.civSeed, mapKeys(m)), ...upOpt(steps), ...namesOpt(m.names), ...yearsOpt(m.endYear), ...setupOpt(m), ...simOpt(sims), ...mapOpt(world, m), ...frozenOpt(m) };
    // 上一步的结果对不上这份进度(线程被重开过、换了世界):先从第 0 年推到这一步年初
    const from = (await heldCiv(m, m.play)) ?? civOrStuck(world, { ...params, ...playOpt(m), base: baseOf(world, m.civSeed) }, stuckOpt(m.play));
    const opt = { ...params, ...memoOpt(world, m.civSeed) };
    const cont: PlayContinue = (w, c, p) => continueOrStuck(w, c, p, stuckOpt(m.play));
    const out = m.ticks !== undefined ? playTicks(world, from, opt, m.play, m.commands, m.ticks, cont) : playTurn(world, from, opt, m.play, m.commands, m.years, cont);
    dropSims();
    const records = simRecords(sims);
    const ms = performance.now() - t0;
    const cloned = cloneCiv(out.civ);
    keepCiv(m, out.play, cloned, records);
    const chron = await postChronicle(m.id, out.civ, m);
    postCiv({ type: 'turn', id: m.id, civ: out.civ, chron, play: out.play, rejected: out.rejected, ms, tempo: noteOf(m.params, m.sketch, mapKeys(m)), eras: eraWorlds(steps), baseKey: keyOf(m.params, m.terrain, m.sketch, mapKeys(m)) }, civTransferables(out.civ));
    queuePatches(m.id, m, steps);
    // 原件很大,打一份要好一会儿:一步接一步往下走的时候不每一步都打(会拖慢下一步),停下来一阵子没有下一步了才打最后这一份
    dropTurnSnap();
    turnSnapNow = () => {
      dropTurnSnap();
      queueSnapshot(m.id, { ...m, play: out.play }, world, steps, cloned, records);
      void pump();
    };
    turnSnap = setTimeout(turnSnapNow, TURN_SNAPSHOT_IDLE);
  } else if (m.type === 'extend') {
    const t0 = performance.now();
    const to = cleanEndAt(m.to) ?? END_YEAR_DEFAULT;
    const world = worldOf(m.params, m.terrain, m.sketch, mapKeys(m));
    const steps = stepsOf(m.params, m.terrain, m.sketch, m.upheavals, mapKeys(m));
    const sims = await simsFor(m);
    const params = { interventions: m.interventions, tempo: tempoOf(m.params, m.terrain, m.sketch, m.civSeed, mapKeys(m)), ...upOpt(steps), ...namesOpt(m.names), ...yearsOpt(cleanEndAt(to)), ...setupOpt(m), ...simOpt(sims), ...mapOpt(world, m), ...frozenOpt(m) };
    const base = await heldCiv(m, undefined);
    // 后面排着会换掉这份历史的请求,或者叫停这一次的:不推了
    const stop = () => fg.some((r) => r.type === 'generate' || r.type === 'load' || r.type === 'resim' || r.type === 'turn' || r.type === 'extend' || (r.type === 'extendStop' && r.xid >= m.xid));
    const civ = await extendCiv(world, base, { ...params, ...(base ? memoOpt(world, m.civSeed) : { base: baseOf(world, m.civSeed) }) }, {
      progress: (year, pct) => post({ type: 'extendProgress', id: m.id, xid: m.xid, year, pct }),
      pause: () => new Promise((r) => setTimeout(r, 0)),
      stop,
      ...stuckOpt(),
    });
    dropSims();
    if (!civ) {
      post({ type: 'extendStopped', id: m.id, xid: m.xid });
      return;
    }
    const ms = performance.now() - t0;
    const cloned = cloneCiv(civ);
    keepCiv(m, undefined, cloned, simRecords(sims));
    const chron = await postChronicleUnlessSuperseded(m.id, civ, m, stop);
    postCiv({ type: 'extended', id: m.id, xid: m.xid, civ, ...(chron !== undefined ? { chron } : {}), to, ms, tempo: noteOf(m.params, m.sketch, mapKeys(m)), eras: eraWorlds(steps), baseKey: keyOf(m.params, m.terrain, m.sketch, mapKeys(m)) }, civTransferables(civ));
    queuePatches(m.id, m, steps);
    queueSnapshot(m.id, { ...m, endYear: to }, world, steps, cloned, simRecords(sims));
  } else if (m.type === 'outline') {
    const t0 = performance.now();
    const world = worldOf(m.params, m.terrain, m.sketch, mapKeys(m));
    const steps = stepsOf(m.params, m.terrain, m.sketch, m.upheavals, mapKeys(m));
    const own = ownInterventions(m.interventions ?? []);
    const sims = await simsFor(m);
    const params = { tempo: tempoOf(m.params, m.terrain, m.sketch, m.civSeed, mapKeys(m)), ...upOpt(steps), ...namesOpt(m.names), ...yearsOpt(m.endYear), ...setupOpt(m), ...simOpt(sims), ...mapOpt(world, m), ...frozenOpt(m), base: baseOf(world, m.civSeed) };
    // 后面排着会换掉这份历史的请求,或者叫停这一次的:不推了
    const stop = () => fg.some((r) => r.type === 'generate' || r.type === 'load' || r.type === 'resim' || r.type === 'turn' || r.type === 'extend' || r.type === 'outline' || (r.type === 'outlineStop' && r.oid >= m.oid));
    // 这个世界、这组参数的键(不算干预、推演年数:runOutline 自己加上作者的干预、人物、标记)
    const key = heldKey({ ...m, interventions: undefined }, undefined);
    /** 上一次报的进度(正在查哪一条那几声带上它) */
    let last: { done: number; total: number; review: PlotReview[] } = { done: 0, total: m.plots.length, review: [] };
    const out = await runOutline(
      world,
      params,
      { plots: m.plots, interventions: own, characters: m.characters, marks: m.marks, tries: m.tries },
      {
        progress: (done, total, review) => {
          last = { done, total, review: review.slice() };
          post({ type: 'outlineProgress', id: m.id, oid: m.oid, ...last });
        },
        stage: (at, fix, trial) => post({ type: 'outlineProgress', id: m.id, oid: m.oid, ...last, at: { id: at, fix, ...(trial ? { trial } : {}) } }),
        pause: () => new Promise((r) => setTimeout(r, 0)),
        stop,
        cache: outlineCache,
        key,
        // 叫停了:已经定下来的几条留着,再照大纲推演时不重算
        keep: (c) => (outlineCache = c),
        ...stuckOpt(),
      },
    );
    dropSims();
    if (!out) {
      post({ type: 'outlineStopped', id: m.id, oid: m.oid });
      return;
    }
    outlineCache = out.cache;
    const civ = out.civ;
    const ms = performance.now() - t0;
    const done = { ...m, interventions: out.interventions };
    const cloned = cloneCiv(civ);
    keepCiv(done, undefined, cloned, simRecords(sims));
    const chron = await postChronicleUnlessSuperseded(m.id, civ, m, stop);
    postCiv({ type: 'outlined', id: m.id, oid: m.oid, civ, ...(chron !== undefined ? { chron } : {}), interventions: out.interventions, review: out.review, ms, tempo: noteOf(m.params, m.sketch, mapKeys(m)), eras: eraWorlds(steps), baseKey: keyOf(m.params, m.terrain, m.sketch, mapKeys(m)) }, civTransferables(civ));
    queuePatches(m.id, m, steps);
    queueSnapshot(m.id, done, world, steps, cloned, simRecords(sims));
  } else if (m.type === 'outlineStop') {
    // 只在照大纲推演的时候有用(每查完一条看排着的消息);这时候没在推,什么也不做
  } else if (m.type === 'extendStop') {
    // 只在再推的时候有用(推的那几段之间看排着的消息);这时候没在推,什么也不做
  } else if (m.type === 'release') {
    kept = null;
  } else if (m.type === 'upPreview') {
    const t0 = performance.now();
    const run = () => {
      const steps = stepsOf(m.params, m.terrain, m.sketch, m.upheavals, mapKeys(m));
      const seed = m.civSeed ?? m.params.seed;
      const at = baseAt(m.params, m.terrain, m.sketch, steps, m.year, seed, mapKeys(m));
      const w1 = cachedWorld(m.params, [...at.ops, ...m.ops], m.sketch, mapKeys(m)).world;
      return { preview: previewUpheaval(OFFICIAL_KNOBS, at.world, at.regions, w1, m.ops, REGION_AREA, seed), water: w1.water.slice() };
    };
    // 照原样打开的旧世界上预览新的大事:大事以后的地形只能按现在的版本生成,前后都按现在的版本算(和另存出来的新版一致),不拿两颗星球比
    const pinned = frozen;
    let out: ReturnType<typeof run>;
    if (pinned && pinned.old && pinned.key === keyOf(m.params, m.terrain, m.sketch, mapKeys(m))) {
      frozen = null;
      try {
        out = run();
      } finally {
        frozen = pinned;
      }
    } else out = run();
    post({ type: 'upPreview', id: m.id, pid: m.pid, preview: out.preview, water: out.water, ms: performance.now() - t0 }, [out.water.buffer]);
  }
}
