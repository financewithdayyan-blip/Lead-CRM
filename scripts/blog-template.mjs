// Shared layout for every generated blog page (post, listing, tag archive).
// One function so the header/nav/footer markup — already unified across
// every hand-authored public/*.html page — can't drift out of sync between
// three different page kinds; a future nav change is a one-line edit here
// instead of three.

export const SITE_URL = 'https://www.bluebirdacquisition.com';
export const DEFAULT_OG_IMAGE = `${SITE_URL}/logo-mark.svg`;

// Public anon key — safe to embed in static HTML by design (same values as
// VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY, already shipped in the built CRM
// bundle). Used by the view/like widget below, which talks to Supabase
// directly from a plain <script> tag since these pages have no build-time
// knowledge of runtime engagement counts.
export const SUPABASE_URL = 'https://ggfpvrdxqopippzqkojr.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnZnB2cmR4cW9waXBwenFrb2pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMjUzNTgsImV4cCI6MjA5OTgwMTM1OH0.5sxa2PkS5Ed3M-lOmY1hwutmPMHXViEBRLLqZxj_Atg';

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
    <a href="/contact-us" class="header-cta" aria-label="Get Your Cash Offer">
      <span>Get Your Cash Offer</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </a>
    <button class="menu-toggle" id="menuToggle" aria-label="Toggle menu" aria-expanded="false" aria-controls="mobileNav" onclick="var m=document.getElementById('mobileNav');var o=m.classList.toggle('open');this.classList.toggle('open',o);this.setAttribute('aria-expanded',o);">
      <svg class="icon-menu" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      <svg class="icon-close" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
  <div class="mobile-nav" id="mobileNav">
    <a href="/about-us">About Us</a>
    <a href="/solutions">Solutions</a>
    <a href="/blog">Blog</a>
    <a href="/contact-us">Contact Us</a>
    <a href="/crm">Login</a>
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
  --brass:#C9A24B; --brass-soft:#7B6F4C;
  --paper:#F6F3EC; --paper-dim:#EDE8DB; --paper-line:#DCD5C2;
  --slate:#57667A; --slate-dim:#6D7782; --white:#FFFFFF;
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

.site-header{ background:var(--ink); padding:18px 32px; position:sticky; top:0; z-index:100; }
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
.menu-toggle{ display:none; align-items:center; justify-content:center; width:36px; height:36px; border-radius:8px; color:var(--white); flex-shrink:0; }
.menu-toggle:hover{ background:rgba(255,255,255,0.08); }
.menu-toggle .icon-close{ display:none; }
.menu-toggle.open .icon-menu{ display:none; }
.menu-toggle.open .icon-close{ display:block; }
.mobile-nav{ display:none; flex-direction:column; background:var(--ink-soft); margin-top:14px; border-radius:var(--radius-md); overflow:hidden; }
.mobile-nav.open{ display:flex; }
.mobile-nav a{ padding:14px 20px; font-size:14.5px; font-weight:600; color:rgba(246,243,236,0.85); border-bottom:1px solid rgba(255,255,255,0.08); }
.mobile-nav a:last-child{ border-bottom:none; }
.mobile-nav a:hover{ color:var(--white); background:rgba(255,255,255,0.06); }
@media (max-width:980px){ .nav-links{ display:none; } .menu-toggle{ display:flex; } }
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

.tag-chip{ display:inline-block; font-family:var(--mono); font-size:10.5px; font-weight:600; letter-spacing:0.04em; color:var(--sky-deep); background:rgba(30,143,213,0.1); padding:8px 12px; border-radius:100px; }
a.tag-chip:hover{ background:rgba(30,143,213,0.18); }

/* BLOG — search + tag filter toolbar (listing page) */
.blog-toolbar{ display:flex; flex-direction:column; gap:16px; margin-bottom:36px; }
.blog-search-box{ position:relative; max-width:440px; }
.blog-search-box svg{ position:absolute; left:16px; top:50%; transform:translateY(-50%); color:var(--slate-dim); pointer-events:none; }
.blog-search-box input{ width:100%; padding:13px 16px 13px 46px; border-radius:100px; border:1.5px solid var(--paper-line); background:var(--white); font-family:var(--sans); font-size:14.5px; color:var(--ink); transition:border-color 0.2s,box-shadow 0.2s; }
.blog-search-box input::placeholder{ color:var(--slate-dim); }
.blog-search-box input:focus{ outline:none; border-color:var(--sky); box-shadow:0 0 0 4px rgba(30,143,213,0.12); }
.blog-filter-chips{ display:flex; flex-wrap:wrap; gap:8px; }
.blog-filter-chip{ font-family:var(--mono); font-size:11.5px; font-weight:600; letter-spacing:0.03em; padding:8px 14px; border-radius:100px; border:1.5px solid var(--paper-line); background:var(--white); color:var(--slate); cursor:pointer; transition:border-color 0.2s,background 0.2s,color 0.2s; }
.blog-filter-chip:hover{ border-color:var(--sky); color:var(--ink); }
.blog-filter-chip.active{ background:var(--ink); border-color:var(--ink); color:var(--white); }
.blog-search-empty{ text-align:center; padding:48px 20px; color:var(--slate-dim); font-size:15px; }

/* BLOG — featured section (listing page) */
.blog-featured{ display:grid; grid-template-columns:1.6fr 1fr; gap:28px; margin-bottom:48px; }
.blog-featured.single{ grid-template-columns:1fr; }
.featured-main{ background:var(--white); border:1.5px solid var(--paper-line); border-radius:var(--radius-md); overflow:hidden; box-shadow:var(--shadow-card); display:flex; flex-direction:column; transition:transform 0.2s,box-shadow 0.2s; }
.featured-main:hover{ transform:translateY(-3px); box-shadow:0 4px 8px rgba(11,30,51,0.06),0 16px 32px -12px rgba(11,30,51,0.2); }
.featured-main-thumb{ aspect-ratio:16/9; width:100%; object-fit:cover; background:var(--paper-dim); }
.featured-main-body{ padding:28px 30px 30px; display:flex; flex-direction:column; gap:12px; flex:1; }
.featured-meta{ display:flex; align-items:center; gap:10px; }
.featured-main-body h2{ font-family:var(--serif); font-size:1.7rem; font-weight:700; color:var(--ink); line-height:1.22; }
.featured-main-body p{ font-size:15px; line-height:1.65; color:var(--slate); flex:1; }
.featured-read-link{ display:inline-flex; align-items:center; gap:6px; font-size:14px; font-weight:700; color:var(--sky-deep); margin-top:2px; }
.featured-main:hover .featured-read-link{ color:var(--sky); }

.blog-featured-side{ display:flex; flex-direction:column; gap:18px; }
.featured-side-card{ display:flex; gap:14px; background:var(--white); border:1.5px solid var(--paper-line); border-radius:var(--radius-md); padding:14px; box-shadow:var(--shadow-card); transition:transform 0.2s,box-shadow 0.2s; }
.featured-side-card:hover{ transform:translateY(-2px); box-shadow:0 4px 8px rgba(11,30,51,0.06),0 16px 32px -12px rgba(11,30,51,0.2); }
.featured-side-thumb{ width:100px; height:76px; flex-shrink:0; border-radius:10px; object-fit:cover; background:var(--paper-dim); }
.featured-side-body{ display:flex; flex-direction:column; gap:7px; min-width:0; justify-content:center; }
.featured-side-body h3{ font-family:var(--serif); font-size:1rem; font-weight:700; color:var(--ink); line-height:1.32; }

/* BLOG — cta band (listing page) */
.blog-cta-band{ display:flex; align-items:center; justify-content:space-between; gap:24px; flex-wrap:wrap; background:var(--ink); border-radius:var(--radius-md); padding:32px 36px; margin-bottom:52px; position:relative; overflow:hidden; }
.blog-cta-band::before{ content:''; position:absolute; inset:0; background:radial-gradient(ellipse 50% 100% at 100% 0%,rgba(30,143,213,0.32),transparent 60%); pointer-events:none; }
.blog-cta-band-text{ position:relative; }
.blog-cta-band-text h3{ font-family:var(--serif); font-size:1.35rem; font-weight:700; color:var(--white); margin-bottom:6px; }
.blog-cta-band-text p{ font-size:14px; color:rgba(246,243,236,0.75); }
.blog-cta-band .btn-cta{ position:relative; display:inline-flex; align-items:center; gap:8px; background:var(--sky); color:var(--white); font-weight:700; font-size:14px; padding:14px 24px; border-radius:100px; white-space:nowrap; transition:background 0.2s,transform 0.2s,box-shadow 0.2s; }
.blog-cta-band .btn-cta:hover{ background:var(--sky-deep); transform:translateY(-2px); box-shadow:0 8px 20px -6px rgba(21,104,168,0.5); }

.blog-section-heading{ font-family:var(--serif); font-size:1.6rem; font-weight:700; color:var(--ink); margin-bottom:22px; }

/* BLOG — single post */
.post-hero{ background:var(--ink); color:var(--white); padding:64px 32px 56px; }
.post-hero-inner{ max-width:820px; margin:0 auto; }
.post-hero .blog-card-tags{ margin-bottom:18px; }
.post-hero h1{ font-family:var(--serif); font-size:clamp(1.9rem,4.5vw,2.7rem); font-weight:700; line-height:1.15; margin-bottom:16px; }
.post-hero-meta{ display:flex; align-items:center; flex-wrap:wrap; gap:10px; font-family:var(--mono); font-size:12px; letter-spacing:0.06em; text-transform:uppercase; color:rgba(246,243,236,0.6); }
.post-meta-dot{ opacity:0.5; }
.post-views{ display:inline-flex; align-items:center; gap:5px; }
.post-views svg{ opacity:0.7; }
.post-like-btn{ display:inline-flex; align-items:center; gap:6px; font-family:var(--mono); font-size:12px; letter-spacing:0.06em; color:rgba(246,243,236,0.85); background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.16); padding:7px 12px; border-radius:100px; transition:background 0.2s,border-color 0.2s,transform 0.15s; }
.post-like-btn:hover{ background:rgba(255,255,255,0.14); }
.post-like-btn:active{ transform:scale(0.96); }
.post-like-btn svg{ transition:fill 0.2s,stroke 0.2s; }
.post-like-btn.liked{ background:rgba(230,90,90,0.16); border-color:rgba(230,90,90,0.4); color:#F0A8A8; }
.post-like-btn.liked svg{ fill:#E65A5A; stroke:#E65A5A; }
.post-cover{ max-width:920px; margin:-40px auto 0; padding:0 32px; }
.post-cover img{ width:100%; aspect-ratio:16/9; object-fit:cover; object-position:center 38%; border-radius:var(--radius-md); box-shadow:var(--shadow-card); }

/* BLOG — post layout: article + sticky sidebar */
.post-layout{ max-width:1080px; margin:0 auto; padding:56px 32px 8px; display:grid; grid-template-columns:minmax(0,1fr) 300px; gap:56px; align-items:start; }
.post-main{ min-width:0; }
.post-article{ font-size:17px; line-height:1.8; color:var(--ink-soft); }
.post-article h2{ font-family:var(--serif); font-size:1.6rem; font-weight:700; color:var(--ink); margin:40px 0 16px; line-height:1.25; scroll-margin-top:24px; }
.post-article h3{ font-family:var(--serif); font-size:1.3rem; font-weight:700; color:var(--ink); margin:32px 0 14px; line-height:1.3; scroll-margin-top:24px; }
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
.post-footer{ padding:8px 0 64px; }
.post-back-link{ display:inline-flex; align-items:center; gap:6px; font-size:14px; font-weight:700; color:var(--sky-deep); }
.post-back-link:hover{ color:var(--sky); }

/* BLOG — key takeaways callout, opens most posts */
.key-takeaways{ background:var(--paper-dim); border:1.5px solid var(--paper-line); border-radius:var(--radius-md); padding:26px 28px; margin:8px 0 40px; }
.key-takeaways-title{ font-family:var(--serif); font-size:1.3rem; font-weight:700; color:var(--ink); margin-bottom:14px; }
.key-takeaways ul{ margin:0; }
.key-takeaways li{ margin-bottom:11px; }
.key-takeaways li:last-child{ margin-bottom:0; }

/* BLOG — sidebar: sticky TOC + CTA card */
/* top offset must clear the sticky site header (~62px tall, z-index:100) —
   24px alone left the header covering the sidebar's top ~38px once both
   were stuck. */
.post-sidebar{ position:sticky; top:96px; display:flex; flex-direction:column; gap:20px; }
.sidebar-card{ background:var(--white); border:1.5px solid var(--paper-line); border-radius:var(--radius-md); padding:22px; box-shadow:var(--shadow-card); }
.sidebar-card-title{ font-family:var(--mono); font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--slate-dim); margin-bottom:14px; }
.toc-list{ display:flex; flex-direction:column; }
.toc-link{ display:block; padding:7px 0 7px 12px; margin-left:-1px; font-size:13px; line-height:1.4; color:var(--slate); border-left:2px solid var(--paper-line); transition:color 0.15s,border-color 0.15s; }
.toc-link:hover{ color:var(--sky-deep); border-color:var(--sky); }
.toc-link.toc-level-3{ padding-left:24px; font-size:12.5px; color:var(--slate-dim); }
.cta-card{ background:var(--ink); border-color:var(--ink); }
.cta-card-title{ font-family:var(--serif); font-size:1.2rem; font-weight:700; color:var(--white); margin-bottom:8px; line-height:1.25; }
.cta-card p{ font-size:13px; color:rgba(246,243,236,0.75); line-height:1.55; margin-bottom:18px; }
.cta-card .btn-cta{ display:flex; align-items:center; justify-content:center; gap:6px; width:100%; background:var(--sky); color:var(--white); font-weight:700; font-size:13.5px; padding:12px 16px; border-radius:100px; transition:background 0.2s,transform 0.2s,box-shadow 0.2s; }
.cta-card .btn-cta:hover{ background:var(--sky-deep); transform:translateY(-2px); box-shadow:0 8px 20px -6px rgba(21,104,168,0.5); }

/* BLOG — related articles */
.related-section{ max-width:var(--container); margin:0 auto; padding:24px 32px 80px; }
.related-header{ display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:22px; }
.related-heading{ font-family:var(--serif); font-size:1.7rem; font-weight:700; color:var(--ink); }
.related-nav{ display:flex; gap:8px; flex-shrink:0; }
.related-nav button{ display:flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:50%; border:1.5px solid var(--paper-line); background:var(--white); color:var(--ink); transition:background 0.2s,border-color 0.2s; }
.related-nav button:hover{ background:var(--paper-dim); border-color:var(--slate-dim); }
.related-track{ display:flex; gap:20px; overflow-x:auto; scroll-snap-type:x mandatory; scrollbar-width:none; margin:0 -32px; padding:0 32px 6px; }
.related-track::-webkit-scrollbar{ display:none; }
.related-track .blog-card{ flex:0 0 260px; scroll-snap-align:start; }

@media (max-width:900px){
  .post-layout{ grid-template-columns:1fr; padding-top:40px; }
  .post-sidebar{ position:static; }
}
@media (max-width:860px){
  .blog-grid{ grid-template-columns:1fr 1fr; }
  .blog-featured{ grid-template-columns:1fr; }
  .blog-featured-side{ flex-direction:row; }
  .featured-side-card{ flex:1; }
}
@media (max-width:600px){
  .site-header{ padding:16px 20px; }
  .blog-grid{ grid-template-columns:1fr; }
  .blog-hero{ padding:60px 20px 48px; }
  .post-layout{ padding-left:20px; padding-right:20px; }
  .related-section{ padding-left:20px; padding-right:20px; }
  .related-track{ margin:0 -20px; padding:0 20px 6px; }
  .blog-featured-side{ flex-direction:column; }
  .featured-side-card{ flex-direction:column; }
  .featured-side-thumb{ width:100%; height:auto; aspect-ratio:16/9; }
  .blog-cta-band{ padding:26px 22px; }
  .featured-main-body{ padding:22px 20px 24px; }
}
`;

export function renderLayout({ title, description, canonical, ogImage, ogType = 'website', jsonLd, bodyHtml, robots = 'index, follow' }) {
  const image = ogImage || DEFAULT_OG_IMAGE;
  // A single post or the listing page can carry more than one structured-data
  // block (BlogPosting + FAQPage + BreadcrumbList) — accepts either one
  // object or an array so every existing caller passing a bare object still
  // works unchanged.
  const jsonLdBlocks = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];
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
<!-- Explicit, not just relying on the default-indexable absence of this
     tag — makes "is this page allowed to rank" unambiguous to any crawler
     inspecting the raw HTML, independent of robots.txt. -->
<meta name="robots" content="${robots}">
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
${jsonLdBlocks.map((block) => `<script type="application/ld+json">\n${JSON.stringify(block, null, 2)}\n</script>\n`).join('')}<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=optional" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=optional"></noscript>
<style>${BASE_STYLES}</style>
</head>
<body>
${HEADER_HTML}
<main>${bodyHtml}</main>
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

/** Gives every h2/h3 in a post's body an anchor id (deriving it from the
 * heading's own text, de-duped if two headings collide) and returns the
 * list alongside, for the "In This Article" sidebar — one pass so the ids
 * used to build the links are guaranteed to match the ones actually in the
 * HTML. The very first heading is almost always this codebase's own
 * "repeat the title as an h2" convention (see generate-blog.mjs), which
 * would otherwise show up as a redundant first TOC entry — dropped from
 * the returned list (but still gets an id) whenever it matches the post's
 * own title. */
export function injectHeadingIds(html, postTitle) {
  const used = new Set();
  const headings = [];
  const withIds = String(html ?? '').replace(/<(h2|h3)>([\s\S]*?)<\/\1>/g, (match, tag, inner) => {
    const text = inner.replace(/<[^>]*>/g, '').trim();
    const base = slugify(text) || `section-${headings.length + 1}`;
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    if (!postTitle || text.toLowerCase() !== postTitle.trim().toLowerCase()) {
      headings.push({ id, text, level: Number(tag[1]) });
    }
    return `<${tag} id="${id}">${inner}</${tag}>`;
  });
  return { html: withIds, headings };
}

/** View count + like button for a post page — hydrated client-side against
 * the get_blog_engagement/record_blog_view/toggle_blog_like RPCs (see
 * 0096_blog_engagement.sql), since the static HTML has no build-time
 * knowledge of runtime counts. Placed inline right after the elements it
 * targets, so no DOMContentLoaded wrapper is needed. */
export function engagementWidget(slug) {
  return `<span class="post-meta-dot">&middot;</span>
    <span id="pv-views" class="post-views">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      <span data-role="count">&ndash;</span> views
    </span>
    <button id="pv-like" class="post-like-btn" type="button" aria-pressed="false">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
      <span data-role="count">&ndash;</span>
    </button>
    <script>
    (function(){
      var SLUG = ${JSON.stringify(slug)};
      var URL_BASE = ${JSON.stringify(SUPABASE_URL)};
      var ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)};
      function rpc(name, body) {
        return fetch(URL_BASE + '/rest/v1/rpc/' + name, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY },
          body: JSON.stringify(body),
        }).then(function (r) { return r.json(); });
      }
      function visitorId() {
        try {
          var id = localStorage.getItem('bb_visitor_id');
          if (!id) {
            id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
            localStorage.setItem('bb_visitor_id', id);
          }
          return id;
        } catch (e) { return null; }
      }
      function fmt(n) { return (n || 0).toLocaleString(); }

      var vid = visitorId();
      var viewsCount = document.querySelector('#pv-views [data-role="count"]');
      var likeBtn = document.getElementById('pv-like');
      var likeCount = likeBtn ? likeBtn.querySelector('[data-role="count"]') : null;

      rpc('get_blog_engagement', { p_slug: SLUG, p_visitor_id: vid }).then(function (data) {
        if (viewsCount) viewsCount.textContent = fmt(data.views);
        if (likeCount) likeCount.textContent = fmt(data.likes);
        if (likeBtn && data.liked) {
          likeBtn.classList.add('liked');
          likeBtn.setAttribute('aria-pressed', 'true');
        }
      }).catch(function () {});

      try {
        var viewKey = 'bb_viewed_' + SLUG;
        if (!sessionStorage.getItem(viewKey)) {
          sessionStorage.setItem(viewKey, '1');
          rpc('record_blog_view', { p_slug: SLUG }).then(function () {
            if (viewsCount) viewsCount.textContent = fmt((parseInt((viewsCount.textContent || '0').replace(/,/g, ''), 10) || 0) + 1);
          }).catch(function () {});
        }
      } catch (e) {}

      if (likeBtn && vid) {
        likeBtn.addEventListener('click', function () {
          likeBtn.disabled = true;
          rpc('toggle_blog_like', { p_slug: SLUG, p_visitor_id: vid }).then(function (data) {
            if (data && typeof data.liked === 'boolean') {
              likeBtn.classList.toggle('liked', data.liked);
              likeBtn.setAttribute('aria-pressed', data.liked ? 'true' : 'false');
              if (likeCount) likeCount.textContent = fmt(data.likes);
            }
          }).catch(function () {}).finally(function () { likeBtn.disabled = false; });
        });
      }
    })();
    </script>`;
}

export function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
