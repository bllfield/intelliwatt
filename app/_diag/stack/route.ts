export const runtime = 'nodejs';

export async function GET() {
  try {
    throw new Error('DIAG_STACK');
  } catch (err: any) {
    const info = {
      message: String(err?.message || err),
      stack: String(err?.stack || 'no-stack'),
      importMetaUrl: import.meta.url,
      cwd: process.cwd(),
      nodeVersion: process.version,
      envRuntimeHint: 'nodejs',
    };
    return new Response(JSON.stringify(info, null, 2), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
}
