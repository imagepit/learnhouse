export const LOCAL_PYTHON_LANGUAGE_ID = 71

const endpoint = 'http://127.0.0.1:2358'
const keyName = 'learnhouse.localJudge0.key'

type PublicTest = { id: string; label: string; stdin: string; expectedStdout: string }
type LocalExecution = {
  code: string
  tests: readonly PublicTest[]
  outputLabel: string
  key: string
}

export class LocalJudge0Error extends Error {
  constructor(readonly reason: 'key' | 'connection' | 'response' | 'timeout') {
    super(reason)
  }
}

export function requestLocalJudge0Key(message: string): string | null {
  const input = sessionStorage.getItem(keyName) ?? window.prompt(message)
  if (!input?.trim()) return null
  const key = input.trim().replace(/^Local run key:\s*/i, '')
  if (!/^[a-f0-9]{48}$/.test(key)) {
    sessionStorage.removeItem(keyName)
    throw new LocalJudge0Error('key')
  }
  sessionStorage.setItem(keyName, key)
  return key
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LocalJudge0Error('response')
  }
  return Object.fromEntries(Object.entries(value))
}

function encode(value: string): string {
  return btoa(Array.from(new TextEncoder().encode(value), byte => String.fromCharCode(byte)).join(''))
}

function decode(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string') throw new LocalJudge0Error('response')
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(value), char => char.charCodeAt(0)))
  } catch {
    throw new LocalJudge0Error('response')
  }
}

function normalizeOutput(value: string) {
  return value.replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd()).join('\n').trimEnd()
}

async function request(path: string, key: string, signal: AbortSignal, body?: object) {
  let response: Response
  try {
    response = await fetch(endpoint + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'X-Auth-Token': key,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit',
      redirect: 'error',
      signal,
    })
  } catch {
    throw new LocalJudge0Error(signal.aborted ? 'timeout' : 'connection')
  }

  if (response.status === 401 || response.status === 403) {
    sessionStorage.removeItem(keyName)
    throw new LocalJudge0Error('key')
  }
  if (!response.ok) throw new LocalJudge0Error('response')
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new LocalJudge0Error(signal.aborted ? 'timeout' : 'response')
  }
  return record(value)
}

async function executeCase(
  { code, key, outputLabel }: LocalExecution,
  signal: AbortSignal,
  test: PublicTest | null,
) {
  const { token } = await request('/submissions?base64_encoded=true&wait=false', key, signal, {
    language_id: LOCAL_PYTHON_LANGUAGE_ID,
    source_code: encode(code),
    stdin: encode(test?.stdin ?? ''),
  })
  if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token)) {
    throw new LocalJudge0Error('response')
  }

  const path = `/submissions/${token}?base64_encoded=true&fields=status,stdout,stderr,compile_output,message,time,memory`
  while (!signal.aborted) {
    const data = await request(path, key, signal)
    const status = record(data.status)
    if (typeof status.id !== 'number' || typeof status.description !== 'string') {
      throw new LocalJudge0Error('response')
    }
    if (status.id === 1 || status.id === 2) {
      await new Promise(resolve => setTimeout(resolve, 250))
      continue
    }
    const stdout = decode(data.stdout)
    const expected = test?.expectedStdout ?? ''
    return {
      id: test?.id ?? 'single',
      label: test?.label ?? outputLabel,
      passed: status.id === 3 && (!test || normalizeOutput(stdout ?? '') === normalizeOutput(expected)),
      actual_stdout: stdout,
      expected_stdout: expected,
      stderr: decode(data.stderr) ?? decode(data.message),
      compile_output: decode(data.compile_output),
      status: { id: status.id, description: status.description },
      time: typeof data.time === 'string' ? data.time : null,
      memory: typeof data.memory === 'number' ? data.memory : null,
    }
  }
  throw new LocalJudge0Error('timeout')
}

export async function runLocalPython(execution: LocalExecution) {
  const signal = AbortSignal.timeout(30_000)
  if (!execution.tests.length) {
    return [await executeCase(execution, signal, null)]
  }

  const results = []
  for (const test of execution.tests) {
    results.push(await executeCase(execution, signal, test))
  }
  return results
}
