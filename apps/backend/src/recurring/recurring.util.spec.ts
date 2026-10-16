import { nextBillingDate } from './recurring.service';

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const key = (x: Date) => x.toISOString().slice(0, 10);

describe('nextBillingDate', () => {
  it('mensual: mismo día del mes siguiente', () => {
    expect(key(nextBillingDate(d('2026-10-05'), 'MONTHLY', 5))).toBe('2026-11-05');
    expect(key(nextBillingDate(d('2026-12-05'), 'MONTHLY', 5))).toBe('2027-01-05');
  });

  it('el día de facturación se acota a 28 (febrero y meses cortos)', () => {
    expect(key(nextBillingDate(d('2027-01-28'), 'MONTHLY', 31))).toBe('2027-02-28');
  });

  it('bimestral, trimestral, semestral y anual', () => {
    expect(key(nextBillingDate(d('2026-10-10'), 'BIMONTHLY', 10))).toBe('2026-12-10');
    expect(key(nextBillingDate(d('2026-10-10'), 'QUARTERLY', 10))).toBe('2027-01-10');
    expect(key(nextBillingDate(d('2026-10-10'), 'SEMIANNUAL', 10))).toBe('2027-04-10');
    expect(key(nextBillingDate(d('2026-10-10'), 'ANNUAL', 10))).toBe('2027-10-10');
  });

  it('semanal: 7 días después', () => {
    expect(key(nextBillingDate(d('2026-10-30'), 'WEEKLY', 1))).toBe('2026-11-06');
  });
});
