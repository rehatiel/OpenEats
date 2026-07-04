<script lang="ts">
  // Shared staff-facing top-bar nav — renders touch-friendly <button>s
  // (not <a> tags) since these screens are most often run on a touchscreen,
  // plus the user-info/sign-out block every staff page already showed.
  import { goto } from '$app/navigation';
  import { auth, logout } from '$lib/stores/auth';

  export let links: { href: string; label: string }[] = [];
  export let theme: 'light' | 'kds' = 'light';
  // Most staff pages hide nav links below `md` (the cart/content takes
  // priority on narrow screens) — a couple of pages keep them always
  // visible instead, so this stays a per-page choice rather than baked in.
  export let hideLinksOnMobile = false;

  function signOut() {
    logout();
    goto('/login');
  }

  const buttonBase = 'rounded-lg border px-3.5 py-2 text-sm font-bold transition-transform active:scale-[0.98]';

  $: linkClass =
    buttonBase +
    ' ' +
    (theme === 'kds'
      ? 'border-kds-border bg-kds-card-2 text-kds-muted hover:text-kds-text'
      : 'border-counter-line bg-counter-paper text-counter-ink hover:bg-counter-tabs') +
    (hideLinksOnMobile ? ' hidden md:block' : '');

  $: signOutClass =
    buttonBase +
    ' ' +
    (theme === 'kds'
      ? 'border-kds-border bg-kds-card-2 text-kds-muted hover:text-kds-text'
      : 'border-counter-line bg-counter-paper text-counter-ink hover:bg-counter-tabs');
</script>

{#each links as link (link.href)}
  <button class={linkClass} on:click={() => goto(link.href)}>{link.label}</button>
{/each}

{#if $auth.user}
  {#if theme === 'kds'}
    <div class="hidden font-mono text-sm text-kds-muted lg:block">{$auth.user.name} · {$auth.user.role}</div>
    <button class={signOutClass} on:click={signOut}>Sign out</button>
  {:else}
    <div class="hidden items-center gap-2 lg:flex">
      <div class="font-mono text-[13px] text-counter-muted">{$auth.user.name} · {$auth.user.role}</div>
      <button class={signOutClass} on:click={signOut}>Sign out</button>
    </div>
  {/if}
{/if}
