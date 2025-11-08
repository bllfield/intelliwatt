import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    
    return NextResponse.json({ 
      success: true,
      hasApiKey: !!apiKey,
      apiKeyLength: apiKey ? apiKey.length : 0,
      apiKeyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : 'Not set',
      message: apiKey ? 'Google Maps API key is configured' : 'Google Maps API key is missing'
    });
    
  } catch (error: any) {
    console.error("Debug: Google Maps check failed:", error);
    return NextResponse.json({ 
      success: false, 
      error: error.message
    }, { status: 500 });
  }
}
