// lib/wattbuy.ts

// Minimal, typed wrapper around WattBuy v3 endpoints.
// Now uses the comprehensive WattBuyClient for better error handling and type safety.

import { WattBuyClient } from './wattbuy/client';

// Create a singleton client instance
const client = new WattBuyClient();

export const WATTBUY_TEST_EMAILS = (process.env.WATTBUY_TEST_EMAILS ?? '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

export const IS_PROD = process.env.NODE_ENV === 'production';

export const wattbuy = {
  /**
   * ESIID + wattkey by address (preferred first step).
   */
  async esiidByAddress(address: string, city: string, state: string, zip: string) {
    const result = await WattBuyClient.getESIByAddress({ line1: address, city, state, zip });
    return result.addresses?.[0] || null;
  },

  /**
   * Home/utility details. Provide ONE of:
   *  - { wattkey } OR { esiid } OR { address, city, state, zip }
   */
  async homeDetails(params: {
    wattkey?: string;
    esiid?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  }) {
    if (params.esiid) {
      return WattBuyClient.getUtilityInfo({ line1: '', city: '', state: '', zip: '' }); // ESIID lookup needs different approach
    } else if (params.wattkey) {
      // For wattkey, we need to use address lookup
      if (!params.address || !params.city || !params.state || !params.zip) {
        throw new Error('Address details required for wattkey lookup');
      }
      return WattBuyClient.getUtilityInfo({ 
        line1: params.address, 
        city: params.city, 
        state: params.state, 
        zip: params.zip 
      });
    } else if (params.address && params.city && params.state && params.zip) {
      return WattBuyClient.getUtilityInfo({ 
        line1: params.address, 
        city: params.city, 
        state: params.state, 
        zip: params.zip 
      });
    } else {
      throw new Error('Must provide either esiid, wattkey, or full address details');
    }
  },

  /**
   * Live offers available for the location.
   * Provide wattkey (recommended) OR full address.
   */
  async offers(params: {
    wattkey?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  }) {
    if (params.wattkey) {
      // For wattkey, we need to get address details first
      if (!params.address || !params.city || !params.state || !params.zip) {
        throw new Error('Address details required for wattkey lookup');
      }
      const result = await client.offersByAddress({
        address: params.address,
        city: params.city,
        state: params.state,
        zip: params.zip
      });
      return result;
    } else if (params.address && params.city && params.state && params.zip) {
      const result = await client.offersByAddress({
        address: params.address,
        city: params.city,
        state: params.state,
        zip: params.zip
      });
      return result;
    } else {
      throw new Error('Must provide either wattkey or full address details');
    }
  },

  /**
   * Optional: dynamic enrollment fields for a given offer.
   */
  async formFields(offer_id: string) {
    throw new Error('Form fields not implemented in new client');
  },

  /**
   * Optional: order submission (only after collecting fields + disclosures).
   */
  async submitOrder(payload: any) {
    throw new Error('Order submission not implemented in new client');
  },

  /**
   * Optional: Retail Rate DB for regulated utilities (not a replacement for TX REP EFLs).
   */
  async retailRates(params: {
    utility_id: string;
    state: string;
    verified_from?: string;
    baseline_zone?: string;
    page?: string;
  }) {
    return WattBuyClient.getRetailRates({
      utility_id: params.utility_id,
      state: params.state,
      verified_from: params.verified_from ? parseInt(params.verified_from) : undefined,
      baseline_zone: params.baseline_zone,
      page: params.page ? parseInt(params.page) : undefined
    });
  },
};

// Convenience types you can import elsewhere if helpful
export type WattBuyOffer = {
  offer_id: string;
  offer_name?: string;
  offer_category?: string;
  link?: string;
  plan_min_bill?: number;
  plan_max_bill?: number;
  cost?: number;
  offer_data?: Record<string, unknown>;
  is_primary_offer?: boolean;
};
