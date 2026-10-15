import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';

import {
  IsPhone,
  NormalizeEmail,
  NormalizePhone,
  Trim,
  TrimOrNull,
} from '../common/validation';

const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));
const URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true };

/** "example.com" → "https://example.com"; empty → null so it can be cleared. */
const NormalizeUrl = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (trimmed === '') return null;
    return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
  });

const IsTimezone = () =>
  IsIn([...TIMEZONES], {
    message: 'Choose a valid time zone, e.g. Asia/Dhaka',
  });

/** Fields collected when a center is registered. */
export class CenterDetailsDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Center name is required' })
  @MaxLength(150)
  name!: string;

  @NormalizePhone()
  @IsPhone()
  phone!: string;

  @IsOptional()
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email?: string;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Address is required' })
  @MaxLength(500)
  address!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  district?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  country?: string;

  @IsOptional()
  @Trim()
  @IsTimezone()
  timezone?: string;

  @IsOptional()
  @Trim()
  @Matches(/^[A-Z]{3}$/, { message: 'Use a 3-letter currency code, e.g. BDT' })
  currency?: string;

  @IsOptional()
  @NormalizeUrl()
  @IsUrl(URL_OPTIONS, { message: 'Enter a valid website address' })
  @MaxLength(300)
  website?: string | null;
}

/**
 * Editable center fields. The code, ID and status are deliberately absent, and the
 * whitelisting ValidationPipe rejects them. Send an empty string to clear an optional field.
 */
export class UpdateCenterDto {
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Center name is required' })
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @NormalizePhone()
  @IsPhone()
  phone?: string;

  @IsOptional()
  @NormalizeEmail({ clearable: true })
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Address is required' })
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(80)
  district?: string | null;

  @IsOptional()
  @NormalizeUrl()
  @IsUrl(URL_OPTIONS, { message: 'Enter a valid website address' })
  @MaxLength(300)
  website?: string | null;

  /** There's no upload service yet, so the logo is an https URL to an image hosted elsewhere. */
  @IsOptional()
  @NormalizeUrl()
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'Enter an https:// image URL' },
  )
  @MaxLength(500)
  logoUrl?: string | null;

  @IsOptional()
  @Trim()
  @IsTimezone()
  timezone?: string;

  @IsOptional()
  @Trim()
  @Matches(/^[A-Z]{3}$/, { message: 'Use a 3-letter currency code, e.g. BDT' })
  currency?: string;
}

export class SwitchCenterDto {
  @IsUUID('all', { message: 'Choose a center' })
  centerId!: string;
}
