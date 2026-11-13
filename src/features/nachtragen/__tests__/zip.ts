/** Kleiner ZIP-Schreiber nur für Tests: gespeicherte oder (über CompressionStream) gepackte Einträge. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const writing = writer.write(new Uint8Array(data)).then(() => writer.close());
  const [out] = await Promise.all([new Response(stream.readable).arrayBuffer(), writing]);
  return new Uint8Array(out);
}

export interface ZipInput {
  name: string;
  content: string | Uint8Array;
  deflate?: boolean;
}

export async function makeZip(entries: ZipInput[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const raw = typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content;
    const data = entry.deflate ? await deflateRaw(raw) : raw;
    const method = entry.deflate ? 8 : 0;
    const crc = crc32(raw);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** Ein Absatz in WordprocessingML; `style` ist die Kennung der Formatvorlage. */
export function para(runs: string, style?: string): string {
  const props = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${props}${runs}</w:p>`;
}

export const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

export function documentXml(body: string, prefixDecl = W): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${prefixDecl}><w:body>${body}<w:sectPr/></w:body></w:document>`;
}

export function stylesXml(styles: { id: string; name: string; basedOn?: string }[]): string {
  return `<?xml version="1.0"?><w:styles ${W}>${styles
    .map(
      (s) =>
        `<w:style w:type="paragraph" w:styleId="${s.id}"><w:name w:val="${s.name}"/>${
          s.basedOn ? `<w:basedOn w:val="${s.basedOn}"/>` : ''
        }</w:style>`,
    )
    .join('')}</w:styles>`;
}

export async function makeDocx(
  body: string,
  options: { deflate?: boolean; styles?: string } = {},
): Promise<Uint8Array> {
  return makeZip([
    { name: '[Content_Types].xml', content: '<Types/>' },
    { name: 'word/document.xml', content: documentXml(body), deflate: options.deflate },
    ...(options.styles ? [{ name: 'word/styles.xml', content: options.styles }] : []),
  ]);
}
