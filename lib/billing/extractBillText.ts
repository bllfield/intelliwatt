function guessFileType(upload: any): 'pdf' | 'image' | 'text' | 'unknown' {
  const anyUpload = upload as any;
  const ct = (anyUpload.mimeType as string | undefined) ?? (anyUpload.contentType as string | undefined);
  const name =
    (anyUpload.filename as string | undefined) ??
    (anyUpload.originalFilename as string | undefined) ??
    (anyUpload.fileName as string | undefined);

  const lowerCt = ct?.toLowerCase() ?? '';
  const lowerName = name?.toLowerCase() ?? '';

  if (lowerCt === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return 'pdf';
  }

  if (
    lowerCt.startsWith('image/') ||
    lowerName.endsWith('.jpg') ||
    lowerName.endsWith('.jpeg') ||
    lowerName.endsWith('.png')
  ) {
    return 'image';
  }

  if (lowerCt.startsWith('text/') || lowerName.endsWith('.txt') || lowerName.endsWith('.csv')) {
    return 'text';
  }

  return 'unknown';
}

export async function extractBillTextFromUpload(
  upload: any,
): Promise<string> {
  const fileType = guessFileType(upload);

  const anyUpload = upload as any;
  const billData = anyUpload.billData as Buffer | Uint8Array;
  const billBuffer =
    Buffer.isBuffer(billData) ? billData : Buffer.from(billData);

  // Treat unknowns as PDF by default since most real bills will be PDFs.
  if (fileType === 'pdf' || fileType === 'unknown') {
    // Prefer the same canonical PDF→text extraction pipeline used by the EFL system (pdftotext service + fallbacks).
    try {
      const { deterministicEflExtract } = await import('@/lib/efl/eflExtractor');
      const det = await deterministicEflExtract(billBuffer);
      const t = String(det?.rawText ?? '').trim();
      if (t) return t;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[bill-text] PDF→text extraction failed, falling back to pdf-parse/UTF-8 decode', err);
    }

    try {
      // Dynamic import to avoid pulling pdf-parse into client bundles.
      const pdfParseModule = await import('pdf-parse');
      const pdfParse = (pdfParseModule as any).default || (pdfParseModule as any);
      const result = await pdfParse(billBuffer);
      if (result?.text && typeof result.text === 'string' && result.text.trim().length > 0) {
        return result.text;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[bill-text] pdf-parse failed, falling back to UTF-8 decode', err);
    }

    return billBuffer.toString('utf8');
  }

  if (fileType === 'image') {
    // Safety net: image uploads should be rejected by /api/current-plan/upload.
    // If we ever reach this branch, do NOT call OpenAI Vision; just log and
    // return empty text so the caller can surface a clear error.
    // eslint-disable-next-line no-console
    console.error(
      '[bill-text] Image upload reached extractBillTextFromUpload; images are not supported for automatic text extraction.',
    );
    return '';
  }

  if (fileType === 'text') {
    return billBuffer.toString('utf8');
  }

  // Catch-all: treat as UTF-8 text
  return billBuffer.toString('utf8');
}


