import os
import json
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

# Shared secrets from env
SECRET_A = os.environ.get("INTELLIWATT_WEBHOOK_SECRET", "").strip()
SECRET_B = os.environ.get("DROPLET_WEBHOOK_SECRET", "").strip()
SECRETS = {s for s in (SECRET_A, SECRET_B) if s}

# Headers we accept for the shared secret
# Note: x-intelliwatt-secret is the canonical header; others are legacy aliases.
ACCEPT_HEADERS = (
    "x-intelliwatt-secret",
    "x-proxy-secret",
    "x-droplet-webhook-secret",
)


def run_default_command() -> bytes:
    """
    Default behavior for generic "smt-now" triggers.
    Preserves the old behavior so existing callers still work.
    """
    cmd = (
        'printf "[INFO] Generic SMT trigger at $(date +%Y%m%d_%H%M%S)\\n'
        '[INFO] No JSON reason provided; running default path.\\n"'
    )
    p = subprocess.run(
        ["/bin/bash", "-lc", cmd],
        capture_output=True,
        text=True,
    )
    if p.returncode != 0:
        return f"[ERROR] default trigger failed: {p.stderr}\n".encode()
    return (p.stdout or "ok\n").encode()


def handle_smt_authorized(payload: dict) -> bytes:
    """
    Handle customer-facing SMT authorization notifications.

    This both:
    - Logs the key SMT auth fields for observability.
    - Kicks off an on-demand SMT ingest by calling the existing
      deploy/smt/fetch_and_post.sh script with ESIID_DEFAULT set.
    """

    reason = payload.get("reason")
    smt_auth_id = payload.get("smtAuthorizationId")
    user_id = payload.get("userId")
    house_id = payload.get("houseId")
    house_address_id = payload.get("houseAddressId")
    esiid = payload.get("esiid")
    tdsp_code = payload.get("tdspCode")
    tdsp_name = payload.get("tdspName")
    months_back = payload.get("monthsBack")
    include_interval = payload.get("includeInterval")
    include_billing = payload.get("includeBilling")
    auth_start = payload.get("authorizationStartDate")
    auth_end = payload.get("authorizationEndDate")

    log_line = (
        "[INFO] SMT authorization webhook received: "
        f"reason={reason!r} "
        f"smtAuthorizationId={smt_auth_id!r} "
        f"userId={user_id!r} houseId={house_id!r} houseAddressId={house_address_id!r} "
        f"esiid={esiid!r} tdspCode={tdsp_code!r} tdspName={tdsp_name!r} "
        f"monthsBack={months_back!r} "
        f"includeInterval={include_interval!r} includeBilling={include_billing!r} "
        f"window={auth_start!r}->{auth_end!r}"
    )

    print(log_line, flush=True)

    # If we don't have an ESIID, we can't do much more than log.
    if not esiid:
        warn = "[WARN] SMT authorization payload missing ESIID; skipping ingest."
        print(warn, flush=True)
        return (log_line + "\n" + warn + "\n").encode()

    # Use the existing ingest pipeline:
    #   SMT SFTP → /home/deploy/smt_inbox → deploy/smt/fetch_and_post.sh (inline POST)
    # We set ESIID_DEFAULT for this run so the script knows which meter to focus on.
    ingest_cmd = (
        "cd /home/deploy/apps/intelliwatt && "
        f"ESIID_DEFAULT={esiid} deploy/smt/fetch_and_post.sh"
    )

    print(f"[INFO] Starting SMT ingest via: {ingest_cmd}", flush=True)

    p = subprocess.run(
        ["/bin/bash", "-lc", ingest_cmd],
        capture_output=True,
        text=True,
    )

    status_line = (
        f"[INFO] SMT ingest finished for ESIID={esiid!r} "
        f"rc={p.returncode} "
        f"stdout_len={len(p.stdout or '')} stderr_len={len(p.stderr or '')}"
    )
    print(status_line, flush=True)

    body_parts = [log_line, status_line]

    if p.stdout:
        # Trim very long output to avoid huge responses
        trimmed_out = p.stdout.strip()
        if len(trimmed_out) > 2000:
            trimmed_out = trimmed_out[:2000] + "\n...[truncated]..."
        body_parts.append("--- stdout ---")
        body_parts.append(trimmed_out)

    if p.stderr:
        trimmed_err = p.stderr.strip()
        if len(trimmed_err) > 2000:
            trimmed_err = trimmed_err[:2000] + "\n...[truncated]..."
        body_parts.append("--- stderr ---")
        body_parts.append(trimmed_err)

    body = "\n".join(body_parts) + "\n"
    return body.encode()


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        # Only one endpoint is supported for now
        if self.path != "/trigger/smt-now":
            self.send_response(404)
            self.end_headers()
            return

        # Shared-secret auth
        got = None
        for header_name in ACCEPT_HEADERS:
            value = self.headers.get(header_name)
            if value:
                got = value.strip()
                break

        if not got or not SECRETS or got not in SECRETS:
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b"unauthorized")
            return

        # Read body (if any)
        length = 0
        length_str = self.headers.get("Content-Length")
        if length_str:
            try:
                length = int(length_str)
            except ValueError:
                length = 0

        body_bytes = b""
        if length > 0:
            body_bytes = self.rfile.read(length)

        payload = None
        if body_bytes:
            try:
                payload = json.loads(body_bytes.decode("utf-8"))
            except Exception as e:
                print(f"[WARN] Failed to parse JSON body in webhook: {e!r}", flush=True)

        try:
            if isinstance(payload, dict) and payload.get("reason") == "smt_authorized":
                resp_body = handle_smt_authorized(payload)
            else:
                resp_body = run_default_command()

            self.send_response(200)
            self.end_headers()
            self.wfile.write(resp_body or b"ok")
        except Exception as e:
            msg = f"webhook error: {e!r}"
            print("[ERROR]", msg, flush=True)
            self.send_response(500)
            self.end_headers()
            self.wfile.write(msg.encode())


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8787"))
    srv = HTTPServer(("0.0.0.0", port), H)
    print(
        f"listening on :{port}, headers={ACCEPT_HEADERS}, secrets_loaded={len(SECRETS)}",
        flush=True,
    )
    srv.serve_forever()
