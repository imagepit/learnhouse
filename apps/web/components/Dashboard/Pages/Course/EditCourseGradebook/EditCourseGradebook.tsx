'use client'

import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Button } from '@components/ui/button'
import { getCourseGradebook, gradebookCSV } from '@services/courses/courseGradebook'

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
    return <p role="status" className="p-4 sm:p-8">{t(`${label}.empty`)}</p>
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
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `gradebook-${courseUuid}.csv`
    link.click()
    // Let the browser start reading the object URL before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <section className="space-y-4 p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('dashboard.courses.settings.tabs.gradebook')}</h2>
        <Button type="button" onClick={downloadCSV}>{t(`${label}.download`)}</Button>
      </div>
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
