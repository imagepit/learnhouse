import { getAPIUrl } from '@services/config/config'

const submissionStatuses = [
  'NOT_SUBMITTED',
  'PENDING',
  'SUBMITTED',
  'LATE',
  'GRADED',
] as const

type SubmissionStatus = typeof submissionStatuses[number]

type GradebookAssignment = {
  assignment_uuid: string
  title: string
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
    && Array.isArray(value.assignments)
    && value.assignments.every((assignment: unknown) =>
      isRecord(assignment)
      && typeof assignment.assignment_uuid === 'string'
      && typeof assignment.title === 'string'
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
