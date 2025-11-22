# SMT Environment Variables

> **Source:** Smart Meter Texas Retail Electric Provider / CSP / TDSP Data Access Interface Guide (July 1, 2025).  
> IntelliWatt uses SMT’s REST APIs with *service ID username/password* tokens—OAuth `client_id`/`client_secret` are no longer used.

## Core (Vercel / Server)

- `ADMIN_TOKEN` – Admin bearer for all `/api/admin/*` routes (`x-admin-token` header).  
- `SMT_API_BASE_URL` – Defaults to `https://services.smartmetertexas.net`; override only for UAT.  
- `SMT_USERNAME` – SMT API Service ID username; this same value is sent as the SMT `username` header, `serviceId` header, and `requestorID` JSON field (e.g., `INTELLIPATH`).  
- `SMT_PASSWORD` – SMT API Service ID password.  
- `SMT_REQUESTOR_ID` – **Deprecated alias.** Historically used for `requestorID`, but the system now derives the requestor ID directly from `SMT_USERNAME`.  
- `SMT_REQUESTOR_AUTH_ID` – SMT/PUCT authentication ID (e.g., DUNS). Placed in `requesterAuthenticationID`.  
- `SMT_SERVICE_ID` – Optional explicit override for the SMT service ID; defaults to `SMT_USERNAME`.  
- `SMT_METERINFO_ENABLED` – Feature flag. When `true`, Vercel queues SMT meterInfo requests through the droplet after WattBuy returns an ESIID. SMT REST calls remain droplet-only.

### Droplet ↔ App callback envs (meterInfo and other SMT webhooks)

The SMT droplet uses the following variables to discover where to POST results (such as meterInfo payloads) back into the IntelliWatt app:

- `APP_BASE_URL` – Explicit base URL for the IntelliWatt app (e.g. `https://intelliwatt.com`). If set, this is used as-is.
- `INTELLIWATT_APP_BASE_URL` – Alternative explicit base URL; used when `APP_BASE_URL` is not set.
- `VERCEL_URL` – Last-resort hostname provided by Vercel (e.g. `intelliwatt.vercel.app`). When used, the droplet prepends `https://` to form the full base URL.

The droplet chooses the first non-empty value among `APP_BASE_URL`, `INTELLIWATT_APP_BASE_URL`, and `VERCEL_URL`, then posts meterInfo results to:

- `POST ${APP_BASE_URL}/api/admin/smt/meter-info`

For authentication, the droplet and app share a symmetric webhook secret:

- `INTELLIWATT_WEBHOOK_SECRET` – Shared secret used by the droplet to authenticate to the app via headers such as `x-intelliwatt-secret`.  
- `DROPLET_WEBHOOK_SECRET` – Alias/backup for the same value; the droplet treats either env var as valid and exposes the secret under multiple header names (`x-intelliwatt-secret`, `x-droplet-webhook-secret`, etc.).

All SMT callbacks from the droplet (including `reason: "smt_meter_info"`) rely on these envs being set consistently on both sides:

- The droplet service’s systemd unit must have `APP_BASE_URL` (or an equivalent) and the webhook secret envs.
- The Vercel app must be configured to recognize the same shared secret when gating `/api/admin/smt/meter-info`.

> **Current production snapshot (2025-11-21)**  
> - `SMT_USERNAME` / `SMT_REQUESTOR_ID` = `INTELLIPATH` (SMT API Service ID)  
> - `SMT_SERVICE_ID` = `INTELLIPATH`  
> - `SMT_REQUESTOR_AUTH_ID` = `134642921` (Intellipath Solutions LLC DUNS on SMT)  
> - `SMT_API_BASE_URL` = `https://services.smartmetertexas.net`

### Service ID and Requestor Identity (INTELLIPATH)

- `SMT_USERNAME` = `INTELLIPATH`
- `SMT_SERVICE_ID` = `INTELLIPATH`
- `SMT_REQUESTOR_ID` = `INTELLIPATH`
- `SMT_REQUESTOR_AUTH_ID` = `134642921` (Intellipath Solutions LLC DUNS on SMT)

> The SMT `/v2/token/` username **must** match the `requestorID` value in every SMT payload (meterInfo, NewAgreement, NewSubscription, etc.). For `INTELLIPATH`, SMT currently delivers `/v2/meterInfo/` responses via SFTP CSV; `deliveryMode: "API"` returns errorCode `2076` (“API Integration is not done.”).

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
SMT_USERNAME="INTELLIPATH"           # SMT API Service ID (username + serviceId + requestorID)
SMT_PASSWORD="********"              # SMT API Service ID password
SMT_REQUESTOR_AUTH_ID="134642921"    # IntelliPath DUNS / SMT authentication ID
SMT_PROXY_TOKEN="ChangeThisToAStrongSharedSecret_1763428355"  # example only
SMT_PROXY_PORT="4101"
```

In production, `SMT_USERNAME` is the SMT API Service ID (**INTELLIPATH**), and the same value is used as `SMT_REQUESTOR_ID` in SMT payloads.

### Droplet webhook + meterInfo queue

- `DROPLET_WEBHOOK_URL` – Base URL of the SMT droplet webhook server (e.g., `http://64.225.25.54:8787/trigger/smt-now`).
- `INTELLIWATT_WEBHOOK_SECRET` / `DROPLET_WEBHOOK_SECRET` – Shared secret sent from Vercel to the droplet in webhook requests (`x-droplet-webhook-secret` / `x-intelliwatt-secret`).
- `SMT_METERINFO_ENABLED` – Enables the automatic queue that calls the droplet for `/v2/meterInfo/` after an address is matched to an ESIID.

> SMT REST calls remain droplet-only. Vercel never calls SMT `/v2/*` directly; it only queues work through the droplet webhook.

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

> **Current production snapshot (2025-11-21)**  
> - `SMT_HOST=ftp.smartmetertexas.biz`  
> - `SMT_USER=intellipathsolutionsftp`  
> - `SMT_KEY=/home/deploy/.ssh/intelliwatt_smt_rsa4096`  
> - `SMT_REMOTE_DIR=/adhocusage`  
> - `SMT_LOCAL_DIR=/home/deploy/smt_inbox`

## Deprecated / Legacy

- `SMT_JWT_CLIENT_ID`, `SMT_JWT_CLIENT_SECRET` – **Deprecated.** The project no longer reads these values. Remove them after confirming no other services depend on them.

## Notes

- Always pass `x-admin-token` when invoking admin endpoints.  
- Inline `/api/admin/smt/pull` persists uploaded files and normalizes them immediately.  
- Replace any legacy `x-proxy-secret` usage with `x-intelliwatt-secret`.
