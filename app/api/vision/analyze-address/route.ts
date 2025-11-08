import { NextRequest, NextResponse } from 'next/server';
import { runVisionAddressAnalysis } from '@/lib/vision/analyzeAddress';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const imageFile = formData.get('image') as File;
    
    if (!imageFile) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    // Convert File to Buffer
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());

    // Use Google Vision API to extract text
    const [result] = await runVisionAddressAnalysis(imageBuffer);

    const detections = result.textAnnotations;
    if (!detections || detections.length === 0) {
      return NextResponse.json({ 
        error: 'No text found in image',
        extractedText: '',
        address: null 
      }, { status: 400 });
    }

    // Get all extracted text
    const extractedText = detections[0].description || '';
    
    // Parse address components from the text
    const addressComponents = parseAddressFromText(extractedText);

    return NextResponse.json({
      success: true,
      extractedText,
      address: addressComponents,
      confidence: detections[0].score || 0,
    });

  } catch (error) {
    console.error('Vision API error:', error);
    return NextResponse.json({ 
      error: 'Failed to process image',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Google Vision API endpoint for address extraction',
    usage: 'POST an image file to /api/vision/analyze-address',
    supportedFormats: ['JPEG', 'PNG', 'GIF', 'BMP', 'WEBP'],
    maxFileSize: '10MB'
  });
}

function parseAddressFromText(text: string) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const zipMatch = text.match(/\b(\d{5})(?:[- ]\d{4})?\b/);
  return {
    lines,
    zip: zipMatch ? zipMatch[1] : null,
    raw: text,
  };
}
