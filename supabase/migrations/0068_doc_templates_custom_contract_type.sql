-- Allows a contract template with no fixed deal-type category — the Blue
-- Docs "+ Add Contract" button under the open-ended "Other Contracts"
-- section, for contracts that don't fit cash/novation/subject_to/seller_finance.
-- contract_type is still checked against those four values whenever it IS
-- set; it's just no longer required for every contract row.
alter table public.doc_templates
  drop constraint doc_templates_contract_type_required;
