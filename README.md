# Wayhome

A private, India-first journey planner for trains, flights, buses and shared rides, including trips that change between services. It was built for one owner's travel (originally Gurugram to Jamalpur in Bihar) and covers 31 pilot cities.

## Status

**What works today**

- The search form: cities (searchable by name or station/airport code), date with ±1–2 days of flexibility, travellers, modes, depth and preferences.
- The search plan: the bounded list of [provider queries](#glossary) a search would send, shared across the chosen dates and sources, with a downloadable JSON audit.
- A route engine for journeys of up to five services, with connection times, seat and fare freshness, and a fare cap. It is tested with fixtures and randomized data only; no live data feeds it yet.
- "Recheck site access", which reports the connected apps that [Sites](#glossary) makes available to this site.

**What is not built: live results.** There are no provider adapters, scheduler or consent handling yet. Their design cannot be finished until Sites shows which travel apps this site may use: ConfirmTkt (trains), Skyscanner (flights) and BlaBlaCar (buses and carpools). Until then every search returns its plan (HTTP 200) with `status: "blocked"` and zero queries attempted. That means "not connected", never "sold out". This release has no current fares or seats, and the page never substitutes test data or saved research for live results.

See [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for the design and remaining work, and [docs/VERIFICATION.md](docs/VERIFICATION.md) for what has been checked.

## Run locally

Requires Node.js 22.13 or newer.

```sh
npm ci
npm run dev    # then open http://localhost:5173
```

Locally there is no real sign-in (the dev server uses a mock identity), and every search shows its plan with "Live search pending". That is expected.

## Checks

```sh
npm test       # planner, engine and API tests, plus randomized property tests with fixed seeds
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run lint
npm run build
```

## Deployment and security

This checkout is managed by Sites. Use its installation, preview, build and source-packaging helpers, and keep the starter's framework scripts and lockfile. Production runs as a Cloudflare Worker from the provided entrypoint and hosting manifest (`.openai/hosting.json`, which holds the project identifier, not credentials; the copy in the public repository has it set to null). No database or provider secrets are configured.

The site is owner-private. Sites signs visitors in with ChatGPT and passes their identity to the app in the `oai-authenticated-user-id` header. The API routes also reject requests without that header, and searches sent from another origin.

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
