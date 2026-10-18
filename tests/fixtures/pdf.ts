// Small, self-authored PDFs: no external documents or additional fixture generator needed.
export function makePdf(pages: string[], options: { encrypted?: boolean; cjkMap?: boolean } = {}) {
  const characters = [...new Set(Array.from(pages.join("")))];
  const codes = new Map(characters.map((c, i) => [c, (i + 1).toString(16).padStart(4, "0")]));
  const utf16 = (text: string) => Buffer.from(text, "utf16le").swap16().toString("hex");
  const mappings = characters.map((c) => `<${codes.get(c)}> <${utf16(c)}>`);
  const chunks: string[] = [];
  for (let i = 0; i < mappings.length; i += 100) { const group = mappings.slice(i, i + 100); chunks.push(`${group.length} beginbfchar\n${group.join("\n")}\nendbfchar`); }
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Fixture def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n${chunks.join("\n")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  const stream = (text: string) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${6 + i * 2} 0 R`).join(" ")}] >>`,
    options.cjkMap ? "<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3 /Encoding /UniJIS-UTF16-H /DescendantFonts [4 0 R] >>" : "<< /Type /Font /Subtype /Type0 /BaseFont /Fixture /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 5 0 R >>",
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Fixture /CIDSystemInfo << /Registry (Adobe) /Ordering (${options.cjkMap ? "Japan1" : "Identity"}) /Supplement 2 >> /DW 1000 /CIDToGIDMap /Identity /FontDescriptor << /Type /FontDescriptor /FontName /Fixture /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >> >>`,
    stream(cmap),
  ];
  for (const text of pages) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`);
    const lines = text.split("\n").map((line) => `<${options.cjkMap ? utf16(line) : Array.from(line).map((c) => codes.get(c)).join("")}> Tj`).join("\n0 -18 Td\n");
    objects.push(stream(text ? `BT /F1 12 Tf 40 760 Td ${lines} ET` : ""));
  }
  if (options.encrypted) objects.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <${"00".repeat(32)}> /U <${"11".repeat(32)}> >>`);
  let pdf = "%PDF-1.7\n% Fussenn test fixture\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${options.encrypted ? ` /Encrypt ${objects.length} 0 R /ID [<${"22".repeat(16)}><${"22".repeat(16)}>]` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
