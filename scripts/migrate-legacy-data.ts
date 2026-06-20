/**
 * One-time backfill from the legacy JSONB-blob schema (leads/call_log/misc_data,
 * one row per user) into the normalized v2 schema (supabase/migrations/0001-0004).
 *
 * Run AFTER applying the v2 migrations, BEFORE dropping the legacy tables:
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run migrate:legacy
 *
 * Requires the service-role key as a server-side env var ONLY — never commit
 * it, never expose it to the browser. This script is meant to be run once
 * from a trusted machine (your laptop / CI), not from the deployed app.
 *
 * Known data-fidelity limits (see README "Migration notes"):
 *  - Tag names/colors lived only in each browser's localStorage (`lc_tags`),
 *    never synced to Supabase. We recreate one placeholder tag per distinct
 *    tagId actually referenced by a user's leads/calls, named "Imported Tag
 *    <id>". Rename them in Settings after migrating. If you still have
 *    access to the old app in a browser, you can instead run
 *    `copy(JSON.parse(localStorage.getItem('lc_tags')))` in devtools and
 *    paste the result into legacy-tags-export.json as { "<user_id>": [...] }
 *    to get exact names/colors back — this script will prefer that if present.
 *  - lc_caller_name and per-day session duration were also localStorage-only
 *    and cannot be recovered server-side; caller_name falls back to the
 *    email's local part (already set by the profile backfill migration).
 *  - daily_stats is recomputed from the imported call_log rather than copied,
 *    since the legacy snapshot was localStorage-only too.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars before running.');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TAG_COLORS = [
  { bg: 'rgba(0,207,180,0.14)', text: '#2ddfc8' },
  { bg: 'rgba(176,138,250,0.14)', text: '#b08afa' },
  { bg: 'rgba(255,140,75,0.14)', text: '#ff8c4b' },
  { bg: 'rgba(34,201,123,0.14)', text: '#22c97b' },
  { bg: 'rgba(240,82,82,0.14)', text: '#f05252' },
];

type LegacyTagsExport = Record<string, Array<{ id: string; name: string; bg?: string; text?: string }>>;

function loadLegacyTagsExport(): LegacyTagsExport {
  const p = path.resolve(process.cwd(), 'legacy-tags-export.json');
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    console.warn('Could not parse legacy-tags-export.json, ignoring it.');
    return {};
  }
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

const STATUS_SET = new Set([
  'new', 'voicemail', 'followup', 'followup2', 'followup3',
  'negotiating', 'contract', 'dead', 'declined', 'onhold',
]);

async function main() {
  const legacyTags = loadLegacyTagsExport();

  const { data: legacyLeadRows, error: leadsErr } = await db.from('leads').select('user_id, data');
  if (leadsErr) throw leadsErr;

  const { data: legacyCallRows, error: callsErr } = await db.from('call_log').select('user_id, data');
  if (callsErr) throw callsErr;

  const { data: miscRows, error: miscErr } = await db.from('misc_data').select('user_id, key, data');
  if (miscErr) throw miscErr;

  const miscByUser = new Map<string, Map<string, unknown>>();
  for (const row of miscRows ?? []) {
    if (!miscByUser.has(row.user_id)) miscByUser.set(row.user_id, new Map());
    miscByUser.get(row.user_id)!.set(row.key, row.data);
  }

  let totalLeads = 0;
  let totalCalls = 0;
  let totalTags = 0;
  let totalTasks = 0;

  for (const row of legacyLeadRows ?? []) {
    const userId: string = row.user_id;
    const legacyLeads: any[] = Array.isArray(row.data) ? row.data : [];
    if (legacyLeads.length === 0) continue;

    console.log(`\n— User ${userId}: ${legacyLeads.length} leads`);

    // 1. Tags: build/find tag rows for every distinct tagId referenced.
    const tagIdsSeen = new Set<string>();
    for (const l of legacyLeads) for (const t of l.tagIds ?? []) tagIdsSeen.add(t);

    const oldToNewTagId = new Map<string, string>();
    const exportedTags = legacyTags[userId] ?? [];
    let colorIdx = 0;
    for (const oldTagId of tagIdsSeen) {
      const exported = exportedTags.find((t) => t.id === oldTagId);
      const name = exported?.name ?? `Imported Tag ${oldTagId.slice(-6)}`;
      const colorBg = exported?.bg ?? TAG_COLORS[colorIdx % TAG_COLORS.length].bg;
      const colorText = exported?.text ?? TAG_COLORS[colorIdx % TAG_COLORS.length].text;
      colorIdx++;

      const { data: existing } = await db
        .from('tags')
        .select('id')
        .eq('user_id', userId)
        .eq('name', name)
        .maybeSingle();

      let tagId = existing?.id;
      if (!tagId) {
        const { data: inserted, error } = await db
          .from('tags')
          .insert({ user_id: userId, name, color_bg: colorBg, color_text: colorText })
          .select('id')
          .single();
        if (error) {
          console.warn(`  tag insert failed for "${name}":`, error.message);
          continue;
        }
        tagId = inserted.id;
        totalTags++;
      }
      oldToNewTagId.set(oldTagId, tagId);
    }

    // 2. Leads
    const oldToNewLeadId = new Map<string, string>();
    for (const l of legacyLeads) {
      const status = STATUS_SET.has(l.status) ? l.status : 'new';
      const repairsObj: Record<string, boolean> = {};
      if (Array.isArray(l.repairs)) {
        for (const key of l.repairs) repairsObj[key] = true;
      } else if (l.repairs && typeof l.repairs === 'object') {
        Object.assign(repairsObj, l.repairs);
      }

      const insertPayload = {
        user_id: userId,
        lead_num: num(l.leadNum),
        first_name: str(l.name) ?? '',
        last_name: str(l.lastname) ?? '',
        phone: str(l.phone) ?? '',
        phone2: str(l.phone2),
        email: str(l.email),
        address: str(l.address),
        state: str(l.state),
        beds: num(l.beds),
        baths: num(l.baths),
        sqft: num(l.sqft),
        lot_size: str(l.lotsize),
        prop_type: str(l.propType ?? l.proptype),
        extra: str(l.extra),
        batch: str(l.batch),
        status,
        rating: num(l.rating) ?? 0,
        property_rating: num(l.propertyRating),
        note: str(l.note),
        motivation: str(l.motivation),
        year_built: num(l.yearBuilt),
        condition: str(l.condition),
        arv: num(l.arv ?? l.kcfARV),
        as_is: num(l.asIs),
        est_repairs: num(l.estRepairs),
        min_offer: num(l.minOffer),
        max_offer: num(l.maxOffer),
        asking_price: num(l.askingPrice ?? l.kcfAskingPrice),
        final_price: num(l.finalPrice ?? l.kcfFinalPrice),
        repairs: repairsObj,
        call_answers: l.callAnswers ?? {},
        kcf_data: l.kcfData ?? { checks: {}, fields: {} },
        followup_date: str(l.followupDate),
        next_call_date: str(l.nextCallDate),
        voicemail_count: num(l.voicemailCount) ?? 0,
        called_at: str(l.calledAt),
        created_at: str(l.createdAt) ?? new Date().toISOString(),
      };

      const { data: inserted, error } = await db.from('leads').insert(insertPayload).select('id').single();
      if (error) {
        console.warn(`  lead insert failed for "${l.name} ${l.lastname}":`, error.message);
        continue;
      }
      oldToNewLeadId.set(l.id, inserted.id);
      totalLeads++;

      const newTagIds = (l.tagIds ?? []).map((t: string) => oldToNewTagId.get(t)).filter(Boolean);
      if (newTagIds.length) {
        await db.from('lead_tags').insert(newTagIds.map((tagId: string) => ({ lead_id: inserted.id, tag_id: tagId })));
      }

      if (Array.isArray(l.comps) && l.comps.length) {
        await db.from('lead_comps').insert(
          l.comps.map((c: any) => ({
            lead_id: inserted.id,
            address: str(c.address),
            price: num(c.price),
            sqft: num(c.sqft),
            beds: num(c.beds),
            baths: num(c.baths),
            distance: str(c.distance),
            notes: str(c.notes),
          })),
        );
      }
      // Note: l.photos (base64 data-URLs) are intentionally not migrated —
      // upload them to the lead-photos storage bucket from the lead detail
      // page after migrating if you need them; base64 blobs in a JSONB column
      // would bloat the new leads table considerably.
    }

    // 3. Call log
    const userCallRow = (legacyCallRows ?? []).find((r) => r.user_id === userId);
    const legacyCalls: any[] = Array.isArray(userCallRow?.data) ? userCallRow!.data : [];
    for (const c of legacyCalls) {
      const status = STATUS_SET.has(c.status) ? c.status : 'new';
      const { data: inserted, error } = await db
        .from('call_log')
        .insert({
          user_id: userId,
          lead_id: oldToNewLeadId.get(c.leadId) ?? null,
          lead_num: num(c.leadNum),
          name: str(c.name) ?? '',
          phone: str(c.phone) ?? '',
          address: str(c.address),
          status,
          rating: num(c.rating) ?? 0,
          note: str(c.note),
          created_at: str(c.ts) ?? new Date().toISOString(),
        })
        .select('id')
        .single();
      if (error) {
        console.warn('  call_log insert failed:', error.message);
        continue;
      }
      totalCalls++;
      const newTagIds = (c.tagIds ?? []).map((t: string) => oldToNewTagId.get(t)).filter(Boolean);
      if (newTagIds.length) {
        await db
          .from('call_log_tags')
          .insert(newTagIds.map((tagId: string) => ({ call_log_id: inserted.id, tag_id: tagId })));
      }
    }

    // 4. misc_data: tasks / session_days / team_members
    const misc = miscByUser.get(userId);
    if (misc) {
      const tasksRaw = misc.get('tasks');
      const tasks = normalizeLegacyTasks(tasksRaw, oldToNewLeadId);
      if (tasks.length) {
        await db.from('tasks').insert(tasks.map((t) => ({ ...t, user_id: userId })));
        totalTasks += tasks.length;
      }

      const sessionDays: string[] = Array.isArray(misc.get('session_days')) ? (misc.get('session_days') as string[]) : [];
      for (const day of sessionDays) {
        const callsThatDay = legacyCalls.filter((c) => String(c.ts).slice(0, 10) === day).length;
        await db
          .from('session_log')
          .upsert(
            { user_id: userId, session_date: day, duration_seconds: 0, calls_made: callsThatDay },
            { onConflict: 'user_id,session_date' },
          );
      }
    }
  }

  // 5. team_members — stored on the *owner's* misc_data row, separate pass.
  for (const [ownerId, kv] of miscByUser) {
    const team = kv.get('team_members');
    if (!Array.isArray(team)) continue;
    for (const entry of team as any[]) {
      const memberId = entry.uid ?? entry.id ?? entry.memberUid ?? entry.user_id;
      if (!memberId) continue;
      const { error } = await db
        .from('team_members')
        .upsert({ owner_id: ownerId, member_id: memberId }, { onConflict: 'owner_id,member_id' });
      if (error) console.warn(`  team_members link failed (${ownerId} -> ${memberId}):`, error.message);
    }
  }

  // 6. Recompute daily_stats from the now-imported call_log (legacy snapshot
  //    was localStorage-only, so there's nothing to copy — we derive it).
  const { error: statsErr } = await db.rpc('recompute_daily_stats_all');
  if (statsErr) console.warn('daily_stats recompute skipped (helper function not present):', statsErr.message);

  console.log('\nDone.');
  console.log({ totalLeads, totalCalls, totalTags, totalTasks });
}

function normalizeLegacyTasks(raw: unknown, oldToNewLeadId: Map<string, string>) {
  const out: Array<{ lead_id: string | null; title: string; due_date: string | null; completed: boolean }> = [];
  if (!raw) return out;

  const pushOne = (leadOldId: string | null, t: any) => {
    if (!t) return;
    const title = str(t.title ?? t.text ?? t.name);
    if (!title) return;
    out.push({
      lead_id: leadOldId ? oldToNewLeadId.get(leadOldId) ?? null : null,
      title,
      due_date: str(t.dueDate ?? t.due_date ?? t.date),
      completed: Boolean(t.completed ?? t.done),
    });
  };

  if (Array.isArray(raw)) {
    for (const t of raw) pushOne(t.leadId ?? null, t);
  } else if (typeof raw === 'object') {
    for (const [leadOldId, list] of Object.entries(raw as Record<string, any>)) {
      if (Array.isArray(list)) for (const t of list) pushOne(leadOldId, t);
      else pushOne(leadOldId, list);
    }
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
