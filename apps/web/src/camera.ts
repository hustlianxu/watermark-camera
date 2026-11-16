export type CameraPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

export type CameraProblemKind =
  | 'permission'
  | 'insecure'
  | 'unsupported'
  | 'not-found'
  | 'busy'
  | 'constraints'
  | 'unknown';

export interface CameraProblem {
  kind: CameraProblemKind;
  title: string;
  detail: string;
  steps: string[];
  retry: boolean;
  raw?: string;
}

export interface CameraScope {
  isSecureContext: boolean;
  mediaDevices?: { getUserMedia?: unknown } | null;
}

const CAMERA_GRANTED_KEY = 'wc:camera-granted';

const PERMISSION_STEPS = [
  'Chrome：点地址栏左侧的相机/网站图标，把“相机”改为“允许”；或打开 chrome://settings/content/camera。',
  'Safari：Safari 设置 → 网站 → 相机 → 本站 → 允许。',
  'macOS：系统设置 → 隐私与安全性 → 相机，打开 Chrome / Safari 的开关。',
  'iPhone/iPad：设置 → Safari → 相机 → 允许；同时检查 设置 → 隐私与安全性 → 相机。',
];

export function cameraScopeProblem(scope: CameraScope): CameraProblem | null {
  if (!scope.isSecureContext) {
    return {
      kind: 'insecure',
      title: '当前地址无法使用相机',
      detail: '浏览器只允许 HTTPS 页面调用相机，请改用 https:// 地址打开。',
      steps: [],
      retry: true,
    };
  }
  if (!scope.mediaDevices?.getUserMedia) {
    return {
      kind: 'unsupported',
      title: '当前浏览器不支持网页相机',
      detail: '请用 Safari 17+、Chrome 120+ 打开，或改用“相册/系统相机”导入。',
      steps: [],
      retry: true,
    };
  }
  return null;
}

export function permissionProblem(): CameraProblem {
  return {
    kind: 'permission',
    title: '相机权限被拒绝',
    detail: '浏览器已记住拒绝状态，继续点“重试相机”通常不会再次弹窗。请先允许本站使用相机，再重试或刷新页面。',
    steps: PERMISSION_STEPS,
    retry: true,
  };
}

export function describeCameraError(error: unknown): CameraProblem {
  const name = String((error as { name?: unknown })?.name ?? '');
  const message = String((error as { message?: unknown })?.message ?? error ?? '');
  const raw = [name, message].filter(Boolean).join(': ');

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || /permission denied/i.test(message)) {
    return { ...permissionProblem(), raw };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || /requested device not found|no camera/i.test(message)) {
    return {
      kind: 'not-found',
      title: '没有检测到相机',
      detail: '浏览器没有找到可用摄像头。可以先用“从相册导入”或“用系统相机”继续。',
      steps: ['检查相机是否被禁用，或外接摄像头是否已连接。'],
      retry: true,
      raw,
    };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || /could not start video source|in use|占用/i.test(message)) {
    return {
      kind: 'busy',
      title: '相机被其他应用占用',
      detail: '同一时间只能有一个应用使用相机。请关闭微信、钉钉、会议软件或其他浏览器标签页里的视频通话，再重试。',
      steps: [],
      retry: true,
      raw,
    };
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return {
      kind: 'constraints',
      title: '相机不支持当前分辨率',
      detail: '已尝试自动降级。若仍失败，请用“从相册导入”。',
      steps: [],
      retry: true,
      raw,
    };
  }
  if (name === 'SecurityError') {
    return {
      kind: 'insecure',
      title: '浏览器阻止了相机',
      detail: '请确认使用 HTTPS，且没有在微信等内置浏览器中打开。',
      steps: ['改用 Safari/Chrome 打开本站。'],
      retry: true,
      raw,
    };
  }
  if (name === 'TypeError' && /getUserMedia/i.test(message)) {
    return {
      kind: 'unsupported',
      title: '当前浏览器不支持网页相机',
      detail: '请用 Safari 17+、Chrome 120+ 打开，或改用“相册/系统相机”导入。',
      steps: [],
      retry: true,
      raw,
    };
  }
  return {
    kind: 'unknown',
    title: '相机启动失败',
    detail: message || '未知错误',
    steps: ['可以点“重试相机”；如果仍失败，请用“从相册导入”。'],
    retry: true,
    raw,
  };
}

export async function queryCameraPermission(): Promise<CameraPermissionState> {
  try {
    const permissions = navigator.permissions;
    if (!permissions?.query) return 'unknown';
    const status = await permissions.query({ name: 'camera' as PermissionName });
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') return status.state;
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function rememberedCameraGrant(): boolean {
  try {
    return localStorage.getItem(CAMERA_GRANTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberCameraGrant(granted: boolean): void {
  try {
    if (granted) localStorage.setItem(CAMERA_GRANTED_KEY, '1');
    else localStorage.removeItem(CAMERA_GRANTED_KEY);
  } catch {}
}

export async function requestCameraStream(): Promise<MediaStream> {
  const preferred: MediaStreamConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  };
  try {
    return await navigator.mediaDevices.getUserMedia(preferred);
  } catch (error) {
    const name = String((error as { name?: unknown })?.name ?? '');
    if (name !== 'OverconstrainedError' && name !== 'ConstraintNotSatisfiedError') throw error;
    return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  }
}

export function cameraDiagnostics(input: {
  href: string;
  userAgent: string;
  isSecureContext: boolean;
  permission: CameraPermissionState;
  problem: CameraProblem | null;
}): string {
  return [
    `地址: ${input.href}`,
    `安全上下文: ${input.isSecureContext ? '是' : '否'}`,
    `浏览器: ${input.userAgent}`,
    `相机权限: ${input.permission}`,
    `错误: ${input.problem?.raw || input.problem?.title || '无'}`,
  ].join('\n');
}
