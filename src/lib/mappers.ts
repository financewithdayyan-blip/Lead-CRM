import type { Lead, LeadActivity, LeadFile, Profile, Tag, Task } from '@/types/domain';

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
    city: row.city,
    state: row.state,
    zip: row.zip,
    source: row.source,
    stage: row.stage,
    rating: row.rating ?? 0,
    propType: row.prop_type,
    beds: row.beds,
    baths: row.baths,
    sqft: row.sqft,
    lotSize: row.lot_size,
    yearBuilt: row.year_built,
    condition: row.condition,
    motivation: row.motivation,
    arv: row.arv,
    asIs: row.as_is,
    estRepairs: row.est_repairs,
    minOffer: row.min_offer,
    maxOffer: row.max_offer,
    askingPrice: row.asking_price,
    finalPrice: row.final_price,
    repairs: row.repairs ?? {},
    notes: row.notes,
    nextFollowUp: row.next_follow_up,
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
    files: row.lead_files?.map(dbToLeadFile),
  };
}

export function leadToDbInsert(lead: Partial<Lead>, userId: string) {
  return {
    user_id: userId,
    lead_num: lead.leadNum ?? null,
    first_name: lead.firstName ?? '',
    last_name: lead.lastName ?? '',
    phone: lead.phone ?? '',
    phone2: lead.phone2 ?? null,
    email: lead.email ?? null,
    address: lead.address ?? null,
    city: lead.city ?? null,
    state: lead.state ?? null,
    zip: lead.zip ?? null,
    source: lead.source ?? null,
    stage: lead.stage ?? 'new',
    rating: lead.rating ?? 0,
    prop_type: lead.propType ?? null,
    beds: lead.beds ?? null,
    baths: lead.baths ?? null,
    sqft: lead.sqft ?? null,
    lot_size: lead.lotSize ?? null,
    year_built: lead.yearBuilt ?? null,
    condition: lead.condition ?? null,
    motivation: lead.motivation ?? null,
    arv: lead.arv ?? null,
    as_is: lead.asIs ?? null,
    est_repairs: lead.estRepairs ?? null,
    min_offer: lead.minOffer ?? null,
    max_offer: lead.maxOffer ?? null,
    asking_price: lead.askingPrice ?? null,
    final_price: lead.finalPrice ?? null,
    repairs: lead.repairs ?? {},
    notes: lead.notes ?? null,
    next_follow_up: lead.nextFollowUp ?? null,
  };
}

const LEAD_UPDATE_FIELDS: Array<[keyof Lead, string]> = [
  ['leadNum', 'lead_num'],
  ['firstName', 'first_name'],
  ['lastName', 'last_name'],
  ['phone', 'phone'],
  ['phone2', 'phone2'],
  ['email', 'email'],
  ['address', 'address'],
  ['city', 'city'],
  ['state', 'state'],
  ['zip', 'zip'],
  ['source', 'source'],
  ['stage', 'stage'],
  ['rating', 'rating'],
  ['propType', 'prop_type'],
  ['beds', 'beds'],
  ['baths', 'baths'],
  ['sqft', 'sqft'],
  ['lotSize', 'lot_size'],
  ['yearBuilt', 'year_built'],
  ['condition', 'condition'],
  ['motivation', 'motivation'],
  ['arv', 'arv'],
  ['asIs', 'as_is'],
  ['estRepairs', 'est_repairs'],
  ['minOffer', 'min_offer'],
  ['maxOffer', 'max_offer'],
  ['askingPrice', 'asking_price'],
  ['finalPrice', 'final_price'],
  ['repairs', 'repairs'],
  ['notes', 'notes'],
  ['nextFollowUp', 'next_follow_up'],
];

export function leadToDbUpdate(lead: Partial<Lead>) {
  const payload: Record<string, unknown> = {};
  for (const [key, column] of LEAD_UPDATE_FIELDS) {
    if (key in lead) payload[column] = lead[key];
  }
  return payload;
}

export function dbToLeadFile(row: any): LeadFile {
  return {
    id: row.id,
    leadId: row.lead_id,
    userId: row.user_id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    fileType: row.file_type,
    createdAt: row.created_at,
  };
}

export function dbToActivity(row: any): LeadActivity {
  return {
    id: row.id,
    leadId: row.lead_id,
    userId: row.user_id,
    type: row.type,
    body: row.body,
    meta: row.meta ?? {},
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
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    userCode: row.user_code,
    role: row.role,
    dailyGoal: row.daily_goal,
    monthlyGoal: row.monthly_goal,
    createdAt: row.created_at,
  };
}
