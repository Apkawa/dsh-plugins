const registry = new Map<string, Log>()

export class Log {
  namespace: string

  constructor(namespace: string) {
    this.namespace = namespace
    const existing = registry.get(namespace)
    if (existing) return existing
    registry.set(namespace, this)
  }

  newLog(sub: string) {
    return new Log(`${this.namespace}/${sub}`)
  }

  log(...args: unknown[]) {
    this.print('log', args)
  }

  info(...args: unknown[]) {
    this.print('info', args)
  }

  warn(...args: unknown[]) {
    this.print('warn', args)
  }

  debug(...args: unknown[]) {
    this.print('debug', args)
  }

  error(...args: unknown[]) {
    console.error(`ERROR [${this.namespace}] ${format(args)}`)
  }

  private print(level: 'log' | 'info' | 'warn' | 'debug', args: unknown[]) {
    if (process.env.DEBUG !== '1') return
    console[level](`${level.toUpperCase()} [${this.namespace}] ${format(args)}`)
  }
}

function format(args: unknown[]) {
  return args.map(String).join(' ')
}
