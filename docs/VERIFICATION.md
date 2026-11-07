# Verification record

**Current status (5 November 2026):** 41 automated tests pass (28 planner/engine, 7 API and 6 randomized property tests); TypeScript, lint and the production build pass; Lighthouse scores 100 for accessibility, best practices and SEO on mobile and desktop. Live-provider integration is still blocked. The sections below are dated and in order; counts in earlier sections are historical.

## Initial release — 4 November 2026

Date: 4 November 2026. Live-provider verification is blocked; no hosted inventory, booking, provider consent or seat availability has been verified.

## Automated checks observed

- **21 planner/engine tests passed.** Five distinct connecting services; correct later boarding dates and overnight arrival; unknown station transfer exclusion; negative/short changes; party capacity; RAC/request/waitlist/Tatkal distinctions; expired/future evidence; seller/class deduplication; conflicting schedules; equivalent time-zone representations; newer unavailable offers superseding older availability in both input orders; equal-time contradictions; departed services in today/flexible searches; exact destination; depth/duration/work caps; latest arrival; incomplete prices; query cap and shared road-source deduplication; pilot five-service query pairs; clipped flexibility; invalid input; safe booking links.
- **Five API tests passed.** Actual route exports and guard logic verify production identity 401, absent/wrong Origin 403, malformed/invalid body 400, oversized body 413, valid blocked search 503 with zero performed work, and private pending-capability configuration 200. Tests use TypeScript's installed transpiler and stub only the Next server-only authentication-link module boundary. This is in-process route verification, not proof of production dispatch or provider connectivity.
- **TypeScript passed** with `--noEmit --incremental false`.
- **Supplied production build passed.** Dynamic home page and both API routes build as a Worker. Temporary mobile QA HTML is removed; the final build after its removal also passed.

The controlled fixture's fares and seats are test inputs only. They are never imported by app code and do not establish current availability.

## Browser observations

Managed preview opened in the supported cloud browser. Desktop layout and a 390-pixel iframe viewport were inspected visually. The temporary iframe wrapper is removed from source and will not be published.

- Default Gurgaon/Jamalpur plan: 120 source queries prepared, zero attempted, zero services and zero complete journeys evaluated; explicit live search pending, not sold out.
- Dropdown alias search and keyboard Enter select New Delhi; changing inputs marks the previous plan stale.
- Quick search, ±1-day flexibility and two adults produced a 16-query plan across three dates with zero inventory work.
- Changed departure date to 6 November and latest acceptable arrival to 8 November 06:30 IST; the returned plan/audit displayed both correctly. An observed date-input persistence issue was fixed using native input events and rechecked end to end.
- Expanded query audit displays actual selected pairs, dates, hubs, caps, omitted proposal count and not-attempted states. Mobile form, summary cards, pending sources and expandable audit were inspected.
- Source recheck is configuration only. Export is implemented as a browser JSON download; its downloaded bytes have not been independently inspected.

## EGM follow-up

Two fresh read-only reviewers checked implementation correctness and readiness. Three Major engine findings were fixed and regression-tested: string timestamp identity, departed departures and older offers overriding newer unavailable evidence. The omitted-proposal claim was narrowed to a count. Targeted follow-up review found no residual Major foundation defect. Review does not establish live-product readiness: the hosted integration blocker remains open.

## Follow-up fixes — 5 November 2026

A review found five planning and audit defects and three lint errors; all were fixed:

- Flexible-date plans spent the request cap on the earliest dates, so a ±2-day Quick or Thorough search could plan nothing for the chosen date. The cap is now shared across dates, chosen date first. The audit summary counts only dates that received queries and lists planned/proposed queries per date.
- Quick could only plan direct services and Thorough at most two. Quick now plans feeder and onward queries, and Thorough plans hub-to-hub queries.
- Hubs were the first catalogue entries regardless of route (Mumbai→Chennai used Bihar hubs). Hubs must now lie between the two cities; major junctions outside the north/east pilot are marked as hubs.
- City search ignored station and airport codes (NDLS, HWH, BLR returned nothing). Codes now match, with name matches and a city's own codes ranked first.
- Journeys rejected by the fare cap still counted toward "Offers on every intercity leg". The cap is now applied before those counters.
- Lint: the clock is no longer read during client render (the server passes today's IST date), and the saved route is read with `useSyncExternalStore` instead of setting state in an effect. `app/page.tsx` keeps one commented lint exception, because the server page reads the clock once per request.

Checks run: 26 planner/engine tests and 5 API tests passed (5 new tests cover the fixes above); TypeScript, `npm run lint` and the production build passed. In the local preview, a ±2-day Quick search spread its 16 queries evenly across the four dates still in the booking window (the fifth, 4 November, had already passed); NDLS, PAT and HWH found New Delhi, Patna and Kolkata first; the saved route survived a reload; and the console showed no hydration warnings.

A later review (next section) found that these fixes were incomplete: flexible-date plans still could not chain more than two services per date, small plans dropped selected sources, and one city-search case was wrong.

## Second follow-up — 5 November 2026: EGM review and testing

Seven fresh read-only EGM reviewers (code accuracy, design, implementation readiness, scope, comprehension, structure and style) reviewed the code and docs, and the app was tested hands-on. Fixed:

- **Flexible dates and sources.** Flexible-date plans could chain at most two services per date, and small plans dropped selected sources (a ±2-day Quick search planned no bus or carpool query). Every date now gets a linked chain of the depth's full length, and the chosen date gets a direct query from every selected source. Feeder and onward queries alternate sources, and pilot segments face the direction of travel (a Jamalpur→Gurugram plan had spent 20 of 120 queries heading east).
- **City search.** A nearby city could outrank a city's own code: DGH listed Bhagalpur before Deoghar.
- **Engine work limit.** When the engine hit its work limit it had spent the whole budget on the earliest departures: with 10,000 synthetic services a Quick search found none of the 20 direct trains, and Thorough returned 221 journeys that all began with the same train. The engine now searches level by level with fair turns and skips work that cannot lead to a journey. The page now says when results were cut short.
- **First leg back into the origin.** The engine accepted a first train from a nearby terminal back into the origin city (Jamalpur station to Munger on a Munger search). The new property tests found this; it predates this round.
- **Oversized requests.** After the API rejected a body over about 20 KB, the local Workers runtime failed the next request. Oversized bodies up to 1 MB are now read and discarded before the 413. Above 1 MB the read is still cut short and the local runtime still fails the next request once. Production behaviour was not checked.
- **Accessibility.** About 55 text elements were below the 4.5:1 contrast minimum, and many were 8–10 px. Text colours were darkened, the smallest sizes raised to 11–12 px and small tap targets enlarged. The city list no longer puts its 30 options in the tab order, and it closes when focus leaves it.

Checks run:

- `npm test`: 39 tests passed (28 planner/engine, 5 API and 6 new randomized property tests with fixed seeds). Run against the previous code, the property tests fail on the source-coverage and work-limit defects above.
- TypeScript, lint and the production build passed. All tests also passed under six time zones (UTC−11 to UTC+14).
- API: 80 black-box requests against the production build in the local Workers runtime all returned the expected status. They covered identity, origin, size limits, malformed JSON, every input field at and beyond its limits, wrong methods and 60 concurrent searches.
- Scaled-up property run on the final code: 22,610 generated plans, 50,000 junk inputs, 1,500 random service networks and 20,000 runs with corrupted records, with no rule violation. On 4,997 random searches that finished within the work limit, the final engine returned exactly the same journeys, prices, warnings and result counters as the previous engine.
- Speed at the 10,000-service input cap: about 50–75 ms at every depth, down from up to about 0.85 s.
- Browser, on the local preview and the production build: keyboard-only use, error states, Stop, the audit download's contents, the results view (fed a fixture result), and layouts from 390 to 1,280 px. Lighthouse scored 100 for accessibility, best practices and SEO on mobile and desktop. The console showed no errors apart from the intentional 503.

Reported but not changed, pending a decision:

- the HTTP 503 used for blocked searches;
- internal errors returned as 400 with their raw message;
- the hard-coded personal link;
- `next` dependency advisories;
- station-to-city mapping for shared stations (JMP, NDLS, PAT);
- an execution model for live queries;
- documentation structure and terminology.

## Third follow-up — 5 November 2026: open items

Changed:

- **Error messages.** Invalid search input raises a dedicated validation error and keeps its message (400). Any other error now returns a generic 500 and is written to the server log, instead of being shown to the user as a 400.
- **Recheck site access.** It now asks Sites which connected apps this site can use (`getContext()` from the starter's connector helpers). It shows each connector's policy and action names, or says why none are available. Locally it reports that the details are not available, as expected without a Sites binding.
- **Stale plans.** A plan is now marked stale when the saved cities change in another tab.
- **Code cleanup.** The provider list is defined once, in `lib/provider-status.ts`. The engine reuses the planner's depth limits and date helper, and the unused `cityLabel` helper was removed.
- **Page text.** The banner, the empty-results message and the API messages now say that live travel-app searches are not connected yet, instead of implying that only access is missing.
- **Docs.** README, START_HERE and IMPLEMENTATION were restructured following the EGM structure, style and comprehension reviews, adding status, run steps, one list of checks, a glossary and tables for the API contract. Remaining work is now split into platform-dependent steps, work that can be prepared now, and open decisions.

Upgrade trial, not applied: in a separate copy, upgrading `next` and `eslint-config-next` from 16.3.4 to 16.4.5 passed the 39 tests that existed then, plus the type check, lint and build. It cut runtime advisories from 6 (one critical) to 4 (none critical). The project stays on 16.3.4 because the starter asks to keep its lockfile.

Checks run: `npm test` (41 passed), TypeScript, lint and the production build. The 80-request API battery passed in full against the production build. In the local preview, Recheck site access, the cross-tab stale note and the new messages were checked in the browser. Lighthouse scored 100 for accessibility, best practices and SEO on mobile and desktop against the production build. The console showed no errors apart from the intentional 503.

Still open, pending the owner's decision:

- whether to apply the `next` upgrade;
- whether to keep the personal saved-research link on the page;
- the open decisions listed in IMPLEMENTATION.md.

## Ujjain added — 5 November 2026

Ujjain (Madhya Pradesh) could not be chosen in either city dropdown because it was not in the catalogue. It is now listed after Bhopal and can be found by name, by its former name Avantika or by its station code, UJN. Train queries use Ujjain Junction (UJN); flight queries use Indore (IDR), the nearest major airport. Ujjain is an endpoint, not an interchange hub, so it never appears as a change point on other routes.

Checks run:

- `npm test`: 41 passed. The city-search test now also checks "UJN" and "ujj", and the property tests now cover every pair of the 31 cities.
- TypeScript, lint and the production build passed.
- All 7,830 search plans between the original 30 cities (every pair, three depths, three mode sets, ±2 days) were identical before and after the change.
- In headless Chrome against the local preview, the From list showed 31 cities with Ujjain after Bhopal. Typing "Ujj" and pressing Enter selected it, and "UJN" found it in the To list. An Ujjain → Jamalpur search returned its plan with "Live search pending". The console showed no errors apart from the intentional 503.

## Search API returns 200 — 5 November 2026

The owner reported the search API as not working: a New Delhi → Jamalpur request came back as HTTP 503 Service Unavailable, so the browser's network panel and console showed every search as a failed request, although the response contained the full plan. A prepared plan is a successful response, so the API now returns it with HTTP 200. `status: blocked`, `coverage: not_started` and zero attempted queries still say that no live search ran. The page reads `status`, not the HTTP code, so it looks and behaves the same.

Checks run:

- The owner's exact request returned HTTP 200 with the 120-query plan and `status: blocked`.
- `npm test`: 41 passed; the API test now expects 200. TypeScript and lint passed.
- In the browser, the same search showed "Your plan is ready. Live checks have not run.", and the console showed no errors or warnings.

## Search plan shown after a search — 5 November 2026

The owner saw the plan in the API response but no data on the page. The response held no journeys, because no travel app is connected; the plan itself was only visible after clicking "Inspect prepared search" or "Show search plan". The result card now summarises what was prepared: the number of searches per source and the connection hubs used. The full plan opens automatically below the card, and the button is now "See all N planned searches".

Checks run: in the browser, a New Delhi → Jamalpur search for 7 November showed "Prepared 120 searches (ConfirmTkt 97 · Skyscanner 4 · BlaBlaCar 19) through 14 connection hubs" in the card. The plan was open, and the button scrolled to its table. The console showed no messages. `npm test` (41 passed), TypeScript and lint passed.

## Published to GitHub — 7 November 2026

The source is now in a public repository, https://github.com/ashishK-1506/wayhome. Before the first commit:

- The "Looking for the earlier Jamalpur research?" box and its styles were removed. It linked to a separate private test site whose address included a personal name. This settles the open question about that link. The footer now has the 30px top margin (25px on phones) that the box used to provide.
- The package is renamed from `site-creator-vinext-starter` to `wayhome` in `package.json` and `package-lock.json`.
- `.openai/hosting.json` is committed with `project_id` set to null. The build imports the file and copies it into `dist`, so leaving it out would break a fresh clone. The local copy keeps the real identifier, and git ignores local changes to it (`git update-index --skip-worktree`).

Checks run:

- A scan of every committed file found no keys, tokens, passwords or `.env` files. The email addresses and URLs in the tests are made-up fixtures.
- In the local preview, the page showed no saved-research box or external link. The footer sat 30px below the provider cards on desktop and 25px below them on a 390px-wide phone screen, with no sideways scrolling. A search still showed its plan, and the console had no errors or warnings.
- `npm test` (41 passed), TypeScript, lint and the production build passed in this folder. The same checks passed on an exported copy of the commit after a clean `npm ci`, and that build's `hosting.json` had no project identifier.

## Vercel deployment — 7 November 2026

The owner's first Vercel deployment failed. Vercel saw `next` in `package.json` and used its Next.js setup, but `npm run build` runs the Sites build, which writes a Cloudflare Worker to `dist/`. Vercel then found no `.next/routes-manifest.json` and stopped (`NEXT_NO_ROUTES_MANIFEST`). This was reproduced with Vercel CLI 65.11.0 on a fresh clone of commit 2c35c6a.

Changes:

- `vercel.json` makes Vercel run `next build`. Real Next.js could not resolve `./connector-contract.mjs`, because the file is `.mts` and only Vite maps the name; Turbopack and webpack both failed. `lib/connectors.ts` now imports `./connector-contract.mts`, and `tsconfig.json` allows that with `allowImportingTsExtensions`.
- Vercel has no ChatGPT sign-in, so the API would have rejected every search with 401. When `VERCEL=1`, the identity check is skipped and the site is public; the same-origin check for searches stays. The header badge reads "Public demo" and the footer "Public demo of an India-first pilot". The page description no longer calls the planner private.
- `next` and `eslint-config-next` are upgraded from 16.3.4 to 16.4.5. On Vercel, Next.js is the server, and 16.3.4 has critical advisories, including remote code execution in the image optimizer, `next/og` and `use cache`. `npm audit` now reports no advisories for `next` and nothing critical.
- `/.vercel/` is ignored by git.

Checks run:

- `npm test`: 42 passed, including a new test that on Vercel searches and site checks work without sign-in while other-origin searches still get 403. TypeScript, lint and the Sites build passed.
- `vercel build` (Vercel CLI 65.11.0, Next.js preset) passed on an export of the working tree with the public `hosting.json`.
- Served with `VERCEL=1`, that build returned 200 for a same-origin search without sign-in, 403 for another origin and 200 for the site check. Served without `VERCEL`, the same search returned 401.
- In the browser against the Vercel-mode build, the header showed "Public demo", a Gurugram → Jamalpur search showed its 120-query plan, and Recheck site access reported that connected-app details are not available in this environment. The console had no errors or warnings; Chrome's hint about form fields without an id or name also appears on the Sites version.
- After a restart, the local dev server (Sites rules) still shows "Your private travel desk".

Not checked: installing the new lockfile through Sites' managed installer, which cannot run here.

## Release boundary

The new Site was created owner-private. Publication uses the private deployment operation, which verifies the owner-only audience, without changing sharing. Production publication evidence belongs to the returned Sites deployment record. No authenticated hosted travel-app read has been attempted or passed. Enabling live results requires the remaining integration gates in IMPLEMENTATION.md.
