import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * tsc only emits JavaScript. SQL migrations are read from disk at runtime, so
 * they have to be copied into dist explicitly.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const from = path.join(root, 'src', 'db', 'migrations');
const to = path.join(root, 'dist', 'db', 'migrations');

await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });
console.log(`Copied migrations to ${path.relative(root, to)}`);
