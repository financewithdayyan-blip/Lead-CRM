import { useState } from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTags, useCreateTag, useDeleteTag, nextTagColor } from '@/hooks/useTags';
import { useUpdateProfile, useEraseAllData } from '@/hooks/useProfile';
import { TagPill } from '@/components/ui/TagPill';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const PRESETS = [
  'Foreclosure',
  'Pre-Foreclosure',
  'Probate',
  'Public Records',
  'PropWire',
  'Driving for Dollars',
  'Tax Delinquent',
  'Absentee Owner',
  'Inheritance',
  'Code Violation',
  'Fire Damage',
  'Vacant Property',
  'Expired Listing',
  'FSBO',
  'Water Damage',
];

export function SettingsPage() {
  const { profile } = useAuth();
  const { data: tags = [] } = useTags();
  const createTag = useCreateTag();
  const deleteTag = useDeleteTag();
  const updateProfile = useUpdateProfile();
  const eraseAllData = useEraseAllData();

  const [callerName, setCallerName] = useState(profile?.callerName ?? '');
  const [callerNameSaved, setCallerNameSaved] = useState(false);
  const [dailyGoal, setDailyGoal] = useState(String(profile?.dailyGoal ?? 150));
  const [dailyGoalSaved, setDailyGoalSaved] = useState(false);
  const [monthlyGoal, setMonthlyGoal] = useState(String(profile?.monthlyGoal ?? 3000));
  const [monthlyGoalSaved, setMonthlyGoalSaved] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [tagDeleteTarget, setTagDeleteTarget] = useState<string | null>(null);
  const [nukeConfirmOpen, setNukeConfirmOpen] = useState(false);
  const [nukeText, setNukeText] = useState('');
  const [nukeDone, setNukeDone] = useState(false);

  function saveCallerName() {
    const name = callerName.trim();
    if (!name) return;
    updateProfile.mutate({ callerName: name }, { onSuccess: () => flash(setCallerNameSaved) });
  }

  function saveDailyGoal() {
    const n = parseInt(dailyGoal, 10);
    if (isNaN(n) || n < 1) return;
    updateProfile.mutate({ dailyGoal: n }, { onSuccess: () => flash(setDailyGoalSaved) });
  }

  function saveMonthlyGoal() {
    const n = parseInt(monthlyGoal, 10);
    if (isNaN(n) || n < 1) return;
    updateProfile.mutate({ monthlyGoal: n }, { onSuccess: () => flash(setMonthlyGoalSaved) });
  }

  function flash(setter: (v: boolean) => void) {
    setter(true);
    setTimeout(() => setter(false), 2000);
  }

  function handleAddTag() {
    const name = newTagName.trim();
    if (!name) return;
    if (tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) return;
    const c = nextTagColor(tags.length);
    createTag.mutate({ name, colorBg: c.bg, colorText: c.text });
    setNewTagName('');
  }

  function handleAddPreset(name: string) {
    if (tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) return;
    const c = nextTagColor(tags.length);
    createTag.mutate({ name, colorBg: c.bg, colorText: c.text });
  }

  function handleNuke() {
    eraseAllData.mutate(undefined, {
      onSuccess: () => {
        setNukeConfirmOpen(false);
        setNukeText('');
        setNukeDone(true);
      },
    });
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-semibold text-text">Settings</h1>
        <p className="text-sm text-text-3">Manage tags and calling preferences</p>
      </div>

      <div className="space-y-4">
        <div className="card">
          <div className="text-sm font-semibold text-text">👤 Caller Name</div>
          <p className="mt-1 text-[13px] text-text-2">
            Your name is used in the call script introduction — e.g. <em>"Hi, this is {callerName || 'Dayyan'}…"</em>. Each user on this app sets
            their own name.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Your first name</label>
              <input
                className="input"
                placeholder="e.g. Dayyan"
                maxLength={40}
                value={callerName}
                onChange={(e) => setCallerName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveCallerName()}
              />
            </div>
            <button className="btn btn-primary" onClick={saveCallerName}>
              Save name
            </button>
            {callerNameSaved && <span className="text-[11px] text-green">✓ Saved</span>}
          </div>
        </div>

        <div className="card">
          <div className="text-sm font-semibold text-text">☀️ Daily Call Goal</div>
          <p className="mt-1 text-[13px] text-text-2">
            When you reach this target during a session, you'll be prompted that the goal has been met.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Daily target</label>
              <input
                className="input max-w-[140px]"
                type="number"
                min={1}
                value={dailyGoal}
                onChange={(e) => setDailyGoal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveDailyGoal()}
              />
            </div>
            <button className="btn btn-primary" onClick={saveDailyGoal}>
              Save
            </button>
            {dailyGoalSaved && <span className="text-[11px] text-green">✓ Saved</span>}
          </div>
        </div>

        <div className="card">
          <div className="text-sm font-semibold text-text">🎯 Monthly Call Goal</div>
          <p className="mt-1 text-[13px] text-text-2">Target number of calls for the monthly goal bar on your dashboard.</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Monthly target</label>
              <input
                className="input max-w-[140px]"
                type="number"
                min={1}
                value={monthlyGoal}
                onChange={(e) => setMonthlyGoal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveMonthlyGoal()}
              />
            </div>
            <button className="btn btn-primary" onClick={saveMonthlyGoal}>
              Save
            </button>
            {monthlyGoalSaved && <span className="text-[11px] text-green">✓ Saved</span>}
          </div>
        </div>

        <div className="card">
          <div className="text-sm font-semibold text-text">Your tags</div>
          <p className="mt-1 text-[13px] text-text-2">
            Tags let you categorize leads by type or source. When uploading a CSV you can assign tags to the whole batch.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {tags.length === 0 && <div className="text-[13px] text-text-3">No tags yet.</div>}
            {tags.map((t) => (
              <TagPill key={t.id} tag={t} onRemove={() => setTagDeleteTarget(t.id)} />
            ))}
          </div>

          <div className="my-4 border-t border-border" />

          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Create new tag</div>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Tag name</label>
              <input
                className="input"
                placeholder="e.g. Tax Delinquent"
                maxLength={30}
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
              />
            </div>
            <button className="btn btn-primary" onClick={handleAddTag}>
              Add tag
            </button>
          </div>
        </div>

        <div className="card">
          <div className="text-sm font-semibold text-text">Quick-add presets</div>
          <p className="mt-1 text-[13px] text-text-2">Common lead types in real estate. Click any to instantly add it as a tag.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {PRESETS.map((name) => {
              const exists = tags.some((t) => t.name.toLowerCase() === name.toLowerCase());
              return (
                <button key={name} className="btn !py-1 !text-[12px]" disabled={exists} onClick={() => handleAddPreset(name)}>
                  {name}
                  {exists ? ' ✓' : ' +'}
                </button>
              );
            })}
          </div>
        </div>

        <div className="card !border-red/25 !bg-red-dim">
          <div className="flex items-center gap-2 text-sm font-semibold text-red">
            <AlertTriangle size={15} /> Danger Zone
          </div>
          <p className="mt-1 text-[13px] text-text-2">
            Permanently delete all data in your account — leads, call logs, analytics, tags, and sessions. This cannot be undone.
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-red/20 bg-red-dim p-4">
            <div>
              <div className="text-[13px] font-semibold text-text">Reset all data</div>
              <div className="text-[12px] text-text-2">Removes leads, call logs, sessions, tags, and all analytics. You'll start fresh.</div>
            </div>
            <button className="btn btn-danger shrink-0" onClick={() => setNukeConfirmOpen(true)}>
              <Trash2 size={14} /> Erase All Data
            </button>
          </div>

          {nukeDone && <div className="mt-3 text-[12px] text-green">✓ All data erased.</div>}
        </div>
      </div>

      <ConfirmDialog
        open={!!tagDeleteTarget}
        title="Delete tag"
        message="Delete this tag? It will be removed from all leads."
        confirmLabel="Delete"
        danger
        onCancel={() => setTagDeleteTarget(null)}
        onConfirm={() => {
          if (tagDeleteTarget) deleteTag.mutate(tagDeleteTarget);
          setTagDeleteTarget(null);
        }}
      />

      {nukeConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="card max-w-md !border-red/45 !bg-red-dim">
            <div className="text-sm font-bold text-red">Are you absolutely sure?</div>
            <p className="mt-2 text-[13px] text-text-2">
              This will permanently erase every lead, call log, tag, task, and session for your account. There is no undo. Type{' '}
              <strong className="text-text">DELETE</strong> to confirm.
            </p>
            <input className="input mt-3" placeholder="Type DELETE" value={nukeText} onChange={(e) => setNukeText(e.target.value)} />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="btn"
                onClick={() => {
                  setNukeConfirmOpen(false);
                  setNukeText('');
                }}
              >
                Cancel
              </button>
              <button className="btn btn-danger" disabled={nukeText !== 'DELETE'} onClick={handleNuke}>
                Erase everything
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
