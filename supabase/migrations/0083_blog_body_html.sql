-- The admin editor moved from a Markdown textarea to a Tiptap toolbar editor
-- that outputs semantic HTML directly (h2-h4, p, strong, em, u, ul/ol/li) —
-- body_markdown never actually held Markdown in production (blog_posts is
-- still empty), so this is a plain rename, not a data migration.
alter table public.blog_posts rename column body_markdown to body_html;
