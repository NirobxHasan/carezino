import { Module } from '@nestjs/common';

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
  imports: [CenterSettingsModule],
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
