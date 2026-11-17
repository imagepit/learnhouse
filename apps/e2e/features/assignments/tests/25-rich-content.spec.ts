import { test, expect } from '../../../core/fixtures'
import { ADMIN_STATE, STUDENT_STATE } from '../../../core/sharedAuth'
import { req } from '../../../core/client'
import { BASE_URL } from '../../../core/instance'
import { getAssignment, login, TaskContents } from '../api'
import { AssignmentPage } from '../pages/student'
import { AssignmentEditorPage } from '../pages/teacher'
import { setupScenario } from '../scenario'

test.use({ storageState: STUDENT_STATE })

const content = [
  ':::note Check the repository', 'Start with the current branch.', ':::',
  '', ':::step', '1. Inspect the status', '1. Review the changes', ':::',
  '', '```tree', '.', '└── README.md', '```',
  '', '```mermaid', 'flowchart LR', '  A["Local <branch>"] --> B[Remote]', '```',
  '', '```bash', '//highlightstart', 'git status # <--[Look for changes]', '//highlightend', '```',
].join('\n')
const solution = '## Worked answer for the release quiz\n\n' + content

test('teacher previews and saves rich content; a learner unlocks it after grading', async ({ page, browser }, info) => {
  const [question] = TaskContents.quiz('a').questions
  const task = { questions: [{ ...question, questionText: 'Which command checks the current state?' }] }
  const s = await setupScenario('rich-content', {
    courseName: 'Rich Git course',
    assignmentTitle: 'Rich Git quiz',
    autoGrading: true,
    tasks: [{ title: 'Repository check', assignment_type: 'QUIZ', contents: task }],
  })
  const admin = await browser.newContext({ storageState: ADMIN_STATE })
  try {
    const teacher = await admin.newPage()
    await new AssignmentEditorPage(teacher).open(s.bareAssignmentUuid)
    await teacher.getByRole('combobox', { name: 'Text format' }).selectOption('markdown')
    await teacher.getByRole('textbox', { name: 'Question', exact: true }).fill('**Which command checks the current state?**')
    await teacher.getByRole('button', { name: 'Preview', exact: true }).last().click()
    await expect(teacher.locator('.lh-rich-markdown strong')).toHaveText('Which command checks the current state?')
    await teacher.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(teacher.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
    await teacher.getByRole('button', { name: 'Edit settings' }).click()
    const dialog = teacher.getByRole('dialog', { name: 'Edit Assignment' })
    const formats = dialog.getByRole('combobox', { name: 'Text format' })
    await expect(formats).toHaveCount(2)
    await formats.nth(0).selectOption('markdown')
    await formats.nth(1).selectOption('markdown')
    await dialog.getByRole('textbox', { name: 'Assignment Description', exact: true }).fill(content)
    await dialog.getByPlaceholder('Write the worked solution learners should compare their work against…').fill(solution)
    await dialog.getByRole('button', { name: 'After grading' }).click()
    await dialog.getByRole('button', { name: 'Preview', exact: true }).first().click()
    const preview = dialog.locator('.lh-rich-markdown')
    await expect(preview.getByText('Check the repository', { exact: true })).toBeVisible()
    await expect(preview.getByText('README.md', { exact: true })).toBeVisible()
    await expect(preview.getByText(/Review the changes/)).toBeVisible()
    await expect(dialog.locator('.lh-rich-diagram svg')).toBeVisible()
    await expect(preview.getByText('Local <branch>', { exact: true })).toBeVisible()
    await expect(dialog.locator('.line--highlight')).toContainText('Look for changes')
    await info.attach('teacher-preview', { body: await dialog.screenshot(), contentType: 'image/png' })
    await dialog.getByRole('button', { name: 'Save Changes' }).click()
    await expect(dialog).toBeHidden()
    await teacher.getByRole('button', { name: 'Edit settings' }).click()
    await expect(formats.nth(1)).toHaveValue('markdown')
    await expect(dialog.getByPlaceholder('Write the worked solution learners should compare their work against…')).toHaveValue(solution)
  } finally {
    await admin.close()
  }

  const studentToken = await login(s.student.email, s.student.password)
  const view = new AssignmentPage(page)
  await view.open(s.bareCourseUuid, s.bareActivityUuid)
  await expect(page.getByText('Check the repository')).toBeVisible()
  const explanation = page.getByRole('heading', { name: 'Answers and explanations' })
  const before = await getAssignment(studentToken, s.seeded.assignmentUuid)
  expect(before.solution).toBeNull()
  expect(before.solution_format).toBeNull()
  await expect(explanation).toHaveCount(0)
  await view.answerQuiz('A')
  await view.saveProgress()
  await expect(explanation).toHaveCount(0)
  await info.attach('learner-before', { body: await page.screenshot(), contentType: 'image/png' })
  await view.submitForGrading()
  await view.expectGraded(100)
  const closeResult = page.getByRole('button', { name: 'Close dialog' })
  if (await closeResult.isVisible()) await closeResult.click()
  await expect(explanation).toBeVisible()
  const after = await getAssignment(studentToken, s.seeded.assignmentUuid)
  expect(after.solution_format).toBe('markdown')
  expect(after.solution).toBe(solution)
  expect(await page.getByText('Which command checks the current state?', { exact: true }).evaluate(
    (question, heading) => Boolean(question.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING),
    await explanation.elementHandle(),
  )).toBe(true)
  await expect(page.getByRole('heading', { name: 'Worked answer for the release quiz' })).toBeVisible()
  await explanation.scrollIntoViewIfNeeded()
  await info.attach('learner-graded', { body: await page.screenshot(), contentType: 'image/png' })
})

test('answering a 60-question quiz leaves its diagrams in place', async ({ page }, info) => {
  const [template] = TaskContents.quiz('a').questions
  const diagram = '\n\n```mermaid\nflowchart LR\n A[Local] --> B[Remote]\n```'
  const questions = Array.from({ length: 60 }, (_, index) => ({
    ...template,
    questionUUID: `q-${index}`,
    questionText: `Question ${index + 1}` + (index < 3 ? diagram : ''),
    questionTextFormat: 'markdown',
  }))
  const s = await setupScenario('rich-content-performance', {
    courseName: 'Rich Git performance course',
    assignmentTitle: 'Sixty question quiz',
    autoGrading: true,
    tasks: [{ title: 'Repository check', assignment_type: 'QUIZ', contents: { questions } }],
  })
  const view = new AssignmentPage(page)
  const start = performance.now()
  await view.open(s.bareCourseUuid, s.bareActivityUuid)
  const diagrams = page.locator('.lh-rich-diagram svg')
  await expect(diagrams).toHaveCount(3)
  const elapsed = Math.round(performance.now() - start)
  const originals = await diagrams.elementHandles()
  await view.answerQuiz('A')
  await expect(diagrams).toHaveCount(3)
  for (const [index, original] of originals.entries()) {
    expect(await diagrams.nth(index).evaluate((svg, oldSvg) => svg.isSameNode(oldSvg), original)).toBe(true)
  }
  await info.attach('diagram-measurement', {
    body: `60 questions; 3 figures; initial display ${elapsed} ms; 0 replaced SVGs after an answer`,
    contentType: 'text/plain',
  })
})

test('teacher previews and saves a page exercise that a learner can read', async ({ page, browser }) => {
  const s = await setupScenario('rich-page', {
    courseName: 'Rich Git page course',
    assignmentTitle: 'Practice companion',
    tasks: [],
  })
  const exercise = await req<{ activity_uuid: string }>(
    'POST', `/activities/?coursechapter_id=${s.seeded.chapterId}&org_id=${s.org.id}`, s.adminToken,
    {
      name: 'Rich Git exercise',
      chapter_id: s.seeded.chapterId,
      activity_type: 'TYPE_DYNAMIC',
      activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE',
      published: true,
      content: { type: 'doc', content: [{ type: 'blockRichMarkdown', attrs: { source: content } }] },
    },
  )
  const activityId = exercise.activity_uuid.replace(/^activity_/, '')
  const admin = await browser.newContext({ storageState: ADMIN_STATE })
  try {
    const teacher = await admin.newPage()
    await teacher.goto(`${BASE_URL}/course/${s.bareCourseUuid}/activity/${activityId}/edit`)
    const field = teacher.getByRole('textbox', { name: 'Markdown', exact: true })
    await field.fill(content + '\n\nThe exercise was updated.')
    await teacher.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect(teacher.locator('.lh-rich-markdown').getByText('The exercise was updated.')).toBeVisible()
    await teacher.getByText('Save', { exact: true }).first().click()
    await expect.poll(async () => {
      const saved = await req<{ content: unknown }>('GET', `/activities/${exercise.activity_uuid}`, s.adminToken)
      return JSON.stringify(saved.content)
    }).toContain('The exercise was updated.')
  } finally {
    await admin.close()
  }
  await page.goto(`${BASE_URL}/course/${s.bareCourseUuid}/activity/${activityId}`)
  await expect(page.getByRole('heading', { name: 'Rich Git exercise', exact: true })).toBeVisible()
  const block = page.locator('.lh-rich-markdown')
  await expect(block.getByText('Check the repository')).toBeVisible()
  await expect(block.getByText('The exercise was updated.')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Markdown' })).toHaveCount(0)
  await expect(block.locator('.lh-rich-diagram svg')).toBeVisible()
})
