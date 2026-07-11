-- Web leads submitted from the public marketing website contact form.
-- Anon users can insert (public form); authenticated CRM users can read and mark as read.

CREATE TABLE IF NOT EXISTS web_leads (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz  NOT NULL DEFAULT now(),
  first_name       text         NOT NULL,
  last_name        text         NOT NULL,
  phone            text         NOT NULL,
  email            text,
  property_address text         NOT NULL,
  situation        text,
  timeline         text,
  notes            text,
  is_read          boolean      NOT NULL DEFAULT false
);

ALTER TABLE web_leads ENABLE ROW LEVEL SECURITY;

-- Public visitors can submit (insert-only, no read-back)
CREATE POLICY "web_anon_insert" ON web_leads
  FOR INSERT TO anon
  WITH CHECK (true);

-- Authenticated CRM users can read all web leads
CREATE POLICY "crm_authed_select" ON web_leads
  FOR SELECT TO authenticated
  USING (true);

-- Authenticated CRM users can mark as read
CREATE POLICY "crm_authed_update" ON web_leads
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
