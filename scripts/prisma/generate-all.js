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

async function main() {
  await run('npx', ['prisma', 'generate']);
  await run('npx', ['prisma', 'generate', '--schema=prisma/current-plan.schema.prisma']);
}

main().catch((error) => {
  console.error('[prisma:generate-all] Failed to generate Prisma clients');
  console.error(error);
  process.exit(1);
});

