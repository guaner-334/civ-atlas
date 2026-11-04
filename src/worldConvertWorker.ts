/** 把现有的世界转进世界仓库的后台线程:一个线程转一个世界,转完就被关掉;用的人要推演时也是直接关掉,写到一半的不算数(worldConvert.ts、ui/worldStore.ts) */
import { runConvert, type ConvertJob } from './worldConvert';
import { asVaultError, type CommitResult, type VaultErrorKind } from './worldVault';

/** 转的结果 */
export type ConvertReply = { ok: true; result: CommitResult } | { ok: false; kind: VaultErrorKind; message: string };

const scope = self as unknown as { onmessage: ((e: { data: ConvertJob }) => void) | null; postMessage(m: ConvertReply): void };

scope.onmessage = (e) => {
  void runConvert(e.data).then(
    (result) => scope.postMessage({ ok: true, result }),
    (err: unknown) => {
      const v = asVaultError(err);
      scope.postMessage({ ok: false, kind: v.kind, message: v.message });
    },
  );
};
