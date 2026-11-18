import { chromium, expect, type Browser, type BrowserContext, type Page, type Request } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL, makeStudent } from '../../../core/instance'
import { req } from '../../../core/client'
import * as assignments from '../api'
import { AssignmentPage } from '../pages/student'

const root = process.env.LH_LOAD_DIRECTORY
if (!root || !process.env.E2E_BASE_URL) throw new Error('Set LH_LOAD_DIRECTORY and E2E_BASE_URL for the isolated test instance')
const origin = new URL(BASE_URL).origin
const trustedHost = process.env.LH_LOAD_TARGET ?? 'localhost:18222'
if (new URL(BASE_URL).host !== trustedHost) throw new Error('E2E_BASE_URL does not match the explicit test target')

type Seeded = Awaited<ReturnType<typeof assignments.seedAssignment>>
type Learner = { id: number; index: number }
type Login = { id: number; email: string; password: string }
type Fixture = {
  course: string; lesson: string; quiz: string; assignment: string; task: string; learners: Learner[]
}
type RunMode = 'view' | 'mixed' | 'serial'
type Operation = 'initial_display' | 'all_images' | 'answer_save' | 'submit_grade' | 'verify'
type Observation = {
  kind: 'operation'; run: string; operation: Operation; learner: number
  start: number; ms: number; ok: boolean; detail?: string
} | {
  kind: 'request'; run: string; route: string; learner: number
  start: number; ms: number; status: number
} | {
  kind: 'wave'; run: string; mode: RunMode; people: number; overlappingSubmits: number; submitSpreadMs: number
}
type Subject = {
  learner: Learner; page: Page; context: BrowserContext; view: AssignmentPage
  measureAs: (run: string) => Promise<void>
}

const sections = ['作業の準備', '履歴を読む', '差分を確認する']
const questions = Array.from({ length: 10 }, (_, index) => ({
  questionUUID: `question-${index}`,
  questionText: `Which step belongs to exercise ${index + 1}?`,
  response_type: 'single',
  options: ['a', 'b'].map((optionUUID, i) => ({ optionUUID, text: `Option ${optionUUID}`, assigned_right_answer: i === 0 })),
}))
const bare = (id: string) => id.replace(/^(course|activity)_/, '')
const file = (name: string) => join(root, name)
const results = file('observations.jsonl')
const idValue = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9_-]+$/i.test(v)

function parseFixture(v: unknown): Fixture {
  if (typeof v !== 'object' || v === null || !('course' in v) || !('lesson' in v) ||
      !('quiz' in v) || !('assignment' in v) || !('task' in v) || !('learners' in v) ||
      !idValue(v.course) || !idValue(v.lesson) || !idValue(v.quiz) || !idValue(v.assignment) ||
      !idValue(v.task) || !Array.isArray(v.learners)) throw new Error('Malformed fixture')
  const learners = v.learners.map((row: unknown) => {
    if (typeof row !== 'object' || row === null || !('id' in row) || !('index' in row) ||
        typeof row.id !== 'number' || typeof row.index !== 'number' ||
        !Number.isInteger(row.id) || !Number.isInteger(row.index)) throw new Error('Malformed learner')
    return { id: row.id, index: row.index }
  })
  return { course: v.course, lesson: v.lesson, quiz: v.quiz, assignment: v.assignment, task: v.task, learners }
}

async function preparedAccounts(): Promise<Login[] | undefined> {
  const accountFile = process.env.LH_LOAD_LEARNERS_FILE
  if (!accountFile) return undefined
  const parsed: unknown = JSON.parse(await readFile(accountFile, 'utf8'))
  if (!Array.isArray(parsed) || parsed.length !== 20) throw new Error('Provide exactly 20 test accounts')
  const accounts = parsed.map((row: unknown) => {
    if (typeof row !== 'object' || row === null || !('id' in row) || !('email' in row) || !('password' in row) ||
        typeof row.id !== 'number' || !Number.isSafeInteger(row.id) ||
        typeof row.email !== 'string' || !row.email.includes('@') ||
        typeof row.password !== 'string' || !row.password) throw new Error('Malformed test account')
    return { id: row.id, email: row.email, password: row.password }
  })
  if (new Set(accounts.map(row => row.id)).size !== accounts.length ||
      new Set(accounts.map(row => row.email)).size !== accounts.length) throw new Error('Test accounts must be distinct')
  return accounts
}

async function prepare(browser: Browser) {
  const accounts = await preparedAccounts()
  const token = await assignments.login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const org = await assignments.getOrg()
  const seeded: Seeded = await assignments.seedAssignment(token, org, {
    courseName: 'CORE-222 Load Test', assignmentTitle: 'Git quiz',
    autoGrading: true, allowRetries: true, maxRetries: 0,
    tasks: [{ title: 'Git questions', assignment_type: 'QUIZ', contents: { questions } }],
  })
  const ids = Array.from({ length: 89 }, () => randomUUID())
  const imageData = [...ids, ids[0]]
  const lesson = await req<{ activity_uuid: string }>(
    'POST', `/activities/?coursechapter_id=${seeded.chapterId}&org_id=${org.id}`, token,
    {
      name: 'Gitの基本操作', chapter_id: seeded.chapterId, activity_type: 'TYPE_DYNAMIC',
      activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE', published: true, extra_metadata: { reader_layout: 'sections' },
      content: { type: 'doc', content: sections.flatMap((text, chapter) => [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] },
        ...imageData.slice(chapter * 30, chapter * 30 + 30).map((outlineAttachmentId, index) => ({
          type: 'blockImage', attrs: { outlineAttachmentId, alt: `Exercise image ${chapter * 30 + index + 1}` },
        })),
      ]) },
    },
  )
  await writeFile(file('catalog.json'), JSON.stringify({
    version: 1,
    images: ids.map((attachment_id, i) => ({
      course_uuid: seeded.courseUuid, activity_uuid: lesson.activity_uuid, attachment_id,
      object_key: `uploads/image-${i}.png`, content_type: 'image/png',
    })),
  }))
  const learners: Learner[] = []
  for (let index = 0; index < 20; index++) {
    const student = makeStudent(`core222${index}`)
    const login = accounts?.[index] ?? { ...student, id: await assignments.createStudent(token, org.id, student) }
    const context = await browser.newContext({ locale: 'en-US' })
    try {
      const adminIndependentLogin = await context.request.post(`${origin}/api/auth/login`, {
        headers: { origin }, form: { username: login.email, password: login.password },
      })
      if (!adminIndependentLogin.ok()) throw new Error(`Fixture login failed: HTTP ${adminIndependentLogin.status()}`)
      const state = await context.storageState()
      if (!state.cookies.some(c => c.name === 'LH_session')) throw new Error('Session marker missing')
      await writeFile(file(`session-${index}.json`), JSON.stringify(state), { mode: 0o600 })
    } finally {
      await context.close()
    }
    learners.push({ id: login.id, index })
  }
  await writeFile(file('fixture.json'), JSON.stringify({
    course: bare(seeded.courseUuid), lesson: bare(lesson.activity_uuid), quiz: bare(seeded.activityUuid),
    assignment: seeded.assignmentUuid, task: seeded.taskUuids[0], learners,
  } satisfies Fixture), { mode: 0o600 })
  process.stdout.write(JSON.stringify({ learners: learners.length, imageReferences: imageData.length, quizQuestions: questions.length }) + '\n')
}

function classify(request: Request, assignment: string): string | undefined {
  const url = new URL(request.url())
  const path = url.pathname
  if (url.origin !== origin) return request.resourceType() === 'image' && path.includes('/uploads/image-') ? 'object' : undefined
  if (path.includes('/outline-images/')) return 'image-sign'
  if (path.includes(`/assignments/${assignment}/tasks/`) && path.endsWith('/submissions') && request.method() === 'PUT') return 'answer-save'
  if (path.endsWith(`/assignments/${assignment}/submissions`) && request.method() === 'POST') return 'submit'
  if (/^\/api\/v1\/activities\//.test(path) && request.method() === 'GET') return 'activity-api'
  if (path.startsWith('/course/') && request.isNavigationRequest()) return 'activity-page'
  if (path.startsWith('/_next/static/') && request.resourceType() === 'script') return 'frontend-script'
  if (path.startsWith('/api/auth/')) return 'session'
}

async function subject(browser: Browser, learner: Learner, run: string, fixture: Fixture, observations: Observation[],
                       imageStarted: () => void) {
  const context = await browser.newContext({
    storageState: file(`session-${learner.index}.json`), extraHTTPHeaders: { 'x-learnhouse-load-run': run },
    locale: 'en-US', viewport: { width: 1280, height: 900 },
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  page.setDefaultNavigationTimeout(20_000)
  let activeRun = run
  const requests = new Map<Request, { route: string; run: string; start: number; status: number }>()
  page.on('request', request => {
    const route = classify(request, fixture.assignment)
    if (!route) return
    requests.set(request, { route, run: activeRun, start: Date.now(), status: 0 })
    if (route === 'image-sign') imageStarted()
  })
  page.on('response', response => {
    const found = requests.get(response.request())
    if (found) found.status = response.status()
  })
  const finish = (request: Request) => {
    const found = requests.get(request)
    if (!found) return
    observations.push({ kind: 'request', run: found.run, learner: learner.index,
      route: found.route, start: found.start, ms: Date.now() - found.start, status: found.status })
    requests.delete(request)
  }
  page.on('requestfinished', finish)
  page.on('requestfailed', finish)
  const measureAs = async (nextRun: string) => {
    activeRun = nextRun
    await context.setExtraHTTPHeaders({ 'x-learnhouse-load-run': nextRun })
  }
  return { learner, page, context, view: new AssignmentPage(page), measureAs }
}

async function timed(run: string, operation: Operation, observations: Observation[], s: Subject, perform: () => Promise<void>) {
  const start = Date.now()
  try {
    await perform()
    observations.push({ kind: 'operation', run, operation, learner: s.learner.index, start, ms: Date.now() - start, ok: true })
    return true
  } catch (error) {
    observations.push({ kind: 'operation', run, operation, learner: s.learner.index, start, ms: Date.now() - start,
      ok: false, detail: error instanceof Error ? error.name : 'UnknownError' })
    return false
  }
}

async function lesson(s: Subject, fixture: Fixture, run: string, data: Observation[]) {
  const body = s.page.locator('.lesson-section-body')
  const firstImage = body.locator('img[alt^="Exercise image"]').first()
  const opened = await timed(run, 'initial_display', data, s, async () => {
    await s.page.goto(`${origin}/course/${fixture.course}/activity/${fixture.lesson}`, { waitUntil: 'domcontentloaded' })
    await body.getByRole('heading', { name: sections[0] }).waitFor()
    await firstImage.waitFor()
    await expect.poll(() => firstImage.evaluate(img => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0),
      { timeout: 12_000 }).toBe(true)
  })
  if (!opened) return false
  return timed(run, 'all_images', data, s, async () => {
    for (const [i, title] of sections.entries()) {
      if (i) await body.getByRole('link', { name: new RegExp(`次のセクション.*${title}`) }).click()
      await body.getByRole('heading', { name: title }).waitFor()
      const images = body.locator('img[alt^="Exercise image"]')
      await expect(images).toHaveCount(30)
      for (const index of [4, 9, 14, 19, 24, 29]) await images.nth(index).scrollIntoViewIfNeeded()
      await expect.poll(() => images.evaluateAll(rows => rows.every(i => i instanceof HTMLImageElement && i.complete && i.naturalWidth > 0)),
        { timeout: 12_000 }).toBe(true)
    }
  })
}

function grade(index: number) { return index % 2 ? 50 : 100 }

async function prepareQuiz(s: Subject, fixture: Fixture, run: string, data: Observation[]) {
  await s.view.open(fixture.course, fixture.quiz)
  for (let i = 0; i < questions.length; i++) {
    await s.page.getByRole('heading', { name: `Question ${i + 1}/10` }).waitFor()
    const choice = grade(s.learner.index) === 50 && i % 2 ? 'b' : 'a'
    await s.page.getByRole('radio', { name: `Option ${choice}` }).click()
    if (i === questions.length - 1) break
    const saved = await timed(run, 'answer_save', data, s, async () => {
      const pending = s.page.waitForResponse(r => classify(r.request(), fixture.assignment) === 'answer-save')
      const [response] = await Promise.all([pending, s.page.getByRole('button', { name: 'Next question' }).click()])
      if (!response.ok()) throw new Error('AnswerSaveFailed')
      await s.page.getByRole('heading', { name: `Question ${i + 2}/10` }).waitFor()
    })
    if (!saved) throw new Error('AnswerSaveFailed')
  }
  await s.page.getByRole('button', { name: 'Submit for grading' }).first().click()
  await s.page.getByRole('button', { name: 'Submit Assignment' }).waitFor()
}

async function submit(s: Subject, fixture: Fixture, run: string, data: Observation[], adminToken: string) {
  let stored = false
  await timed(run, 'submit_grade', data, s, async () => {
    const reply = s.page.waitForResponse(r => classify(r.request(), fixture.assignment) === 'submit')
    const [response] = await Promise.all([reply, s.page.getByRole('button', { name: 'Submit Assignment' }).click()])
    if (!response.ok()) throw new Error('FinalSubmitFailed')
    stored = true
    await s.view.expectGraded(grade(s.learner.index))
  })
  if (!stored) return false
  return timed(run, 'verify', data, s, async () => {
    const submission = await assignments.getUserSubmission(fixture.assignment, s.learner.id, adminToken)
    if (submission.grade !== grade(s.learner.index) || submission.submission_status !== 'GRADED') {
      throw new Error('PersistedResultMismatch')
    }
  })
}

function checkStopThreshold(data: Observation[]) {
  const internalErrors = data.flatMap(o => o.kind === 'request' && o.status >= 500 ? [o.start] : [])
  const timeouts = data.flatMap(o => o.kind === 'operation' && !o.ok && o.detail === 'TimeoutError'
    ? [o.start + o.ms] : [])
  const failures = [...internalErrors, ...timeouts].sort((a, b) => a - b)
  if (failures.some((time, i) => i >= 2 && time - failures[i - 2] <= 60_000)) {
    throw new Error('StopThresholdExceeded')
  }
}

async function wave(browser: Browser, fixture: Fixture, mode: RunMode, people: number, waveIndex: number,
                    adminToken: string, retried: Set<number>) {
  const run = `l${people}-${mode}-${waveIndex}-${Date.now().toString(36)}`
  const data: Observation[] = []
  let firstImage!: () => void
  const seeingImage = new Promise<void>(resolve => { firstImage = resolve })
  const subjects = await Promise.all(fixture.learners.slice(0, people).map(
    learner => subject(browser, learner, run, fixture, data, firstImage),
  ))
  try {
    const viewers = mode === 'mixed' ? subjects.filter((_, i) => (i + waveIndex) % 2 === 0) : subjects
    const submitters = mode === 'view' ? [] : mode === 'serial' ? subjects : subjects.filter(s => !viewers.includes(s))
    for (const s of submitters) {
      if (!retried.has(s.learner.index)) continue
      const response = await s.context.request.post(`${origin}/api/v1/assignments/${fixture.assignment}/submissions/me/retry`, {
        headers: { 'x-learnhouse-load-run': 'fixture-setup' }, data: {},
      })
      if (!response.ok()) throw new Error(`RetrySetupHTTP${response.status()}`)
    }
    const prepare = () => Promise.all(submitters.map(s => prepareQuiz(s, fixture, run, data)))
    if (mode === 'mixed') await prepare()
    const viewing = Promise.all(viewers.map(s => lesson(s, fixture, run, data)))
    if (mode === 'mixed') await Promise.race([seeingImage, delay(20_000)])
    else {
      await viewing
      await prepare()
    }
    const submitted = await Promise.all(submitters.map(s => submit(s, fixture, run, data, adminToken)))
    await viewing
    if (mode === 'view') {
      checkStopThreshold(data)
      const revisitRun = run + '-revisit'
      await Promise.all(viewers.map(async s => {
        await s.page.goto('about:blank')
        await s.measureAs(revisitRun)
        await lesson(s, fixture, revisitRun, data)
      }))
    }
    submitters.forEach((s, i) => { if (submitted[i]) retried.add(s.learner.index) })
    const recordedRequests = data.filter(o => o.kind === 'request')
    const submitRequests = recordedRequests.filter(o => o.route === 'submit')
    const images = recordedRequests.filter(o => o.route === 'image-sign' || o.route === 'object')
    const overlappingSubmits = submitRequests.filter(sub => images.some(img => img.start < sub.start + sub.ms && sub.start < img.start + img.ms)).length
    const starts = submitRequests.map(o => o.start)
    data.push({ kind: 'wave', run, mode, people, overlappingSubmits,
      submitSpreadMs: starts.length > 1 ? Math.max(...starts) - Math.min(...starts) : 0 })
    checkStopThreshold(data)
  } finally {
    await Promise.all(subjects.map(s => s.context.close()))
    await appendFile(results, data.map(item => JSON.stringify(item)).join('\n') + '\n')
    process.stdout.write(JSON.stringify({ run, operations: data.filter(v => v.kind === 'operation').length,
      failures: data.filter(v => v.kind === 'operation' && !v.ok).length,
      wave: data.find(v => v.kind === 'wave') }) + '\n')
  }
}

const browser = await chromium.launch({ channel: process.env.LH_LOAD_CHROME_CHANNEL })
try {
  if (process.argv[2] === 'prepare') await prepare(browser)
  else if (process.argv[2] === 'run') {
    const fixture = parseFixture(JSON.parse(await readFile(file('fixture.json'), 'utf8')))
    const adminToken = await assignments.login(ADMIN_EMAIL, ADMIN_PASSWORD)
    const people = (process.env.LH_LOAD_LEVELS ?? '1,5,10,20').split(',').map(Number)
    const rounds = Number(process.env.LH_LOAD_ROUNDS ?? 3)
    if (!Number.isSafeInteger(rounds) || rounds < 1 || people.some(n => ![1, 5, 10, 20].includes(n) || n > fixture.learners.length)) {
      throw new Error('Invalid stage or repetition count')
    }
    const retried = new Set<number>()
    if (process.env.LH_LOAD_CONTINUE === '1') {
      for (const learner of fixture.learners) {
        const response = await fetch(`${origin}/api/v1/assignments/${fixture.assignment}/submissions/${learner.id}`,
          { headers: { authorization: `Bearer ${adminToken}` } })
        if (response.status === 404) continue
        if (!response.ok) throw new Error(`FixtureReadHTTP${response.status}`)
        const body: unknown = await response.json()
        const latest: unknown = Array.isArray(body) ? body.at(-1) : body
        if (latest && typeof latest === 'object' && 'submission_status' in latest && latest.submission_status === 'GRADED') retried.add(learner.index)
      }
    }
    const mixedOnly = process.env.LH_LOAD_MIXED_ONLY === '1'
    for (const count of people) {
      if (count > 1 && !mixedOnly) for (let round = 0; round < rounds; round++) await wave(browser, fixture, 'view', count, round, adminToken, retried)
      const mixedRounds = count === 20 ? Math.max(10, rounds) : rounds
      for (let round = 0; round < mixedRounds; round++) await wave(browser, fixture, count === 1 ? 'serial' : 'mixed', count, round, adminToken, retried)
    }
  } else throw new Error('Use prepare or run')
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : 'Unknown load-test failure').split('\n')[0] + '\n')
  process.exitCode = 1
} finally {
  await browser.close()
}
