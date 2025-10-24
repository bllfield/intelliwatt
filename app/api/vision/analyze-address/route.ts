import { NextRequest, NextResponse } from 'next/server';
import { ImageAnnotatorClient } from '@google-cloud/vision';

// Initialize Google Vision client
const visionClient = new ImageAnnotatorClient({
  credentials: {
    type: 'service_account',
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.GOOGLE_CLIENT_EMAIL}`,
  },
});

interface AddressComponents {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  fullAddress?: string;
}

function parseAddressFromText(text: string): AddressComponents {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  // Common US state abbreviations
  const states = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
  ];

  const result: AddressComponents = {};
  
  // Look for ZIP code pattern (5 digits or 5-4 format)
  const zipPattern = /\b(\d{5}(?:-\d{4})?)\b/;
  const zipMatch = text.match(zipPattern);
  if (zipMatch) {
    result.zipCode = zipMatch[1];
  }

  // Look for state pattern
  const statePattern = new RegExp(`\\b(${states.join('|')})\\b`, 'i');
  const stateMatch = text.match(statePattern);
  if (stateMatch) {
    result.state = stateMatch[1].toUpperCase();
  }

  // Try to identify city (usually before state)
  if (stateMatch && stateMatch.index) {
    const beforeState = text.substring(0, stateMatch.index).trim();
    const cityMatch = beforeState.match(/([A-Za-z\s]+)$/);
    if (cityMatch) {
      result.city = cityMatch[1].trim();
    }
  }

  // Look for street address (usually contains numbers)
  const streetPattern = /\b(\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Circle|Cir|Court|Ct|Place|Pl))\b/i;
  const streetMatch = text.match(streetPattern);
  if (streetMatch) {
    result.street = streetMatch[1].trim();
  } else {
    // Fallback: look for any line with numbers
    const numberPattern = /\b(\d+\s+[A-Za-z\s]+)\b/;
    const numberMatch = text.match(numberPattern);
    if (numberMatch) {
      result.street = numberMatch[1].trim();
    }
  }

  // Combine all components into full address
  const components = [result.street, result.city, result.state, result.zipCode].filter(Boolean);
  if (components.length > 0) {
    result.fullAddress = components.join(', ');
  }

  return result;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const imageFile = formData.get('image') as File;
    
    if (!imageFile) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    // Convert File to Buffer
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());

    // Use Google Vision API to extract text
    const [result] = await visionClient.textDetection({
      image: { content: imageBuffer },
    });

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
