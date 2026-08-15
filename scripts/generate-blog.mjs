// Runs before `vite build` (see package.json) and turns every published
// blog_posts row into real static HTML under public/, which Vite then
// copies into dist/ like any other public/*.html page. This is what makes
// blog posts genuinely crawlable and social-share-unfurlable — a
// client-rendered React page would ship empty initial HTML instead.
//
// Uses the service-role key directly against blog_posts rather than a
// public RPC: this script runs server-side only (the Vercel build
// environment), the same trust boundary as any other service-role client,
// and the table's RLS (admin-only) is bypassed by design here, same as it
// would be for a public RPC — except this way nothing new is ever exposed
// to `anon`/`authenticated`.
import { createClient } from '@supabase/supabase-js';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderLayout, renderTagChips, formatDate, slugify, escapeHtml, injectHeadingIds, SITE_URL, DEFAULT_OG_IMAGE } from './blog-template.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const BLOG_DIR = path.join(PUBLIC_DIR, 'blog');
const TAG_DIR = path.join(BLOG_DIR, 'tag');

// Not a secret — the same project ref is already hardcoded in this repo's
// own migrations (0066, 0077) for identical server-side-only calls.
const SUPABASE_URL = 'https://ggfpvrdxqopippzqkojr.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const STATIC_PAGES = [
  { loc: '/', priority: '1.0' },
  { loc: '/about-us', priority: '0.8' },
  { loc: '/contact-us', priority: '0.8' },
  { loc: '/solutions', priority: '0.8' },
  { loc: '/privacy-policy', priority: '0.5' },
  { loc: '/terms-of-service', priority: '0.5' },
  { loc: '/communications-consent', priority: '0.5' },
  { loc: '/do-not-sell', priority: '0.5' },
];

/** Every post's "Frequently Asked Questions" section (when it has one) is
 * already a real h3 heading followed by h4/p question-answer pairs — this
 * just reads that same structure back out as FAQPage structured data, so
 * Google can show the questions directly in search results (a real ranking
 * and click-through advantage) without any per-post manual work. Returns
 * null for a post with no FAQ section rather than emitting empty/invalid
 * schema. */
function extractFaqSchema(bodyHtml) {
  const section = String(bodyHtml ?? '').match(/<h3>\s*Frequently Asked Questions\s*<\/h3>([\s\S]*?)(?=<h3>|$)/i);
  if (!section) return null;
  const pairs = [...section[1].matchAll(/<h4>([\s\S]*?)<\/h4>\s*<p>([\s\S]*?)<\/p>/g)]
    .map(([, q, a]) => ({
      question: q.replace(/<[^>]*>/g, '').trim(),
      answer: a.replace(/<[^>]*>/g, '').trim(),
    }))
    .filter((qa) => qa.question && qa.answer);
  if (!pairs.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map((qa) => ({
      '@type': 'Question',
      name: qa.question,
      acceptedAnswer: { '@type': 'Answer', text: qa.answer },
    })),
  };
}

function stripHtml(html, maxLen = 155) {
  const plain = String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > maxLen ? plain.slice(0, maxLen - 1).trimEnd() + '…' : plain;
}

async function main() {
  if (!SERVICE_ROLE_KEY) {
    if (process.env.SKIP_BLOG_GENERATION === 'true') {
      console.warn('[generate-blog] SUPABASE_SERVICE_ROLE_KEY not set — SKIP_BLOG_GENERATION=true, skipping blog generation.');
      return;
    }
    console.error(
      '[generate-blog] SUPABASE_SERVICE_ROLE_KEY is not set. Set it in this environment, or set ' +
        'SKIP_BLOG_GENERATION=true to intentionally build without blog pages (e.g. local dev without the key).',
    );
    process.exit(1);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: posts, error } = await admin
    .from('blog_posts')
    .select('*')
    .eq('status', 'published')
    .order('published_at', { ascending: false });
  if (error) {
    console.error('[generate-blog] Failed to fetch published posts:', error.message);
    process.exit(1);
  }

  await mkdir(BLOG_DIR, { recursive: true });
  await mkdir(TAG_DIR, { recursive: true });

  const coverUrl = (coverImagePath) =>
    coverImagePath ? admin.storage.from('blog-images').getPublicUrl(coverImagePath).data.publicUrl : null;

  const tagMap = new Map(); // tag -> posts[]
  for (const post of posts) {
    for (const tag of post.tags ?? []) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag).push(post);
    }
  }

  // ── Per-post pages ─────────────────────────────────────────────────────
  for (const post of posts) {
    const description = post.seo_description || post.excerpt || stripHtml(post.body_html);
    const image = coverUrl(post.cover_image_path) || DEFAULT_OG_IMAGE;
    const canonical = `${SITE_URL}/blog/${post.slug}`;

    const { html: articleHtml, headings } = injectHeadingIds(post.body_html, post.title);
    const related = relatedPosts(post, posts);

    const bodyHtml = `
<div class="post-hero">
  <div class="post-hero-inner">
    ${post.tags?.length ? `<div class="blog-card-tags">${renderTagChips(post.tags)}</div>` : ''}
    <h1>${escapeHtml(post.title)}</h1>
    <div class="post-hero-meta">${formatDate(post.published_at)}</div>
  </div>
</div>
${
  post.cover_image_path
    ? `<div class="post-cover"><img src="${image}" alt="${escapeHtml(post.title)}"></div>`
    : ''
}
<div class="post-layout">
  <div class="post-main">
    <article class="post-article">${articleHtml || ''}</article>
    <div class="post-footer">
      <a class="post-back-link" href="/blog">&larr; Back to all posts</a>
    </div>
  </div>
  ${sidebar(headings)}
</div>
${relatedSection(related, coverUrl)}
`;

    const jsonLd = [
      {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description,
        image,
        datePublished: post.published_at,
        dateModified: post.updated_at,
        author: { '@type': 'Organization', name: 'Bluebird Acquisition' },
        publisher: {
          '@type': 'Organization',
          name: 'Bluebird Acquisition',
          logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo-mark.svg` },
        },
        mainEntityOfPage: canonical,
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/blog` },
          { '@type': 'ListItem', position: 3, name: post.title, item: canonical },
        ],
      },
    ];
    const faqSchema = extractFaqSchema(post.body_html);
    if (faqSchema) jsonLd.push(faqSchema);

    const html = renderLayout({
      title: post.seo_title || post.title,
      description,
      canonical,
      ogImage: image,
      ogType: 'article',
      jsonLd,
      bodyHtml,
    });

    await writeFile(path.join(BLOG_DIR, `${post.slug}.html`), html);
  }

  // ── Listing page ────────────────────────────────────────────────────────
  // Most recent post leads as a large featured card, the next two sit beside
  // it as compact rows, and everything older fills a "More Articles" grid —
  // rather than every post (including the brand-new one) looking identical
  // in one undifferentiated grid.
  const [featured, ...restAfterFeatured] = posts;
  const secondary = restAfterFeatured.slice(0, 2);
  const rest = restAfterFeatured.slice(2);

  await writeFile(path.join(BLOG_DIR, 'index.html'), renderLayout({
    title: 'Blog | Bluebird Acquisition',
    description: 'Guidance on selling a distressed property fast, for cash, without repairs or agent fees.',
    canonical: `${SITE_URL}/blog`,
    bodyHtml: `
<div class="blog-hero">
  <div class="blog-hero-inner">
    <span class="blog-eyebrow">Bluebird Acquisition Blog</span>
    <h1>Straight answers for sellers under pressure.</h1>
    <p>Foreclosure, tax liens, inherited property, code violations — real guidance on selling fast, for cash, without the usual headaches.</p>
  </div>
</div>
<div class="section">
  <div class="section-inner">
    ${
      featured
        ? `<div class="blog-featured${secondary.length ? '' : ' single'}">
      ${featuredCard(featured, coverUrl)}
      ${secondary.length ? `<div class="blog-featured-side">${secondary.map((p) => secondaryCard(p, coverUrl)).join('')}</div>` : ''}
    </div>
    <div class="blog-cta-band">
      <div class="blog-cta-band-text">
        <h3>Thinking about selling?</h3>
        <p>Get a no-obligation cash offer — no repairs, no agent fees, close on your timeline.</p>
      </div>
      <a class="btn-cta" href="/contact-us">
        Get My Cash Offer
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </a>
    </div>
    ${
      rest.length
        ? `<h2 class="blog-section-heading">More Articles</h2><div class="blog-grid">${rest.map((p) => blogCard(p, coverUrl)).join('')}</div>`
        : ''
    }`
        : `<div class="blog-empty">New posts are on the way — check back soon.</div>`
    }
  </div>
</div>
`,
  }));

  // ── Tag archive pages ───────────────────────────────────────────────────
  for (const [tag, tagPosts] of tagMap) {
    const tagSlug = slugify(tag);
    await writeFile(path.join(TAG_DIR, `${tagSlug}.html`), renderLayout({
      title: `${tag} — Blog | Bluebird Acquisition`,
      description: `Posts tagged "${tag}" from the Bluebird Acquisition blog.`,
      canonical: `${SITE_URL}/blog/tag/${tagSlug}`,
      bodyHtml: `
<div class="blog-hero">
  <div class="blog-hero-inner">
    <span class="blog-eyebrow">Tagged</span>
    <h1>${escapeHtml(tag)}</h1>
  </div>
</div>
<div class="section">
  <div class="section-inner">
    <div class="blog-grid">${tagPosts.map((p) => blogCard(p, coverUrl)).join('')}</div>
  </div>
</div>
`,
    }));
  }

  // ── Prune orphaned files (unpublished/renamed posts, removed tags) ─────
  await pruneOrphans(BLOG_DIR, new Set(posts.map((p) => `${p.slug}.html`)), ['index.html']);
  await pruneOrphans(TAG_DIR, new Set([...tagMap.keys()].map((t) => `${slugify(t)}.html`)));

  // ── sitemap.xml — fully regenerated every build, single source of truth ─
  await writeSitemap(posts, [...tagMap.keys()]);

  console.log(`[generate-blog] Generated ${posts.length} post page(s) and ${tagMap.size} tag page(s).`);
}

/** "In This Article" jump links + the cash-offer CTA — every post gets
 * this sidebar, TOC only populated when the post actually has h2/h3
 * sections (an LOI or very short post might not). */
function sidebar(headings) {
  const toc = headings.length
    ? `<div class="sidebar-card toc-card">
  <div class="sidebar-card-title">In This Article</div>
  <nav class="toc-list">
    ${headings.map((h) => `<a class="toc-link toc-level-${h.level}" href="#${h.id}">${escapeHtml(h.text)}</a>`).join('\n    ')}
  </nav>
</div>`
    : '';
  return `<aside class="post-sidebar">
  ${toc}
  <div class="sidebar-card cta-card">
    <div class="cta-card-title">Need to sell fast?</div>
    <p>Get a no-obligation cash offer from Bluebird Acquisition — no repairs, no agent fees, close on your timeline.</p>
    <a class="btn-cta" href="/contact-us">
      Get My Cash Offer
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </a>
  </div>
</aside>`;
}

/** Prefers other posts sharing a tag (closest in subject matter), falls
 * back to whatever's most recent so a post with a one-off tag still gets a
 * full row instead of an empty/half-empty carousel. */
function relatedPosts(post, allPosts, count = 4) {
  const tagSet = new Set(post.tags ?? []);
  return allPosts
    .filter((p) => p.id !== post.id)
    .map((p) => ({ p, score: (p.tags ?? []).filter((t) => tagSet.has(t)).length }))
    .sort((a, b) => b.score - a.score || new Date(b.p.published_at) - new Date(a.p.published_at))
    .slice(0, count)
    .map((s) => s.p);
}

function relatedSection(related, coverUrl) {
  if (!related.length) return '';
  return `
<div class="related-section">
  <div class="related-header">
    <h2 class="related-heading">Related Articles</h2>
    <div class="related-nav">
      <button type="button" data-dir="prev" aria-label="Scroll left"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
      <button type="button" data-dir="next" aria-label="Scroll right"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
    </div>
  </div>
  <div class="related-track">${related.map((p) => blogCard(p, coverUrl)).join('')}</div>
</div>
<script>
(function(){
  var track = document.querySelector('.related-track');
  var prev = document.querySelector('.related-nav [data-dir="prev"]');
  var next = document.querySelector('.related-nav [data-dir="next"]');
  if (!track || !prev || !next) return;
  function move(dir) {
    var card = track.querySelector('.blog-card');
    var amount = card ? card.getBoundingClientRect().width + 20 : 280;
    track.scrollBy({ left: dir * amount * 2, behavior: 'smooth' });
  }
  prev.addEventListener('click', function () { move(-1); });
  next.addEventListener('click', function () { move(1); });
})();
</script>`;
}

/** The listing page's lead story — larger image, longer excerpt, an explicit
 * "Read article" link. Category is just the post's first tag, since these
 * posts don't have a separate category field. */
function featuredCard(post, coverUrl) {
  const image = coverUrl(post.cover_image_path);
  const description = post.excerpt || stripHtml(post.body_html, 200);
  const category = post.tags?.[0];
  return `<a class="featured-main" href="/blog/${post.slug}">
  ${image ? `<img class="featured-main-thumb" src="${image}" alt="">` : ''}
  <div class="featured-main-body">
    <div class="featured-meta">
      ${category ? `<span class="tag-chip">${escapeHtml(category)}</span>` : ''}
      <span class="blog-card-date">${formatDate(post.published_at)}</span>
    </div>
    <h2>${escapeHtml(post.title)}</h2>
    <p>${escapeHtml(description)}</p>
    <span class="featured-read-link">Read article
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </span>
  </div>
</a>`;
}

/** A compact row next to the featured story — thumbnail + category/date + title only, no excerpt. */
function secondaryCard(post, coverUrl) {
  const image = coverUrl(post.cover_image_path);
  const category = post.tags?.[0];
  return `<a class="featured-side-card" href="/blog/${post.slug}">
  ${image ? `<img class="featured-side-thumb" src="${image}" alt="">` : ''}
  <div class="featured-side-body">
    <div class="featured-meta">
      ${category ? `<span class="tag-chip">${escapeHtml(category)}</span>` : ''}
      <span class="blog-card-date">${formatDate(post.published_at)}</span>
    </div>
    <h3>${escapeHtml(post.title)}</h3>
  </div>
</a>`;
}

function blogCard(post, coverUrl) {
  const image = coverUrl(post.cover_image_path);
  const description = post.excerpt || stripHtml(post.body_html, 140);
  return `<a class="blog-card" href="/blog/${post.slug}">
  ${image ? `<img class="blog-card-thumb" src="${image}" alt="">` : ''}
  <div class="blog-card-body">
    <div class="blog-card-date">${formatDate(post.published_at)}</div>
    <h2>${escapeHtml(post.title)}</h2>
    <p>${escapeHtml(description)}</p>
    ${post.tags?.length ? `<div class="blog-card-tags">${renderTagChips(post.tags, { linked: false })}</div>` : ''}
  </div>
</a>`;
}

async function pruneOrphans(dir, keepFilenames, alwaysKeep = []) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return; // directory doesn't exist yet — nothing to prune
  }
  for (const entry of entries) {
    if (!entry.endsWith('.html')) continue;
    if (alwaysKeep.includes(entry) || keepFilenames.has(entry)) continue;
    await rm(path.join(dir, entry));
    console.log(`[generate-blog] Pruned stale page: ${path.relative(ROOT, path.join(dir, entry))}`);
  }
}

async function writeSitemap(posts, tags) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    ...STATIC_PAGES.map((p) => ({ loc: `${SITE_URL}${p.loc}`, lastmod: today, priority: p.priority })),
    { loc: `${SITE_URL}/blog`, lastmod: today, priority: '0.7' },
    ...posts.map((p) => ({
      loc: `${SITE_URL}/blog/${p.slug}`,
      lastmod: (p.updated_at || p.published_at || today).slice(0, 10),
      priority: '0.6',
    })),
    ...tags.map((t) => ({ loc: `${SITE_URL}/blog/tag/${slugify(t)}`, lastmod: today, priority: '0.4' })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <priority>${u.priority}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>
`;
  await writeFile(path.join(PUBLIC_DIR, 'sitemap.xml'), xml);
}

main().catch((e) => {
  console.error('[generate-blog] Unexpected failure:', e);
  process.exit(1);
});
