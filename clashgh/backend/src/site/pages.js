/**
 * Public website routes (server-rendered). Mounted before the app/static
 * handlers. Content-only pages live here; data pages (tournaments) read the
 * same tables as the API. No client JavaScript is shipped for these pages.
 */
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { GAME_TYPES, UUID_RE } from '../utils/validate.js';
import { computeSplit, pesewasToGhsString } from '../utils/prize.js';
import { page, esc, abs, SITE } from './layout.js';

export const siteRouter = Router();

export const GAMES = {
  efootball: { name: 'eFootball', slug: 'efootball', publisher: 'Konami', blurb: 'Football. 1v1 friendly matches using the room code, standard 10-minute halves unless the tournament rules say otherwise.' },
  fc_mobile: { name: 'FC Mobile', slug: 'fc-mobile', publisher: 'EA Sports', blurb: 'Football. Head-to-head matches against your bracket opponent, added by their FC Mobile player ID.' },
  codm: { name: 'Call of Duty: Mobile', slug: 'codm', publisher: 'Activision', blurb: 'Shooter. 1v1 private matches; the room code and your opponent\u2019s UID are shown in the match room.' },
  dls: { name: 'Dream League Soccer', slug: 'dls', publisher: 'First Touch Games', blurb: 'Football. Online friendly matches with your opponent\u2019s DLS Online ID.' },
};
const slugToGame = Object.fromEntries(Object.values(GAMES).map((g) => [g.slug, Object.keys(GAMES).find((k) => GAMES[k] === g)]));

const ghs = pesewasToGhsString;
const when = (d) => new Date(d).toLocaleString('en-GB', { timeZone: 'Africa/Accra', dateStyle: 'medium', timeStyle: 'short' }) + ' GMT';
const HOME_CRUMB = { href: '/', label: 'Home' };
const html = (res, body, status = 200) => {
  res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' }).send(body);
};

const TOURNAMENT_SQL = `
  SELECT t.*, h.username AS host_username,
         (SELECT count(*) FROM public.registrations r WHERE r.tournament_id = t.id AND r.payment_status = 'paid')::int AS paid_count
  FROM public.tournaments t LEFT JOIN public.users h ON h.id = t.host_id`;

function tournamentCard(t) {
  const g = GAMES[t.game];
  const split = computeSplit(t.entry_fee_pesewas * t.max_players, t.first_place_percent, t.runnerup_percent, t.host_id ? env.hostCommissionPercent : null);
  const open = t.status === 'open' && new Date(t.closes_at) > new Date();
  return `<article class="card"><span class="bar" aria-hidden="true"></span>
    <h3><a href="/tournaments/${t.id}">${esc(t.title)}</a></h3>
    <p class="meta"><a href="/games/${g.slug}">${esc(g.name)}</a> · ${t.host_username ? `hosted by ${esc(t.host_username)}` : 'official ClashGH cup'}</p>
    <p class="meta num">Entry ${ghs(t.entry_fee_pesewas)} · ${t.max_players} players · 1st prize ${ghs(split.first)} · 2nd ${ghs(split.runnerup)}</p>
    <p class="meta"><span class="tag ${open ? 'open' : ''}">${open ? `${t.max_players - t.paid_count} of ${t.max_players} spots left` : esc(t.status.replace('_', ' '))}</span>${open ? `closes ${when(t.closes_at)}` : ''}</p>
  </article>`;
}

function eventSchema(t) {
  const g = GAMES[t.game];
  const split = computeSplit(t.entry_fee_pesewas * t.max_players, t.first_place_percent, t.runnerup_percent, t.host_id ? env.hostCommissionPercent : null);
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: t.title,
    description: `${g.name} 1v1 single-elimination tournament for ${t.max_players} players. Entry ${ghs(t.entry_fee_pesewas)}. First prize ${ghs(split.first)}, runner-up ${ghs(split.runnerup)}.`,
    startDate: new Date(t.starts_at).toISOString(),
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    eventStatus: t.status === 'cancelled' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    location: { '@type': 'VirtualLocation', url: abs(`/tournaments/${t.id}`) },
    image: abs('/brand/og-default.png'),
    organizer: t.host_username ? { '@type': 'Person', name: t.host_username } : { '@id': `${SITE.origin}/#organization` },
    offers: {
      '@type': 'Offer',
      price: (t.entry_fee_pesewas / 100).toFixed(2),
      priceCurrency: 'GHS',
      availability: t.status === 'open' ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
      url: abs(`/tournaments/${t.id}`),
      validFrom: new Date(t.created_at).toISOString(),
    },
    url: abs(`/tournaments/${t.id}`),
  };
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
siteRouter.get('/', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`${TOURNAMENT_SQL} WHERE t.status = 'open' AND t.closes_at > now() ORDER BY t.closes_at ASC LIMIT 6`);
  const { rows: [stats] } = await pool.query(
    `SELECT (SELECT count(*) FROM public.tournaments WHERE status = 'completed')::int AS completed,
            (SELECT coalesce(sum(amount_pesewas),0) FROM public.transactions WHERE type = 'payout' AND status = 'success')::int AS paid_out`,
  );
  const body = `
    <p><a class="cta" href="/app">Play now</a> &nbsp; <a class="cta secondary" href="/how-it-works">How it works</a></p>
    <h2>Open tournaments</h2>
    ${rows.length ? `<div class="grid">${rows.map(tournamentCard).join('')}</div>` : '<p class="meta">No open lobbies at this moment. New cups are published daily; check the <a href="/tournaments">tournament list</a>.</p>'}
    <p style="margin-top:14px"><a href="/tournaments">See all tournaments</a></p>

    <h2>Why players use ClashGH</h2>
    <div class="grid">
      <div class="card"><h3>Mobile Money in, Mobile Money out</h3><p class="meta">Pay the entry fee with MTN MoMo, Telecel Cash or AirtelTigo Money. Prizes are sent to the same number automatically after the final.</p></div>
      <div class="card"><h3>Nothing to install</h3><p class="meta">Works in the browser on any Android or iPhone. Add it to your home screen and it opens like an app. Under 300 KB to load, fine on a 2 GB phone and mobile data.</p></div>
      <div class="card"><h3>Fixed prizes, no betting</h3><p class="meta">Every cup shows the entry fee and both prizes before you join. There are no odds and no wagers between players.</p></div>
      <div class="card"><h3>Fair results</h3><p class="meta">Both players submit a score screenshot. When they agree the match settles instantly; when they do not, a human reviews it.</p></div>
      <div class="card"><h3>Play on your schedule</h3><p class="meta">You and your opponent agree a match time inside a 24-hour window. No need to be online at a fixed kick-off.</p></div>
    </div>

    <h2>Games</h2>
    <p class="meta">${Object.values(GAMES).map((g) => `<a href="/games/${g.slug}">${esc(g.name)}</a>`).join(' · ')}</p>

    ${stats.completed > 0 ? `<h2>So far</h2><p class="meta num">${stats.completed} tournaments completed and ${ghs(stats.paid_out)} paid out to players.</p>` : ''}

    <h2>Host your own cup</h2>
    <p class="meta">Community organisers can publish tournaments for their own players and earn a share of the entry fees. Players' money stays in ClashGH escrow. <a href="/hosts">Read about hosting</a>.</p>
  `;
  html(res, page({
    title: SITE.name,
    description: 'Paid 1v1 mobile game tournaments in Ghana. Enter with Mobile Money, play eFootball, FC Mobile, CODM or DLS, and get winnings sent to your MoMo number.',
    path: '/',
    h1: 'Paid mobile game tournaments in Ghana',
    lead: 'Enter with Mobile Money. Play a 1v1 bracket in eFootball, FC Mobile, CODM or DLS. Winnings are sent to your MoMo number.',
    body,
  }));
}));

// ---------------------------------------------------------------------------
// Tournaments
// ---------------------------------------------------------------------------
siteRouter.get('/tournaments', asyncHandler(async (req, res) => {
  const { rows: open } = await pool.query(`${TOURNAMENT_SQL} WHERE t.status IN ('open','full') AND (t.status <> 'open' OR t.closes_at > now()) ORDER BY t.closes_at ASC LIMIT 50`);
  const { rows: live } = await pool.query(`${TOURNAMENT_SQL} WHERE t.status = 'in_progress' ORDER BY t.starts_at DESC LIMIT 20`);
  const { rows: done } = await pool.query(`${TOURNAMENT_SQL} WHERE t.status = 'completed' ORDER BY t.updated_at DESC LIMIT 20`);
  const section = (title, list, empty) => `<h2>${title}</h2>${list.length ? `<div class="grid">${list.map(tournamentCard).join('')}</div>` : `<p class="meta">${empty}</p>`}`;
  const body = `
    ${section('Open for entry', open, 'No open lobbies right now. New cups are published daily.')}
    ${section('In progress', live, 'No brackets are being played at the moment.')}
    ${section('Recently completed', done, 'No completed tournaments yet.')}
    <p class="meta" style="margin-top:24px">Filter by game: ${Object.values(GAMES).map((g) => `<a href="/games/${g.slug}">${esc(g.name)}</a>`).join(' · ')}. Read the <a href="/rules">fair play rules</a> before entering.</p>`;
  const schema = {
    '@context': 'https://schema.org', '@type': 'ItemList', name: 'Open ClashGH tournaments',
    itemListElement: open.map((t, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(`/tournaments/${t.id}`), name: t.title })),
  };
  html(res, page({
    title: 'Tournaments',
    description: 'Open, live and completed 1v1 mobile game tournaments on ClashGH. Entry fees from ₵5, prizes paid to Mobile Money in Ghana.',
    path: '/tournaments',
    h1: 'Tournaments',
    lead: 'Every cup lists the entry fee, the lobby size and both prizes before you join.',
    crumbs: [HOME_CRUMB, { href: '/tournaments', label: 'Tournaments' }],
    body, schema: [schema],
  }));
}));

siteRouter.get('/tournaments/:id', asyncHandler(async (req, res, next) => {
  if (!UUID_RE.test(req.params.id)) return next();
  const { rows: [t] } = await pool.query(`${TOURNAMENT_SQL} WHERE t.id = $1`, [req.params.id]);
  if (!t) return next();
  const g = GAMES[t.game];
  const total = t.entry_fee_pesewas * t.max_players;
  const split = computeSplit(total, t.first_place_percent, t.runnerup_percent, t.host_id ? env.hostCommissionPercent : null);
  const open = t.status === 'open' && new Date(t.closes_at) > new Date();
  const rounds = Math.round(Math.log2(t.max_players));
  const { rows: matches } = await pool.query(
    `SELECT m.match_round, m.match_number, m.status, p1.username AS p1, p2.username AS p2, w.username AS winner
     FROM public.matches m LEFT JOIN public.users p1 ON p1.id = m.player1_id LEFT JOIN public.users p2 ON p2.id = m.player2_id LEFT JOIN public.users w ON w.id = m.winner_id
     WHERE m.tournament_id = $1 ORDER BY m.match_round, m.match_number`, [t.id],
  );
  const body = `
    <p class="meta"><span class="tag ${open ? 'open' : ''}">${open ? 'Open for entry' : esc(t.status.replace('_', ' '))}</span><a href="/games/${g.slug}">${esc(g.name)}</a> · ${t.host_username ? `hosted by ${esc(t.host_username)}` : 'official ClashGH cup'}</p>
    ${open ? `<p><a class="cta" href="/app/tournament/${t.id}">Join for ${ghs(t.entry_fee_pesewas)}</a></p>` : `<p><a class="cta secondary" href="/app/tournament/${t.id}">Open in the app</a></p>`}
    <h2>Prizes and fees</h2>
    <table class="num"><tbody>
      <tr><th>Entry fee</th><td>${ghs(t.entry_fee_pesewas)}</td></tr>
      <tr><th>Players</th><td>${t.max_players} (${rounds} rounds, single elimination)</td></tr>
      <tr><th>Champion</th><td>${ghs(split.first)} (${t.first_place_percent}% of fees)</td></tr>
      <tr><th>Runner-up</th><td>${ghs(split.runnerup)} (${t.runnerup_percent}%)</td></tr>
      <tr><th>${t.host_id ? 'Host and platform fee' : 'Platform fee'}</th><td>${ghs(split.host + split.platform)} (${100 - t.first_place_percent - t.runnerup_percent}%)</td></tr>
      <tr><th>Registration closes</th><td>${when(t.closes_at)}</td></tr>
      <tr><th>Round 1 scheduling opens</th><td>${when(t.starts_at)}</td></tr>
      <tr><th>Result window per match</th><td>${t.result_window_minutes} minutes</td></tr>
    </tbody></table>
    ${t.rules_text ? `<h2>Host rules</h2><p class="meta">${esc(t.rules_text)}</p>` : ''}
    ${matches.length ? `<h2>Bracket</h2><table><thead><tr><th>Round</th><th>Match</th><th>Players</th><th>Result</th></tr></thead><tbody>${matches.map((m) => `<tr><td>${m.match_round}</td><td>${m.match_number}</td><td>${esc(m.p1 ?? 'TBD')} vs ${esc(m.p2 ?? 'TBD')}</td><td>${m.winner ? `${esc(m.winner)} won` : esc(m.status.replace('_', ' '))}</td></tr>`).join('')}</tbody></table>` : ''}
    <h2>How entry works</h2>
    <ol class="steps">
      <li>Open the cup in the app and enter your ${esc(g.name)} in-game ID.</li>
      <li>Approve the ${ghs(t.entry_fee_pesewas)} Mobile Money prompt on your phone. Your seat is held for 10 minutes while you pay.</li>
      <li>When ${t.max_players} players have paid, the bracket is drawn and you get your round 1 opponent.</li>
      <li>Agree a match time with your opponent, play, and submit a screenshot of the final score.</li>
    </ol>
    <p class="meta">If the lobby does not fill, every paid entry is refunded in full. See the <a href="/refunds">refund policy</a> and <a href="/rules">fair play rules</a>.</p>`;
  html(res, page({
    title: `${t.title}: ${g.name} tournament`,
    description: `${g.name} 1v1 tournament for ${t.max_players} players. Entry ${ghs(t.entry_fee_pesewas)}, champion wins ${ghs(split.first)}, runner-up ${ghs(split.runnerup)}. Paid to Mobile Money.`,
    path: `/tournaments/${t.id}`,
    h1: esc(t.title),
    crumbs: [HOME_CRUMB, { href: '/tournaments', label: 'Tournaments' }, { href: `/tournaments/${t.id}`, label: t.title }],
    body, schema: [eventSchema(t)], ogType: 'article',
  }));
}));

siteRouter.get('/tournaments.rss', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`${TOURNAMENT_SQL} WHERE t.status = 'open' AND t.closes_at > now() ORDER BY t.created_at DESC LIMIT 30`);
  const items = rows.map((t) => `<item><title>${esc(t.title)}</title><link>${abs(`/tournaments/${t.id}`)}</link><guid>${abs(`/tournaments/${t.id}`)}</guid><pubDate>${new Date(t.created_at).toUTCString()}</pubDate><description>${esc(`${GAMES[t.game].name}, entry ${ghs(t.entry_fee_pesewas)}, ${t.max_players} players`)}</description></item>`).join('');
  res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>ClashGH open tournaments</title><link>${SITE.origin}/tournaments</link><description>New paid mobile game tournaments in Ghana</description>${items}</channel></rss>`);
}));

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------
siteRouter.get('/games', (req, res) => {
  const body = `<div class="grid">${Object.values(GAMES).map((g) => `<article class="card"><span class="bar" aria-hidden="true"></span><h3><a href="/games/${g.slug}">${esc(g.name)}</a></h3><p class="meta">${esc(g.blurb)}</p></article>`).join('')}</div>
    <h2>Want another game?</h2><p class="meta">Tell us which title your community plays: <a href="/contact">contact ClashGH</a>.</p>`;
  html(res, page({
    title: 'Supported games',
    description: 'ClashGH runs 1v1 tournaments for eFootball, FC Mobile, Call of Duty: Mobile and Dream League Soccer on Android and iOS.',
    path: '/games', h1: 'Supported games',
    lead: 'Four titles, all playable on an ordinary Android phone.',
    crumbs: [HOME_CRUMB, { href: '/games', label: 'Games' }], body,
  }));
});

siteRouter.get('/games/:slug', asyncHandler(async (req, res, next) => {
  const key = slugToGame[req.params.slug];
  if (!key) return next();
  const g = GAMES[key];
  const { rows } = await pool.query(`${TOURNAMENT_SQL} WHERE t.game = $1 AND t.status IN ('open','full','in_progress') ORDER BY t.closes_at ASC LIMIT 30`, [key]);
  const body = `
    <p class="meta">Publisher: ${esc(g.publisher)}. ${esc(g.name)} is a trademark of its publisher; ClashGH is an independent tournament organiser and is not affiliated with or endorsed by ${esc(g.publisher)}.</p>
    <h2>${esc(g.name)} tournaments</h2>
    ${rows.length ? `<div class="grid">${rows.map(tournamentCard).join('')}</div>` : `<p class="meta">No ${esc(g.name)} lobbies are open right now. <a href="/tournaments">See all tournaments</a> or <a href="/hosts">host one</a>.</p>`}
    <h2>Match format</h2>
    <p class="meta">${esc(g.blurb)} Both players receive a six-character room code in the match room when the match starts, plus each other's in-game ID. The final score screenshot is the proof of result.</p>
    <p class="meta"><a href="/how-it-works">How a tournament works</a> · <a href="/rules">Fair play rules</a></p>`;
  html(res, page({
    title: `${g.name} tournaments in Ghana`,
    description: `Paid 1v1 ${g.name} tournaments with Mobile Money entry and MoMo payouts. Fixed prizes, screenshot-verified results, human dispute review.`,
    path: `/games/${g.slug}`, h1: `${esc(g.name)} tournaments`,
    crumbs: [HOME_CRUMB, { href: '/games', label: 'Games' }, { href: `/games/${g.slug}`, label: g.name }], body,
  }));
}));

// ---------------------------------------------------------------------------
// Static content pages
// ---------------------------------------------------------------------------
const faqItems = [
  ['Is this betting?', 'No. You pay a fixed entry fee to compete in a skill-based bracket with published prizes. There are no odds, no stakes between players and no way to win more than the listed prize.'],
  ['How do I pay?', 'With MTN Mobile Money, Telecel Cash or AirtelTigo Money through Paystack. A prompt appears on your phone; enter your PIN to approve. Card payments are not used.'],
  ['How and when do I get paid?', 'The champion and runner-up prizes are sent automatically to the Mobile Money number on your account minutes after the final is settled. Failed transfers are retried and a human is alerted.'],
  ['What if the lobby does not fill?', 'Every paid entry is refunded in full to the number that paid.'],
  ['What if my opponent does not show up?', 'You and your opponent agree a match time. One reschedule per match is allowed. After that, if your opponent misses the time, submit a screenshot of the empty lobby with the pick "I won" and the deadline rule settles the match in your favour.'],
  ['What if we disagree on the score?', 'Both screenshots go to an admin who awards the match, orders a replay, or in serious cases cancels the tournament with full refunds. Nothing is paid out until the dispute is resolved.'],
  ['Can I change my Mobile Money number?', 'The number is locked once set because it is both how you pay and how you get paid. Contact support with proof of ownership if it must change.'],
  ['How old do I have to be?', '18 or older. Accounts found to belong to minors are closed and paid fees refunded.'],
  ['Do I need to download an app?', 'No. ClashGH runs in your phone browser at clashgh.app. Sign in, join a cup and play. On Android you can add it to your home screen from the browser menu so it opens like an app. A Play Store app will come later.'],
  ['Can I run my own tournaments?', 'Yes. Verified players can apply to become a host, set their own entry fee and prizes within the platform limits, and earn a share of the fees. See the hosting page.'],
];
const faqSchema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqItems.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };

siteRouter.get('/faq', (req, res) => {
  html(res, page({
    title: 'Frequently asked questions',
    description: 'Answers about paying with Mobile Money, prizes and payouts, refunds, no-shows, score disputes and hosting your own tournament on ClashGH.',
    path: '/faq', h1: 'Frequently asked questions',
    crumbs: [HOME_CRUMB, { href: '/faq', label: 'FAQ' }],
    body: `<dl class="faq">${faqItems.map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join('')}</dl><p class="meta" style="margin-top:24px">Something else? <a href="/contact">Contact support</a>.</p>`,
    schema: [faqSchema],
  }));
});

siteRouter.get('/how-it-works', (req, res) => {
  const steps = [
    ['Sign in and add your Mobile Money number', 'Sign in with Google or an email link. Add the MoMo number that will pay and receive. It is verified by the first payment.'],
    ['Pick a tournament', 'Every cup lists the game, the entry fee, the lobby size and both prizes. Nothing is hidden.'],
    ['Pay the entry fee', 'Approve the Mobile Money prompt. Your seat is held for 10 minutes while you pay. Money sits in ClashGH escrow, not with the host.'],
    ['The bracket is drawn', 'When the lobby fills, a single-elimination bracket is generated and you see your round 1 opponent.'],
    ['Agree a time and play', 'You and your opponent agree a time inside a 24-hour window. At that time the match room shows a room code and both in-game IDs.'],
    ['Submit the result', 'Both players submit a screenshot of the final score and pick won or lost. When the picks agree the match settles at once.'],
    ['Get paid', 'After the final, the champion and runner-up prizes are transferred to their Mobile Money numbers automatically.'],
  ];
  const schema = { '@context': 'https://schema.org', '@type': 'HowTo', name: 'How to enter and win a ClashGH tournament', step: steps.map(([name, text], i) => ({ '@type': 'HowToStep', position: i + 1, name, text })) };
  html(res, page({
    title: 'How it works',
    description: 'From Mobile Money entry to MoMo payout in seven steps: pick a cup, pay, get your bracket, agree a match time, play, submit a screenshot, get paid.',
    path: '/how-it-works', h1: 'How a ClashGH tournament works',
    lead: 'Seven steps from entry to payout.',
    crumbs: [HOME_CRUMB, { href: '/how-it-works', label: 'How it works' }],
    body: `<ol class="steps">${steps.map(([n, t]) => `<li><strong>${esc(n)}.</strong> <span class="meta">${esc(t)}</span></li>`).join('')}</ol>
      <div class="notice">If the lobby never fills, or a dispute cannot be resolved fairly, every paid entry is refunded in full. Read the <a href="/refunds">refund policy</a>.</div>
      <p style="margin-top:20px"><a class="cta" href="/app">Open the app</a> &nbsp; <a href="/tournaments">Browse tournaments</a></p>`,
    schema: [schema],
  }));
});

siteRouter.get('/hosts', (req, res) => {
  const cap = env.hostCutMaxPercent; const share = 100 - env.hostCommissionPercent;
  html(res, page({
    title: 'Host a tournament',
    description: `Run paid tournaments for your community on ClashGH. Set the entry fee and prizes, keep up to ${cap}% as your cut, get paid to Mobile Money automatically.`,
    path: '/hosts', h1: 'Host tournaments for your community',
    lead: 'ClashGH handles payments, brackets, results and payouts. You bring the players.',
    crumbs: [HOME_CRUMB, { href: '/hosts', label: 'Host a cup' }],
    body: `
      <h2>How hosting works</h2>
      <ol class="steps">
        <li>Apply from the Account screen in the app. Applications are reviewed within 24 hours.</li>
        <li>Publish a cup: choose the game, entry fee (minimum ${ghs(env.hostMinEntryPesewas)}), lobby size (4 to 64) and prize split.</li>
        <li>Players pay into ClashGH escrow. You never handle their money.</li>
        <li>After the final, your share is sent to your Mobile Money number alongside the prizes.</li>
      </ol>
      <h2>Money</h2>
      <p class="meta">Players must receive at least ${100 - cap}% of the fees as prizes. The remainder is your cut, split ${share}/${100 - share} between you and ClashGH. Example: 16 players at ₵20 with a 70/10/20 split collects ₵320; the champion gets ₵224, the runner-up ₵32, you ₵32 and ClashGH ₵32.</p>
      <h2>What hosts can and cannot do</h2>
      <p class="meta">Hosts create and cancel their own cups (cancelling refunds every paid player). Disputes, payouts and refunds stay automated or with ClashGH admins, so players get the same protection in every cup.</p>
      <p><a class="cta" href="/app">Apply in the app</a></p>`,
  }));
});

siteRouter.get('/rules', (req, res) => {
  html(res, page({
    title: 'Fair play rules',
    description: 'ClashGH fair play rules: one account per person, screenshot proof, no modded clients, deadlines, disputes, walkovers and bans.',
    path: '/rules', h1: 'Fair play rules',
    crumbs: [HOME_CRUMB, { href: '/rules', label: 'Fair play rules' }],
    body: `
      <ol class="steps">
        <li><strong>One account per person.</strong> One Mobile Money number, one account. Duplicate accounts are banned and pending prizes withheld.</li>
        <li><strong>Play your own matches.</strong> Account sharing or letting someone else play for you is a ban.</li>
        <li><strong>Unmodified games only.</strong> Modded clients, emulator advantages where the game forbids them, or exploits result in forfeit and a ban.</li>
        <li><strong>Screenshots are proof.</strong> Submit the final score screen from the game. Edited screenshots are a permanent ban.</li>
        <li><strong>Agree a time and keep it.</strong> Each match must be played within its 24-hour window. One reschedule per match. Missing the agreed time is a walkover for the present player.</li>
        <li><strong>Result window.</strong> Submit your result within the tournament's result window after the match starts. One "won" pick with no reply from the opponent stands at the deadline.</li>
        <li><strong>Disputes.</strong> Disagreements are reviewed by an admin using both screenshots. The admin's decision is final. False claims lead to a ban.</li>
        <li><strong>Respect.</strong> Abuse of opponents, hosts or staff, in the app or on WhatsApp, leads to removal.</li>
      </ol>
      <p class="meta">Related: <a href="/refunds">refund policy</a>, <a href="/terms">terms of service</a>.</p>`,
  }));
});

siteRouter.get('/refunds', (req, res) => {
  html(res, page({
    title: 'Refund policy',
    description: 'When ClashGH refunds an entry fee: lobby did not fill, tournament cancelled, late payment, unresolved dispute. Refunds go to the Mobile Money number that paid.',
    path: '/refunds', h1: 'Refund policy',
    crumbs: [HOME_CRUMB, { href: '/refunds', label: 'Refund policy' }],
    body: `
      <h2>You are refunded in full when</h2>
      <ol class="steps">
        <li>The lobby does not fill before registration closes.</li>
        <li>The tournament is cancelled by ClashGH or the host before it starts.</li>
        <li>An admin resolves a dispute by cancelling the tournament.</li>
        <li>Your payment arrives after your 10-minute seat hold expired or after the lobby filled. The money is returned automatically and no seat is given.</li>
      </ol>
      <h2>No refund when</h2>
      <p class="meta">You paid and the bracket was drawn, then you chose not to play, missed your agreed time, or were removed for breaking the <a href="/rules">fair play rules</a>.</p>
      <h2>How refunds are paid</h2>
      <p class="meta">To the Mobile Money number that paid, usually within minutes. If a transfer fails it is retried automatically and support is alerted. Questions: <a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a>.</p>`,
  }));
});

siteRouter.get('/terms', (req, res) => {
  html(res, page({
    title: 'Terms of service',
    description: 'Terms for using ClashGH: eligibility, entry fees and prizes, conduct, account closure, liability and governing law (Ghana).',
    path: '/terms', h1: 'Terms of service',
    crumbs: [HOME_CRUMB, { href: '/terms', label: 'Terms of service' }],
    body: `
      <p class="meta">Last updated 16 September 2026. These terms are a contract between you and ${esc(SITE.legalName)} ("ClashGH", "we").</p>
      <h2>1. What ClashGH is</h2><p class="meta">ClashGH organises skill-based video game tournaments with a fixed entry fee and fixed, published prizes. It is not a betting, lottery or gambling service. Outcomes depend on players' skill in the game.</p>
      <h2>2. Eligibility</h2><p class="meta">You must be 18 or older, resident in Ghana, and the owner of the Mobile Money number on your account. One account per person.</p>
      <h2>3. Entry fees and prizes</h2><p class="meta">Fees and prizes are shown before you join and are fixed when the bracket is drawn. Fees are held in escrow until the tournament ends or is cancelled. Prizes are paid to the Mobile Money number on your account. Refunds follow the <a href="/refunds">refund policy</a>.</p>
      <h2>4. Conduct</h2><p class="meta">You agree to the <a href="/rules">fair play rules</a>. We may forfeit matches, withhold prizes obtained by cheating, and close accounts that break the rules.</p>
      <h2>5. Community hosts</h2><p class="meta">Hosts publish tournaments under these terms and the hosting rules. ClashGH holds all player money; hosts receive their share only after the final is settled.</p>
      <h2>6. Availability and liability</h2><p class="meta">Games are owned by their publishers; server outages, bans or changes on their side are outside our control. If a tournament cannot be completed fairly, we cancel and refund. Our liability to you is limited to the entry fees you paid for the affected tournament.</p>
      <h2>7. Changes and termination</h2><p class="meta">We may update these terms; continued use after an update is acceptance. You may close your account at any time once you have no active tournament.</p>
      <h2>8. Law</h2><p class="meta">These terms are governed by the laws of the Republic of Ghana. Disputes are subject to the courts of Accra.</p>
      <p class="meta">Contact: <a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a>.</p>`,
  }));
});

siteRouter.get('/privacy', (req, res) => {
  html(res, page({
    title: 'Privacy policy',
    description: 'What ClashGH collects (email, username, Mobile Money number, in-game IDs, score screenshots), why, who processes it, and your rights under Ghana law.',
    path: '/privacy', h1: 'Privacy policy',
    crumbs: [HOME_CRUMB, { href: '/privacy', label: 'Privacy policy' }],
    body: `
      <p class="meta">Last updated 16 September 2026. Data controller: ${esc(SITE.legalName)}, ${esc(SITE.city)}, Ghana. Contact: <a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a>.</p>
      <h2>What we collect</h2>
      <table><tbody>
        <tr><th>Email address, Google account ID</th><td>Sign-in and receipts</td></tr>
        <tr><th>Username</th><td>Shown to opponents and on brackets</td></tr>
        <tr><th>Mobile Money number and network</th><td>Collecting entry fees and paying prizes and refunds</td></tr>
        <tr><th>Optional contact number</th><td>Shown only to your current opponent while a match is open, so you can agree a time</td></tr>
        <tr><th>In-game IDs</th><td>Shown to your opponent so you can find each other in the game</td></tr>
        <tr><th>Score screenshots</th><td>Proof of results; kept ${env.screenshotRetentionDays} days, then deleted</td></tr>
        <tr><th>Transaction records</th><td>Legal and accounting obligations; kept as long as required by law</td></tr>
        <tr><th>Push token, device type</th><td>Match and payout notifications, if you enable them</td></tr>
      </tbody></table>
      <h2>Who processes it</h2>
      <p class="meta">Paystack (payments, Nigeria and Ghana), Supabase (authentication and database, EU region), Render (hosting, EU region), Cloudinary (screenshots), Resend (email), Expo (push notifications). Each acts under contract and only for the purpose listed.</p>
      <h2>What we never do</h2>
      <p class="meta">We do not sell your data, show ads, or share your Mobile Money number with other players or hosts.</p>
      <h2>Your rights</h2>
      <p class="meta">Under Ghana's Data Protection Act, 2012 (Act 843) you may ask for a copy of your data, correct it, or have your account deleted once you have no active tournament or pending payout. Email <a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a>.</p>
      <h2>Cookies</h2>
      <p class="meta">The website sets no tracking cookies. The app stores your session token on your device only.</p>`,
  }));
});

siteRouter.get('/about', (req, res) => {
  html(res, page({
    title: 'About',
    description: 'ClashGH is an Accra-based organiser of paid 1v1 mobile game tournaments built around Mobile Money, fair results and fast payouts.',
    path: '/about', h1: 'About ClashGH',
    crumbs: [HOME_CRUMB, { href: '/about', label: 'About' }],
    body: `
      <p class="meta">ClashGH is built in ${esc(SITE.city)} for players who compete in eFootball, FC Mobile, CODM and DLS on ordinary Android phones. Most competitive mobile gaming in Ghana runs on WhatsApp groups and trust; prizes go missing and disputes turn into arguments. ClashGH replaces that with escrow, brackets, screenshot-verified results and automatic Mobile Money payouts.</p>
      <h2>Principles</h2>
      <ol class="steps">
        <li>Money is never touched by a person. Fees go into escrow and prizes are paid by the system.</li>
        <li>Every number is public before you pay: entry fee, lobby size, both prizes, platform fee.</li>
        <li>Low data, low-end phones first. It runs in the browser, loads in under 300 KB and works on a 2 GB device.</li>
        <li>Skill only. No odds, no wagers, no side bets.</li>
      </ol>
      <h2>Company</h2>
      <p class="meta">${esc(SITE.legalName)}, ${esc(SITE.city)}, ${esc(SITE.region)}, Ghana. <a href="/contact">Contact details</a>.</p>`,
  }));
});

siteRouter.get('/contact', (req, res) => {
  const schema = { '@context': 'https://schema.org', '@type': 'ContactPage', url: abs('/contact'), mainEntity: { '@id': `${SITE.origin}/#organization` } };
  html(res, page({
    title: 'Contact',
    description: 'Contact ClashGH support by email or WhatsApp for payment, payout, dispute or hosting questions. Based in Accra, Ghana.',
    path: '/contact', h1: 'Contact ClashGH',
    crumbs: [HOME_CRUMB, { href: '/contact', label: 'Contact' }],
    body: `
      <table><tbody>
        <tr><th>Email</th><td><a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a></td></tr>
        ${SITE.phone ? `<tr><th>WhatsApp</th><td><a href="${esc(SITE.whatsapp)}" rel="noopener">${esc(SITE.phone)}</a></td></tr>` : ''}
        <tr><th>Location</th><td>${esc(SITE.city)}, ${esc(SITE.region)}, Ghana</td></tr>
        <tr><th>Hours</th><td>Support answers within 24 hours, seven days a week. Payment and payout systems run automatically around the clock.</td></tr>
      </tbody></table>
      <h2>Before you write</h2>
      <p class="meta">Payout or refund not arrived: check the Wallet screen in the app; failed transfers are retried automatically. Score dispute: it is already in the admin queue if the match shows "Under review". Hosting: read the <a href="/hosts">hosting page</a> first.</p>`,
    schema: [schema],
  }));
});

// ---------------------------------------------------------------------------
// Machine files
// ---------------------------------------------------------------------------
siteRouter.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *
Allow: /
Disallow: /app/
Disallow: /api/
Disallow: /uploads-dev/

Sitemap: ${SITE.origin}/sitemap.xml
`);
});

siteRouter.get('/sitemap.xml', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`SELECT id, updated_at, status FROM public.tournaments WHERE status <> 'cancelled' ORDER BY created_at DESC LIMIT 5000`);
  const fixed = ['/', '/tournaments', '/how-it-works', '/games', ...Object.values(GAMES).map((g) => `/games/${g.slug}`), '/hosts', '/faq', '/rules', '/refunds', '/terms', '/privacy', '/about', '/contact'];
  const url = (loc, lastmod, freq, pri) => `<url><loc>${esc(abs(loc))}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}<changefreq>${freq}</changefreq><priority>${pri}</priority></url>`;
  const body = [
    ...fixed.map((p) => url(p, null, p === '/' || p === '/tournaments' ? 'hourly' : 'weekly', p === '/' ? '1.0' : p === '/tournaments' ? '0.9' : '0.6')),
    ...rows.map((t) => url(`/tournaments/${t.id}`, t.updated_at, t.status === 'completed' ? 'monthly' : 'hourly', t.status === 'open' ? '0.8' : '0.4')),
  ].join('');
  res.type('application/xml').set('Cache-Control', 'public, max-age=600').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`);
}));

siteRouter.get('/llms.txt', (req, res) => {
  res.type('text/plain; charset=utf-8').send(`# ClashGH

> ${SITE.description}

ClashGH (${SITE.origin}) is operated by ${SITE.legalName} in ${SITE.city}, Ghana. It runs skill-based 1v1 single-elimination tournaments for eFootball, FC Mobile, Call of Duty: Mobile and Dream League Soccer. Entry fees are paid with Mobile Money (MTN, Telecel, AirtelTigo) through Paystack and held in escrow; the champion and runner-up prizes are paid automatically to Mobile Money. It is not betting: fees and prizes are fixed and published before entry, and there are no odds or wagers between players. Players must be 18 or older.

## Key pages
- [Tournaments](${SITE.origin}/tournaments): open, live and completed cups with fees and prizes
- [How it works](${SITE.origin}/how-it-works): the seven steps from entry to payout
- [Games](${SITE.origin}/games): supported titles and match formats
- [Host a cup](${SITE.origin}/hosts): community hosting, revenue share and limits
- [FAQ](${SITE.origin}/faq)
- [Fair play rules](${SITE.origin}/rules)
- [Refund policy](${SITE.origin}/refunds)
- [Terms](${SITE.origin}/terms) and [Privacy](${SITE.origin}/privacy)
- [Contact](${SITE.origin}/contact): ${SITE.email}

## Facts
- Entry fees from ₵5 (hosted) or ₵10 (official); lobbies of 4 to 64 players
- Default split: 70% champion, 20% runner-up, 10% platform; hosted cups give players at least ${100 - env.hostCutMaxPercent}%
- Matches are scheduled by the two players inside a 24-hour window; one reschedule per match
- Results need a final-score screenshot from both players; disagreements are reviewed by a human
- Unfilled lobbies and cancelled tournaments are refunded in full
- Player app: ${SITE.origin}/app (requires sign-in; not intended for crawling)
`);
});

siteRouter.get('/humans.txt', (req, res) => {
  res.type('text/plain').send(`/* TEAM */\n${SITE.legalName}, ${SITE.city}, Ghana\nContact: ${SITE.email}\n\n/* SITE */\nStandards: HTML5, schema.org JSON-LD\nStack: Node.js, Express, PostgreSQL, React Native (Expo)\n`);
});

// Android App Links: lets https://clashgh.app/app/... open the installed app.
// ANDROID_SHA256_FINGERPRINTS = comma separated SHA-256 fingerprints of the
// signing keys (EAS: `eas credentials -p android`, plus the Play App Signing key).
siteRouter.get('/.well-known/assetlinks.json', (req, res) => {
  const prints = env.androidSha256Fingerprints;
  res.set('Cache-Control', 'public, max-age=3600');
  if (prints.length === 0) return res.json([]);
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: env.androidPackage, sha256_cert_fingerprints: prints },
  }]);
});

siteRouter.get('/.well-known/security.txt', (req, res) => {
  res.type('text/plain').send(`Contact: mailto:${SITE.email}\nPreferred-Languages: en\nCanonical: ${SITE.origin}/.well-known/security.txt\nExpires: ${new Date(Date.now() + 365 * 86400e3).toISOString()}\n`);
});

/** 404 page for anything under the public site (not /api, not /app). */
export function notFoundPage() {
  return page({
    title: 'Page not found',
    description: 'That page does not exist on ClashGH. Find open tournaments, learn how it works, or open the player app.',
    path: '/404', h1: 'Page not found', noindex: true,
    body: `<div class="err"><p>The address may be mistyped, or the tournament may have been removed.</p>
      <p><a class="cta" href="/tournaments">See open tournaments</a> &nbsp; <a class="cta secondary" href="/">Go to the home page</a></p>
      <p class="meta" style="margin-top:20px">Looking for the player app? <a href="/app">Open the app</a>. Need help? <a href="/contact">Contact support</a>.</p></div>`,
  });
}
