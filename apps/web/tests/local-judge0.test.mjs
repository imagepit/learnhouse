import { afterEach, expect, spyOn, test } from 'bun:test'
import { runLocalPython } from '../services/code/localJudge0'

const key = 'f'.repeat(48)
const submission = '017f61e8-74aa-4d6f-82de-db1782601241'

afterEach(() => {
  globalThis.fetch = originalFetch
})
const originalFetch = globalThis.fetch

test('sends only the source and public input to loopback, then compares the result locally', async () => {
  const request = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ token: submission }, { status: 201 }))
    .mockResolvedValueOnce(Response.json({
      status: { id: 3, description: 'Accepted' },
      stdout: btoa('42  \r\n'),
    }))

  const [out] = await runLocalPython({
    code: 'print(int(input()) * 2)',
    tests: [{ id: 'example', label: 'example', stdin: '21', expectedStdout: '42' }],
    outputLabel: 'Output',
    key,
  })
  expect(request.mock.calls.map(([url]) => new URL(String(url)).origin)).toEqual([
    'http://127.0.0.1:2358',
    'http://127.0.0.1:2358',
  ])
  expect(request.mock.calls[0][1]).toMatchObject({
    headers: { 'X-Auth-Token': key, 'Content-Type': 'application/json' },
    credentials: 'omit',
    redirect: 'error',
    body: JSON.stringify({ language_id: 71, source_code: btoa('print(int(input()) * 2)'), stdin: btoa('21') }),
  })
  expect(out).toMatchObject({ id: 'example', passed: true, actual_stdout: '42  \r\n' })
})

test('an accepted run with the wrong output fails the public test', async () => {
  spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ token: submission }))
    .mockResolvedValueOnce(Response.json({ status: { id: 3, description: 'Accepted' }, stdout: btoa('43') }))

  const [out] = await runLocalPython({
    code: 'print(43)',
    tests: [{ id: 'example', label: 'example', stdin: '', expectedStdout: '42' }],
    outputLabel: 'Output',
    key,
  })
  expect(out.passed).toBe(false)
})

test('rejects a token that could change the destination', async () => {
  const request = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ token: '../invalid?unsafe=true' }))
  await expect(runLocalPython({ code: 'print(42)', tests: [], outputLabel: 'Output', key }))
    .rejects.toMatchObject({ reason: 'response' })
  expect(request).toHaveBeenCalledTimes(1)
})
