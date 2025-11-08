import { prisma } from '@/lib/db';
import { assertNodeRuntime } from '@/lib/node/_guard';

assertNodeRuntime();

/**
 * Try to extract an outbound purchase/enroll URL for a plan. Falls back to null.
 * We expect WattBuy payloads to sometimes include:
 *  - docs.click_url
 *  - docs.links?.offer
 *  - docs.enrollment_url
 */
export function extractOutboundUrl(docs: any): string | null {
  if (!docs) return null
  const d = docs as any
  return (
    d.click_url ||
    d.enrollment_url ||
    d?.links?.offer ||
    d?.links?.enroll ||
    null
  )
}
