import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";

const app = express();

const PORT = Number(process.env.SMT_UPLOAD_PORT || 8080);
const INBOX = process.env.SMT_LOCAL_DIR || "/home/deploy/smt_inbox";
const SERVICE_NAME = process.env.SMT_INGEST_SERVICE_NAME || "smt-ingest.service";

if (!fs.existsSync(INBOX)) {
  fs.mkdirSync(INBOX, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, INBOX);
  },
  filename: (_req, file, cb) => {
    const base = path.basename(file.originalname || "upload.csv");
    cb(null, base);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: Number(process.env.SMT_UPLOAD_MAX_BYTES || 1024 * 1024 * 200), // default 200 MB
  },
});

app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: "No file uploaded" });
  }

  const filePath = path.join(INBOX, req.file.filename);
  const child = spawn("sudo", ["systemctl", "start", SERVICE_NAME]);

  child.on("exit", (code) => {
    if (code !== 0) {
      return res.status(500).json({
        ok: false,
        error: `Failed to start ${SERVICE_NAME} (exit code ${code})`,
        file: filePath,
      });
    }

    return res.json({
      ok: true,
      message: "File uploaded and ingest service triggered",
      file: filePath,
      service: SERVICE_NAME,
    });
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "smt-upload-server", inbox: INBOX });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`SMT upload server listening on port ${PORT}, inbox: ${INBOX}`);
});

