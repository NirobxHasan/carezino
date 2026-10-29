import { Module } from '@nestjs/common';

import { BillingModule } from '../billing/billing.module';
import { CenterSettingsModule } from '../center-settings/center-settings.module';
import { CatalogService } from './catalog.service';
import { EnrollmentsService } from './enrollments.service';
import {
  PackageEnrollmentsController,
  PackagesController,
  PatientPackagesController,
} from './packages.controller';
import { PackageSessions } from './sessions.service';

@Module({
  // BillingModule invoices new enrollments when the center's policy says so.
  imports: [CenterSettingsModule, BillingModule],
  controllers: [
    PackagesController,
    PackageEnrollmentsController,
    PatientPackagesController,
  ],
  providers: [CatalogService, EnrollmentsService, PackageSessions],
  // Booking holds, moves and settles package sessions through PackageSessions.
  exports: [PackageSessions],
})
export class PackagesModule {}
