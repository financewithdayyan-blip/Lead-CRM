import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Bot, Search } from 'lucide-react';
import { useInboxConversations, useMarkThreadRead } from '@/hooks/useInbox';
import { StageBadge } from '@/components/ui/StageBadge';
import { SmsThreadTab } from '@/components/sms/SmsThreadTab';
import { cn, formatPhone, titleCase } from '@/lib/utils';
import type { Lead } from '@/types/domain';

// Same small hash-based avatar palette duplicated in LeadsPage/CallHistoryPage/
// BulkSmsPage/LeadProfilePage/ContractInstanceTableRow — matching that existing
// per-file convention rather than introducing a new shared import for it.
const AVATAR_PALETTE = [
  { bg: 'rgba(255,181,71,.15)', text: '#FFC46B' },
  { bg: 'rgba(110,123,255,.18)', text: '#A9B1FF' },
  { bg: 'rgba(61,214,181,.14)', text: '#4FE0BF' },
  { bg: 'rgba(90,184,255,.14)', text: '#7CC6FF' },
  { bg: 'rgba(180,140,255,.15)', text: '#C7A8FF' },
  { bg: 'rgba(255,107,107,.13)', text: '#FF8A8A' },
];
function avatarColorFor(id: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

type FilterKey = 'all' | 'unread' | 'needsReply' | 'aiActive';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'needsReply', label: 'Needs Reply' },
  { key: 'aiActive', label: 'AI Active' },
];

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const hr = Math.floor(diffMin / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function InboxPage() {
  const navigate = useNavigate();
  const { data: conversations = [], isLoading } = useInboxConversations();
  const markRead = useMarkThreadRead();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Opens the most recent conversation the first time the list actually
  // has data, so the detail pane isn't sitting empty on first load — only
  // once, so it never yanks the selection away from under someone who's
  // mid-reply just because the list re-sorted.
  useEffect(() => {
    if (selectedId === null && conversations.length > 0) setSelectedId(conversations[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length > 0]);

  const filtered = useMemo(() => {
    let list = conversations;
    if (filter === 'unread') list = list.filter((l) => l.hasUnreadSms);
    else if (filter === 'needsReply') list = list.filter((l) => l.lastMessageDirection === 'inbound' && l.aiReplyPaused);
    else if (filter === 'aiActive') list = list.filter((l) => !l.aiReplyPaused);

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (l) =>
          `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
          (l.phone ?? '').includes(q) ||
          (l.address ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [conversations, filter, query]);

  const selected = conversations.find((l) => l.id === selectedId) ?? null;

  function openConversation(lead: Lead) {
    setSelectedId(lead.id);
    if (lead.hasUnreadSms) markRead.mutate(lead.id);
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight text-text">Inbox</h1>
        <p className="text-sm text-text-3">Every SMS conversation across your leads, in one place.</p>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="card flex w-full shrink-0 flex-col !p-0 lg:w-[340px]">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, phone, address…"
                className="input w-full !pl-8 text-[13px]"
              />
            </div>
            <div className="mt-2.5 flex gap-1.5 overflow-x-auto">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'shrink-0 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
                    filter === f.key
                      ? 'border-primary bg-primary-dim text-primary-text'
                      : 'border-border text-text-3 hover:text-text-2',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[640px] overflow-y-auto">
            {isLoading && <div className="px-4 py-8 text-center text-[13px] text-text-3">Loading…</div>}
            {!isLoading && filtered.length === 0 && (
              <div className="px-4 py-8 text-center text-[13px] text-text-3">
                No conversations {filter !== 'all' || query ? 'match this' : 'yet'}.
              </div>
            )}
            {filtered.map((lead) => {
              const avatar = avatarColorFor(lead.id);
              const active = lead.id === selectedId;
              return (
                <button
                  key={lead.id}
                  onClick={() => openConversation(lead)}
                  className={cn(
                    'flex w-full items-start gap-2.5 border-b border-border px-3 py-3 text-left transition-colors',
                    active ? 'bg-primary-dim' : 'hover:bg-surface-3',
                  )}
                >
                  <span
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
                    style={{ background: avatar.bg, color: avatar.text }}
                  >
                    {(lead.firstName[0] ?? '?').toUpperCase()}
                    {(lead.lastName[0] ?? '').toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn('truncate text-[13.5px]', lead.hasUnreadSms ? 'font-bold text-text' : 'font-medium text-text-2')}>
                        {titleCase(lead.firstName)} {titleCase(lead.lastName)}
                      </span>
                      <span className="shrink-0 text-[11px] text-text-3">{relativeTime(lead.lastMessageAt)}</span>
                    </span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <StageBadge stage={lead.stage} />
                      {!lead.aiReplyPaused && (
                        <span title="AI is actively handling this conversation" className="text-primary">
                          <Bot size={11} />
                        </span>
                      )}
                    </span>
                    <span className={cn('mt-1 block truncate text-[12.5px]', lead.hasUnreadSms ? 'text-text-2' : 'text-text-3')}>
                      {lead.lastMessageDirection === 'outbound' ? 'You: ' : ''}
                      {lead.lastMessagePreview || '—'}
                    </span>
                  </span>
                  {lead.hasUnreadSms && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {selected ? (
            <div className="space-y-3">
              <div className="card flex items-center justify-between !py-3">
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold text-text">
                    {titleCase(selected.firstName)} {titleCase(selected.lastName)}
                  </div>
                  <div className="text-[12px] text-text-3">{formatPhone(selected.phone)}</div>
                </div>
                <button onClick={() => navigate(`/leads/${selected.id}`)} className="btn shrink-0 !px-2.5 !py-1.5 text-[12px]">
                  Open profile <ArrowUpRight size={13} />
                </button>
              </div>
              <SmsThreadTab lead={selected} />
            </div>
          ) : (
            <div className="card flex min-h-[300px] items-center justify-center text-[13px] text-text-3">
              {isLoading ? 'Loading…' : 'Select a conversation to view it.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
