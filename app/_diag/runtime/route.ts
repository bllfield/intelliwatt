export const runtime = 'nodejs';

export async function GET() {
  const info = {
    envRuntimeHint: 'nodejs',
    importMetaUrl: import.meta.url,
    cwd: process.cwd(),
    nodeVersion: process.version,
  };
  return new Response(JSON.stringify(info, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
