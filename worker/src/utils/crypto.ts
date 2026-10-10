import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function generateTokens(userId: string, secret: string, role: string, impersonatorId?: string) {
  const secretKey = new TextEncoder().encode(secret);
  
  const accessTokenPayload: Record<string, any> = { userId, role };
  if (impersonatorId) {
    accessTokenPayload.impersonatorId = impersonatorId;
  }
  
  const accessToken = await new SignJWT(accessTokenPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secretKey);

  const refreshToken = await new SignJWT({ userId, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey);

  return { accessToken, refreshToken };
}

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateSetupCode(): string {
  const array = new Uint8Array(5);
  crypto.getRandomValues(array);
  const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  
  for (let i = 0; i < array.length; i++) {
    value = (value << 8) | array[i];
    bits += 8;
    while (bits >= 5) {
      output += base32chars[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += base32chars[(value << (5 - bits)) & 31];
  }
  return output.substring(0, 8);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const encoder = new TextEncoder();
  const aBuffer = encoder.encode(a);
  const bBuffer = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < aBuffer.length; i++) {
    result |= aBuffer[i] ^ bBuffer[i];
  }
  return result === 0;
}
