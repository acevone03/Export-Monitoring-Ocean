// Single source of "now" for the whole app, so /dev/simulate-time (Step 4)
// can fast-forward the clock for the web app and the scheduler alike.
export function now(): Date {
  return new Date();
}
