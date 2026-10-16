import { createHmac } from 'crypto';
import { flowSign } from './providers/flow.adapter';
import { decryptSecret, encryptSecret } from '../common/secret-box';

describe('flowSign', () => {
  it('firma los parámetros ordenados alfabéticamente como nombre+valor (HMAC-SHA256 hex)', () => {
    const params = { subject: 'Compra', apiKey: 'KEY', amount: '5000', commerceOrder: 'abc' };
    const expected = createHmac('sha256', 'SECRET').update('amount5000apiKeyKEYcommerceOrderabcsubjectCompra').digest('hex');
    expect(flowSign(params, 'SECRET')).toBe(expected);
  });

  it('no depende del orden en que vienen los parámetros', () => {
    expect(flowSign({ b: '2', a: '1' }, 's')).toBe(flowSign({ a: '1', b: '2' }, 's'));
  });
});

describe('secret-box', () => {
  it('cifra y descifra', () => {
    const enc = encryptSecret('APP_USR-123');
    expect(enc).not.toContain('APP_USR-123');
    expect(enc.startsWith('enc:v1:')).toBe(true);
    expect(decryptSecret(enc)).toBe('APP_USR-123');
  });

  it('devuelve tal cual un valor sin cifrar y null si está alterado', () => {
    expect(decryptSecret('plano')).toBe('plano');
    const enc = encryptSecret('x');
    expect(decryptSecret(enc.slice(0, -4) + 'AAAA')).toBeNull();
    expect(decryptSecret(null)).toBeNull();
  });
});
