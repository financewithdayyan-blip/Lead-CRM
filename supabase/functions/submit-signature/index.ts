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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

interface ContractField {
  id: string;
  page: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  type: 'text' | 'signature' | 'date' | 'full_name' | 'currency' | 'paragraph';
  role: 'buyer' | 'seller';
  label: string;
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

/** Small stateful cursor for the appended certificate page(s) — starts a new
 * page automatically once the current one runs out of room. */
class CertWriter {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  width: number;
  height: number;
  margin = 56;
  page: PDFPage;
  y: number;

  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont, width: number, height: number) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.width = width;
    this.height = height;
    this.page = doc.addPage([width, height]);
    this.y = height - this.margin;
  }

  private ensureRoom(lineHeight: number) {
    if (this.y - lineHeight < this.margin) {
      this.page = this.doc.addPage([this.width, this.height]);
      this.y = this.height - this.margin;
    }
  }

  heading(text: string) {
    this.ensureRoom(24);
    this.page.drawText(text, { x: this.margin, y: this.y, size: 16, font: this.bold, color: rgb(0.05, 0.05, 0.05) });
    this.y -= 26;
  }

  subheading(text: string) {
    this.ensureRoom(18);
    this.page.drawText(text, { x: this.margin, y: this.y, size: 12, font: this.bold, color: rgb(0.05, 0.05, 0.05) });
    this.y -= 18;
  }

  line(text: string, opts: { size?: number; color?: [number, number, number] } = {}) {
    const size = opts.size ?? 10;
    const [r, g, b] = opts.color ?? [0.2, 0.2, 0.2];
    const maxWidth = this.width - this.margin * 2;
    for (const wrapped of wrapText(text, this.font, size, maxWidth)) {
      this.ensureRoom(size * 1.4);
      this.page.drawText(wrapped, { x: this.margin, y: this.y, size, font: this.font, color: rgb(r, g, b) });
      this.y -= size * 1.4;
    }
  }

  gap(px = 10) {
    this.y -= px;
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

    const { data: allParties, error: partiesErr } = await admin
      .from('contract_signing_parties')
      .select('*')
      .eq('contract_instance_id', party.contract_instance_id)
      .order('sign_order', { ascending: true });
    if (partiesErr) throw partiesErr;

    const blockedBy = (allParties ?? []).find((p) => p.sign_order < party.sign_order && p.status !== 'signed');
    if (blockedBy) return json({ error: `Waiting on ${blockedBy.name} to sign first` }, 409);

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

    if (!allSigned) return json({ ok: true, allSigned: false });

    // ── Every party has signed — flatten the final PDF. ──────────────────────
    const { data: instance, error: instErr } = await admin
      .from('contract_instances')
      .select('*, doc_templates(storage_path, fields, type, name)')
      .eq('id', party.contract_instance_id)
      .single();
    if (instErr) throw instErr;

    const template = (instance as any).doc_templates as { storage_path: string; fields: ContractField[]; type: string; name: string };
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

    const [firstPage] = pages;
    const { width: certW, height: certH } = firstPage ? firstPage.getSize() : { width: 612, height: 792 };
    const cert = new CertWriter(pdfDoc, font, boldFont, certW, certH);

    const docKind = template.type === 'loi' ? 'Letter of Intent' : 'Contract';
    cert.heading('Signing Certificate');
    cert.line(`Document: ${instance.name} (${docKind})`);
    cert.line(`Completed: ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`);
    cert.gap(14);

    cert.subheading('Parties');
    for (const p of updatedParties) {
      const roleWord =
        p.role === 'other' ? 'Additional Signer' : template.type === 'loi' && p.role === 'buyer' ? 'Us' : p.role === 'buyer' ? 'Buyer' : 'Seller';
      cert.line(`${roleWord}: ${p.name}${p.email ? ` <${p.email}>` : ''}`, { size: 10.5, color: [0.05, 0.05, 0.05] });
      const event = (auditEvents ?? []).find((e) => e.party_id === p.id && e.event_type === 'signed');
      if (p.signed_at) {
        cert.line(`  Completed: ${new Date(p.signed_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`);
      }
      if (event?.ip_address) cert.line(`  IP address: ${event.ip_address}`);
      if (event?.user_agent) cert.line(`  Device: ${event.user_agent}`);
      cert.line(`  Signature: ${p.signature_data_url ? 'Signed' : 'No signature required for this role'}`);
      cert.gap(8);
    }

    const fieldsWithValues = (template.fields ?? []).filter((f) => f.type !== 'signature' && fieldValues[f.id]);
    if (fieldsWithValues.length > 0) {
      cert.gap(6);
      cert.subheading('Fields Filled');
      for (const f of fieldsWithValues) {
        cert.line(`${f.label}: ${fieldValues[f.id]}`, { size: 10, color: [0.15, 0.15, 0.15] });
      }
    }

    const finalBytes = await pdfDoc.save();
    const finalPath = `contracts/${instance.id}/signed-${Date.now()}.pdf`;
    const { error: uploadErr } = await admin.storage.from('blue-docs').upload(finalPath, finalBytes, { contentType: 'application/pdf' });
    if (uploadErr) throw uploadErr;

    const { error: finalizeErr } = await admin
      .from('contract_instances')
      .update({ status: 'signed', final_storage_path: finalPath, completed_at: new Date().toISOString() })
      .eq('id', instance.id);
    if (finalizeErr) throw finalizeErr;

    return json({ ok: true, allSigned: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unexpected error' }, 500);
  }
});
