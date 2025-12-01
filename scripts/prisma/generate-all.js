const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

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

const MODULE_SCHEMAS = [
  {
    name: 'current-plan',
    candidates: ['prisma/current-plan/schema.prisma', 'prisma/current-plan.schema.prisma'],
  },
  {
    name: 'usage',
    candidates: ['prisma/usage/schema.prisma'],
  },
  {
    name: 'home-details',
    candidates: ['prisma/home-details/schema.prisma'],
  },
  {
    name: 'appliances',
    candidates: ['prisma/appliances/schema.prisma'],
  },
  {
    name: 'upgrades',
    candidates: ['prisma/upgrades/schema.prisma'],
  },
  {
    name: 'wattbuy-offers',
    candidates: ['prisma/wattbuy-offers/schema.prisma'],
  },
  {
    name: 'referrals',
    candidates: ['prisma/referrals/schema.prisma'],
  },
];

async function generateForSchema(relativeSchemaPath) {
  const schemaArg = `--schema=${relativeSchemaPath}`;
  await run('npx', ['prisma', 'generate', schemaArg]);
}

async function main() {
  await run('npx', ['prisma', 'generate']);

  for (const module of MODULE_SCHEMAS) {
    const schemaPath = module.candidates
      .map((candidate) => path.resolve(candidate))
      .find((candidatePath) => fs.existsSync(candidatePath));

    if (!schemaPath) {
      console.warn(`[prisma:generate-all] Skipping ${module.name}, schema not found at ${module.candidates.join(', ')}`);
      continue;
    }

    const relativeSchemaPath = path.relative(process.cwd(), schemaPath).replace(/\\/g, '/');
    console.log(`[prisma:generate-all] Generating Prisma client for ${module.name} (${relativeSchemaPath})`);
    await generateForSchema(relativeSchemaPath);
  }
}

main().catch((error) => {
  console.error('[prisma:generate-all] Failed to generate Prisma clients');
  console.error(error);
  process.exit(1);
});
