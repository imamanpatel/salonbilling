import { BRANCH_HEADER } from '@salon/shared';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
  }
}

let activeBranchId = null;
let onUnauthorized = () => {};

/** Branch sent with every request; set by AuthProvider. */
export function setApiBranch(branchId) {
  activeBranchId = branchId;
}

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

/** Calls `/api{path}` and returns the response's `data`. Throws ApiError on non-2xx. */
export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const isForm = body instanceof FormData;
  const headers = {};
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  if (activeBranchId) headers[BRANCH_HEADER] = activeBranchId;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });

  if (raw && res.ok) return res;
  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, json);
  }
  return json?.data;
}

export async function downloadFile(path, filename) {
  const res = await api(path, { raw: true });
  const url = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}
