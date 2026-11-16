import { describe, expect, it } from 'vitest';
import {
  cameraDiagnostics,
  cameraScopeProblem,
  describeCameraError,
  permissionProblem,
} from './camera';

describe('camera error classification', () => {
  it('turns a browser permission denial into actionable steps', () => {
    const problem = describeCameraError({ name: 'NotAllowedError', message: 'Permission denied' });
    expect(problem.kind).toBe('permission');
    expect(problem.retry).toBe(true);
    expect(problem.detail).toContain('不会再次弹窗');
    expect(problem.steps.join(' ')).toContain('chrome://settings/content/camera');
  });

  it('recognises a camera already held by another app', () => {
    const problem = describeCameraError({ name: 'NotReadableError', message: 'Could not start video source' });
    expect(problem.kind).toBe('busy');
    expect(problem.title).toContain('占用');
  });

  it('distinguishes a missing camera from a permission problem', () => {
    const problem = describeCameraError({ name: 'NotFoundError', message: 'Requested device not found' });
    expect(problem.kind).toBe('not-found');
    expect(problem.detail).toContain('从相册导入');
  });

  it('handles unsupported video constraints', () => {
    const problem = describeCameraError({ name: 'OverconstrainedError', message: 'width' });
    expect(problem.kind).toBe('constraints');
  });

  it('keeps an unknown failure visible instead of hiding it', () => {
    const problem = describeCameraError({ name: 'AbortError', message: 'camera aborted' });
    expect(problem.kind).toBe('unknown');
    expect(problem.raw).toContain('AbortError');
  });
});

describe('camera environment checks', () => {
  it('rejects an insecure origin before calling getUserMedia', () => {
    const problem = cameraScopeProblem({ isSecureContext: false, mediaDevices: {} });
    expect(problem?.kind).toBe('insecure');
  });

  it('rejects a browser without mediaDevices', () => {
    const problem = cameraScopeProblem({ isSecureContext: true, mediaDevices: null });
    expect(problem?.kind).toBe('unsupported');
  });

  it('accepts a secure browser with getUserMedia', () => {
    expect(cameraScopeProblem({ isSecureContext: true, mediaDevices: { getUserMedia: () => {} } })).toBeNull();
  });
});

describe('camera diagnostics', () => {
  it('contains the origin, permission and raw error for support', () => {
    const text = cameraDiagnostics({
      href: 'https://cam.tpvlog.top:18443/',
      userAgent: 'Chrome/157',
      isSecureContext: true,
      permission: 'denied',
      problem: permissionProblem(),
    });
    expect(text).toContain('cam.tpvlog.top:18443');
    expect(text).toContain('相机权限: denied');
    expect(text).toContain('安全上下文: 是');
  });
});
