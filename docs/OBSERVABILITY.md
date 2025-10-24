# Observability

## Correlation ID Usage

### Request Tracking
- **Generate correlation ID** if not present in headers
- **Check headers**: `x-corr-id` or `x-request-id`
- **Fallback**: Generate UUID using `crypto.randomUUID()`
- **Include in all logs** and API responses

### Implementation
```typescript
import { getCorrelationId } from '@/lib/correlation';

export async function GET(request: Request) {
  const corrId = getCorrelationId(request.headers);
  // Use corrId in all logging and responses
}
```

## Required Log Fields

### Structured Logging
Every log entry must include:
- **`corrId`**: Correlation identifier for request tracking
- **`route`**: API endpoint path (e.g., `/api/health`)
- **`durationMs`**: Request processing time in milliseconds
- **`status`**: HTTP status code (200, 400, 500, etc.)
- **`errorClass`**: Error categorization (VALIDATION, NETWORK, DATABASE, etc.)

### Log Format
```json
{
  "corrId": "uuid-string",
  "route": "health",
  "status": 200,
  "durationMs": 45,
  "errorClass": null
}
```

## Metrics to Track

### Data Quality Metrics
- **`unmapped_fields_count`**: Fields that couldn't be transformed
- **`transformer_errors`**: Processing failures by component
- **`esiid_resolution_rate`**: Address validation success rate
- **`api_response_times`**: Performance by endpoint

### Business Metrics
- **`user_registration_rate`**: New user signups
- **`address_completion_rate`**: Users who complete address entry
- **`smart_meter_consent_rate`**: SMT opt-in percentage
- **`plan_switch_requests`**: Energy plan switching attempts

### System Metrics
- **`database_connection_pool`**: Active/idle connections
- **`cache_hit_rate`**: Cache effectiveness
- **`external_api_latency`**: Third-party service response times
- **`error_rate_by_endpoint`**: Failure rates by API route

## Health Monitoring

### Primary Health Check
- **Endpoint**: `/api/health` (App Router at `app/api/health/route.ts`)
- **Response**: `{ ok: true, db: "up", corrId }`
- **Status**: 200 for healthy, 503 for unhealthy
- **Database**: Simple ping using `prisma.$queryRaw`

### Optional Dependency Checks
- **`/api/deps/wattbuy`**: WattBuy API connectivity
- **`/api/deps/smt`**: Smart Meter Texas API status
- **`/api/deps/google`**: Google APIs (Vision, Places) status

### Health Check Implementation
```typescript
export async function GET(request: Request) {
  const corrId = getCorrelationId(request.headers);
  const start = Date.now();
  
  try {
    await prisma.$queryRaw`SELECT 1`;
    const durationMs = Date.now() - start;
    
    console.log(JSON.stringify({ 
      corrId, route: "health", status: 200, durationMs 
    }));
    
    return NextResponse.json({ 
      ok: true, db: "up", corrId 
    }, { status: 200 });
  } catch (err) {
    const durationMs = Date.now() - start;
    console.error(JSON.stringify({ 
      corrId, route: "health", status: 503, durationMs, 
      error: "DB_DOWN" 
    }));
    
    return NextResponse.json({ 
      ok: false, db: "down", corrId 
    }, { status: 503 });
  }
}
```

## Error Classification

### Error Classes
- **`VALIDATION`**: Input validation failures
- **`NETWORK`**: External API connectivity issues
- **`DATABASE`**: Database connection or query errors
- **`AUTHENTICATION`**: User authentication failures
- **`AUTHORIZATION`**: Permission/access control issues
- **`BUSINESS_LOGIC`**: Application-specific errors
- **`UNKNOWN`**: Unclassified errors

### Error Response Format
```json
{
  "error": "Validation failed",
  "errorClass": "VALIDATION",
  "corrId": "uuid-string",
  "details": {
    "field": "email",
    "message": "Invalid email format"
  }
}
```

## Monitoring Integration

### Log Aggregation
- **Structured JSON logs** for easy parsing
- **Correlation ID tracking** across services
- **Error classification** for alerting
- **Performance metrics** for optimization

### Alerting Thresholds
- **Error rate**: >5% for any endpoint
- **Response time**: >2s for health checks
- **Database**: Connection pool exhaustion
- **External APIs**: >10s response time

### Dashboard Metrics
- **Request volume** by endpoint
- **Error rates** by error class
- **Response times** (p50, p95, p99)
- **Database performance** metrics
