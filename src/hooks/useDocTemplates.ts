import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export type ContractType = 'cash' | 'novation' | 'subject_to' | 'seller_finance';

/** Shared between the "Purchase Contracts" template card (the upload
 * type-picker) and envelope rows (the type badge), so the label for a given
 * deal type never drifts between the two. */
export const PURCHASE_CONTRACT_TYPES: Array<{ key: ContractType; label: string }> = [
  { key: 'cash', label: 'Cash Deal' },
  { key: 'novation', label: 'Novation' },
  { key: 'subject_to', label: 'Subject-To' },
  { key: 'seller_finance', label: 'Seller Finance' },
];
export type ContractFieldType = 'text' | 'signature' | 'date' | 'full_name' | 'currency' | 'paragraph';
// 'buyer' and 'seller' are the two built-in roles every template starts
// with. A template can define any number of extra roles at mapping time
// (id is arbitrary, e.g. "extra_1") — see DocTemplate.partyRoles. A signing
// PARTY can also be 'other' — an ad-hoc reviewer added at send time with no
// role defined on the template and no fields of their own.
export type ContractFieldRole = string;
export type PartyRole = string;

/** One extra signee role a template defines beyond buyer/seller, e.g.
 * { id: 'extra_1', label: 'Witness' }. Fields tagged with that id belong to
 * whoever fills that role when the contract is generated. */
export interface PartyRoleDef {
  id: string;
  label: string;
}

const BUILT_IN_ROLE_COLORS: Record<string, string> = { buyer: '#0ea5e9', seller: '#a78bfa' };
const EXTRA_ROLE_COLORS = ['#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];

/** Deterministic so the same role always gets the same color without having
 * to thread the full role list through every component that draws one. */
export function roleColor(role: string): string {
  if (BUILT_IN_ROLE_COLORS[role]) return BUILT_IN_ROLE_COLORS[role];
  let hash = 0;
  for (let i = 0; i < role.length; i++) hash = (hash * 31 + role.charCodeAt(i)) >>> 0;
  return EXTRA_ROLE_COLORS[hash % EXTRA_ROLE_COLORS.length];
}

export interface ContractField {
  id: string;
  page: number; // 1-indexed
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  type: ContractFieldType;
  role: ContractFieldRole;
  label: string;
}

export interface DocTemplate {
  id: string;
  type: 'loi' | 'contract';
  contractType: ContractType | null;
  name: string;
  body: string | null;
  storagePath: string | null;
  fileName: string | null;
  docxStoragePath: string | null;
  docxFileName: string | null;
  fields: ContractField[];
  /** Extra signee roles this template defines beyond buyer/seller. */
  partyRoles: PartyRoleDef[];
  mapped: boolean;
  createdAt: string;
}

function fromRow(r: any): DocTemplate {
  return {
    id: r.id,
    type: r.type,
    contractType: r.contract_type,
    name: r.name,
    body: r.body,
    storagePath: r.storage_path,
    fileName: r.file_name,
    docxStoragePath: r.docx_storage_path,
    docxFileName: r.docx_file_name,
    fields: r.fields ?? [],
    partyRoles: r.party_roles ?? [],
    mapped: r.mapped,
    createdAt: r.created_at,
  };
}

export function useDocTemplates(type?: 'loi' | 'contract') {
  return useQuery({
    queryKey: ['doc_templates', type ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('doc_templates').select('*').order('created_at', { ascending: false });
      if (type) q = q.eq('type', type);
      const { data, error } = await q;
      if (error) throw error;
      return data.map(fromRow);
    },
  });
}

/** The LOI template is a single row (type='loi') — upsert-by-id rather than
 * accumulating duplicates every save. */
export function useSaveLoiTemplate() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, body }: { id?: string; name: string; body: string }) => {
      if (id) {
        const { error } = await supabase.from('doc_templates').update({ name, body, updated_at: new Date().toISOString() }).eq('id', id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase
        .from('doc_templates')
        .insert({ type: 'loi', name, body, created_by: session!.user.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doc_templates'] }),
  });
}

/** Step 1 of the contract/LOI flow: upload the file(s), unmapped. A PDF is
 * required (it's the only thing the field-mapping editor and the signer's
 * view can render); a Word original can ride along purely for reference.
 * Same upload for both doc types — an LOI is mapped and signed exactly like
 * a contract, just with no contractType category underneath it. */
export function useUploadDocTemplate() {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      docType,
      contractType,
      pdfFile,
      docxFile,
    }: {
      docType: 'loi' | 'contract';
      contractType?: ContractType;
      pdfFile: File;
      docxFile?: File;
    }) => {
      const userId = session!.user.id;
      const folder = docType === 'contract' ? `contracts/${contractType ?? 'other'}` : 'loi';
      const path = `${folder}/${Date.now()}-${pdfFile.name}`;
      const { error: uploadError } = await supabase.storage.from('blue-docs').upload(path, pdfFile);
      if (uploadError) throw uploadError;

      let docxStoragePath: string | null = null;
      if (docxFile) {
        const docxPath = `${folder}/${Date.now()}-${docxFile.name}`;
        const { error: docxErr } = await supabase.storage.from('blue-docs').upload(docxPath, docxFile);
        if (docxErr) throw docxErr;
        docxStoragePath = docxPath;
      }

      const defaultName = pdfFile.name.replace(/\.pdf$/i, '');
      const { data, error } = await supabase
        .from('doc_templates')
        .insert({
          type: docType,
          contract_type: docType === 'contract' ? (contractType ?? null) : null,
          name: defaultName,
          storage_path: path,
          file_name: pdfFile.name,
          docx_storage_path: docxStoragePath,
          docx_file_name: docxFile?.name ?? null,
          created_by: userId,
          mapped: false,
        })
        .select('*')
        .single();
      if (error) throw error;
      return fromRow(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doc_templates'] }),
  });
}

/** Buyer/seller are the two built-in roles, but an LOI isn't a sale contract
 * — "buyer" there really means "us, the company sending it," so the UI shows
 * that instead. 'other' is an ad-hoc reviewer with no role on the template.
 * Anything else is looked up in the template's own partyRoles. */
export function roleLabel(role: PartyRole, docType: 'loi' | 'contract', partyRoles: PartyRoleDef[] = []): string {
  if (role === 'buyer') return docType === 'loi' ? 'Us' : 'Buyer';
  if (role === 'seller') return 'Seller';
  if (role === 'other') return 'Additional Signer';
  return partyRoles.find((r) => r.id === role)?.label ?? 'Additional Signer';
}

/** Step 2: the field-mapping editor's Save — names the template, its extra
 * signee roles, and the placed fields, and marks it mapped. */
export function useSaveContractMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      name,
      fields,
      partyRoles,
    }: {
      id: string;
      name: string;
      fields: ContractField[];
      partyRoles: PartyRoleDef[];
    }) => {
      const { error } = await supabase
        .from('doc_templates')
        .update({ name, fields, party_roles: partyRoles, mapped: true, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doc_templates'] }),
  });
}

export function useDeleteDocTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, storagePath, docxStoragePath }: { id: string; storagePath: string | null; docxStoragePath?: string | null }) => {
      const paths = [storagePath, docxStoragePath].filter((p): p is string => !!p);
      if (paths.length) await supabase.storage.from('blue-docs').remove(paths);
      const { error } = await supabase.from('doc_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doc_templates'] }),
  });
}

export function useSignedTemplateUrl() {
  return useMutation({
    mutationFn: async (storagePath: string) => {
      const { data, error } = await supabase.storage.from('blue-docs').createSignedUrl(storagePath, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}
