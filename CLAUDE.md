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
npm run test:e2e -w @carezino/api                      # e2e tests (test/*.e2e-spec.ts, supertest; needs TEST_DATABASE_URL)
npm run test:cov -w @carezino/api
npm run test -w @carezino/api -- app.controller          # single test file (path pattern)
npm run test -w @carezino/api -- -t "test name pattern"   # single test by name
```

The API's `lint` script runs `eslint --fix`, so linting rewrites files.

Database (Prisma 7, schema in `apps/api/prisma/schema.prisma`, migrations in `apps/api/prisma/migrations`):

```bash
npm run db:migrate -w @carezino/api   # create/apply a migration in development
npm run db:deploy -w @carezino/api    # apply pending migrations (CI, production, test DB)
```

The e2e tests truncate every table, so they refuse to run without `TEST_DATABASE_URL`, a separate disposable database. Migrate it first with `DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy` (in `apps/api`).

## Auth and tenancy (apps/api/src/auth, centers, staff)

- **Sessions:** opaque random tokens in an HttpOnly `cz_session` cookie; only the SHA-256 is stored (`Session`). No JWTs. Passwords use Argon2id.
- **Same origin:** the browser never calls the API directly. `next.config.ts` rewrites `/api/*` to `API_URL` (default `http://localhost:3001`; baked in at build time). `lib/api/client.ts` `request()` is the only HTTP client.
- **CSRF:** global `CsrfGuard` requires header `x-csrf-token` to equal the `cz_csrf` cookie on every non-GET request, including login.
- **Global guards** (in order): throttler → CSRF → `SessionGuard` (everything requires a session unless `@Public()`) → `PermissionsGuard` (`@RequirePermissions(...)`).
- **Tenant isolation:** center-scoped handlers take `@Tenant() tenant`, whose `centerId` comes from the session's validated active membership, never from the request. Every center-owned query must filter by `tenant.centerId`; another center's record should look like a 404.
- **Roles:** fixed (`CENTER_ADMIN`, `MANAGER`, `RECEPTIONIST`, `THERAPIST`), mapped to permissions in `apps/api/src/auth/permissions.ts`. The web reads granted permissions from `GET /auth/me`; `apps/web/src/lib/permissions.ts` only adds UI-only permissions for prototype modules not yet on the API. Add a module's permissions to the API map when it's built.
- **Web gating:** on full page loads `src/proxy.ts` asks the API (`GET /auth/session`, 200 with `{ me: null }` when signed out) who the user is and redirects before rendering (sign-in, `/admin`, `/select-center`; rules in `lib/auth/session-api.ts`). The `(app)` and `(platform)` layouts re-check on the server inside `<Suspense>` (`lib/auth/server.ts`) and pass the user to `AuthGate`/`PlatformGate`, which provide `useSession()` and react to sign-out. Public screens live in the `(auth)` route group.
- **Instant-navigation validation (dev):** layouts must always render `{children}`. Don't gate a segment behind client-side loading state or call `redirect()` during render for expected cases; redirect in `proxy.ts` or `next.config.ts` `redirects()` instead, or Next logs "Could not validate … instant navigation".
- **Email:** `MailService` uses SMTP when `SMTP_HOST` is set. Without it nothing is sent and callers report `emailDelivered: false`; in development the message and link are printed to the API console.
- **Super admin (platform admin):** `User.isPlatformAdmin` with a `username`, signs in at `/admin/login` (`POST /auth/admin/login`). The `/admin` area (`app/(platform)`) lists every center and registers new ones through `/platform/*` endpoints marked `@PlatformAdminOnly()`; these are cross-center and don't use `@Tenant()`. Public `/register` is off unless `PUBLIC_REGISTRATION_ENABLED=true`. Create or reset a super admin with `PLATFORM_ADMIN_USERNAME=… PLATFORM_ADMIN_PASSWORD=… npm run platform:create-admin -w @carezino/api [-- --reset-password]`; never hard-code credentials.
- Sensitive admin actions are written to `AuditLog` via `AuditService.record(entry, tx)`. Never put credentials or tokens in its metadata.

## Therapists (apps/api/src/therapists)

- A `Therapist` is a center-scoped professional profile, not a login. It can optionally link to one `CenterMembership` of the same center (`membershipId`); never create users or passwords for it.
- Profiles are soft-deleted (`deletedAt`); every query goes through `visibleTherapists(tenant)`, which also limits callers without `therapists.read` (the THERAPIST role has only `therapists.read_own`) to their own linked profile. Anything else is a 404.
- Weekly availability (`TherapistAvailability`), time off (`TherapistTimeOff`, UTC instants, half-open) and center hours/closures are combined on demand by `ScheduleService`/`schedule.ts`; no slots are stored. Results are working windows, not free slots; free slots come from the appointments module, which builds on `ScheduleService.facts`.
- `THERAPIST_APPOINTMENTS` (`appointments.port.ts`) is how therapist screens ask about bookings without importing the appointments module; `TherapistsModule` binds it to `appointments/therapist-appointments.ts`. A null result means "not checked", never "no conflicts".
- The web's dashboard prototype still uses mock therapists (`lib/api/prototype-therapists.ts`); the real screens use `lib/api/therapists.ts`.

## Patients and guardians (apps/api/src/patients)

- A `Patient` is center-scoped and soft-deleted only (`deletedAt`); every query goes through `visiblePatients(tenant)` in `access.ts`, the one place to narrow access later (therapists have no patient permissions until patients can be assigned to them).
- Codes come from `CenterGeneralSettings` (`patientCodePrefix`, e.g. `P-0001`) via the row-locked `CenterSequence` counter (`common/sequences.ts`), never `MAX+1`; numbers aren't reused. With `autoGeneratePatientCode` off, staff type codes.
- Age is a date of birth *or* an approximate age stored as months plus the date it was given (`approxAgeMonths`/`approxAgeAsOf`), never both; the API computes `age` on read.
- `Guardian` is a person (center-scoped, never merged or deleted); `PatientGuardian` holds the per-patient relationship, `isPrimary` and `isEmergencyContact`. Self-managing adults keep their contact details on `Patient` with `primaryContactIsSelf`; exactly one primary contact always exists, so the primary link can't be unlinked. Mobile matches are only suggestions (`GET /guardians/search`).
- `PatientConsent` is append-only history; the latest row per purpose is current.
- Audit metadata for patients records codes, IDs and changed field *names*, never names or health details.
- The web's dashboard/clinical/finance prototypes still use mock patients (`lib/api/prototype-patients.ts`); the real screens and global search use `lib/api/patients.ts`.

## Appointments (apps/api/src/appointments)

- An `Appointment` is a booked service (patient, therapist, therapy type, `type` ASSESSMENT or THERAPY_SESSION, UTC `[startAt, endAt)`), never a clinical note, attendance, package deduction or invoice. It's never deleted: cancelling sets `CANCELLED` with a reason. Every change appends an `AppointmentHistory` row (times, people, statuses and changed field *names*, never note text).
- `rules.ts` holds the booking rules as pure functions (`evaluate`, `daySlots`, status transitions); `BookingService` gathers the facts (schedule, settings, bookings) and both slot listing and booking confirmation run the same `evaluate`, so they can't disagree. Slots sit on a grid from local midnight at the center's slot interval; durations are real minutes, wall-clock times a DST change skips are rejected.
- Double booking is prevented by two Postgres exclusion constraints added in raw SQL (`btree_gist`): per therapist over `[startAt, endAt + bufferMinutes)` and per patient over `[startAt, endAt)`, for SCHEDULED/CONFIRMED/COMPLETED rows. Keep `BLOCKING_STATUSES` in `rules.ts` in step with their `WHERE` clause. Bookings also lock the therapist then the patient row, and re-check inside the transaction; a constraint violation (Prisma `P2039`, cause `23P01`) becomes a 409 `SLOT_TAKEN`. Rows with `allowOverlap` (only booked deliberately when the center allows double booking) are exempt.
- Conflicts are 409 `APPOINTMENT_CONFLICT` with `conflicts: [{ reason, message }]` and `overridable`; the web reads them from `ApiError.details`.
- Recurring bookings (`AppointmentSeries`) expand up front into at most `LIMITS.seriesOccurrences` real appointments (`recurrence.ts` documents the rules; monthly dates a month lacks fall on its last day, flagged `adjusted`). Booking is all-or-nothing unless `skipConflicts`, which records the skipped dates on the series. Each occurrence is then moved or cancelled on its own; "cancel this and following" is the only series-wide action.
- Status changes follow `TRANSITIONS` in `rules.ts`; completed, cancelled and no-show are final. Cancelling inside `cancellationCutoffMinutes` is a late cancellation and needs `appointments.cancel_late`. Item responses carry `actions` (what the caller may do now) so every screen offers the same choices.
- Visibility goes through `visibleAppointments(tenant)`: `appointments.read` sees the center, `appointments.read_own` (the THERAPIST role) only appointments of the therapist profile linked to their membership.
- Responses include center-local `date`/`startTime`/`endTime`, so the web never converts time zones itself. The dashboard prototype still uses mock appointments (`lib/api/prototype-appointments.ts`, `features/dashboard/prototype/`).

## Gotchas

- **Ports:** the web app (`next dev`) runs on 3000 and the API on `process.env.PORT ?? 3001` (`apps/api/src/main.ts`). Don't set a global `PORT` when running `npm run dev`, or both apps will try to use it.
- **Next.js 16 differs from older versions** (see `apps/web/AGENTS.md`): APIs, conventions and file structure may not match your training data. Read the relevant guide in `apps/web/node_modules/next/dist/docs/` (or the hoisted `node_modules/next/dist/docs/`) before writing web code, and heed deprecation notices. `next dev` re-adds that AGENTS.md block automatically, so commit it rather than removing it.
- `apps/web/next.config.ts` enables `cacheComponents` and `partialPrefetching`, and wires Tailwind into Turbopack through the `@tailwindcss/turbopack` loader for `*.css`. There is no PostCSS config.
- **API env:** see `apps/api/.env.example` (registration toggle, cookie/session lifetimes, rate limits, SMTP).
- **API tests and ESM:** `@nestjs/config` v12 is ESM-only and Prisma 7 loads its query compiler with dynamic `import()`. The Jest configs therefore transpile `@nestjs/config`, map `.js` import suffixes, and `test:e2e` runs with `NODE_OPTIONS=--experimental-vm-modules`.
- **Prettier:** the root `.prettierrc` uses single quotes, trailing commas, a print width of 100 and semicolons. `apps/api/.prettierrc` overrides it for the API (single quotes, trailing commas, default print width of 80). The web app's generated files currently use double quotes, which doesn't match the root config.
