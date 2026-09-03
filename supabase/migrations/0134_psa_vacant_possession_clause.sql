-- Adds a vacant-possession sentence to Clause 5 ("Closing") of the Cash Deal
-- PSA template so every future contract guarantees the Property is delivered
-- vacant, free of occupants, with no post-closing possession retained by
-- Seller. The base template PDF was a flat, non-editable document (no docx
-- source) with zero spare room on page 1, so the new sentence forced a full
-- reflow: Clause 7's heading no longer fits on page 1 and relocates to the
-- top of page 2, cascading Clauses 8-15 down page 2 by ~18.4pt; everything
-- from Clause 15's body onward (already starting on page 3) shifts by a
-- negligible ~0.3pt. Verified by rendering the new PDF — still fits in the
-- same 3 pages, no overlaps or orphaned headings. Rebuilt from scratch in
-- Helvetica/Helvetica-Bold (rather than drawing over the original's
-- Arial/Arial-Bold, whose subsetted embedded fonts can't gain new glyphs and
-- whose old text would otherwise remain hidden-but-extractable underneath a
-- white-out rectangle) so the document is clean top to bottom.
--
-- The old v2 PDF is left in storage untouched (contracts/cash/1787927770476-
-- Contract-v2.pdf) as an instant rollback. Any contract_instances row already
-- created keeps its own frozen template_storage_path_snapshot/
-- template_fields_snapshot (see submit-signature), so this only affects
-- contracts generated after this migration runs.
update doc_templates
set
  storage_path = 'contracts/cash/1788393038000-Contract-v3.pdf',
  updated_at = now(),
  fields = (
    select jsonb_agg(
      case (elem ->> 'id')
        -- Governing State (page 2) and Special Provisions (page 2) sit on
        -- lines that shifted -18.4pt (= -2.323232 yPct) once Clause 7
        -- relocated onto page 2 ahead of them.
        when 'f3760950-c478-4586-8a7e-84a3b7b3605c' then jsonb_set(elem, '{yPct}', to_jsonb(70.78061420089107::numeric))
        when 'e049a020-d544-485e-94fc-815db5fd7215' then jsonb_set(elem, '{yPct}', to_jsonb(62.676767676767675::numeric))
        -- Every page-3 field (signature block) shifted a negligible -0.3pt
        -- (-0.037879 yPct) — applied for exactness, not visually meaningful.
        when '3b83cbd2-1ab1-4893-9be0-1df6427aed6c' then jsonb_set(elem, '{yPct}', to_jsonb(76.37503444572879::numeric))
        when 'd26cacd8-7a2f-48b8-b773-e3911bcaac02' then jsonb_set(elem, '{yPct}', to_jsonb(82.88286564104769::numeric))
        when 'b7ad40ae-f2bf-4389-b591-8c604c69349a' then jsonb_set(elem, '{yPct}', to_jsonb(76.59563889302773::numeric))
        when '46477128-8862-4a8c-aacf-c3cc3a300acb' then jsonb_set(elem, '{yPct}', to_jsonb(82.99316786469716::numeric))
        when '0163f8a2-87dd-4dbf-a535-85225b9dc9b7' then jsonb_set(elem, '{yPct}', to_jsonb(61.668163160493116::numeric))
        when 'e526a268-4f02-475c-8eed-779009b08987' then jsonb_set(elem, '{yPct}', to_jsonb(61.3372564895447::numeric))
        when '86774e1e-d911-47d0-bdea-0f9affeafe59' then jsonb_set(elem, '{yPct}', to_jsonb(87.96212121212122::numeric))
        else elem
      end
    )
    from jsonb_array_elements(fields) as elem
  )
where id = 'b7b8fc5c-dfc1-466d-b12f-ada853c9180c';
