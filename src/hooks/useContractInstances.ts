import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { ContractField, ContractFieldRole } from './useDocTemplates';

export interface ContractParty {
  role: ContractFieldRole;
  name: string;
  email: string;
  signOrder: number;
}

export interface ContractInstance {
  id: string;
  templateId: string | null;
  templateName: string | null;
  templateStoragePath: string | null;
  templateFields: ContractField[];
  leadId: string | null;
  leadName: string | null;
  name: string;
  fieldValues: Record<string, string>;
  status: 'partial' | 'signed';
  finalStoragePath: string | null;
  createdAt: string;
  completedAt: string | null;
  parties: Array<{
    id: string;
    role: ContractFieldRole;
    name: string;
    status: 'pending' | 'signed';
    accessToken: string;
    signOrder: number;
    signatureDataUrl: string | null;
    signedAt: string | null;
  }>;
}

function fromRow(r: any): ContractInstance {
  return {
    id: r.id,
    templateId: r.template_id,
    templateName: r.doc_templates?.name ?? null,
    templateStoragePath: r.doc_templates?.storage_path ?? null,
    templateFields: r.doc_templates?.fields ?? [],
    leadId: r.lead_id,
    leadName: r.leads ? `${r.leads.first_name ?? ''} ${r.leads.last_name ?? ''}`.trim() : null,
    name: r.name,
    fieldValues: r.field_values ?? {},
    status: r.status,
    finalStoragePath: r.final_storage_path,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    parties: (r.contract_signing_parties ?? []).map((p: any) => ({
      id: p.id,
      role: p.role,
      name: p.name,
      status: p.status,
      accessToken: p.access_token,
      signOrder: p.sign_order,
      signatureDataUrl: p.signature_data_url,
      signedAt: p.signed_at,
    })),
  };
}

const INSTANCE_SELECT = '*, doc_templates(name, storage_path, fields), leads(first_name, last_name), contract_signing_parties(*)';

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

export function useGenerateContract() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      templateId: string;
      leadId?: string;
      name: string;
      fieldValues: Record<string, string>;
      parties: ContractParty[];
    }) => {
      const { data: instance, error } = await supabase
        .from('contract_instances')
        .insert({
          template_id: input.templateId,
          lead_id: input.leadId ?? null,
          name: input.name,
          field_values: input.fieldValues,
          created_by: session!.user.id,
        })
        .select('id')
        .single();
      if (error) throw error;

      const { data: parties, error: partiesErr } = await supabase
        .from('contract_signing_parties')
        .insert(
          input.parties.map((p) => ({
            contract_instance_id: instance.id,
            role: p.role,
            name: p.name,
            email: p.email || null,
            sign_order: p.signOrder,
          })),
        )
        .select('role, access_token');
      if (partiesErr) throw partiesErr;

      return {
        instanceId: instance.id as string,
        parties: parties as Array<{ role: ContractFieldRole; access_token: string }>,
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

// ── Public signing side ─────────────────────────────────────────────────────

export interface SigningPartyInfo {
  role: ContractFieldRole;
  name: string;
  status: 'pending' | 'signed';
  signOrder: number;
  isTurn: boolean;
  waitingOn: string | null;
  contractName: string;
  fieldValues: Record<string, string>;
  contractStatus: 'partial' | 'signed';
  templateStoragePath: string;
  templateFields: ContractField[];
  otherSignatures: Array<{ role: ContractFieldRole; signatureDataUrl: string }>;
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
        contractName: d.contractName,
        fieldValues: d.fieldValues ?? {},
        contractStatus: d.contractStatus,
        templateStoragePath: d.templateStoragePath,
        templateFields: d.templateFields ?? [],
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

export function useSubmitSignature() {
  return useMutation({
    mutationFn: async ({
      token,
      signatureDataUrl,
      fieldValues,
    }: {
      token: string;
      signatureDataUrl: string;
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
      return data;
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

/** Fire-and-forget — a failed view log shouldn't block the signer from
 * seeing their document, so this deliberately never throws into the UI. */
export function useLogSigningView() {
  return useMutation({
    mutationFn: async (token: string) => {
      await supabase.functions.invoke('log-signing-view', { body: { token } }).catch(() => {});
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
