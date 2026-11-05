/**
 * 世界仓库(worldVault.ts)的后台线程:写库、读回来核对指纹都在这里做,主线程只发一条消息。
 * 一件做完再做下一件:「全删」排在正在写的后面,写完的不会在全删之后留下来
 */
import { asVaultError, vaultOps, watchParts, type VaultErrorKind, type VaultOps } from './worldVault';

/** 发给线程的一件事 */
export interface VaultCall {
  rid: number;
  op: keyof VaultOps;
  args: unknown[];
  /** 拼文件时报进度(回 VaultTold)。只有一次性的线程才这么叫,常驻线程的回音只有一条 */
  told?: boolean;
}

/** 拼文件的进度:拼到几分之几 */
export interface VaultTold {
  told: number;
}

/** 线程的回音 */
export type VaultReply = { rid: number; ok: true; value: unknown } | { rid: number; ok: false; kind: VaultErrorKind; message: string };

const scope = self as unknown as { onmessage: ((e: { data: VaultCall }) => void) | null; postMessage(m: VaultReply | VaultTold): void };

let chain: Promise<unknown> = Promise.resolve();

scope.onmessage = (e) => {
  const { rid, op, args, told } = e.data;
  chain = chain.then(async () => {
    try {
      watchParts(told ? (share) => scope.postMessage({ told: share }) : null);
      const value = await (vaultOps[op] as (...a: unknown[]) => Promise<unknown>)(...args);
      scope.postMessage({ rid, ok: true, value });
    } catch (err) {
      const v = asVaultError(err);
      scope.postMessage({ rid, ok: false, kind: v.kind, message: v.message });
    }
  });
};
