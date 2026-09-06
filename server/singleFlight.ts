/**
 * Coalesce identical in-flight async work so cold-start stampede
 * (theater + IST + DF + MS + FRO) shares one rebuild per key.
 */
const flights = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = flights.get(key);
  if (existing) return existing as Promise<T>;
  const p = Promise.resolve()
    .then(fn)
    .finally(() => {
      if (flights.get(key) === p) flights.delete(key);
    });
  flights.set(key, p);
  return p;
}

export function resetSingleFlightForTests(): void {
  flights.clear();
}
