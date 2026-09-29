import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRunner } from '../../../src/runner.ts'

/**
 * Spawner double: records calls, resolves with a canned outcome, and can
 * simulate a stalled subprocess that only settles when its signal fires.
 */
class FakeSpawner {
  calls: Array<{ cmd: string; args: string[] }> = []
  outcome = { code: 0, stdout: '[]', stderr: '' }
  stalled = false

  invoke(cmd: string, args: string[], options: { signal?: AbortSignal }): Promise<{ code: number; stdout: string; stderr: string }> {
    this.calls.push({ cmd, args })
    if (this.stalled) {
      return new Promise(resolve => {
        options.signal?.addEventListener('abort', () => resolve(this.outcome), { once: true })
      })
    }
    return Promise.resolve(this.outcome)
  }
}

function makeTempDir(label: string): string {
  const dir = join(tmpdir(), `web-search-ddgs-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** A warm venv: bin/python (+ optional bin/ddgs) exist, so no setup is needed. */
function makeVenv(label: string, withDdgs: boolean): string {
  const dir = join(makeTempDir(label), 'venv')
  mkdirSync(join(dir, 'bin'), { recursive: true })
  writeFileSync(join(dir, 'bin', 'python'), '')
  if (withDdgs) writeFileSync(join(dir, 'bin', 'ddgs'), '')
  return dir
}

const BASE = { ddgsVersion: 'ddgs', scriptPath: '/nonexistent/ddgs-search.py', timeoutMs: 30000 }
const PARAMS = { query: 'react', backend: 'yandex', maxResults: 8 }

describe('ddgs runner', () => {
  it('spawns the venv python with the search script args on a warm venv', async () => {
    const spawner = new FakeSpawner()
    const venv = makeVenv('warm', true)
    spawner.outcome = { code: 0, stdout: JSON.stringify([{ href: 'https://ya.ru/1', title: 'One', body: 'B' }]), stderr: '' }
    const runner = createRunner({ ...BASE, venvDir: venv }, spawner.invoke.bind(spawner))
    const result = await runner.search(PARAMS)
    expect(spawner.calls).toEqual([
      { cmd: join(venv, 'bin', 'python'), args: expect.arrayContaining(['--query', 'react', '--backend', 'yandex']) },
    ])
    expect(result.items).toEqual([{ href: 'https://ya.ru/1', title: 'One', body: 'B' }])
  })

  it('boots the venv (uv venv + uv pip install) when the venv is missing', async () => {
    const spawner = new FakeSpawner()
    const venv = makeTempDir('setup') // empty dir = no bin/python
    spawner.outcome = { code: 0, stdout: '[]', stderr: '' }
    const runner = createRunner({ ...BASE, venvDir: venv }, spawner.invoke.bind(spawner))
    await runner.search(PARAMS)
    expect(spawner.calls[0]).toEqual({ cmd: 'uv', args: ['venv', venv] })
    expect(spawner.calls[1].args.join(' ')).toContain('pip install')
    expect(spawner.calls[1].args.join(' ')).toContain(venv)
    expect(spawner.calls[1].args.join(' ')).toContain('ddgs')
  })

  it('reinstalls ddgs when the venv exists but ddgs is missing', async () => {
    const spawner = new FakeSpawner()
    const venv = makeVenv('node-ddgs', false) // bin/python yes, bin/ddgs no
    spawner.outcome = { code: 0, stdout: '[]', stderr: '' }
    const runner = createRunner({ ...BASE, venvDir: venv }, spawner.invoke.bind(spawner))
    await runner.search(PARAMS)
    expect(spawner.calls).toHaveLength(2) // only the reinstall, then the search
    expect(spawner.calls[0].args.join(' ')).toContain('pip install')
  })

  it('maps ddgs items and drops empty fields', async () => {
    const spawner = new FakeSpawner()
    const venv = makeVenv('map', true)
    spawner.outcome = {
      code: 0,
      stdout: JSON.stringify([
        { href: 'https://a', title: 'T', body: '' },
        { href: 'https://b', title: '', body: 'Only body' },
      ]),
      stderr: '',
    }
    const runner = createRunner({ ...BASE, venvDir: venv }, spawner.invoke.bind(spawner))
    const result = await runner.search(PARAMS)
    expect(result.items).toEqual([
      { href: 'https://a', title: 'T' },
      { href: 'https://b', body: 'Only body' },
    ])
  })

  it('rejects with stderr on a non-zero exit', async () => {
    const spawner = new FakeSpawner()
    const venv = makeVenv('err', true)
    spawner.outcome = { code: 1, stdout: '', stderr: 'DDGSException: No results found.' }
    const runner = createRunner({ ...BASE, venvDir: venv }, spawner.invoke.bind(spawner))
    await expect(runner.search(PARAMS)).rejects.toThrow('DDGSException: No results found.')
  })

  it('rejects on malformed JSON output', async () => {
    const spawner = new FakeSpawner()
    const venv = makeVenv('json', true)
    spawner.outcome = { code: 0, stdout: '{"not":"an array"}', stderr: '' }
    const runner = createRunner({ ...BASE, venvDir: venv }, spawner.invoke.bind(spawner))
    await expect(runner.search(PARAMS)).rejects.toThrow(/json|malformed|expected/i)
  })

  it('aborts on the caller signal and throws an abort error', async () => {
    const spawner = new FakeSpawner()
    spawner.stalled = true
    spawner.outcome = { code: 137, stdout: '', stderr: 'killed' }
    const venv = makeVenv('abort', true)
    const controller = new AbortController()
    const runner = createRunner({ ...BASE, venvDir: venv, timeoutMs: 60000 }, spawner.invoke.bind(spawner))
    const pending = runner.search({ ...PARAMS, signal: controller.signal })
    await new Promise(resolve => setTimeout(resolve, 20))
    controller.abort()
    await expect(pending).rejects.toThrow(/abort/i)
  })

  it('times out the subprocess and throws a timeout error', async () => {
    const spawner = new FakeSpawner()
    spawner.stalled = true
    spawner.outcome = { code: 137, stdout: '', stderr: '' }
    const venv = makeVenv('timeout', true)
    const runner = createRunner({ ...BASE, venvDir: venv, timeoutMs: 30 }, spawner.invoke.bind(spawner))
    await expect(runner.search(PARAMS)).rejects.toThrow(/timed out/i)
  })

  it('retries venv setup after a failed one', async () => {
    const spawner = new FakeSpawner()
    const venv = makeTempDir('retry')
    spawner.outcome = { code: 1, stdout: '', stderr: 'boom' }
    const runner = createRunner({ ...BASE, venvDir: venv }, spawner.invoke.bind(spawner))
    await expect(runner.search(PARAMS)).rejects.toThrow('boom')
    spawner.outcome = { code: 0, stdout: '[]', stderr: '' }
    await runner.search(PARAMS)
    expect(spawner.calls[1].args).toEqual(['venv', venv]) // setup restarted
  })
})
