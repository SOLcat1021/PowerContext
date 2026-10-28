import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const result = spawnSync(process.execPath, [vite, 'build', '--outDir', 'dist-site'], {
  cwd: root, stdio: 'inherit', env: {
    ...process.env,
    VITE_POWERCONTEXT_ENDPOINT: '',
    VITE_LITERATURE_ASK_ENDPOINT: '',
    VITE_LITERATURE_CLASSIFY_ENDPOINT: '',
  },
});
process.exit(result.status ?? 1);
