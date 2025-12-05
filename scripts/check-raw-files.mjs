import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('\n=== Checking RawSmtFile records ===\n');
  
  const files = await prisma.rawSmtFile.findMany({
    take: 10,
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      filename: true,
      size_bytes: true,
      source: true,
      sha256: true,
      created_at: true,
    },
  });
  
  console.log(`Found ${files.length} RawSmtFile records:`);
  files.forEach(f => {
    console.log(`  - ${f.filename} (${f.size_bytes} bytes, source: ${f.source}, sha256: ${f.sha256?.substring(0, 16)}..., created: ${f.created_at})`);
  });
  
  if (files.length === 0) {
    console.log('\n❌ No RawSmtFile records found!');
    console.log('This means the callback in smt-upload-server is not working.');
    console.log('The /api/admin/smt/raw-upload endpoint should be creating these records.\n');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
