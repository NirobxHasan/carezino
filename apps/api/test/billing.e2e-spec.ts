import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

import { addDays, formatIsoDate, todayIn } from '../src/common/time';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  Browser,
  FakeMail,
  addStaff,
  createTestApp,
  registerCenter,
  resetDatabase,
} from './helpers';

interface Line {
  id: string;
  kind: string;
  description: string;
  quantity: number;
  unitPrice: string;
  amount: string;
  discountAmount: string;
  totalAmount: string;
  active: boolean;
}

interface Invoice {
  id: string;
  number: string | null;
  status: string;
  patient: { id: string };
  invoiceDate: string;
  dueDate: string | null;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  paidAmount: string;
  outstanding: string;
  overdue: boolean;
  aging: string | null;
  automatic: boolean;
  revision: number;
  items: Line[];
  allocations: {
    id: string;
    amount: string;
    active: boolean;
    releaseReason: string | null;
  }[];
  patientCredit: string;
  history: { action: string }[];
  actions: Record<string, boolean>;
}

interface Payment {
  id: string;
  number: string;
  status: string;
  amount: string;
  allocatedAmount: string;
  refundedAmount: string;
  unappliedAmount: string;
  method: { id: string; name: string };
  collectedBy: { id: string; fullName: string };
  allocations: {
    id: string;
    amount: string;
    active: boolean;
    invoice: { id: string };
  }[];
  refunds: { id: string; amount: string }[];
  verified: boolean;
  actions: Record<string, boolean>;
}

interface Charge {
  key: string;
  kind: string;
  appointmentId: string | null;
  packageEnrollmentId: string | null;
  unitPrice: string | null;
  problem: string | null;
}

const OPEN_DAYS = [6, 0, 1, 2, 3, 4];
const today = () => todayIn('Asia/Dhaka');
const iso = formatIsoDate;
const daysFromToday = (n: number) => iso(addDays(today(), n));

/** The first working date at least `from` days ahead. */
function nextWorkday(from = 1) {
  let date = addDays(today(), from);
  while (!OPEN_DAYS.includes(date.getUTCDay())) date = addDays(date, 1);
  return iso(date);
}

/** The most recent working date at least `from` days back. */
function recentWorkday(from = 1) {
  let date = addDays(today(), -from);
  while (!OPEN_DAYS.includes(date.getUTCDay())) date = addDays(date, -1);
  return iso(date);
}

describe('Billing and basic accounting (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mail: FakeMail;

  beforeAll(async () => {
    ({ app, prisma, mail } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    mail.sent = [];
  });

  // Every test ends with the books balancing (section 26 of the module spec).
  afterEach(async () => {
    expect(await reconcile()).toEqual([]);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Rows that break a billing invariant; empty when everything adds up. */
  async function reconcile() {
    return prisma.$queryRaw<{ problem: string; id: string }[]>`
      SELECT 'invoice paid ≠ active allocations' AS problem, i.id::text AS id
      FROM "Invoice" i
      LEFT JOIN "PaymentAllocation" a ON a."invoiceId" = i.id AND a."releasedAt" IS NULL
      GROUP BY i.id HAVING i."paidAmount" <> coalesce(sum(a.amount), 0)
      UNION ALL
      SELECT 'invoice paid beyond total', i.id::text FROM "Invoice" i WHERE i."paidAmount" > i."totalAmount"
      UNION ALL
      SELECT 'void invoice still paid or holding lines', i.id::text FROM "Invoice" i
      WHERE i.status = 'VOID' AND (i."paidAmount" <> 0 OR EXISTS (
        SELECT 1 FROM "InvoiceItem" ii WHERE ii."invoiceId" = i.id AND ii.active))
      UNION ALL
      SELECT 'payment allocated ≠ active allocations', p.id::text
      FROM "Payment" p
      LEFT JOIN "PaymentAllocation" a ON a."paymentId" = p.id AND a."releasedAt" IS NULL
      GROUP BY p.id HAVING p."allocatedAmount" <> coalesce(sum(a.amount), 0)
      UNION ALL
      SELECT 'payment refunded ≠ refunds', p.id::text
      FROM "Payment" p LEFT JOIN "Refund" r ON r."paymentId" = p.id
      GROUP BY p.id HAVING p."refundedAmount" <> coalesce(sum(r.amount), 0)
      UNION ALL
      SELECT 'payment over-used', p.id::text FROM "Payment" p
      WHERE p."allocatedAmount" + p."refundedAmount" > p.amount
      UNION ALL
      SELECT 'reversed payment still counts', p.id::text FROM "Payment" p
      WHERE p.status = 'REVERSED' AND (p."allocatedAmount" <> 0 OR p."refundedAmount" <> 0)
      UNION ALL
      SELECT 'event charged twice', coalesce(ii."appointmentId", ii."packageEnrollmentId")::text
      FROM "InvoiceItem" ii WHERE ii.active AND ii.kind IN ('PACKAGE', 'ASSESSMENT_FEE', 'SESSION_FEE')
      GROUP BY ii.kind, coalesce(ii."appointmentId", ii."packageEnrollmentId") HAVING count(*) > 1`;
  }

  async function ok<T>(
    res: Promise<{ status: number; body: unknown }>,
    status = 200,
  ) {
    const r = await res;
    if (r.status !== status) {
      throw new Error(
        `Expected ${status}, got ${r.status}: ${JSON.stringify(r.body)}`,
      );
    }
    return r.body as T;
  }

  async function fails(
    res: Promise<{ status: number; body: unknown }>,
    status: number,
  ) {
    const r = await res;
    expect({ status: r.status, body: r.body }).toMatchObject({ status });
    return r.body as {
      code?: string;
      message: string;
      errors?: Record<string, string>;
    } & Record<string, unknown>;
  }

  let counter = 0;

  /** A center with priced services, front desk, a manager, a therapist and two patients. */
  async function setup() {
    const center = await registerCenter(app);
    const admin = center.browser;
    const list = (await admin.get('/therapy-types')).body as {
      id: string;
      code: string;
    }[];
    const t = Object.fromEntries(list.map((x) => [x.code, x.id]));
    await ok(
      admin.patch('/settings/scheduling', {
        slotIntervalMinutes: 30,
        allowPastDateBooking: true,
      }),
    );
    counter += 1;
    const staffT = await addStaff(app, admin, mail, {
      email: `t${counter}@example.com`,
      role: 'THERAPIST',
    });
    const desk = await addStaff(app, admin, mail, {
      email: `desk${counter}@example.com`,
      role: 'RECEPTIONIST',
    });
    const manager = await addStaff(app, admin, mail, {
      email: `manager${counter}@example.com`,
      role: 'MANAGER',
    });
    const therapist = await ok<{ id: string }>(
      admin.post('/therapists', {
        fullName: 'Farhana Akter',
        mobile: `01711-0${String(counter).padStart(5, '0')}`,
        specializations: { therapyTypeIds: [t.OT, t.SLT, t.ABA] },
        availability: {
          days: Array.from({ length: 7 }, (_, dayOfWeek) => ({
            dayOfWeek,
            isAvailable: OPEN_DAYS.includes(dayOfWeek),
            intervals: [{ start: '08:00', end: '18:00' }],
          })),
        },
        membershipId: staffT.membershipId,
      }),
      201,
    );
    const patient = async (fullName: string) => {
      counter += 1;
      return ok<{ id: string; code: string }>(
        admin.post('/patients', {
          fullName,
          contact: {
            contactType: 'GUARDIAN',
            fullName: 'Nasrin Akter',
            mobile: `01811-${String(counter).padStart(6, '0')}`,
            relationship: 'MOTHER',
          },
        }),
        201,
      );
    };
    const service = (body: Record<string, unknown>) =>
      ok<{ id: string; code: string; price: string }>(
        admin.post('/billing/services', body),
        201,
      );
    const services = {
      otAssessment: await service({
        name: 'Initial OT Assessment',
        code: 'ot-assess',
        category: 'ASSESSMENT',
        therapyTypeId: t.OT,
        price: '1000',
      }),
      otSession: await service({
        name: 'Individual OT Session',
        code: 'OT-SESSION',
        category: 'THERAPY_SESSION',
        therapyTypeId: t.OT,
        price: '800',
      }),
      session: await service({
        name: 'Therapy session',
        code: 'SESSION',
        category: 'THERAPY_SESSION',
        price: '700',
      }),
      report: await service({
        name: 'Progress report copy',
        code: 'REPORT',
        category: 'OTHER',
        price: '200',
      }),
    };
    const methods = await ok<{
      items: { id: string; name: string; requiresReference: boolean }[];
    }>(admin.get('/billing/payment-methods'));
    const method = Object.fromEntries(methods.items.map((m) => [m.name, m.id]));
    return {
      ...center,
      admin,
      t,
      desk: desk.browser,
      manager: manager.browser,
      therapistUser: staffT.browser,
      therapist,
      services,
      method,
      ayaan: await patient('Ayaan Rahman'),
      zara: await patient('Zara Karim'),
    };
  }
  type Setup = Awaited<ReturnType<typeof setup>>;

  function book(s: Setup, overrides: Record<string, unknown> = {}) {
    return ok<{ id: string }>(
      s.admin.post('/appointments', {
        patientId: s.ayaan.id,
        type: 'THERAPY_SESSION',
        therapyTypeId: s.t.OT,
        therapistId: s.therapist.id,
        durationMinutes: 45,
        date: recentWorkday(1),
        startTime: '10:00',
        ...overrides,
      }),
      201,
    );
  }

  const complete = (s: Setup, id: string) =>
    ok(s.admin.post(`/sessions/${id}/complete`, { attendance: 'PRESENT' }));

  async function enrollment(s: Setup, overrides: Record<string, unknown> = {}) {
    const pkg = await ok<{ id: string }>(
      s.admin.post('/packages', {
        name: 'OT Monthly',
        therapyTypeIds: [s.t.OT],
        sessionCount: 12,
        price: '9000',
        validityValue: 30,
        validityUnit: 'DAY',
      }),
      201,
    );
    return ok<{ id: string; code: string; finalPrice: string }>(
      s.admin.post('/package-enrollments', {
        patientId: s.ayaan.id,
        packageId: pkg.id,
        activationPolicy: 'FIXED_DATE',
        startDate: daysFromToday(-7),
        ...overrides,
      }),
      201,
    );
  }

  const other = (
    s: Setup,
    items: object[] = [{ kind: 'OTHER', serviceId: s.services.report.id }],
  ) => ({
    patientId: s.ayaan.id,
    items,
  });

  function draft(
    s: Setup,
    body: Record<string, unknown>,
    browser: Browser = s.admin,
  ) {
    return ok<Invoice>(browser.post('/invoices', body), 201);
  }

  async function issued(
    s: Setup,
    body: Record<string, unknown>,
    browser: Browser = s.admin,
  ) {
    return ok<Invoice>(
      browser.post('/invoices', { ...body, issue: true }),
      201,
    );
  }

  function pay(
    s: Setup,
    body: Record<string, unknown>,
    browser: Browser = s.desk,
  ) {
    return browser.post('/payments', {
      patientId: s.ayaan.id,
      methodId: s.method.Cash,
      ...body,
    });
  }

  const invoice = (s: Setup, id: string) =>
    ok<Invoice>(s.admin.get(`/invoices/${id}`));
  const payment = (s: Setup, id: string) =>
    ok<Payment>(s.admin.get(`/payments/${id}`));

  // ── Configuration ─────────────────────────────────────────────────────────

  describe('configuration', () => {
    it('starts with editable defaults, uses the center currency and audits changes', async () => {
      const s = await setup();
      const settings = await ok<Record<string, unknown>>(
        s.admin.get('/billing/settings'),
      );
      expect(settings).toMatchObject({
        invoicePrefix: 'INV-',
        receiptPrefix: 'RCP-',
        defaultDueDays: 7,
        allowPartialPayment: true,
        taxRate: '0.00',
        currency: 'BDT',
        packageBillingPolicy: 'MANUAL',
      });
      expect(Object.keys(s.method).sort()).toEqual([
        'Bank transfer',
        'Card',
        'Cash',
        'Nagad',
        'Other',
        'bKash',
      ]);
      const cats = await ok<{ items: { name: string }[] }>(
        s.admin.get('/billing/expense-categories'),
      );
      expect(cats.items.map((c) => c.name)).toContain('Therapist payments');

      await fails(
        s.desk.patch('/billing/settings', { defaultDueDays: 3 }),
        403,
      );
      await fails(
        s.manager.patch('/billing/settings', { defaultDueDays: 3 }),
        403,
      );
      await fails(s.admin.patch('/billing/settings', { taxRate: '120' }), 400);
      const updated = await ok<Record<string, unknown>>(
        s.admin.patch('/billing/settings', {
          invoicePrefix: 'SB/',
          defaultDueDays: 3,
          taxRate: 5,
        }),
      );
      expect(updated).toMatchObject({ invoicePrefix: 'SB/', taxRate: '5.00' });
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'billing.settings_updated' },
      });
      expect(audit?.metadata).toMatchObject({
        defaultDueDays: { from: 7, to: 3 },
      });

      // Payment methods are the center's own rows; names are unique ignoring case.
      await fails(
        s.admin.post('/billing/payment-methods', { name: 'CASH' }),
        400,
      );
      const rocket = await ok<{ id: string }>(
        s.admin.post('/billing/payment-methods', {
          name: 'Rocket',
          requiresReference: true,
        }),
        201,
      );
      await ok(
        s.admin.patch(`/billing/payment-methods/${rocket.id}`, {
          isActive: false,
        }),
      );
      const off = await fails(
        pay(s, { amount: '100', methodId: rocket.id }),
        400,
      );
      expect(off.code).toBe('METHOD_INACTIVE');
    });

    it('keeps a service catalog with unique codes; prices apply to future lines only', async () => {
      const s = await setup();
      expect(s.services.otAssessment.code).toBe('OT-ASSESS');
      const taken = await fails(
        s.admin.post('/billing/services', {
          name: 'Dup',
          code: 'ot-assess',
          category: 'OTHER',
          price: '1',
        }),
        400,
      );
      expect(taken.code).toBe('CODE_TAKEN');
      await fails(
        s.desk.post('/billing/services', {
          name: 'X',
          code: 'X',
          category: 'OTHER',
          price: '1',
        }),
        403,
      );
      const listed = await ok<{ items: { code: string }[] }>(
        s.desk.get(
          `/billing/services?category=THERAPY_SESSION&therapyTypeId=${s.t.OT}`,
        ),
      );
      expect(listed.items.map((i) => i.code).sort()).toEqual([
        'OT-SESSION',
        'SESSION',
      ]);

      const inv = await issued(s, other(s));
      await ok(
        s.admin.patch(`/billing/services/${s.services.report.id}`, {
          price: '350',
        }),
      );
      expect((await invoice(s, inv.id)).items[0].unitPrice).toBe('200.00');

      await ok(
        s.admin.patch(`/billing/services/${s.services.report.id}/status`, {
          isActive: false,
        }),
      );
      const inactive = await fails(s.admin.post('/invoices', other(s)), 400);
      expect(inactive.code).toBe('SERVICE_INACTIVE');
    });
  });

  // ── Invoices ──────────────────────────────────────────────────────────────

  describe('invoices', () => {
    it('drafts multi-line invoices with backend totals, discounts and tax, then issues them', async () => {
      const s = await setup();
      const e = await enrollment(s);
      const assessment = await book(s, {
        type: 'ASSESSMENT',
        durationMinutes: 60,
        date: nextWorkday(2),
      });
      // The spec's example: package 9,000 + assessment 1,000 − 500 = 9,500.
      const d = await draft(s, {
        patientId: s.ayaan.id,
        items: [
          { kind: 'PACKAGE', packageEnrollmentId: e.id },
          { kind: 'ASSESSMENT_FEE', appointmentId: assessment.id },
        ],
        discountType: 'FIXED',
        discountValue: '500',
      });
      expect(d).toMatchObject({
        status: 'DRAFT',
        number: null,
        subtotal: '10000.00',
        discountAmount: '500.00',
        totalAmount: '9500.00',
        outstanding: '0.00',
        dueDate: daysFromToday(7),
      });
      expect(d.items.map((i) => [i.kind, i.totalAmount])).toEqual([
        ['PACKAGE', '9000.00'],
        ['ASSESSMENT_FEE', '1000.00'],
      ]);
      expect(d.items[1].description).toMatch(/^Initial OT Assessment · /);

      // Percentage discounts per line and on the invoice, and tax on what remains.
      await ok(s.admin.patch('/billing/settings', { taxRate: '7.5' }));
      const taxed = await draft(s, {
        patientId: s.ayaan.id,
        items: [
          {
            kind: 'OTHER',
            serviceId: s.services.report.id,
            quantity: 3,
            discountType: 'PERCENTAGE',
            discountValue: '10',
          },
          { kind: 'OTHER', description: 'Worksheet pack', unitPrice: '0.10' },
          { kind: 'OTHER', description: 'Stickers', unitPrice: '0.20' },
        ],
        discountType: 'PERCENTAGE',
        discountValue: '12.5',
      });
      // 600 − 60 + 0.30 = 540.30; −12.5% (67.54) = 472.76; +7.5% (35.46) = 508.22
      expect(taxed).toMatchObject({
        subtotal: '600.30',
        discountAmount: '127.54',
        taxAmount: '35.46',
        totalAmount: '508.22',
      });

      // Front desk invoices at catalog prices; discounts and other prices are managers'.
      const noDiscount = await fails(
        s.desk.post('/invoices', {
          ...other(s),
          discountType: 'FIXED',
          discountValue: '10',
        }),
        403,
      );
      expect(noDiscount.errors).toHaveProperty('discountValue');
      await fails(
        s.desk.post(
          '/invoices',
          other(s, [
            {
              kind: 'OTHER',
              serviceId: s.services.report.id,
              unitPrice: '150',
            },
          ]),
        ),
        403,
      );
      await draft(
        s,
        other(s, [
          { kind: 'OTHER', serviceId: s.services.report.id, unitPrice: '150' },
        ]),
        s.manager,
      );
      // Totals can't go negative.
      const negative = await fails(
        s.admin.post('/invoices', {
          ...other(s),
          discountType: 'FIXED',
          discountValue: '250',
        }),
        400,
      );
      expect(negative.errors).toHaveProperty('discountValue');

      // Draft edits replace lines and recompute; a stale revision is refused.
      const edited = await ok<Invoice>(
        s.admin.patch(`/invoices/${d.id}`, {
          revision: d.revision,
          items: [{ kind: 'PACKAGE', packageEnrollmentId: e.id }],
          discountType: null,
        }),
      );
      expect(edited).toMatchObject({
        totalAmount: '9000.00',
        revision: d.revision + 1,
      });
      const stale = await fails(
        s.admin.patch(`/invoices/${d.id}`, {
          revision: d.revision,
          notes: 'x',
        }),
        409,
      );
      expect(stale.code).toBe('INVOICE_CHANGED');

      const issuedInv = await ok<Invoice>(
        s.desk.post(`/invoices/${d.id}/issue`),
      );
      expect(issuedInv).toMatchObject({
        status: 'ISSUED',
        number: 'INV-000001',
        outstanding: '9000.00',
      });
      // Issuing twice changes nothing.
      expect(
        (await ok<Invoice>(s.desk.post(`/invoices/${d.id}/issue`))).number,
      ).toBe('INV-000001');
      expect(issuedInv.history.map((h) => h.action)).toEqual([
        'invoice.draft_created',
        'invoice.draft_updated',
        'invoice.issued',
      ]);

      // Issued terms are fixed, by the API and by the database.
      const locked = await fails(
        s.admin.patch(`/invoices/${d.id}`, { notes: 'later' }),
        409,
      );
      expect(locked.code).toBe('INVOICE_ISSUED');
      await fails(s.admin.delete(`/invoices/${d.id}`), 409);
      await expect(
        prisma.invoice.update({
          where: { id: d.id },
          data: { totalAmount: '1' },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.invoiceItem.deleteMany({ where: { invoiceId: d.id } }),
      ).rejects.toThrow();
      await expect(
        prisma.invoice.delete({ where: { id: d.id } }),
      ).rejects.toThrow();

      // A draft can be discarded, freeing what it held.
      await ok(s.admin.delete(`/invoices/${taxed.id}`), 204);
      await fails(s.admin.get(`/invoices/${taxed.id}`), 404);
    });

    it('never bills the same event twice, and refuses sessions a package pays for', async () => {
      const s = await setup();
      const e = await enrollment(s);
      const first = await issued(s, {
        patientId: s.ayaan.id,
        items: [{ kind: 'PACKAGE', packageEnrollmentId: e.id }],
      });
      // "Generate invoice" clicked again.
      const again = await fails(
        s.desk.post('/invoices', {
          patientId: s.ayaan.id,
          items: [{ kind: 'PACKAGE', packageEnrollmentId: e.id }],
        }),
        409,
      );
      expect(again).toMatchObject({
        code: 'ALREADY_INVOICED',
        invoiceNumber: first.number,
      });
      // Twice on one invoice.
      const session = await book(s);
      await complete(s, session.id);
      const twice = await fails(
        s.admin.post('/invoices', {
          patientId: s.ayaan.id,
          items: [
            { kind: 'SESSION_FEE', appointmentId: session.id },
            { kind: 'SESSION_FEE', appointmentId: session.id },
          ],
        }),
        400,
      );
      expect(twice.code).toBe('DUPLICATE_LINE');
      // Two invoices for the same session at once: the database lets one through.
      const results = await Promise.all(
        [s.admin, s.desk].map((b) =>
          b.post('/invoices', {
            patientId: s.ayaan.id,
            items: [{ kind: 'SESSION_FEE', appointmentId: session.id }],
          }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);

      // A package-covered session isn't charged as a standalone session…
      const covered = await book(s, {
        startTime: '14:00',
        packageEnrollmentId: e.id,
      });
      await complete(s, covered.id);
      const refused = await fails(
        s.admin.post('/invoices', {
          patientId: s.ayaan.id,
          items: [{ kind: 'SESSION_FEE', appointmentId: covered.id }],
        }),
        409,
      );
      expect(refused.code).toBe('SESSION_COVERED_BY_PACKAGE');
      // …unless an authorized extra charge is added, which front desk can't.
      await fails(
        s.desk.post('/invoices', {
          patientId: s.ayaan.id,
          items: [
            {
              kind: 'ADDITIONAL_FEE',
              appointmentId: covered.id,
              description: 'Extended session',
              unitPrice: '300',
            },
          ],
        }),
        403,
      );
      await draft(
        s,
        {
          patientId: s.ayaan.id,
          items: [
            {
              kind: 'ADDITIONAL_FEE',
              appointmentId: covered.id,
              description: 'Extended session',
              unitPrice: '300',
            },
          ],
        },
        s.manager,
      );

      // The enrollment's price snapshot is what's invoiced; catalog edits don't change it.
      const pkg = await prisma.packageEnrollment.findUniqueOrThrow({
        where: { id: e.id },
        select: { packageId: true },
      });
      await ok(s.admin.patch(`/packages/${pkg.packageId}`, { price: '12000' }));
      expect((await invoice(s, first.id)).items[0].unitPrice).toBe('9000.00');
      // Discounts are agreed on the enrollment, not on the invoice.
      const v = await ok<{ invoice: Invoice }>(
        s.manager.post(`/invoices/${first.id}/void`, {
          reason: 'Wrong patient',
        }),
      );
      expect(v.invoice.status).toBe('VOID');
      const fixed = await fails(
        s.admin.post('/invoices', {
          patientId: s.ayaan.id,
          items: [
            { kind: 'PACKAGE', packageEnrollmentId: e.id, unitPrice: '8000' },
          ],
        }),
        400,
      );
      expect(fixed.code).toBe('PACKAGE_TERMS_FIXED');
      // Voiding freed the enrollment for a new invoice.
      await issued(s, {
        patientId: s.ayaan.id,
        items: [{ kind: 'PACKAGE', packageEnrollmentId: e.id }],
      });
      // Another patient's records can't be charged to Ayaan.
      const zaraSession = await book(s, {
        patientId: s.zara.id,
        startTime: '16:00',
      });
      const foreign = await fails(
        s.admin.post('/invoices', {
          patientId: s.ayaan.id,
          items: [{ kind: 'SESSION_FEE', appointmentId: zaraSession.id }],
        }),
        400,
      );
      expect(foreign.code).toBe('APPOINTMENT_NOT_FOUND');
    });

    it('lists what is still to invoice, prices assessments and sessions, and invoices them', async () => {
      const s = await setup();
      const e = await enrollment(s);
      const assessment = await book(s, {
        type: 'ASSESSMENT',
        durationMinutes: 60,
        date: nextWorkday(2),
      });
      const done = await book(s);
      await complete(s, done.id);
      const slt = await book(s, {
        therapyTypeId: s.t.SLT,
        durationMinutes: 30,
        startTime: '12:00',
      });
      await complete(s, slt.id);
      const upcoming = await book(s, { date: nextWorkday(3) });
      const covered = await book(s, {
        startTime: '15:00',
        packageEnrollmentId: e.id,
      });
      await complete(s, covered.id);

      const { items } = await ok<{ items: Charge[] }>(
        s.desk.get(`/billing/charges?patientId=${s.ayaan.id}`),
      );
      const byKey = (id: string) =>
        items.find(
          (c) => c.appointmentId === id || c.packageEnrollmentId === id,
        );
      expect(byKey(e.id)).toMatchObject({
        kind: 'PACKAGE',
        unitPrice: '9000.00',
      });
      expect(byKey(assessment.id)).toMatchObject({
        kind: 'ASSESSMENT_FEE',
        unitPrice: '1000.00',
      });
      // The therapy's own service wins over the general one, which covers the rest.
      expect(byKey(done.id)).toMatchObject({
        kind: 'SESSION_FEE',
        unitPrice: '800.00',
      });
      expect(byKey(slt.id)).toMatchObject({
        kind: 'SESSION_FEE',
        unitPrice: '700.00',
      });
      expect(byKey(upcoming.id)).toBeUndefined();
      expect(byKey(covered.id)).toBeUndefined();
      const advance = await ok<{ items: Charge[] }>(
        s.desk.get(
          `/billing/charges?patientId=${s.ayaan.id}&includeUpcoming=true`,
        ),
      );
      expect(advance.items.some((c) => c.appointmentId === upcoming.id)).toBe(
        true,
      );

      // No assessment service for SLT: the charge says why it can't be priced.
      const sltAssessment = await book(s, {
        type: 'ASSESSMENT',
        therapyTypeId: s.t.SLT,
        durationMinutes: 30,
        date: nextWorkday(4),
      });
      const unpriced = (
        await ok<{ items: Charge[] }>(
          s.desk.get(`/billing/charges?patientId=${s.ayaan.id}`),
        )
      ).items.find((c) => c.appointmentId === sltAssessment.id);
      expect(unpriced?.unitPrice).toBeNull();
      expect(unpriced?.problem).toMatch(/No active service/);
      const noPrice = await fails(
        s.desk.post('/invoices', {
          patientId: s.ayaan.id,
          items: [{ kind: 'ASSESSMENT_FEE', appointmentId: sltAssessment.id }],
        }),
        400,
      );
      expect(noPrice.code).toBe('NO_SERVICE_PRICE');

      // Invoicing them all at once clears the list (advance invoicing of the upcoming one too).
      const inv = await issued(
        s,
        {
          patientId: s.ayaan.id,
          items: [
            { kind: 'PACKAGE', packageEnrollmentId: e.id },
            { kind: 'ASSESSMENT_FEE', appointmentId: assessment.id },
            { kind: 'SESSION_FEE', appointmentId: done.id },
            { kind: 'SESSION_FEE', appointmentId: slt.id },
            { kind: 'SESSION_FEE', appointmentId: upcoming.id },
          ],
        },
        s.desk,
      );
      expect(inv.totalAmount).toBe('12300.00');
      const left = await ok<{ items: Charge[] }>(
        s.desk.get(
          `/billing/charges?patientId=${s.ayaan.id}&includeUpcoming=true`,
        ),
      );
      expect(left.items.map((c) => c.appointmentId)).toEqual([
        sltAssessment.id,
      ]);

      // A cancelled appointment on a draft is caught when issuing.
      const later = await book(s, { date: nextWorkday(5) });
      const d = await draft(s, {
        patientId: s.ayaan.id,
        items: [{ kind: 'SESSION_FEE', appointmentId: later.id }],
      });
      await ok(
        s.admin.patch(`/appointments/${later.id}/cancel`, {
          reason: 'PATIENT_REQUEST',
        }),
      );
      const cancelled = await fails(
        s.admin.post(`/invoices/${d.id}/issue`),
        409,
      );
      expect(cancelled.code).toBe('APPOINTMENT_CANCELLED');
    });
  });

  // ── Payments ──────────────────────────────────────────────────────────────

  describe('payments', () => {
    it('records full and partial payments, across invoices, with receipts', async () => {
      const s = await setup();
      const e = await enrollment(s);
      const pkg = await issued(s, {
        patientId: s.ayaan.id,
        items: [{ kind: 'PACKAGE', packageEnrollmentId: e.id }],
      });
      // The spec's example: 9,000, then 4,000 and 3,000 leave 2,000.
      const first = await ok<Payment>(
        pay(s, {
          amount: '4000',
          allocations: [{ invoiceId: pkg.id, amount: '4000' }],
        }),
        201,
      );
      expect(first).toMatchObject({
        number: 'RCP-000001',
        allocatedAmount: '4000.00',
        unappliedAmount: '0.00',
        verified: false,
      });
      expect(await invoice(s, pkg.id)).toMatchObject({
        status: 'PARTIALLY_PAID',
        outstanding: '5000.00',
      });
      await ok(
        pay(s, {
          amount: '3000',
          methodId: s.method.bKash,
          transactionReference: 'TX123',
          allocations: [{ invoiceId: pkg.id, amount: '3000' }],
        }),
        201,
      );
      expect(await invoice(s, pkg.id)).toMatchObject({
        paidAmount: '7000.00',
        outstanding: '2000.00',
      });

      // One payment across two invoices.
      const report = await issued(s, other(s));
      const both = await ok<Payment>(
        pay(s, {
          amount: '2200',
          allocations: [
            { invoiceId: pkg.id, amount: '2000' },
            { invoiceId: report.id, amount: '200' },
          ],
        }),
        201,
      );
      expect(both.allocations).toHaveLength(2);
      expect((await invoice(s, pkg.id)).status).toBe('PAID');
      expect((await invoice(s, report.id)).status).toBe('PAID');

      // Reference needed for bKash; nothing for paid invoices; zero and negative amounts refused.
      const ref = await fails(
        pay(s, { amount: '10', methodId: s.method.bKash }),
        400,
      );
      expect(ref.code).toBe('REFERENCE_REQUIRED');
      const paidUp = await fails(
        pay(s, {
          amount: '10',
          allocations: [{ invoiceId: pkg.id, amount: '10' }],
        }),
        409,
      );
      expect(paidUp.code).toBe('INVOICE_NOT_OPEN');
      await fails(pay(s, { amount: '0' }), 400);
      await fails(pay(s, { amount: '-5' }), 400);
      await fails(pay(s, { amount: '10.005' }), 400);

      const receipt = await ok<{ center: { name: string }; payment: Payment }>(
        s.desk.get(`/payments/${first.id}/receipt`),
      );
      expect(receipt.center.name).toMatch(/Shishu Bikash/);
      expect(receipt.payment).toMatchObject({
        number: 'RCP-000001',
        method: { name: 'Cash' },
        verified: false,
      });
      const audit = await prisma.auditLog.count({
        where: { action: 'payment.collected' },
      });
      expect(audit).toBe(3);
    });

    it('refuses invalid and excess allocations, and records a retried submission once', async () => {
      const s = await setup();
      const inv = await issued(
        s,
        other(s, [
          { kind: 'OTHER', description: 'Therapy kit', unitPrice: '1000' },
        ]),
      );
      const over = await fails(
        pay(s, {
          amount: '1500',
          allocations: [{ invoiceId: inv.id, amount: '1500' }],
        }),
        409,
      );
      expect(over.code).toBe('INVOICE_OVERPAYMENT');
      const sum = await fails(
        pay(s, {
          amount: '500',
          allocations: [{ invoiceId: inv.id, amount: '600' }],
        }),
        400,
      );
      expect(sum.errors).toHaveProperty('amount');
      const zaraInv = await issued(s, {
        patientId: s.zara.id,
        items: [{ kind: 'OTHER', description: 'Kit', unitPrice: '100' }],
      });
      const foreign = await fails(
        pay(s, {
          amount: '100',
          allocations: [{ invoiceId: zaraInv.id, amount: '100' }],
        }),
        400,
      );
      expect(foreign.code).toBe('INVOICE_NOT_FOUND');
      // The database refuses a cross-patient allocation even if the service were bypassed.
      const p = await ok<Payment>(pay(s, { amount: '100' }), 201);
      await expect(
        prisma.paymentAllocation.create({
          data: {
            centerId: s.center.id,
            paymentId: p.id,
            invoiceId: zaraInv.id,
            amount: '100',
            createdById: (await prisma.user.findFirstOrThrow()).id,
          },
        }),
      ).rejects.toThrow();
      const d = await draft(s, other(s));
      const notIssued = await fails(
        pay(s, {
          amount: '200',
          allocations: [{ invoiceId: d.id, amount: '200' }],
        }),
        409,
      );
      expect(notIssued.code).toBe('INVOICE_NOT_OPEN');

      const requestId = '6f1c1a0e-8f6d-4d0b-9b8e-0c7e2a3b4c5d';
      const body = {
        amount: '1000',
        requestId,
        allocations: [{ invoiceId: inv.id, amount: '1000' }],
      };
      const [a, b] = await Promise.all([pay(s, body), pay(s, body)]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect((a.body as Payment).id).toBe((b.body as Payment).id);
      expect(await prisma.payment.count({ where: { requestId } })).toBe(1);

      // Partial payments can be switched off.
      const inv2 = await issued(
        s,
        other(s, [{ kind: 'OTHER', description: 'Kit', unitPrice: '1000' }]),
      );
      await ok(
        s.admin.patch('/billing/settings', {
          allowPartialPayment: false,
          allowAdvancePayment: false,
        }),
      );
      const partial = await fails(
        pay(s, {
          amount: '400',
          allocations: [{ invoiceId: inv2.id, amount: '400' }],
        }),
        400,
      );
      expect(partial.code).toBe('PARTIAL_PAYMENTS_OFF');
      const advance = await fails(pay(s, { amount: '400' }), 400);
      expect(advance.code).toBe('ADVANCE_PAYMENTS_OFF');
    });

    it('lets only one of two concurrent payments take the remaining balance', async () => {
      const s = await setup();
      const inv = await issued(
        s,
        other(s, [{ kind: 'OTHER', description: 'Kit', unitPrice: '5000' }]),
      );
      const results = await Promise.all(
        [s.desk, s.manager, s.admin].map((b) =>
          pay(
            s,
            {
              amount: '5000',
              allocations: [{ invoiceId: inv.id, amount: '5000' }],
            },
            b,
          ),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      const final = await invoice(s, inv.id);
      expect(final).toMatchObject({ paidAmount: '5000.00', status: 'PAID' });
      // The losers left no payment behind.
      expect(
        await prisma.payment.count({ where: { patientId: s.ayaan.id } }),
      ).toBe(1);
    });

    it('keeps advance payments as credit, applies it once, and moves misapplied money', async () => {
      const s = await setup();
      // The spec's example: 5,000 deposited, then a 1,000 and a 3,000 invoice.
      const deposit = await ok<Payment>(pay(s, { amount: '5000' }), 201);
      expect(deposit.unappliedAmount).toBe('5000.00');
      const assessment = await issued(
        s,
        other(s, [
          { kind: 'OTHER', description: 'Assessment', unitPrice: '1000' },
        ]),
      );
      const therapy = await issued(
        s,
        other(s, [
          { kind: 'OTHER', description: 'Therapy', unitPrice: '3000' },
        ]),
      );
      expect((await invoice(s, assessment.id)).patientCredit).toBe('5000.00');
      await ok(
        s.desk.post(`/invoices/${assessment.id}/apply-credit`, {
          amount: '1000',
        }),
      );
      await ok(
        s.desk.post(`/payments/${deposit.id}/allocations`, {
          allocations: [{ invoiceId: therapy.id, amount: '3000' }],
        }),
      );
      const summary = await ok<{
        unappliedCredit: string;
        outstanding: string;
      }>(s.desk.get(`/patients/${s.ayaan.id}/billing-summary`));
      expect(summary).toMatchObject({
        unappliedCredit: '1000.00',
        outstanding: '0.00',
      });

      // Credit can't be spent twice, even by concurrent requests.
      const big = await issued(
        s,
        other(s, [{ kind: 'OTHER', description: 'Kit', unitPrice: '2000' }]),
      );
      const tooMuch = await fails(
        s.desk.post(`/invoices/${big.id}/apply-credit`, { amount: '1500' }),
        409,
      );
      expect(tooMuch.code).toBe('INSUFFICIENT_CREDIT');
      const results = await Promise.all(
        [s.desk, s.manager].map((b) =>
          b.post(`/invoices/${big.id}/apply-credit`, { amount: '1000' }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await payment(s, deposit.id)).unappliedAmount).toBe('0.00');
      // Credit belongs to its patient only.
      const zaraInv = await issued(s, {
        patientId: s.zara.id,
        items: [{ kind: 'OTHER', description: 'Kit', unitPrice: '100' }],
      });
      await fails(
        s.desk.post(`/invoices/${zaraInv.id}/apply-credit`, { amount: '100' }),
        409,
      );

      // Money applied to the wrong invoice is released (kept, with a reason) and reapplied.
      const p = await payment(s, deposit.id);
      const wrong = p.allocations.find((a) => a.invoice.id === big.id)!;
      await fails(
        s.desk.post(`/payments/${deposit.id}/allocations/${wrong.id}/release`, {
          reason: 'Wrong invoice',
        }),
        403,
      );
      const released = await ok<Payment>(
        s.manager.post(
          `/payments/${deposit.id}/allocations/${wrong.id}/release`,
          { reason: 'Wrong invoice' },
        ),
      );
      expect(released.unappliedAmount).toBe('1000.00');
      expect(released.allocations.find((a) => a.id === wrong.id)?.active).toBe(
        false,
      );
      expect(await invoice(s, big.id)).toMatchObject({
        status: 'ISSUED',
        paidAmount: '0.00',
      });
      await fails(
        s.manager.post(
          `/payments/${deposit.id}/allocations/${wrong.id}/release`,
          { reason: 'Again' },
        ),
        409,
      );
    });
  });

  // ── Refunds and reversals ─────────────────────────────────────────────────

  describe('refunds and reversals', () => {
    it('refunds unapplied money once, never more, and keeps the payment', async () => {
      const s = await setup();
      const inv = await issued(
        s,
        other(s, [{ kind: 'OTHER', description: 'Kit', unitPrice: '3000' }]),
      );
      const p = await ok<Payment>(
        pay(s, {
          amount: '5000',
          allocations: [{ invoiceId: inv.id, amount: '3000' }],
        }),
        201,
      );
      await fails(
        s.desk.post(`/payments/${p.id}/refund`, {
          amount: '100',
          methodId: s.method.Cash,
          reason: 'Overpaid',
        }),
        403,
      );
      const tooMuch = await fails(
        s.manager.post(`/payments/${p.id}/refund`, {
          amount: '2500',
          methodId: s.method.Cash,
          reason: 'Overpaid',
        }),
        409,
      );
      expect(tooMuch).toMatchObject({
        code: 'REFUND_EXCEEDS_AVAILABLE',
        refundable: '2000.00',
      });
      await fails(
        s.manager.post(`/payments/${p.id}/refund`, {
          amount: '100',
          methodId: s.method.Cash,
          reason: '',
        }),
        400,
      );
      const requestId = 'a1b2c3d4-0000-4000-8000-000000000001';
      const body = {
        amount: '1500',
        methodId: s.method.Cash,
        reason: 'Package cancelled',
        requestId,
      };
      const [a, b] = await Promise.all([
        s.manager.post(`/payments/${p.id}/refund`, body),
        s.manager.post(`/payments/${p.id}/refund`, body),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const after = await payment(s, p.id);
      expect(after).toMatchObject({
        amount: '5000.00',
        refundedAmount: '1500.00',
        unappliedAmount: '500.00',
        status: 'RECORDED',
      });
      expect(after.refunds).toHaveLength(1);
      // Two different refunds racing for the last 500.
      const race = await Promise.all(
        [1, 2].map(() =>
          s.manager.post(`/payments/${p.id}/refund`, {
            amount: '500',
            methodId: s.method.Cash,
            reason: 'Rest',
          }),
        ),
      );
      expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
      // The invoice it paid is untouched; refund rows can't be edited.
      expect((await invoice(s, inv.id)).status).toBe('PAID');
      await expect(
        prisma.refund.deleteMany({ where: { paymentId: p.id } }),
      ).rejects.toThrow();
      await expect(
        prisma.payment.update({ where: { id: p.id }, data: { amount: '1' } }),
      ).rejects.toThrow();
    });

    it('reverses a payment recorded in error, reopening its invoices', async () => {
      const s = await setup();
      const inv = await issued(
        s,
        other(s, [{ kind: 'OTHER', description: 'Kit', unitPrice: '1000' }]),
      );
      const p = await ok<Payment>(
        pay(s, {
          amount: '1000',
          allocations: [{ invoiceId: inv.id, amount: '1000' }],
        }),
        201,
      );
      await fails(
        s.desk.post(`/payments/${p.id}/reverse`, { reason: 'Entered twice' }),
        403,
      );
      const reversed = await ok<Payment>(
        s.manager.post(`/payments/${p.id}/reverse`, {
          reason: 'Entered twice',
        }),
      );
      expect(reversed).toMatchObject({
        status: 'REVERSED',
        allocatedAmount: '0.00',
        unappliedAmount: '0.00',
      });
      expect(await invoice(s, inv.id)).toMatchObject({
        status: 'ISSUED',
        outstanding: '1000.00',
      });
      await fails(
        s.manager.post(`/payments/${p.id}/reverse`, { reason: 'Again' }),
        409,
      );
      // A refunded payment can't be reversed.
      const q = await ok<Payment>(pay(s, { amount: '300' }), 201);
      await ok(
        s.manager.post(`/payments/${q.id}/refund`, {
          amount: '100',
          methodId: s.method.Cash,
          reason: 'Change',
        }),
      );
      const refunded = await fails(
        s.manager.post(`/payments/${q.id}/reverse`, { reason: 'Oops' }),
        409,
      );
      expect(refunded.code).toBe('PAYMENT_HAS_REFUNDS');
    });

    it('voids invoices, turning their payments into credit, and reissues a corrected draft', async () => {
      const s = await setup();
      const e = await enrollment(s);
      const inv = await issued(s, {
        patientId: s.ayaan.id,
        items: [{ kind: 'PACKAGE', packageEnrollmentId: e.id }],
      });
      await ok(
        pay(s, {
          amount: '5000',
          allocations: [{ invoiceId: inv.id, amount: '5000' }],
        }),
        201,
      );
      await fails(
        s.desk.post(`/invoices/${inv.id}/void`, { reason: 'Mistake' }),
        403,
      );
      await fails(s.manager.post(`/invoices/${inv.id}/void`, {}), 400);
      const result = await ok<{ invoice: Invoice; reissueId: string }>(
        s.manager.post(`/invoices/${inv.id}/void`, {
          reason: 'Wrong discount',
          reissue: true,
        }),
      );
      expect(result.invoice).toMatchObject({
        status: 'VOID',
        paidAmount: '0.00',
        outstanding: '0.00',
        patientCredit: '5000.00',
      });
      expect(result.invoice.allocations[0]).toMatchObject({
        active: false,
        releaseReason: 'INVOICE_VOIDED',
      });
      expect(result.invoice.items[0].active).toBe(false);
      const copy = await invoice(s, result.reissueId);
      expect(copy).toMatchObject({ status: 'DRAFT', totalAmount: '9000.00' });
      // The package isn't touched by billing: its sessions are still all there.
      const enrolled = await ok<{
        status: string;
        sessions: { remaining: number };
      }>(s.admin.get(`/package-enrollments/${e.id}`));
      expect(enrolled).toMatchObject({
        status: 'ACTIVE',
        sessions: { remaining: 12 },
      });
      await fails(
        s.manager.post(`/invoices/${inv.id}/void`, { reason: 'Again' }),
        409,
      );
      await expect(
        prisma.invoice.update({
          where: { id: inv.id },
          data: { status: 'ISSUED' },
        }),
      ).rejects.toThrow();
    });
  });

  // ── Expenses ──────────────────────────────────────────────────────────────

  describe('expenses', () => {
    it('records, filters, corrects with history and voids expenses', async () => {
      const s = await setup();
      const cats = await ok<{ items: { id: string; name: string }[] }>(
        s.manager.get('/billing/expense-categories'),
      );
      const cat = Object.fromEntries(cats.items.map((c) => [c.name, c.id]));
      await fails(s.desk.get('/expenses'), 403);
      const body = {
        categoryId: cat.Rent,
        expenseDate: daysFromToday(-2),
        description: 'October rent',
        amount: '25000',
        methodId: s.method['Bank transfer'],
      };
      await fails(s.manager.post('/expenses', { ...body, amount: '0' }), 400);
      await fails(
        s.manager.post('/expenses', { ...body, expenseDate: daysFromToday(3) }),
        400,
      );
      const rent = await ok<{ id: string; amount: string; revision: number }>(
        s.manager.post('/expenses', body),
        201,
      );
      await ok(
        s.manager.post('/expenses', {
          categoryId: cat.Supplies,
          expenseDate: daysFromToday(0),
          description: 'Therapy putty',
          amount: '1250.50',
          methodId: s.method.Cash,
        }),
        201,
      );
      const filtered = await ok<{
        items: { id: string }[];
        totalAmount: string;
      }>(s.manager.get(`/expenses?categoryId=${cat.Rent}`));
      expect(filtered.items.map((i) => i.id)).toEqual([rent.id]);
      const all = await ok<{ total: number; totalAmount: string }>(
        s.manager.get(
          `/expenses?from=${daysFromToday(-5)}&to=${daysFromToday(0)}`,
        ),
      );
      expect(all).toMatchObject({ total: 2, totalAmount: '26250.50' });

      await fails(
        s.manager.patch(`/expenses/${rent.id}`, { amount: '24000' }),
        400,
      );
      const corrected = await ok<{
        amount: string;
        revisions: { changed: string[]; before: { amount: string } }[];
      }>(
        s.manager.patch(`/expenses/${rent.id}`, {
          amount: '24000',
          reason: 'Typo in amount',
          revision: rent.revision,
        }),
      );
      expect(corrected.amount).toBe('24000.00');
      expect(corrected.revisions[0]).toMatchObject({
        changed: ['amount'],
        before: { amount: '25000.00' },
      });
      const voided = await ok<{ status: string }>(
        s.manager.post(`/expenses/${rent.id}/void`, {
          reason: 'Duplicate entry',
        }),
      );
      expect(voided.status).toBe('VOID');
      await fails(
        s.manager.patch(`/expenses/${rent.id}`, {
          amount: '1',
          reason: 'Late',
        }),
        409,
      );
      // Kept, never deleted, and out of the totals.
      await expect(
        prisma.expense.delete({ where: { id: rent.id } }),
      ).rejects.toThrow();
      const after = await ok<{ total: number; totalAmount: string }>(
        s.manager.get('/expenses'),
      );
      expect(after).toMatchObject({ total: 2, totalAmount: '1250.50' });
    });
  });

  // ── Automatic invoicing ───────────────────────────────────────────────────

  describe('billing policies', () => {
    it('invoices enrollments, assessments and uncovered sessions when the policy says so', async () => {
      const s = await setup();
      // Manual by default: nothing is invoiced on its own.
      const manual = await book(s, {
        type: 'ASSESSMENT',
        durationMinutes: 60,
        date: nextWorkday(2),
      });
      expect(
        await prisma.invoiceItem.count({ where: { appointmentId: manual.id } }),
      ).toBe(0);

      await ok(
        s.admin.patch('/billing/settings', {
          packageBillingPolicy: 'ON_ENROLLMENT',
          assessmentBillingPolicy: 'ON_BOOKING',
          sessionBillingPolicy: 'ON_COMPLETION',
        }),
      );
      const e = await enrollment(s);
      const pkgInvoice = await prisma.invoiceItem.findFirstOrThrow({
        where: { packageEnrollmentId: e.id },
        include: { invoice: true },
      });
      expect(pkgInvoice.invoice).toMatchObject({
        status: 'ISSUED',
        automatic: true,
      });
      expect(pkgInvoice.totalAmount.toFixed(2)).toBe('9000.00');

      const assessment = await book(s, {
        type: 'ASSESSMENT',
        durationMinutes: 60,
        date: nextWorkday(3),
      });
      expect(
        await prisma.invoiceItem.count({
          where: { appointmentId: assessment.id, active: true },
        }),
      ).toBe(1);

      const session = await book(s);
      expect(
        await prisma.invoiceItem.count({
          where: { appointmentId: session.id },
        }),
      ).toBe(0);
      await complete(s, session.id);
      await complete(s, session.id);
      expect(
        await prisma.invoiceItem.count({
          where: { appointmentId: session.id, kind: 'SESSION_FEE' },
        }),
      ).toBe(1);

      // A session the package pays for is never invoiced again.
      const covered = await book(s, {
        startTime: '14:00',
        packageEnrollmentId: e.id,
      });
      await complete(s, covered.id);
      expect(
        await prisma.invoiceItem.count({
          where: { appointmentId: covered.id },
        }),
      ).toBe(0);

      // Without a price the session isn't invoiced, and stays in the charges list.
      const slt = await book(s, {
        therapyTypeId: s.t.ABA,
        durationMinutes: 60,
        startTime: '16:00',
      });
      await ok(
        s.admin.patch(`/billing/services/${s.services.session.id}/status`, {
          isActive: false,
        }),
      );
      await complete(s, slt.id);
      expect(
        await prisma.invoiceItem.count({ where: { appointmentId: slt.id } }),
      ).toBe(0);
      const charges = await ok<{ items: Charge[] }>(
        s.desk.get(`/billing/charges?patientId=${s.ayaan.id}`),
      );
      expect(
        charges.items.find((c) => c.appointmentId === slt.id)?.problem,
      ).toMatch(/No active service/);

      // An unpaid invoice never changes the package's entitlement.
      const enrolled = await ok<{
        status: string;
        sessions: { remaining: number };
      }>(s.admin.get(`/package-enrollments/${e.id}`));
      expect(enrolled).toMatchObject({
        status: 'ACTIVE',
        sessions: { remaining: 11 },
      });
    });
  });

  // ── Access, isolation and history ─────────────────────────────────────────

  describe('access and isolation', () => {
    it('enforces financial permissions per role', async () => {
      const s = await setup();
      const inv = await issued(s, other(s));
      for (const path of [
        '/invoices',
        `/invoices/${inv.id}`,
        '/payments',
        '/billing/settings',
        '/finance/dues',
        `/patients/${s.ayaan.id}/billing-summary`,
      ]) {
        await fails(s.therapistUser.get(path), 403);
      }
      await fails(
        s.therapistUser.post('/payments', {
          patientId: s.ayaan.id,
          amount: '1',
          methodId: s.method.Cash,
        }),
        403,
      );
      await fails(s.desk.get('/finance/summary'), 403);
      await fails(s.desk.get('/finance/package-sales'), 403);
      await ok(s.manager.get('/finance/summary'));
      expect(inv.actions).toMatchObject({ collect: true, void: true });
      const deskView = await ok<Invoice>(s.desk.get(`/invoices/${inv.id}`));
      expect(deskView.actions).toMatchObject({ collect: true, void: false });
    });

    it('keeps each center’s finances to itself', async () => {
      const s = await setup();
      const inv = await issued(s, other(s));
      const p = await ok<Payment>(
        pay(s, {
          amount: '200',
          allocations: [{ invoiceId: inv.id, amount: '200' }],
        }),
        201,
      );
      const outsider = (await registerCenter(app)).browser;
      await fails(outsider.get(`/invoices/${inv.id}`), 404);
      await fails(outsider.get(`/payments/${p.id}`), 404);
      await fails(outsider.get(`/payments/${p.id}/receipt`), 404);
      await fails(
        outsider.post(`/invoices/${inv.id}/void`, { reason: 'Not mine' }),
        404,
      );
      await fails(
        outsider.post(`/payments/${p.id}/refund`, {
          amount: '1',
          methodId: s.method.Cash,
          reason: 'Not mine',
        }),
        404,
      );
      const theirs = await ok<{ items: unknown[] }>(outsider.get('/invoices'));
      expect(theirs.items).toHaveLength(0);
      const summary = await ok<{ collections: string; outstanding: string }>(
        outsider.get('/finance/summary'),
      );
      expect(summary).toMatchObject({
        collections: '0.00',
        outstanding: '0.00',
      });
      // Their own patient can't be paid with this center's invoice.
      const theirPatient = await ok<{ id: string }>(
        outsider.post('/patients', {
          fullName: 'Other',
          contact: {
            contactType: 'GUARDIAN',
            fullName: 'G',
            mobile: '01911-000001',
            relationship: 'MOTHER',
          },
        }),
        201,
      );
      const theirMethods = await ok<{ items: { id: string }[] }>(
        outsider.get('/billing/payment-methods'),
      );
      await fails(
        outsider.post('/payments', {
          patientId: theirPatient.id,
          amount: '200',
          methodId: theirMethods.items[0].id,
          allocations: [{ invoiceId: inv.id, amount: '200' }],
        }),
        400,
      );
      await fails(
        outsider.post('/payments', {
          patientId: theirPatient.id,
          amount: '200',
          methodId: s.method.Cash,
        }),
        400,
      );
    });

    it('keeps financial history after the patient is deactivated or deleted', async () => {
      const s = await setup();
      const inv = await issued(s, other(s));
      await ok(
        s.admin.patch(`/patients/${s.ayaan.id}/status`, { status: 'INACTIVE' }),
      );
      // Dues can still be collected from inactive patients.
      await ok(
        pay(s, {
          amount: '100',
          allocations: [{ invoiceId: inv.id, amount: '100' }],
        }),
        201,
      );
      await ok(s.admin.delete(`/patients/${s.ayaan.id}`), 204);
      const kept = await invoice(s, inv.id);
      expect(kept).toMatchObject({
        status: 'PARTIALLY_PAID',
        patient: { id: s.ayaan.id },
      });
      const listed = await ok<{ items: { patient: { isDeleted: boolean } }[] }>(
        s.admin.get('/invoices'),
      );
      expect(listed.items[0].patient.isDeleted).toBe(true);
      await fails(s.admin.post('/invoices', other(s)), 400);
    });
  });

  // ── Reports ───────────────────────────────────────────────────────────────

  describe('reports', () => {
    it('summarises collections, dues, credit, expenses and cash movement', async () => {
      const s = await setup();
      const e = await enrollment(s);
      const pkg = await issued(s, {
        patientId: s.ayaan.id,
        items: [{ kind: 'PACKAGE', packageEnrollmentId: e.id }],
        dueDate: daysFromToday(10),
      });
      const overdue = await issued(s, {
        patientId: s.zara.id,
        invoiceDate: daysFromToday(-20),
        dueDate: daysFromToday(-12),
        items: [{ kind: 'OTHER', description: 'Kit', unitPrice: '1500' }],
      });
      await ok(
        pay(s, {
          amount: '5000',
          allocations: [{ invoiceId: pkg.id, amount: '5000' }],
        }),
        201,
      );
      await ok(
        pay(
          s,
          {
            amount: '600',
            methodId: s.method.bKash,
            transactionReference: 'B1',
          },
          s.manager,
        ),
        201,
      );
      const wrong = await ok<Payment>(pay(s, { amount: '999' }), 201);
      await ok(
        s.manager.post(`/payments/${wrong.id}/reverse`, {
          reason: 'Entered by mistake',
        }),
      );
      const forRefund = await ok<Payment>(
        pay(s, { patientId: s.zara.id, amount: '300' }),
        201,
      );
      await ok(
        s.manager.post(`/payments/${forRefund.id}/refund`, {
          amount: '300',
          methodId: s.method.Cash,
          reason: 'Returned',
        }),
      );
      const cats = await ok<{ items: { id: string; name: string }[] }>(
        s.manager.get('/billing/expense-categories'),
      );
      await ok(
        s.manager.post('/expenses', {
          categoryId: cats.items[0].id,
          expenseDate: daysFromToday(0),
          description: 'Rent',
          amount: '2000',
          methodId: s.method.Cash,
        }),
        201,
      );

      const sum = await ok<Record<string, unknown>>(
        s.manager.get(
          `/finance/summary?from=${daysFromToday(-30)}&to=${daysFromToday(0)}`,
        ),
      );
      expect(sum).toMatchObject({
        collections: '5900.00',
        todayCollections: '5900.00',
        refunds: '300.00',
        netCollections: '5600.00',
        invoiced: '10500.00',
        outstanding: '5500.00',
        overdue: '1500.00',
        overdueInvoices: 1,
        unappliedCredit: '600.00',
        expenses: '2000.00',
        netCashMovement: '3600.00',
      });
      const cash = (
        sum.byMethod as {
          method: { name: string };
          collected: string;
          net: string;
        }[]
      ).find((m) => m.method.name === 'Cash');
      expect(cash).toMatchObject({ collected: '5300.00', net: '3000.00' });

      const dues = await ok<{
        items: { id: string; aging: string; contact: { mobile: string } }[];
        aging: { bucket: string; outstanding: string }[];
        outstanding: string;
      }>(s.desk.get('/finance/dues'));
      expect(dues.outstanding).toBe('5500.00');
      expect(dues.items.map((i) => i.id)).toEqual([overdue.id, pkg.id]);
      expect(dues.items[0].aging).toBe('DAYS_8_30');
      expect(dues.items[0].contact.mobile).toMatch(/^01811/);
      expect(
        dues.aging.find((a) => a.bucket === 'DAYS_8_30')?.outstanding,
      ).toBe('1500.00');
      const late = await ok<{ items: { id: string }[] }>(
        s.desk.get('/finance/dues?overdue=true'),
      );
      expect(late.items.map((i) => i.id)).toEqual([overdue.id]);
      const byTherapy = await ok<{ items: { id: string }[] }>(
        s.desk.get(`/finance/dues?therapyTypeId=${s.t.OT}`),
      );
      expect(byTherapy.items.map((i) => i.id)).toEqual([pkg.id]);

      // The daily report: everyone's for managers, their own for front desk.
      const daily = await ok<{
        totals: Record<string, unknown>;
        rows: { collector: { fullName: string }; method: { name: string } }[];
      }>(s.manager.get('/finance/collections'));
      expect(daily.totals).toMatchObject({
        payments: 3,
        collected: '5900.00',
        reversedPayments: 1,
        reversed: '999.00',
        refunds: '300.00',
        net: '5600.00',
      });
      const own = await ok<{ totals: Record<string, unknown> }>(
        s.desk.get('/finance/collections'),
      );
      expect(own.totals).toMatchObject({
        payments: 2,
        collected: '5300.00',
        refunds: '0.00',
      });

      const expenses = await ok<{
        total: string;
        categories: { amount: string }[];
      }>(s.manager.get('/finance/expenses-summary'));
      expect(expenses).toMatchObject({ total: '2000.00' });
      const sales = await ok<{
        rows: {
          enrollments: number;
          agreed: string;
          invoiced: string;
          collected: string;
        }[];
      }>(s.manager.get('/finance/package-sales'));
      expect(sales.rows).toEqual([
        expect.objectContaining({
          enrollments: 1,
          agreed: '9000.00',
          invoiced: '9000.00',
          collected: '5000.00',
        }),
      ]);

      // Pagination and filters on the lists.
      const page = await ok<{ items: unknown[]; total: number }>(
        s.manager.get('/payments?pageSize=2&page=1'),
      );
      expect(page).toMatchObject({ total: 4 });
      expect(page.items).toHaveLength(2);
      const reversedOnly = await ok<{ items: { id: string }[] }>(
        s.manager.get('/payments?status=REVERSED'),
      );
      expect(reversedOnly.items.map((p) => p.id)).toEqual([wrong.id]);
      const partly = await ok<{ items: { id: string }[] }>(
        s.manager.get('/invoices?status=PARTIALLY_PAID'),
      );
      expect(partly.items.map((i) => i.id)).toEqual([pkg.id]);
      const found = await ok<{ items: { id: string }[] }>(
        s.manager.get('/invoices?search=zara'),
      );
      expect(found.items.map((i) => i.id)).toEqual([overdue.id]);

      // The printable invoice carries the payer's contact.
      const print = await ok<{ contact: { name: string }; invoice: Invoice }>(
        s.desk.get(`/invoices/${pkg.id}/print`),
      );
      expect(print).toMatchObject({
        contact: { name: 'Nasrin Akter' },
        invoice: { number: pkg.number },
      });
    });
  });
});
