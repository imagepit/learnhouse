'use client'

import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Button } from '@components/ui/button'
import { getCourseGradebook, gradebookCSV } from '@services/courses/courseGradebook'

export default function EditCourseGradebook({ courseUuid }: { courseUuid: string }) {
  const { t } = useTranslation()
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

  const headers = [t(`${label}.learner`), ...data.assignments.map(assignment => assignment.title)]
  const rows = data.learners.map(learner => {
    const results = new Map(learner.results.map(result => [result.assignment_uuid, result]))
    const cells = data.assignments.map(assignment => {
      const result = results.get(assignment.assignment_uuid)
      if (result?.display_grade != null) return result.display_grade
      if (assignment.ungraded && (result?.status === 'SUBMITTED' || result?.status === 'LATE')) {
        return t(`${label}.status.ungraded`)
      }
      return t(`${label}.status.${(result?.status ?? 'NOT_SUBMITTED').toLowerCase()}`)
    })
    return { id: learner.user_id, cells: [learner.username, ...cells] }
  })

  function downloadCSV() {
    const csv = gradebookCSV([headers, ...rows.map(row => row.cells)])
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
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-start text-sm" aria-label={t('dashboard.courses.settings.tabs.gradebook')}>
          <thead className="border-b bg-gray-50">
            <tr>
              {headers.map((header, index) => (
                <th key={data.assignments[index - 1]?.assignment_uuid ?? 'learner'} scope="col" className="px-4 py-3 text-start">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id} className="border-b last:border-0">
                <th scope="row" className="px-4 py-3 text-start font-medium">{row.cells[0]}</th>
                {row.cells.slice(1).map((cell, index) => (
                  <td key={data.assignments[index].assignment_uuid} className="px-4 py-3">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
