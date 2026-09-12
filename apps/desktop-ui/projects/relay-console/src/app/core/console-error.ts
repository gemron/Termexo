import { HttpErrorResponse } from '@angular/common/http';

/** The relay answers every failure with `{ "error": "…" }`, already worded for the operator. */
interface ApiErrorBody {
  error: string;
}

const NETWORK_ERROR = '无法连接到中继，请检查网络后重试';
const UNEXPECTED_ERROR = '中继返回了无法识别的响应';

function isApiErrorBody(body: unknown): body is ApiErrorBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as ApiErrorBody).error === 'string'
  );
}

/**
 * Turns anything a failed request threw into one sentence a person can act on.
 *
 * The relay's own message is always preferred: it knows why the call failed, while the status
 * code only says that it did.
 */
export function describeConsoleError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (isApiErrorBody(error.error)) {
      return error.error.error;
    }
    // Status 0 is the browser refusing to even reach the relay: offline, DNS, TLS or CORS.
    return error.status === 0 ? NETWORK_ERROR : `${UNEXPECTED_ERROR}（HTTP ${error.status}）`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : UNEXPECTED_ERROR;
}
