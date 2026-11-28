import { cleanupFeedbackAttachments } from './store.js';

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 服务监听成功后先检查一次，再每天清理；失败只记录，避免影响工单接口。 */
export function startFeedbackAttachmentCleanup() {
  const run = () => {
    try {
      const result = cleanupFeedbackAttachments();
      if (result.deleted || result.initialized) {
        console.log(`[feedback] 附件清理：${result.deleted} 个，${result.reclaimedBytes} 字节，补记完成时间 ${result.initialized} 张工单`);
      }
      for (const error of result.errors) console.warn('[feedback] 附件清理失败，稍后重试', error);
    } catch (error) {
      console.warn('[feedback] 附件清理失败，稍后重试', error.message);
    }
  };
  run();
  const timer = setInterval(run, CLEANUP_INTERVAL_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
