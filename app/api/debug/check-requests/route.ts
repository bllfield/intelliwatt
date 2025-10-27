import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  return NextResponse.json({ 
    message: "This endpoint shows recent API requests",
    note: "Check Vercel logs or browser console for actual request logs",
    usefulEndpoints: {
      checkAddress: "/api/debug/check-address",
      testAddress: "/api/debug/test-create-address",
      googleMaps: "/api/debug/google-maps",
      migrate: "/api/migrate"
    }
  });
}
