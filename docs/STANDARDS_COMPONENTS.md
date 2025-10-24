# Component Standards

## WattBuy Integration

### RAW Storage
- **Store**: `raw_wattbuy(payload, address_id, ingested_at)`
- Preserve complete API responses before processing
- Include request metadata (timestamp, source, user context)
- Enable debugging and reprocessing

### Transformer
- **Transform**: `tx_wattbuy_to_meter → meter(esiid, utilityName, tdspSlug)`
- Extract utility information from WattBuy responses
- Normalize utility names and TDSP slugs
- Handle missing or malformed data gracefully

### Resilience
- **Retries**: 3 attempts with exponential backoff
- **Circuit breaker**: Fail fast after repeated failures
- **Cache**: Utility metadata by ZIP5 for performance
- **Fallback**: Graceful degradation when API unavailable

## SMT Ingestion

### RAW Storage
- **Store**: `raw_smt_files`, `raw_smt_intervals`
- Preserve original XML/JSON responses
- Include file metadata (upload time, user, validation status)
- Maintain audit trail for compliance

### Transformer
- **Transform**: `tx_smt_to_usage_interval`
- **Idempotent upsert** on `meter_id + timestamp`
- Handle duplicate intervals gracefully
- Validate data ranges and formats

### Ordering Guarantees
- **Process files in chronological order**
- Maintain interval sequence integrity
- Handle out-of-order data gracefully
- Implement re-runnable backfills

## Green Button Integration

### RAW Storage
- **Store**: `raw_green_button (XML)`
- Preserve complete XML documents
- Include parsing metadata and validation results
- Enable XML schema validation

### Processing
- **Strict schema validation** before processing
- **Transform**: `→ usage_interval(source='green_button')`
- Handle multiple interval formats
- Validate date ranges and units

### Error Handling
- **Schema validation errors**: Log and skip invalid documents
- **Parsing errors**: Attempt partial recovery
- **Data quality issues**: Flag for manual review

## Plan Analyzer

### Input Requirements
- **CDM inputs only**: `usage_interval`, `service_address`, `meter`
- No direct raw data access
- Validated, normalized data only
- Consistent data formats

### Output Standards
- **Immutable results**: `analysis_result`
- **Versioned outputs**: Include analysis version
- **Config hash**: Track analysis parameters
- **Reproducible**: Same inputs = same outputs

### Performance
- **Caching**: Cache results by input hash
- **Batch processing**: Handle multiple analyses efficiently
- **Resource limits**: Prevent runaway analysis
- **Timeout handling**: Graceful failure for long operations

## Billing OCR (Vision)

### RAW Storage
- **Store**: `bill_extract` (image + OCR JSON)
- Preserve original images and extracted text
- Include OCR confidence scores
- Maintain processing metadata

### Validation Workflow
- **User validation required** before CDM promotion
- **Manual review** for low-confidence extractions
- **Correction interface** for user feedback
- **Audit trail** for compliance

### Data Quality
- **Confidence thresholds**: Only promote high-confidence data
- **Validation flags**: Track user approval status
- **Error correction**: Allow user modifications
- **Re-processing**: Enable OCR retry with different settings
