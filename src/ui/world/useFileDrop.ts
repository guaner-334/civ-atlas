/**
 * 把文件拖进页面(App 用):.json = 从文件打开(打开见 ./useWorldLoad.ts 的 openText);
 * 照手绘图新建时拖进来的图片 = 换成这张重新认(随机生成的新建不收图片,松手时说一句)。
 * 交回松手前提示条上写什么(dropping)和页面上挂的三个拖放处理
 */
import { useState } from 'react';
import { isImageFile, startImport } from '../ImportImage';
import { notify } from '../saveStore';
import { getStage } from '../stageStore';
import type { useWorldLoad } from './useWorldLoad';
import type { GenRefs } from './worldRefs';
import { draftModeOf } from './worldTarget';

/** useFileDrop 要的 App 状态 */
export interface FileDropDeps {
  /** 正在打开 / 已经打开的世界(新建中的是不是照手绘图的) */
  targetRef: GenRefs['targetRef'];
  /** 从文件打开(useWorldLoad 交回的) */
  openText: ReturnType<typeof useWorldLoad>['openText'];
}

export function useFileDrop(deps: FileDropDeps) {
  const { targetRef, openText } = deps;
  // 把 .json 拖进页面 = 从文件打开;照手绘图新建时拖进来的图片 = 换成这张重新认(随机生成的新建不收图片,松手时说一句)
  const [dropping, setDropping] = useState<false | 'save' | 'image'>(false);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  /** 新建中拖进来图片:照手绘图的收下,随机生成的不收 */
  const imageDrop = (): 'image' | false | null => (getStage().stage !== 'draft' ? null : draftModeOf(targetRef.current) === 'image' ? 'image' : false);
  const onDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const img = imageDrop();
    const kind = img !== null && e.dataTransfer.items?.[0]?.type.startsWith('image/') ? img : 'save';
    if (dropping !== kind) setDropping(kind);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!e.relatedTarget || !(e.currentTarget as Node).contains(e.relatedTarget as Node)) setDropping(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDropping(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const img = imageDrop();
    if (img !== null && isImageFile(f)) {
      if (img) return void startImport(f);
      return void notify({ kind: 'warn', text: '随机生成的世界不能导入图片，想照图生成就新建一个' });
    }
    f.text().then(
      (t) => openText(t, f.name),
      () => notify({ kind: 'error', text: `打不开 ${f.name}`, more: ['读不了这个文件'] }),
    );
  };
  return { dropping, onDragOver, onDragLeave, onDrop };
}
