import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, callRpc, RpcError } from '../../../src/client/index.ts'

/** The Host's failure envelope, as the carrier serves it. */
function failure(code: string, message: string, details: unknown) {
  return { ok: false, error: { code, message, details } }
}

describe('callRpc', () => {
  it('throws a typed RpcError (an Error) carrying code, message, and details', async () => {
    const connection = {
      rpc: {
        call: (channel: string, method: string, payload: unknown): Promise<unknown> => {
          if (method === 'detectRepo') return Promise.resolve({ ok: true, value: { repo: null } })
          return Promise.resolve(failure('rate-limit', 'GitHub API rate limit exceeded', { remaining: 0, reset: 1767225600 }))
        },
      },
    }
    const ctx = {
      get: (key: string): unknown => {
        if (key === 'connection') return connection
        if (key === 'slots') return { register: () => () => undefined, inject: () => () => undefined }
        if (key === 'sidebarRightTabs') return { register: () => () => undefined }
        return undefined
      },
      effect: (fn: () => void) => fn(),
    }
    apply(ctx as unknown as Context)

    let thrown: unknown
    try {
      await callRpc('getIssue', { number: 1 })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(RpcError)
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as RpcError).message).toBe('GitHub API rate limit exceeded')
    expect((thrown as RpcError).code).toBe('rate-limit')
    expect((thrown as RpcError).details).toEqual({ remaining: 0, reset: 1767225600 })
  })
})
