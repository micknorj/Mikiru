import { build } from 'esbuild';
await build({ entryPoints: ['./backend/worker.ts'], tsconfigRaw: {}, bundle: true, platform: 'browser', target: 'es2022',
  format: 'esm', outfile: 'dist/worker/index.mjs', sourcemap: false, metafile: true }).then(result => {
  if (Object.keys(result.metafile.inputs).some(p => /(?:\.private|aws-sdk|local-content|local-metrics|fixture)/i.test(p))) throw new Error('PRIVATE_OR_PLATFORM_BUILD_INPUT');
});
