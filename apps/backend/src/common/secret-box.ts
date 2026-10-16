import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// Cifrado simétrico (AES-256-GCM) para secretos guardados en la base (p. ej. claves de las
// pasarelas de pago). La llave sale de CREDENTIALS_KEY o, si no está, de JWT_SECRET: si esa
// variable cambia, los secretos guardados dejan de leerse y hay que volver a ingresarlos.
const PREFIX = 'enc:v1:';

function key(): Buffer {
  const raw = process.env.CREDENTIALS_KEY || process.env.JWT_SECRET || 'admin-marketplace';
  return createHash('sha256').update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

/** Descifra; un valor sin prefijo se devuelve tal cual. null si no se puede descifrar. */
export function decryptSecret(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (!value.startsWith(PREFIX)) return value;
  try {
    const [iv, tag, data] = value.slice(PREFIX.length).split(':').map((p) => Buffer.from(p, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
