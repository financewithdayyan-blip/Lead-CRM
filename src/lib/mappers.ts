import type { CallLogEntry, DailyStat, Lead, Profile, SessionLogEntry, Tag, Task } from '@/types/domain';

export function dbToTag(row: any): Tag {
  return { id: row.id, userId: row.user_id, name: row.name, colorBg: row.color_bg, colorText: row.color_text };
}

export function dbToLead(row: any): Lead {
  return {
    id: row.id,
    userId: row.user_id,
    leadNum: row.lead_num,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    phone: row.phone ?? '',
    phone2: row.phone2,
    email: row.email,
    address: row.address,
    state: row.state,
    beds: row.beds,
    baths: row.baths,
    sqft: row.sqft,
    lotSize: row.lot_size,
    propType: row.prop_type,
    extra: row.extra,
    batch: row.batch,
    status: row.status,
    rating: row.rating ?? 0,
    propertyRating: row.property_rating,
    note: row.note,
    motivation: row.motivation,
    yearBuilt: row.year_built,
    condition: row.condition,
    arv: row.arv,
    asIs: row.as_is,
    estRepairs: row.est_repairs,
    minOffer: row.min_offer,
    maxOffer: row.max_offer,
    askingPrice: row.asking_price,
    finalPrice: row.final_price,
    repairs: row.repairs ?? {},
    callAnswers: row.call_answers ?? {},
    kcfData: row.kcf_data ?? { checks: {}, fields: {} },
    followupDate: row.followup_date,
    nextCallDate: row.next_call_date,
    voicemailCount: row.voicemail_count ?? 0,
    calledAt: row.called_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tagIds: (row.lead_tags ?? []).map((lt: any) => lt.tag_id),
    comps: row.lead_comps?.map((c: any) => ({
      id: c.id,
      leadId: c.lead_id,
      address: c.address,
      price: c.price,
      sqft: c.sqft,
      beds: c.beds,
      baths: c.baths,
      distance: c.distance,
      notes: c.notes,
    })),
    photoUrls: row.lead_photos?.map((p: any) => p.storage_path),
  };
}

export function leadToDbInsert(lead: Partial<Lead>, userId: string) {
  return {
    user_id: userId,
    lead_num: lead.leadNum,
    first_name: lead.firstName ?? '',
    last_name: lead.lastName ?? '',
    phone: lead.phone ?? '',
    phone2: lead.phone2 ?? null,
    email: lead.email ?? null,
    address: lead.address ?? null,
    state: lead.state ?? null,
    beds: lead.beds ?? null,
    baths: lead.baths ?? null,
    sqft: lead.sqft ?? null,
    lot_size: lead.lotSize ?? null,
    prop_type: lead.propType ?? null,
    extra: lead.extra ?? null,
    batch: lead.batch ?? null,
    status: lead.status ?? 'new',
    rating: lead.rating ?? 0,
    property_rating: lead.propertyRating ?? null,
    note: lead.note ?? null,
    motivation: lead.motivation ?? null,
    year_built: lead.yearBuilt ?? null,
    condition: lead.condition ?? null,
    arv: lead.arv ?? null,
    as_is: lead.asIs ?? null,
    est_repairs: lead.estRepairs ?? null,
    min_offer: lead.minOffer ?? null,
    max_offer: lead.maxOffer ?? null,
    asking_price: lead.askingPrice ?? null,
    final_price: lead.finalPrice ?? null,
    repairs: lead.repairs ?? {},
    call_answers: lead.callAnswers ?? {},
    kcf_data: lead.kcfData ?? { checks: {}, fields: {} },
    followup_date: lead.followupDate ?? null,
    next_call_date: lead.nextCallDate ?? null,
    voicemail_count: lead.voicemailCount ?? 0,
    called_at: lead.calledAt ?? null,
  };
}

export function leadToDbUpdate(lead: Partial<Lead>) {
  const payload = leadToDbInsert(lead, lead.userId ?? '');
  if (!lead.userId) delete (payload as any).user_id;
  return payload;
}

export function dbToCallLogEntry(row: any): CallLogEntry {
  return {
    id: row.id,
    userId: row.user_id,
    leadId: row.lead_id,
    leadNum: row.lead_num,
    name: row.name ?? '',
    phone: row.phone ?? '',
    address: row.address,
    status: row.status,
    rating: row.rating ?? 0,
    note: row.note,
    tagIds: (row.call_log_tags ?? []).map((t: any) => t.tag_id),
    createdAt: row.created_at,
  };
}

export function dbToTask(row: any): Task {
  return {
    id: row.id,
    userId: row.user_id,
    leadId: row.lead_id,
    title: row.title,
    dueDate: row.due_date,
    completed: row.completed,
    createdAt: row.created_at,
  };
}

export function dbToProfile(row: any): Profile {
  return {
    id: row.id,
    email: row.email,
    callerName: row.caller_name,
    userCode: row.user_code,
    role: row.role,
    dailyGoal: row.daily_goal,
    monthlyGoal: row.monthly_goal,
    createdAt: row.created_at,
  };
}

export function dbToDailyStat(row: any): DailyStat {
  return {
    userId: row.user_id,
    statDate: row.stat_date,
    calls: row.calls,
    conversations: row.conversations,
    voicemail: row.voicemail,
    dead: row.dead,
  };
}

export function dbToSessionLogEntry(row: any): SessionLogEntry {
  return {
    userId: row.user_id,
    sessionDate: row.session_date,
    durationSeconds: row.duration_seconds,
    callsMade: row.calls_made,
  };
}
