// Edge Function: submit-signature
//
// Public/unauthenticated, same posture as sms-webhook — the access_token
// embedded in the signer's own URL is the credential, not a login. Records
// one party's completion (a drawn/typed signature if their role actually has
// a signature field mapped, or just a plain confirmation if not — a party
// with nothing assigned to sign still has to formally complete their turn so
// the next party unlocks and the contract can finish). Once every party is
// done, stamps every mapped field onto the template PDF with pdf-lib,
// appends a signing-certificate page (who signed what, when, from where),
// and stores the flattened result as the contract's final executed document.
// Pinned rather than the floating @2 tag — esm.sh's "latest" resolution
// briefly served a 2.112.1 build with a broken denonext auth-js subpath,
// which failed every fresh bundle regardless of this function's own code.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'https://esm.sh/pdf-lib@1.17.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ZOOM_ACCOUNT_ID = Deno.env.get('ZOOM_ACCOUNT_ID')!;
const ZOOM_CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID')!;
const ZOOM_CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET')!;
// Blue Docs always sends from 217-408-2781, which is also NUMBERS['2'] in
// the outreach pool (send-sms/bulk-sms-dispatcher), not a separate
// dedicated line — reuses those same secrets rather than duplicating them.
// See create-contract-instance's own comment on this and sms-webhook's
// updated guard, which accounts for the number being shared.
const BLUEDOCS_NUMBER = {
  phone: Deno.env.get('ZOOM_FROM_NUMBER_2') ?? '',
  email: Deno.env.get('ZOOM_USER_EMAIL_2') ?? '',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

const FETCH_TIMEOUT_MS = 15_000;
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting on ${label}`)), FETCH_TIMEOUT_MS)),
  ]);
}

// ── Zoom sending (duplicated from send-sms/create-contract-instance, not
// shared — this codebase's own established convention). A failure anywhere
// in here must never fail the signer's own successful signature — every
// call site below wraps this in try/catch and only logs. ──────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let cachedZoomToken: { token: string; expiresAt: number } | null = null;

async function zoomFetch(url: string, options: RequestInit, maxRetries = 4): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), ...options });
    if (res.status !== 429 || attempt >= maxRetries) return res;
    const retryAfterSec = Number(res.headers.get('Retry-After'));
    const backoffMs = (Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 500 * 2 ** attempt) + Math.random() * 250;
    await res.body?.cancel().catch(() => {});
    await sleep(backoffMs);
  }
}

async function zoomToken(): Promise<string> {
  if (cachedZoomToken && Date.now() < cachedZoomToken.expiresAt) return cachedZoomToken.token;
  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);
  const res = await zoomFetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID)}`,
    { method: 'POST', headers: { Authorization: `Basic ${basic}` } },
  );
  if (!res.ok) throw new Error(`Zoom auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  cachedZoomToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000 };
  return cachedZoomToken.token;
}

async function zoomUserId(email: string, token: string): Promise<string> {
  const res = await zoomFetch(`https://api.zoom.us/v2/users/${encodeURIComponent(email)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Zoom user lookup failed for ${email} (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.id as string;
}

async function sendZoomSms(fromPhone: string, toPhone: string, message: string, token: string) {
  const res = await zoomFetch('https://api.zoom.us/v2/phone/sms/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: { phone_number: fromPhone }, to_members: [{ phone_number: toPhone }], message }),
  });
  if (!res.ok) throw new Error(`Zoom send failed (${res.status}): ${await res.text()}`);
  return res.json().catch(() => ({}));
}

/** Fetches a fresh token + resolves the Blue Docs sender's Zoom user id, then
 * sends. One helper since every call site here needs the same two steps
 * first — a signature submission only ever sends at most one SMS itself. */
async function sendBlueDocsSms(toPhone: string, message: string) {
  const token = await withTimeout(zoomToken(), 'Zoom auth');
  await withTimeout(zoomUserId(BLUEDOCS_NUMBER.email, token), 'Zoom user lookup');
  await withTimeout(sendZoomSms(BLUEDOCS_NUMBER.phone, toPhone, message, token), 'Zoom send');
}

const NEXT_SIGNER_MESSAGE = (docName: string, address: string, link: string) =>
  `Hey, it's your turn to sign the ${docName} contract for your property\n${address}\n${link}\nSign it and let's start moving with it\nThanks,\nDayyan`;
const COMPLETED_MESSAGE = (address: string, link: string) =>
  `Hey Congrats!\nOn signing the contract on your property at ${address}\nyou can download the signed contract. Just click the link below\n${link}\nThanks for signing,\nDayyan`;

interface ContractField {
  id: string;
  page: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  type: 'text' | 'signature' | 'date' | 'full_name' | 'currency' | 'paragraph';
  // 'buyer' | 'seller', or a template-defined extra role id (e.g. "extra_1").
  role: string;
  label: string;
}

interface PartyRoleDef {
  id: string;
  label: string;
}

function roleWordFor(role: string, docType: string, partyRoles: PartyRoleDef[]): string {
  if (role === 'other') return 'Additional Signer';
  if (role === 'buyer') return docType === 'loi' ? 'Us' : 'Buyer';
  if (role === 'seller') return 'Seller';
  return partyRoles.find((r) => r.id === role)?.label ?? 'Additional Signer';
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Greedy word-wrap against the font's actual measured width — a clause is
 * whatever length the seller/buyer typed, so this is what turns that into
 * lines that actually fit inside the mapped box on the real PDF page. */
function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

// Brand palette (normalized from the same hex values used on the marketing
// site/CRM — see scripts/blog-template.mjs's :root tokens) so the appended
// certificate reads as part of the same product, not a generic pdf-lib dump.
const BRAND: [number, number, number] = [0.1176, 0.5608, 0.8353]; // #1E8FD5
const INK: [number, number, number] = [0.0431, 0.1176, 0.2]; // #0B1E33
const SLATE: [number, number, number] = [0.3412, 0.4, 0.4784]; // #57667A
const SLATE_DIM: [number, number, number] = [0.5255, 0.5765, 0.6314]; // #8693A1
const SUCCESS: [number, number, number] = [0.0627, 0.5255, 0.4157]; // #10866A
const RULE: [number, number, number] = [0.87, 0.87, 0.87];

function formatWhen(iso: string): string {
  // Fixed to UTC regardless of the edge runtime's own locale/timezone, so a
  // legal audit trail never has an ambiguous "whose clock is this" question.
  return `${new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' })} UTC`;
}

/** Stateful cursor for the appended certificate page(s) — starts a new page
 * automatically once the current one runs out of room, stamps a brand bar
 * on every page as it's created, and stamps page-number footers on every
 * page in one final pass once the total page count is actually known. */
class CertWriter {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  width: number;
  height: number;
  margin = 54;
  page: PDFPage;
  y: number;
  pages: PDFPage[] = [];

  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont, width: number, height: number) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.width = width;
    this.height = height;
    this.page = this.newPage();
  }

  private newPage(): PDFPage {
    const page = this.doc.addPage([this.width, this.height]);
    page.drawRectangle({ x: 0, y: this.height - 5, width: this.width, height: 5, color: rgb(...BRAND) });
    this.pages.push(page);
    this.y = this.height - this.margin - 12;
    return page;
  }

  private ensureRoom(lineHeight: number) {
    // Reserves a footer zone below `margin` so page-number/title stamps
    // (drawn in the finalize() pass, after content is already placed) never
    // collide with real content.
    if (this.y - lineHeight < this.margin) {
      this.page = this.newPage();
    }
  }

  heading(text: string) {
    this.ensureRoom(26);
    this.page.drawText(text, { x: this.margin, y: this.y, size: 18, font: this.bold, color: rgb(...INK) });
    this.y -= 28;
  }

  /** Small uppercase-ish section label, e.g. "DOCUMENT OVERVIEW". */
  eyebrow(text: string) {
    this.ensureRoom(20);
    this.page.drawText(text.toUpperCase(), { x: this.margin, y: this.y, size: 9, font: this.bold, color: rgb(...BRAND) });
    this.y -= 16;
  }

  divider() {
    this.ensureRoom(10);
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.width - this.margin, y: this.y },
      thickness: 0.75,
      color: rgb(...RULE),
    });
    this.y -= 14;
  }

  line(text: string, opts: { size?: number; color?: [number, number, number]; bold?: boolean } = {}) {
    const size = opts.size ?? 10;
    const [r, g, b] = opts.color ?? SLATE;
    const font = opts.bold ? this.bold : this.font;
    const maxWidth = this.width - this.margin * 2;
    for (const wrapped of wrapText(text, font, size, maxWidth)) {
      this.ensureRoom(size * 1.4);
      this.page.drawText(wrapped, { x: this.margin, y: this.y, size, font, color: rgb(r, g, b) });
      this.y -= size * 1.4;
    }
  }

  /** A bold label immediately followed by its value on the same baseline —
   * the closest a single-column writer gets to a real table row without
   * building full grid/border layout logic. Falls back to wrapping the
   * value on its own indented line(s) if it won't fit next to the label. */
  keyValue(label: string, value: string, opts: { size?: number } = {}) {
    const size = opts.size ?? 9.5;
    const labelText = `${label}:`;
    const labelWidth = this.bold.widthOfTextAtSize(labelText, size);
    const valueMaxWidth = this.width - this.margin * 2 - labelWidth - 6;
    const wrapped = wrapText(value || '—', this.font, size, valueMaxWidth);

    this.ensureRoom(size * 1.5);
    this.page.drawText(labelText, { x: this.margin, y: this.y, size, font: this.bold, color: rgb(...SLATE) });
    this.page.drawText(wrapped[0] ?? '', { x: this.margin + labelWidth + 6, y: this.y, size, font: this.font, color: rgb(...INK) });
    this.y -= size * 1.5;
    for (const extra of wrapped.slice(1)) {
      this.ensureRoom(size * 1.5);
      this.page.drawText(extra, { x: this.margin + labelWidth + 6, y: this.y, size, font: this.font, color: rgb(...INK) });
      this.y -= size * 1.5;
    }
  }

  gap(px = 10) {
    this.y -= px;
  }

  /** Stamps "Page N of TOTAL" + a title footer on every page written so
   * far — only callable once, after all real content is placed, since the
   * total page count isn't known until then. */
  finalize(footerTitle: string) {
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      const footerY = this.margin - 20;
      page.drawLine({ start: { x: this.margin, y: footerY + 12 }, end: { x: this.width - this.margin, y: footerY + 12 }, thickness: 0.5, color: rgb(...RULE) });
      page.drawText(footerTitle, { x: this.margin, y: footerY, size: 7.5, font: this.font, color: rgb(...SLATE_DIM) });
      const pageLabel = `Page ${i + 1} of ${total}`;
      const w = this.font.widthOfTextAtSize(pageLabel, 7.5);
      page.drawText(pageLabel, { x: this.width - this.margin - w, y: footerY, size: 7.5, font: this.font, color: rgb(...SLATE_DIM) });
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const { token, signatureDataUrl, fieldValues: submittedFieldValues } = await req.json();
    if (!token) return json({ error: 'Missing token' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: party, error: partyErr } = await admin
      .from('contract_signing_parties')
      .select('*')
      .eq('access_token', token)
      .maybeSingle();
    if (partyErr) throw partyErr;
    if (!party) return json({ error: 'Signing link not found' }, 404);
    if (party.status === 'signed') return json({ error: 'This has already been signed' }, 409);

    const { data: instanceStatus, error: instanceStatusErr } = await admin
      .from('contract_instances')
      .select('status')
      .eq('id', party.contract_instance_id)
      .single();
    if (instanceStatusErr) throw instanceStatusErr;
    if (['voided', 'declined'].includes(instanceStatus.status)) {
      return json({ error: 'This document is no longer available for signing' }, 409);
    }

    const { data: allParties, error: partiesErr } = await admin
      .from('contract_signing_parties')
      .select('*')
      .eq('contract_instance_id', party.contract_instance_id)
      .order('sign_order', { ascending: true });
    if (partiesErr) throw partiesErr;

    const blockedBy = (allParties ?? []).find((p) => p.sign_order < party.sign_order && p.status !== 'signed');
    if (blockedBy) return json({ error: `Waiting on ${blockedBy.name} to sign first` }, 409);

    // The consent screen in SignContractPage already gates this client-side,
    // but the server shouldn't trust that it was actually shown — same
    // reasoning this table's own RLS comment gives for never taking a
    // client-reported audit event at face value.
    const { count: consentCount } = await admin
      .from('contract_audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('party_id', party.id)
      .eq('event_type', 'consented');
    if (!consentCount) return json({ error: 'You need to consent to sign electronically first.' }, 409);

    const signedAt = new Date().toISOString();
    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const userAgent = req.headers.get('user-agent');

    const { error: updateErr } = await admin
      .from('contract_signing_parties')
      .update({ status: 'signed', signature_data_url: signatureDataUrl ?? null, signed_at: signedAt })
      .eq('id', party.id);
    if (updateErr) throw updateErr;

    await admin.from('contract_audit_events').insert({
      contract_instance_id: party.contract_instance_id,
      party_id: party.id,
      event_type: 'signed',
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    // Whatever this party typed into their own fields (name, amount, etc.)
    // merges into the shared field_values — the next party (and the final
    // flattened PDF) reads this same column, so it has to land before either.
    if (submittedFieldValues && typeof submittedFieldValues === 'object' && Object.keys(submittedFieldValues).length > 0) {
      const { data: currentInstance } = await admin
        .from('contract_instances')
        .select('field_values')
        .eq('id', party.contract_instance_id)
        .single();
      const merged = { ...(currentInstance?.field_values ?? {}), ...submittedFieldValues };
      await admin.from('contract_instances').update({ field_values: merged }).eq('id', party.contract_instance_id);
    }

    const updatedParties = (allParties ?? []).map((p) =>
      p.id === party.id ? { ...p, status: 'signed', signature_data_url: signatureDataUrl ?? null, signed_at: signedAt } : p,
    );
    const allSigned = updatedParties.every((p) => p.status === 'signed');

    if (!allSigned) {
      // Whoever's now lowest sign_order among the still-pending parties just
      // got unlocked by this signature — notify them. Wrapped so a Zoom
      // hiccup here never fails the signer's own already-recorded signature.
      const nextParty = updatedParties.filter((p) => p.status !== 'signed').sort((a, b) => a.sign_order - b.sign_order)[0];
      if (nextParty?.phone) {
        try {
          const { data: nameRow } = await admin
            .from('contract_instances')
            .select('name, property_address')
            .eq('id', party.contract_instance_id)
            .single();
          const link = `https://www.bluebirdacquisition.com/crm/sign/${nextParty.access_token}`;
          await sendBlueDocsSms(
            nextParty.phone,
            NEXT_SIGNER_MESSAGE(nameRow?.name ?? 'a document', nameRow?.property_address ?? '', link),
          );
          await admin.from('contract_audit_events').insert({
            contract_instance_id: party.contract_instance_id,
            party_id: nextParty.id,
            event_type: 'sent',
          });
        } catch (smsErr) {
          console.error('Blue Docs next-signer SMS failed:', smsErr);
        }
      }
      return json({ ok: true, allSigned: false });
    }

    // ── Every party has signed — flatten the final PDF. ──────────────────────
    // Reads the field layout/file path off the contract instance's own
    // snapshot columns (taken when it was sent), not a live join to
    // doc_templates — a template edited after this contract was sent must
    // never change what gets stamped onto an already-in-flight document.
    // doc_templates is still joined for type/name, which aren't versioned.
    const { data: instance, error: instErr } = await admin
      .from('contract_instances')
      .select('*, doc_templates(type, name)')
      .eq('id', party.contract_instance_id)
      .single();
    if (instErr) throw instErr;

    const template = {
      storage_path: instance.template_storage_path_snapshot as string,
      fields: (instance.template_fields_snapshot ?? []) as ContractField[],
      type: (instance as any).doc_templates?.type as string,
      name: (instance as any).doc_templates?.name as string,
      party_roles: (instance.template_party_roles_snapshot ?? []) as PartyRoleDef[],
    };
    const partyRoles = template.party_roles ?? [];
    const fieldValues = (instance.field_values ?? {}) as Record<string, string>;

    const { data: pdfBlob, error: dlErr } = await admin.storage.from('blue-docs').download(template.storage_path);
    if (dlErr) throw dlErr;
    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());

    const pdfDoc = await PDFDocument.load(pdfBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pages = pdfDoc.getPages();

    const partyByRole = new Map(updatedParties.map((p) => [p.role, p]));

    for (const field of template.fields ?? []) {
      const page = pages[field.page - 1];
      if (!page) continue;
      const { width: pageW, height: pageH } = page.getSize();
      const x = (field.xPct / 100) * pageW;
      const boxW = (field.wPct / 100) * pageW;
      const boxH = (field.hPct / 100) * pageH;
      const y = pageH * (1 - (field.yPct + field.hPct) / 100);

      if (field.type === 'text' || field.type === 'full_name' || field.type === 'currency' || field.type === 'date') {
        // By generation time these are already resolved into plain display
        // strings (a combined name, a formatted "$410,000", or whatever date
        // the signer actually typed) — stamped identically either way.
        const value = fieldValues[field.id] ?? '';
        if (!value) continue;
        const fontSize = Math.max(8, Math.min(14, boxH * 0.6));
        page.drawText(value, { x: x + 2, y: y + boxH * 0.25, size: fontSize, font, color: rgb(0.05, 0.05, 0.05) });
      } else if (field.type === 'paragraph') {
        const value = fieldValues[field.id] ?? '';
        if (!value) continue;
        const fontSize = 9;
        const lineHeight = fontSize * 1.25;
        const maxLines = Math.max(1, Math.floor(boxH / lineHeight));
        const lines = wrapText(value, font, fontSize, boxW - 4).slice(0, maxLines);
        let lineY = y + boxH - fontSize;
        for (const line of lines) {
          page.drawText(line, { x: x + 2, y: lineY, size: fontSize, font, color: rgb(0.05, 0.05, 0.05) });
          lineY -= lineHeight;
        }
      } else if (field.type === 'signature') {
        const p = partyByRole.get(field.role);
        if (!p?.signature_data_url) continue;
        try {
          const imgBytes = dataUrlToBytes(p.signature_data_url);
          const img = p.signature_data_url.includes('image/jpeg') ? await pdfDoc.embedJpg(imgBytes) : await pdfDoc.embedPng(imgBytes);
          page.drawImage(img, { x, y, width: boxW, height: boxH });
        } catch {
          // A malformed signature image shouldn't fail the whole document —
          // the field simply stays blank on the final PDF.
        }
      }
    }

    // ── Append the signing certificate / audit trail page(s). ────────────────
    const { data: auditEvents } = await admin
      .from('contract_audit_events')
      .select('party_id, event_type, ip_address, user_agent, created_at')
      .eq('contract_instance_id', instance.id)
      .order('created_at', { ascending: true });

    const EVENT_LABELS: Record<string, string> = {
      sent: 'Invitation Sent',
      viewed: 'Document Viewed',
      consented: 'Consented to Electronic Signature',
      signed: 'Signature Completed',
      declined: 'Declined to Sign',
      reminder_sent: 'Reminder Sent',
      voided: 'Envelope Voided',
      expired: 'Signing Link Expired',
    };

    const partyLabelById = new Map(
      updatedParties.map((p) => [p.id, `${roleWordFor(p.role, template.type, partyRoles)} — ${p.name}`]),
    );
    // The signed event is the closest thing to a per-field timestamp/IP that
    // actually exists (see the Fields Completed section below) — there is no
    // finer-grained "this exact field was typed at this exact second" capture
    // anywhere in the system, so every field a party filled is honestly
    // attributed to the moment and location they actually pressed Sign.
    const signedEventByParty = new Map<string, { ip: string | null; ua: string | null; at: string }>();
    for (const e of auditEvents ?? []) {
      if (e.event_type === 'signed' && e.party_id) {
        signedEventByParty.set(e.party_id, { ip: e.ip_address, ua: e.user_agent, at: e.created_at });
      }
    }

    const [firstPage] = pages;
    const { width: certW, height: certH } = firstPage ? firstPage.getSize() : { width: 612, height: 792 };
    const cert = new CertWriter(pdfDoc, font, boldFont, certW, certH);

    const docKind = template.type === 'loi' ? 'Letter of Intent' : 'Contract';

    cert.heading('Certificate of Completion');
    cert.line('Bluebird Acquisition — Electronic Signature Audit Trail', { size: 9.5 });
    cert.gap(14);
    cert.divider();

    cert.eyebrow('Document Overview');
    cert.keyValue('Document', `${instance.name} (${docKind})`);
    cert.keyValue('Certificate ID', instance.id);
    cert.keyValue('Status', 'Completed — all required parties have signed');
    cert.keyValue('Completed', formatWhen(new Date().toISOString()));
    if (instance.property_address) cert.keyValue('Property', instance.property_address);
    // Only the starting template's hash can be printed here without being
    // circular — the final document's own hash necessarily depends on bytes
    // that include this very certificate page, so it's computed after
    // save() below and stored on the contract instance instead (viewable in
    // the admin preview), not printed on the page it would be hashing.
    if (instance.template_pdf_sha256) cert.keyValue('Starting Document Hash (SHA-256)', instance.template_pdf_sha256, { size: 7.5 });
    cert.gap(10);
    cert.divider();

    cert.eyebrow('Signers');
    for (const p of updatedParties) {
      const roleWord = roleWordFor(p.role, template.type, partyRoles);
      cert.keyValue(roleWord, `${p.name}${p.phone ? ` · ${p.phone}` : ''}`);
      cert.line(p.signature_data_url ? 'Signed electronically' : 'No signature required for this role', {
        size: 9,
        color: p.signature_data_url ? SUCCESS : SLATE_DIM,
      });
      cert.gap(6);
    }
    cert.gap(4);
    cert.divider();

    cert.eyebrow('Complete Event Timeline');
    if (!auditEvents?.length) {
      cert.line('No audit events were recorded for this envelope.', { size: 9 });
    }
    for (const evt of auditEvents ?? []) {
      const who = evt.party_id ? (partyLabelById.get(evt.party_id) ?? 'Unknown party') : 'System';
      const label = EVENT_LABELS[evt.event_type] ?? evt.event_type;
      cert.line(who, { size: 9.5, color: INK, bold: true });
      cert.line(`${label} — ${formatWhen(evt.created_at)}`, { size: 9 });
      if (evt.ip_address) cert.line(`IP Address: ${evt.ip_address}`, { size: 8, color: SLATE_DIM });
      if (evt.user_agent) cert.line(`Device: ${evt.user_agent}`, { size: 8, color: SLATE_DIM });
      cert.gap(7);
    }
    cert.gap(4);
    cert.divider();

    const fieldsWithValues = (template.fields ?? []).filter((f) => f.type !== 'signature' && fieldValues[f.id]);
    if (fieldsWithValues.length > 0) {
      cert.eyebrow('Fields Completed');
      const fieldsByRole = new Map<string, ContractField[]>();
      for (const f of fieldsWithValues) {
        if (!fieldsByRole.has(f.role)) fieldsByRole.set(f.role, []);
        fieldsByRole.get(f.role)!.push(f);
      }
      for (const [role, fields] of fieldsByRole) {
        const p = partyByRole.get(role);
        const roleWord = roleWordFor(role, template.type, partyRoles);
        cert.line(`${roleWord}${p ? ` — ${p.name}` : ''}`, { size: 9.5, color: INK, bold: true });
        const signedEvent = p ? signedEventByParty.get(p.id) : undefined;
        if (signedEvent) {
          cert.line(`Recorded at time of signing — ${formatWhen(signedEvent.at)}`, { size: 8, color: SLATE_DIM });
          if (signedEvent.ip) cert.line(`IP Address: ${signedEvent.ip}`, { size: 8, color: SLATE_DIM });
        }
        cert.gap(3);
        for (const f of fields) {
          cert.keyValue(f.label, fieldValues[f.id], { size: 9 });
        }
        cert.gap(8);
      }
    }

    cert.finalize('Bluebird Acquisition — Certificate of Completion');

    const finalBytes = await pdfDoc.save();
    const finalPath = `contracts/${instance.id}/signed-${Date.now()}.pdf`;
    const { error: uploadErr } = await admin.storage.from('blue-docs').upload(finalPath, finalBytes, { contentType: 'application/pdf' });
    if (uploadErr) throw uploadErr;

    const finalHashBuffer = await crypto.subtle.digest('SHA-256', finalBytes);
    const finalSha256 = Array.from(new Uint8Array(finalHashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const { error: finalizeErr } = await admin
      .from('contract_instances')
      .update({ status: 'signed', final_storage_path: finalPath, completed_at: new Date().toISOString(), final_pdf_sha256: finalSha256 })
      .eq('id', instance.id);
    if (finalizeErr) throw finalizeErr;

    // Notify everyone it's done, each with their own link back to their
    // signing page — that page shows the download button once it sees the
    // contract's now-'signed' status (see SignContractPage's fullyDone).
    // Downloading only ever happens from there, not automatically in-browser
    // right when someone finishes signing. Each send is wrapped individually
    // so one party's Zoom hiccup doesn't cost every other party their text.
    for (const p of updatedParties) {
      if (!p.phone) continue;
      try {
        const partyLink = `https://www.bluebirdacquisition.com/crm/sign/${p.access_token}`;
        await sendBlueDocsSms(p.phone, COMPLETED_MESSAGE(instance.property_address ?? 'the property', partyLink));
      } catch (smsErr) {
        console.error(`Blue Docs completion SMS failed for party ${p.id}:`, smsErr);
      }
    }

    return json({ ok: true, allSigned: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
