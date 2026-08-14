// Shared layout for every generated blog page (post, listing, tag archive).
// One function so the header/nav/footer markup — already unified across
// every hand-authored public/*.html page — can't drift out of sync between
// three different page kinds; a future nav change is a one-line edit here
// instead of three.

export const SITE_URL = 'https://www.bluebirdacquisition.com';
export const DEFAULT_OG_IMAGE = `${SITE_URL}/logo-mark.svg`;

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Kebab-case slug, matching the DB's blog_posts_slug_format check constraint. */
export function slugify(str) {
  return String(str ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const HEADER_HTML = `<header class="site-header">
  <div class="header-inner">
    <a href="/" class="brand">
      <img src="/logo-mark.svg" alt="" class="brand-logo">
      Bluebird<span class="b-acq">&nbsp;Acquisition</span>
    </a>
    <nav class="nav-links">
      <a href="/about-us">About Us</a>
      <a href="/solutions">Solutions</a>
      <a href="/blog">Blog</a>
      <a href="/contact-us">Contact Us</a>
    </nav>
    <a href="tel:+12174082781" class="header-phone" aria-label="Call Bluebird Acquisition at (217) 408-2781">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.32 1.85.55 2.81.68A2 2 0 0 1 22 16.92z"/></svg>
      <span>(217) 408-2781</span>
    </a>
    <a href="/crm" class="header-login">Login</a>
    <a href="/contact-us" class="header-cta">
      <span>Get Your Cash Offer</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </a>
  </div>
</header>`;

const FOOTER_HTML = `<footer>
  <span>&copy; 2026 Bluebird Acquisition. All rights reserved.</span>
  <span class="footer-legal-links">
    <a href="/about-us">About Us</a>
    <span class="fl-dot">&middot;</span>
    <a href="/solutions">Solutions</a>
    <span class="fl-dot">&middot;</span>
    <a href="/blog">Blog</a>
    <span class="fl-dot">&middot;</span>
    <a href="/contact-us">Contact Us</a>
    <span class="fl-dot">&middot;</span>
    <a href="/privacy-policy">Privacy Policy</a>
    <span class="fl-dot">&middot;</span>
    <a href="/terms-of-service">Terms of Service</a>
    <span class="fl-dot">&middot;</span>
    <a href="/communications-consent">Communications Consent</a>
    <span class="fl-dot">&middot;</span>
    <a href="/do-not-sell">Do Not Sell My Info</a>
  </span>
</footer>`;

// Design tokens copied verbatim from public/about-us.html so every generated
// page matches the rest of the site exactly, plus new blog-specific rules
// (post prose, card grid, tag chips) with no existing page to copy from.
const BASE_STYLES = `
:root{
  --ink:#0B1E33; --ink-soft:#16314F;
  --sky:#1E8FD5; --sky-deep:#1568A8;
  --brass:#C9A24B; --brass-soft:#E4CD8C;
  --paper:#F6F3EC; --paper-dim:#EDE8DB; --paper-line:#DCD5C2;
  --slate:#57667A; --slate-dim:#8693A1; --white:#FFFFFF;
  --serif:'Fraunces',Georgia,serif;
  --sans:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --mono:'JetBrains Mono','SF Mono',Consolas,monospace;
  --container:1100px; --radius-md:14px;
  --shadow-card:0 1px 2px rgba(11,30,51,0.04),0 8px 24px -8px rgba(11,30,51,0.12);
}
*{margin:0;padding:0;box-sizing:border-box;}
html{scroll-behavior:smooth;}
body{font-family:var(--sans);background:var(--paper);color:var(--ink);-webkit-font-smoothing:antialiased;}
a{color:inherit;text-decoration:none;}
img{max-width:100%;display:block;}
button{font-family:inherit;cursor:pointer;border:none;background:none;}

.site-header{ background:var(--ink); padding:18px 32px; }
.header-inner{ display:flex; align-items:center; justify-content:space-between; gap:18px; flex-wrap:wrap; }
.brand{ display:flex; align-items:center; gap:10px; font-family:var(--serif); font-weight:700; font-size:18px; color:var(--white); }
.brand:hover{ opacity:0.88; }
.brand-logo{ height:26px; width:auto; }
.b-acq{ color:var(--sky); font-weight:500; }
.nav-links{ display:flex; align-items:center; gap:22px; font-size:14px; font-weight:600; }
.nav-links a{ position:relative; padding:4px 0; color:rgba(246,243,236,0.82); white-space:nowrap; transition:opacity 0.2s,color 0.2s; }
.nav-links a:hover{ color:var(--white); }
.header-phone{ display:inline-flex; align-items:center; gap:7px; font-size:13.5px; font-weight:700; color:var(--white); white-space:nowrap; transition:opacity 0.2s; }
.header-phone:hover{ opacity:0.82; }
.header-phone svg{ flex-shrink:0; opacity:0.75; }
.header-login{ font-size:13.5px; font-weight:600; color:rgba(246,243,236,0.82); transition:color 0.2s; white-space:nowrap; }
.header-login:hover{ color:var(--white); }
.header-cta{ display:inline-flex; align-items:center; gap:8px; background:var(--sky); color:var(--white); font-weight:700; font-size:13.5px; padding:10px 18px; border-radius:100px; transition:transform 0.2s,box-shadow 0.2s,background 0.2s; white-space:nowrap; }
.header-cta:hover{ transform:translateY(-2px); background:var(--sky-deep); box-shadow:0 8px 20px -6px rgba(21,104,168,0.5); }
@media (max-width:980px){ .nav-links{ display:none; } }
@media (max-width:640px){ .header-cta span{ display:none; } .header-phone span{ display:none; } }

.section{ padding:80px 32px; }
.section-inner{ max-width:var(--container); margin:0 auto; }

footer{ background:var(--ink); color:rgba(246,243,236,0.65); padding:36px 32px; text-align:center; font-size:13.5px; display:flex; flex-direction:column; align-items:center; gap:14px; }
.footer-legal-links{ display:flex; flex-wrap:wrap; justify-content:center; align-items:center; gap:6px 12px; }
.footer-legal-links a{ color:rgba(246,243,236,0.6); font-size:13px; transition:color 0.2s; }
.footer-legal-links a:hover{ color:var(--sky); }
.footer-legal-links .fl-dot{ opacity:0.35; }

/* BLOG — hero */
.blog-hero{ background:var(--ink); color:var(--white); padding:80px 32px 64px; text-align:center; position:relative; overflow:hidden; }
.blog-hero::before{ content:''; position:absolute; inset:0; background:radial-gradient(ellipse 60% 70% at 50% -10%,rgba(30,143,213,0.38),transparent 60%); pointer-events:none; }
.blog-hero-inner{ position:relative; max-width:720px; margin:0 auto; }
.blog-eyebrow{ font-family:var(--mono); font-size:11px; font-weight:600; letter-spacing:0.14em; text-transform:uppercase; color:var(--brass-soft); display:block; margin-bottom:18px; }
.blog-hero h1{ font-family:var(--serif); font-size:clamp(2rem,5vw,3rem); font-weight:700; line-height:1.1; margin-bottom:16px; }
.blog-hero p{ font-size:17px; line-height:1.6; color:rgba(246,243,236,0.75); max-width:56ch; margin:0 auto; }

/* BLOG — card grid (listing + tag archive) */
.blog-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:24px; margin-top:8px; }
.blog-card{ background:var(--white); border:1.5px solid var(--paper-line); border-radius:var(--radius-md); overflow:hidden; box-shadow:var(--shadow-card); display:flex; flex-direction:column; transition:transform 0.2s,box-shadow 0.2s; }
.blog-card:hover{ transform:translateY(-3px); box-shadow:0 4px 8px rgba(11,30,51,0.06),0 16px 32px -12px rgba(11,30,51,0.2); }
.blog-card-thumb{ aspect-ratio:16/9; width:100%; object-fit:cover; background:var(--paper-dim); }
.blog-card-body{ padding:22px 22px 24px; display:flex; flex-direction:column; gap:10px; flex:1; }
.blog-card-tags{ display:flex; flex-wrap:wrap; gap:6px; }
.blog-card h2, .blog-card h3{ font-family:var(--serif); font-size:1.15rem; font-weight:700; color:var(--ink); line-height:1.3; }
.blog-card p{ font-size:14px; line-height:1.6; color:var(--slate); flex:1; }
.blog-card-date{ font-family:var(--mono); font-size:11px; letter-spacing:0.06em; text-transform:uppercase; color:var(--slate-dim); }
.blog-empty{ text-align:center; padding:40px 20px; color:var(--slate-dim); font-size:15px; }

.tag-chip{ display:inline-block; font-family:var(--mono); font-size:10.5px; font-weight:600; letter-spacing:0.04em; color:var(--sky-deep); background:rgba(30,143,213,0.1); padding:4px 10px; border-radius:100px; }
a.tag-chip:hover{ background:rgba(30,143,213,0.18); }

/* BLOG — single post */
.post-hero{ background:var(--ink); color:var(--white); padding:64px 32px 56px; }
.post-hero-inner{ max-width:760px; margin:0 auto; }
.post-hero .blog-card-tags{ margin-bottom:18px; }
.post-hero h1{ font-family:var(--serif); font-size:clamp(1.9rem,4.5vw,2.7rem); font-weight:700; line-height:1.15; margin-bottom:16px; }
.post-hero-meta{ font-family:var(--mono); font-size:12px; letter-spacing:0.06em; text-transform:uppercase; color:rgba(246,243,236,0.6); }
.post-cover{ max-width:760px; margin:-40px auto 0; padding:0 32px; }
.post-cover img{ width:100%; border-radius:var(--radius-md); box-shadow:var(--shadow-card); }
.post-article{ max-width:700px; margin:0 auto; padding:56px 32px 24px; font-size:17px; line-height:1.8; color:var(--ink-soft); }
.post-article h2{ font-family:var(--serif); font-size:1.6rem; font-weight:700; color:var(--ink); margin:40px 0 16px; line-height:1.25; }
.post-article h3{ font-family:var(--serif); font-size:1.3rem; font-weight:700; color:var(--ink); margin:32px 0 14px; line-height:1.3; }
.post-article p{ margin-bottom:20px; }
.post-article ul, .post-article ol{ margin:0 0 20px 22px; }
.post-article li{ margin-bottom:8px; }
.post-article li p{ margin-bottom:0; }
.post-article a{ color:var(--sky-deep); text-decoration:underline; text-underline-offset:2px; }
.post-article a:hover{ color:var(--sky); }
.post-article blockquote{ border-left:3px solid var(--brass); padding:4px 0 4px 20px; margin:24px 0; color:var(--slate); font-style:italic; }
.post-article code{ font-family:var(--mono); font-size:0.88em; background:var(--paper-dim); padding:2px 6px; border-radius:4px; }
.post-article pre{ background:var(--ink); color:var(--paper); padding:18px 20px; border-radius:var(--radius-md); overflow-x:auto; margin:24px 0; }
.post-article pre code{ background:none; padding:0; color:inherit; }
.post-article img{ border-radius:var(--radius-md); margin:24px 0; }
.post-article hr{ border:none; border-top:1px solid var(--paper-line); margin:32px 0; }
.post-footer{ max-width:700px; margin:0 auto; padding:8px 32px 64px; }
.post-back-link{ display:inline-flex; align-items:center; gap:6px; font-size:14px; font-weight:700; color:var(--sky-deep); }
.post-back-link:hover{ color:var(--sky); }

@media (max-width:860px){ .blog-grid{ grid-template-columns:1fr 1fr; } }
@media (max-width:600px){ .site-header{ padding:16px 20px; } .blog-grid{ grid-template-columns:1fr; } .blog-hero{ padding:60px 20px 48px; } .post-article, .post-footer{ padding-left:20px; padding-right:20px; } }
`;

export function renderLayout({ title, description, canonical, ogImage, ogType = 'website', jsonLd, bodyHtml }) {
  const image = ogImage || DEFAULT_OG_IMAGE;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-5Z395NTWFV"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-5Z395NTWFV');
</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link rel="icon" type="image/svg+xml" href="/logo-mark.svg">
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="Bluebird Acquisition">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${image}">
${jsonLd ? `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n</script>\n` : ''}<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${BASE_STYLES}</style>
</head>
<body>
${HEADER_HTML}
${bodyHtml}
${FOOTER_HTML}
</body>
</html>
`;
}

export function renderTagChips(tags, { linked = true } = {}) {
  return tags
    .map((t) =>
      linked
        ? `<a class="tag-chip" href="/blog/tag/${encodeURIComponent(slugify(t))}">${escapeHtml(t)}</a>`
        : `<span class="tag-chip">${escapeHtml(t)}</span>`,
    )
    .join(' ');
}

export function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
