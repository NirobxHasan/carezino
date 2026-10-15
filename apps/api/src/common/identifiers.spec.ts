import { centerCodePrefix } from '../centers/centers.service';
import { normalizeEmail, normalizeMobile, normalizePhone } from './identifiers';
import { hashToken, generateToken } from './tokens';

describe('identifier normalization', () => {
  it('lower-cases and trims emails', () => {
    expect(normalizeEmail('  Nadia@Example.COM ')).toBe('nadia@example.com');
  });

  it.each([
    ['01712-345678', '01712345678'],
    ['+8801712345678', '01712345678'],
    ['8801712 345 678', '01712345678'],
    ['(017) 1234-5678', '01712345678'],
  ])('normalizes mobile %s', (input, expected) => {
    expect(normalizeMobile(input)).toBe(expected);
  });

  it.each(['0171234567', '01212345678', '+1 555 0100', 'abc'])(
    'rejects mobile %s',
    (input) => {
      expect(normalizeMobile(input)).toBeNull();
    },
  );

  it('accepts landlines for center phones', () => {
    expect(normalizePhone('02-9876543')).toBe('029876543');
    expect(normalizePhone('+880 2 9876543')).toBe('+88029876543');
    expect(normalizePhone('12')).toBeNull();
  });
});

describe('center codes', () => {
  it('uses the initials of the center name', () => {
    expect(centerCodePrefix('Shishu Bikash Therapy Center')).toBe('SBTC');
    expect(centerCodePrefix('Shishu Bikash')).toBe('SB');
    expect(centerCodePrefix('Hope')).toBe('CZH');
    expect(centerCodePrefix('১২৩ Care & Cure Centre Dhaka Ltd')).toBe('CCCD');
  });
});

describe('tokens', () => {
  it('generates distinct URL-safe tokens and stores only a hash', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
  });
});
