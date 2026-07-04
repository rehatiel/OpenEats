// A tiny serial print queue — window.print() opens a single native dialog,
// so printing several new tickets that land in the same poll cycle has to
// happen one at a time rather than all at once. Used by /kitchen and /bar
// for kitchen-printer auto-print; each page owns its own queue/printer.
import { writable } from 'svelte/store';
import { tick } from 'svelte';

export function createPrintQueue<T>() {
  const current = writable<T | null>(null);
  let queue: T[] = [];
  let busy = false;

  async function pump() {
    if (busy || queue.length === 0) return;
    busy = true;
    const [next, ...rest] = queue;
    queue = rest;
    current.set(next);
    await tick();

    // afterprint fires once the browser's print dialog closes (submitted or
    // cancelled) — that's the signal it's safe to show/print the next
    // ticket. The timeout is a fallback for browsers that don't fire it
    // reliably, so a stuck dialog can't wedge the whole queue.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('afterprint', finish);
      current.set(null);
      busy = false;
      pump();
    };
    window.addEventListener('afterprint', finish);
    window.print();
    setTimeout(finish, 4000);
  }

  function enqueue(item: T) {
    queue = [...queue, item];
    pump();
  }

  return { current, enqueue };
}
