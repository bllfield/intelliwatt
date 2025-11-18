export interface SmtAuthorization {
  // Identity / foreign keys
  id: string;
  userId: string;
  houseId: string;
  houseAddressId: string;

  // SMT / meter identity
  esiid: string;
  meterNumber?: string | null;

  // Customer-entered values
  customerName: string;

  // Service address snapshot (captured at authorization time)
  serviceAddressLine1: string;
  serviceAddressLine2?: string | null;
  serviceCity: string;
  serviceState: string;
  serviceZip: string;

  // TDSP / Utility info
  tdspCode: string;
  tdspName: string;

  // Authorization window
  authorizationStartDate: string; // ISO date "YYYY-MM-DD"
  authorizationEndDate: string;   // ISO date "YYYY-MM-DD"

  // Consent flags
  allowIntervalUsage: boolean;
  allowHistoricalBilling: boolean;
  allowSubscription: boolean;

  // Contact info
  contactEmail: string;
  contactPhone?: string | null;

  // SMT requestor identifiers (from env/config)
  smtRequestorId: string;
  smtRequestorAuthId: string;

  // Timestamps
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
}

