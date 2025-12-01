import os
import json
import subprocess
import logging
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, List, Optional

import requests


# SMT debug logging helpers
# NOTE: This file is deployed to /home/deploy/webhook_server.py by systemd.
def _smt_snip(text: Optional[str], limit: int = 1000) -> str:
    if not isinstance(text, str):
        return ""
    if len(text) <= limit:
        return text
    return text[:limit] + "...[truncated]"


def _log_smt_request(step_name: str, url: str, headers: Dict[str, Any], payload: Any) -> None:
    try:
        safe_headers = {}
        if isinstance(headers, dict):
            for key, value in headers.items():
                lower = key.lower()
                if lower in ("authorization", "proxy-authorization", "password"):
                    continue
                safe_headers[key] = value
        body_repr: str
        if isinstance(payload, (dict, list)):
            body_repr = json.dumps(payload, separators=(",", ":"))
        else:
            body_repr = repr(payload)
        print(
            "[SMT_DEBUG] step=%s base_url=%s username=%s url=%s headers=%s body=%s"
            % (
                step_name,
                SMT_API_BASE_URL,
                SMT_USERNAME,
                url,
                safe_headers,
                _smt_snip(body_repr),
            ),
            flush=True,
        )
    except Exception as exc:
        print(
            f"[SMT_DEBUG] error_while_logging_request step={step_name} err={exc!r}",
            flush=True,
        )


def _log_smt_response(step_name: str, resp: requests.Response) -> None:
    try:
        status = getattr(resp, "status_code", None)
        text = getattr(resp, "text", None)
        print(
            f"[SMT_DEBUG] step={step_name} response_status={status} body={_smt_snip(text)}",
            flush=True,
        )
    except Exception as exc:
        print(
            f"[SMT_DEBUG] error_while_logging_response step={step_name} err={exc!r}",
            flush=True,
        )

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
SMT_USERNAME = os.getenv("SMT_USERNAME", "INTELLIPATH")
SMT_PASSWORD = os.getenv("SMT_PASSWORD")
SMT_PROXY_TOKEN = os.getenv("SMT_PROXY_TOKEN")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "").strip()
SMT_SERVICE_ID = os.getenv("SMT_SERVICE_ID", SMT_USERNAME)

APP_BASE_URL = (
    os.environ.get("APP_BASE_URL")
    or os.environ.get("INTELLIWATT_APP_BASE_URL")
    or os.environ.get("VERCEL_URL")
)
if APP_BASE_URL and not APP_BASE_URL.startswith("http"):
    APP_BASE_URL = f"https://{APP_BASE_URL}"

WEBHOOK_SECRET = (
    os.environ.get("DROPLET_WEBHOOK_SECRET")
    or os.environ.get("INTELLIWATT_WEBHOOK_SECRET")
    or ""
).strip()


def fetch_meter_info_from_app(esiid: str) -> Optional[Dict[str, Any]]:
    if not APP_BASE_URL:
        logging.warning("meter info fetch skipped; APP_BASE_URL not configured")
        return None

    params = {"esiid": esiid}
    headers: Dict[str, str] = {}
    if WEBHOOK_SECRET:
        headers["x-intelliwatt-secret"] = WEBHOOK_SECRET
    if ADMIN_TOKEN:
        headers["x-admin-token"] = ADMIN_TOKEN

    try:
        resp = requests.get(
            f"{APP_BASE_URL}/api/admin/smt/meter-info/latest",
            params=params,
            headers=headers,
            timeout=15,
        )
    except requests.RequestException as exc:
        logging.error("failed to fetch meter info from app: %s", exc)
        return None

    if resp.status_code != 200:
        logging.warning(
            "meter info fetch returned status=%s body=%s",
            resp.status_code,
            resp.text[:300],
        )
        return None

    try:
        payload = resp.json()
    except ValueError as exc:
        logging.error("meter info fetch JSON parse error: %s", exc)
        return None

    meter_info = payload.get("meterInfo")
    if not meter_info:
        logging.info("meter info fetch ok but no record found for esiid=%s", esiid)
        return None

    return meter_info


def maybe_hydrate_meter_number(step: Dict[str, Any]) -> Optional[str]:
    body = step.get("body")
    if not isinstance(body, dict):
        return None

    meter_list = body.get("customerMeterList")
    if not isinstance(meter_list, list) or not meter_list:
        return None

    entry = meter_list[0]
    if not isinstance(entry, dict):
        return None

    esiid = entry.get("ESIID") or entry.get("esiid")
    meter_number = entry.get("meterNumber")
    if not esiid:
        return None

    normalized_meter = (meter_number or "").strip().upper()
    needs_lookup = (
        not normalized_meter
        or normalized_meter == esiid.strip().upper()
        or normalized_meter == "METER"
        or normalized_meter.endswith("-MTR")
    )

    if not needs_lookup:
        return meter_number

    meter_info = fetch_meter_info_from_app(esiid.strip())
    if not meter_info:
        return meter_number

    fetched_meter = (meter_info.get("meterNumber") or "").strip()
    if fetched_meter:
        entry["meterNumber"] = fetched_meter
        logging.info(
            "Updated NewAgreement meter number via meterInfo API: esiid=%s meter=%s",
            esiid,
            fetched_meter,
        )
        return fetched_meter

    return meter_number


def _strip_meter_numbers_from_body(body: Dict[str, Any]) -> None:
    """
    Remove any meter number fields so we can exercise the SMT agreement flow
    with ESIID-only payloads.
    """

    if not isinstance(body, dict):
        return

    customer_meter_list = body.get("customerMeterList")
    if isinstance(customer_meter_list, list):
        for entry in customer_meter_list:
            if isinstance(entry, dict):
                entry.pop("meterNumber", None)
                entry.pop("meter_number", None)
                entry.pop("meterSerialNumber", None)
                entry.pop("utilityMeterId", None)

    # Recurse into nested dictionaries in case the structure changes in future payloads.
    for value in body.values():
        if isinstance(value, dict):
            _strip_meter_numbers_from_body(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    _strip_meter_numbers_from_body(item)


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


def handle_smt_meter_info(payload: dict) -> bytes:
    """
    Handle Vercel webhook asking the droplet to fetch SMT meter info.
    """

    esiid = str(payload.get("esiid", "")).strip()
    house_id = payload.get("houseId")
    ts = payload.get("ts")

    log_parts = [
        "[INFO] SMT meterInfo webhook received",
        f"esiid={esiid!r}",
        f"houseId={house_id!r}",
        f"ts={ts!r}",
    ]
    log_line = " ".join(log_parts)
    print(log_line, flush=True)

    if not esiid:
        warn = "[WARN] smt_meter_info payload missing ESIID; skipping"
        print(warn, flush=True)
        return (log_line + "\n" + warn + "\n").encode()

    repo_root = "/home/deploy/apps/intelliwatt"
    cmd = ["node", "scripts/test_smt_meter_info.mjs", "--esiid", esiid, "--json"]

    try:
        proc = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
            cwd=repo_root,
            timeout=300,
        )
    except Exception as exc:
        err = f"[ERROR] smt_meter_info failed to spawn Node script: {exc!r}"
        print(err, flush=True)
        _post_meter_info_error(
            esiid,
            house_id,
            f"Node script spawn failed: {exc}",
            stdout=None,
            stderr=None,
        )
        return (log_line + "\n" + err + "\n").encode()

    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()

    if proc.returncode != 0:
        err = (
            "[ERROR] smt_meter_info Node script exited non-zero "
            f"code={proc.returncode} stdout_len={len(stdout)} stderr_len={len(stderr)}"
        )
        print(err, flush=True)
        _post_meter_info_error(
            esiid,
            house_id,
            f"Node script non-zero exit: {proc.returncode}",
            stdout=stdout,
            stderr=stderr,
        )
        return (log_line + "\n" + err + "\n").encode()

    meter_json = None
    if stdout:
        try:
            meter_json = json.loads(stdout)
        except Exception as exc:
            print(
                f"[WARN] smt_meter_info failed to parse JSON stdout: {exc!r}",
                flush=True,
            )

    meter_data = None
    trans_id = None
    meter_number = None
    if isinstance(meter_json, dict):
        trans_id = meter_json.get("trans_id")
        meter_data = meter_json.get("MeterData") or meter_json.get("meterData")
        if isinstance(meter_data, dict):
            meter_number = (
                meter_data.get("utilityMeterId")
                or meter_data.get("meterSerialNumber")
                or meter_data.get("meterNumber")
            )

    payload_for_app: Dict[str, Any] = {
        "esiid": esiid,
        "houseId": house_id,
        "meterNumber": meter_number,
        "rawPayload": meter_json if meter_json is not None else {"stdout": stdout},
        "status": "complete" if meter_number or meter_data else "pending",
    }
    if meter_data:
        payload_for_app["meterData"] = meter_data
    if trans_id:
        payload_for_app["transId"] = trans_id
    if stderr:
        if isinstance(payload_for_app["rawPayload"], dict):
            payload_for_app["rawPayload"]["_stderr"] = stderr

    response_summary = "[WARN] smt_meter_info missing APP_BASE_URL or WEBHOOK_SECRET; payload not sent"
    if APP_BASE_URL and WEBHOOK_SECRET:
        try:
            resp = requests.post(
                f"{APP_BASE_URL}/api/admin/smt/meter-info",
                headers={
                    "content-type": "application/json",
                    "x-intelliwatt-secret": WEBHOOK_SECRET,
                },
                json=payload_for_app,
                timeout=30,
            )
            response_summary = (
                "[INFO] smt_meter_info posted meter info to app "
                f"status={resp.status_code} len={len(getattr(resp, 'text', '') or '')}"
            )
        except Exception as exc:
            response_summary = (
                f"[ERROR] smt_meter_info POST to app failed: {exc!r}"
            )
    else:
        print(
            "[WARN] smt_meter_info cannot POST back to app; APP_BASE_URL or WEBHOOK_SECRET missing",
            flush=True,
        )

    print(response_summary, flush=True)
    return (log_line + "\n" + response_summary + "\n").encode()


def _post_meter_info_error(
    esiid: str,
    house_id: Optional[str],
    error_message: str,
    stdout: Optional[str],
    stderr: Optional[str],
) -> None:
    if not APP_BASE_URL or not WEBHOOK_SECRET:
        print(
            "[WARN] smt_meter_info error callback skipped; APP_BASE_URL or WEBHOOK_SECRET missing",
            flush=True,
        )
        return

    payload: Dict[str, Any] = {
        "esiid": esiid,
        "houseId": house_id,
        "status": "error",
        "errorMessage": error_message,
    }
    raw_payload: Dict[str, Any] = {}
    if stdout:
        raw_payload["stdout"] = stdout
    if stderr:
        raw_payload["stderr"] = stderr
    if raw_payload:
        payload["rawPayload"] = raw_payload

    try:
        resp = requests.post(
            f"{APP_BASE_URL}/api/admin/smt/meter-info",
            headers={
                "content-type": "application/json",
                "x-intelliwatt-secret": WEBHOOK_SECRET,
            },
            json=payload,
            timeout=15,
        )
        print(
            "[INFO] smt_meter_info error callback status=%s"
            % getattr(resp, "status_code", None),
            flush=True,
        )
    except Exception as exc:
        print(
            f"[ERROR] smt_meter_info error callback POST failed: {exc!r}",
            flush=True,
        )


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

    payload = body
    step_name: Optional[str] = None
    if "NewAgreement" in url:
        step_name = "NewAgreement"
    elif "NewSubscription" in url:
        step_name = "NewSubscription"

    if step_name in {"NewAgreement", "NewSubscription"}:
        # SMT expects username/serviceId headers to match payload identity.
        # Force-set them so we never rely on upstream defaults.
        headers["username"] = SMT_USERNAME
        headers["serviceId"] = SMT_SERVICE_ID

    if step_name:
        try:
            _log_smt_request(step_name, url, headers, payload)
        except Exception as exc:
            print(
                f"[SMT_DEBUG] log_error step={step_name} err={exc!r}",
                flush=True,
            )

    try:
        if "NewAgreement" in url:
            print(
                "[SMT_DEBUG] NewAgreement username=%r serviceId=%r body=%s"
                % (
                    headers.get("username"),
                    headers.get("serviceId"),
                    json.dumps(payload, separators=(",", ":")),
                ),
                flush=True,
            )
        elif "NewSubscription" in url:
            print(
                "[SMT_DEBUG] NewSubscription username=%r serviceId=%r body=%s"
                % (
                    headers.get("username"),
                    headers.get("serviceId"),
                    json.dumps(payload, separators=(",", ":")),
                ),
                flush=True,
            )
        resp = requests.post(url, json=body, headers=headers, timeout=60)
    except requests.RequestException as exc:
        raise Exception(f"SMT POST to {url} failed: {exc}") from exc

    if step_name:
        _log_smt_response(step_name, resp)

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


def _normalize_subscription_response(status: int, payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "ok": False,
        "status": "failed",
        "httpStatus": status,
        "body": payload,
        "reason": None,
    }

    if 200 <= status < 300:
        result["ok"] = True
        result["status"] = "created"
        return result

    reason_message = None
    fault_list = []
    if isinstance(payload, dict):
        fault_list = payload.get("CustomerDUNSFaultList") or []
        reason_message = payload.get("statusReason")

    if status == 400 and isinstance(fault_list, list):
        for item in fault_list:
            reason_code = ""
            if isinstance(item, dict):
                reason_code = str(item.get("reasonCode") or "")
            if "Subcription is already active" in reason_code:
                result["ok"] = True
                result["status"] = "already_active"
                result["reason"] = "Subscription already active for this DUNS"
                return result

    if reason_message:
        result["reason"] = reason_message
    else:
        result["reason"] = f"HTTP {status}"

    return result


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
        self._handle_agreements_common(
            remove_meter=False,
            log_prefix="/agreements",
        )

    def _handle_agreements_no_meter(self) -> None:
        self._handle_agreements_common(
            remove_meter=True,
            log_prefix="/agreements-no-meter",
        )

    def _handle_agreements_common(self, *, remove_meter: bool, log_prefix: str) -> None:
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

        rep_puct_number_default = 10052
        rep_puct_number_raw = payload.get("repPuctNumber") or payload.get("rep_puct_number")
        rep_puct_number = rep_puct_number_default
        if rep_puct_number_raw is not None:
            try:
                rep_puct_number = int(str(rep_puct_number_raw).strip())
            except Exception:
                rep_puct_number = rep_puct_number_default
        print(
            f"[SMT_DEBUG] /agreements using PUCTRORNumber={rep_puct_number}",
            flush=True,
        )

        action = payload.get("action")
        if action is None:
            action = "create_agreement_and_subscription"
        if action != "create_agreement_and_subscription":
            self._write_json(
                400, {"ok": False, "error": "unsupported_action", "action": action}
            )
            return

        steps: List[Dict[str, Any]] = []
        raw_steps = payload.get("steps")
        if isinstance(raw_steps, list) and raw_steps:
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

        if not steps:
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
            validated_steps.append({"name": name or path, "path": path, "body": body})

        hydrated_meter_number: Optional[str] = None
        for step in validated_steps:
            step_name = step.get("name")
            if not isinstance(step_name, str):
                continue
            body = step.get("body")
            if remove_meter and isinstance(body, dict):
                _strip_meter_numbers_from_body(body)
            if step_name.lower() == "newagreement":
                if not remove_meter:
                    hydrated_meter_number = maybe_hydrate_meter_number(step)
                # Override PUCT ROR number in agreement body
                if isinstance(body, dict):
                    meter_list = body.get("customerMeterList")
                    if isinstance(meter_list, list) and meter_list:
                        entry = meter_list[0]
                        if isinstance(entry, dict):
                            entry["PUCTRORNumber"] = rep_puct_number
                break

        if hydrated_meter_number and not remove_meter:
            logging.info("Final meter number for agreement: %s", hydrated_meter_number)

        action_for_log = (
            "create_agreement_and_subscription_no_meter"
            if remove_meter
            else action
        )

        print(
            f"[SMT_PROXY] {log_prefix} action={action_for_log} steps={len(validated_steps)}",
            flush=True,
        )

        agreement_result: Optional[Dict[str, Any]] = None
        subscription_result: Optional[Dict[str, Any]] = None
        response_steps: List[Dict[str, Any]] = []

        for step in validated_steps:
            try:
                smt_response = smt_post(step["path"], step["body"])
            except Exception as exc:
                self._write_json(
                    502,
                    {
                        "ok": False,
                        "action": action,
                        "error": str(exc),
                        "partialResults": response_steps,
                    },
                )
                return

            entry = {
                "name": step["name"],
                "path": step["path"],
                "httpStatus": smt_response.get("status"),
                "url": smt_response.get("url"),
                "body": smt_response.get("data"),
            }
            response_steps.append(entry)

            step_name = (step.get("name") or "").lower()
            status_code = smt_response.get("status")
            data = smt_response.get("data")

            if step_name == "newagreement":
                if not (isinstance(status_code, int) and 200 <= status_code < 300):
                    self._write_json(
                        502,
                        {
                            "ok": False,
                            "action": action,
                            "error": "agreement_failed",
                            "detail": "SMT NewAgreement failed",
                            "partialResults": response_steps,
                        },
                    )
                    return
                agreement_result = {
                    "httpStatus": status_code,
                    "body": data,
                }
            elif step_name == "newsubscription":
                normalized = _normalize_subscription_response(status_code, data)
                subscription_result = normalized

                if normalized["ok"]:
                    if normalized["status"] == "already_active":
                        duns = None
                        fault_list = []
                        if isinstance(data, dict):
                            fault_list = data.get("CustomerDUNSFaultList") or []
                        for item in fault_list:
                            if isinstance(item, dict):
                                candidate = item.get("duns") or item.get("DUNS")
                                if candidate:
                                    duns = candidate
                                    break
                        print(
                            f"[SMT_PROXY] SMT subscription already active for DUNS={duns} status={status_code}",
                            flush=True,
                        )
                    else:
                        print(
                            f"[SMT_PROXY] SMT subscription created status={status_code}",
                            flush=True,
                        )
                else:
                    self._write_json(
                        502,
                        {
                            "ok": False,
                            "action": action,
                            "error": "subscription_failed",
                            "detail": normalized.get("reason"),
                            "partialResults": response_steps,
                        },
                    )
                    return

        response_payload: Dict[str, Any] = {
            "ok": True,
            "action": action,
            "results": response_steps,
        }

        if agreement_result is not None:
            response_payload["agreement"] = agreement_result
        if subscription_result is not None:
            response_payload["subscription"] = subscription_result

        if isinstance(payload.get("meta"), dict):
            response_payload["meta"] = payload["meta"]

        self._write_json(200, response_payload)

    def do_POST(self):
        if self.path == "/agreements":
            self._handle_agreements()
            return

        if self.path == "/agreements-no-meter":
            self._handle_agreements_no_meter()
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

        try:
            logging.info(
                "webhook auth: headers=%s secrets_loaded=%d",
                {h: self.headers.get(h) for h in ACCEPT_HEADERS},
                len(SECRETS),
            )
        except Exception:
            logging.exception("webhook auth: failed to log headers")

        if not got:
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok": false, "error": "unauthorized"}')
            return

        if not SECRETS:
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok": false, "error": "unauthorized"}')
            return

        # Header present and secrets configured; treat as authorized for now.

        body_bytes = self._read_body_bytes()
        payload = None
        if body_bytes:
            try:
                payload = json.loads(body_bytes.decode("utf-8"))
            except Exception as e:
                print(f"[WARN] Failed to parse JSON body in webhook: {e!r}", flush=True)

        try:
            resp_body = run_default_command()
            if isinstance(payload, dict):
                reason = payload.get("reason")
                if reason == "smt_authorized":
                    resp_body = handle_smt_authorized(payload)
                elif reason == "smt_meter_info":
                    resp_body = handle_smt_meter_info(payload)

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
