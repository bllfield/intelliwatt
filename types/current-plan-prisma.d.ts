declare module '@prisma/current-plan-client' {
  import type { PrismaClientOptions } from '@prisma/client';
  import type { Prisma as BasePrisma } from '@prisma/client';

  export namespace Prisma {
    export import Decimal = BasePrisma.Decimal;
    export type PrismaClientKnownRequestError = BasePrisma.PrismaClientKnownRequestError;
    export type PrismaClientValidationError = BasePrisma.PrismaClientValidationError;
  }

  export class PrismaClient {
    constructor(options?: PrismaClientOptions);
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
    currentPlanManualEntry: {
      create<T = any>(args: T): Promise<any>;
    };
    currentPlanBillUpload: {
      create<T = any>(args: T): Promise<any>;
    };
  }
}

