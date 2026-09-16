/**
 * Public website shell: server-rendered HTML (no client JavaScript needed).
 *
 * Every page gets: unique <title>, meta description, canonical URL, Open
 * Graph + Twitter cards, exactly one <h1>, breadcrumbs (visible + JSON-LD),
 * shared header/footer with internal links, and page-specific JSON-LD.
 * The site is a "brochure" in front of the app at /app, so search engines
 * and link previews see real content instead of a sign-in screen.
 */
import { env } from '../config/env.js';

export const SITE = {
  name: 'ClashGH',
  legalName: env.siteLegalName,
  origin: env.siteOrigin.replace(/\/+$/, ''),
  description: 'Paid 1v1 mobile game tournaments in Ghana. Enter with Mobile Money, play eFootball, FC Mobile, CODM or DLS, and get winnings sent straight to your MoMo number.',
  locale: 'en_GH',
  city: 'Accra',
  region: 'Greater Accra',
  country: 'GH',
  email: env.siteContactEmail,
  phone: env.siteContactPhone,
  whatsapp: env.siteContactPhone ? `https://wa.me/${env.siteContactPhone.replace(/[^0-9]/g, '')}` : null,
  twitter: env.siteTwitterHandle, // e.g. @clashgh or ''
  foundingYear: '2026',
};

export const NAV = [
  { href: '/', label: 'Home' },
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/games', label: 'Games' },
  { href: '/hosts', label: 'Host a cup' },
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Contact' },
];

export const FOOTER_LINKS = [
  { href: '/rules', label: 'Fair play rules' },
  { href: '/terms', label: 'Terms of service' },
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/refunds', label: 'Refund policy' },
  { href: '/about', label: 'About' },
  { href: '/sitemap.xml', label: 'Sitemap' },
];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const abs = (p) => (p.startsWith('http') ? p : `${SITE.origin}${p}`);

export const CSS = `
:root{--bg:#0B0D10;--surface:#14171C;--surface2:#1B1F26;--border:#252A33;--text:#F3F4F6;--muted:#A9B0BC;--faint:#6B7280;--gold:#F2B518;--gold-dim:#A8800F;--green:#3DBE6E;--red:#E5484D}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--gold);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:960px;margin:0 auto;padding:0 20px}
header.site{border-bottom:1px solid var(--border);background:var(--bg);position:sticky;top:0;z-index:10}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:60px}
.brand{display:flex;align-items:center;gap:10px;color:var(--text);font-weight:700;letter-spacing:.5px}.brand:hover{text-decoration:none}
.brand img{width:28px;height:28px;border-radius:6px}
nav.primary{display:flex;gap:4px;flex-wrap:wrap}nav.primary a{color:var(--muted);padding:6px 10px;border-radius:8px;font-size:14px}nav.primary a[aria-current]{color:var(--text);background:var(--surface2)}nav.primary a:hover{text-decoration:none;color:var(--text)}
.cta{background:var(--gold);color:#0B0D10!important;font-weight:700;padding:10px 16px;border-radius:10px;display:inline-block;white-space:nowrap}.cta:hover{text-decoration:none;filter:brightness(.95)}
.cta.secondary{background:transparent;color:var(--text)!important;border:1px solid var(--border)}
main{padding:32px 0 56px}
.crumbs{font-size:13px;color:var(--faint);margin:0 0 16px}.crumbs ol{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:6px}.crumbs li+li:before{content:"/";margin-right:6px;color:var(--border)}.crumbs a{color:var(--muted)}
h1{font-size:34px;line-height:1.15;letter-spacing:-.5px;margin:0 0 12px}h2{font-size:22px;margin:36px 0 10px;letter-spacing:-.2px}h3{font-size:17px;margin:20px 0 6px}
p.lead{font-size:18px;color:var(--muted);margin:0 0 20px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;position:relative;overflow:hidden}
.card .bar{position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--gold)}
.card h3{margin:0 0 6px;font-size:17px}.card h3 a{color:var(--text)}
.meta{color:var(--muted);font-size:14px}.num{font-variant-numeric:tabular-nums}
.tag{display:inline-block;font-size:12px;border:1px solid var(--border);border-radius:999px;padding:2px 10px;color:var(--muted);margin-right:6px}
.tag.open{border-color:var(--green);color:var(--green)}
table{width:100%;border-collapse:collapse;font-size:15px}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--border)}th{color:var(--muted);font-weight:600;font-size:13px}
dl.faq dt{font-weight:600;margin-top:18px}dl.faq dd{margin:4px 0 0;color:var(--muted)}
ol.steps{padding-left:22px}ol.steps li{margin:8px 0}
.notice{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--gold);border-radius:10px;padding:14px 16px;color:var(--muted);font-size:15px}
footer.site{border-top:1px solid var(--border);padding:28px 0 40px;color:var(--faint);font-size:14px}
footer.site .cols{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-bottom:20px}footer.site a{color:var(--muted)}footer.site ul{list-style:none;padding:0;margin:8px 0 0}footer.site li{margin:4px 0}
.err h1{font-size:64px;margin:0}.err p{color:var(--muted)}
@media (max-width:640px){h1{font-size:28px}nav.primary{display:none}header.site .wrap{min-height:56px}}
`;

function breadcrumbs(crumbs) {
  if (!crumbs || crumbs.length < 2) return { html: '', json: null };
  const html = `<nav class="crumbs" aria-label="Breadcrumb"><ol>${crumbs
    .map((c, i) => (i === crumbs.length - 1 ? `<li aria-current="page">${esc(c.label)}</li>` : `<li><a href="${esc(c.href)}">${esc(c.label)}</a></li>`))
    .join('')}</ol></nav>`;
  const json = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.label, item: abs(c.href) })),
  };
  return { html, json };
}

export function organizationSchema() {
  const o = {
    '@context': 'https://schema.org',
    '@type': ['Organization', 'LocalBusiness'],
    '@id': `${SITE.origin}/#organization`,
    name: SITE.name,
    legalName: SITE.legalName,
    url: SITE.origin,
    logo: abs('/brand/icon-512.png'),
    image: abs('/brand/og-default.png'),
    description: SITE.description,
    foundingDate: SITE.foundingYear,
    address: { '@type': 'PostalAddress', addressLocality: SITE.city, addressRegion: SITE.region, addressCountry: SITE.country },
    areaServed: { '@type': 'Country', name: 'Ghana' },
    currenciesAccepted: 'GHS',
    paymentAccepted: 'Mobile Money',
    priceRange: '₵5 - ₵200',
    openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '00:00', closes: '23:59' }],
    contactPoint: [{ '@type': 'ContactPoint', contactType: 'customer support', email: SITE.email, ...(SITE.phone ? { telephone: SITE.phone } : {}), areaServed: 'GH', availableLanguage: ['en'] }],
  };
  if (SITE.twitter) o.sameAs = [`https://x.com/${SITE.twitter.replace(/^@/, '')}`];
  return o;
}

export function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE.origin}/#website`,
    url: SITE.origin,
    name: SITE.name,
    publisher: { '@id': `${SITE.origin}/#organization` },
    inLanguage: 'en-GH',
  };
}

/**
 * @param {object} p
 * @param {string} p.title        page title (site name is appended)
 * @param {string} p.description  meta description (<= 160 chars)
 * @param {string} p.path         canonical path, e.g. '/tournaments'
 * @param {string} p.h1           the single H1
 * @param {string} p.body         inner HTML after the H1
 * @param {Array}  [p.crumbs]     [{href,label}] including Home and current page
 * @param {Array}  [p.schema]     extra JSON-LD objects
 * @param {string} [p.lead]       lead paragraph under the H1
 * @param {string} [p.ogImage]    absolute or root-relative image
 * @param {string} [p.ogType]     'website' | 'article' | ...
 * @param {boolean}[p.noindex]
 */
export function page(p) {
  const fullTitle = p.title === SITE.name ? `${SITE.name}: paid mobile game tournaments in Ghana` : `${p.title} | ${SITE.name}`;
  const canonical = abs(p.path);
  const og = abs(p.ogImage || '/brand/og-default.png');
  const bc = breadcrumbs(p.crumbs);
  const schema = [organizationSchema(), websiteSchema(), bc.json, ...(p.schema || [])].filter(Boolean);
  const current = (href) => (href === p.path || (href !== '/' && p.path.startsWith(href)) ? ' aria-current="page"' : '');
  return `<!DOCTYPE html>
<html lang="en-GH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${esc(canonical)}">
${p.noindex ? '<meta name="robots" content="noindex, follow">' : '<meta name="robots" content="index, follow, max-image-preview:large">'}
<meta name="theme-color" content="#0B0D10">
<meta name="application-name" content="${SITE.name}">
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:type" content="${esc(p.ogType || 'website')}">
<meta property="og:locale" content="${SITE.locale}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(og)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(p.ogImageAlt || 'ClashGH logo with the words: paid mobile game tournaments in Ghana. Enter with Mobile Money, win real cash.')}">
<meta name="twitter:card" content="summary_large_image">
${SITE.twitter ? `<meta name="twitter:site" content="${esc(SITE.twitter)}">` : ''}
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(p.description)}">
<meta name="twitter:image" content="${esc(og)}">
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 64x64">
<link rel="icon" type="image/png" sizes="192x192" href="/brand/icon-192.png">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<link rel="manifest" href="/app/manifest.json">
<link rel="alternate" type="application/rss+xml" title="ClashGH open tournaments" href="/tournaments.rss">
<style>${CSS}</style>
${schema.map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join('\n')}
</head>
<body>
<header class="site">
  <div class="wrap">
    <a class="brand" href="/" aria-label="ClashGH home"><img src="/brand/icon-192.png" width="28" height="28" alt="ClashGH logo: three gold bars on a dark tile">ClashGH</a>
    <nav class="primary" aria-label="Main">${NAV.map((n) => `<a href="${n.href}"${current(n.href)}>${n.label}</a>`).join('')}</nav>
    <a class="cta" href="/app">Open the app</a>
  </div>
</header>
<main>
  <div class="wrap">
    ${bc.html}
    <h1>${p.h1}</h1>
    ${p.lead ? `<p class="lead">${p.lead}</p>` : ''}
    ${p.body}
  </div>
</main>
<footer class="site">
  <div class="wrap">
    <div class="cols">
      <div><strong style="color:var(--text)">ClashGH</strong><p style="margin:8px 0 0">${esc(SITE.description)}</p></div>
      <div><strong style="color:var(--text)">Explore</strong><ul>${NAV.slice(1).map((n) => `<li><a href="${n.href}">${n.label}</a></li>`).join('')}<li><a href="/app">Player app</a></li></ul></div>
      <div><strong style="color:var(--text)">Legal</strong><ul>${FOOTER_LINKS.map((n) => `<li><a href="${n.href}">${n.label}</a></li>`).join('')}</ul></div>
      <div><strong style="color:var(--text)">Contact</strong><ul><li><a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a></li>${SITE.whatsapp ? `<li><a href="${esc(SITE.whatsapp)}" rel="noopener">WhatsApp support</a></li>` : ''}<li>${esc(SITE.city)}, Ghana</li></ul></div>
    </div>
    <div>© ${new Date().getFullYear()} ${esc(SITE.legalName)}. Skill-based competition with a fixed entry fee and published prizes. No betting, no odds, no wagering between players. Players must be 18 or older.</div>
  </div>
</footer>
</body>
</html>`;
}
