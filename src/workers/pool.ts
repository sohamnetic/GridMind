import type { Strategy } from '../core/race/strategy'
import { mergeOutcomes, type Outcomes, type StudySetup } from '../core/strategy/monteCarlo'
import type { Evaluate } from '../core/strategy/optimiser'
import type { MonteCarloReply, MonteCarloRequest } from './monteCarloProtocol'

/** Races per message: small enough for smooth progress and a quick cancel. */
const CHUNK = 100

/** Workers to use: every core but one, so the page stays responsive. */
export function poolSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4
  return Math.min(8, Math.max(1, cores - 1))
}

interface Task {
  id: number
  strategy: Strategy
  /** Which strategy of the batch this belongs to, and its place among that strategy's chunks. */
  index: number
  part: number
  from: number
  count: number
}

interface Batch {
  parts: Outcomes[][]
  remaining: number
  onRaces: (races: number) => void
  resolve: (outcomes: Outcomes[]) => void
  reject: (error: Error) => void
}

export class PoolCancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'PoolCancelled'
  }
}

/**
 * A pool of Monte Carlo workers for one study. Work is cut into small tasks
 * and handed to whichever worker is free. Nothing is shared between workers:
 * each gets the setup once, then strategies in and result arrays out.
 */
export class MonteCarloPool {
  private workers: Worker[] = []
  private idle: Worker[] = []
  private queue: Task[] = []
  private running = new Map<number, { task: Task; batch: Batch }>()
  private pending = new Map<number, Batch>()
  private nextId = 1
  private dead = false
  readonly size: number

  constructor(setup: StudySetup, size = poolSize()) {
    this.size = size
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./montecarlo.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<MonteCarloReply>) => this.onDone(worker, e.data)
      worker.onerror = (e) => this.fail(new Error(e.message || 'A simulation worker stopped unexpectedly.'))
      const message: MonteCarloRequest = { type: 'setup', setup }
      worker.postMessage(message)
      this.workers.push(worker)
      this.idle.push(worker)
    }
  }

  /** Races each strategy `count` times from race number `from`, spread over the pool. */
  evaluate: Evaluate = (strategies, from, count, onRaces) =>
    new Promise<Outcomes[]>((resolve, reject) => {
      if (this.dead) {
        reject(new PoolCancelled())
        return
      }
      if (strategies.length === 0 || count <= 0) {
        resolve([])
        return
      }
      const batch: Batch = { parts: strategies.map(() => []), remaining: 0, onRaces, resolve, reject }
      // Chunks are queued round by round, so every strategy advances together.
      for (let start = 0, part = 0; start < count; start += CHUNK, part++) {
        strategies.forEach((strategy, index) => {
          const task: Task = {
            id: this.nextId++,
            strategy,
            index,
            part,
            from: from + start,
            count: Math.min(CHUNK, count - start),
          }
          this.pending.set(task.id, batch)
          this.queue.push(task)
          batch.remaining++
        })
      }
      this.pump()
    })

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop()!
      const task = this.queue.shift()!
      const batch = this.pending.get(task.id)!
      this.pending.delete(task.id)
      this.running.set(task.id, { task, batch })
      const message: MonteCarloRequest = {
        type: 'run',
        id: task.id,
        strategy: task.strategy,
        from: task.from,
        count: task.count,
      }
      worker.postMessage(message)
    }
  }

  private onDone(worker: Worker, reply: MonteCarloReply): void {
    const entry = this.running.get(reply.id)
    this.idle.push(worker)
    if (entry) {
      this.running.delete(reply.id)
      const { task, batch } = entry
      batch.parts[task.index][task.part] = reply.outcomes
      batch.remaining--
      batch.onRaces(task.count)
      if (batch.remaining === 0) batch.resolve(batch.parts.map((parts) => mergeOutcomes(parts)))
    }
    this.pump()
  }

  private fail(error: Error): void {
    if (this.dead) return
    this.dead = true
    for (const worker of this.workers) worker.terminate()
    const batches = new Set<Batch>([...this.pending.values(), ...[...this.running.values()].map((r) => r.batch)])
    this.workers = []
    this.idle = []
    this.queue = []
    this.pending.clear()
    this.running.clear()
    for (const batch of batches) batch.reject(error)
  }

  /** Stops every worker at once; work in flight is abandoned and its promises reject. */
  cancel(): void {
    this.fail(new PoolCancelled())
  }

  /** Releases the workers once the study is finished. */
  dispose(): void {
    this.cancel()
  }
}
