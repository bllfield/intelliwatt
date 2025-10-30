// Entry opportunities configuration for HitTheJackWatt
// Defines all entry types and their amounts

export type EntryType = 
  | 'signup'
  | 'dashboard_visit'
  | 'smart_meter_connect'
  | 'home_details_complete'
  | 'appliance_details_complete'
  | 'referral'
  | 'testimonial';

export interface EntryOpportunity {
  id: EntryType;
  label: string;
  description: string;
  amount: number;
  maxPerUser?: number; // undefined = unlimited
}

export const ENTRY_OPPORTUNITIES: Record<EntryType, EntryOpportunity> = {
  signup: {
    id: 'signup',
    label: 'Sign up at HitTheJackWatt™.com',
    description: 'Create your account',
    amount: 1,
    maxPerUser: 1,
  },
  dashboard_visit: {
    id: 'dashboard_visit',
    label: 'Visit Dashboard',
    description: 'Access your dashboard for the first time',
    amount: 1,
    maxPerUser: 1,
  },
  smart_meter_connect: {
    id: 'smart_meter_connect',
    label: 'Authorize Smart Meter Texas',
    description: 'Connect your smart meter data',
    amount: 10,
    maxPerUser: 1,
  },
  home_details_complete: {
    id: 'home_details_complete',
    label: 'Complete Home Details',
    description: 'Fill out your home information form',
    amount: 10,
    maxPerUser: 1,
  },
  appliance_details_complete: {
    id: 'appliance_details_complete',
    label: 'Complete Appliance Details',
    description: 'Add all your major appliances',
    amount: 10,
    maxPerUser: 1,
  },
  referral: {
    id: 'referral',
    label: 'Refer a Friend',
    description: 'Each friend who signs up earns you entries',
    amount: 5,
    maxPerUser: undefined, // Unlimited
  },
  testimonial: {
    id: 'testimonial',
    label: 'Share Testimonial',
    description: 'Share your experience after switching plans',
    amount: 5,
    maxPerUser: 1,
  },
};

// Calculate max standard entries (excluding unlimited referrals)
export const MAX_STANDARD_ENTRIES = Object.values(ENTRY_OPPORTUNITIES)
  .filter(opp => opp.maxPerUser !== undefined)
  .reduce((sum, opp) => sum + (opp.amount * (opp.maxPerUser || 1)), 0);

// Get opportunity by type
export function getOpportunity(type: EntryType): EntryOpportunity {
  return ENTRY_OPPORTUNITIES[type];
}

// Get all opportunities
export function getAllOpportunities(): EntryOpportunity[] {
  return Object.values(ENTRY_OPPORTUNITIES);
}

