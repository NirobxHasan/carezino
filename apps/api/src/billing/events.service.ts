import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../auth/auth-context';
import {
  AppointmentStatus,
  AppointmentType,
  AssessmentBillingPolicy,
  InvoiceItemKind,
  PackageBillingPolicy,
  SessionBillingPolicy,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from './invoices.service';
import { BillingSettingsService } from './settings.service';

/**
 * Automatic invoicing, for centers whose billing policy asks for it. Other modules
 * call these after their own transaction has committed: an enrollment made, an
 * assessment booked, a session completed. Each invoices that one event at most once
 * (the invoice line holds it), never throws, and does nothing under a MANUAL policy.
 * Sessions a package pays for are never invoiced here.
 */
@Injectable()
export class BillingEvents {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: BillingSettingsService,
    private readonly invoices: InvoicesService,
  ) {}

  private async policy(tenant: TenantContext) {
    try {
      return await this.settings.settings(this.prisma, tenant.centerId);
    } catch {
      return null;
    }
  }

  async enrollmentCreated(tenant: TenantContext, enrollmentId: string) {
    const policy = await this.policy(tenant);
    if (policy?.packageBillingPolicy !== PackageBillingPolicy.ON_ENROLLMENT)
      return null;
    const e = await this.prisma.packageEnrollment.findFirst({
      where: { id: enrollmentId, centerId: tenant.centerId },
      select: { patientId: true, finalPrice: true },
    });
    // Nothing to charge for a free package.
    if (!e || e.finalPrice.lte(0)) return null;
    return this.invoices.invoiceEvent(tenant, e.patientId, {
      kind: InvoiceItemKind.PACKAGE,
      packageEnrollmentId: enrollmentId,
    });
  }

  async appointmentBooked(tenant: TenantContext, appointmentId: string) {
    const policy = await this.policy(tenant);
    if (policy?.assessmentBillingPolicy !== AssessmentBillingPolicy.ON_BOOKING)
      return null;
    const a = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, centerId: tenant.centerId },
      select: { patientId: true, type: true, packageEnrollmentId: true },
    });
    if (!a || a.type !== AppointmentType.ASSESSMENT || a.packageEnrollmentId)
      return null;
    return this.invoices.invoiceEvent(tenant, a.patientId, {
      kind: InvoiceItemKind.ASSESSMENT_FEE,
      appointmentId,
    });
  }

  async sessionCompleted(tenant: TenantContext, appointmentId: string) {
    const policy = await this.policy(tenant);
    if (policy?.sessionBillingPolicy !== SessionBillingPolicy.ON_COMPLETION)
      return null;
    const a = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, centerId: tenant.centerId },
      select: { patientId: true, type: true, status: true },
    });
    if (
      !a ||
      a.type !== AppointmentType.THERAPY_SESSION ||
      a.status !== AppointmentStatus.COMPLETED
    ) {
      return null;
    }
    // A session a package paid for is refused by the invoice rules too; this just
    // keeps the log quiet.
    const covered = await this.prisma.packageSessionReservation.count({
      where: { appointmentId, status: { in: ['ACTIVE', 'CONSUMED'] } },
    });
    if (covered) return null;
    return this.invoices.invoiceEvent(tenant, a.patientId, {
      kind: InvoiceItemKind.SESSION_FEE,
      appointmentId,
    });
  }
}
