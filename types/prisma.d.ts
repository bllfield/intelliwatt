import type { PrismaClient } from "@prisma/client";

declare module "@prisma/client" {
  // Temporary augmentation to satisfy type-checkers until Prisma migration history is re-baselined.
  // Once prisma generate runs in CI, the official client already includes this delegate.
  interface PrismaClient {
    smtAuthorization: any;
  }
}

