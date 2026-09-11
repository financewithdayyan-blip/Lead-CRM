-- The v3 Cash Deal PSA rebuild (0134) retyped Clause 12 ("Special
-- Provisions") with a literal static "N/A" as its body instead of leaving
-- it blank for the real fillable field (specialProvisions, see
-- FillCashDealContractModal) to supply — so any real special-provisions
-- text typed in got drawn on top of/alongside a permanent "N/A" that
-- printed no matter what.
--
-- v4 is byte-for-byte identical to v3 on every other line (rebuilt from the
-- same extracted per-line positions/fonts, not retyped by hand) with only
-- that one static text object genuinely removed from the content stream —
-- verified with a raw text-layer extraction, not just a visual whiteout,
-- since a whiteout rectangle would leave the old "N/A" hidden-but-copyable
-- underneath (the exact failure mode 0134's own rebuild was meant to avoid
-- elsewhere in this same document). No field positions changed, so no
-- yPct adjustments needed this time.
--
-- Existing contract_instances keep their own frozen
-- template_storage_path_snapshot/template_fields_snapshot (see
-- submit-signature) and are untouched by this — including the one already
-- signed by a seller with the "N/A" artifact baked into what they signed.
-- Altering an already-signed document's underlying file after the fact
-- would break the point of the audit trail; this only fixes contracts
-- created from now on.
update doc_templates
set storage_path = 'contracts/cash/1789157613678-Contract-v4.pdf', updated_at = now()
where id = 'b7b8fc5c-dfc1-466d-b12f-ada853c9180c';
