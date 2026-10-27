/** Fixture timestamps are computed relative to import time so the demo story always looks "live". */
const NOW = Date.now();

export function minutesAgo(n: number): string {
  return new Date(NOW - n * 60_000).toISOString();
}

export function minutesFromNow(n: number): string {
  return new Date(NOW + n * 60_000).toISOString();
}

export function hoursAgo(n: number): string {
  return minutesAgo(n * 60);
}
