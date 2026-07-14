import { useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTags, useCreateTag, useDeleteTag, nextTagColor } from '@/hooks/useTags';
import { useUpdateProfile } from '@/hooks/useProfile';
import { useBusinessCard } from '@/hooks/useBusinessCard';
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
  const isAdmin = profile?.role === 'admin';
  const { data: tags = [] } = useTags();
  const createTag = useCreateTag();
  const deleteTag = useDeleteTag();
  const updateProfile = useUpdateProfile();

  const { cardDataUrl, saveCard, removeCard } = useBusinessCard();
  const cardInputRef = useRef<HTMLInputElement>(null);
  const [cardSaving, setCardSaving] = useState(false);
  const [cardSaved, setCardSaved] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  const [fullName, setFullName] = useState(profile?.fullName ?? '');
  const [fullNameSaved, setFullNameSaved] = useState(false);
  const [dailyGoal, setDailyGoal] = useState(String(profile?.dailyGoal ?? 20));
  const [dailyGoalSaved, setDailyGoalSaved] = useState(false);
  const [monthlyGoal, setMonthlyGoal] = useState(String(profile?.monthlyGoal ?? 400));
  const [monthlyGoalSaved, setMonthlyGoalSaved] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [tagDeleteTarget, setTagDeleteTarget] = useState<string | null>(null);

  async function handleCardUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setCardError('Image must be under 5 MB.');
      return;
    }
    setCardError(null);
    setCardSaving(true);
    try {
      await saveCard(file);
      flash(setCardSaved);
    } catch {
      setCardError('Failed to save image. Try a different file.');
    } finally {
      setCardSaving(false);
      if (cardInputRef.current) cardInputRef.current.value = '';
    }
  }

  function saveFullName() {
    const name = fullName.trim();
    if (!name) return;
    updateProfile.mutate({ fullName: name }, { onSuccess: () => flash(setFullNameSaved) });
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

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-text">Settings</h1>
        <p className="text-sm text-text-3">Manage your profile, goals, and tags</p>
      </div>

      <div className="space-y-4">
        <div className="card">
          <div className="text-sm font-semibold text-text">Business Card</div>
          <p className="mt-1 text-[13px] text-text-2">
            Upload your business card image. During a call session, it will be shown alongside the copy-text-message button so you can paste it into any messaging app as an attachment.
          </p>
          <input
            ref={cardInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleCardUpload}
          />
          {cardDataUrl ? (
            <div className="mt-3 flex flex-wrap items-start gap-4">
              <img
                src={cardDataUrl}
                alt="Your business card"
                className="h-28 max-w-xs rounded-lg border border-border object-contain shadow-sm"
              />
              <div className="flex flex-col gap-2 pt-1">
                <button
                  className="btn btn-primary"
                  disabled={cardSaving}
                  onClick={() => cardInputRef.current?.click()}
                >
                  {cardSaving ? 'Saving…' : 'Replace image'}
                </button>
                <button
                  className="btn !text-danger"
                  onClick={removeCard}
                >
                  Remove card
                </button>
                {cardSaved && <span className="text-[11px] text-success">✓ Saved</span>}
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                className="btn btn-primary"
                disabled={cardSaving}
                onClick={() => cardInputRef.current?.click()}
              >
                {cardSaving ? 'Saving…' : 'Upload business card'}
              </button>
              {cardSaved && <span className="text-[11px] text-success">✓ Saved</span>}
            </div>
          )}
          {cardError && <p className="mt-2 text-[12px] text-danger">{cardError}</p>}
        </div>

        <div className="card">
          <div className="text-sm font-semibold text-text">Your name</div>
          <p className="mt-1 text-[13px] text-text-2">Shown to your team and used across the app.</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Full name</label>
              <input
                className="input"
                placeholder="e.g. Dayyan Khan"
                maxLength={60}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveFullName()}
              />
            </div>
            <button className="btn btn-primary" onClick={saveFullName}>
              Save name
            </button>
            {fullNameSaved && <span className="text-[11px] text-success">✓ Saved</span>}
          </div>
        </div>

        <div className="card">
          <div className="text-sm font-semibold text-text">Daily Call Goal</div>
          <p className="mt-1 text-[13px] text-text-2">
            {isAdmin ? "Tracked on your dashboard's daily goal bar." : 'Set by your admin. Tracked on your dashboard’s daily goal bar.'}
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Daily target</label>
              <input
                className="input max-w-[140px]"
                type="number"
                min={1}
                disabled={!isAdmin}
                value={dailyGoal}
                onChange={(e) => setDailyGoal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveDailyGoal()}
              />
            </div>
            {isAdmin && (
              <button className="btn btn-primary" onClick={saveDailyGoal}>
                Save
              </button>
            )}
            {dailyGoalSaved && <span className="text-[11px] text-success">✓ Saved</span>}
          </div>
        </div>

        <div className="card">
          <div className="text-sm font-semibold text-text">Monthly Call Goal</div>
          <p className="mt-1 text-[13px] text-text-2">
            {isAdmin ? 'Target number of calls for the monthly goal bar on your dashboard.' : 'Set by your admin. Tracked on your dashboard’s monthly goal bar.'}
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Monthly target</label>
              <input
                className="input max-w-[140px]"
                type="number"
                min={1}
                disabled={!isAdmin}
                value={monthlyGoal}
                onChange={(e) => setMonthlyGoal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveMonthlyGoal()}
              />
            </div>
            {isAdmin && (
              <button className="btn btn-primary" onClick={saveMonthlyGoal}>
                Save
              </button>
            )}
            {monthlyGoalSaved && <span className="text-[11px] text-success">✓ Saved</span>}
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
    </div>
  );
}
