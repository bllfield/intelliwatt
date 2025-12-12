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
    def _write_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
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

    def do_POST(self) -> None:  # type: ignore[override]
        if self.path != "/efl/pdftotext":
            self.send_response(404)
            self.end_headers()
            return

        # Simple Bearer token auth so only the app can call this.
        auth_header = self.headers.get("Authorization") or ""
        if EFL_PDFTEXT_TOKEN:
            prefix = "Bearer "
            if not auth_header.startswith(prefix):
                self._write_json(401, {"ok": False, "error": "unauthorized"})
                return
            incoming = auth_header[len(prefix) :].strip()
            if incoming != EFL_PDFTEXT_TOKEN:
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
    srv = HTTPServer(("0.0.0.0", EFL_PDFTEXT_PORT), Handler)
    print(
        f"[EFL_PDFTEXT] listening on :{EFL_PDFTEXT_PORT} (token_set={bool(EFL_PDFTEXT_TOKEN)})",
        flush=True,
    )
    srv.serve_forever()


if __name__ == "__main__":
    main()
