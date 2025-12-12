#!/usr/bin/env python3
import base64
import json
import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict


EFL_PDFTEXT_TOKEN = os.environ.get("EFL_PDFTEXT_TOKEN", "").strip()
EFL_PDFTEXT_PORT = int(os.environ.get("EFL_PDFTEXT_PORT", "8095"))


class Handler(BaseHTTPRequestHandler):
    def _log_request(self, status: int) -> None:
        length = self.headers.get("Content-Length") or ""

        # Accept either the newer X-EFL-PDFTEXT-TOKEN header or legacy Authorization: Bearer.
        token_header = self.headers.get("X-EFL-PDFTEXT-TOKEN") or self.headers.get(
            "Authorization"
        )
        token_present = bool(token_header)

        incoming = ""
        if token_header:
            incoming = token_header.strip()
            bearer_prefix = "Bearer "
            if incoming.startswith(bearer_prefix):
                incoming = incoming[len(bearer_prefix) :].strip()

        token_valid = bool(EFL_PDFTEXT_TOKEN) and incoming == EFL_PDFTEXT_TOKEN

        log_payload = {
            "service": "efl-pdftotext",
            "method": self.command,
            "path": self.path,
            "status": status,
            "content_length": length,
            "token_present": token_present,
            "token_valid": token_valid,
        }
        try:
            print(json.dumps(log_payload), flush=True)
        except Exception:
            # Never let logging failures break the handler.
            pass

    def _write_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self._log_request(status)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _write_plain(self, status: int, text: str) -> None:
        body = text.encode("utf-8")
        self._log_request(status)
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> bytes:
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

    def _is_token_valid(self) -> bool:
        """
        Return True if the incoming request includes a token that matches
        EFL_PDFTEXT_TOKEN. When the env var is empty, treat the request
        as authorized (no auth configured).
        """
        if not EFL_PDFTEXT_TOKEN:
            return True

        token_header = self.headers.get("X-EFL-PDFTEXT-TOKEN") or self.headers.get(
            "Authorization"
        )
        if not token_header:
            return False

        token_value = token_header.strip()
        bearer_prefix = "Bearer "
        if token_value.startswith(bearer_prefix):
            token_value = token_value[len(bearer_prefix) :].strip()

        return token_value == EFL_PDFTEXT_TOKEN

    def do_GET(self) -> None:  # type: ignore[override]
        if self.path == "/health":
            # Simple plain text health check for nginx/Vercel.
            self._write_plain(200, "ok")
            return

        self._log_request(404)
        self.send_response(404)
        self.end_headers()

    def do_POST(self) -> None:  # type: ignore[override]
        if self.path != "/efl/pdftotext":
            self._log_request(404)
            self.send_response(404)
            self.end_headers()
            return

        # Simple shared-secret auth: prefer X-EFL-PDFTEXT-TOKEN but also accept
        # Authorization: Bearer for backward compatibility.
        if not self._is_token_valid():
            self._write_json(401, {"ok": False, "error": "unauthorized"})
            return

        body_bytes = self._read_body()
        if not body_bytes:
            self._write_json(400, {"ok": False, "error": "missing_body"})
            return

        # Support two modes:
        # - application/pdf: body is raw PDF bytes
        # - application/json: legacy mode with { pdfBase64 }
        ctype = (self.headers.get("Content-Type") or "").lower()
        if "application/json" in ctype:
            try:
                payload = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                self._write_json(400, {"ok": False, "error": "invalid_json"})
                return

            if not isinstance(payload, dict):
                self._write_json(400, {"ok": False, "error": "invalid_json"})
                return

            pdf_b64 = payload.get("pdfBase64")
            if not isinstance(pdf_b64, str) or not pdf_b64:
                self._write_json(400, {"ok": False, "error": "missing_pdfBase64"})
                return

            try:
                pdf_bytes = base64.b64decode(pdf_b64, validate=True)
            except Exception as exc:
                self._write_json(
                    400,
                    {
                        "ok": False,
                        "error": f"invalid_base64: {exc}",
                    },
                )
                return
        else:
            pdf_bytes = body_bytes

        # Materialize to a temp file and run pdftotext -layout -enc UTF-8
        try:
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(pdf_bytes)
                tmp_path = tmp.name
        except Exception as exc:
            self._write_json(
                500,
                {
                    "ok": False,
                    "error": f"failed_to_write_tmp_pdf: {exc}",
                },
            )
            return

        try:
            proc = subprocess.run(
                [
                    "pdftotext",
                    "-layout",
                    "-enc",
                    "UTF-8",
                    tmp_path,
                    "-",
                ],
                capture_output=True,
                text=True,
                timeout=60,
            )
        except Exception as exc:
            self._write_json(
                500,
                {
                    "ok": False,
                    "error": f"pdftotext_spawn_failed: {exc}",
                },
            )
            return
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

        if proc.returncode != 0:
            self._write_json(
                500,
                {
                    "ok": False,
                    "error": "pdftotext_non_zero_exit",
                    "stderr": (proc.stderr or "")[:2000],
                },
            )
            return

        text = (proc.stdout or "").strip("\ufeff")  # strip BOM if present
        self._write_json(
            200,
            {
                "ok": True,
                "text": text,
            },
        )


def main() -> None:
    # Bind only to localhost; nginx terminates TLS and proxies to this helper.
    srv = HTTPServer(("127.0.0.1", EFL_PDFTEXT_PORT), Handler)
    print(
        f"[EFL_PDFTEXT] listening on 127.0.0.1:{EFL_PDFTEXT_PORT} (token_set={bool(EFL_PDFTEXT_TOKEN)})",
        flush=True,
    )
    srv.serve_forever()


if __name__ == "__main__":
    main()
