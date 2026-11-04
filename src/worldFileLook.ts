/**
 * 核对别人给的世界文件,顺便把收进来要用的几样带回去:清理过的配方、指纹、AI 正文、封面。地图、历史这些大块不带回来。
 *
 * 比 checkWorldFile(gen/worldCheck.ts)多查两样,都是逐项校验看不到、打开时才会露馅的:
 * - 地图、各段世界和配方对不对得上(打开时读不下去的那几条,见 worker.ts 的 loadedOf):配方说是这个世界,内容却是另一个世界,
 *   打开时读不了就退回按配方生成,用的人看到的就不是文件里的东西
 * - 配方记的生成器版本比这一版软件新的,这一版打开只能按现在的规则重新生成,也不是文件里的东西:和别的「比软件新」一样,提示更新软件
 *
 * 纯计算,不碰 DOM:网页里在后台线程跑(worldFileLook.worker.ts),超时杀掉;单测直接调。
 */
import { mergeUpheavals } from './gen/civ/upheaval';
import { GENERATOR_VERSION } from './gen/edits';
import type { WorldCheckFailure } from './gen/worldCheck';
import type { SaveFile } from './gen/savefile';
import { recipeKey, recipeOfSave, sha256 } from './gen/snapshot';
import { openWorldFile, readWorldContent, type OpenOptions, type WorldContent } from './gen/worldFile';
import { asWorldFileError, broken, newer, type AuthorContent, type WorldManifest } from './gen/worldFormat';
import { keyOf } from './worldRun';
import { contentOfParts } from './worldVault';

/** 过了校验的文件 */
export interface FileFacts {
  ok: true;
  manifest: WorldManifest;
  /** 读配方时的提示 */
  warnings: string[];
  /** 配方照存档的办法读出来的那份(清理过);存进「我的世界」的是这一份 */
  save: SaveFile;
  /** 配方指纹 */
  recipeKey: string;
  /** 看世界用的几块的指纹连起来(worldVault.ts 的 contentOfParts) */
  content: string;
  /** 清单字节的指纹:收进仓库时确认还是这一份 */
  sum: string;
  author: AuthorContent | null;
  thumb: Uint8Array | null;
}

export type FileLook = FileFacts | WorldCheckFailure;

/** 内容和配方对不对得上:和打开世界时(worker.ts 的 loadedOf)查的一样 */
function checkFits({ map, eras, save }: Pick<WorldContent, 'map' | 'eras' | 'save'>): void {
  const p = save.params;
  if (map.params.seed !== p.seed || map.params.cells !== p.cells) broken('文件里的地图和配方不是同一个世界');
  const e = save.edits;
  const key = keyOf(p, e.terrain, e.sketch);
  if (eras && eras.baseKey !== key) broken('文件里的各段世界和配方不是同一个世界');
  const have = new Set(eras?.eras.map((x) => x.key));
  let all = [...e.terrain];
  for (const u of mergeUpheavals(e.upheavals ?? [])) {
    all = [...all, ...u.ops];
    if (!have.has(keyOf(p, all, e.sketch))) broken('文件里少一段世界');
  }
}

/** 核对一个文件:结论都在返回值里,不抛错 */
export async function lookFile(file: Blob | Uint8Array, options: OpenOptions): Promise<FileLook> {
  try {
    const opened = await openWorldFile(file, options);
    const content = await readWorldContent(opened);
    const { manifest } = opened;
    if (content.save.generator > GENERATOR_VERSION || manifest.made.generator > GENERATOR_VERSION) newer(`这个世界是更新版本的软件算的(生成器第 ${Math.max(content.save.generator, manifest.made.generator)} 版)`);
    if (content.save.generator !== manifest.made.generator) broken('清单和配方记的版本对不上');
    checkFits(content);
    return {
      ok: true,
      manifest,
      warnings: content.warnings,
      save: content.save,
      recipeKey: await recipeKey(recipeOfSave(content.save)),
      content: contentOfParts(manifest.parts),
      sum: await sha256(opened.manifestBytes),
      author: content.author,
      thumb: content.thumb,
    };
  } catch (err) {
    const e = asWorldFileError(err);
    return { ok: false, kind: e.kind, message: e.message };
  }
}
