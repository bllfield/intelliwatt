# SMT Environment Variables

> **Source:** Smart Meter Texas Retail Electric Provider / CSP / TDSP Data Access Interface Guide (July 1, 2025).  
> IntelliWatt uses SMT’s REST APIs with *service ID username/password* tokens—OAuth `client_id`/`client_secret` are no longer used.

## Core (Vercel / Server)

- `ADMIN_TOKEN` – Admin bearer for all `/api/admin/*` routes (`x-admin-token` header).  
- `SMT_API_BASE_URL` – Defaults to `https://services.smartmetertexas.net`; override only for UAT.  
- `SMT_USERNAME` – SMT service ID username (must match `requestorID`).  
- `SMT_PASSWORD` – SMT service ID password.  
- `SMT_REQUESTOR_ID` – Requestor ID placed in SMT payloads (`requestorID`). Usually identical to `SMT_USERNAME`.  
- `SMT_REQUESTOR_AUTH_ID` – SMT/PUCT authentication ID (e.g., DUNS). Placed in `requesterAuthenticationID`.  

### Token Generation

IntelliWatt requests tokens via:

```
POST {SMT_API_BASE_URL}/v2/token/
Content-Type: application/json
{
  "username": "<SMT_USERNAME>",
  "password": "<SMT_PASSWORD>"
}
```

Response shape (per SMT guide):

```
{
  "statusCode": 200,
  "accessToken": "...",
  "tokenType": "Bearer",
  "expiresIn": "3600",
  "issuedAt": "2025-11-17T19:10:07Z",
  "expiresAt": "2025-11-17T20:10:07Z"
}
```

`lib/smt/token.ts` caches tokens until ~60 seconds before expiration.

## Request/Delivery Metadata

- `SMT_API_BASE_URL` – shared base for interval/daily/monthly REST endpoints.  
- `SMT_REQUESTOR_ID` – service ID (same value sent in the “requestor” field).  
- `SMT_REQUESTOR_AUTH_ID` – Authentication identifier required in SMT payloads.  

### Droplet-only: SMT token proxy

Used exclusively on the SMT droplet to expose a local JWT proxy.

| Name            | Example Value                              | Description                                                                  |
|-----------------|--------------------------------------------|------------------------------------------------------------------------------|
| SMT_PROXY_TOKEN | ChangeThisToAStrongSharedSecret_1763428355 | Shared secret; requests to the proxy must send `x-proxy-token` with this value. |
| SMT_PROXY_PORT  | 4101                                       | Local HTTP port for the proxy (default 4101, bound to 127.0.0.1).            |

Env file on droplet (`/etc/default/smt-token-proxy`) typically includes:

```ini
SMT_API_BASE_URL="https://services.smartmetertexas.net"
SMT_USERNAME="INTELLIWATTAPI"
SMT_PASSWORD="********"
SMT_PROXY_TOKEN="ChangeThisToAStrongSharedSecret_1763428355"
SMT_PROXY_PORT="4101"
```

systemd unit `smt-token-proxy.service` runs:

```
/usr/bin/node /home/deploy/smt-token-proxy.js
```

Only requests with the correct `x-proxy-token` are forwarded to SMT `/v2/token/`.

## Droplet ingest + webhook shared environment

The droplet services `smt-ingest.service` (timer) and `smt-webhook.service` (on-demand) both source core variables from `/etc/default/intelliwatt-smt`:

- `SMT_HOST` – SMT SFTP host, e.g. `services.smartmetertexas.net`.
- `SMT_USER` – SFTP username.
- `SMT_KEY` – Path to private key used for SFTP (`chmod 600`).
- `SMT_REMOTE_DIR` – Remote SFTP directory containing SMT exports.
- `SMT_LOCAL_DIR` – Local inbox directory on the droplet (e.g. `/home/deploy/smt_inbox`).
- `INTELLIWATT_BASE_URL` – Public base URL for the IntelliWatt app (used when calling `/api/admin/smt/pull`).
- `ADMIN_TOKEN` – 64-character admin token for authenticated ingest posts.

`/etc/default/intelliwatt-smt` must be readable by systemd (root:root 640 works) so both services inherit the same values. Vercel does **not** have access to SMT credentials; they remain droplet-only.

### Webhook-specific secrets

`smt-webhook.service` also loads `/home/deploy/smt_ingest/.env` for local settings (port, logging, etc.) and combines it with `/etc/default/intelliwatt-smt`. The webhook expects one of the following headers to match the shared secret:

- `INTELLIWATT_WEBHOOK_SECRET` – canonical secret for Vercel → droplet.
- `DROPLET_WEBHOOK_SECRET` – legacy/alternate secret.

Acceptable header names: `x-intelliwatt-secret`, `x-droplet-webhook-secret`, `x-proxy-secret`.

## Droplet / Webhook (existing)

- `INTELLIWATT_WEBHOOK_SECRET` – Shared secret for droplet webhook headers (`x-intelliwatt-secret`).  
- `DROPLET_WEBHOOK_URL` – e.g., `http://64.225.25.54:8787/trigger/smt-now`.  
- `SMT_HOST`, `SMT_USER`, `SMT_KEY`, `SMT_REMOTE_DIR`, `SMT_LOCAL_DIR` – SFTP ingest configuration.  
- Optional defaults: `SOURCE_TAG`, `METER_DEFAULT`, `ESIID_DEFAULT` for legacy inline ingest script behaviour.

## Deprecated / Legacy

- `SMT_JWT_CLIENT_ID`, `SMT_JWT_CLIENT_SECRET` – **Deprecated.** The project no longer reads these values. Remove them after confirming no other services depend on them.

## Notes

- Always pass `x-admin-token` when invoking admin endpoints.  
- Inline `/api/admin/smt/pull` persists uploaded files and normalizes them immediately.  
- Replace any legacy `x-proxy-secret` usage with `x-intelliwatt-secret`.
