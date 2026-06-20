import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { CS_STEPS } from '@/lib/csSteps';

interface CompRow {
  addr: string;
  price: string;
}

export function ScriptPage() {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [comps, setComps] = useState<Record<string, CompRow[]>>({});
  const [callbackTime, setCallbackTime] = useState('');

  function toggle(id: string) {
    setDone((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function setNote(id: string, value: string) {
    setNotes((prev) => ({ ...prev, [id]: value }));
  }

  function setComp(stepId: string, idx: number, field: keyof CompRow, value: string) {
    setComps((prev) => {
      const rows = prev[stepId] ? [...prev[stepId]] : Array.from({ length: 3 }, () => ({ addr: '', price: '' }));
      rows[idx] = { ...rows[idx], [field]: value };
      return { ...prev, [stepId]: rows };
    });
  }

  function reset() {
    setDone(new Set());
    setNotes({});
    setComps({});
    setCallbackTime('');
  }

  const pct = Math.round((done.size / CS_STEPS.length) * 100);

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-text">Call Script</h1>
          <p className="text-sm text-text-3">Step-by-step checklist to keep calls on track. Resets when you start a new call.</p>
        </div>
        <button className="btn" onClick={reset}>
          <RotateCcw size={14} /> Reset
        </button>
      </div>

      <div className="card mb-4 !py-3">
        <div className="flex items-center justify-between text-[12px] text-text-2">
          <span>Progress</span>
          <span className="font-mono">
            {done.size} / {CS_STEPS.length}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-blue transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="space-y-3">
        {CS_STEPS.map((step) => {
          const isChecked = done.has(step.id);
          const rows = comps[step.id] ?? Array.from({ length: step.comps ?? 0 }, () => ({ addr: '', price: '' }));
          return (
            <div key={step.id} className={`card transition-colors ${isChecked ? '!border-green/40 bg-green-dim' : ''}`}>
              <div className="flex items-start gap-3">
                <button
                  onClick={() => toggle(step.id)}
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[12px] font-bold ${
                    isChecked ? 'border-green bg-green text-bg' : 'border-border-3 text-transparent'
                  }`}
                >
                  ✓
                </button>
                <div className="flex-1">
                  {step.label && <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">{step.label}</div>}
                  <div className="font-display text-[15px] font-semibold text-text">{step.title}</div>
                  {step.script && <div className="mt-1 text-[13px] italic text-text-2">{step.script}</div>}

                  {step.hasComps && (
                    <div className="mt-3 space-y-2">
                      {rows.map((row, i) => (
                        <div key={i} className="flex gap-2">
                          <input
                            className="input"
                            placeholder="Comp address"
                            value={row.addr}
                            onChange={(e) => setComp(step.id, i, 'addr', e.target.value)}
                          />
                          <input
                            className="input max-w-[120px]"
                            placeholder="$"
                            value={row.price}
                            onChange={(e) => setComp(step.id, i, 'price', e.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {step.hasPhotoUpload && (
                    <input
                      className="input mt-3"
                      placeholder="Best callback time (e.g. Tomorrow after 2pm)"
                      value={callbackTime}
                      onChange={(e) => setCallbackTime(e.target.value)}
                    />
                  )}

                  {step.note && (
                    <textarea
                      className="input mt-3 min-h-[60px]"
                      placeholder="Notes…"
                      value={notes[step.id] ?? ''}
                      onChange={(e) => setNote(step.id, e.target.value)}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
