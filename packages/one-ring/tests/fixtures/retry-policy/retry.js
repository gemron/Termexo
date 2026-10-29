export function parseRetryCount(value) {
  return parseInt(value, 10) || 3;
}
