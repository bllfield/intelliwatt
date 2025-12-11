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
      console.error('[bill-text] PDF parse failed, falling back to UTF-8 decode', err);
    }

    return billBuffer.toString('utf8');
  }

  if (fileType === 'image') {
    if (!process.env.OPENAI_API_KEY) {
      // eslint-disable-next-line no-console
      console.error('[bill-text] Missing OPENAI_API_KEY; cannot OCR image bill');
      return '';
    }

    try {
      const { openai } = await import('@/lib/ai/openai');
      const base64 = billBuffer.toString('base64');
      const contentType =
        (anyUpload.mimeType as string | undefined) ??
        (anyUpload.contentType as string | undefined) ??
        'image/png';

      const dataUrl = `data:${contentType};base64,${base64}`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are an OCR engine. Extract ALL visible text from this electricity bill image and return it as plain text only.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extract the full readable text from this bill image.',
              } as any,
              {
                type: 'image_url',
                image_url: { url: dataUrl },
              } as any,
            ],
          },
        ],
        temperature: 0,
      });

      const text = completion.choices[0]?.message?.content ?? '';
      if (text && text.trim().length > 0) {
        return text;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[bill-text] OpenAI OCR for image bill failed', err);
    }

    // Fallback: at least attempt UTF-8 decode
    return billBuffer.toString('utf8');
  }

  if (fileType === 'text') {
    return billBuffer.toString('utf8');
  }

  // Catch-all: treat as UTF-8 text
  return billBuffer.toString('utf8');
}


