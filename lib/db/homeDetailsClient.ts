import { PrismaClient as HomeDetailsPrismaClient } from "@prisma/home-details-client";

declare global {
  // eslint-disable-next-line no-var
  var homeDetailsPrisma: HomeDetailsPrismaClient | undefined;
}

const homeDetailsClient =
  globalThis.homeDetailsPrisma ??
  new HomeDetailsPrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

globalThis.homeDetailsPrisma = homeDetailsClient;

export function getHomeDetailsPrisma() {
  return homeDetailsClient;
}

export { homeDetailsClient as homeDetailsPrisma };

