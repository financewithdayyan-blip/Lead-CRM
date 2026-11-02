-- The Rehab Cost Estimator's full set of inputs (home size, finish level,
-- kitchen scope, bathrooms, flooring sqft, windows, every systems checkbox,
-- contingency %) was pure component local state -- "Use as Est. Repairs"
-- saved the computed total and the itemized breakdown, but reopening the
-- lead reset the form to blank defaults with no way to tell what had
-- actually been scoped to produce the number already on file. One jsonb
-- column, written and read back verbatim by RehabCostEstimator.tsx.
alter table public.leads add column if not exists rehab_estimator_config jsonb;
