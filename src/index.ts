import fs from 'fs'

function getProcessId (): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return process.env.npm_package_name ?? require('../../../package.json').name
  } catch {
    return 'persist-timeout'
  }
}

const randomInt = (): number => Math.floor(Math.random() * 1e15)

interface Timeout<T> {
  id: number
  date: Date
  data: T
}

type Listener<T> = (data: T, meta: { timeoutId: number, listenerId: number }) => void | Promise<void>

const basePath = '/var/tmp'

export default class Persister<T> {
  static instanceCounter: number = 0

  private readonly path: string
  private readonly timeouts: Array<Timeout<T>> = []
  private readonly listeners: Map<number, Listener<T>> = new Map()
  private readonly interval: NodeJS.Timer

  constructor ({
    name,
    periodMs = 5000
  }: {
    name?: string
    periodMs?: number
  }) {
    const id = `${getProcessId()}-${name ?? Persister.instanceCounter++}`
    this.path = `${basePath}/${id}.json`

    try {
      this.timeouts = this.load()
    } catch {
      this.timeouts = []
    }

    this.interval = setInterval(this.check.bind(this) as () => void, periodMs)
  }

  async setTimeout (data: T, ms: number): Promise<number> {
    const inserted = this.insert({
      id: randomInt(),
      date: new Date(Date.now() + ms),
      data
    })

    try {
      await this.save()
    } catch (e: any) {
      throw new Error(`Persister error: couldn't save file due ${e.message as string}`)
    }

    return inserted.id
  }

  addListener (listener: Listener<T>): number {
    const listenerId = randomInt()

    this.listeners.set(listenerId, listener)

    return listenerId
  }

  removeListener (listener: Listener<T> | number): void {
    const listenerId = typeof listener === 'number'
      ? listener
      : [...this.listeners.entries()].find(l => l[1] === listener)?.[0]

    if (listenerId === undefined) {
      return
    }

    this.listeners.delete(listenerId)
  }

  stop (): void {
    clearTimeout(this.interval)
  }

  private async check (): Promise<void> {
    while ((this.peek()?.date ?? new Date(Infinity)) <= new Date()) {
      const popped = this.pop()

      if (popped === null) {
        throw new Error()
      }

      await Promise.all(
        [...this.listeners.entries()].map(async ([listenerId, listener]) => {
          await listener(popped.data, {
            listenerId,
            timeoutId: popped.id
          })
        })
      )

      await this.save()
    }
  }

  // storing

  private async save (): Promise<void> {
    await fs.promises.writeFile(this.path, JSON.stringify(this.timeouts), 'utf-8')
  }

  private load (): Array<Timeout<T>> {
    const json = fs.readFileSync(this.path, 'utf-8')

    return JSON.parse(json).map((t: Timeout<T>) => ({
      ...t,
      date: new Date(t.date)
    }))
  }

  // queue

  private insert (inserted: Timeout<T>): Timeout<T> {
    const insertBeforeI = this.timeouts.findIndex(t => t.date > inserted.date)
    this.timeouts.splice(insertBeforeI, 0, inserted)
    return inserted
  }

  private peek (): Timeout<T> | null {
    return this.timeouts[0] ?? null
  }

  private pop (): Timeout<T> | null {
    return this.timeouts.shift() ?? null
  }
}
