import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

function pageLines(items) {
  const rows = [];
  for (const item of items) {
    const text = String(item.str || '').trim();
    if (!text) continue;
    const y = item.transform?.[5] || 0;
    const x = item.transform?.[4] || 0;
    let row = rows.find((entry) => Math.abs(entry.y - y) < 3);
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x, text });
  }
  return rows.sort((a, b) => b.y - a.y).map((row) => row.parts.sort((a, b) => a.x - b.x).map((part) => part.text).join(' ').replace(/\s+/g, ' ').trim());
}

function usefulTitle(value) {
  const text = String(value || '').trim();
  return text.length >= 8 && text.length <= 300 && !/^(untitled|microsoft word|adobe|arxiv|doi|abstract|摘要|www\.|https?:|volume|journal)/i.test(text);
}

function extractAbstract(lines) {
  const start = lines.findIndex((line) => /^(abstract|摘要)\b[\s:：.-]*/i.test(line));
  if (start < 0) return '';
  const content = [lines[start].replace(/^(abstract|摘要)\b[\s:：.-]*/i, '')];
  for (let i = start + 1; i < Math.min(lines.length, start + 22); i++) {
    if (/^(keywords?|index terms?|introduction|1[.\s]+introduction|关键词|引言|1[.、\s]+引言)\b/i.test(lines[i])) break;
    content.push(lines[i]);
    if (content.join(' ').length > 1400) break;
  }
  return content.join(' ').replace(/\s+/g, ' ').trim().slice(0, 1500);
}

function extractKeywords(lines, metadata) {
  const source = metadata || lines.find((line) => /^(keywords?|index terms?|关键词)\b[\s:：.-]*/i.test(line)) || '';
  return [...new Set(source.replace(/^(keywords?|index terms?|关键词)\b[\s:：.-]*/i, '')
    .split(/[,，;；·]|\s+[-–—]\s+/).map((item) => item.trim()).filter((item) => item.length >= 2 && item.length <= 40))].slice(0, 8);
}

export async function extractPdfMetadata(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({ data: bytes, useSystemFonts: true });
  try {
    const pdf = await task.promise;
    const metadata = await pdf.getMetadata().catch(() => null);
    const info = metadata?.info || {};
    const lines = [];
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 2); pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      lines.push(...pageLines((await page.getTextContent()).items));
      page.cleanup();
    }
    const firstPage = lines.slice(0, 28);
    const title = usefulTitle(info.Title) ? info.Title.trim() : firstPage.find(usefulTitle) || file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
    const titleIndex = firstPage.findIndex((line) => line === title);
    const possibleAuthor = titleIndex >= 0 ? firstPage.slice(titleIndex + 1, titleIndex + 4).find((line) =>
      line.length >= 4 && line.length <= 120 && !/\d{4}|@|doi|abstract|摘要|university|institute|department|journal|arxiv|http/i.test(line)) : '';
    const firstPageText = firstPage.join(' ');
    const yearMatch = firstPageText.match(/\b(?:19|20)\d{2}\b/) || String(info.CreationDate || '').match(/(?:19|20)\d{2}/);
    const doiMatch = lines.join(' ').match(/\b10\.\d{4,9}\/[\w.;()/:+-]+/i);
    const abstract = extractAbstract(lines);
    const keywords = extractKeywords(lines, info.Keywords);
    return {
      title, authors: String(info.Author || possibleAuthor || '').trim(),
      year: yearMatch ? Number(yearMatch[0]) : null,
      doi: doiMatch?.[0]?.replace(/[.,;]+$/, '') || '',
      tags: keywords, abstract,
      pageCount: pdf.numPages,
      hasText: lines.some((line) => line.length > 20),
    };
  } finally {
    await task.destroy();
  }
}
