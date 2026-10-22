import { HttpException, HttpStatus, ValidationError } from '@nestjs/common';

/**
 * API error body: `{ statusCode, message, code?, errors?, ... }`. `message` is safe to
 * show to users; `code` lets the web app branch on specific cases; `errors` maps field
 * paths (e.g. "owner.email") to messages for inline form errors. `details` adds
 * structured data for a specific code, e.g. the conflicts behind a 409.
 */
export function apiError(
  status: HttpStatus,
  message: string,
  code?: string,
  errors?: Record<string, string>,
  details?: Record<string, unknown>,
) {
  return new HttpException(
    { ...details, statusCode: status, message, code, errors },
    status,
  );
}

/** Checked first when a value is missing, so "Name is required" beats "must be shorter…". */
const PRESENCE_CONSTRAINTS = ['isDefined', 'isNotEmpty', 'isString'];

function firstMessage(error: ValidationError) {
  const constraints = error.constraints ?? {};
  const missing =
    error.value === undefined || error.value === null || error.value === '';
  const presence = missing
    ? PRESENCE_CONSTRAINTS.find((key) => constraints[key])
    : undefined;
  return presence ? constraints[presence] : Object.values(constraints)[0];
}

export function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
  out: Record<string, string> = {},
) {
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const messages = Object.values(error.constraints ?? {});
    if (messages.length && !out[path]) {
      // whitelist violations read "property x should not exist"; make them field-friendly.
      out[path] = error.constraints?.whitelistValidation
        ? 'This field can’t be changed'
        : firstMessage(error);
    }
    if (error.children?.length)
      flattenValidationErrors(error.children, path, out);
  }
  return out;
}

export function validationException(errors: ValidationError[]) {
  return apiError(
    HttpStatus.BAD_REQUEST,
    'Please check the highlighted fields',
    'VALIDATION_FAILED',
    flattenValidationErrors(errors),
  );
}
