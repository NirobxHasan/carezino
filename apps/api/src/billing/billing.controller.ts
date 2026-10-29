import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { requestMeta, type TenantContext } from '../auth/auth-context';
import { RequirePermissions, Tenant } from '../auth/decorators';
import {
  AllocatePaymentDto,
  ApplyCreditDto,
  ChargesQuery,
  CollectionsQuery,
  CollectPaymentDto,
  CreateExpenseCategoryDto,
  CreateExpenseDto,
  CreateInvoiceDto,
  CreatePaymentMethodDto,
  CreateServiceDto,
  DuesQuery,
  ListConfigQuery,
  ListExpensesQuery,
  ListInvoicesQuery,
  ListPaymentsQuery,
  ListServicesQuery,
  RangeQuery,
  RefundPaymentDto,
  ReleaseAllocationDto,
  ReversePaymentDto,
  ServiceStatusDto,
  UpdateBillingSettingsDto,
  UpdateExpenseCategoryDto,
  UpdateExpenseDto,
  UpdateInvoiceDto,
  UpdatePaymentMethodDto,
  UpdateServiceDto,
  VoidExpenseDto,
  VoidInvoiceDto,
} from './dto';
import { ExpensesService } from './expenses.service';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';
import { FinanceReportsService } from './reports.service';
import { BillableServicesService } from './services.service';
import { BillingSettingsService } from './settings.service';

const ip = (req: Request) => requestMeta(req).ipAddress;
const Id = (name = 'id') => Param(name, ParseUUIDPipe);

/** Billing configuration: preferences, priced services, payment methods, categories. */
@Controller('billing')
export class BillingController {
  constructor(
    private readonly settings: BillingSettingsService,
    private readonly services: BillableServicesService,
    private readonly invoices: InvoicesService,
  ) {}

  @Get('settings')
  @RequirePermissions('billing.read')
  getSettings(@Tenant() tenant: TenantContext) {
    return this.settings.get(tenant);
  }

  /** Applies to invoices and payments recorded from now on. */
  @Patch('settings')
  @RequirePermissions('billing.read', 'billing_settings.manage')
  updateSettings(
    @Tenant() tenant: TenantContext,
    @Body() dto: UpdateBillingSettingsDto,
    @Req() req: Request,
  ) {
    return this.settings.update(tenant, dto, ip(req));
  }

  @Get('payment-methods')
  @RequirePermissions('billing.read')
  methods(@Tenant() tenant: TenantContext, @Query() query: ListConfigQuery) {
    return this.settings.methods(tenant, query);
  }

  @Post('payment-methods')
  @RequirePermissions('billing.read', 'billing_settings.manage')
  createMethod(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreatePaymentMethodDto,
    @Req() req: Request,
  ) {
    return this.settings.createMethod(tenant, dto, ip(req));
  }

  @Patch('payment-methods/:id')
  @RequirePermissions('billing.read', 'billing_settings.manage')
  updateMethod(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: UpdatePaymentMethodDto,
    @Req() req: Request,
  ) {
    return this.settings.updateMethod(tenant, id, dto, ip(req));
  }

  @Get('expense-categories')
  @RequirePermissions('expenses.read')
  categories(@Tenant() tenant: TenantContext, @Query() query: ListConfigQuery) {
    return this.settings.categories(tenant, query);
  }

  @Post('expense-categories')
  @RequirePermissions('expenses.read', 'billing_settings.manage')
  createCategory(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateExpenseCategoryDto,
    @Req() req: Request,
  ) {
    return this.settings.createCategory(tenant, dto, ip(req));
  }

  @Patch('expense-categories/:id')
  @RequirePermissions('expenses.read', 'billing_settings.manage')
  updateCategory(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: UpdateExpenseCategoryDto,
    @Req() req: Request,
  ) {
    return this.settings.updateCategory(tenant, id, dto, ip(req));
  }

  @Get('services')
  @RequirePermissions('billing.read')
  listServices(
    @Tenant() tenant: TenantContext,
    @Query() query: ListServicesQuery,
  ) {
    return this.services.list(tenant, query);
  }

  @Post('services')
  @RequirePermissions('billing.read', 'billing_services.manage')
  createService(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateServiceDto,
    @Req() req: Request,
  ) {
    return this.services.create(tenant, dto, ip(req));
  }

  @Get('services/:id')
  @RequirePermissions('billing.read')
  getService(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.services.get(tenant, id);
  }

  /** Future invoice lines only: issued ones keep the price they were made with. */
  @Patch('services/:id')
  @RequirePermissions('billing.read', 'billing_services.manage')
  updateService(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: UpdateServiceDto,
    @Req() req: Request,
  ) {
    return this.services.update(tenant, id, dto, ip(req));
  }

  @Patch('services/:id/status')
  @RequirePermissions('billing.read', 'billing_services.manage')
  setServiceStatus(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: ServiceStatusDto,
    @Req() req: Request,
  ) {
    return this.services.setStatus(tenant, id, dto, ip(req));
  }

  /** A patient's packages, assessments and sessions that aren't invoiced yet. */
  @Get('charges')
  @RequirePermissions('invoices.read')
  charges(@Tenant() tenant: TenantContext, @Query() query: ChargesQuery) {
    return this.invoices.charges(tenant, query);
  }
}

/** Invoices. Static routes come before :id. */
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
  ) {}

  @Get()
  @RequirePermissions('invoices.read')
  list(@Tenant() tenant: TenantContext, @Query() query: ListInvoicesQuery) {
    return this.invoices.list(tenant, query);
  }

  /** A draft, or with `issue` an issued invoice; discounts need invoices.discount. */
  @Post()
  @RequirePermissions('invoices.read', 'invoices.create')
  create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateInvoiceDto,
    @Req() req: Request,
  ) {
    return this.invoices.create(tenant, dto, ip(req));
  }

  @Get(':id')
  @RequirePermissions('invoices.read')
  get(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.invoices.get(tenant, id);
  }

  @Get(':id/print')
  @RequirePermissions('invoices.read')
  print(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.invoices.print(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions('invoices.read', 'invoices.create')
  update(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: UpdateInvoiceDto,
    @Req() req: Request,
  ) {
    return this.invoices.update(tenant, id, dto, ip(req));
  }

  /** Drafts only; issued invoices are voided. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('invoices.read', 'invoices.create')
  discard(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Req() req: Request,
  ) {
    return this.invoices.discard(tenant, id, ip(req));
  }

  @Post(':id/issue')
  @HttpCode(200)
  @RequirePermissions('invoices.read', 'invoices.issue')
  issue(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Req() req: Request,
  ) {
    return this.invoices.issue(tenant, id, ip(req));
  }

  @Post(':id/void')
  @HttpCode(200)
  @RequirePermissions('invoices.read', 'invoices.void')
  void(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: VoidInvoiceDto,
    @Req() req: Request,
  ) {
    return this.invoices.void(tenant, id, dto, ip(req));
  }

  /** Pays the invoice from the patient's unapplied credit, oldest payments first. */
  @Post(':id/apply-credit')
  @HttpCode(200)
  @RequirePermissions('invoices.read', 'payments.collect')
  applyCredit(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: ApplyCreditDto,
    @Req() req: Request,
  ) {
    return this.payments.applyCredit(tenant, id, dto, ip(req));
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermissions('payments.read')
  list(@Tenant() tenant: TenantContext, @Query() query: ListPaymentsQuery) {
    return this.payments.list(tenant, query);
  }

  @Post()
  @RequirePermissions('payments.read', 'payments.collect')
  collect(
    @Tenant() tenant: TenantContext,
    @Body() dto: CollectPaymentDto,
    @Req() req: Request,
  ) {
    return this.payments.collect(tenant, dto, ip(req));
  }

  @Get(':id')
  @RequirePermissions('payments.read')
  get(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.payments.get(tenant, id);
  }

  @Get(':id/receipt')
  @RequirePermissions('payments.read')
  receipt(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.payments.receipt(tenant, id);
  }

  @Get(':id/allocations')
  @RequirePermissions('payments.read')
  allocations(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.payments.allocations(tenant, id);
  }

  @Post(':id/allocations')
  @HttpCode(200)
  @RequirePermissions('payments.read', 'payments.collect')
  allocate(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: AllocatePaymentDto,
    @Req() req: Request,
  ) {
    return this.payments.allocate(tenant, id, dto, ip(req));
  }

  @Post(':id/allocations/:allocationId/release')
  @HttpCode(200)
  @RequirePermissions('payments.read', 'payments.reallocate')
  release(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Id('allocationId') allocationId: string,
    @Body() dto: ReleaseAllocationDto,
    @Req() req: Request,
  ) {
    return this.payments.releaseAllocation(
      tenant,
      id,
      allocationId,
      dto,
      ip(req),
    );
  }

  @Post(':id/refund')
  @HttpCode(200)
  @RequirePermissions('payments.read', 'payments.refund')
  refund(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: RefundPaymentDto,
    @Req() req: Request,
  ) {
    return this.payments.refund(tenant, id, dto, ip(req));
  }

  @Post(':id/reverse')
  @HttpCode(200)
  @RequirePermissions('payments.read', 'payments.reverse')
  reverse(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: ReversePaymentDto,
    @Req() req: Request,
  ) {
    return this.payments.reverse(tenant, id, dto, ip(req));
  }
}

@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequirePermissions('expenses.read')
  list(@Tenant() tenant: TenantContext, @Query() query: ListExpensesQuery) {
    return this.expenses.list(tenant, query);
  }

  @Post()
  @RequirePermissions('expenses.read', 'expenses.create')
  create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateExpenseDto,
    @Req() req: Request,
  ) {
    return this.expenses.create(tenant, dto, ip(req));
  }

  @Get(':id')
  @RequirePermissions('expenses.read')
  get(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.expenses.get(tenant, id);
  }

  /** A correction, with a reason; the earlier values are kept. */
  @Patch(':id')
  @RequirePermissions('expenses.read', 'expenses.create')
  update(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: UpdateExpenseDto,
    @Req() req: Request,
  ) {
    return this.expenses.update(tenant, id, dto, ip(req));
  }

  @Post(':id/void')
  @HttpCode(200)
  @RequirePermissions('expenses.read', 'expenses.void')
  void(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: VoidExpenseDto,
    @Req() req: Request,
  ) {
    return this.expenses.void(tenant, id, dto, ip(req));
  }
}

/** Financial summaries. See FinanceReportsService for what each figure means. */
@Controller('finance')
export class FinanceController {
  constructor(private readonly reports: FinanceReportsService) {}

  @Get('summary')
  @RequirePermissions('finance_reports.read')
  summary(@Tenant() tenant: TenantContext, @Query() query: RangeQuery) {
    return this.reports.summary(tenant, query);
  }

  @Get('dues')
  @RequirePermissions('invoices.read')
  dues(@Tenant() tenant: TenantContext, @Query() query: DuesQuery) {
    return this.reports.dues(tenant, query);
  }

  /** Everyone's with finance_reports.read; otherwise the caller's own. */
  @Get('collections')
  @RequirePermissions('finance_reports.read_own')
  collections(
    @Tenant() tenant: TenantContext,
    @Query() query: CollectionsQuery,
  ) {
    return this.reports.collections(tenant, query);
  }

  @Get('expenses-summary')
  @RequirePermissions('finance_reports.read', 'expenses.read')
  expenses(@Tenant() tenant: TenantContext, @Query() query: RangeQuery) {
    return this.reports.expensesSummary(tenant, query);
  }

  @Get('package-sales')
  @RequirePermissions('finance_reports.read')
  packageSales(@Tenant() tenant: TenantContext, @Query() query: RangeQuery) {
    return this.reports.packageSales(tenant, query);
  }
}

@Controller('patients')
export class PatientBillingController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly reports: FinanceReportsService,
  ) {}

  @Get(':id/invoices')
  @RequirePermissions('invoices.read')
  invoicesOf(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.invoices.patientInvoices(tenant, id);
  }

  @Get(':id/payments')
  @RequirePermissions('payments.read')
  paymentsOf(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.payments.patientPayments(tenant, id);
  }

  @Get(':id/billing-summary')
  @RequirePermissions('invoices.read')
  summary(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.reports.patientSummary(tenant, id);
  }
}
