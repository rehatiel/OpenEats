// This app has no server runtime (adapter-static + fallback SPA) and auth
// state lives in localStorage — disable SSR/prerendering entirely so the
// route guard in +layout.svelte only ever runs in the browser.
export const ssr = false;
