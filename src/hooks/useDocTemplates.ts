import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export type ContractType = 'cash' | 'novation' | 'subject_to' | 'seller_finance';
export type ContractFieldType = 'text' | 'signature' | 'date' | 'full_name' | 'currency' | 'paragraph';
// Fields can only ever be mapped to the two roles that actually fill in
// document data. A signing PARTY can additionally be 'other' — a signer with
// no fields of their own (e.g. a witness or a co-seller) — see PartyRole.
export type ContractFieldRole = 'buyer' | 'seller';
export type PartyRole = ContractFieldRole | 'other';

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

/** Buyer/seller are the stored roles everywhere, but an LOI isn't a sale
 * contract — "buyer" there really means "us, the company sending it," so
 * the UI shows that instead. A third+ signer (role 'other') has no fields of
 * their own, so there's nothing document-specific to label them by. */
export function roleLabel(role: PartyRole, docType: 'loi' | 'contract'): string {
  if (role === 'other') return 'Additional Signer';
  if (docType === 'loi' && role === 'buyer') return 'Us';
  return role === 'buyer' ? 'Buyer' : 'Seller';
}

/** Step 2: the field-mapping editor's Save — names the template and marks it mapped. */
export function useSaveContractMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, fields }: { id: string; name: string; fields: ContractField[] }) => {
      const { error } = await supabase
        .from('doc_templates')
        .update({ name, fields, mapped: true, updated_at: new Date().toISOString() })
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
