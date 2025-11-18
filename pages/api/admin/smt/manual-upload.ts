import type { NextApiRequest, NextApiResponse } from "next";
import { formidable, File as FormidableFile, Fields, Files } from "formidable";
import { promises as fs } from "fs";
import { uploadSmtManualBuffer } from "@/lib/admin/smtManualUpload";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "64mb",
  },
};

type ParsedPayload = {
  fields: Fields;
  file?: FormidableFile;
};

async function parseForm(req: NextApiRequest): Promise<ParsedPayload> {
  const form = formidable({
    multiples: false,
    maxFileSize: 64 * 1024 * 1024, // 64 MB
    keepExtensions: true,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err: any, fields: Fields, files: Files) => {
      if (err) {
        reject(err);
        return;
      }
      const file = Array.isArray(files.file) ? files.file[0] : (files.file as FormidableFile | undefined);
      resolve({ fields, file });
    });
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "Method Not Allowed" });
    return;
  }

  let parsed: ParsedPayload;
  try {
    parsed = await parseForm(req);
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message || "Failed to parse upload." });
    return;
  }

  if (!parsed.file?.filepath) {
    res.status(400).json({ ok: false, error: "No file uploaded." });
    return;
  }

  const { fields, file } = parsed;
  const esiid = typeof fields.esiid === "string" ? fields.esiid.trim() || undefined : undefined;
  const meter = typeof fields.meter === "string" ? fields.meter.trim() || undefined : undefined;

  try {
    const buffer = await fs.readFile(file.filepath);
    const result = await uploadSmtManualBuffer({
      buffer,
      filename: file.originalFilename || file.newFilename || "manual.csv",
      mime: file.mimetype || "text/csv",
      esiid,
      meter,
    });
    if (result.ok) {
      res.status(200).json({ ok: true, message: result.message, pull: result.pull, normalize: result.normalize });
    } else {
      res.status(500).json({ ok: false, error: result.error, pull: result.pull, normalize: result.normalize });
    }
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || "Upload failed." });
  } finally {
    try {
      await fs.unlink(file.filepath);
    } catch {
      // ignore cleanup errors
    }
  }
}

