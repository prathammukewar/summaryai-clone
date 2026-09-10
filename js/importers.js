const PDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs';
const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs';

export async function extractPdf(file, onStatus) {
  const pdfjs = await import(PDF_URL);
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    if (onStatus) onStatus(`Reading page ${i} of ${doc.numPages}`);
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const lines = [];
    let line = '', lastY = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line.trim()); line = ''; }
      line += it.str + (it.hasEOL ? '\n' : ' ');
      lastY = y;
    }
    lines.push(line.trim());
    pages.push(lines.filter(Boolean).join('\n'));
  }
  return pages.join('\n\n');
}

export function readText(file) { return file.text(); }
