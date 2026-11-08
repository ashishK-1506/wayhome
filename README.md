# Wayhome

A private, India-first journey planner for trains, flights, buses and shared rides, including trips that change between services. It was built for one owner's travel (originally Gurugram to Jamalpur in Bihar) and covers 31 pilot cities.

## Status

**What works today**

- The search form: cities (searchable by name or station/airport code), date with ±1–2 days of flexibility, travellers, modes, depth and preferences.
- The search plan: the bounded list of [provider queries](#glossary) a search would send, shared across the chosen dates and sources, with a downloadable JSON audit.
- A route engine for journeys of up to five services, with connection times, seat and fare freshness, and a fare cap. It is tested with fixtures and randomized data.
- Optional live trains: with an irctc.dev API key, a search checks real trains, seats and fares for a few of its planned routes. See [Live trains](#live-trains-optional).
- "Recheck site access", which reports the connected apps that [Sites](#glossary) makes available to this site.

**What is not built: live flights, buses and carpools, and the connected travel apps.** There are no adapters for ConfirmTkt, Skyscanner or BlaBlaCar through Sites; their design cannot be finished until Sites shows which travel apps this site may use. Without the train key, every search returns its plan (HTTP 200) with `status: "blocked"` and zero queries attempted. That means "not connected", never "sold out". The page never substitutes test data or saved research for live results.

See [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for the design and remaining work, and [docs/VERIFICATION.md](docs/VERIFICATION.md) for what has been checked.

## Run locally

Requires Node.js 22.13 or newer.

```sh
npm ci
npm run dev    # then open http://localhost:5173
```

Locally there is no real sign-in (the dev server uses a mock identity), and without the train key every search shows its plan with "Live search pending". That is expected.

## Live trains (optional)

Live train results come from [irctc.dev](https://irctc.dev), an unofficial Indian Railways data service. They stay off until a key is set.

1. Sign in at irctc.dev with Google and copy your API key. The free allowance is 10,000 requests.
2. Set the variables below in `.env.local` for local use (git ignores it; both `npm run dev` and the Vercel build read it), and under Settings → Environment Variables on Vercel.
3. Search with Trains selected, after entering the passcode once under Search preferences.

| Variable | Value |
|---|---|
| `IRCTC_DEV_API_KEY` | Your irctc.dev key. Never commit it. |
| `WAYHOME_LIVE_PASSCODE` | Any phrase. When set, only searches that send it run live and everyone else gets the plan, so visitors cannot use up the quota. Recommended on a public site. |

What a live search does:

- **Searches.** It runs every planned direct train search on the chosen date, plus one change at the first hub the plan links both ways, from up to three origin stations: at most 11 searches.
- **Fares and seats.** It looks up fares for at most 6 trains; the fare answer also shows which classes a train has. It then checks seats in 3A and SL where the train has them, or otherwise in its main class, such as chair car. There are at most 8 seat checks, because irctc.dev allows 10 a minute.
- **Calls.** That is up to 25 calls, four at a time, each limited to 8 seconds and the whole search to 20.
- **Labels.** Each offer names its source and links to the ConfirmTkt search for that route and date. Its check time is when irctc.dev last refreshed the answer, which can be several minutes old because irctc.dev caches.
- **Availability.** As with any source, a train counts as available only with a seat count from the last two minutes. Waitlist, RAC and closed bookings are shown with irctc.dev's own codes, such as `GNWL12/WL5` or `REGRET` ("booking closed").
- **No caching.** Nothing is cached here: irctc.dev's terms allow caching only for performance, not to reduce usage.
- **Failures.** If irctc.dev rejects the key, runs out of quota, refuses checks over its per-minute limit or does not answer, the search still returns its plan, with the reason.

irctc.dev states that it is not an official source, so recheck with IRCTC or ConfirmTkt before paying. Flights (planned through SerpApi's Google Flights search), buses and carpools are not live yet.

## Checks

```sh
npm test       # planner, engine and API tests, plus randomized property tests with fixed seeds
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run lint
npm run build
npx next build # the build Vercel runs; see "Vercel (public demo)" below
```

## Deployment and security

This checkout is managed by Sites. Use its installation, preview, build and source-packaging helpers, and keep the starter's framework scripts. The lockfile matches the starter's apart from the Next.js upgrade described under Vercel below. Production runs as a Cloudflare Worker from the provided entrypoint and hosting manifest (`.openai/hosting.json`, which holds the project identifier, not credentials; the copy in the public repository has it set to null). No database or provider secrets are configured.

The site is owner-private. Sites signs visitors in with ChatGPT and passes their identity to the app in the `oai-authenticated-user-id` header. The API routes also reject requests without that header, and searches sent from another origin.

### Vercel (public demo)

The Sites build produces a Cloudflare Worker, which Vercel cannot serve, so `vercel.json` makes Vercel build the app with `next build` instead. Three things differ there:

- **The site is public.** Vercel has no ChatGPT sign-in, so when `VERCEL=1` the API skips the identity check and anyone with the link can use the site. The page says "Public demo" instead of "Your private travel desk". Searches must still come from the site itself (a matching `Origin`).
- **Next.js is the server.** On Sites, Next.js only supplies types and lint rules. On Vercel it runs the site, so `next` is kept at 16.4.5, which fixes the critical advisories in 16.3.4.
- **Visitor counts and speed.** On Vercel the layout adds Vercel Web Analytics (`@vercel/analytics`), which counts page views without cookies, and Speed Insights (`@vercel/speed-insights`), which reports page-load performance. Each must be turned on in the Vercel project. Sites loads neither.

Travel-app connections exist only on Sites, so a Vercel deployment can only show search plans.

## Documentation

- `README.md`: this overview.
- `START_HERE.md`: notes for the downloadable source ZIP.
- `docs/IMPLEMENTATION.md`: design decisions, API and planning contracts, and remaining integration work.
- `docs/VERIFICATION.md`: dated record of checks and their results.

## Glossary

- **Sites**: the ChatGPT site-hosting platform this app runs on. It handles sign-in, private access and connected travel apps ("connectors").
- **Provider query**: one search sent to one travel app for one pair of stations, airports or cities on one date. A query is *proposed* (generated), *planned* (fits within the depth's cap) or *attempted* (actually sent; always zero today).
- **Search plan**: what `POST /api/search` returns: the planned queries plus the dates, hubs and limits behind them.
- **Depth**: Quick (up to 2 services), Thorough (up to 3) or Extended (up to 5).
- **Hub**: an interchange city on the way where a change of service is planned. *Feeder* queries go from the origin to a hub, *onward* queries from a hub to the destination, and *interhub* queries between hubs.
- **Offers on all legs**: every service in a journey has a fresh, bookable offer for the whole party. Waitlist, RAC (a shared-berth reservation) and Tatkal (late quota) tickets that have not opened do not count.
- **EGM review**: a review by a panel of fresh-context reviewers, each covering one angle (code accuracy, design, readiness, scope, comprehension, structure, style).
