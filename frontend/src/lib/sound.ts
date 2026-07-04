// Short tones synthesized via Web Audio — no audio asset to fetch, keeping
// the app fully usable offline (same reasoning as self-hosting fonts in the
// root layout). Browsers block audio before any user gesture on the page;
// by the time a real ticket/alert fires, staff have almost always already
// tapped something, so this silently no-ops on the rare case they haven't.
let audioCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    audioCtx ??= new AudioContext();
    return audioCtx;
  } catch {
    return null;
  }
}

function beep(ctx: AudioContext, startAt: number, freq: number, durationSec: number, peakGain: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec);
}

// A single descending sweep — used for the order-ready alert.
export function playReadyBing() {
  const ctx = getContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.7);
  } catch {
    // Audio blocked or unsupported — the visual alert alone still lands.
  }
}

// Two quick identical beeps — a kitchen-bell "ding-ding" — used when a new
// ticket lands on the board, deliberately distinct from the ready alert's
// single sweep so staff can tell the two apart without looking up.
export function playNewTicketChime() {
  const ctx = getContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    beep(ctx, now, 1000, 0.18, 0.3);
    beep(ctx, now + 0.22, 1000, 0.18, 0.3);
  } catch {
    // Audio blocked or unsupported — the ticket still shows up visually.
  }
}
