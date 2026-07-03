import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Static output served by Nginx — no Node runtime in the frontend container.
    // fallback: 'index.html' turns this into an SPA so client-side routing
    // works for a dynamic app that isn't fully prerenderable.
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
    }),
  },
};

export default config;
