import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { ContractField, PartyRole, PartyRoleDef } from './useDocTemplates';

export interface ContractParty {
  role: PartyRole;
  name: string;
  /** Required — Blue Docs delivers exclusively over SMS (see
   * create-contract-instance), and contract_signing_parties.email has never
   * once been populated in production. */
  phone: string;
  signOrder: number;
}

export interface ContractInstance {
  id: string;
  templateId: string | null;
  templateName: string | null;
  templateType: 'loi' | 'contract' | null;
  templateStoragePath: string | null;
  templateFields: ContractField[];
  templatePartyRoles: PartyRoleDef[];
  leadId: string | null;
  leadName: string | null;
  name: string;
  fieldValues: Record<string, string>;
  status: 'draft' | 'sent' | 'partial' | 'signed' | 'voided' | 'declined' | 'expired';
  finalStoragePath: string | null;
  createdAt: string;
  completedAt: string | null;
  voidedAt: string | null;
  voidedReason: string | null;
  parties: Array<{
    id: string;
    role: PartyRole;
    name: string;
    status: 'pending' | 'signed' | 'declined';
    accessToken: string;
    signOrder: number;
    signatureDataUrl: string | null;
    signedAt: string | null;
    declinedReason: string | null;
  }>;
}

function fromRow(r: any): ContractInstance {
  return {
    id: r.id,
    templateId: r.template_id,
    templateName: r.doc_templates?.name ?? null,
    templateType: r.doc_templates?.type ?? null,
    // Read from this contract's own snapshot, taken when it was sent — not
    // the live doc_templates row, which may have been edited since. See
    // migration 0090 for why: editing a template in place used to silently
    // change what an in-flight or already-signed contract showed/stamped.
    templateStoragePath: r.template_storage_path_snapshot ?? null,
    templateFields: r.template_fields_snapshot ?? [],
    templatePartyRoles: r.template_party_roles_snapshot ?? [],
    leadId: r.lead_id,
    leadName: r.leads ? `${r.leads.first_name ?? ''} ${r.leads.last_name ?? ''}`.trim() : null,
    name: r.name,
    fieldValues: r.field_values ?? {},
    status: r.status,
    finalStoragePath: r.final_storage_path,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    voidedAt: r.voided_at,
    voidedReason: r.voided_reason,
    parties: (r.contract_signing_parties ?? []).map((p: any) => ({
      id: p.id,
      role: p.role,
      name: p.name,
      status: p.status,
      accessToken: p.access_token,
      signOrder: p.sign_order,
      signatureDataUrl: p.signature_data_url,
      signedAt: p.signed_at,
      declinedReason: p.declined_reason,
    })),
  };
}

// Only name/type come from the live doc_templates join now — everything
// else about the template (fields, party_roles, storage path) is read from
// this contract's own snapshot columns instead. See migration 0090.
const INSTANCE_SELECT = '*, doc_templates(name, type), leads(first_name, last_name), contract_signing_parties(*)';

export function useContractInstances() {
  return useQuery({
    queryKey: ['contract_instances'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contract_instances')
        .select(INSTANCE_SELECT)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(fromRow);
    },
  });
}

/** Creates the contract + its parties and sends the first signer's SMS
 * invite, all in one server-side request — see create-contract-instance.
 * Moved off the client (which used to do two separate table inserts here)
 * so there's no window where the DB rows exist but the invite was never
 * attempted because the admin's tab closed in between. */
export function useGenerateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      templateId: string;
      leadId?: string;
      name: string;
      fieldValues: Record<string, string>;
      parties: ContractParty[];
    }) => {
      const { data, error } = await supabase.functions.invoke('create-contract-instance', {
        body: {
          templateId: input.templateId,
          leadId: input.leadId,
          name: input.name,
          fieldValues: input.fieldValues,
          parties: input.parties.map((p) => ({ role: p.role, name: p.name, phone: p.phone, signOrder: p.signOrder })),
        },
      });
      if (error) {
        const errBody = await error.context?.json?.().catch(() => null);
        throw new Error(errBody?.error || error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as {
        instanceId: string;
        parties: Array<{ role: PartyRole; name: string; access_token: string; sign_order: number }>;
      };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contract_instances'] }),
  });
}

export function useDeleteContractInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('contract_instances').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contract_instances'] }),
  });
}

/** Cancels an in-progress envelope without deleting its history — unlike
 * delete, the contract instance and its parties/audit trail stay on record,
 * just no longer signable. Admins already have full RLS on
 * contract_instances (contract_instances_all), so this is a plain update,
 * no RPC/edge function needed; what actually makes voiding effective is the
 * status guard in get_signing_party/submit-signature/signing-pdf-url
 * (0089/0090), which reject a voided instance's tokens. */
export function useVoidContractInstance() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const { error } = await supabase
        .from('contract_instances')
        .update({ status: 'voided', voided_at: new Date().toISOString(), voided_by: profile?.id ?? null, voided_reason: reason ?? null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contract_instances'] }),
  });
}

// ── Public signing side ─────────────────────────────────────────────────────

export interface SigningPartyInfo {
  role: PartyRole;
  name: string;
  status: 'pending' | 'signed';
  signOrder: number;
  isTurn: boolean;
  waitingOn: string | null;
  /** Set only once the whole contract is no longer actionable — voided by
   * the sender or declined by an earlier party. The signer's page shows a
   * dedicated message instead of the normal signing flow when this is set. */
  blocked: 'voided' | 'declined' | null;
  /** Whether this party has already agreed to sign electronically —
   * SignContractPage shows the consent screen instead of the normal signing
   * UI until this is true. */
  hasConsented: boolean;
  contractName: string;
  fieldValues: Record<string, string>;
  contractStatus: 'partial' | 'signed';
  templateStoragePath: string;
  templateFields: ContractField[];
  templatePartyRoles: PartyRoleDef[];
  templateType: 'loi' | 'contract';
  otherSignatures: Array<{ role: PartyRole; signatureDataUrl: string }>;
}

export function usePublicSigningParty(token: string | undefined) {
  return useQuery({
    queryKey: ['signing_party', token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_signing_party', { p_token: token });
      if (error) throw error;
      if (!data) return null;
      const d = data as any;
      return {
        role: d.role,
        name: d.name,
        status: d.status,
        signOrder: d.signOrder,
        isTurn: d.isTurn,
        waitingOn: d.waitingOn,
        blocked: d.blocked ?? null,
        hasConsented: !!d.hasConsented,
        contractName: d.contractName,
        fieldValues: d.fieldValues ?? {},
        contractStatus: d.contractStatus,
        templateStoragePath: d.templateStoragePath,
        templateFields: d.templateFields ?? [],
        templatePartyRoles: d.templatePartyRoles ?? [],
        templateType: d.templateType ?? 'contract',
        otherSignatures: d.otherSignatures ?? [],
      } as SigningPartyInfo;
    },
    enabled: !!token,
    retry: false,
    // Polled while waiting for the other party, so "their turn" flips
    // without the signer having to refresh manually.
    refetchInterval: (query) => (query.state.data && !query.state.data.isTurn ? 8000 : false),
  });
}

export function useDeclineSignature() {
  return useMutation({
    mutationFn: async ({ token, reason }: { token: string; reason?: string }) => {
      const { data, error } = await supabase.functions.invoke('decline-signature', { body: { token, reason } });
      if (error) {
        const errBody = await error.context?.json?.().catch(() => null);
        throw new Error(errBody?.error || error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { ok: true };
    },
  });
}

export function useSubmitSignature() {
  return useMutation({
    mutationFn: async ({
      token,
      signatureDataUrl,
      fieldValues,
    }: {
      token: string;
      /** Omitted entirely when this party's role has no signature field
       * mapped — they still have to formally complete their turn, just
       * without drawing/typing anything. */
      signatureDataUrl?: string;
      fieldValues?: Record<string, string>;
    }) => {
      const { data, error } = await supabase.functions.invoke('submit-signature', {
        body: { token, signatureDataUrl, fieldValues },
      });
      if (error) {
        const errBody = await error.context?.json?.().catch(() => null);
        throw new Error(errBody?.error || error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { ok: true; allSigned: boolean };
    },
  });
}

export function useSigningPdfUrl() {
  return useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await supabase.functions.invoke('signing-pdf-url', { body: { token } });
      if (error) {
        const errBody = await error.context?.json?.().catch(() => null);
        throw new Error(errBody?.error || error.message);
      }
      return (data as { url: string }).url;
    },
  });
}

/** The flattened, fully-executed PDF with the signing certificate appended
 * — only resolves once the contract is actually fully signed. */
export function useSignedFinalDocUrl() {
  return useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await supabase.functions.invoke('signing-pdf-url', { body: { token, final: true } });
      if (error) {
        const errBody = await error.context?.json?.().catch(() => null);
        throw new Error(errBody?.error || error.message);
      }
      return (data as { url: string }).url;
    },
  });
}

/** Fire-and-forget — a failed view log shouldn't block the signer from
 * seeing their document, so this deliberately never throws into the UI. */
export function useLogSigningView() {
  return useMutation({
    mutationFn: async (token: string) => {
      await supabase.functions.invoke('log-signing-view', { body: { token } }).catch(() => {});
    },
  });
}

/** Unlike view-logging, a failed consent record has to block moving into
 * the signing UI — submit-signature independently refuses to accept a
 * signature with no matching event on record. */
export function useRecordConsent() {
  return useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await supabase.functions.invoke('record-consent', { body: { token } });
      if (error) {
        const errBody = await error.context?.json?.().catch(() => null);
        throw new Error(errBody?.error || error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
    },
  });
}

// ── Admin-side audit trail ──────────────────────────────────────────────────

export interface ContractAuditEvent {
  id: string;
  partyId: string | null;
  eventType: 'viewed' | 'signed';
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export function useContractAuditEvents(instanceId: string | undefined) {
  return useQuery({
    queryKey: ['contract_audit_events', instanceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contract_audit_events')
        .select('id, party_id, event_type, ip_address, user_agent, created_at')
        .eq('contract_instance_id', instanceId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data.map(
        (r): ContractAuditEvent => ({
          id: r.id,
          partyId: r.party_id,
          eventType: r.event_type,
          ipAddress: r.ip_address,
          userAgent: r.user_agent,
          createdAt: r.created_at,
        }),
      );
    },
    enabled: !!instanceId,
  });
}
