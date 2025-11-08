import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT = process.cwd();
const SRC_DIRS = ['app', 'pages', 'lib'];

const NODE_APIS = [
  'fs',
  'node:fs',
  'path',
  'node:path',
  'url',
  'node:url',
  '__dirname',
  'process.',
  '@prisma/client',
  'prisma',
  'jsonwebtoken',
  'jose/jwt',
  'bcrypt',
  'pg',
  'mysql',
  'mysql2',
  'oracledb',
  'mssql',
];

const EDGE_SENSITIVE_FILES = [
  'middleware.ts',
  'middleware.js',
  'src/middleware.ts',
  'src/middleware.js',
];

const normalizePath = (p) => p.replace(/\\/g, '/');

function* walk(dir) {
  let ents = [];
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of ents) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walk(p);
    } else {
      const ext = extname(p);
      if (['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(ext)) {
        yield p;
      }
    }
  }
}

function fileHasNodeApis(code) {
  return NODE_APIS.some((sig) => code.includes(sig));
}

function isEdgeSensitiveFile(file) {
  const normalized = normalizePath(file);
  return EDGE_SENSITIVE_FILES.some((edgeFile) => normalized.endsWith(edgeFile));
}

function isAppRouteHandler(file) {
  const normalized = normalizePath(file);
  return normalized.includes('/app/') && normalized.endsWith('/route.ts');
}

function isLibFile(file) {
  const normalized = normalizePath(file);
  if (normalized.endsWith('/lib/node/_guard.ts')) return false;
  return normalized.includes('/lib/');
}

function hasNodeRuntimeExport(code) {
  return (
    code.includes("export const runtime = 'nodejs'") ||
    code.includes('export const runtime="nodejs"') ||
    code.includes('export const runtime = "nodejs"')
  );
}

const problems = [];

for (const dir of SRC_DIRS) {
  const full = join(ROOT, dir);
  try {
    statSync(full);
  } catch {
    continue;
  }
  for (const file of walk(full)) {
    const code = readFileSync(file, 'utf8');
    const hasNodeStuff = fileHasNodeApis(code);
    const hasGuard = code.includes('assertNodeRuntime(');

    if (hasNodeStuff && isEdgeSensitiveFile(file)) {
      problems.push({ file: normalizePath(file), issue: 'Edge file imports Node APIs' });
    }

    if (hasNodeStuff && isAppRouteHandler(file) && !hasNodeRuntimeExport(code)) {
      problems.push({ file: normalizePath(file), issue: 'App route uses Node APIs without runtime=nodejs' });
    }

    if (hasNodeStuff && isLibFile(file) && !hasGuard) {
      problems.push({ file: normalizePath(file), issue: 'lib/* uses Node APIs — ensure only Node runtime imports it' });
    }
  }
}

if (problems.length === 0) {
  console.log('✅ No obvious Edge leaks or Node API misuse detected.');
} else {
  console.log('❌ Potential issues detected:');
  for (const problem of problems) {
    console.log(`- ${problem.file} → ${problem.issue}`);
  }
  console.log('\nNext steps:\n- For each app/**/route.ts above, add `export const runtime = \'nodejs\'`.');
  console.log('- For each lib/** above, move to lib/node/** (or make it Edge-safe) and ensure middleware never imports it.');
  console.log('- Review middleware for forbidden imports.');
}
