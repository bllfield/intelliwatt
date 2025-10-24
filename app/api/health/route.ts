import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCorrelationId } from "@/lib/correlation";

export async function GET(request: Request) {
  const corrId = getCorrelationId(request.headers);
  const start = Date.now();
  try {
    // Simple DB health check
    await prisma.$queryRaw`SELECT 1`;
    const durationMs = Date.now() - start;
    // Optional: minimal server log
    console.log(JSON.stringify({ corrId, route: "health", status: 200, durationMs }));
    return NextResponse.json({ ok: true, db: "up", corrId }, { status: 200 });
  } catch (err) {
    const durationMs = Date.now() - start;
    console.error(JSON.stringify({ corrId, route: "health", status: 503, durationMs, error: "DB_DOWN" }));
    return NextResponse.json({ ok: false, db: "down", corrId }, { status: 503 });
  }
}
