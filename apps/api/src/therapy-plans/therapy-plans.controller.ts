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
import { CategoriesService } from './categories.service';
import {
  AddGoalDto,
  AmendReviewDto,
  AssessmentOptionsQuery,
  CategoryStatusDto,
  CompletePlanDto,
  CreateCategoryDto,
  CreatePlanDto,
  CreateReviewDto,
  ListCategoriesQuery,
  ListPlansQuery,
  PatientOptionsQuery,
  ReasonedTransitionDto,
  ReassignPlanDto,
  RecordProgressDto,
  ResumeDto,
  RevisePlanDto,
  TransitionDto,
  UpdateCategoryDto,
  UpdateDraftDto,
  UpdateGoalDto,
} from './dto';
import { GoalsService } from './goals.service';
import { PlansService } from './plans.service';
import { ReviewsService } from './reviews.service';

const ip = (req: Request) => requestMeta(req).ipAddress;
const Id = (name = 'id') => Param(name, ParseUUIDPipe);

/**
 * Therapy plans of the active center. Reads need therapy_plans.read_own at least; the
 * services decide which plans the caller sees and whether with their clinical content
 * (access.ts). Clinical writes are limited to the plan's responsible therapist. Static
 * routes come before :id.
 */
@Controller('therapy-plans')
export class TherapyPlansController {
  constructor(
    private readonly plans: PlansService,
    private readonly goals: GoalsService,
    private readonly reviews: ReviewsService,
  ) {}

  @Get()
  @RequirePermissions('therapy_plans.read_own')
  list(@Tenant() tenant: TenantContext, @Query() query: ListPlansQuery) {
    return this.plans.list(tenant, query);
  }

  /** Patients the caller may start a plan for. */
  @Get('patient-options')
  @RequirePermissions('therapy_plans.create')
  patientOptions(
    @Tenant() tenant: TenantContext,
    @Query() query: PatientOptionsQuery,
  ) {
    return this.plans.patientOptions(tenant, query);
  }

  /** A patient's completed assessments, with recommendations and goals to start from. */
  @Get('assessment-options')
  @RequirePermissions('therapy_plans.create')
  assessmentOptions(
    @Tenant() tenant: TenantContext,
    @Query() query: AssessmentOptionsQuery,
  ) {
    return this.plans.assessmentOptions(tenant, query.patientId);
  }

  @Post()
  @RequirePermissions('therapy_plans.read_own', 'therapy_plans.create')
  create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreatePlanDto,
    @Req() req: Request,
  ) {
    return this.plans.create(tenant, dto, ip(req));
  }

  @Get(':id')
  @RequirePermissions('therapy_plans.read_own')
  get(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.plans.get(tenant, id);
  }

  /** Saves a draft; optional sections may still be empty. */
  @Patch(':id')
  @RequirePermissions('therapy_plans.read_own', 'therapy_plans.update')
  update(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: UpdateDraftDto,
  ) {
    return this.plans.updateDraft(tenant, id, dto);
  }

  /** Drafts only: plans that were ever active are kept. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('therapy_plans.read_own', 'therapy_plans.update')
  discard(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Req() req: Request,
  ) {
    return this.plans.discard(tenant, id, ip(req));
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions('therapy_plans.read_own', 'therapy_plans.activate')
  activate(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: TransitionDto,
    @Req() req: Request,
  ) {
    return this.plans.activate(tenant, id, dto, ip(req));
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermissions('therapy_plans.read_own', 'therapy_plans.manage_status')
  pause(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: ReasonedTransitionDto,
    @Req() req: Request,
  ) {
    return this.plans.pause(tenant, id, dto, ip(req));
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermissions('therapy_plans.read_own', 'therapy_plans.manage_status')
  resume(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: ResumeDto,
    @Req() req: Request,
  ) {
    return this.plans.resume(tenant, id, dto, ip(req));
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermissions('therapy_plans.read_own', 'therapy_plans.manage_status')
  complete(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: CompletePlanDto,
    @Req() req: Request,
  ) {
    return this.plans.complete(tenant, id, dto, ip(req));
  }

  @Post(':id/discontinue')
  @HttpCode(200)
  @RequirePermissions('therapy_plans.read_own', 'therapy_plans.manage_status')
  discontinue(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: ReasonedTransitionDto,
    @Req() req: Request,
  ) {
    return this.plans.discontinue(tenant, id, dto, ip(req));
  }

  @Post(':id/revise')
  @HttpCode(200)
  @RequirePermissions('therapy_plans.read_own', 'therapy_plans.revise')
  revise(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: RevisePlanDto,
    @Req() req: Request,
  ) {
    return this.plans.revise(tenant, id, dto, ip(req));
  }

  @Post(':id/reassign')
  @HttpCode(200)
  @RequirePermissions('therapy_plans.read_own', 'therapy_plans.reassign')
  reassign(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: ReassignPlanDto,
    @Req() req: Request,
  ) {
    return this.plans.reassign(tenant, id, dto, ip(req));
  }

  // ── Goals and progress ────────────────────────────────────────────────────

  @Get(':id/goals')
  @RequirePermissions('therapy_plans.read_own')
  listGoals(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.goals.list(tenant, id);
  }

  /** Draft: therapy_plans.update. Active: therapy_goals.manage and a reason. */
  @Post(':id/goals')
  @RequirePermissions('therapy_plans.read_own')
  addGoal(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: AddGoalDto,
    @Req() req: Request,
  ) {
    return this.goals.add(tenant, id, dto, ip(req));
  }

  @Patch(':id/goals/:goalId')
  @RequirePermissions('therapy_plans.read_own')
  updateGoal(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Id('goalId') goalId: string,
    @Body() dto: UpdateGoalDto,
    @Req() req: Request,
  ) {
    return this.goals.update(tenant, id, goalId, dto, ip(req));
  }

  @Delete(':id/goals/:goalId')
  @HttpCode(204)
  @RequirePermissions('therapy_plans.read_own', 'therapy_plans.update')
  removeGoal(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Id('goalId') goalId: string,
  ) {
    return this.goals.remove(tenant, id, goalId);
  }

  @Get(':id/progress')
  @RequirePermissions('therapy_plans.read_own')
  planProgress(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.goals.planProgress(tenant, id);
  }

  @Get(':id/goals/:goalId/progress')
  @RequirePermissions('therapy_plans.read_own')
  goalProgress(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Id('goalId') goalId: string,
  ) {
    return this.goals.goalProgress(tenant, id, goalId);
  }

  @Post(':id/goals/:goalId/progress')
  @RequirePermissions('therapy_plans.read_own', 'therapy_goals.record_progress')
  recordProgress(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Id('goalId') goalId: string,
    @Body() dto: RecordProgressDto,
    @Req() req: Request,
  ) {
    return this.goals.recordProgress(tenant, id, goalId, dto, ip(req));
  }

  // ── Reviews ───────────────────────────────────────────────────────────────

  @Get(':id/reviews')
  @RequirePermissions('therapy_plans.read_own')
  listReviews(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.reviews.list(tenant, id);
  }

  @Post(':id/reviews')
  @RequirePermissions('therapy_plans.read_own', 'therapy_plans.review')
  createReview(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: CreateReviewDto,
    @Req() req: Request,
  ) {
    return this.reviews.create(tenant, id, dto, ip(req));
  }

  @Get(':id/reviews/:reviewId')
  @RequirePermissions('therapy_plans.read_own')
  getReview(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Id('reviewId') reviewId: string,
  ) {
    return this.reviews.get(tenant, id, reviewId);
  }

  @Post(':id/reviews/:reviewId/amend')
  @HttpCode(200)
  @RequirePermissions('therapy_plans.read_own', 'therapy_plans.review')
  amendReview(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Id('reviewId') reviewId: string,
    @Body() dto: AmendReviewDto,
    @Req() req: Request,
  ) {
    return this.reviews.amend(tenant, id, reviewId, dto, ip(req));
  }
}

/** A patient's therapy plans, in force first. */
@Controller('patients')
export class PatientTherapyPlansController {
  constructor(private readonly plans: PlansService) {}

  @Get(':id/therapy-plans')
  @RequirePermissions('therapy_plans.read_own')
  list(@Tenant() tenant: TenantContext, @Id() id: string) {
    return this.plans.patientPlans(tenant, id);
  }
}

/** The center's goal categories. Anyone working with plans reads them. */
@Controller('therapy-goal-categories')
export class GoalCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermissions('therapy_plans.read_own')
  list(@Tenant() tenant: TenantContext, @Query() query: ListCategoriesQuery) {
    return this.categories.list(tenant, query);
  }

  @Post()
  @RequirePermissions('therapy_goal_categories.manage')
  create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateCategoryDto,
    @Req() req: Request,
  ) {
    return this.categories.create(tenant, dto, ip(req));
  }

  @Patch(':id')
  @RequirePermissions('therapy_goal_categories.manage')
  update(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: UpdateCategoryDto,
    @Req() req: Request,
  ) {
    return this.categories.update(tenant, id, dto, ip(req));
  }

  @Patch(':id/status')
  @RequirePermissions('therapy_goal_categories.manage')
  setStatus(
    @Tenant() tenant: TenantContext,
    @Id() id: string,
    @Body() dto: CategoryStatusDto,
    @Req() req: Request,
  ) {
    return this.categories.setStatus(tenant, id, dto, ip(req));
  }
}
