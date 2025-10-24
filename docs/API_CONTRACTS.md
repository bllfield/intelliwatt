# API Contracts (v1)

## Response Stability

### Breaking Changes Policy
- **Responses are stable** - breaking changes require v2
- **Additive changes only** in v1 (new fields, optional parameters)
- **Deprecation timeline** for removed fields (6+ months notice)
- **Version negotiation** via Accept header or URL path

### Version Lifecycle
- **v1**: Current stable version
- **v2**: Next major version (breaking changes)
- **Deprecated**: 6-month sunset period
- **Removed**: No longer supported

## Example Contract: House Profile

### Endpoint
```
GET /api/v1/houses/{id}/profile
```

### Response Format
```json
{
  "id": "addr_uuid",
  "line1": "123 Main St",
  "line2": "Apt 4B",
  "city": "Fort Worth",
  "state": "TX",
  "zip5": "76107",
  "zip4": "1234",
  "country": "US",
  "lat": 32.75,
  "lng": -97.35,
  "validated": true,
  "esiid": "1044372...",
  "tdsp": "oncor",
  "utility": {
    "name": "Oncor",
    "phone": "1-888-313-4747"
  },
  "createdAt": "2025-01-15T10:30:00Z",
  "updatedAt": "2025-01-15T10:30:00Z"
}
```

### Field Specifications

#### Required Fields
- **`id`**: Unique address identifier (UUID)
- **`line1`**: Street address (string, non-empty)
- **`city`**: City name (string, non-empty)
- **`state`**: State abbreviation (string, 2 characters)
- **`zip5`**: ZIP code (string, 5 digits)
- **`country`**: Country code (string, default "US")
- **`validated`**: Address validation status (boolean)

#### Optional Fields
- **`line2`**: Apartment/suite number (string, nullable)
- **`zip4`**: ZIP+4 extension (string, 4 digits, nullable)
- **`lat`**: Latitude (number, nullable)
- **`lng`**: Longitude (number, nullable)
- **`esiid`**: Electric Service Identifier (string, nullable)
- **`tdsp`**: TDSP slug (string, nullable)

#### Nested Objects
- **`utility`**: Utility company information
  - **`name`**: Company name (string, nullable)
  - **`phone`**: Contact phone (string, nullable)

#### Timestamps
- **`createdAt`**: ISO 8601 timestamp (string)
- **`updatedAt`**: ISO 8601 timestamp (string)

## Error Response Format

### Standard Error Structure
```json
{
  "error": "Error message",
  "errorClass": "VALIDATION",
  "corrId": "uuid-string",
  "details": {
    "field": "email",
    "message": "Invalid email format"
  }
}
```

### Error Classes
- **`VALIDATION`**: Input validation failures
- **`NETWORK`**: External API connectivity issues
- **`DATABASE`**: Database connection or query errors
- **`AUTHENTICATION`**: User authentication failures
- **`AUTHORIZATION`**: Permission/access control issues
- **`BUSINESS_LOGIC`**: Application-specific errors
- **`UNKNOWN`**: Unclassified errors

## Data Model Reference

### HouseAddress Model
The API response maps to the `HouseAddress` Prisma model:

```prisma
model HouseAddress {
  id                    String   @id @default(uuid())
  userId                String
  houseId               String?
  
  addressLine1          String
  addressLine2          String?
  addressCity           String
  addressState          String
  addressZip5           String
  addressZip4           String?
  addressCountry        String   @default("US")
  
  placeId               String?
  lat                   Float?
  lng                   Float?
  
  addressValidated      Boolean  @default(false)
  validationSource      ValidationSource @default(NONE)
  
  esiid                 String?  @unique
  tdspSlug              String?
  utilityName           String?
  utilityPhone          String?
  
  smartMeterConsent     Boolean  @default(false)
  smartMeterConsentDate DateTime?
  
  rawGoogleJson         Json?
  rawWattbuyJson        Json?
  
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}
```

## Validation Rules

### Address Validation
- **Required fields**: line1, city, state, zip5
- **State format**: 2-character uppercase (TX, CA, etc.)
- **ZIP format**: 5 digits for zip5, 4 digits for zip4
- **Coordinates**: Valid latitude (-90 to 90), longitude (-180 to 180)

### ESIID Validation
- **Format**: Alphanumeric string
- **Length**: Variable (typically 10-20 characters)
- **Uniqueness**: Must be unique across all addresses

### Utility Information
- **Name**: Non-empty string if provided
- **Phone**: Valid phone number format if provided

## Rate Limiting

### Limits
- **Per IP**: 100 requests per minute
- **Per User**: 1000 requests per hour
- **Burst**: Allow 10 requests per second

### Headers
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
```

## Caching

### Cache Headers
- **ETag**: For conditional requests
- **Cache-Control**: `max-age=300` (5 minutes)
- **Vary**: `Accept, Authorization`

### Cache Invalidation
- **On update**: Invalidate by address ID
- **On delete**: Remove from cache
- **TTL**: Automatic expiration after 5 minutes
