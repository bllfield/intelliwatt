import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { WattBuyClient } from '@/lib/wattbuy/client';

export async function POST(request: NextRequest) {
  try {
    // Get user email from cookie
    const cookieStore = cookies();
    const userEmail = cookieStore.get('intelliwatt_user')?.value;
    
    if (!userEmail) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { address, city, state, zip, smartMeterConsent } = await request.json();

    // Validate required fields
    if (!address || !city || !state || !zip) {
      return NextResponse.json({ 
        error: 'Address, city, state, and zip are required' 
      }, { status: 400 });
    }

    // Validate Texas only (for now)
    if (state.toUpperCase() !== 'TX') {
      return NextResponse.json({ 
        error: 'Only Texas addresses are currently supported' 
      }, { status: 400 });
    }

    // Find user
    const user = await db.user.findUnique({
      where: { email: userEmail },
      include: { profile: true }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Validate address with WattBuy API
    let esiid = null;
    let tdspSlug = null;
    let addressValid = false;

    try {
      const wb = new WattBuyClient();
      const esiLookup = await wb.getESIByAddress({ 
        line1: address, 
        city, 
        state: state.toUpperCase(), 
        zip 
      });
      
      if (esiLookup?.addresses?.[0]?.esiid) {
        esiid = esiLookup.addresses[0].esiid;
        addressValid = true;
        
        // Extract TDSP slug
        const utilityInfo = await wb.getUtilityInfo({ 
          line1: address, 
          city, 
          state: state.toUpperCase(), 
          zip 
        });
        tdspSlug = wb.extractTdspSlug(utilityInfo);
      }
    } catch (error) {
      console.error('Address validation error:', error);
      // Continue without ESIID - user can still save address
    }

    // Create or update user profile
    const profileData = {
      address: `${address}, ${city}, ${state.toUpperCase()} ${zip}`,
      zipCode: zip,
      // Store individual components for future use
      addressLine1: address,
      addressCity: city,
      addressState: state.toUpperCase(),
      addressZip: zip,
      esiid: esiid,
      tdspSlug: tdspSlug,
      addressValidated: addressValid,
      smartMeterConsent: smartMeterConsent || false,
      smartMeterConsentDate: smartMeterConsent ? new Date() : null
    };

    let profile;
    if (user.profile) {
      profile = await db.userProfile.update({
        where: { userId: user.id },
        data: profileData
      });
    } else {
      profile = await db.userProfile.create({
        data: {
          userId: user.id,
          ...profileData
        }
      });
    }

    // Create an entry for address completion
    await db.entry.create({
      data: {
        userId: user.id,
        type: 'address_completed',
        amount: 1,
        description: 'Service address added and validated'
      }
    });

    // If Smart Meter consent given, create another entry
    if (smartMeterConsent) {
      await db.entry.create({
        data: {
          userId: user.id,
          type: 'smart_meter_consent',
          amount: 1,
          description: 'Smart Meter Texas consent provided'
        }
      });
    }

    return NextResponse.json({
      success: true,
      profile: {
        address: profile.address,
        zipCode: profile.zipCode,
        esiid: profile.esiid,
        addressValidated: profile.addressValidated,
        smartMeterConsent: profile.smartMeterConsent,
        smartMeterConsentDate: profile.smartMeterConsentDate
      },
      message: addressValid 
        ? 'Address validated successfully! ESIID found.' 
        : 'Address saved. ESIID lookup will be retried later.'
    });

  } catch (error) {
    console.error('Error saving address:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get user email from cookie
    const cookieStore = cookies();
    const userEmail = cookieStore.get('intelliwatt_user')?.value;
    
    if (!userEmail) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Find user and profile
    const user = await db.user.findUnique({
      where: { email: userEmail },
      include: { profile: true }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      profile: user.profile ? {
        address: user.profile.address,
        zipCode: user.profile.zipCode,
        esiid: user.profile.esiid,
        addressValidated: user.profile.addressValidated,
        smartMeterConsent: user.profile.smartMeterConsent,
        smartMeterConsentDate: user.profile.smartMeterConsentDate
      } : null
    });

  } catch (error) {
    console.error('Error fetching address:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
