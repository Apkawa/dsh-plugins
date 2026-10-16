import { afterEach, describe, expect, it, vi } from 'vitest'
import { Log } from '../src/index.ts'

const nonErrorLevels = ['log', 'info', 'warn', 'debug'] as const

function setDebug(value: string | undefined) {
  if (value === undefined) delete process.env.DEBUG
  else process.env.DEBUG = value
}

describe('Log', () => {
  let spies: Array<ReturnType<typeof vi.spyOn>> = []

  function spyConsole() {
    spies.push(
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'debug'),
      vi.spyOn(console, 'error'),
    )
  }

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    spies = []
    setDebug(undefined)
  })

  describe('singleton per namespace', () => {
    it('returns the same instance for the same namespace', () => {
      expect(new Log('model-settings')).toBe(new Log('model-settings'))
    })

    it('returns distinct instances for different namespaces', () => {
      expect(new Log('a')).not.toBe(new Log('b'))
    })

    it('newLog matches direct construction of the composed namespace', () => {
      expect(new Log('a').newLog('b')).toBe(new Log('a/b'))
    })
  })

  describe('newLog namespace composition', () => {
    it('composes the sub namespace as <ns>/<sub>', () => {
      spyConsole()
      setDebug('1')
      const sub = new Log('model-settings').newLog('core')
      sub.info('bar')
      expect(console.info).toHaveBeenCalledWith('INFO [model-settings/core] bar')
    })
  })

  describe('output format', () => {
    it.each(nonErrorLevels)('%s prints the exact line as a single argument', (level) => {
      spyConsole()
      setDebug('1')
      const logger = new Log('model-settings')
      logger[level]('foo')
      expect(console[level]).toHaveBeenCalledTimes(1)
      expect(console[level]).toHaveBeenCalledWith(`${level.toUpperCase()} [model-settings] foo`)
    })

    it('error prints the exact line as a single argument', () => {
      spyConsole()
      const logger = new Log('model-settings')
      logger.error('foo')
      expect(console.error).toHaveBeenCalledTimes(1)
      expect(console.error).toHaveBeenCalledWith('ERROR [model-settings] foo')
    })
  })

  describe('gating', () => {
    it('non-error levels are silent without DEBUG, error prints', () => {
      spyConsole()
      const logger = new Log('model-settings')
      for (const level of nonErrorLevels) logger[level]('foo')
      for (const level of nonErrorLevels) expect(console[level]).not.toHaveBeenCalled()
      logger.error('foo')
      expect(console.error).toHaveBeenCalledWith('ERROR [model-settings] foo')
    })

    it('DEBUG=true does not enable non-error levels', () => {
      spyConsole()
      setDebug('true')
      const logger = new Log('model-settings')
      for (const level of nonErrorLevels) logger[level]('foo')
      for (const level of nonErrorLevels) expect(console[level]).not.toHaveBeenCalled()
    })

    it('DEBUG=1 enables non-error levels', () => {
      spyConsole()
      setDebug('1')
      const logger = new Log('model-settings')
      for (const level of nonErrorLevels) logger[level]('foo')
      for (const level of nonErrorLevels) expect(console[level]).toHaveBeenCalledWith(`${level.toUpperCase()} [model-settings] foo`)
    })
  })
})
