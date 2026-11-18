import { getAPIUrl } from '@services/config/config'

const submissionStatuses = [
  'NOT_SUBMITTED',
  'PENDING',
  'SUBMITTED',
  'LATE',
  'GRADED',
] as const

type SubmissionStatus = typeof submissionStatuses[number]

type GradebookChapter = {
  id: number
  name: string
}

type GradebookAssignment = {
  assignment_uuid: string
  title: string
  chapter_id: number | null
  max_grade: number
  ungraded: boolean
}

type GradebookResult = {
  assignment_uuid: string
  status: SubmissionStatus
  display_grade: string | null
}

type GradebookLearner = {
  user_id: number
  username: string
  results: GradebookResult[]
}

type CourseGradebook = {
  chapters: GradebookChapter[]
  assignments: GradebookAssignment[]
  learners: GradebookLearner[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isResult(value: unknown): value is GradebookResult {
  return isRecord(value)
    && typeof value.assignment_uuid === 'string'
    && submissionStatuses.some(status => status === value.status)
    && (typeof value.display_grade === 'string' || value.display_grade === null)
}

function isGradebook(value: unknown): value is CourseGradebook {
  return isRecord(value)
    && Array.isArray(value.chapters)
    && value.chapters.every((chapter: unknown) =>
      isRecord(chapter)
      && typeof chapter.id === 'number'
      && typeof chapter.name === 'string',
    )
    && Array.isArray(value.assignments)
    && value.assignments.every((assignment: unknown) =>
      isRecord(assignment)
      && typeof assignment.assignment_uuid === 'string'
      && typeof assignment.title === 'string'
      && (typeof assignment.chapter_id === 'number' || assignment.chapter_id === null)
      && typeof assignment.max_grade === 'number'
      && typeof assignment.ungraded === 'boolean',
    )
    && Array.isArray(value.learners)
    && value.learners.every((learner: unknown) =>
      isRecord(learner)
      && typeof learner.user_id === 'number'
      && typeof learner.username === 'string'
      && Array.isArray(learner.results)
      && learner.results.every(isResult),
    )
}

export async function getCourseGradebook(courseUuid: string, token: string) {
  const response = await fetch(
    `${getAPIUrl()}courses/${encodeURIComponent(courseUuid)}/gradebook`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    },
  )
  if (!response.ok) throw new Error('Could not load course gradebook')

  const data: unknown = await response.json()
  if (!isGradebook(data)) throw new Error('Invalid course gradebook')
  return data
}

export function gradebookCSV(rows: readonly (readonly string[])[]): string {
  const csv = rows.map(row => row.map(value => {
    // Quoting alone does not prevent spreadsheet formula execution.
    const safe = /^[\t\r\n]|^\s*[=+\-@＝＋－＠]/u.test(value) ? `'${value}` : value
    return `"${safe.replaceAll('"', '""')}"`
  }).join(',')).join('\r\n')
  return `\uFEFF${csv}\r\n`
}

type CourseReportCohort = {
  group_id: number
  company: string
  session: string
}

function isReportCohort(value: unknown): value is CourseReportCohort {
  return isRecord(value)
    && typeof value.group_id === 'number'
    && typeof value.company === 'string'
    && typeof value.session === 'string'
}

export async function getCourseReportCohorts(courseUuid: string, token: string) {
  const response = await fetch(
    `${getAPIUrl()}courses/${encodeURIComponent(courseUuid)}/gradebook/report-cohorts`,
    { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
  )
  if (!response.ok) throw new Error('Could not load report cohorts')
  const data: unknown = await response.json()
  if (!Array.isArray(data) || !data.every(isReportCohort)) throw new Error('Invalid report cohorts')
  return data
}

export type CourseReportFormat = 'csv' | 'pdf'

export async function getCourseReport({
  courseUuid, cohort, token, format,
}: { courseUuid: string; cohort: CourseReportCohort; token: string; format: CourseReportFormat }) {
  const url = `${getAPIUrl()}courses/${encodeURIComponent(courseUuid)}/gradebook/report.${format}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cohort),
    cache: 'no-store',
  })
  if (response.status === 409) return { status: 'cohort-conflict' } as const
  const mime = format === 'pdf' ? 'application/pdf' : 'text/csv'
  if (!response.ok || response.headers.get('Content-Type')?.split(';')[0] !== mime) {
    throw new Error('Could not download course report')
  }
  return { status: 'ready', file: await response.blob() } as const
}
