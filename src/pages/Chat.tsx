import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../data/store'
import { ChatController, type Chip, type Msg } from '../chat/engine'
import { menu, router } from '../chat/flows'

// One conversation for the whole app session, so it survives switching tabs.
const chat = new ChatController(router, menu)

export default function Chat() {
  const store = useStore()
  const storeRef = useRef(store)
  storeRef.current = store
  chat.setContext(() => storeRef.current)

  const messages = useSyncExternalStore(chat.subscribe, chat.getSnapshot)
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const bottom = useRef<HTMLDivElement>(null)
  const handledQ = useRef<string | null>(null)

  useEffect(() => {
    chat.start()
    const q = params.get('q')
    if (q && handledQ.current !== q) {
      handledQ.current = q
      setParams({}, { replace: true })
      chat.abort()
      void chat.send(q)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [messages])

  const last = messages[messages.length - 1]
  const onChip = (c: Chip) => {
    if (c.href) { window.open(c.href, '_blank', 'noopener'); return }
    if (c.to) { nav(c.to); return }
    void chat.send(c.value ?? c.label, c.label)
  }

  return (
    <>
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
        {messages.map((m) => (
          <Bubble key={m.id} m={m} active={m === last} onChip={onChip} />
        ))}
        <div ref={bottom} />
      </div>
      <Composer
        hint={last?.from === 'bot' ? last : undefined}
        onSend={(text) => void chat.send(text)}
        onReset={() => chat.clear()}
      />
    </>
  )
}

function Bubble({ m, active, onChip }: { m: Msg; active: boolean; onChip(c: Chip): void }) {
  const mine = m.from === 'user'
  return (
    <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-[15px] leading-snug shadow-sm ${
          mine ? 'rounded-br-md bg-brand-800 text-white' : m.error ? 'rounded-bl-md bg-rose-50 text-rose-900 ring-1 ring-rose-200' : 'rounded-bl-md bg-white ring-1 ring-stone-200'
        }`}
      >
        {m.text}
      </div>
      {m.card && (
        <div className={`mt-2 w-[85%] overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ${m.card.tone === 'success' ? 'ring-emerald-300' : 'ring-stone-200'}`}>
          <div className={`px-3.5 py-2 text-sm font-semibold ${m.card.tone === 'success' ? 'bg-emerald-50 text-emerald-900' : 'bg-stone-50'}`}>{m.card.title}</div>
          <dl className="divide-y divide-stone-100 px-3.5 text-sm">
            {m.card.rows.map(([k, v], i) => (
              <div key={i} className="flex justify-between gap-3 py-1.5">
                <dt className="text-stone-500">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {active && m.chips && m.chips.length > 0 && (
        <div className="mt-2 flex max-w-full flex-wrap gap-2">
          {m.chips.map((c, i) => (
            <button
              key={i}
              onClick={() => onChip(c)}
              className={`flex flex-col items-start rounded-xl px-3 py-1.5 text-left text-sm font-medium shadow-sm ring-1 transition active:scale-95 ${
                c.tone === 'primary'
                  ? 'bg-brand-800 text-white ring-brand-800'
                  : c.tone === 'danger'
                    ? 'bg-white text-rose-700 ring-rose-200'
                    : 'bg-white text-stone-800 ring-stone-300'
              }`}
            >
              <span>{c.label}</span>
              {c.sub && <span className={`text-[11px] font-normal ${c.tone === 'primary' ? 'text-brand-100' : 'text-stone-500'}`}>{c.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Composer({ hint, onSend, onReset }: { hint?: Msg; onSend(t: string): void; onReset(): void }) {
  const [text, setText] = useState('')
  const dateRef = useRef<HTMLInputElement>(null)
  const kind = hint?.input ?? 'text'

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!text.trim()) return
    onSend(text)
    setText('')
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 border-t border-stone-200 bg-stone-50 px-3 py-2">
      <button type="button" title="Start over" aria-label="Start over" onClick={onReset} className="rounded-full p-2 text-stone-500 hover:bg-stone-200">⟲</button>
      {kind === 'date' && (
        <>
          <button type="button" aria-label="Pick date" onClick={() => dateRef.current?.showPicker?.() ?? dateRef.current?.click()} className="rounded-full p-2 text-xl hover:bg-stone-200">📅</button>
          <input
            ref={dateRef}
            type="date"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => { if (e.target.value) { onSend(e.target.value); e.target.value = '' } }}
          />
        </>
      )}
      <input
        className="input flex-1 rounded-full py-2"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={hint?.placeholder ?? 'Type here or tap an option…'}
        inputMode={kind === 'number' ? 'decimal' : kind === 'tel' ? 'tel' : 'text'}
        enterKeyHint="send"
        autoComplete="off"
        aria-label="Message"
      />
      <button type="submit" disabled={!text.trim()} className="rounded-full bg-brand-800 px-4 py-2 font-semibold text-white disabled:opacity-40">
        Send
      </button>
    </form>
  )
}
