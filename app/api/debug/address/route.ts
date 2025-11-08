import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    console.log("Debug: Testing database connection...");
    
    // Test basic database connection
    await prisma.$queryRaw`SELECT 1`;
    console.log("Debug: Database connection successful");
    
    // Test if HouseAddress table exists
    const tableExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'HouseAddress'
      );
    `;
    console.log("Debug: HouseAddress table exists:", tableExists);
    
    // Test creating a simple record
    const testRecord = await prisma.houseAddress.create({
      data: {
        userId: "test-user",
        addressLine1: "123 Test St",
        addressCity: "Test City",
        addressState: "TX",
        addressZip5: "12345",
        addressCountry: "US",
        validationSource: "USER",
        smartMeterConsent: false
      }
    });
    console.log("Debug: Test record created:", testRecord);
    
    // Clean up test record
    await prisma.houseAddress.delete({
      where: { id: testRecord.id }
    });
    console.log("Debug: Test record cleaned up");
    
    return NextResponse.json({ 
      success: true, 
      message: "Database and HouseAddress model working correctly",
      tableExists: tableExists[0]?.exists,
      testRecord: testRecord
    });
    
  } catch (error: any) {
    console.error("Debug: Database test failed:", error);
    return NextResponse.json({ 
      success: false, 
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}
