import { useMemo, useState } from 'react'
import { useStore } from '../data/store'
import { addDays, fmtDate, today } from '../lib/format'
import type { Task } from '../lib/types'
import { ConfirmButton, Empty, Field, Sheet } from '../components/ui'

/** "nilesh.patil@gmail.com" → "Nilesh.patil"; plain names pass through. */
export const personName = (s: string | null | undefined) => {
  if (!s) return ''
  const n = s.includes('@') ? s.split('@')[0] : s
  return n.charAt(0).toUpperCase() + n.slice(1)
}

/** Open tasks: overdue and soonest due first, undated last, then oldest first. */
export function sortOpen(a: Task, b: Task) {
  if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date.localeCompare(b.due_date)
  if (!!a.due_date !== !!b.due_date) return a.due_date ? -1 : 1
  return a.created_at.localeCompare(b.created_at)
}

export default function Todo() {
  const { tasks, tasksError, exhibition, repo, refresh, me } = useStore()
  // Ticks show instantly; the server copy catches up on refresh.
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [edit, setEdit] = useState<Task | null>(null)
  const [showDone, setShowDone] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isDone = (t: Task) => pending[t.id] ?? t.done
  const open = useMemo(() => tasks.filter((t) => !isDone(t)).sort(sortOpen), [tasks, pending]) // eslint-disable-line react-hooks/exhaustive-deps
  const done = useMemo(() => tasks.filter(isDone).sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? '')), [tasks, pending]) // eslint-disable-line react-hooks/exhaustive-deps
  const overdue = open.filter((t) => t.due_date && t.due_date < today()).length
  const people = useMemo(() => [...new Set([personName(me), ...tasks.map((t) => t.assigned_to).filter(Boolean) as string[]])].filter(Boolean), [tasks, me])

  const toggle = async (t: Task) => {
    const next = !isDone(t)
    setPending((p) => ({ ...p, [t.id]: next }))
    setError(null)
    try {
      await repo.updateTask(t.id, next ? { done: true, done_at: new Date().toISOString(), done_by: me } : { done: false, done_at: null, done_by: null })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending((p) => { const { [t.id]: _, ...rest } = p; return rest })
    }
  }

  const clearDone = async () => {
    setError(null)
    try {
      for (const t of done) await repo.deleteTask(t.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">To-do</h1>
        <span className="text-sm text-stone-500">
          {open.length} open{overdue > 0 && <span className="font-semibold text-rose-700"> · {overdue} overdue</span>}
        </span>
      </div>

      {tasksError && (
        <div role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          The to-do list could not load. If it was just added, run <b>supabase/tasks.sql</b> in Supabase → SQL Editor once.
          <div className="mt-1 text-xs text-amber-800">{tasksError}</div>
        </div>
      )}

      <AddTask people={people} />

      {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

      {open.length === 0 ? (
        <Empty>{tasks.length ? 'All done. 🎉' : <>No tasks yet. Add one above, or say “todo call electrician” in the chat.</>}</Empty>
      ) : (
        <ul className="card divide-y divide-stone-100">
          {open.map((t) => <TaskRow key={t.id} t={t} done={false} onToggle={() => void toggle(t)} onOpen={() => setEdit(t)} showScope={!!exhibition} />)}
        </ul>
      )}

      {done.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <button className="text-sm font-semibold text-stone-600" onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}>
              {showDone ? '▾' : '▸'} Completed · {done.length}
            </button>
            {showDone && (
              <ConfirmButton label="Delete completed" className="text-xs font-medium text-rose-700" question={`Delete all ${done.length} completed task${done.length > 1 ? 's' : ''}?`} confirmLabel="Delete" onConfirm={() => void clearDone()} />
            )}
          </div>
          {showDone && (
            <ul className="card divide-y divide-stone-100">
              {done.map((t) => <TaskRow key={t.id} t={t} done onToggle={() => void toggle(t)} onOpen={() => setEdit(t)} showScope={!!exhibition} />)}
            </ul>
          )}
        </section>
      )}

      {edit && <TaskForm task={edit} people={people} onClose={() => setEdit(null)} />}
    </div>
  )
}

function TaskRow({ t, done, onToggle, onOpen, showScope }: { t: Task; done: boolean; onToggle(): void; onOpen(): void; showScope: boolean }) {
  const due = t.due_date
  const late = !done && due && due < today()
  const meta: React.ReactNode[] = []
  if (done) meta.push(<span key="d">Done{t.done_by ? ` by ${personName(t.done_by)}` : ''}{t.done_at ? ` · ${fmtDate(t.done_at.slice(0, 10))}` : ''}</span>)
  else if (due) meta.push(<span key="due" className={late ? 'font-semibold text-rose-700' : due === today() ? 'font-semibold text-brand-700' : ''}>{late ? `Overdue · ${fmtDate(due)}` : due === today() ? 'Today' : due === addDays(today(), 1) ? 'Tomorrow' : fmtDate(due)}</span>)
  if (t.assigned_to) meta.push(<span key="a">👤 {t.assigned_to}</span>)
  if (showScope && t.exhibition_id === null) meta.push(<span key="g">General</span>)

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark “${t.title}” as not done` : `Mark “${t.title}” as done`}
        onClick={onToggle}
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition active:scale-90 ${done ? 'border-brand-700 bg-brand-700 text-white' : late ? 'border-rose-500' : 'border-stone-400'}`}
      >
        {done && <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className={`break-words ${done ? 'text-stone-400 line-through decoration-stone-400' : 'font-medium'}`}>{t.title}</div>
        {t.notes && !done && <div className="mt-0.5 line-clamp-2 text-xs text-stone-500">{t.notes}</div>}
        {meta.length > 0 && (
          <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs ${done ? 'text-stone-400' : 'text-stone-500'}`}>{meta}</div>
        )}
      </button>
    </li>
  )
}

function AddTask({ people }: { people: string[] }) {
  const { repo, refresh, exhibition, me } = useStore()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [who, setWho] = useState('')
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true); setError(null)
    try {
      await repo.createTask({
        exhibition_id: exhibition?.id ?? null, title: title.trim(), notes: null, assigned_to: who.trim() || null,
        due_date: due || null, done: false, done_at: null, done_by: null, created_by: me,
      })
      setTitle(''); setDue(''); setWho('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={add} className="card space-y-2 p-3">
      <div className="flex gap-2">
        <input id="todo-title" className="input flex-1" placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} enterKeyHint="done" autoComplete="off" aria-label="New task" />
        <button className="btn-primary" disabled={busy || !title.trim()}>Add</button>
      </div>
      {more ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Due date"><input id="todo-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <Field label="For whom">
            <input id="todo-who" className="input" list="todo-people" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Name" />
          </Field>
        </div>
      ) : (
        <button type="button" className="text-xs font-medium text-brand-700" onClick={() => setMore(true)}>＋ Due date / assign to someone</button>
      )}
      <datalist id="todo-people">{people.map((p) => <option key={p} value={p} />)}</datalist>
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </form>
  )
}

function TaskForm({ task, people, onClose }: { task: Task; people: string[]; onClose(): void }) {
  const { repo, refresh, exhibition } = useStore()
  const [f, setF] = useState({
    title: task.title, notes: task.notes ?? '', assigned_to: task.assigned_to ?? '', due_date: task.due_date ?? '',
    general: task.exhibition_id === null,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn(); await refresh(); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const save = () => run(async () => {
    if (!f.title.trim()) throw new Error('Type what needs to be done')
    await repo.updateTask(task.id, {
      title: f.title.trim(), notes: f.notes.trim() || null, assigned_to: f.assigned_to.trim() || null, due_date: f.due_date || null,
      exhibition_id: f.general ? null : task.exhibition_id ?? exhibition?.id ?? null,
    })
  })

  return (
    <Sheet open onClose={onClose} title="Task">
      <div className="space-y-3">
        <Field label="Task"><input id="task-title" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Notes"><textarea id="task-notes" className="input min-h-20" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Due date"><input id="task-due" type="date" className="input" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <Field label="For whom"><input id="task-who" className="input" list="todo-people" value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })} /></Field>
        </div>
        <datalist id="todo-people">{people.map((p) => <option key={p} value={p} />)}</datalist>
        {exhibition && (
          <label className="flex items-center gap-2 text-sm">
            <input id="task-general" type="checkbox" checked={f.general} onChange={(e) => setF({ ...f, general: e.target.checked })} />
            General task (show in every exhibition)
          </label>
        )}
        <p className="text-xs text-stone-500">
          Added{task.created_by ? ` by ${personName(task.created_by)}` : ''} · {fmtDate(task.created_at.slice(0, 10))}
          {task.done && task.done_at && ` · Done${task.done_by ? ` by ${personName(task.done_by)}` : ''} · ${fmtDate(task.done_at.slice(0, 10))}`}
        </p>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <ConfirmButton disabled={busy} label="Delete" question={`Delete “${task.title}”?`} confirmLabel="Delete task" onConfirm={() => void run(() => repo.deleteTask(task.id))} />
          <button className="btn-primary flex-1" disabled={busy} onClick={save}>Save</button>
        </div>
      </div>
    </Sheet>
  )
}
