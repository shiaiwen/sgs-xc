/** 附件在工单处理完成后保留 30 天；进行中的工单和人工保留的资料不参与清理。 */
export const FEEDBACK_ATTACHMENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** 两种结束状态共用一个保留期，结束状态互换不重新计时。 */
export function isFeedbackCompleted(ticket) {
  return ticket.status === 'fixed' || ticket.status === 'rejected';
}

/** 状态更新时维护完成时间；重新打开会取消计时，再次结束才开始新的保留期。 */
export function feedbackCompletedAt(current, next, now) {
  if (!isFeedbackCompleted(next)) return null;
  if (isFeedbackCompleted(current) && Number.isFinite(current.completedAt) && current.completedAt > 0) {
    return current.completedAt;
  }
  return now;
}

/** 后补上传的附件也获得完整保留期；已经清理的附件不因重开或保留标记恢复。 */
export function feedbackAttachmentExpiresAt(ticket, attachment) {
  if (!isFeedbackCompleted(ticket) || ticket.retainAttachments === true || attachment.deletedAt) return null;
  if (!Number.isFinite(ticket.completedAt) || ticket.completedAt <= 0) return null;
  const uploadedAt = Number.isFinite(attachment.createdAt) ? attachment.createdAt : 0;
  return Math.max(ticket.completedAt, uploadedAt) + FEEDBACK_ATTACHMENT_RETENTION_MS;
}
