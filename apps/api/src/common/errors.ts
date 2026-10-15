import { HttpException, HttpStatus, ValidationError } from '@nestjs/common';

/**
 * API error body: `{ statusCode, message, code?, errors? }`. `message` is safe to show
 * to users; `code` lets the web app branch on specific cases; `errors` maps field paths
 * (e.g. "owner.email") to messages for inline form errors.
 */
export function apiError(
  status: HttpStatus,
  message: string,
  code?: string,
  errors?: Record<string, string>,
) {
  return new HttpException(
    { statusCode: status, message, code, errors },
    status,
  );
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
        : messages[0];
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
