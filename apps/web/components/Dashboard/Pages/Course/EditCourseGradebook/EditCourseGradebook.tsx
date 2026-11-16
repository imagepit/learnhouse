'use client'

import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Button } from '@components/ui/button'
import {
  getCourseGradebook,
  getCourseReportCohorts,
  getCourseReportPDF,
  gradebookCSV,
} from '@services/courses/courseGradebook'

function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Let the browser start reading the object URL before releasing it.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function CourseReportDownload({ courseUuid, token }: { courseUuid: string; token: string }) {
  const { t } = useTranslation()
  const heading = useId()
  const [company, setCompany] = useState('')
  const [session, setSession] = useState('')
  const [isDownloading, setIsDownloading] = useState(false)
  const [error, setError] = useState<'download_error' | 'conflict'>()
  const { data, isLoading, error: cohortError } = useSWR(
    ['course-report-cohorts', courseUuid, token],
    ([, uuid, accessToken]) => getCourseReportCohorts(uuid, accessToken),
    { shouldRetryOnError: false },
  )
  const label = 'dashboard.courses.settings.gradebook.report'
  const companies = [...new Set(data?.map(cohort => cohort.company))]
  const sessions = data?.filter(cohort => cohort.company === company) ?? []
  const cohort = sessions.find(item => String(item.group_id) === session)

  async function downloadPDF() {
    if (!cohort) return
    setError(undefined)
    setIsDownloading(true)
    try {
      const result = await getCourseReportPDF(courseUuid, cohort, token)
      if (result.status === 'cohort-conflict') {
        setError('conflict')
        return
      }
      downloadFile(result.pdf, `course-report-${cohort.group_id}.pdf`)
    } catch {
      setError('download_error')
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <section aria-labelledby={heading} className="space-y-3 rounded-lg border bg-white p-4">
      <h3 id={heading} className="font-semibold">{t(`${label}.title`)}</h3>
      {isLoading && <p role="status" className="text-sm">{t(`${label}.loading`)}</p>}
      {cohortError && <p role="alert" className="text-sm">{t(`${label}.load_error`)}</p>}
      {data?.length === 0 && <p className="text-sm text-gray-600">{t(`${label}.empty`)}</p>}
      {companies.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-0 max-w-full gap-1 text-sm font-medium">
            {t(`${label}.company`)}
            <select
              className="w-64 max-w-full rounded-md border bg-white px-3 py-2"
              value={company}
              disabled={isDownloading}
              onChange={event => {
                setCompany(event.target.value)
                setSession('')
                setError(undefined)
              }}
            >
              <option value="">{t(`${label}.choose_company`)}</option>
              {companies.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="grid min-w-0 max-w-full gap-1 text-sm font-medium">
            {t(`${label}.session`)}
            <select
              className="w-64 max-w-full rounded-md border bg-white px-3 py-2 disabled:bg-gray-50"
              value={session}
              disabled={!company || isDownloading}
              onChange={event => {
                setSession(event.target.value)
                setError(undefined)
              }}
            >
              <option value="">{t(`${label}.choose_session`)}</option>
              {sessions.map(item => (
                <option key={item.group_id} value={String(item.group_id)}>{item.session}</option>
              ))}
            </select>
          </label>
          <Button type="button" disabled={!cohort || isDownloading} onClick={downloadPDF}>
            {t(`${label}.${isDownloading ? 'downloading' : 'download'}`)}
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{t(`${label}.${error}`)}</p>}
    </section>
  )
}

export default function EditCourseGradebook({ courseUuid }: { courseUuid: string }) {
  const { t } = useTranslation()
  const chapterSelectId = useId()
  const [selectedChapter, setSelectedChapter] = useState<string>()
  const token = useLHSession()?.data?.tokens?.access_token
  const { data, error, isLoading } = useSWR(
    token ? ['course-gradebook', courseUuid, token] : null,
    ([, uuid, accessToken]) => getCourseGradebook(uuid, accessToken),
    { shouldRetryOnError: false },
  )
  const label = 'dashboard.courses.settings.gradebook'

  if (isLoading || !token) return <p role="status" className="p-4 sm:p-8">{t(`${label}.loading`)}</p>
  if (error || !data) return <p role="alert" className="p-4 sm:p-8">{t(`${label}.error`)}</p>
  if (!data.learners.length || !data.assignments.length) {
    return (
      <div className="space-y-4 p-4 sm:p-8">
        <CourseReportDownload courseUuid={courseUuid} token={token} />
        <p role="status">{t(`${label}.empty`)}</p>
      </div>
    )
  }

  const { assignments, learners } = data
  const assignmentsByChapter = new Map<string, typeof assignments>()
  for (const assignment of assignments) {
    const key = assignment.chapter_id === null ? 'unassigned' : String(assignment.chapter_id)
    const group = assignmentsByChapter.get(key)
    if (group) group.push(assignment)
    else assignmentsByChapter.set(key, [assignment])
  }
  const chapters = data.chapters
    .map(chapter => ({ key: String(chapter.id), name: chapter.name }))
    .filter(chapter => assignmentsByChapter.has(chapter.key))
  if (assignmentsByChapter.has('unassigned')) {
    chapters.push({ key: 'unassigned', name: t(`${label}.unassigned`) })
  }

  const chapter = chapters.find(chapter => chapter.key === selectedChapter) ?? chapters[0]
  const visibleAssignments = assignmentsByChapter.get(chapter.key) ?? []
  const learnerLabel = t(`${label}.learner`)

  function makeRows(columns: typeof assignments) {
    return learners.map(learner => {
      const results = new Map(learner.results.map(result => [result.assignment_uuid, result]))
      const cells = columns.map(assignment => {
        const result = results.get(assignment.assignment_uuid)
        if (result?.display_grade != null) return result.display_grade
        if (assignment.ungraded && (result?.status === 'SUBMITTED' || result?.status === 'LATE')) {
          return t(`${label}.status.ungraded`)
        }
        return t(`${label}.status.${(result?.status ?? 'NOT_SUBMITTED').toLowerCase()}`)
      })
      return { id: learner.user_id, username: learner.username, cells }
    })
  }

  const rows = makeRows(visibleAssignments)

  function downloadCSV() {
    const headers = [learnerLabel, ...assignments.map(assignment => assignment.title)]
    const csv = gradebookCSV([
      headers,
      ...makeRows(assignments).map(row => [row.username, ...row.cells]),
    ])
    downloadFile(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `gradebook-${courseUuid}.csv`)
  }

  return (
    <section className="space-y-4 p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('dashboard.courses.settings.tabs.gradebook')}</h2>
        <Button type="button" onClick={downloadCSV}>{t(`${label}.download`)}</Button>
      </div>
      <CourseReportDownload courseUuid={courseUuid} token={token} />
      {chapters.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={chapterSelectId} className="text-sm font-medium">{t(`${label}.chapter`)}</label>
          <select
            id={chapterSelectId}
            className="w-full max-w-sm rounded-md border bg-white px-3 py-2 text-sm sm:w-auto"
            value={chapter.key}
            onChange={event => setSelectedChapter(event.target.value)}
          >
            {chapters.map(option => <option key={option.key} value={option.key}>{option.name}</option>)}
          </select>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-start text-sm" aria-label={t('dashboard.courses.settings.tabs.gradebook')}>
          <thead className="border-b bg-gray-50">
            <tr>
              <th scope="col" className="sticky start-0 min-w-32 bg-gray-50 px-4 py-3 text-start">
                {learnerLabel}
              </th>
              {visibleAssignments.map(assignment => (
                <th key={assignment.assignment_uuid} scope="col" className="min-w-40 px-4 py-3 text-start">
                  {assignment.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id} className="border-b last:border-0">
                <th scope="row" className="sticky start-0 bg-white px-4 py-3 text-start font-medium">{row.username}</th>
                {row.cells.map((cell, index) => (
                  <td key={visibleAssignments[index].assignment_uuid} className="px-4 py-3">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
