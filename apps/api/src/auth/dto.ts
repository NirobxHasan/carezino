import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { CenterDetailsDto } from '../centers/dto';
import {
  IsMobile,
  NormalizeEmail,
  NormalizeMobile,
  PASSWORD_MAX,
  PASSWORD_MIN,
  Trim,
} from '../common/validation';

export class NewPasswordDto {
  @IsString()
  @MinLength(PASSWORD_MIN, {
    message: `Use at least ${PASSWORD_MIN} characters`,
  })
  @MaxLength(PASSWORD_MAX, {
    message: `Use at most ${PASSWORD_MAX} characters`,
  })
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'Confirm your password' })
  confirmPassword!: string;
}

export class OwnerDto extends NewPasswordDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  @MaxLength(120)
  fullName!: string;

  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;

  @NormalizeMobile()
  @IsMobile()
  mobile!: string;
}

export class RegisterCenterDto {
  @ValidateNested()
  @Type(() => CenterDetailsDto)
  center!: CenterDetailsDto;

  @ValidateNested()
  @Type(() => OwnerDto)
  owner!: OwnerDto;
}

export class LoginDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Enter your password' })
  @MaxLength(PASSWORD_MAX)
  password!: string;

  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class ForgotPasswordDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto extends NewPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token!: string;
}

export class ChangePasswordDto extends NewPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Enter your current password' })
  @MaxLength(PASSWORD_MAX)
  currentPassword!: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  @MaxLength(120)
  fullName?: string;

  /** Send an empty string to remove the number. */
  @IsOptional()
  @NormalizeMobile({ clearable: true })
  @IsMobile()
  mobile?: string | null;
}

export class AdminLoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Enter your username' })
  @MaxLength(64)
  username!: string;

  @IsString()
  @IsNotEmpty({ message: 'Enter your password' })
  @MaxLength(PASSWORD_MAX)
  password!: string;
}
