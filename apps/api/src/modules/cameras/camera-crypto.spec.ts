import { beforeEach, describe, expect, it } from 'vitest';
import { decryptCameraSecret, encryptCameraSecret } from './camera-crypto';

describe('camera credential encryption', () => {
  beforeEach(() => {
    process.env.CAMERA_ENCRYPTION_KEY = 'test-camera-key-with-enough-entropy';
  });

  it('encrypts RTSP credentials without leaving plaintext in storage', () => {
    const source = 'rtsp://elise:private-password@192.168.1.20/stream';
    const encrypted = encryptCameraSecret(source);
    expect(encrypted).not.toContain('private-password');
    expect(decryptCameraSecret(encrypted)).toBe(source);
  });

  it('rejects altered encrypted values', () => {
    const encrypted = encryptCameraSecret('rtsp://camera.local/stream');
    expect(() => decryptCameraSecret(`${encrypted.slice(0, -2)}aa`)).toThrow();
  });
});
