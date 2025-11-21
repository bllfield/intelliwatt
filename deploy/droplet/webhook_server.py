import os
import json
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, List, Optional

import requests

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

SMT_API_BASE_URL = (
    os.getenv("SMT_API_BASE_URL", "https://services.smartmetertexas.net").rstrip("/")
    or "https://services.smartmetertexas.net"
)
SMT_USERNAME = os.getenv("SMT_USERNAME", "INTELLIWATTAPI")
SMT_PASSWORD = os.getenv("SMT_PASSWORD")
SMT_PROXY_TOKEN = os.getenv("SMT_PROXY_TOKEN")


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


def get_smt_access_token() -> str:
    if not SMT_PASSWORD:
        raise Exception("SMT_PASSWORD is not configured")

    token_url = f"{SMT_API_BASE_URL}/v2/token/"
    try:
        resp = requests.post(
            token_url,
            json={"username": SMT_USERNAME, "password": SMT_PASSWORD},
            timeout=30,
        )
    except requests.RequestException as exc:
        raise Exception(f"Failed to contact SMT token endpoint: {exc}") from exc

    if resp.status_code != 200:
        raise Exception(f"SMT token endpoint returned HTTP {resp.status_code}")

    try:
        data = resp.json()
    except ValueError as exc:
        raise Exception("SMT token endpoint returned non-JSON response") from exc

    token = data.get("accessToken")
    if not token or not isinstance(token, str):
        raise Exception("SMT token response missing accessToken")

    return token


def smt_post(path_or_url: str, body: Dict[str, Any]) -> Dict[str, Any]:
    token = get_smt_access_token()

    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        url = path_or_url
    else:
        url = f"{SMT_API_BASE_URL}{path_or_url}"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    try:
        resp = requests.post(url, json=body, headers=headers, timeout=60)
    except requests.RequestException as exc:
        raise Exception(f"SMT POST to {url} failed: {exc}") from exc

    print(f"[SMT_PROXY] POST {url} status={resp.status_code}", flush=True)
    try:
        snippet = resp.text.replace("\n", " ")[:200]
    except Exception:
        snippet = "<non-text-body>"
    print(f"[SMT_PROXY] SMT body_snip={snippet}", flush=True)

    try:
        data = resp.json()
    except ValueError:
        data = {"rawText": resp.text[:4096]}

    return {
        "status": resp.status_code,
        "url": url,
        "data": data,
    }


class H(BaseHTTPRequestHandler):
    def _read_body_bytes(self) -> bytes:
        length_str = self.headers.get("Content-Length")
        if not length_str:
            return b""
        try:
            length = int(length_str)
        except ValueError:
            return b""
        if length <= 0:
            return b""
        return self.rfile.read(length)

    def _write_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_agreements(self) -> None:
        if not SMT_PROXY_TOKEN:
            self._write_json(
                500,
                {"ok": False, "error": "smt_proxy_token_not_configured"},
            )
            return

        auth_header = self.headers.get("Authorization") or ""
        if not auth_header.startswith("Bearer "):
            self._write_json(401, {"ok": False, "error": "unauthorized"})
            return
        incoming_token = auth_header.split(" ", 1)[1].strip()
        if incoming_token != SMT_PROXY_TOKEN:
            self._write_json(401, {"ok": False, "error": "unauthorized"})
            return

        body_bytes = self._read_body_bytes()
        if not body_bytes:
            self._write_json(400, {"ok": False, "error": "invalid_json"})
            return
        try:
            payload = json.loads(body_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._write_json(400, {"ok": False, "error": "invalid_json"})
            return

        if not isinstance(payload, dict):
            self._write_json(400, {"ok": False, "error": "invalid_json"})
            return

        action = payload.get("action")
        if action != "create_agreement_and_subscription":
            self._write_json(
                400, {"ok": False, "error": "unsupported_action", "action": action}
            )
            return

        steps: Optional[List[Dict[str, Any]]] = None
        raw_steps = payload.get("steps")
        if isinstance(raw_steps, list) and raw_steps:
            steps = []
            for idx, step in enumerate(raw_steps):
                if not isinstance(step, dict):
                    self._write_json(
                        400,
                        {
                            "ok": False,
                            "error": "invalid_step",
                            "detail": f"steps[{idx}] must be an object",
                        },
                    )
                    return
                steps.append(step)
        else:
            steps = []
            agreement = payload.get("agreement")
            subscription = payload.get("subscription")
            if isinstance(agreement, dict):
                steps.append(
                    {
                        "name": agreement.get("name") or "NewAgreement",
                        "path": agreement.get("path") or "/v2/NewAgreement/",
                        "body": agreement.get("body") or {},
                    }
                )
            if isinstance(subscription, dict):
                steps.append(
                    {
                        "name": subscription.get("name") or "NewSubscription",
                        "path": subscription.get("path") or "/v2/NewSubscription/",
                        "body": subscription.get("body") or {},
                    }
                )

        if not steps or not isinstance(steps, list):
            self._write_json(400, {"ok": False, "error": "missing_steps"})
            return

        validated_steps: List[Dict[str, Any]] = []
        for idx, step in enumerate(steps):
            name = step.get("name")
            path = step.get("path")
            body = step.get("body")
            if not isinstance(path, str) or not path.strip():
                self._write_json(
                    400,
                    {
                        "ok": False,
                        "error": "invalid_step",
                        "detail": f"steps[{idx}].path is required",
                    },
                )
                return
            if not isinstance(body, dict):
                self._write_json(
                    400,
                    {
                        "ok": False,
                        "error": "invalid_step",
                        "detail": f"steps[{idx}].body must be an object",
                    },
                )
                return
            validated_steps.append(
                {"name": name or path, "path": path, "body": body}
            )

        print(
            f"[SMT_PROXY] /agreements action={action} steps={len(validated_steps)}",
            flush=True,
        )

        results: List[Dict[str, Any]] = []
        for step in validated_steps:
            try:
                res = smt_post(step["path"], step["body"])
            except Exception as exc:
                self._write_json(
                    502,
                    {
                        "ok": False,
                        "action": action,
                        "error": str(exc),
                        "partialResults": results,
                    },
                )
                return

            step_result = {
                "name": step["name"],
                "path": step["path"],
                "status": res.get("status"),
                "url": res.get("url"),
                "data": res.get("data"),
            }
            results.append(step_result)

        response_payload = {
            "ok": True,
            "action": action,
            "results": results,
        }
        if isinstance(payload.get("meta"), dict):
            response_payload["meta"] = payload["meta"]
        self._write_json(200, response_payload)

    def do_POST(self):
        if self.path == "/agreements":
            self._handle_agreements()
            return

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

        body_bytes = self._read_body_bytes()
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
