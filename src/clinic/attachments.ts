import type { ClinicAssistantAttachment } from './types';

const maxExtractedTextLength = 20000;
const extractionTimeoutMs = 45000;

/**
 * `pdf-parse` and `tesseract.js` carry heavy native/WASM payloads — the former
 * reaches for `@napi-rs/canvas` and touches `DOMMatrix` while its own module
 * body evaluates. Where that binary is absent (serverless bundles above all),
 * the bare `import` threw before any caller could guard it, taking the whole
 * API down on boot rather than just the extraction.
 *
 * Loading on first use moves that failure inside the per-attachment try/catch
 * below, so a missing binary costs the extracted text and nothing more. Both
 * the module and its failure are memoised: one warning, one attempt.
 */
function loadOnce<T>(label: string, load: () => Promise<T>): () => Promise<T | null> {
  let pending: Promise<T | null> | undefined;

  return () => {
    pending ??= load().catch((error: unknown) => {
      console.warn(`${label} is unavailable; skipping attachment text extraction:`, error);
      return null;
    });

    return pending;
  };
}

const loadPdfParser = loadOnce('pdf-parse', async () => (await import('pdf-parse')).PDFParse);
const loadImageRecognizer = loadOnce('tesseract.js', async () => (await import('tesseract.js')).recognize);

function dataUrlToBuffer(dataUrl: string) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Buffer.from(base64, 'base64');
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), extractionTimeoutMs).unref?.();
    }),
  ]);
}

async function extractPdfText(dataUrl: string) {
  const PDFParse = await loadPdfParser();

  if (!PDFParse) {
    return '';
  }

  const parser = new PDFParse({ data: dataUrlToBuffer(dataUrl) });

  try {
    const result = await withTimeout(parser.getText(), 'PDF extraction');
    return result.text?.trim() || '';
  } finally {
    await parser.destroy?.().catch(() => undefined);
  }
}

async function extractImageText(dataUrl: string) {
  const recognize = await loadImageRecognizer();

  if (!recognize) {
    return '';
  }

  const result = await withTimeout(recognize(dataUrlToBuffer(dataUrl), 'eng'), 'Image OCR');
  return result.data?.text?.trim() || '';
}

/**
 * Enriches attachments with extracted text so the (text-only) LLM can reason
 * about their contents: PDFs get full text extraction, images get OCR.
 * Extraction failures are non-fatal — the attachment keeps name-only context.
 */
export async function extractAttachmentContents(
  attachments: ClinicAssistantAttachment[]
): Promise<ClinicAssistantAttachment[]> {
  return Promise.all(attachments.map(async (attachment) => {
    if (attachment.textContent?.trim() || !attachment.dataUrl) {
      return attachment;
    }

    try {
      let extracted = '';

      if (attachment.kind === 'image') {
        extracted = await extractImageText(attachment.dataUrl);
      } else if (attachment.type === 'application/pdf' || /\.pdf$/i.test(attachment.name)) {
        extracted = await extractPdfText(attachment.dataUrl);
      }

      if (!extracted) {
        return attachment;
      }

      return {
        ...attachment,
        textContent: extracted.slice(0, maxExtractedTextLength),
      };
    } catch {
      return attachment;
    }
  }));
}
