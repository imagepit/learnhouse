import { expect, test } from '../../../core/fixtures'
import { req } from '../../../core/client'
import { BASE_URL } from '../../../core/instance'
import { setupScenario } from '../scenario'

const heading = (level: number, text: string) => ({
  type: 'heading', attrs: { level }, content: [{ type: 'text', text }],
})
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

test('reads a lesson by section with stable Japanese headings and browser history', async ({ page }) => {
  const s = await setupScenario('section-reader', {
    courseName: '章リーダー検証',
    assignmentTitle: '確認クイズ',
    tasks: [],
  })
  const lesson = await req<{ activity_uuid: string; extra_metadata: unknown }>(
    'POST', `/activities/?coursechapter_id=${s.seeded.chapterId}&org_id=${s.org.id}`, s.adminToken,
    {
      name: 'Gitの基本操作',
      chapter_id: s.seeded.chapterId,
      activity_type: 'TYPE_DYNAMIC',
      activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE',
      extra_metadata: { reader_layout: 'sections' },
      published: true,
      content: { type: 'doc', content: [
        paragraph('H2より前の導入文'),
        heading(2, '作業の準備'),
        heading(3, '確認'),
        ...Array.from({ length: 46 }, (_, i) => paragraph(`作業の説明 ${i + 1} 行目`)),
        heading(3, '確認'),
        ...Array.from({ length: 25 }, (_, i) => paragraph(`続きの説明 ${i + 1} 行目`)),
        heading(2, '履歴を読む'),
        paragraph('ここではコミット履歴を読みます。'),
      ] },
    },
  )

  const url = `${BASE_URL}/course/${s.bareCourseUuid}/activity/${lesson.activity_uuid.replace('activity_', '')}`
  await page.goto(url)
  const body = page.locator('.lesson-section-body')
  const toc = page.locator('.lesson-section-toc-desktop')
  await expect(body.getByText('H2より前の導入文')).toBeVisible()
  await expect(body.getByRole('heading', { name: '履歴を読む' })).toHaveCount(0)
  const duplicates = toc.getByRole('link', { name: '確認', exact: true })
  await expect(duplicates).toHaveCount(2)
  expect(await duplicates.first().getAttribute('href')).not.toBe(await duplicates.last().getAttribute('href'))

  await duplicates.last().click()
  await expect(body.getByRole('heading', { name: '確認', exact: true }).last()).toBeFocused()
  await expect(duplicates.last()).toHaveAttribute('aria-current', 'location')
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(duplicates.last()).not.toHaveAttribute('aria-current', 'location')

  await body.getByRole('link', { name: /次のセクション.*履歴を読む/ }).click()
  const sectionHeading = body.getByRole('heading', { name: '履歴を読む' })
  await expect(sectionHeading).toBeFocused()
  const header = page.locator('[data-fixed-activity-bar]')
  await expect(header).toBeVisible()
  await expect.poll(async () => {
    const [bar, rail, heading] = await Promise.all([
      header.boundingBox(), toc.boundingBox(), sectionHeading.boundingBox(),
    ])
    if (!bar || !rail || !heading) return 0
    return Math.min(rail.y, heading.y) - (bar.y + bar.height)
  }).toBeGreaterThanOrEqual(24)
  await expect(body.getByText('H2より前の導入文')).toHaveCount(0)
  await page.reload()
  await expect(body.getByRole('heading', { name: '履歴を読む' })).toBeVisible()
  await page.goBack()
  await expect(body.getByRole('heading', { name: '作業の準備' })).toBeVisible()
  await page.goto(url + '#section=missing')
  await expect(body.getByRole('heading', { name: '作業の準備' })).toBeVisible()
})
