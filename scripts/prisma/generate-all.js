const { spawn } = require('child_process');

async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

const path = require('path');
const fs = require('fs');

async function main() {
  await run('npx', ['prisma', 'generate']);

  const repoRoot = path.join(__dirname, '..', '..');
  const candidateSchemas = [
    path.join(repoRoot, 'prisma', 'current-plan', 'schema.prisma'),
    path.join(repoRoot, 'prisma', 'current-plan.schema.prisma'),
  ];

  const currentPlanSchema = candidateSchemas.find((schemaPath) => fs.existsSync(schemaPath));

  if (!currentPlanSchema) {
    throw new Error('Could not locate current plan Prisma schema in prisma/current-plan/');
  }

  const schemaArg = `--schema=${path.relative(process.cwd(), currentPlanSchema).replace(/\\/g, '/')}`;

  await run('npx', ['prisma', 'generate', schemaArg]);
}

main().catch((error) => {
  console.error('[prisma:generate-all] Failed to generate Prisma clients');
  console.error(error);
  process.exit(1);
});

