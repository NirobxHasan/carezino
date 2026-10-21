import {
  format,
  formatDistanceToNowStrict,
  isToday,
  isTomorrow,
  isYesterday,
  parseISO,
} from 'date-fns';

import type { DateDisplayFormat, TimeDisplayFormat } from './types';

/** Bangladesh uses lakh/crore grouping (1,25,000), which the en-IN locale gives us. */
const takaFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const numberFormatter = new Intl.NumberFormat('en-IN');

export function formatTaka(amount: number) {
  const sign = amount < 0 ? '-' : '';
  return `${sign}৳${takaFormatter.format(Math.abs(amount))}`;
}

export function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function toDate(value: string | Date) {
  return typeof value === 'string' ? parseISO(value) : value;
}

/** 14 Oct 2026 */
export function formatDate(value: string | Date) {
  return format(toDate(value), 'd MMM yyyy');
}

/** Tue, 14 Oct */
export function formatShortDate(value: string | Date) {
  return format(toDate(value), 'EEE, d MMM');
}

/** 10:30 AM */
export function formatTime(value: string | Date) {
  return format(toDate(value), 'h:mm a');
}

/** "HH:mm" (24h, as stored) to "h:mm AM" */
export function formatClock(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const date = new Date(2000, 0, 1, h, m);
  return format(date, 'h:mm a');
}

export function formatRelativeDay(value: string | Date) {
  const date = toDate(value);
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  if (isYesterday(date)) return 'Yesterday';
  return formatShortDate(date);
}

export function formatAgo(value: string | Date) {
  const date = toDate(value);
  if (Date.now() - date.getTime() < 60_000) return 'Just now';
  return `${formatDistanceToNowStrict(date)} ago`;
}

export function formatAge(dateOfBirth: string) {
  const dob = parseISO(dateOfBirth);
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  let months = now.getMonth() - dob.getMonth();
  if (now.getDate() < dob.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 3) return `${years * 12 + months} mo`;
  return `${years} yrs`;
}

/** Bangladeshi mobile numbers: 01712345678 -> 01712-345678 */
export function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('01')) {
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }
  return phone;
}

const DATE_PATTERNS: Record<DateDisplayFormat, string> = {
  D_MMM_YYYY: 'd MMM yyyy',
  DD_MM_YYYY: 'dd/MM/yyyy',
  MM_DD_YYYY: 'MM/dd/yyyy',
  YYYY_MM_DD: 'yyyy-MM-dd',
};

/** A date in the center's chosen format (General settings). */
export function formatCenterDate(
  value: string | Date,
  dateFormat: DateDisplayFormat = 'D_MMM_YYYY',
) {
  return format(toDate(value), DATE_PATTERNS[dateFormat]);
}

/** "HH:mm" in the center's 12- or 24-hour preference. */
export function formatCenterClock(hhmm: string, timeFormat: TimeDisplayFormat = 'H12') {
  return timeFormat === 'H24' ? hhmm : formatClock(hhmm);
}
