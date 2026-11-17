import { test, expect } from '../../../core/fixtures'
import { req } from '../../../core/client'
import { STUDENT_STATE } from '../../../core/sharedAuth'
import { setupScenario } from '../scenario'
import { AssignmentPage } from '../pages/student'
import { getUserSubmission } from '../api'

test.use({ storageState: STUDENT_STATE })

test('saves one question at a time, resumes after reload, and grades once at the end', async ({ page }, info) => {
  const questions = Array.from({ length: 10 }, (_, index) => ({
    questionUUID: `question-${index}`,
    questionText: `Sequential prompt ${index + 1}`,
    response_type: index === 1 ? 'multiple' : 'single',
    options: ['a', 'b', 'c'].map((optionUUID, optionIndex) => ({
      optionUUID,
      text: `Option ${optionUUID}`,
      assigned_right_answer: optionIndex === 0 || (index === 1 && optionIndex === 1),
    })),
  }))
  const s = await setupScenario('sequential-quiz', {
    courseName: 'Sequential quiz course',
    assignmentTitle: 'Ten question quiz',
    autoGrading: true,
    allowRetries: true,
    maxRetries: 2,
    tasks: [{ title: 'Quiz', assignment_type: 'QUIZ', contents: { questions } }],
  })
  const view = new AssignmentPage(page)
  await view.open(s.bareCourseUuid, s.bareActivityUuid)

  const next = page.getByRole('button', { name: 'Next question' })
  const position = (index: number) => page.getByRole('heading', { name: `Question ${index}/10` })
  await expect(position(1)).toBeVisible()
  await expect(page.getByText('Sequential prompt 2', { exact: true })).toHaveCount(0)
  await expect(next).toBeDisabled()
  await next.scrollIntoViewIfNeeded()
  await info.attach('desktop-question', { body: await page.screenshot(), contentType: 'image/png' })

  const submitPath = `**/assignments/${s.seeded.assignmentUuid}/submissions`
  const attemptedSubmits: string[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith(`/assignments/${s.seeded.assignmentUuid}/submissions`)) {
      attemptedSubmits.push(request.url())
    }
  })
  await view.submitForGrading()
  await expect(page.getByText('Wait for the quiz to load and answer all questions before submitting.')).toBeVisible()
  expect(attemptedSubmits).toHaveLength(0)

  const savePath = `**/assignments/${s.seeded.assignmentUuid}/tasks/*/submissions`
  await page.route(savePath, route => route.request().method() === 'PUT' ? route.abort() : route.continue())
  await view.answerQuiz('A')
  await next.click()
  await expect(next).toBeEnabled()
  await expect(position(1)).toBeVisible()
  await expect(page.getByRole('radio', { name: /Option a/ })).toBeChecked()
  await page.unroute(savePath)
  await next.click()
  await expect(position(2)).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(position(2)).toBeVisible()
  await next.scrollIntoViewIfNeeded()
  await info.attach('mobile-resumed-question', { body: await page.screenshot(), contentType: 'image/png' })
  await view.answerQuiz('A')
  await view.answerQuiz('B')
  await next.click()

  for (let index = 3; index <= questions.length; index++) {
    await expect(position(index)).toBeVisible()
    await view.answerQuiz('A')
    await (index === questions.length ? page.getByRole('button', { name: 'Save last answer' }) : next).click()
  }

  await expect(page.getByRole('heading', { name: 'All answers saved' })).toBeVisible()
  await page.route(submitPath, route => route.request().method() === 'POST' ? route.abort() : route.continue())
  await view.submitForGrading()
  await expect(page.getByRole('heading', { name: 'All answers saved' })).toBeVisible()
  await page.unroute(submitPath)
  await view.submitForGrading()
  await view.expectGraded(100)
  expect(attemptedSubmits).toHaveLength(2)
  const submission = await getUserSubmission(s.seeded.assignmentUuid, s.studentId, s.adminToken)
  expect(submission.submission_status).toBe('GRADED')
  expect(submission.grade).toBe(100)

  await view.retry()
  await expect(position(1)).toBeVisible()
  await expect(next).toBeDisabled()
  await req('PUT', `/assignments/${s.seeded.assignmentUuid}`, s.adminToken, { due_date: '2020-01-01T00:00:00Z' })
  await page.reload()
  await expect(page.getByText('Deadline passed', { exact: true }).first()).toBeVisible()
  await expect(next).toBeDisabled()
  await expect(page.getByRole('radio', { name: /Option a/ })).toBeDisabled()
})
