// @ts-check
import { defineConfig } from 'astro/config';

import mdx from '@astrojs/mdx';

// GitHub Pages serves a project repo under /<repo>/, so the site has to be
// built with a matching base path. Set BASE_PATH in CI; locally it stays at
// the root. Links in .astro files go through withBase() in src/consts.ts.
const base = process.env.BASE_PATH ?? '/';
const site = process.env.SITE_URL;

// https://astro.build/config
export default defineConfig({
  site,
  base,
  integrations: [mdx()],
});
