import { deflateSync } from 'node:zlib';

export interface PdfPage {
  /** Page size in points (1 design px = 1 pt). */
  width: number;
  height: number;
  /** The page image: unpremultiplied RGBA, drawn over the whole page. */
  image: { width: number; height: number; rgba: Uint8Array };
}

/**
 * A PDF with one image per page. Color and alpha are stored losslessly (Flate), alpha as a soft mask so
 * transparent areas stay transparent.
 */
export function writePdf(pages: PdfPage[], title?: string): Uint8Array {
  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Buffer | string) => {
    const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b;
    chunks.push(buf);
    length += buf.length;
  };
  const object = (id: number, body: string, stream?: Buffer) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}\n`);
    if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
    push('endobj\n');
  };

  push('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');
  // 1 catalog, 2 page tree, 3 info, then 4 objects per page: page, content, image, mask.
  const pageIds = pages.map((_, i) => 4 + i * 4);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  object(3, `<< /Producer (nib)${title ? ` /Title ${pdfString(title)}` : ''} >>`);
  pages.forEach((p, i) => {
    const [pageId, contentId, imageId, maskId] = [pageIds[i], pageIds[i] + 1, pageIds[i] + 2, pageIds[i] + 3];
    const { width: iw, height: ih, rgba } = p.image;
    const rgb = Buffer.alloc(iw * ih * 3);
    const alpha = Buffer.alloc(iw * ih);
    for (let j = 0, k = 0; j < iw * ih; j++, k += 4) {
      rgb[j * 3] = rgba[k]; rgb[j * 3 + 1] = rgba[k + 1]; rgb[j * 3 + 2] = rgba[k + 2];
      alpha[j] = rgba[k + 3];
    }
    const w = num(p.width), h = num(p.height);
    const content = Buffer.from(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`, 'latin1');
    object(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    object(contentId, `<< /Length ${content.length} >>`, content);
    const color = deflateSync(rgb);
    object(imageId, `<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask ${maskId} 0 R /Length ${color.length} >>`, color);
    const mask = deflateSync(alpha);
    object(maskId, `<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${mask.length} >>`, mask);
  });

  const count = 4 + pages.length * 4;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Uint8Array(Buffer.concat(chunks));
}

const num = (v: number) => (Math.round(v * 100) / 100).toString();

/** A PDF text string: UTF-16BE with a byte order mark, so any title survives. */
function pdfString(s: string): string {
  const hex = Buffer.from(`\uFEFF${s}`, 'utf16le').swap16().toString('hex');
  return `<${hex}>`;
}
