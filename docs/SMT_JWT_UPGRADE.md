## SMT JWT Upgrade Alignment (2025)

Smart Meter Texas upgraded its security model per Market Notice **SMT-M-A051425-10** (May 14, 2025). IntelliWatt now treats this notice and the **SMT Interface Guide v2** as the canonical reference.

### Access Token Flow

1. POST to `${SMT_API_BASE_URL}/v2/token/` (or `/v2/access/token/` for the SOAP token service):

   ```json
   {
     "username": "<SERVICE_ID_USERNAME>",
     "password": "<SERVICE_ID_PASSWORD>"
   }
   ```

2. SMT returns:

   ```json
   {
     "statusCode": "200",
     "accessToken": "<JWT_STRING>",
     "tokenType": "Bearer",
     "expiresIn": "3600",
     "issuedAt": "MM/DD/YYYY HH:MM:SS",
     "expiresAt": "MM/DD/YYYY HH:MM:SS"
   }
   ```

3. All REST/SOAP calls must include:

   ```
   Authorization: Bearer <accessToken>
   ```

### Rules

- Legacy FTPS and “API without JWT” paths are decommissioned and must **not** be reintroduced.
- Environment variables must include:
  - `SMT_API_BASE_URL`
  - `SMT_USERNAME`
  - `SMT_PASSWORD`
  - `SMT_REQUESTOR_ID`
  - `SMT_REQUESTOR_AUTH_ID`
- Any references to `SMT_JWT_CLIENT_ID` / `SMT_JWT_CLIENT_SECRET` are considered **legacy** and only retained for historical context.

> **Service ID / Requestor mapping**  
> SMT requires the API Service ID to be consistent between the token request, the `requestorID` field in payloads, and the user configured in the SMT portal. In IntelliWatt production (2025-11-21):  
> - `SMT_USERNAME` = `INTELLIPATH` (API Service ID)  
> - `SMT_REQUESTOR_ID` = `INTELLIPATH` (must match the service ID SMT expects)  
> - `SMT_REQUESTOR_AUTH_ID` = `134642921` (Intellipath Solutions LLC DUNS on SMT)

### Deployment Guidance

- Token acquisition can live on Vercel **or** the droplet, provided the calling IP is whitelisted by SMT.
- Cache tokens until ~60 seconds before expiration; refresh by re-posting the service ID credentials.
- For SFTP usage ingestion, continue to use the existing droplet cron + `/api/admin/smt/pull` workflows.

