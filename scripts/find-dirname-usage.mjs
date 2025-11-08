import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const TARGETS = ['app', 'pages', 'lib'];

const normalizePath = (p) => p.replace(/\\/g, '/');

function* walk(dir) {
  let list = [];
  try {
    list = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of list) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walk(p);
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(ent.name)) {
      yield p;
    }
  }
}

for (const base of TARGETS) {
  const dir = join(ROOT, base);
  try {
    statSync(dir);
  } catch {
    continue;
  }
  for (const file of walk(dir)) {
    const code = readFileSync(file, 'utf8');
    if (!code.includes('__dirname')) continue;
    const lines = code.split('\n');
    lines.forEach((line, idx) => {
      if (line.includes('__dirname')) {
        console.log(`[__dirname] ${normalizePath(file)}:${idx + 1}  ${line.trim()}`);
      }
    });
  }
}
