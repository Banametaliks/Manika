import type { Store } from '../data/store'
import { isCancel, isYes } from './parse'

export type InputKind = 'text' | 'number' | 'date' | 'tel'

export interface Chip {
  label: string
  /** Sent to the flow instead of the label. Defaults to label. */
  value?: string
  sub?: string
  tone?: 'primary' | 'danger'
  /** Opens a link (e.g. WhatsApp share) instead of sending. */
  href?: string
  /** Navigates inside the app. */
  to?: string
}

export interface Prompt {
  text: string
  chips?: Chip[]
  input?: InputKind
  placeholder?: string
}

export interface Card {
  title: string
  rows: [string, string][]
  tone?: 'success' | 'info'
}

export interface Msg extends Prompt {
  id: number
  from: 'bot' | 'user'
  card?: Card
  error?: boolean
}

export type Ctx = Store

/** What answering a step can return: nothing (accepted), an error to re-ask, or a custom re-prompt. */
export type AnswerResult = void | string | Prompt

export interface Step<V> {
  key: string
  /** Shown in the "Edit" menu; steps without a label cannot be edited directly. */
  label?: string
  skip?(v: V, ctx: Ctx): boolean
  done(v: V): boolean
  /** Fills the value without asking (e.g. only one bank account). Return true if it did. */
  auto?(v: V, ctx: Ctx): boolean
  ask(v: V, ctx: Ctx): Prompt
  answer(input: string, v: V, ctx: Ctx): AnswerResult
  clear?(v: V): void
}

export interface Flow<V> {
  id: string
  title: string
  init(ctx: Ctx, prefill: string): V | string
  steps: Step<V>[]
  summary(v: V, ctx: Ctx): Card
  commit(v: V, ctx: Ctx): Promise<{ text: string; card?: Card; chips?: Chip[] }>
}

interface Active {
  flow: Flow<unknown>
  v: unknown
  step: Step<unknown> | null
  mode: 'step' | 'confirm' | 'edit' | 'saving'
}

export type Router = (text: string, ctx: Ctx) => { start: Flow<unknown>; prefill: string } | { reply: Prompt & { card?: Card } }

/**
 * Runs guided conversations. One instance lives for the whole app so the
 * chat survives switching tabs.
 */
export class ChatController {
  messages: Msg[] = []
  private active: Active | null = null
  private seq = 0
  private listeners = new Set<() => void>()
  private getCtx: () => Ctx = () => { throw new Error('chat context not set') }
  private snapshot: Msg[] = []

  constructor(private router: Router, private menu: (ctx: Ctx) => Prompt) {}

  setContext(get: () => Ctx) { this.getCtx = get }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  getSnapshot = () => this.snapshot
  get busy() { return this.active?.mode === 'saving' }
  get inFlow() { return this.active !== null }

  /** Greets once. */
  start() {
    if (this.messages.length) return
    const m = this.menu(this.getCtx())
    this.bot({ ...m, text: `Namaste! 🙏 ${m.text}` })
  }

  /** Drops any half-finished flow without a message (used by deep links). */
  abort() { if (!this.busy) this.active = null }

  clear() {
    this.messages = []
    this.active = null
    this.start()
    this.emit()
  }

  async send(value: string, label?: string) {
    const text = value.trim()
    if (!text || this.busy) return
    this.push({ from: 'user', text: label ?? text })
    const ctx = this.getCtx()

    if (text === '__menu') { this.active = null; this.bot(this.menu(ctx)); return }
    if (isCancel(text) || text === '__cancel') {
      if (this.active) { this.active = null; this.bot({ ...this.menu(ctx), text: 'Cancelled. Nothing was saved. What next?' }) }
      else this.bot(this.menu(ctx))
      return
    }

    const a = this.active
    if (!a) return this.route(text, ctx)

    if (a.mode === 'confirm') {
      if (text === '__confirm' || isYes(text)) return this.commit(a, ctx)
      if (text === '__edit' || /^(edit|change)$/i.test(text)) return this.editMenu(a, ctx)
      return this.confirmPrompt(a, ctx, 'Tap ✅ Save to save, ✏️ Edit to change something, or Cancel.')
    }

    if (a.mode === 'edit') {
      if (text === '__back') return this.confirmPrompt(a, ctx)
      const step = a.flow.steps.find((s) => `edit:${s.key}` === text || s.label?.toLowerCase() === text.toLowerCase())
      if (!step) return this.editMenu(a, ctx)
      step.clear?.(a.v)
      a.mode = 'step'
      return this.advance(a, ctx)
    }

    if (a.mode === 'step' && a.step) {
      const res = a.step.answer(text, a.v, ctx)
      if (typeof res === 'string') {
        const p = a.step.ask(a.v, ctx)
        this.bot({ ...p, text: res }, true)
        return
      }
      if (res) { this.bot(res); return }
      return this.advance(a, ctx)
    }
  }

  private route(text: string, ctx: Ctx) {
    const r = this.router(text, ctx)
    if ('reply' in r) { this.bot(r.reply); return }
    this.begin(r.start, ctx, r.prefill)
  }

  begin(flow: Flow<unknown>, ctx: Ctx, prefill = '') {
    const v = flow.init(ctx, prefill)
    if (typeof v === 'string') { this.bot({ ...this.menu(ctx), text: v }, true); return }
    this.active = { flow, v, step: null, mode: 'step' }
    this.advance(this.active, ctx)
  }

  private advance(a: Active, ctx: Ctx) {
    for (const step of a.flow.steps) {
      if (step.skip?.(a.v, ctx)) continue
      if (step.done(a.v)) continue
      if (step.auto?.(a.v, ctx) && step.done(a.v)) continue
      a.step = step
      a.mode = 'step'
      this.bot(step.ask(a.v, ctx))
      return
    }
    a.step = null
    this.confirmPrompt(a, ctx)
  }

  private confirmPrompt(a: Active, ctx: Ctx, text = 'Please check and confirm:') {
    a.mode = 'confirm'
    this.push({
      from: 'bot',
      text,
      card: a.flow.summary(a.v, ctx),
      chips: [
        { label: '✅ Save', value: '__confirm', tone: 'primary' },
        { label: '✏️ Edit', value: '__edit' },
        { label: 'Cancel', value: '__cancel', tone: 'danger' },
      ],
    })
  }

  private editMenu(a: Active, ctx: Ctx) {
    a.mode = 'edit'
    const chips = a.flow.steps
      .filter((s) => s.label && !s.skip?.(a.v, ctx))
      .map((s) => ({ label: s.label!, value: `edit:${s.key}` }))
    this.bot({ text: 'What do you want to change?', chips: [...chips, { label: '↩︎ Back', value: '__back' }] })
  }

  private async commit(a: Active, ctx: Ctx) {
    a.mode = 'saving'
    const thinking = this.push({ from: 'bot', text: 'Saving…' })
    try {
      const res = await a.flow.commit(a.v, ctx)
      this.active = null
      this.replace(thinking, { from: 'bot', text: res.text, card: res.card, chips: res.chips ?? this.menu(ctx).chips })
    } catch (e) {
      a.mode = 'confirm'
      this.replace(thinking, { from: 'bot', text: `❌ Could not save: ${e instanceof Error ? e.message : e}`, error: true })
      this.confirmPrompt(a, ctx, 'Fix it with ✏️ Edit, or try saving again.')
    }
  }

  // ── message plumbing ──
  private bot(p: Prompt & { card?: Card }, error = false) {
    this.push({ from: 'bot', ...p, error })
  }
  private push(m: Omit<Msg, 'id'>): number {
    const id = ++this.seq
    this.messages = [...this.messages, { ...m, id }]
    this.emit()
    return id
  }
  private replace(id: number, m: Omit<Msg, 'id'>) {
    this.messages = this.messages.map((x) => (x.id === id ? { ...m, id } : x))
    this.emit()
  }
  private emit() {
    this.snapshot = this.messages
    this.listeners.forEach((l) => l())
  }

}
