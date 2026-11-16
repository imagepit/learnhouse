const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const courseId = new RegExp('^course_' + uuid + '$')
const activityId = new RegExp('^activity_' + uuid + '$')
const attachmentId = new RegExp('^' + uuid + '$')

export function httpsImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^https:\/\/[^\s<>"'\\]{1,2040}$/i.test(value)) {
    return undefined
  }
  try {
    const url = new URL(value)
    if (url.hostname && !url.username && !url.password) return url.href
  } catch {
    return undefined
  }
}

export function activityImageUrl(
  attrs: { outlineAttachmentId?: unknown; externalUrl?: unknown },
  courseUuid?: string,
  activityUuid?: string,
): string | undefined {
  if (attrs.outlineAttachmentId != null) {
    if (
      typeof attrs.outlineAttachmentId === 'string' &&
      attachmentId.test(attrs.outlineAttachmentId) &&
      courseUuid && courseId.test(courseUuid) &&
      activityUuid && activityId.test(activityUuid)
    ) {
      return '/api/v1/courses/' + courseUuid + '/activities/' +
        activityUuid + '/outline-images/' + attrs.outlineAttachmentId
    }
    return undefined
  }
  return httpsImageUrl(attrs.externalUrl)
}
