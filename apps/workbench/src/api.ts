let token = '';

export async function connect() {
  const response = await fetch('/api/v1/session', {
    method: 'POST',
    headers: { 'X-EasyResume-Client': 'workbench' },
  });
  if (!response.ok) throw new Error('无法连接本地服务，请从启动器打开工作台。');
  token = (await response.json()).token;
}

export async function request<T = any>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  if (!token) await connect();
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { ...options, headers });
  } catch {
    throw new Error('本地服务已离线。输入仍保留在当前页面，请重新启动服务后重试。');
  }
  if (response.status === 401 && retry) {
    await connect();
    return request<T>(path, options, false);
  }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const message = Array.isArray(result.detail)
      ? result.detail.map((e: any) => `${e.loc?.slice(1).join('.')}: ${e.msg}`).join('；')
      : result.detail;
    throw new Error(message || `请求失败（${response.status}）`);
  }
  if (response.headers.get('content-type')?.includes('text/csv'))
    return (await response.blob()) as T;
  return response.json();
}

export const post = <T = any>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const put = <T = any>(path: string, body: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) });

export function download(data: Blob | object, filename: string) {
  const blob =
    data instanceof Blob
      ? data
      : new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
