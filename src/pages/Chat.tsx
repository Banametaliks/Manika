import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../data/store'
import { ChatController, type Chip, type Msg } from '../chat/engine'
import { menu, router } from '../chat/flows'
import { matchChip, normalizeSpeech } from '../chat/voice'
import { speechSupported, useSpeech } from '../lib/speech'

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
    if (c.to) { nav(c.to); return }
    void chat.send(c.value ?? c.label, c.label)
  }

  // Typed or spoken text that names one of the offered buttons acts like tapping it.
  const onText = (raw: string, spoken: boolean) => {
    const text = spoken ? normalizeSpeech(raw) : raw
    const chip = matchChip(text, last?.from === 'bot' ? last.chips : undefined)
    void chat.send(chip ? (chip.value ?? chip.label) : text, spoken ? `🎤 ${raw}` : raw)
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
        onSend={onText}
        onPickDate={(iso) => void chat.send(iso)}
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
          {m.chips.map((c, i) => {
            const Tag = c.href ? 'a' : 'button'
            return (
            <Tag
              key={i}
              {...(c.href ? { href: c.href, target: '_blank', rel: 'noopener' } : { type: 'button' as const, onClick: () => onChip(c) })}
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
            </Tag>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Composer({ hint, onSend, onPickDate, onReset }: {
  hint?: Msg
  onSend(text: string, spoken: boolean): void
  onPickDate(iso: string): void
  onReset(): void
}) {
  const [text, setText] = useState('')
  const dateRef = useRef<HTMLInputElement>(null)
  const kind = hint?.input ?? 'text'
  const canSpeak = speechSupported()
  const speech = useSpeech({
    onInterim: setText,
    onFinal: (heard) => { setText(''); onSend(heard, true) },
  })

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!text.trim() || speech.listening) return
    onSend(text, false)
    setText('')
  }

  return (
    <div className="border-t border-stone-200 bg-stone-50">
      {speech.error && (
        <div role="alert" className="flex items-start gap-2 bg-rose-50 px-4 py-2 text-sm text-rose-800">
          <span className="flex-1">{speech.error}</span>
          <button type="button" className="font-semibold" onClick={speech.clearError}>OK</button>
        </div>
      )}
      <form onSubmit={submit} className="flex items-center gap-2 px-3 py-2">
        <button type="button" title="Start over" aria-label="Start over" onClick={onReset} className="rounded-full p-2 text-stone-500 hover:bg-stone-200">⟲</button>
        {kind === 'date' && (
          <>
            <button type="button" aria-label="Pick date" onClick={() => { try { dateRef.current?.showPicker() } catch { dateRef.current?.click() } }} className="rounded-full p-2 text-xl hover:bg-stone-200">📅</button>
            <input
              ref={dateRef}
              type="date"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => { if (e.target.value) { onPickDate(e.target.value); e.target.value = '' } }}
            />
          </>
        )}
        <input
          className={`input flex-1 rounded-full py-2 ${speech.listening ? 'border-rose-400 bg-rose-50' : ''}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={speech.listening ? 'Listening… speak now' : hint?.placeholder ?? (canSpeak ? 'Type, tap an option or 🎤 speak' : 'Type here or tap an option…')}
          inputMode={kind === 'number' ? 'decimal' : kind === 'tel' ? 'tel' : 'text'}
          enterKeyHint="send"
          autoComplete="off"
          aria-label="Message"
          readOnly={speech.listening}
        />
        {canSpeak && (speech.listening || !text.trim()) ? (
          <button
            type="button"
            onClick={speech.listening ? speech.stop : speech.start}
            aria-label={speech.listening ? 'Stop listening' : 'Speak'}
            aria-pressed={speech.listening}
            className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-full text-white ${speech.listening ? 'bg-rose-600' : 'bg-brand-800'}`}
          >
            {speech.listening && <span className="absolute inset-0 animate-ping rounded-full bg-rose-500 opacity-40 motion-reduce:hidden" />}
            <MicIcon stop={speech.listening} />
          </button>
        ) : (
          <button type="submit" disabled={!text.trim()} className="rounded-full bg-brand-800 px-4 py-2 font-semibold text-white disabled:opacity-40">
            Send
          </button>
        )}
      </form>
    </div>
  )
}

function MicIcon({ stop }: { stop: boolean }) {
  if (stop) return <svg viewBox="0 0 24 24" className="relative h-4 w-4" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" /></svg>
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  )
}
