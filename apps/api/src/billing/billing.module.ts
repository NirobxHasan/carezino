import { Module } from '@nestjs/common';

import {
  BillingController,
  ExpensesController,
  FinanceController,
  InvoicesController,
  PatientBillingController,
  PaymentsController,
} from './billing.controller';
import { BillingEvents } from './events.service';
import { ExpensesService } from './expenses.service';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';
import { FinanceReportsService } from './reports.service';
import { BillableServicesService } from './services.service';
import { BillingSettingsService } from './settings.service';

/**
 * Billing and basic accounting. It reads appointments and enrollments directly and
 * imports no other feature module, so packages, appointments and sessions can import
 * it for automatic invoicing (BillingEvents) without a cycle.
 */
@Module({
  controllers: [
    BillingController,
    InvoicesController,
    PaymentsController,
    ExpensesController,
    FinanceController,
    PatientBillingController,
  ],
  providers: [
    BillingSettingsService,
    BillableServicesService,
    InvoicesService,
    PaymentsService,
    ExpensesService,
    FinanceReportsService,
    BillingEvents,
  ],
  exports: [BillingEvents],
})
export class BillingModule {}
