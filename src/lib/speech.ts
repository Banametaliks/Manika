import { useCallback, useEffect, useRef, useState } from 'react'

// Minimal typing for the Web Speech API (Chrome/Android, Safari/iOS); not in TS's DOM lib everywhere.
interface RecognitionResult { readonly isFinal: boolean; readonly 0: { transcript: string } }
interface RecognitionEvent { readonly resultIndex: number; readonly results: ArrayLike<RecognitionResult> }
interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
type RecognitionCtor = new () => Recognition

function getCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const speechSupported = () => getCtor() !== null

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it in your browser settings for this site.',
  'service-not-allowed': 'Voice input is not available in this browser.',
  'audio-capture': 'No microphone found.',
  network: 'Voice input needs an internet connection.',
}

/**
 * Listens once: shows words as they are heard (onInterim) and hands over the
 * final sentence (onFinal) when the speaker pauses.
 */
export function useSpeech(opts: { lang?: string; onInterim(text: string): void; onFinal(text: string): void }) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Recognition | null>(null)
  const cb = useRef(opts)
  cb.current = opts

  useEffect(() => () => rec.current?.abort(), [])

  const start = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor) { setError(ERRORS['service-not-allowed']); return }
    rec.current?.abort()
    const r = new Ctor()
    r.lang = cb.current.lang ?? 'en-IN'
    r.interimResults = true
    r.continuous = false
    r.maxAlternatives = 1
    let finalText = ''
    r.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) finalText += res[0].transcript
        else interim += res[0].transcript
      }
      cb.current.onInterim((finalText + interim).trim())
    }
    r.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') setError(ERRORS[e.error] ?? `Voice input error: ${e.error}`)
    }
    r.onend = () => {
      setListening(false)
      rec.current = null
      if (finalText.trim()) cb.current.onFinal(finalText.trim())
    }
    rec.current = r
    setError(null)
    try {
      r.start()
      setListening(true)
    } catch {
      setError(ERRORS['service-not-allowed'])
    }
  }, [])

  const stop = useCallback(() => rec.current?.stop(), [])

  return { listening, error, start, stop, clearError: () => setError(null) }
}
