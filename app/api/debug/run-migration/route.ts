import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    console.log("Debug: Running database migration...");
    
    // Check if HouseAddress table exists first
    const tableExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'HouseAddress'
      );
    `;
    
    if (tableExists[0]?.exists) {
      console.log("Debug: HouseAddress table already exists");
      return NextResponse.json({ 
        success: true,
        message: "HouseAddress table already exists",
        tableExists: true
      });
    }
    
    console.log("Debug: HouseAddress table does not exist, creating...");
    
    // Create the ValidationSource enum
    await prisma.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "ValidationSource" AS ENUM ('NONE', 'GOOGLE', 'USER', 'OTHER');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;
    
    // Create the HouseAddress table
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "HouseAddress" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "houseId" TEXT,
        "addressLine1" TEXT NOT NULL,
        "addressLine2" TEXT,
        "addressCity" TEXT NOT NULL,
        "addressState" TEXT NOT NULL,
        "addressZip5" TEXT NOT NULL,
        "addressZip4" TEXT,
        "addressCountry" TEXT NOT NULL DEFAULT 'US',
        "placeId" TEXT,
        "lat" DOUBLE PRECISION,
        "lng" DOUBLE PRECISION,
        "addressValidated" BOOLEAN NOT NULL DEFAULT false,
        "validationSource" "ValidationSource" NOT NULL DEFAULT 'NONE',
        "esiid" TEXT,
        "tdspSlug" TEXT,
        "utilityName" TEXT,
        "utilityPhone" TEXT,
        "smartMeterConsent" BOOLEAN NOT NULL DEFAULT false,
        "smartMeterConsentDate" TIMESTAMP(3),
        "rawGoogleJson" JSONB,
        "rawWattbuyJson" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "HouseAddress_pkey" PRIMARY KEY ("id")
      );
    `;
    
    // Create indexes
    await prisma.$executeRaw`
      CREATE UNIQUE INDEX IF NOT EXISTS "HouseAddress_esiid_key" ON "HouseAddress"("esiid");
    `;
    
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "HouseAddress_placeId_idx" ON "HouseAddress"("placeId");
    `;
    
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "HouseAddress_addressState_addressZip5_idx" ON "HouseAddress"("addressState", "addressZip5");
    `;
    
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "HouseAddress_esiid_idx" ON "HouseAddress"("esiid");
    `;
    
    console.log("Debug: Migration completed successfully");
    
    return NextResponse.json({ 
      success: true,
      message: "Database migration completed successfully",
      tableExists: false,
      migrationApplied: true
    });
    
  } catch (error: any) {
    console.error("Debug: Migration failed:", error);
    return NextResponse.json({ 
      success: false, 
      error: error.message,
      code: error.code
    }, { status: 500 });
  }
}
