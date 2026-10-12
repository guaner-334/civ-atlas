/**
 * 回放视频的编码:一帧一帧画好的画布 → 浏览器自带的 H.264 编码(WebCodecs)→ MP4 文件。
 * MP4 封装用开源库 mediabunny(MPL-2.0),按需加载,不进首屏。
 * 浏览器没有 WebCodecs、不支持 H.264 编码(旧浏览器、不是 https 的网页)时,filmSupported() = false,面板里说一句导不了。
 */
import { FILM_BITRATE, FILM_FPS } from './filmPlan';

let support: Promise<boolean> | null = null;

/** 这个浏览器能不能导视频(1080p H.264);结果记住,只查一次 */
export function filmSupported(): Promise<boolean> {
  support ??= (async () => {
    try {
      if (typeof window === 'undefined' || !window.isSecureContext || typeof VideoEncoder === 'undefined') return false;
      const { canEncodeVideo } = await import('mediabunny');
      return await canEncodeVideo('avc', { width: 1920, height: 1080, bitrate: FILM_BITRATE, frameRate: FILM_FPS });
    } catch {
      return false;
    }
  })();
  return support;
}

/** 取消导出时抛出的(调用方认出它就不报错) */
export class FilmCancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

export interface EncodeJob {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  frames: number;
  /** 把第 f 帧画到 canvas 上 */
  draw: (f: number) => Promise<void>;
  /** 画完第 f 帧(0 起) */
  progress?: (f: number) => void;
  cancelled: () => boolean;
}

/** 一帧一帧画、编码,做好了给 MP4 */
export async function encodeFilm(job: EncodeJob): Promise<Blob> {
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource } = await import('mediabunny');
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const source = new CanvasSource(job.canvas, { codec: 'avc', bitrate: FILM_BITRATE, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: FILM_FPS });
  await output.start();
  try {
    for (let f = 0; f < job.frames; f++) {
      if (job.cancelled()) throw new FilmCancelled();
      await job.draw(f);
      await source.add(f / FILM_FPS, 1 / FILM_FPS);
      job.progress?.(f);
    }
    if (job.cancelled()) throw new FilmCancelled();
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  return new Blob([target.buffer!], { type: 'video/mp4' });
}
