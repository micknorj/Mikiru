import { defineConfig, loadEnv } from 'vite';
import { createHash } from 'node:crypto';

export default defineConfig(({ command, mode }) => {
  const value = loadEnv(mode, process.cwd(), 'VITE_').VITE_API_BASE_URL;
  let apiOrigin = '';
  if (value) {
    const api = new URL(value);
    if (api.protocol !== 'https:' && command === 'build') throw new Error('Production API URL must use HTTPS.');
    if (api.username || api.password || api.search || api.hash) throw new Error('Invalid public API URL.');
    apiOrigin = api.origin;
  }
  return {
  base: './',
  build: { outDir: 'dist/frontend', sourcemap: false },
  server: { fs: { strict: true, allow: ['src', 'public', 'node_modules', 'index.html'],
    deny: ['.env', '.env.*', '**/.private/**', '**/spec/**', '**/legacy-source/**', '**/mikiru*.png', '**/mikiru*.webp', '**/*.pem', '**/*.key'] } },
  plugins: [{ name: 'content-policy', transformIndexHtml: { order: 'pre', handler(html) {
    if (command !== 'build') return html;
    // Permit only the exact critical appearance style and pre-paint resolver.
    const canvasStyle = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    const appearanceScript = html.match(/<script data-appearance-init>([\s\S]*?)<\/script>/)?.[1];
    if (!canvasStyle || !appearanceScript) throw new Error('Missing initial appearance resources.');
    const styleHash = createHash('sha256').update(canvasStyle).digest('base64');
    const scriptHash = createHash('sha256').update(appearanceScript).digest('base64');
    const policy = `default-src 'none'; script-src 'self' 'sha256-${scriptHash}'; style-src 'self' 'sha256-${styleHash}'; font-src 'self'; img-src 'self' ${apiOrigin}; connect-src 'self' ${apiOrigin}; base-uri 'none'; form-action 'none'; object-src 'none'`;
    return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="${policy}" />`);
  } } }],
};
});
