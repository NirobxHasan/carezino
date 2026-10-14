# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product

Carezino is a minimal, flexible SaaS for therapy centers offering Occupational Therapy (OT), Applied Behavior Analysis (ABA) and Speech & Language Therapy (SLT). It is early-stage: basic management features first, extended over time.

The core patient journey, and the backbone of the domain model, is:

**registration → assessment → therapy planning → booking → session notes → billing**

Scope guardrails:

- Keep it a basic management tool, not a hospital management system. No wards, pharmacy, inpatient or lab modules, or heavy clinical coding unless asked.
- Serve all three disciplines through configurable structures (therapy types, assessment and note templates) rather than separate hard-coded modules per discipline.
- It is multi-tenant SaaS: scope data by center/organization from the start.

## Repository layout

Turborepo monorepo using npm workspaces (`apps/*`, `packages/*`; `packages/` is currently empty).

- `apps/api` (`@carezino/api`): NestJS 11 backend (Express platform), Jest for tests.
- `apps/web` (`@carezino/web`): Next.js 16 App Router frontend with React 19 and Tailwind CSS v4, sources in `apps/web/src/app`.

## Commands

From the repo root (these run through Turbo across all workspaces):

```bash
npm install
npm run dev       # turbo dev: starts api (nest --watch) and web (next dev)
npm run build     # turbo build: outputs dist/ (api) and .next/ (web)
npm run lint      # turbo lint
npm run format    # prettier over **/*.{ts,tsx,md}
```

To target a single workspace, use `npx turbo <task> --filter=@carezino/api` or `npm run <script> -w @carezino/web`.

The root has no `test` script, though `turbo.json` defines a `test` task. Run tests in the API workspace:

```bash
npm run test -w @carezino/api                          # unit tests (src/**/*.spec.ts)
npm run test:e2e -w @carezino/api                      # e2e tests (test/*.e2e-spec.ts, supertest)
npm run test:cov -w @carezino/api
npm run test -w @carezino/api -- app.controller          # single test file (path pattern)
npm run test -w @carezino/api -- -t "test name pattern"   # single test by name
```

The API's `lint` script runs `eslint --fix`, so linting rewrites files.

## Gotchas

- **Ports:** the web app (`next dev`) runs on 3000 and the API on `process.env.PORT ?? 3001` (`apps/api/src/main.ts`). Don't set a global `PORT` when running `npm run dev`, or both apps will try to use it.
- **Next.js 16 differs from older versions** (see `apps/web/AGENTS.md`): APIs, conventions and file structure may not match your training data. Read the relevant guide in `apps/web/node_modules/next/dist/docs/` (or the hoisted `node_modules/next/dist/docs/`) before writing web code, and heed deprecation notices. `next dev` re-adds that AGENTS.md block automatically, so commit it rather than removing it.
- `apps/web/next.config.ts` enables `cacheComponents` and `partialPrefetching`, and wires Tailwind into Turbopack through the `@tailwindcss/turbopack` loader for `*.css`. There is no PostCSS config.
- **Prettier:** the root `.prettierrc` uses single quotes, trailing commas, a print width of 100 and semicolons. `apps/api/.prettierrc` overrides it for the API (single quotes, trailing commas, default print width of 80). The web app's generated files currently use double quotes, which doesn't match the root config.
