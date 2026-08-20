import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dbg } from '../src/log.ts'

/**
 * The plugin's gated logger. Every level except `error` is silent unless the
 * process runs with `DEBUG=1`; `error` is never gated (failures stay loud).
 */
describe('dbg (gated logging)', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env.DEBUG
    delete process.env.DEBUG
  })

  afterEach(() => {
    if (original === undefined) delete process.env.DEBUG
    else process.env.DEBUG = original
  })

  it('is silent at every gated level without DEBUG=1', () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'debug')]
    dbg.log('a')
    dbg.info('b')
    dbg.warn('c')
    dbg.debug('d')
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    }
  })

  it('prints tagged output at every gated level with DEBUG=1', () => {
    process.env.DEBUG = '1'
    const log = vi.spyOn(console, 'log')
    const info = vi.spyOn(console, 'info')
    const warn = vi.spyOn(console, 'warn')
    const debug = vi.spyOn(console, 'debug')
    dbg.log('x')
    dbg.info('y')
    dbg.warn('z')
    dbg.debug('w')
    expect(log).toHaveBeenCalledWith('[model-settings]', 'x')
    expect(info).toHaveBeenCalledWith('[model-settings]', 'y')
    expect(warn).toHaveBeenCalledWith('[model-settings]', 'z')
    expect(debug).toHaveBeenCalledWith('[model-settings]', 'w')
    log.mockRestore()
    info.mockRestore()
    warn.mockRestore()
    debug.mockRestore()
  })

  it('treats only the exact value DEBUG=1 as enabled', () => {
    for (const value of ['0', '*', 'model-settings', 'true']) {
      process.env.DEBUG = value
      const spy = vi.spyOn(console, 'debug')
      dbg.debug('nope')
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    }
  })

  it('prints error output regardless of the flag', () => {
    const error = vi.spyOn(console, 'error')
    dbg.error('boom')
    expect(error).toHaveBeenCalledWith('[model-settings]', 'boom')
    process.env.DEBUG = '1'
    dbg.error('still loud')
    expect(error).toHaveBeenLastCalledWith('[model-settings]', 'still loud')
    error.mockRestore()
  })
})
