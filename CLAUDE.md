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
- **Same origin:** the browser never calls the API directly. `next.config.ts` rewrites `/api/*` to `API_URL` (default `http://localhost:3001`; baked in at build time). The server-side session check in `lib/auth/session-api.ts` reads `API_URL` at runtime, so set it for `next start` too. `lib/api/client.ts` `request()` is the only HTTP client.
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
- The web's dashboard/clinical prototypes still use mock patients (`lib/api/prototype-patients.ts`); the real screens and global search use `lib/api/patients.ts`.

## Appointments (apps/api/src/appointments)

- An `Appointment` is a booked service (patient, therapist, therapy type, `type` ASSESSMENT or THERAPY_SESSION, UTC `[startAt, endAt)`), never a clinical note, attendance, package deduction or invoice. It may point at the package enrollment paying for it (`packageEnrollmentId`); the session itself is held and charged by the packages module. It's never deleted: cancelling sets `CANCELLED` with a reason. Every change appends an `AppointmentHistory` row (times, people, statuses and changed field *names*, never note text).
- `rules.ts` holds the booking rules as pure functions (`evaluate`, `daySlots`, status transitions); `BookingService` gathers the facts (schedule, settings, bookings) and both slot listing and booking confirmation run the same `evaluate`, so they can't disagree. Slots sit on a grid from local midnight at the center's slot interval; durations are real minutes, wall-clock times a DST change skips are rejected.
- Double booking is prevented by two Postgres exclusion constraints added in raw SQL (`btree_gist`): per therapist over `[startAt, endAt + bufferMinutes)` and per patient over `[startAt, endAt)`, for SCHEDULED/CONFIRMED/COMPLETED rows. Keep `BLOCKING_STATUSES` in `rules.ts` in step with their `WHERE` clause. Bookings also lock the therapist then the patient row, and re-check inside the transaction; a constraint violation (Prisma `P2039`, cause `23P01`) becomes a 409 `SLOT_TAKEN`. Rows with `allowOverlap` (only booked deliberately when the center allows double booking) are exempt.
- Conflicts are 409 `APPOINTMENT_CONFLICT` with `conflicts: [{ reason, message }]` and `overridable`; the web reads them from `ApiError.details`.
- Recurring bookings (`AppointmentSeries`) expand up front into at most `LIMITS.seriesOccurrences` real appointments (`recurrence.ts` documents the rules; monthly dates a month lacks fall on its last day, flagged `adjusted`). Booking is all-or-nothing unless `skipConflicts`, which records the skipped dates on the series. Each occurrence is then moved or cancelled on its own; "cancel this and following" is the only series-wide action.
- Status changes follow `TRANSITIONS` in `rules.ts`; completed, cancelled and no-show are final. Cancelling inside `cancellationCutoffMinutes` is a late cancellation and needs `appointments.cancel_late`. Item responses carry `actions` (what the caller may do now) so every screen offers the same choices.
- Visibility goes through `visibleAppointments(tenant)`: `appointments.read` sees the center, `appointments.read_own` (the THERAPIST role) only appointments of the therapist profile linked to their membership.
- Responses include center-local `date`/`startTime`/`endTime`, so the web never converts time zones itself. The dashboard prototype still uses mock appointments (`lib/api/prototype-appointments.ts`, `features/dashboard/prototype/`).

## Assessments (apps/api/src/assessments)

- Templates are center-scoped (`AssessmentTemplate`) with versioned forms (`AssessmentTemplateVersion.definition`, JSONB). One DRAFT version is edited at a time; publishing freezes it and supersedes the previous one. A trigger in the migration refuses changes to a published definition, so don't try to edit one: start a new version (`POST /assessment-templates/:id/versions`).
- `src/forms/engine.ts` (shared with session note templates) is the single schema for definitions and answers (8 field types, options, limits, defaults). Definitions are plain data: unknown properties are rejected, nothing is evaluated. A field key kept across versions must keep its type (`typeChanges`). Answers are validated against the assessment's own version; empty answers are dropped, never stored, so "not recorded" stays distinct from a finding.
- An `Assessment` stores its exact `templateVersionId` (never switched), dynamic `answers`, the common clinical summary as columns, and `AssessmentRecommendation`/`AssessmentGoal` rows. Recommendations and goals are suggestions only: nothing books, sells, bills or activates plan goals.
- Lifecycle: DRAFT → COMPLETED (signed: required answers + summary, date ≤ today) → AMENDED. Amending writes an append-only `AssessmentAmendment` with the full previous content, reason and changed field labels. Completed assessments can't be deleted (trigger); drafts can be discarded. Writes carry `revision` (optimistic locking, 409 `ASSESSMENT_CHANGED`).
- Access (`access.ts`): only the responsible therapist (profile linked to the caller's membership) writes, completes or amends. `assessments.read` reads all content (CENTER_ADMIN); `assessments.read_status` lists metadata only (MANAGER, RECEPTIONIST; detail returns `clinicalAccess: false`); `assessments.read_own` covers own assessments plus completed ones of patients in the caller's care (a non-cancelled appointment or assessment with them). Therapists without `patients.read` pick patients through `GET /assessments/patient-options`.
- One assessment per appointment (unique `appointmentId`, 409 `APPOINTMENT_ALREADY_ASSESSED` with `assessmentId`); completing never changes the appointment's status. Appointment details include `assessment: { id, status }`.
- Audit log entries (`assessment.created/completed/amended/discarded`, `assessment_template.*`) hold IDs, codes and field labels, never answers or summary text.
- Web: `/assessments` (list, new, `[id]` editor/view, `[id]/print`), `/settings/assessment-templates` (builder with preview and versions), and an Assessments tab on the patient profile. `features/assessments/dynamic-form.tsx` renders any version's form; `template-builder.tsx` exports `FormBuilder`, `FormOutline` and `FormPreview`, which the session note template page reuses.

## Therapy plans (apps/api/src/therapy-plans)

- A `TherapyPlan` is the intended treatment for one patient in one therapy type: responsible therapist, recommended frequency (`sessionsPerPeriod` per `frequencyUnit`), duration, dates, goals. It never books, sells, bills or writes notes, and never changes its `sourceAssessmentId` assessment. Codes `TP-0001` come from `CenterSequence` (`therapy_plan`).
- Lifecycle in `rules.ts` (`TRANSITIONS`): DRAFT → ACTIVE ⇄ PAUSED → COMPLETED / DISCONTINUED (closed, final). Pausing and discontinuing need a reason, completing a summary; activation needs a frequency and a goal. At most one ACTIVE/PAUSED plan per patient and therapy type: a partial unique index (`TherapyPlan_one_open_per_therapy`) plus a pre-check, 409 `PLAN_ALREADY_ACTIVE` with `planId`.
- Drafts are edited freely (`PATCH` sends the whole goal list). From activation on, every change appends a `TherapyPlanRevision` (event, changed field labels, before/after snapshots, reason): status changes, `POST /revise` (plan details), `POST /reassign` (`therapy_plans.reassign`, also managers, no clinical access needed) and goal adds/changes (reason required except status-only). Goals of active plans are never deleted; a goal with progress keeps its measurement (409 `GOAL_HAS_PROGRESS`).
- Goals: one flexible model. `measurement.ts` validates `measurementType` (NARRATIVE, PERCENTAGE, COUNT, DURATION, FREQUENCY, RATING_SCALE, CUSTOM) with `measurementConfig` and numeric baseline/target/progress values. Statuses are clinician-set, never computed. Categories (`TherapyGoalCategory`) are optional, center-scoped, optionally per therapy type, deactivated rather than deleted (name unique per center and type, case-insensitively, by a raw index). Goals copied from an assessment keep `sourceAssessmentGoalId` (no FK: amendments replace assessment goal rows).
- `TherapyGoalProgress` is append-only; corrections are new rows with `correctsId` and a reason. Progress is recorded only while ACTIVE; a status given with it becomes the goal's status.
- Reviews (`TherapyPlanReview`) are confirmed on save with goal and plan snapshots. The recommendation changes nothing (the web then offers the matching action); `nextReviewDate` becomes the plan's. Corrections append `TherapyPlanReviewAmendment`, by the reviewing therapist only.
- Triggers in the migration refuse: deleting non-draft plans, any update to closed plans or their goals, deleting goals of non-draft plans, changing or deleting progress, history and review amendments, and deleting reviews.
- Access (`access.ts`, same shape as assessments): `therapy_plans.read` all content (CENTER_ADMIN); `therapy_plans.read_status` schedule and status only (MANAGER, RECEPTIONIST; detail returns `clinicalAccess: false`); `therapy_plans.read_own` own plans plus non-draft plans of patients in care (`patientsInCare` includes plans). Clinical writes only by the responsible therapist; `PlanWrites.lock` locks the row and checks status and `revision`. Plans without a source assessment need `therapy_plans.create_without_assessment`. Item responses carry `actions`.
- Web: `/therapy-plans` (list, `new`, `[id]` with tabs, `[id]/edit`, `[id]/reviews/new`; `[id]/reviews` redirects to the tab in `next.config.ts`), `/settings/goal-categories`, a Therapy plans tab on the patient profile, and "Create therapy plan" on completed assessments (`?patientId=&assessmentId=` prefills suggestions and goals). Plan pages accept `?action=pause|resume|complete|discontinue|revise&review=<id>`.

## Packages and enrollments (apps/api/src/packages)

- A `TherapyPackage` is a commercial offering (sessions, validity, price, eligible therapy types as one shared pool, optional usage limit, charging policy). It never books, plans or takes payment. Codes `PKG-0001` come from `CenterSequence` (`package`) unless typed. Packages with enrollments are deactivated, never deleted.
- A `PackageEnrollment` is one patient's purchase (`PE-0001`, sequence `package_enrollment`). It snapshots the package's terms and price when made (columns plus `packageSnapshot`); a migration trigger refuses changes to them, so catalog edits never touch it. Renewing is a new enrollment (`renewedFromId`); balances never carry over. The agreed price (`catalogPrice`, discount, `finalPrice`, NUMERIC, never floats) is not a payment: billing will invoice against the enrollment.
- Balances are append-only rows, never an edited number: `PackageSessionLedger` (allocation, bonus/manual credits, manual debits, consumptions, reversals with `reversesId`) and `PackageSessionReservation` (a session held for one appointment, ending `CONSUMED` or `RELEASED`). The enrollment's `totalSessions`/`consumedSessions`/`reservedSessions` are kept by triggers from those rows (never write them), and a CHECK keeps `consumed + reserved ≤ total`. A reservation must end before its consumption is inserted, or that CHECK fails.
- Stored `state` is only PENDING/ACTIVE/CANCELLED; EXPIRED and EXHAUSTED are derived on every read and in list filters (`rules.ts` `enrollmentStatus`, `EnrollmentsService.statusWhere`), so nothing depends on a cron job. Validity is center-local dates, both included; `rules.ts` documents days/weeks/calendar months. `FIRST_SESSION` enrollments stay PENDING without dates until their first charged session.
- Appointments use packages only through `PackageSessions` (`sessions.service.ts`), inside the appointment's own transaction after the appointment row is written: `reserve` on booking (single or series, all or nothing), `move` on reschedule (409 `PACKAGE_NOT_APPLICABLE` with `removable` if the new time isn't covered), `release`, and `settle` on completion (always charged), no-show and late cancellation (charged only if the enrollment says so). Lock order: therapist, patient, appointment, enrollment. One consumption per appointment and one reversal per consumption are unique indexes. `PATCH /appointments/:id/package` changes an open appointment's package.
- Booking checks (`rules.ts` `sessionProblems`) judge the session's own date, not today, and the booking-screen options (`GET /package-enrollments/options`) use the same function.
- Permissions: front desk reads, enrolls and renews on the package's terms; `package_enrollments.override_terms` (discounts, agreed price, session count, end date), `.cancel` and `.adjust` are for managers and admins; `packages.delete` for admins. Therapists have none: appointment details show which package covers a session, never prices or balances.
- Web: `/packages` (catalog), `/packages/new`, `/packages/[id]` (edit), `/packages/enrollments` (list, `new` with `?patientId=&packageId=&renew=`, `[id]` with `?action=adjust|cancel`), a Packages tab on the patient profile, and a package picker in booking and on appointment details. Money is shown with `formatMoney` and previewed in whole paisa (`package-display.tsx`); the API recalculates.

## Sessions: attendance, session records and notes (apps/api/src/sessions)

- A session is addressed by its appointment's ID (`/sessions/:id`). Four separate records, kept in step by the API: `SessionAttendance` (whether the patient came), `TherapySession` (therapy-session appointments only: IN_PROGRESS, COMPLETED, VOIDED; no row means NOT_STARTED), `SessionNote` (clinical documentation) and the appointment's own status. Each change appends `AppointmentHistory` (`ATTENDANCE_RECORDED/CORRECTED`, `SESSION_STARTED/CORRECTED`, `STATUS_CHANGED`); note text never goes there.
- `rules.ts` decides as pure functions (`planAttendance`, `completionRefusal`); `lifecycle.service.ts` (`SessionLifecycle`) applies them in one transaction, locking therapist → patient → appointment → enrollment like booking. ABSENT is the attendance of NO_SHOW: recording one sets the other, and the package settles the no-show by its own policy. Check-in is today only, records PRESENT (or LATE when asked; there's no lateness rule) and never charges. Attendance after the appointment closed is a correction: `attendance.correct` and a reason. A no-show corrected to present/late is reopened (SCHEDULED, package held again) unless it was charged or voided.
- Completing (`POST /sessions/:id/complete`, or `PATCH /appointments/:id/status` COMPLETED, which goes through the `SESSION_OUTCOMES` port in `appointments/sessions.port.ts`) needs PRESENT/LATE attendance (the request may give it), sets the appointment COMPLETED, charges the held package session via `PackageSessions.settle` and records the session. It's idempotent. The note may stay a draft: lists show "note pending".
- An appointment is charged at most once (packages migration), so a completed session is never reopened: `POST /sessions/:id/correct` (`sessions.correct`) voids it (NOT_ATTENDED → no-show, NOT_DELIVERED → cancelled) and appends a ledger reversal via `PackageSessions.reverse`.
- Notes: one per session, written and signed only by the appointment's therapist (from the session's day), from a published `SessionNoteTemplateVersion` (same engine and versioning as assessments; triggers freeze published versions). Templates are general (`therapyTypeId` null) or per therapy, with one default each (partial unique index); the center's first note creates the standard template (`starter.ts`). Lifecycle DRAFT → COMPLETED → AMENDED with `revision` (409 `NOTE_CHANGED`) and append-only `SessionNoteAmendment`.
- Goal progress: drafts hold it in `draftGoals`; completing writes `TherapyGoalProgress` rows with `sessionNoteId` (one per note and goal, partial unique index) and empties `draftGoals`. Amendments add corrections (`correctsId`), never new rows or deletions; plan-screen corrections keep `sessionNoteId`. Progress needs an ACTIVE plan; a status is only set when the therapist picks one. The session's therapist may record progress on the patient's plan through the note even if another therapist owns the plan.
- Access (`access.ts`): `sessions.read` sees every session, `sessions.read_own` (therapists) their own. Note content: `session_notes.read` (admins) all; `session_notes.read_own` own notes plus signed notes of patients in care. Front desk and managers see note status, never content. Items carry `sessionActions`.
- Attendance times travel as center-local `HH:mm` (`checkInTime`, `actualStartTime`, `actualEndTime`), like booking times.
- Web: `/sessions/today` (front desk day, auto-refreshing), `/sessions` (history), `/sessions/[id]`, `/sessions/[id]/note` (`?amend=1`), `/my-sessions`, `/settings/session-note-templates`, a Sessions tab on the patient profile, attendance on appointment lists and details. `features/sessions/session-actions.tsx` holds every attendance/session dialog. `/clinical` redirects to `/sessions`; the dashboard prototype still reads mock notes from `lib/mock/seed.ts`.

## Billing and basic accounting (apps/api/src/billing)

- An operational billing and cashbook, not a general ledger. `Invoice` (+ `InvoiceItem`) is what's owed, `Payment` is money received (its `number` is the receipt number), `PaymentAllocation` applies part of a payment to an invoice of the same patient, `Refund` returns unapplied money, `Expense` is money spent. Package entitlement stays in packages: billing never touches ledgers or reservations, and an unpaid invoice never limits a package.
- Money is NUMERIC(12,2) and `Prisma.Decimal` (`rules.ts` has the arithmetic: line and invoice discounts, tax once on the discounted subtotal, half-up rounding). The web previews in BigInt paisa (`finance-display.tsx`); the API always recalculates.
- Lifecycle: DRAFT (no number, editable, deletable) → ISSUED / PARTIALLY_PAID / PAID (kept by a trigger from active allocations) → VOID (final, reason required). Overdue and aging are derived from the center-local due date. Numbers (`INV-000001`, `RCP-000001`, prefixes in `CenterBillingSettings`) come from `CenterSequence` (`invoice`, `receipt`) when issued/recorded. Corrections are void (with optional reissue as a draft), never edits: triggers refuse changes to issued terms, deleting issued invoices, payments, allocations, refunds and expenses.
- One live charge per event: partial unique indexes on `InvoiceItem` (`PACKAGE` per enrollment, `ASSESSMENT_FEE`/`SESSION_FEE` per appointment, while `active`; voiding sets lines inactive). Fee lines refuse appointments a package holds or used a session for (`SESSION_COVERED_BY_PACKAGE`); `ADDITIONAL_FEE` (`invoices.additional_charge`) is the deliberate extra charge. `GET /billing/charges?patientId=` lists what's still uninvoiced, priced by the therapy's own active service, else a general one.
- `Invoice.paidAmount` and `Payment.allocatedAmount`/`refundedAmount` are trigger-kept projections (never written by the API) with CHECKs (`Invoice_paid_check`, `Payment_balance_check`) that refuse over-allocation, double-spent credit and over-refunds under concurrency. Services lock invoices before payments, each in ID order (`lockRows`). Retry-sensitive writes take a client `requestId` (payments, refunds, allocations, drafts, expenses) and re-check it after locking.
- Unapplied credit = recorded payments − allocations − refunds, per patient (never shared across siblings). Refunds come only from unapplied money; release an allocation (`payments.reallocate`) or void the invoice first. Reversal marks a payment recorded in error (releases its allocations; not allowed after refunds).
- Billing policies (`CenterBillingSettings`, MANUAL by default) invoice and issue automatically through `BillingEvents`, called by packages (enrollment), appointments (assessment booking) and sessions (completion) after their own transaction commits; failures are logged and the event stays in the uninvoiced charges. `BillingModule` imports no feature module, so it can't form a cycle.
- Reports (`reports.service.ts`) aggregate in the database and define the terms used everywhere: collections exclude reversed payments, refunds are separate, invoiced ≠ collected, net cash movement = collections − refunds − expenses (not profit). Receptionists see only their own collections (`finance_reports.read_own`).
- Payment methods and expense categories are per-center rows seeded on first use; payments by a method with `requiresReference` need a transaction reference. Nothing is verified with a provider: receipts and screens say so.
- Audit (`AuditLog`, indexed by entity) records invoice, payment, refund, expense and settings events with numbers, codes and amounts, never notes.
- Web: `/finance` (overview; a front-desk view without `finance_reports.read`), `/finance/invoices` (`new?patientId=&charges=`, `[id]`, `[id]/edit`, `[id]/print`), `/finance/payments` (`[id]`, `[id]/receipt`), `/finance/dues`, `/finance/expenses`, `/finance/reports`, `/settings/billing` (preferences, `services`, `payment-methods`, `expense-categories`) and a Billing tab on the patient profile. `features/finance/collect-payment.tsx` is the one payment dialog. The dashboard prototype still reads mock finance data (`lib/api/prototype-finance.ts`).

## Gotchas

- **Ports:** the web app (`next dev`) runs on 3000 and the API on `process.env.PORT ?? 3001` (`apps/api/src/main.ts`). Don't set a global `PORT` when running `npm run dev`, or both apps will try to use it.
- **Next.js 16 differs from older versions** (see `apps/web/AGENTS.md`): APIs, conventions and file structure may not match your training data. Read the relevant guide in `apps/web/node_modules/next/dist/docs/` (or the hoisted `node_modules/next/dist/docs/`) before writing web code, and heed deprecation notices. `next dev` re-adds that AGENTS.md block automatically, so commit it rather than removing it.
- **Visited routes keep their state:** with `cacheComponents`, Next hides up to 3 visited routes with `<Activity>` instead of unmounting them (`node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md`). `useState` initializers don't re-run when you return, so react to search params when they change rather than reading them once, close transient dialogs in a `useLayoutEffect` cleanup, and remount "create" forms after saving (e.g. with a `key`).
- `apps/web/next.config.ts` enables `cacheComponents` and `partialPrefetching`, and wires Tailwind into Turbopack through the `@tailwindcss/turbopack` loader for `*.css`. There is no PostCSS config.
- **API env:** see `apps/api/.env.example` (registration toggle, cookie/session lifetimes, rate limits, SMTP).
- **API tests and ESM:** `@nestjs/config` v12 is ESM-only and Prisma 7 loads its query compiler with dynamic `import()`. The Jest configs therefore transpile `@nestjs/config`, map `.js` import suffixes, and `test:e2e` runs with `NODE_OPTIONS=--experimental-vm-modules`.
- **Prettier:** the root `.prettierrc` uses single quotes, trailing commas, a print width of 100 and semicolons. `apps/api/.prettierrc` overrides it for the API (single quotes, trailing commas, default print width of 80). The web app's generated files currently use double quotes, which doesn't match the root config.
