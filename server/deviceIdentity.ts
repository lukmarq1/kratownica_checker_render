import crypto from "crypto";

const MAX_DEVICE_ID_LENGTH = 128;

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function signDeviceId(deviceId: string, secret: string): string {
  const signature = crypto.createHmac("sha256", secret).update(deviceId).digest("base64url");
  return `${deviceId}.${signature}`;
}

export function readSignedDeviceId(token: string | undefined, secret: string): string | null {
  if (!token || !secret) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const deviceId = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(deviceId) || !signature || deviceId.length > MAX_DEVICE_ID_LENGTH) return null;
  const expected = signDeviceId(deviceId, secret).slice(deviceId.length + 1);
  return safeEqual(signature, expected) ? deviceId : null;
}

export function createDeviceId() {
  return crypto.randomUUID();
}
