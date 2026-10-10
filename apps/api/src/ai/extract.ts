import { BadRequestException } from '@nestjs/common';

/** 从上传的合同、技术协议、库存计划里取出文字（PDF、Word、Excel、纯文本） */
export async function extractText(file: { originalname: string; buffer: Buffer; mimetype: string }): Promise<string> {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.pdf')) {
    const { extractText: pdf, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(file.buffer));
    const { text } = await pdf(doc, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    const out = pages.map((t, i) => `【第 ${i + 1} 页】\n${t}`).join('\n\n');
    if (!out.replace(/【第 \d+ 页】|\s/g, '')) throw new BadRequestException({ code: 'AI_FILE_NO_TEXT', message: 'The PDF has no text layer (scanned image); OCR it first' });
    return out;
  }
  if (name.endsWith('.docx')) {
    const mammoth = (await import('mammoth')).default;
    return (await mammoth.extractRawText({ buffer: file.buffer })).value;
  }
  if (name.endsWith('.xlsx')) {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const parts: string[] = [];
    wb.eachSheet((ws) => {
      parts.push(`【工作表 ${ws.name}】`);
      ws.eachRow((row, i) => { parts.push(`第 ${i} 行：${(row.values as unknown[]).slice(1).map((v) => (v && typeof v === 'object' && 'text' in v ? (v as { text: string }).text : v instanceof Date ? v.toISOString().slice(0, 10) : v ?? '')).join(' | ')}`); });
    });
    return parts.join('\n');
  }
  if (name.endsWith('.txt') || name.endsWith('.csv') || name.endsWith('.md')) return file.buffer.toString('utf8');
  throw new BadRequestException({ code: 'AI_FILE_TYPE', message: 'Supported: PDF, Word (.docx), Excel (.xlsx), text' });
}
