import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  IsMobile,
  NormalizeEmail,
  NormalizeMobile,
  PASSWORD_MAX,
  PASSWORD_MIN,
  Trim,
} from '../common/validation';
import { MembershipStatus, Role } from '../generated/prisma/enums';

export class ListStaffQuery {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ChangeRoleDto {
  @IsEnum(Role, { message: 'Choose a role' })
  role!: Role;
}

export class ChangeStatusDto {
  @IsIn([MembershipStatus.ACTIVE, MembershipStatus.INACTIVE], {
    message: 'Choose a status',
  })
  status!: MembershipStatus;
}

export class InviteStaffDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  @MaxLength(120)
  fullName!: string;

  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @NormalizeMobile()
  @IsMobile()
  mobile?: string;

  @IsEnum(Role, { message: 'Choose a role' })
  role!: Role;
}

export class AcceptInvitationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token!: string;

  /** Only for invitees without an account; existing users accept while signed in. */
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @NormalizeMobile()
  @IsMobile()
  mobile?: string;

  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN, {
    message: `Use at least ${PASSWORD_MIN} characters`,
  })
  @MaxLength(PASSWORD_MAX, {
    message: `Use at most ${PASSWORD_MAX} characters`,
  })
  password?: string;

  @IsOptional()
  @IsString()
  confirmPassword?: string;
}
