<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';

  export let keys: string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
  // Lets the physical keyboard (including a numpad) drive this component too,
  // not just on-screen taps. Ignored while a real text field elsewhere on the
  // page has focus, so it doesn't hijack typing into e.g. a name input.
  export let captureKeyboard = true;

  const dispatch = createEventDispatcher<{ press: string }>();

  function isTypingElsewhere() {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function onKeydown(e: KeyboardEvent) {
    if (!captureKeyboard || isTypingElsewhere()) return;

    let key: string | null = null;
    if (e.key === 'Backspace') key = '⌫';
    else if (e.key === '.' || e.key === 'Decimal') key = '.';
    else if (/^[0-9]$/.test(e.key)) key = e.key;

    if (key && keys.includes(key)) {
      e.preventDefault();
      dispatch('press', key);
    }
  }

  onMount(() => window.addEventListener('keydown', onKeydown));
  onDestroy(() => window.removeEventListener('keydown', onKeydown));
</script>

<div class="grid grid-cols-3 gap-2">
  {#each keys as k}
    {#if k === ''}
      <div></div>
    {:else}
      <button
        class="h-12 rounded-lg font-mono text-xl font-bold {k === '⌫'
          ? 'bg-[#EFE4D6] text-counter-muted'
          : 'bg-counter-paper text-counter-ink'}"
        on:click={() => dispatch('press', k)}
      >
        {k}
      </button>
    {/if}
  {/each}
</div>
