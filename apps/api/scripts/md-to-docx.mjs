#!/usr/bin/env node
// Convert a markdown file to a styled .docx with no dependencies.
// Usage: node scripts/md-to-docx.mjs <input.md> <output.docx>
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const [, , inputArg, outputArg] = process.argv;
if (!inputArg || !outputArg) {
  console.error("Usage: node scripts/md-to-docx.mjs <input.md> <output.docx>");
  process.exit(1);
}
const { resolve } = await import("node:path");
const inputPath = resolve(inputArg);
const outputPath = resolve(outputArg);

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Split a string into runs, honoring `code` spans and **bold**.
function inlineRuns(text) {
  const runs = [];
  const parts = text.split(/(`[^`]+`)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("`") && part.endsWith("`")) {
      runs.push({ code: true, text: part.slice(1, -1) });
    } else {
      // now handle **bold**
      const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
      for (const bp of boldParts) {
        if (!bp) continue;
        if (bp.startsWith("**") && bp.endsWith("**")) {
          runs.push({ bold: true, text: bp.slice(2, -2) });
        } else {
          runs.push({ text: bp });
        }
      }
    }
  }
  return runs;
}

function runXml(run) {
  const props = [];
  if (run.bold) props.push("<w:b/>");
  if (run.code) {
    props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
    props.push('<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>');
    props.push('<w:sz w:val="18"/>');
  }
  const rPr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(run.text)}</w:t></w:r>`;
}

function paraXml(runs, style, extra = "") {
  const pPr = `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>`;
  return `<w:p>${pPr}${runs.map(runXml).join("")}</w:p>`;
}

const body = [];

function addParagraph(text, style, extra) {
  body.push(paraXml(inlineRuns(text), style, extra));
}

function addCodeBlock(code) {
  const lines = code.replace(/\n$/, "").split("\n");
  const runs = [];
  lines.forEach((line, i) => {
    runs.push(`<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`);
    if (i < lines.length - 1) runs.push(`<w:r><w:br/></w:r>`);
  });
  body.push(
    `<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr>${runs.join("")}</w:p>`,
  );
}

function addTable(rows) {
  const nCols = Math.max(...rows.map((r) => r.length));
  const header = rows[0];
  const grid = `<w:tblGrid>${Array.from({ length: nCols }, () => '<w:gridCol w:w="2200"/>').join("")}</w:tblGrid>`;
  const trs = rows.map((row, idx) => {
    const cells = Array.from({ length: nCols }, (_, c) => row[c] ?? "");
    const tcs = cells
      .map((cell) => {
        const isHeader = idx === 0;
        const runs = inlineRuns(cell).map((r) =>
          runXml(isHeader ? { ...r, bold: true } : r),
        );
        const tcPr = `<w:tcPr><w:tcW w:w="0" w:type="auto"/>${isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>' : ""}</w:tcPr>`;
        return `<w:tc>${tcPr}<w:p>${runs.join("")}</w:p></w:tc>`;
      })
      .join("");
    return `<w:tr>${tcs}</w:tr>`;
  });
  body.push(
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/><w:insideH w:val="single" w:sz="4" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:color="999999"/></w:tblBorders><w:tblLayout w:type="autofit"/></w:tblPr>${grid}${trs.join("")}</w:tbl>`,
  );
  body.push(`<w:p><w:pPr><w:spacing w:after="160"/></w:pPr></w:p>`);
}

// --- parse markdown ---
const lines = readFileSync(inputPath, "utf8").split("\n");
let i = 0;
while (i < lines.length) {
  const line = lines[i];

  if (line.trim() === "") { i++; continue; }

  // horizontal rule
  if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
    body.push(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BBBBBB"/></w:pBdr><w:spacing w:after="160"/></w:pPr></w:p>`);
    i++; continue;
  }

  // fenced code block
  if (/^\s*```/.test(line)) {
    const block = [];
    i++;
    while (i < lines.length && !/^\s*```/.test(lines[i])) { block.push(lines[i]); i++; }
    i++;
    addCodeBlock(block.join("\n"));
    continue;
  }

  // headings
  const h = line.match(/^(#{1,4})\s+(.*)$/);
  if (h) {
    const level = h[1].length;
    addParagraph(h[2], `Heading${level}`);
    i++; continue;
  }

  // table
  if (line.trim().startsWith("|") && lines[i + 1] && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
    const rows = [];
    const parseRow = (l) =>
      l
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim());
    rows.push(parseRow(line));
    i += 2; // skip separator
    while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(parseRow(lines[i])); i++; }
    addTable(rows);
    continue;
  }

  // blockquote
  if (/^\s*>\s?/.test(line)) {
    const quote = [];
    while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
    body.push(`<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr>${inlineRuns(quote.join(" ")).map(runXml).join("")}</w:p>`);
    continue;
  }

  // unordered list (with optional 2-space nesting)
  const ul = line.match(/^(\s*)[-*]\s+(.*)$/);
  if (ul) {
    const nested = ul[1].length >= 2;
    addParagraph(`${nested ? "    ◦ " : "•  "}${ul[2]}`, "ListParagraph", nested ? '<w:ind w:left="720"/>' : '<w:ind w:left="360"/>');
    i++; continue;
  }

  // ordered list
  const ol = line.match(/^(\s*)\d+\.\s+(.*)$/);
  if (ol) {
    const nested = ol[1].length >= 2;
    addParagraph(`${nested ? "      – " : `${ol[0].match(/^\s*\d+/)[0]}.  `}${ol[2]}`, "ListParagraph", nested ? '<w:ind w:left="720"/>' : '<w:ind w:left="360"/>');
    i++; continue;
  }

  // plain paragraph (join soft-wrapped lines)
  const para = [line];
  while (i + 1 < lines.length && lines[i + 1].trim() !== "" &&
         !/^(#{1,4})\s/.test(lines[i + 1]) && !/^\s*```/.test(lines[i + 1]) &&
         !/^\s*(---+|\*\*\*+)\s*$/.test(lines[i + 1]) && !/^\s*>\s?/.test(lines[i + 1]) &&
         !/^\s*[-*]\s+/.test(lines[i + 1]) && !/^\s*\d+\.\s+/.test(lines[i + 1]) &&
         !lines[i + 1].trim().startsWith("|")) {
    para.push(lines[i + 1]);
    i++;
  }
  addParagraph(para.join(" "));
  i++;
}

// --- assemble the .docx package ---
const work = join(tmpdir(), `md2docx-${Date.now()}`);
mkdirSync(join(work, "word", "_rels"), { recursive: true });
mkdirSync(join(work, "_rels"), { recursive: true });

const sectPr = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
writeFileSync(
  join(work, "word", "document.xml"),
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}${sectPr}</w:body></w:document>`,
);

writeFileSync(join(work, "[Content_Types].xml"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);

writeFileSync(join(work, "_rels", ".rels"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

writeFileSync(join(work, "word", "_rels", "document.xml.rels"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

writeFileSync(join(work, "word", "styles.xml"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="280" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1F4E79"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="1F4E79"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="2E74B5"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:i/><w:sz w:val="22"/><w:color w:val="2E74B5"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120"/><w:ind w:left="360"/><w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/><w:keepLines/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>
</w:styles>`);

execFileSync("zip", ["-q", "-r", outputPath, "."], { cwd: work });
rmSync(work, { recursive: true, force: true });
console.log(`Wrote ${outputPath} (${existsSync(outputPath) ? "ok" : "FAILED"})`);
