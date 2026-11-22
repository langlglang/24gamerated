/**
 * What search engines and link previews see. The app is a single-page React
 * build, so without this every URL would answer with the same empty shell
 * titled "24". Here each public page gets its own title, description,
 * canonical URL and preview tags, plus a little real text inside #root that
 * crawlers can read before any JavaScript runs (React replaces it on load).
 */

export const SITE_URL = (process.env.APP_URL ?? 'https://24game.online').replace(/\/+$/, '');
const SITE_NAME = '24game.online';
const OG_IMAGE = `${SITE_URL}/og.png`;

interface Page {
  title: string;
  description: string;
  /** Kept out of search results (still usable). */
  noindex?: boolean;
  /** Plain HTML shown to crawlers inside #root until the app loads. */
  body?: string;
  /** Listed in sitemap.xml, with its priority. */
  sitemap?: number;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const nav = `<nav><a href="/">Play 24</a> · <a href="/how-to-play">How to play</a> · <a href="/solver">24 solver</a> · <a href="/daily">Daily puzzle</a></nav>`;

const PAGES: Record<string, Page> = {
  '/': {
    title: '24 – Play the 24 math card game online, free',
    description:
      'Four cards, four operations: make exactly 24 before anyone else. Play the 24 math card game free online with friends, in rated 1v1 matches, or in the daily puzzle. No download.',
    sitemap: 1.0,
    body: `<main><h1>Play the 24 math card game online</h1>
<p>Four cards are dealt. Add, subtract, multiply and divide them, using every card once, to make exactly 24. Buzz in first and solve it to win the hand.</p>
<ul><li>Play with friends: share a room link, 2 to 10 players.</li><li>Ranked 1v1 matches with Elo ratings and a leaderboard.</li><li>A new daily puzzle every day.</li><li>Practice on your own, free, in the browser.</li></ul>
${nav}</main>`,
  },
  '/how-to-play': {
    title: 'How to play 24: rules, examples and tips',
    description:
      'The rules of the 24 math card game: use all four numbers once with +, −, × and ÷ to make 24. Worked examples, strategy tips, and how to play online with friends.',
    sitemap: 0.9,
    body: `<main><h1>How to play 24</h1>
<p>You get four numbers (playing cards: Ace is 1, Jack 11, Queen 12, King 13). Combine all four, each exactly once, with addition, subtraction, multiplication and division, to make 24.</p>
<p>Example: 4, 7, 8, 8 → (7 − 8 / 8) × 4 = 24.</p>
<p>Tips: look for 3 × 8, 4 × 6, 2 × 12 and 12 + 12, and build the missing factor from the other two cards.</p>
${nav}</main>`,
  },
  '/solver': {
    title: '24 game solver – every solution for any four numbers',
    description:
      'Enter four numbers and see every way to make 24 with +, −, × and ÷, or find out the hand has no solution. Free 24 card game solver.',
    sitemap: 0.9,
    body: `<main><h1>24 game solver</h1><p>Type four numbers to see every way to make 24 with +, −, × and ÷, or whether the hand can’t be solved.</p>${nav}</main>`,
  },
  '/daily': {
    title: 'Daily 24 puzzle – a new math puzzle every day',
    description:
      'One puzzle a day, the same for everyone: use every card to hit the target. See how your time compares with other players and share your result.',
    sitemap: 0.8,
    body: `<main><h1>Daily 24 puzzle</h1><p>A new puzzle every day at midnight UTC, the same for everyone. Use every card to reach the target and compare your time.</p>${nav}</main>`,
  },
  '/practice': {
    title: 'Practice 24 – solo training mode',
    description: 'Practice the 24 math card game on your own: a full deck of 13 hands with the same clocks as a real match.',
    sitemap: 0.6,
  },
  '/privacy': { title: 'Privacy policy – 24game.online', description: 'What 24game.online collects and why.', sitemap: 0.2 },
  '/terms': { title: 'Terms of use – 24game.online', description: 'The terms for playing 24 on 24game.online.', sitemap: 0.2 },
  '/signin': { title: 'Sign in – 24', description: 'Sign in to play ranked 24.', noindex: true },
  '/ranked': { title: 'Ranked – 24', description: 'Ranked 1v1 matches of 24.', noindex: true },
};

const ROOM: Page = {
  title: 'Join my game of 24',
  description: 'You’re invited to a game of 24: four cards, make 24 first. Tap to join, no download.',
  noindex: true,
};
const NOT_FOUND: Page = { title: 'Page not found – 24', description: 'That page doesn’t exist.', noindex: true };

/** The page for a path, and the HTTP status to send with it. */
export function pageFor(pathname: string): { page: Page; status: number; canonical: string } {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const page = PAGES[clean];
  if (page) return { page, status: 200, canonical: `${SITE_URL}${clean === '/' ? '/' : clean}` };
  if (/^\/room\/[^/]*$/.test(clean)) return { page: ROOM, status: 200, canonical: `${SITE_URL}/` };
  return { page: NOT_FOUND, status: 404, canonical: `${SITE_URL}/` };
}

const STRUCTURED_DATA = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': ['VideoGame', 'WebApplication'],
  name: '24',
  url: `${SITE_URL}/`,
  description: PAGES['/']!.description,
  applicationCategory: 'GameApplication',
  genre: ['Puzzle', 'Math', 'Card game'],
  gamePlatform: 'Web browser',
  operatingSystem: 'Any',
  playMode: ['SinglePlayer', 'MultiPlayer'],
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  image: OG_IMAGE,
}).replace(/</g, '\\u003c');

/** index.html with this page's head tags and crawler text filled in. */
export function renderIndex(template: string, pathname: string): { html: string; status: number } {
  const { page, status, canonical } = pageFor(pathname);
  const head = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    page.noindex ? '<meta name="robots" content="noindex" />' : `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="Four playing cards and the words Make 24" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    pathname === '/' ? `<script type="application/ld+json">${STRUCTURED_DATA}</script>` : '',
  ]
    .filter(Boolean)
    .join('\n    ');
  let html = template.replace(/<title>[^<]*<\/title>/, head);
  if (page.body) html = html.replace('<div id="root"></div>', `<div id="root">${page.body}</div>`);
  return { html, status };
}

export function robotsTxt(): string {
  return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

export function sitemapXml(): string {
  const urls = Object.entries(PAGES)
    .filter(([, p]) => p.sitemap !== undefined)
    .map(
      ([path, p]) =>
        `  <url><loc>${SITE_URL}${path}</loc><priority>${p.sitemap!.toFixed(1)}</priority></url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
