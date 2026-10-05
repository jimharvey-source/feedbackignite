// api/generate-pdf.js
// One shared PDF engine for the five Management Ignition tools, in the Management Ignition
// design system (5 October 2026). Server-side PDFKit. Instrument Sans for everything the
// software says; Fraunces only for what the team member reads (the briefing note, the goal
// brief and template, the development summary, the agenda, actions and follow-up note, the
// feedback letter). Tool colour as a 3px line only.
// GENERATED from generate-pdf.cjs.js by make-esm.py. Do not edit; edit the CJS file and regenerate.
// Pattern adapted from OSCI generate-report.js: buffered pages, draw then stamp.

import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Per-tool identity ────────────────────────────────────────────
const TOOLS = {
  delegate: { name: "Delegate Ignite", tool: "#0077b6" },
  goal:     { name: "Goal Ignite",     tool: "#4caf50" },
  feedback: { name: "Feedback Ignite", tool: "#8b00cc" },
  coach:    { name: "Coach Ignite",    tool: "#ff9800" },
  meeting:  { name: "Meeting Ignite",  tool: "#f44336" },
};

// ── Design system roles ──────────────────────────────────────────
const INK = "#1b2a4a";        // headlines, names, the letter
const INK_2 = "#2a3d63";      // body copy
const MUTED = "#5d6b7f";      // labels, dates, small print
const RULE = "#e2e7ee";       // hairlines
const SUNK = "#eef2f6";       // tiles, tracks
const ACCENT = "#0e7c7b";     // the method speaking: the level bar, the mark's peak
const ACCENT_SOFT = "#e9f3f3";// the cadence panel; text on it is ink

// ── Fonts ────────────────────────────────────────────────────────
// Read with path.join(__dirname, ...) so Vercel bundles the files with the function.
// If a font cannot be read, say so in the log and fall back to the built-in faces:
// the download still works, and the log shows why it looks wrong.
const FONT_FILES = {
  sans: path.join(__dirname, "_fonts", "InstrumentSans-Regular.ttf"),
  sansBold: path.join(__dirname, "_fonts", "InstrumentSans-SemiBold.ttf"),
  spoken: path.join(__dirname, "_fonts", "Fraunces-Regular.ttf"),
};
let FONT_DATA = null;
try {
  FONT_DATA = {
    sans: fs.readFileSync(FONT_FILES.sans),
    sansBold: fs.readFileSync(FONT_FILES.sansBold),
    spoken: fs.readFileSync(FONT_FILES.spoken),
  };
} catch (e) {
  console.error("generate-pdf: brand fonts not found, falling back to Helvetica/Times:", e.message);
}
const F = FONT_DATA
  ? { sans: "Sans", bold: "SansBold", spoken: "Spoken" }
  : { sans: "Helvetica", bold: "Helvetica-Bold", spoken: "Times-Roman" };
function registerFonts(doc) {
  if (!FONT_DATA) return;
  doc.registerFont("Sans", FONT_DATA.sans);
  doc.registerFont("SansBold", FONT_DATA.sansBold);
  doc.registerFont("Spoken", FONT_DATA.spoken);
}

const PAGE = { size: "A4", margin: 56 };
const CONTENT_LEFT = 56;
const CONTENT_RIGHT = 539; // A4 width 595 - 56
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_LEFT;
const PAGE_BOTTOM = 770;

// Names arrive as typed. "joyce adams" prints as "Joyce Adams".
function titleCase(s) {
  return String(s || "").trim().split(/\s+/).map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(" ");
}

// A line on its own, short, with no closing punctuation, is a heading the model wrote
// ("The task", "Why you"). Set it as a heading rather than as body text.
function isHeadingLine(line) {
  const l = line.trim();
  return l.length > 0 && l.length <= 70 && !/[.:;,!?]$/.test(l) && !/^\d+\./.test(l) && !/^[-•]/.test(l);
}

// ── Helper set (the house style) ─────────────────────────────────
function makeHelpers(doc) {
  function ensureSpace(h) {
    if (doc.y + h > PAGE_BOTTOM) doc.addPage();
  }
  // Labels: sentence case, never capitals.
  function label(text, opts = {}) {
    ensureSpace(18);
    doc.font(F.bold).fontSize(opts.size || 9).fillColor(opts.color || MUTED)
      .text(text, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.25);
  }
  // A title is a title. If a manager, or a sharpening step, hands us a
  // paragraph, clamp it rather than setting two pages in headline type.
  // The full text still appears under "What you told us".
  function clampTitle(text) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (t.length <= 90) return t;
    const cut = t.slice(0, 90);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\-\s]+$/, "") + "...";
  }
  function h1(text) {
    const title = clampTitle(text);
    ensureSpace(44);
    doc.font(F.bold).fontSize(title.length > 55 ? 20 : 26).fillColor(INK)
      .text(title, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH, characterSpacing: -0.4 });
    doc.moveDown(0.3);
  }
  function h2(text) {
    ensureSpace(34);
    doc.font(F.bold).fontSize(15).fillColor(INK)
      .text(text, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH, characterSpacing: -0.15 });
    doc.moveDown(0.5);
  }
  function h3(text, x = CONTENT_LEFT, width = CONTENT_WIDTH) {
    ensureSpace(40);
    doc.font(F.bold).fontSize(11).fillColor(INK).text(text, x, doc.y, { width });
    doc.moveDown(0.2);
  }
  // Body text, paragraph by paragraph so page breaks land cleanly.
  // spoken: true sets it as the letter (Fraunces), for what the team member reads.
  function body(text, opts = {}) {
    if (!text) return;
    const spoken = !!opts.spoken;
    const font = spoken ? F.spoken : F.sans;
    const size = opts.size || (spoken ? 11 : 10.5);
    const color = opts.color || (spoken ? INK : INK_2);
    const lineGap = spoken ? 4 : 3.5;
    // Paragraphs split on blank lines. In the manager's notes a numbered step also starts its own
    // paragraph, even when the model put it on the next line without a blank one.
    const paras = String(text).replace(/\r/g, "").split(spoken ? /\n\s*\n/ : /\n\s*\n|\n(?=\d{1,2}\.\s)/);
    paras.forEach((para) => {
      const lines = para.replace(/[ \t]+\n/g, "\n").trim().split("\n");
      if (!lines[0]) return;
      // A heading line at the top of a paragraph becomes a heading.
      // headings: false for text that has none (the feedback letter).
      if (opts.headings !== false && lines.length >= 1 && isHeadingLine(lines[0]) && (lines.length > 1 || paras.length > 1)) {
        doc.moveDown(0.3);
        h3(lines.shift().trim());
      }
      const rest = lines.join("\n").trim();
      if (!rest) return;
      ensureSpace(24);
      // A numbered step with a title ("1. Define the task. Set out...") gets its title in bold.
      // Manager's notes only: the team member's letter is left as written.
      const step = spoken ? null : rest.match(/^(\d{1,2}\.\s+[^.:!?\n]{2,80}[.:])\s+([\s\S]+)$/);
      if (step) {
        doc.font(F.bold).fontSize(size).fillColor(INK)
          .text(step[1] + " ", CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH, align: "left", lineGap, continued: true });
        doc.font(font).fontSize(size).fillColor(color).text(step[2], { width: CONTENT_WIDTH, align: "left", lineGap });
      } else {
        doc.font(font).fontSize(size).fillColor(color)
          .text(rest, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH, align: "left", lineGap });
      }
      doc.moveDown(0.6);
    });
    doc.moveDown(0.3);
  }
  function rule() {
    ensureSpace(14);
    const y = doc.y + 2;
    doc.moveTo(CONTENT_LEFT, y).lineTo(CONTENT_RIGHT, y).lineWidth(0.6).strokeColor(RULE).stroke();
    doc.y = y + 14;
  }
  function levelMeter(level, levelLabel, levelDesc, levelReason) {
    ensureSpace(levelReason ? 130 : 80);
    label("Delegation level");
    const tileY = doc.y;
    doc.font(F.bold).fontSize(17).fillColor(INK)
      .text(`Level ${level}: ${levelLabel}`, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH - 56 });
    // number tile, ink
    doc.roundedRect(CONTENT_RIGHT - 40, tileY - 4, 40, 40, 6).fillColor(INK).fill();
    doc.font(F.bold).fontSize(18).fillColor("#FFFFFF")
      .text(String(level), CONTENT_RIGHT - 40, tileY + 6, { width: 40, align: "center" });
    doc.y = Math.max(doc.y, tileY + 40) + 6;
    // bar: the method speaking
    const barY = doc.y;
    doc.roundedRect(CONTENT_LEFT, barY, CONTENT_WIDTH, 5, 2.5).fillColor(SUNK).fill();
    const fillW = Math.max(5, CONTENT_WIDTH * (Number(level) / 10));
    doc.roundedRect(CONTENT_LEFT, barY, fillW, 5, 2.5).fillColor(ACCENT).fill();
    doc.y = barY + 13;
    if (levelDesc) {
      doc.font(F.sans).fontSize(9.5).fillColor(MUTED)
        .text(levelDesc, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
    }
    // Why this level: one sentence from the model, written from what the manager entered.
    if (levelReason) {
      doc.moveDown(0.8);
      doc.font(F.bold).fontSize(9).fillColor(MUTED).text("Why this level", CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
      doc.moveDown(0.15);
      doc.font(F.sans).fontSize(11).fillColor(INK_2)
        .text(String(levelReason).trim(), CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH, lineGap: 3 });
    }
    doc.moveDown(1.2);
  }
  return { label, h1, h2, h3, body, rule, levelMeter, ensureSpace };
}

// ── The cadence panel: accent-soft ground, ink text, no coloured rule ──
function drawCadenceCard(doc, cadence) {
  if (!cadence) return;
  const pad = 16;
  const w = CONTENT_WIDTH - pad * 2;
  const formatText = `Format: ${cadence.format || ""}`;
  doc.font(F.sans).fontSize(10);
  let h = pad + 14 + 20;
  h += doc.heightOfString(formatText, { width: w, lineGap: 3 }) + 6;
  doc.font(F.sans).fontSize(9.5);
  h += doc.heightOfString(cadence.rationale || "", { width: w, lineGap: 3 }) + pad;

  if (doc.y + h > PAGE_BOTTOM + 10) doc.addPage();
  const y0 = doc.y;
  doc.save();
  doc.roundedRect(CONTENT_LEFT, y0, CONTENT_WIDTH, h, 8).fillColor(ACCENT_SOFT).fill();
  doc.restore();
  let ty = y0 + pad;
  doc.font(F.bold).fontSize(9).fillColor(INK)
    .text("Recommended cadence", CONTENT_LEFT + pad, ty, { width: w });
  ty = doc.y + 2;
  doc.font(F.bold).fontSize(14).fillColor(INK)
    .text(cadence.frequency || "", CONTENT_LEFT + pad, ty, { width: w });
  ty = doc.y + 5;
  doc.font(F.bold).fontSize(10).fillColor(INK).text("Format: ", CONTENT_LEFT + pad, ty, { continued: true });
  doc.font(F.sans).fontSize(10).fillColor(INK).text(cadence.format || "", { width: w, lineGap: 3 });
  ty = doc.y + 5;
  doc.font(F.sans).fontSize(9.5).fillColor(INK_2)
    .text(cadence.rationale || "", CONTENT_LEFT + pad, ty, { width: w, lineGap: 3 });
  doc.y = y0 + h + 18;
  doc.x = CONTENT_LEFT;
}

// ── Render the Delegate report ───────────────────────────────────
function renderDelegate(doc, data) {
  const H = makeHelpers(doc);
  const { form = {}, result = {} } = data;
  const manager = titleCase(result.managerName || form.managerName || "");
  const delegatee = titleCase(result.delegateeName || form.delegateeName || "");

  // Cover block
  H.label("Delegation guide", { size: 10 });
  H.h1(result.taskTitle || form.taskTitle || "Delegation guide");
  doc.font(F.sans).fontSize(10.5).fillColor(INK_2)
    .text(`Prepared for ${manager}${delegatee ? `. Delegating to ${delegatee}.` : ""}`, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  doc.font(F.sans).fontSize(9.5).fillColor(MUTED).text(today, CONTENT_LEFT, doc.y + 2);
  doc.moveDown(1.2);
  H.rule();

  // The inputs: label above value, as on screen
  H.h2("What you told us");
  const inputs = [
    ["Task", form.taskTitle],
    ["Description", form.taskDescription],
    ["Outcomes", form.outcomes],
    ["Deadline", form.deadline],
    ["Complexity", form.complexity],
    ["Importance", form.importance],
    ["Their skill at this", form.skillLevel],
    ["Their confidence", form.confidenceLevel],
    ["Why this person", form.personalReason],
  ];
  // In the order asked. Long answers take the full width; a run of short ones sits two to a row.
  const colW = (CONTENT_WIDTH - 24) / 2;
  const given = inputs.filter(([, v]) => v && String(v).trim());
  let i = 0;
  while (i < given.length) {
    const [k, v] = given[i];
    if (String(v).length > 40) {
      H.ensureSpace(36);
      doc.font(F.bold).fontSize(9).fillColor(MUTED).text(k, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
      doc.moveDown(0.15);
      doc.font(F.sans).fontSize(10).fillColor(INK).text(asTyped(v), CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH, lineGap: 2.5 });
      doc.moveDown(0.7);
      i += 1;
      continue;
    }
    const pair = [given[i]];
    if (given[i + 1] && String(given[i + 1][1]).length <= 40) pair.push(given[i + 1]);
    H.ensureSpace(34);
    const rowY = doc.y;
    let bottom = rowY;
    pair.forEach(([pk, pv], j) => {
      const x = CONTENT_LEFT + j * (colW + 24);
      doc.font(F.bold).fontSize(9).fillColor(MUTED).text(pk, x, rowY, { width: colW });
      doc.font(F.sans).fontSize(10).fillColor(INK).text(String(pv).trim(), x, doc.y + 2, { width: colW });
      bottom = Math.max(bottom, doc.y);
    });
    doc.y = bottom + 10;
    i += pair.length;
  }
  doc.x = CONTENT_LEFT;
  doc.moveDown(0.4);
  H.rule();

  // Level meter
  const lvl = result.delegationLevel || "5";
  H.levelMeter(lvl, result.levelLabel || levelLabelFor(lvl), result.levelDesc || levelDescFor(lvl), result.levelReason);

  // Cadence panel
  drawCadenceCard(doc, result.cadence);

  // Output one: manager advice, in sans
  H.ensureSpace(80);
  H.label("Manager only");
  H.h2("Advice for the delegator");
  H.body(result.delegationAdvice);

  // Output two: the briefing note, on its own page, set as the letter
  doc.addPage();
  H.label(delegatee ? `Share with ${delegatee}` : "Share with the delegatee");
  H.h2(delegatee ? `Briefing note for ${delegatee}` : "Briefing note");
  doc.moveDown(0.3);
  H.body(result.briefingNote, { spoken: true });
}

// ── Shared pieces for the other four reports ─────────────────────
const todayLong = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

// Cover block, as Delegate's: label, title, prepared-for line, date, rule.
function drawCover(doc, H, kind, title, preparedLine, note) {
  H.label(kind, { size: 10 });
  H.h1(title);
  if (preparedLine) {
    doc.font(F.sans).fontSize(10.5).fillColor(INK_2)
      .text(preparedLine, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
  }
  doc.font(F.sans).fontSize(9.5).fillColor(MUTED).text(todayLong(), CONTENT_LEFT, doc.y + 2);
  if (note) {
    doc.font(F.sans).fontSize(9.5).fillColor(MUTED)
      .text(note, CONTENT_LEFT, doc.y + 2, { width: CONTENT_WIDTH });
  }
  doc.moveDown(1.2);
  H.rule();
}

// "What you told us": label above value, in the order given. Long answers take the
// full width; a run of short ones sits two to a row. The same layout as Delegate's.
// What the manager typed, as typed, except a line break in the middle of a sentence
// ("the data was" / "clear.") is joined. Lists and new sentences keep their breaks.
function asTyped(v) {
  return String(v).trim().replace(/([^.!?:;\n])[ \t]*\n(?=[a-z])/g, "$1 ");
}

function drawInputs(doc, H, inputs) {
  H.h2("What you told us");
  const colW = (CONTENT_WIDTH - 24) / 2;
  const given = inputs.filter(([, v]) => v !== undefined && v !== null && String(v).trim());
  let i = 0;
  while (i < given.length) {
    const [k, v] = given[i];
    if (String(v).length > 40) {
      H.ensureSpace(36);
      doc.font(F.bold).fontSize(9).fillColor(MUTED).text(k, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
      doc.moveDown(0.15);
      doc.font(F.sans).fontSize(10).fillColor(INK).text(asTyped(v), CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH, lineGap: 2.5 });
      doc.moveDown(0.7);
      i += 1;
      continue;
    }
    const pair = [given[i]];
    if (given[i + 1] && String(given[i + 1][1]).length <= 40) pair.push(given[i + 1]);
    H.ensureSpace(34);
    const rowY = doc.y;
    let bottom = rowY;
    pair.forEach(([pk, pv], j) => {
      const x = CONTENT_LEFT + j * (colW + 24);
      doc.font(F.bold).fontSize(9).fillColor(MUTED).text(pk, x, rowY, { width: colW });
      doc.font(F.sans).fontSize(10).fillColor(INK).text(String(pv).trim(), x, doc.y + 2, { width: colW });
      bottom = Math.max(bottom, doc.y);
    });
    doc.y = bottom + 10;
    i += pair.length;
  }
  doc.x = CONTENT_LEFT;
  doc.moveDown(0.4);
  H.rule();
}

// An info panel: a label, a heading, paragraphs. Ground is sunk (neutral) or accent-soft
// (the method speaking); text on it is ink. No coloured rule. A zone's status colour
// never reaches the page: the zone is named in words.
function drawPanel(doc, H, { fill = SUNK, label: lab, heading, text }) {
  const pad = 16;
  const w = CONTENT_WIDTH - pad * 2;
  const paras = String(text || "").replace(/\r/g, "").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  let h = pad;
  doc.font(F.bold).fontSize(9);
  if (lab) h += doc.heightOfString(lab, { width: w }) + 2;
  doc.font(F.bold).fontSize(14);
  if (heading) h += doc.heightOfString(heading, { width: w }) + 5;
  doc.font(F.sans).fontSize(10);
  paras.forEach(p => { h += doc.heightOfString(p, { width: w, lineGap: 3 }) + 6; });
  h += pad - 6;

  // Too tall for any page: set it unboxed rather than let the panel run off the page.
  if (h > PAGE_BOTTOM - 72) {
    if (lab) H.label(lab);
    if (heading) H.h3(heading);
    H.body(paras.join("\n\n"), { headings: false });
    return;
  }
  if (doc.y + h > PAGE_BOTTOM + 10) doc.addPage();
  const y0 = doc.y;
  doc.save();
  doc.roundedRect(CONTENT_LEFT, y0, CONTENT_WIDTH, h, 8).fillColor(fill).fill();
  doc.restore();
  let ty = y0 + pad;
  if (lab) {
    doc.font(F.bold).fontSize(9).fillColor(INK).text(lab, CONTENT_LEFT + pad, ty, { width: w });
    ty = doc.y + 2;
  }
  if (heading) {
    doc.font(F.bold).fontSize(14).fillColor(INK).text(heading, CONTENT_LEFT + pad, ty, { width: w });
    ty = doc.y + 5;
  }
  paras.forEach(p => {
    doc.font(F.sans).fontSize(10).fillColor(INK_2).text(p, CONTENT_LEFT + pad, ty, { width: w, lineGap: 3 });
    ty = doc.y + 6;
  });
  doc.y = y0 + h + 14;
  doc.x = CONTENT_LEFT;
}

// The own-page opener for an output: label, heading.
function drawOutputHead(doc, H, lab, heading) {
  H.label(lab);
  H.h2(heading);
  doc.moveDown(0.3);
}

// ── Feedback helpers: parse the guide + cadence the same way the UI does ──
const FB_HEADINGS = [
  "Before the conversation",
  "Tone and approach",
  "How much direction to give",
  "What to listen for",
  "Suggested opening",
];
function parseGuide(content) {
  if (!content) return [];
  const isHeading = (s) => FB_HEADINGS.some(h => s.trim().toLowerCase() === h.toLowerCase());
  const blocks = String(content).split("===SECTION===").map(s => s.trim()).filter(Boolean);
  const sections = [];
  for (let i = 0; i < blocks.length; i++) {
    if (isHeading(blocks[i])) {
      const heading = FB_HEADINGS.find(h => h.toLowerCase() === blocks[i].toLowerCase());
      const next = blocks[i + 1];
      if (next && !isHeading(next)) { sections.push({ heading, body: next }); i++; }
      else sections.push({ heading, body: "" });
    } else {
      sections.push({ heading: "", body: blocks[i] });
    }
  }
  return sections;
}
function parseCadence(content) {
  if (!content) return { prose: "", pills: [] };
  const pills = [];
  const re = /\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(content)) !== null) pills.push(m[1]);
  const prose = String(content).replace(re, "").replace(/\s+/g, " ").trim();
  return { prose, pills };
}
const SLIDER_LABELS = ["Very low", "Low", "Medium", "High", "Very high"];
function sliderLabel(v) { return SLIDER_LABELS[Number(v) - 1] || String(v || ""); }

// The feedback cadence: accent-soft panel, prose, then the pills as white chips with a
// hairline. Pill rows are measured, not guessed.
function drawCadencePills(doc, cad) {
  const pad = 16;
  const w = CONTENT_WIDTH - pad * 2;
  const chipH = 18, chipGap = 6, rowGap = 6;
  // lay out the chips first so the panel height is exact
  doc.font(F.bold).fontSize(8.5);
  const chips = [];
  let cx = 0, row = 0;
  cad.pills.forEach(p => {
    const cw = Math.min(w, doc.widthOfString(p) + 22);
    if (cx > 0 && cx + cw > w) { cx = 0; row += 1; }
    chips.push({ p, x: cx, row, w: cw });
    cx += cw + chipGap;
  });
  const rows = cad.pills.length ? row + 1 : 0;
  let h = pad;
  doc.font(F.bold).fontSize(9);
  h += doc.heightOfString("Suggested feedback cadence", { width: w }) + 4;
  doc.font(F.sans).fontSize(10);
  if (cad.prose) h += doc.heightOfString(cad.prose, { width: w, lineGap: 3 }) + 8;
  if (rows) h += rows * chipH + (rows - 1) * rowGap;
  h += pad;
  if (doc.y + h > PAGE_BOTTOM + 10) doc.addPage();
  const y0 = doc.y;
  doc.save();
  doc.roundedRect(CONTENT_LEFT, y0, CONTENT_WIDTH, h, 8).fillColor(ACCENT_SOFT).fill();
  doc.restore();
  let ty = y0 + pad;
  doc.font(F.bold).fontSize(9).fillColor(INK)
    .text("Suggested feedback cadence", CONTENT_LEFT + pad, ty, { width: w });
  ty = doc.y + 4;
  if (cad.prose) {
    doc.font(F.sans).fontSize(10).fillColor(INK)
      .text(cad.prose, CONTENT_LEFT + pad, ty, { width: w, lineGap: 3 });
    ty = doc.y + 8;
  }
  chips.forEach(c => {
    const x = CONTENT_LEFT + pad + c.x;
    const y = ty + c.row * (chipH + rowGap);
    doc.roundedRect(x, y, c.w, chipH, 9).fillColor("#FFFFFF").fill();
    doc.roundedRect(x, y, c.w, chipH, 9).lineWidth(0.6).strokeColor(RULE).stroke();
    doc.font(F.bold).fontSize(8.5).fillColor(INK)
      .text(c.p, x + 11, y + 4.5, { lineBreak: false });
  });
  doc.y = y0 + h + 14;
  doc.x = CONTENT_LEFT;
}

// The feedback is a letter: a salutation, paragraphs, an optional list of
// suggestions, a sign-off. Since 19 September there are no headings in it.
// The beats it is written in are the writer's scaffold and never reach the
// page. Asterisk lines are set as bullets. Set as the letter (Fraunces).
function drawFeedbackBody(doc, H, text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  let para = [];
  let afterList = false;
  const flush = () => {
    if (!para.length) return;
    // a list closes with the same gap a paragraph does
    if (afterList) { doc.moveDown(0.4); afterList = false; }
    H.body(para.join("\n"), { spoken: true, headings: false });
    para = [];
  };
  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) { flush(); return; }
    const m = line.match(/^[*\-•]\s+(.*)$/);
    if (m) {
      flush();
      H.ensureSpace(22);
      const y = doc.y;
      doc.font(F.spoken).fontSize(11).fillColor(INK).text("•", CONTENT_LEFT + 4, y, { lineBreak: false });
      doc.font(F.spoken).fontSize(11).fillColor(INK)
        .text(m[1], CONTENT_LEFT + 18, y, { width: CONTENT_WIDTH - 18, lineGap: 4 });
      doc.moveDown(0.35);
      afterList = true;
      return;
    }
    para.push(line);
  });
  flush();
}

// ── Render the Feedback report ───────────────────────────────────
// Two readers, two documents. "recipient" is the clean copy the person gets:
// the feedback and nothing else. Anything else is the manager's pack: notes,
// cadence, the feedback, and the conversation guide.
function renderFeedback(doc, data) {
  const H = makeHelpers(doc);
  const { inputText = "", tone = "", skill, confidence, output = "", guide = "", cadence = "", managerName = "", recipientName = "", variant = "manager" } = data;
  const manager = titleCase(managerName);
  const recipient = titleCase(recipientName);
  const title = recipient ? `Feedback for ${recipient}` : "Development feedback";

  if (variant === "recipient") {
    drawCover(doc, H, "Development feedback", title, manager ? `From ${manager}.` : "");
    drawFeedbackBody(doc, H, output);
    return;
  }

  drawCover(doc, H, "Manager's pack", title,
    manager ? `Prepared by ${manager}.` : "",
    "For you, not for sharing. Your notes, the cadence and the conversation guide are in here.");

  drawInputs(doc, H, [
    ["Your notes", inputText],
    ["Feedback style", tone],
    ["Their skill", sliderLabel(skill)],
    ["Their confidence", sliderLabel(confidence)],
  ]);

  const cad = parseCadence(cadence);
  if (cad.prose || cad.pills.length) drawCadencePills(doc, cad);

  // The feedback message, own page. The recipient's copy is the separate download.
  doc.addPage();
  drawOutputHead(doc, H, recipient ? `To share with ${recipient}` : "To share", title);
  drawFeedbackBody(doc, H, output);

  // The conversation guide, own page (manager only), in sans
  const sections = parseGuide(guide);
  if (sections.length) {
    doc.addPage();
    drawOutputHead(doc, H, "Manager only", "How to have this conversation");
    sections.forEach(sec => {
      if (sec.heading) { doc.moveDown(0.2); H.h3(sec.heading); }
      if (sec.body) H.body(sec.body);
    });
  }
}

// ── Render the Meeting report (two-stage: prep always, close if present) ──
// Display names for the select values the app sends (as on screen).
const MEETING_TYPE_LABELS = { team: "Team meeting", kickoff: "Project kick-off", problemsolving: "Problem-solving" };
const GROUP_EXPERIENCE_LABELS = { new: "New", developing: "Developing", experienced: "Experienced" };
const FREQUENCY_LABELS = { "one-off": "One-off", weekly: "Weekly", fortnightly: "Fortnightly", monthly: "Monthly" };
const shown = (map, v) => (v && map[v]) || v;

function renderMeeting(doc, data) {
  const H = makeHelpers(doc);
  const { prepForm = {}, prepResult = {}, closeResult = null } = data;
  const manager = titleCase(prepResult.managerName || prepForm.managerName || "");
  const type = shown(MEETING_TYPE_LABELS, prepResult.meetingType);

  drawCover(doc, H, "Meeting guide", prepResult.meetingTitle || prepForm.meetingTitle || "Meeting guide",
    `Prepared for ${manager}.${type ? ` ${type}.` : ""}`);

  drawInputs(doc, H, [
    ["Meeting", prepForm.meetingTitle],
    ["Type", shown(MEETING_TYPE_LABELS, prepForm.meetingType)],
    ["Desired outcome", prepForm.desiredOutcome],
    ["Attendees", prepForm.attendees],
    ["Duration", prepForm.duration],
    ["Group experience", shown(GROUP_EXPERIENCE_LABELS, prepForm.groupExperience)],
    ["Frequency", shown(FREQUENCY_LABELS, prepForm.frequency)],
  ]);

  if (prepResult.facilitatorNote) {
    drawPanel(doc, H, { fill: SUNK, label: "Facilitator note", heading: "Before you walk in", text: prepResult.facilitatorNote });
  }
  if (prepResult.facilitationMode) {
    drawPanel(doc, H, {
      fill: ACCENT_SOFT, label: "Facilitation mode", heading: prepResult.facilitationMode.mode,
      text: [
        prepResult.facilitationMode.summary,
        prepResult.cadence ? `Cadence: ${prepResult.cadence.recommendation}` : "",
      ].filter(Boolean).join("\n\n"),
    });
  }

  // The agenda, own page (share in advance), set as the letter
  doc.addPage();
  drawOutputHead(doc, H, "Share in advance", "Meeting agenda");
  H.body(prepResult.agenda, { spoken: true });

  // The facilitation guide, own page (manager only)
  doc.addPage();
  drawOutputHead(doc, H, "Manager only", "Facilitation guide");
  H.body(prepResult.guide);

  // Close section (only if the meeting has been closed)
  if (closeResult && (closeResult.actions || closeResult.followup || closeResult.review)) {
    doc.addPage();
    drawOutputHead(doc, H, "After the meeting: share with everyone", "Actions summary");
    H.body(closeResult.actions, { spoken: true });

    if (closeResult.followup) {
      doc.addPage();
      drawOutputHead(doc, H, "Send to the group", "Follow-up note");
      H.body(closeResult.followup, { spoken: true });
    }

    if (closeResult.review) {
      doc.addPage();
      drawOutputHead(doc, H, "Manager only", "Process review");
      H.body(closeResult.review);
    }
  }
}

// ── Render the Coach report ──────────────────────────────────────
function renderCoach(doc, data) {
  const H = makeHelpers(doc);
  const { form = {}, result = {} } = data;
  const manager = titleCase(result.managerName || form.managerName || "");
  const person = titleCase(result.personName || form.personName || "");

  drawCover(doc, H, "Coaching guide", result.coachingTopic || form.coachingTopic || "Coaching guide",
    `Prepared for ${manager}${person ? `. Coaching ${person}.` : ""}`);

  drawInputs(doc, H, [
    ["Topic", form.coachingTopic],
    ["Their role", form.personRole],
    ["Context", form.context],
    ["Coaching goal", form.coachingGoal],
    ["Their skill", form.skillLevel],
    ["Their confidence", form.confidenceLevel],
  ]);

  if (result.challengeZone) {
    drawPanel(doc, H, {
      fill: SUNK, label: "Coaching situation", heading: result.challengeZone.zone,
      text: [result.challengeZone.summary, result.challengeZone.managerGuidance].filter(Boolean).join("\n\n"),
    });
  }

  drawCadenceCard(doc, result.cadence);

  if (result.approach) {
    H.ensureSpace(80);
    H.label("Manager only");
    H.h2("Coaching approach");
    H.body(result.approach);
  }

  // The GROW conversation guide, own page, manager only
  doc.addPage();
  drawOutputHead(doc, H, "Manager only: your conversation guide", "GROW conversation guide");
  H.body(result.guide);

  // The development summary (with intentional blanks), own page, set as the letter
  doc.addPage();
  H.label(person ? `To share with ${person} after the session` : "To share after the session");
  H.h2(person ? `Development summary for ${person}` : "Development summary");
  doc.font(F.sans).fontSize(9.5).fillColor(MUTED)
    .text("Complete the bracketed fields after your conversation.", CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.9);
  H.body(result.summary, { spoken: true });
}

// ── Render the Goal report ───────────────────────────────────────
function renderGoal(doc, data) {
  const H = makeHelpers(doc);
  const { form = {}, result = {} } = data;
  const manager = titleCase(result.managerName || form.managerName || "");
  const person = titleCase(result.personName || form.personName || "");

  drawCover(doc, H, "Goal-setting guide", result.goalTitle || form.goalTitle || "Goal-setting guide",
    `Prepared for ${manager}${person ? `. Goal for ${person}.` : ""}`);

  drawInputs(doc, H, [
    ["Goal", form.goalTitle],
    ["Description", form.goalDescription],
    ["Success criteria", form.successCriteria],
    ["Deadline", form.deadline],
    ["Timeframe", form.goalTimeframe],
    ["Stretch level", form.stretchLevel],
    ["Their skill", form.skillLevel],
    ["Their confidence", form.confidenceLevel],
  ]);

  // Goal type + coaching mode
  H.ensureSpace(60);
  H.label("Recommended approach");
  doc.font(F.bold).fontSize(17).fillColor(INK)
    .text(goalTypeLabel(result.goalType), CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.2);
  doc.font(F.sans).fontSize(10).fillColor(MUTED)
    .text(`Coaching mode: ${result.coachingMode || ""}`, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(1.1);

  if (result.challengeZone) {
    drawPanel(doc, H, {
      fill: SUNK, label: "Challenge zone", heading: result.challengeZone.zone,
      text: [result.challengeZone.summary, result.challengeZone.managerGuidance].filter(Boolean).join("\n\n"),
    });
  }

  drawCadenceCard(doc, result.cadence);

  // Output one: advice, manager only, in sans
  H.ensureSpace(80);
  H.label("Manager only");
  H.h2("Goal-setting advice");
  H.body(result.advice);

  // Output two: the brief, own page, set as the letter
  doc.addPage();
  drawOutputHead(doc, H, person ? `Share with ${person}` : "Share with the person", person ? `Goal brief for ${person}` : "Goal brief");
  H.body(result.brief, { spoken: true });

  // Output three: the working template, own page, set as the letter
  if (result.goalTemplate) {
    doc.addPage();
    drawOutputHead(doc, H, "Working document", "Goal template");
    H.body(result.goalTemplate, { spoken: true });
  }
}
function goalTypeLabel(t) {
  const map = { SMART: "SMART Goal", Descriptive: "Descriptive Goal", NLP: "NLP Outcome" };
  return map[t] || t || "Goal";
}

// level lookups (mirror the app's LEVELS table)
const LEVELS = {
  1: ["Follow precisely", "Do exactly what I say"],
  2: ["Report back", "Look into this, I'll decide"],
  3: ["Decide together", "We'll assess the situation jointly"],
  4: ["Tell me what help you need", "Assess and we'll decide together"],
  5: ["Recommend a course of action", "Give me options, I'll approve"],
  6: ["Decide and wait", "Decide, tell me, wait for go-ahead"],
  7: ["Decide and act unless told no", "Proceed unless I intervene"],
  8: ["Act and report", "Do it, then tell me what happened"],
  9: ["Act independently", "Decide and act, no check-in needed"],
  10: ["Full ownership", "This is your area of responsibility"],
};
function levelLabelFor(l) { return (LEVELS[Number(l)] || ["",""])[0]; }
function levelDescFor(l) { return (LEVELS[Number(l)] || ["",""])[1]; }

// The mark: four stacked bars narrowing to a peak, the peak in accent.
// Drawn from mi-mark.svg's geometry (48 x 48 viewBox).
function drawMark(doc, x, y, size) {
  const s = size / 48;
  const bars = [[19, 6, 10, ACCENT], [14, 16, 20, INK], [9, 26, 30, INK], [4, 36, 40, INK]];
  bars.forEach(([bx, by, bw, c]) => {
    doc.roundedRect(x + bx * s, y + by * s, bw * s, 6 * s, 3 * s).fillColor(c).fill();
  });
}

// ── Stamp the frame on every page (one pass) ─────────────────────
function stamp(doc, tool) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    // the tool colour: a 3px line across the top, nothing more
    doc.rect(0, 0, 595.28, 3).fillColor(tool.tool).fill();
    // header: mark, tool name, suite
    drawMark(doc, CONTENT_LEFT, 22, 16);
    doc.font(F.bold).fontSize(9).fillColor(INK)
      .text(tool.name, CONTENT_LEFT + 22, 25.5, { width: 200, lineBreak: false });
    doc.font(F.sans).fontSize(8.5).fillColor(MUTED)
      .text("Management Ignition", CONTENT_LEFT, 26, { width: CONTENT_WIDTH, align: "right", lineBreak: false });
    doc.moveTo(CONTENT_LEFT, 46).lineTo(CONTENT_RIGHT, 46).lineWidth(0.5).strokeColor(RULE).stroke();
    // footer
    doc.font(F.sans).fontSize(8).fillColor(MUTED)
      .text(`Page ${i - range.start + 1} of ${range.count}`, CONTENT_LEFT, 808, { width: CONTENT_WIDTH, align: "center", lineBreak: false });
    doc.page.margins.bottom = oldBottom;
  }
}

// ── Handler ──────────────────────────────────────────────────────
const RENDERERS = { delegate: renderDelegate, goal: renderGoal, coach: renderCoach, meeting: renderMeeting, feedback: renderFeedback };

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const toolKey = body.tool || "delegate";
  const tool = TOOLS[toolKey] || TOOLS.delegate;
  // An unknown key falls back to delegate, as before.
  const render = RENDERERS[toolKey] || renderDelegate;

  const docTitle =
    (body.result && (body.result.taskTitle || body.result.goalTitle || body.result.coachingTopic)) ||
    (body.prepResult && body.prepResult.meetingTitle) ||
    (body.form && (body.form.taskTitle || body.form.goalTitle || body.form.coachingTopic)) ||
    (body.prepForm && body.prepForm.meetingTitle) ||
    (toolKey === "feedback" ? (body.recipientName ? `Feedback for ${titleCase(body.recipientName)}` : "Development feedback") : "report");

  const doc = new PDFDocument({
    size: PAGE.size,
    margins: { top: 64, bottom: 56, left: 56, right: 56 },
    bufferPages: true,
    info: { Title: `${tool.name}: ${docTitle}`, Author: "Jim Harvey | The Message Business" },
  });
  registerFonts(doc);

  const safeTitle = String(docTitle).replace(/[^\w \-]/g, "").slice(0, 60).trim() || tool.name;
  const filename = `${tool.name} - ${safeTitle}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  doc.pipe(res);

  try {
    // start body below the header furniture
    doc.y = 72;
    render(doc, body);
  } catch (e) {
    // Say so in the log and in the document; never hand over a silently empty file.
    console.error("generate-pdf: render failed:", e && e.stack || e);
    doc.font(F.sans).fontSize(11).fillColor(INK)
      .text("This document could not be fully generated. Please copy your results from the tool.", CONTENT_LEFT, 120, { width: CONTENT_WIDTH });
  }

  stamp(doc, tool);
  doc.end();
};

// allow local sandbox testing without a server
handler._render = { renderDelegate, renderGoal, renderCoach, renderMeeting, renderFeedback, stamp, TOOLS, makeHelpers, drawCadenceCard };
