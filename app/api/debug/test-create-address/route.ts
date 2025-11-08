import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return await handleRequest();
}

export async function POST(req: NextRequest) {
  return await handleRequest();
}

async function handleRequest(): Promise<NextResponse> {
  try {
    console.log("Debug: Testing address creation...");
    
    // Try to create a test address record
    const testAddress = await prisma.houseAddress.create({
      data: {
        userId: "bllfield32@gmail.com",
        addressLine1: "123 Test Street",
        addressCity: "Houston",
        addressState: "TX",
        addressZip5: "77001",
        addressCountry: "US",
        validationSource: "USER",
        smartMeterConsent: true,
        smartMeterConsentDate: new Date()
      }
    });
    
    console.log("Debug: Test address created successfully:", testAddress);
    
    // Clean up
    await prisma.houseAddress.delete({
      where: { id: testAddress.id }
    });
    
    console.log("Debug: Test address cleaned up");
    
    return NextResponse.json({ 
      success: true,
      message: "Address creation test successful",
      testAddress: testAddress
    });
    
  } catch (error: any) {
    console.error("Debug: Address creation test failed:", error);
    return NextResponse.json({ 
      success: false, 
      error: error.message,
      code: error.code,
      meta: error.meta
    }, { status: 500 });
  }
}
