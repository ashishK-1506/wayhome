# Wayhome implementation record

Created 4 November 2026; last updated 8 November 2026. This is the design record: what was built, the contracts it follows and what remains. Dated test results are in [VERIFICATION.md](VERIFICATION.md), and terms are defined in the [README glossary](../README.md#glossary).

## Decision

The owner chose to get live results from the travel apps available in ChatGPT, connected to this site through Sites: ConfirmTkt for trains, Skyscanner for flights and BlaBlaCar for buses and carpools ("connected travel apps", option 2 of the original proposal). No fallback, such as provider API keys or links to provider search pages, has been chosen, and none will be added without the owner's decision.

On 8 November 2026, while Sites access is pending, the owner also chose unofficial data services, used with the owner's own keys: irctc.dev for trains, built now, and SerpApi's Google Flights search for flights, waiting for its account verification. These are optional and off without a key. The owner declined rotating several free accounts to raise limits, because the providers treat that as abuse.

## Current delivery boundary

The app is a private Sites Worker app built on the supplied Vinext/React starter. It has an interactive search form, bounded query planning, a normalized itinerary evaluator and an exportable audit. It has **not** completed the connected-travel-app integration; the optional live trains described below are an interim, unofficial source. Sites plugin-eligibility discovery was not available when this was built, so no provider-specific connector IDs, hosted action mappings or consent paths have been verified. Travel-app tools available inside a ChatGPT conversation do not prove that this website can use them. No snapshots have been substituted for live results.

The search API returns the prepared plan with HTTP 200, `status: blocked`, `coverage: not_started`, zero attempted queries and empty inventory. Clients must read `status`: `blocked` means the integration is not set up; it is never evidence that tickets are sold out. (Until 5 November 2026 this response used HTTP 503, which browsers and tools showed as a failed request.) Provider cards show a fixed pending setup state, not live provider health. "Recheck site access" shows what Sites reports about this site's connected apps (site policy and action names); it does not test sign-in or query inventory. There is no scheduler, consent flow, cache or inventory store, and no adapter for the connected travel apps. These are unfinished integration work, not features that merely need a user login.

**Live trains (optional).** With `IRCTC_DEV_API_KEY` set, a search that includes trains and passes the passcode check (`WAYHOME_LIVE_PASSCODE`, sent as the `x-wayhome-passcode` header; skipped on the local dev server, like the identity check) runs a small part of its plan against irctc.dev and returns `status: live`. `lib/live/trains.mjs` picks at most 11 planned train searches: every direct search on the chosen date, then one change at the first hub the plan links both ways. For that change it searches from up to three origin stations to the hub that day, and from the hub to the destination that day or the next.

It then chooses at most 6 trains to check: the fastest direct trains, plus the feeder and onward pair with the earliest arrival that leaves at least an hour to change. For each of these it first looks up fares; the fare answer is the only reliable list of a train's classes, since the search's class list comes back empty. Seats are then checked in 3A and SL where the train has them, or otherwise in its first class from 3E, CC, 2S, 2A, EC and 1A. Each train gets one class checked before any gets a second, with at most 8 seat checks, because irctc.dev allows 10 a minute.

Calls run four at a time, each limited to 8 seconds and the whole search to 20. Nothing is cached, and failed calls are logged on the server by reason.

`lib/live/irctc-dev.mjs` converts answers into the engine's services and offers:
- It keeps a train only when its stations match the query and its arrival clock time agrees with departure plus duration.
- Running days count from the train's first station, so they are shifted by `fromStationDayOffset` before checking the boarding date.
- Only "AVAILABLE-n" answers carry a seat count. Every offer keeps irctc.dev's own status text, such as `GNWL135/WL62`, and the page shows `REGRET` as "booking closed".
- An offer's check time is irctc.dev's `syncedAt` (never later than now). Its cache can serve answers several minutes old, and the engine's two-minute freshness limit then stops them counting as available.
- Every offer names `irctc.dev` and links to the ConfirmTkt search for that route and date.

The response formats were checked against the real API on 8 November 2026 (see VERIFICATION.md).

## Source files

| File | Responsibility |
|---|---|
| `app/page.tsx` | Dynamic entry; passes today's IST date (the form defaults to tomorrow) |
| `app/layout.tsx` | Product metadata, global CSS, and Vercel Web Analytics and Speed Insights when running on Vercel |
| `app/travel-portal.tsx` | City pickers, preferences, request cancellation, plan and audit, provider and site status, journey view |
| `app/globals.css` | Responsive design, keyboard focus, reduced motion, print |
| `app/api/search/route.ts` | Identity and origin guard, body limit, validated plan, explicit blocked result |
| `app/api/capabilities/route.ts` | Identity-guarded provider setup states and the connected apps Sites reports |
| `lib/model.ts` | Shared search, service, offer, transfer, audit and site-status types |
| `lib/catalog.mjs`, `lib/catalog.d.mts` | Curated 31-city pilot: station and airport candidates, approximate coordinates, interchange hubs, ranked city and code search |
| `lib/planner.mjs`, `lib/planner.d.mts` | Input validation, dates, bounded query planning |
| `lib/engine.mjs`, `lib/engine.d.mts` | Service deduplication, connection search, capacity and freshness checks, ranking |
| `lib/provider-status.ts` | Explicit integration block (also the page's initial provider list); no guessed connectors |
| `lib/api-guard.ts` | Hosted identity requirement (skipped on Vercel, which has no sign-in) and same-origin check for searches |
| `lib/live/irctc-dev.mjs`, `lib/live/irctc-dev.d.mts` | irctc.dev client: calls with time limits and failure kinds, and conversion of trains, seats and fares into engine services and offers |
| `lib/live/trains.mjs`, `lib/live/trains.d.mts` | Live-train access check (key and passcode), choice of searches and trains within the call budget, and the live run |
| `tests/planner.test.mjs` | Deterministic planner and engine assertions |
| `tests/api.test.mjs` | The real route handlers: identity, origin, input limits, privacy, site status, internal errors, live-train passcode states and source failures |
| `tests/live.test.mjs` | Live-train conversion, access, budget, journeys from live data, rejected keys, quota and time limits |
| `tests/fixtures/irctc-dev.mjs` | A made-up stand-in for irctc.dev, shaped like its documented answers; no real data |
| `tests/properties.test.mjs` | Randomized property tests with fixed seeds: planner and engine rules, junk input, malformed records, work-limit fairness, booking links |
| `tests/fixtures/connecting-services.mjs` | Controlled fixtures imported only by tests; no current inventory evidence |
| `public/favicon.svg` | Product icon |
| `README.md`, `START_HERE.md`, `docs/IMPLEMENTATION.md`, `docs/VERIFICATION.md` | Overview and glossary, source-download notes, design record, verification history |
| `.openai/hosting.json` | Existing private project identity; no plugin declarations |
| `vercel.json` | Makes Vercel build with `next build`; see the README's Vercel section |

The starter's framework and runtime helpers are unchanged. Two changes support Vercel, where real Next.js builds and serves the app: `next` and `eslint-config-next` are upgraded from 16.3.4 to 16.4.5, and `lib/connectors.ts` imports `./connector-contract.mts` by its real file name, because Next.js does not map `.mjs` to `.mts` as Vite does.

## Data and privacy

No database migration or external API account is needed for this phase, and no saved trips or visitor records exist. The browser keeps only the last origin and destination, in localStorage. Search results stay in memory, and the JSON audit is created only when downloaded. API responses are private and not cached.

## API contract

`POST /api/search` accepts these fields, all validated on the server:

| Field | Accepted values |
|---|---|
| `originId`, `destinationId` | Cities from the 31-city pilot catalogue; they must differ |
| `date` | A valid date from today to 60 days ahead, in India time |
| `passengers` | 1–6 adults |
| `modes` | A non-empty subset of train, flight, bus and carpool |
| `depth` | `quick`, `thorough` or `extended` |
| `flexibility` | 0, 1 or 2 days either side of `date` |
| `budget` | `null`, or a positive INR fare cap up to 1,000,000; the field must be present |
| `maxHours` | Whole hours from 6 to 96 |
| `latestArrival` | Optional ISO time with an explicit offset, not before the departure date |
| `availabilityOnly` | Display filter; anything other than `true` counts as `false` |

| Outcome | Response |
|---|---|
| No hosted identity (except on Vercel) | 401 with a server-written Sign in with ChatGPT link |
| Search without a matching `Origin` header | 403 |
| Body over 16,000 bytes | 413. A body up to 1 MB is read and discarded first, because the local Workers runtime otherwise fails the next request |
| Unreadable JSON or invalid input | 400 with a message for the user |
| Valid search without live trains | 200 with `status: blocked`, the plan, zero attempted queries, empty results and `live.state` saying why: `not_configured` (no key), `not_applicable` (trains not selected) |
| Live trains set up, passcode missing or wrong (not on the local dev server) | 200 with `status: blocked` and `live.state` `passcode_required` or `passcode_rejected` |
| Valid search with live trains | 200 with `status: live`, `coverage: partial` (unless every planned query ran), each query that ran marked `succeeded` or `failed` with `source: irctc.dev`, and journeys from the engine. If every call failed, `live.problem` says why (`auth`, `quota`, `timeout`, `unreachable`, `upstream`, `bad_response`) |
| Unexpected server error | 500 with a generic message; details go to the server log |

`GET /api/capabilities` also requires identity. It returns the provider setup states and a `site` object with what Sites reports about connected apps. Neither endpoint accepts arbitrary URLs, connector identifiers or action names. In local development on localhost the identity check is skipped, and the dev server supplies a mock identity. On Vercel, which has no ChatGPT sign-in, the identity check is skipped too, so a Vercel deployment is public; searches still need a matching `Origin`.

## Query planning

### Depths

| Depth | Max different services | Planned request cap | Expanded partial-path cap | Reserved future execution settings |
|---|---:|---:|---:|---|
| Quick | 2 | 16 | 5,000 | concurrency 3, deadline 60 s |
| Thorough | 3 | 48 | 15,000 | concurrency 3, deadline 90 s |
| Extended | 5 | 120 | 25,000 | concurrency 3, deadline 90 s |

Concurrency and deadline are planning metadata only; no provider calls happen yet.

### How the request cap is spent

Proposals include direct, feeder and onward queries at every depth, plus interhub queries in thorough and extended mode. The cap is spent in this order until it runs out:

1. one direct query per selected source on the chosen date;
2. on every date, chosen date first, one linked chain of the depth's full length: a feeder to the first hub, hub-to-hub legs and an onward leg to the destination, each dated for roughly when the traveller would reach that hub (a 06:00 start, 55 km/h over 1.3 times the straight-line distance, and an hour per change);
3. one direct query on every other date;
4. the rest round-robin across dates (chosen date first, then the nearest), rotating purposes within each date and alternating sources within each purpose.

A single-change chain uses the top-priority hub; longer chains use the hubs that split the route most evenly. Road searches have no hub-to-hub queries, so a road-only chain has one change. With the smallest cap (Quick with ±2 days) the lowest-priority date can get its chain but no direct query. A query can serve several dates (a later onward leg, for example) and counts toward each in the per-date figures, which also show how many queries each date could have used.

Bus and carpool queries to the same source, pair, date and party are combined. Train onward queries cover each day within the journey-time horizon; interhub and road onward queries cover the same day and the next.

### Hubs

Up to four hubs (quick), eight (thorough) or sixteen (extended) are chosen from the catalogue's interchange cities that lie between the two places:

- each hub is nearer to both ends than the ends are to each other;
- the route through it is at most 30% longer than the straight line, using approximate city coordinates;
- it shares no station with either end.

The hubs closest to the line are chosen, then kept in the catalogue's published order. Each hub is queried at its first station only, and road queries use the first six hubs. The hand-picked pilot interhub pairs come first, turned to face the destination; other hub pairs must move closer to the destination. The priorities still favour the original north/east India use case.

### Coverage limits

This is **not all Indian stations, every route, guaranteed service coverage or exhaustive multimodal search**. Airport entries are candidate access airports, not evidence of operating flights. The selected query pairs and dates, the hubs, clipped dates and the count of proposals outside the cap are visible and exported; omitted proposals are not kept. Alternative origin boarding points are allowed, but an arrival at Kiul is never relabelled Jamalpur: the final service must arrive in the requested city.

## Itinerary engine

### Services and offers

Providers, sellers, quotas and class offers do not multiply the physical service count. A service is identified by mode, number, from-terminal, to-terminal and boarding instant, normalized across time-zone representations; copies with conflicting arrival times are excluded. An offer is identified by source, id, class and quota. Newer observations replace older ones, including unavailable states, and contradictory observations with the same timestamp are treated as unavailable.

### Search and work limit

The engine connects different services, skips first departures at or before evaluation time, and prunes cycles (including a first service from a nearby terminal that runs back into the origin city), negative or short changes, and journeys beyond the time horizon or latest arrival. The input is capped at 10,000 services, and the search at the expanded partial-path cap for the depth.

The search runs level by level: every one-service journey, then every two-service journey, and so on. Routes that start with different first services take turns one extension at a time, so hitting the cap drops only longer journeys, and the page says when that happens. The engine only scans departures after each arrival, considers only services into the destination on the last allowed leg, and drops a route that needs one more leg when nothing leaves its city for the destination in time. These shortcuts never change which journeys are found; they only reduce the work counted against the cap.

### Connections

Same-terminal planning margins are 45 minutes for ground connections and 180 minutes if either leg is a flight. These are conservative **planning assumptions**, not official minimum-connection guarantees. A connection within 45 minutes of its minimum is flagged as tight, and a wait of 10 hours or more is flagged as a possible overnight stay. Changing terminals requires a sourced transfer duration plus margin; without one, the itinerary is unverified and excluded from offers on all legs. There is no production transfer dataset yet. The first-departure cutoff does not establish how quickly the traveller can reach the boarding point, because travel to the first terminal and from the last terminal is not quoted. The output is therefore **intercity time and a known intercity and transfer subtotal**, not complete door-to-door time or cost.

### Offers and freshness

Available offers require fresh source evidence for the actual party and either enough numeric places or a matching-party quote. RAC, waitlist, request-to-book and unverified Tatkal opening do not qualify. Train, bus and carpool evidence expires after at most 120 seconds and flight evidence after 90 seconds, or earlier if the provider says so; future timestamps fail. The engine checks freshness when it evaluates. The page has no refresh or expiry scheduler, because no live results can be returned; before live results are enabled, freshness must also be rechecked while results are displayed and before booking navigation. No offer is called an issued or confirmed ticket. Fares in currencies other than INR and unknown ticket or transfer amounts cannot produce a complete subtotal, and incomplete subtotals sort after complete prices. Booking links must use HTTPS on a provider's host, and an offer page is distinguished from a broad provider search.

### Counters

Each completed service sequence counts once. Candidate sequences, completed itineraries evaluated, connection comparisons, availability-checked itineraries and fully offered itineraries are different counter units. Journeys over the fare cap count as evaluated but not as feasible, availability-checked or fully offered, because they are not shown. Expanded partial paths are never displayed as completed journeys.

## Remaining integration work

### Needs Sites connector discovery

1. Expose the native Sites plugin-eligibility discovery operation, and obtain current canonical provider, connector and action descriptors and the supported hosted source scope. Do not infer identifiers from chat tools or invent metadata. "Recheck site access" shows what Sites reports, so this is where connectors will first become visible.
2. Verify owner and site support and the consent flow for ConfirmTkt, Skyscanner and BlaBlaCar separately. If a provider is ineligible, or needs a final assistant action that a Worker cannot perform, keep its explicit pending or unavailable state and narrow the advertised coverage.
3. Freeze provider-specific request and response fixtures and typed normalization before coding adapters: dates and time zones, passenger semantics, station resolution, links, errors, limits and quota. Keep secrets out of client code, the repository, the manifest and browser storage.
4. Add only verified connector manifest entries and narrow server adapters. Implement visitor-scoped authorization, bounded scheduling and cancellation, and real counts of attempts, successes, failures and partial coverage, with no cross-user cache. Add sourced terminal transfers or keep changes unverified.
5. Extend the blocked-only `SearchRun` type to real queued, running, partial, complete and error states. Add client-side expiry and refresh, and a recheck before booking. Test source eligibility, authorization denial, disconnection, timeouts, rate limits, partial responses and stale evidence against the verified contracts.
6. Before claiming the live portal complete, demonstrate at least one authenticated hosted read per enabled source, the negative consent cases, real multi-service retrieval and a full, fresh end-to-end journey. A chat-native query or a local fixture does not satisfy this gate.

Steps 3–6 depend on the provider contracts from steps 1–2, so they cannot be planned in full detail until discovery works. The offline foundation has been reviewed (see VERIFICATION.md); live integration remains an open blocker.

### Can be prepared now

The 5 November review found these provider-independent items:

- A search-state model for queued, running, partial, complete and error runs, with per-query outcomes, rendered from fixtures before any adapter exists.
- A policy for each connector failure status: rate limits, sign-in required, disabled access, expired request context and upstream errors.
- One terminal-to-city table, covering stations shared between catalogue cities (JMP, NDLS, PAT), and a rule for arrivals at nearby destination terminals. Today a Munger search plans queries to Jamalpur station whose arrivals the engine would discard.
- Handling for offers that expire while results are shown (mark them for rechecking rather than hiding them), and a recheck before booking.
- Mixed-mode fixtures (flights, buses, carpools) and tests with a fake connector binding.

### Open decisions

- **If Sites access does not arrive:** links to provider search pages, a hand-kept timetable for the owner's routes, or unofficial APIs. Unofficial APIs were chosen on 8 November 2026 as an interim (see Decision); trains are built, flights wait for SerpApi.
- **Waitlist and RAC trains:** whether to show them. They never count as available, and the default filter hides journeys without offers on every leg.
- **How live searches run:** one request that streams progress, or stored runs that the page polls. This depends on how long Sites keeps a request's connector access; the local preview allows 60 seconds.
- **Status codes once live results exist:** blocked plans now return 200 with `status: blocked`. Complete and partial results should also return 200 with their own `status`; a 5xx should mean the search itself failed (for example, every provider query erroring).

## Release and rollback

1. Build with the supplied Sites build helper.
2. Package the pushed source with the Sites workflow helper.
3. Publish owner-private without changing the audience. Do not share the site or make it public.
4. To roll back a later version, deploy the previous saved source version. For the first release the pending-source behaviour is itself the safe state, and there are no persistent schema changes.
5. Recheck source eligibility immediately before any integration release.

The earlier saved Jamalpur trip desk, linked from the page, is a separate site. Never show checked counts for proposals, or imply a successful zero-result search, while searches are blocked.
