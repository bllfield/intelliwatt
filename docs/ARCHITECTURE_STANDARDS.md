# IntelliWatt Architecture Standards (Core)

## Core Principles

### CDM-First Approach
- **UI consumes Canonical Data Model endpoints only**
- All user-facing data must flow through normalized, validated endpoints
- Raw data is stored separately and transformed before UI consumption
- No direct database queries in UI components

### RAW Storage Before Normalization
- **Always store raw payloads before processing**
- Preserve original data in `rawGoogleJson`, `rawWattbuyJson`, etc.
- Transform and normalize in separate steps
- Enable data reprocessing and debugging without re-fetching

### API Versioning Strategy
- **Internal APIs versioned: `/api/v1/...`**
- Breaking changes require new version (v2, v3, etc.)
- Maintain backward compatibility for at least one version
- Document version lifecycle and deprecation timeline

### Idempotent Ingestion
- **Deduplicate by (source_id, timestamp)**
- All data ingestion must be re-runnable
- Handle duplicate submissions gracefully
- Use upsert patterns for data consistency

### Safe Migration Patterns
- **Deprecate → Backfill → Cutover → Remove**
- Never remove old systems until new ones are proven
- Maintain parallel systems during transition
- Document rollback procedures

## Observability Requirements

### Correlation Tracking
- **Every request must have correlation ID**
- Use `x-corr-id` header or generate UUID
- Include correlation ID in all logs and responses
- Track request flow across services

### Required Log Fields
- `corrId`: Correlation identifier
- `route`: API endpoint path
- `durationMs`: Request processing time
- `status`: HTTP status code
- `errorClass`: Error categorization

### Metrics to Track
- `unmapped_fields_count`: Data transformation issues
- `transformer_errors`: Processing failures
- `esiid_resolution_rate`: Address validation success
- `api_response_times`: Performance monitoring

## Security Practices

### Environment Variables
- **Secrets stored in environment variables only**
- Never commit API keys or credentials
- Use different keys per environment
- Rotate keys on project changes

### API Key Restrictions
- **Google API keys restricted by referrer**
- Limit API access to specific domains/IPs
- Monitor usage and set quotas
- Implement rate limiting

### PII Handling
- **Do not log PII values**
- Hash sensitive data when useful for debugging
- Minimize PII exposure in responses
- Implement data retention policies

## UI Resilience

### Safe Response Shapes
- **Always return UI-safe shapes**
- Guard against null/undefined values
- Provide sensible defaults
- Handle partial data gracefully

### Loading States
- **Use skeletons for loading states**
- Show progress indicators for long operations
- Implement timeout handling
- Provide retry mechanisms

## Health Monitoring

### Health Endpoints
- **Primary**: `/api/health` (App Router at `app/api/health/route.ts`)
- **Optional**: `/api/deps/wattbuy` for upstream dependency checks
- Return `{ ok, db, corrId }` with appropriate status codes
- Include structured logging for monitoring

### Database Health
- Simple ping using `prisma.$queryRaw`
- Return 200 for healthy, 503 for unhealthy
- Include response time in logs
- Monitor connection pool status

## Implementation Guidelines

### File Organization
- Keep related functionality in modules
- Use consistent naming conventions
- Document public APIs thoroughly
- Maintain backward compatibility

### Error Handling
- Use structured error responses
- Include correlation IDs in error logs
- Categorize errors by type
- Provide actionable error messages

### Performance
- Implement caching strategies
- Monitor response times
- Use connection pooling
- Optimize database queries
