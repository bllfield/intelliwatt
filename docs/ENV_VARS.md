# IntelliWatt Environment Variables

## Google & Mapping
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — client key for Places/Maps autocomplete
- `GOOGLE_APPLICATION_CREDENTIALS` — filesystem path to JSON key (only if using backend Google SDKs like Vision/Sheets)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — service account email (backend only)

## Integrations
- `WATTBUY_API_KEY` — server key for WattBuy
- `SMT_SFTP_HOST`, `SMT_SFTP_USER`, `SMT_SFTP_KEY` — Smart Meter Texas SFTP
- `GREENBUTTON_API_KEY` — (future) Green Button API access

## Feature Flags
- `NEXT_PUBLIC_FLAG_WATTBUY` = true | false
- `NEXT_PUBLIC_FLAG_SMT` = true | false
- `NEXT_PUBLIC_FLAG_GREENBUTTON` = true | false
- `FLAG_STRICT_PII_LOGGING` = true | false  # server-only

### Notes
- **Public flags** must start with `NEXT_PUBLIC_` (exposed to the browser).
- **Server-only** vars must **not** use `NEXT_PUBLIC_`.
- Rotate keys immediately if credentials appear from unknown projects; restrict Google browser key by referrer.
