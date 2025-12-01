declare module '../../.prisma/*' {
  class PrismaClient {
    constructor(...args: any[]);
  }

  export { PrismaClient };
}

