import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { LIMITS } from '../center-settings/limits';
import { IfPresent, Trim, TrimOrNull } from '../common/validation';

const { min, max } = LIMITS.durationMinutes;
const durationMessage = `Enter a duration between ${min} and ${max} minutes`;

/** Session length in whole minutes, within LIMITS.durationMinutes. */
const IsDuration = () =>
  applyDecorators(
    IsInt({ message: durationMessage }),
    Min(min, { message: durationMessage }),
    Max(max, { message: durationMessage }),
  );

/** Codes are compared and stored upper-cased: "ot " → "OT". */
const NormalizeCode = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  );

const NormalizeColor = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim().toLowerCase();
    return trimmed === '' ? null : trimmed;
  });

const CODE = /^[A-Z0-9][A-Z0-9-]{0,9}$/;
const CODE_MESSAGE = 'Use up to 10 letters, numbers or dashes, e.g. OT';
const COLOR = /^#[0-9a-f]{6}$/;
const COLOR_MESSAGE = 'Choose a colour, e.g. #0d9488';

export class ListTherapyTypesQuery {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class CreateTherapyTypeDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(100)
  name!: string;

  @NormalizeCode()
  @IsString()
  @Matches(CODE, { message: CODE_MESSAGE })
  code!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsDuration()
  defaultDurationMinutes!: number;

  @IsOptional()
  @NormalizeColor()
  @Matches(COLOR, { message: COLOR_MESSAGE })
  color?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Defaults to the end of the list */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;
}

/** Send `null` or an empty string to clear the description or colour. */
export class UpdateTherapyTypeDto {
  @IfPresent()
  @Trim()
  @IsString({ message: 'Name is required' })
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(100)
  name?: string;

  @IfPresent()
  @NormalizeCode()
  @IsString({ message: CODE_MESSAGE })
  @Matches(CODE, { message: CODE_MESSAGE })
  code?: string;

  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IfPresent()
  @IsDuration()
  defaultDurationMinutes?: number;

  @IsOptional()
  @NormalizeColor()
  @Matches(COLOR, { message: COLOR_MESSAGE })
  color?: string | null;

  @IfPresent()
  @IsBoolean()
  isActive?: boolean;

  @IfPresent()
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;
}

export class ChangeTherapyTypeStatusDto {
  @IsBoolean({ message: 'Choose active or inactive' })
  isActive!: boolean;
}

/** Every therapy type of the center, in the new order. */
export class ReorderTherapyTypesDto {
  @IsArray()
  @ArrayMaxSize(LIMITS.therapyTypesPerCenter)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class CreateDurationOptionDto {
  @IsDuration()
  durationMinutes!: number;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  label?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Makes this the therapy type's default duration */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;
}

export class UpdateDurationOptionDto {
  @IfPresent()
  @IsDuration()
  durationMinutes?: number;

  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(60)
  label?: string | null;

  @IfPresent()
  @IsBoolean()
  isActive?: boolean;

  /** There is always one default: make another option the default to change it. */
  @IfPresent()
  @Equals(true, {
    message: 'Make another duration the default instead',
  })
  isDefault?: true;

  @IfPresent()
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;
}
