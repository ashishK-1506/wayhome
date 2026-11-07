# Wayhome source download

Source commit: d7aeebaa060e0e2e50ea4cdff32dc90c3f484650. Files in this folder have changed since that commit; see `docs/VERIFICATION.md` for the dated record.

## About this download

The ZIP contains source only. Dependencies, build output, Git history, local environment files and credentials are excluded. It uses the portable development profile by default, so there is no machine-specific runtime state and nothing to configure.

## Run locally

Requires Node.js 22.13.0 or newer and npm.

1. Extract the ZIP and open a terminal in the wayhome folder.
2. Run `npm ci`.
3. Run `npm run dev` and open the URL it prints (normally http://localhost:5173).

## Checks

```sh
npm test
npx tsc --noEmit --incremental false
npm run lint
npm run build
```

## Before deploying

`.openai/hosting.json` contains the existing project's identifier, not credentials. Do not reuse it to deploy another site; assign a new project through the supported Sites deployment workflow.

## Status and documentation

Live travel-app results are not built yet. See [README.md](README.md) for what works today and a glossary, and the `docs` folder for the design record and verification history.
