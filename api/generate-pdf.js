// api/generate-pdf.js
// Shared branded PDF generator for the Management Ignition tools.
// Server-side PDFKit, built-in fonts, accent colour per tool.
// Pattern adapted from OSCI generate-report.js: buffered pages, draw then stamp.

import PDFDocument from "pdfkit";

// ── Per-tool theming ─────────────────────────────────────────────
// One shared navy frame; the accent switches by tool.
const TOOLS = {
  delegate: { name: "Delegate Ignite", accent: "#0D9488", outputs: ["Advice for the delegator", "Briefing note"] },
  goal:     { name: "Goal Ignite",     accent: "#4CAF50" },
  feedback: { name: "Feedback Ignite", accent: "#8B00CC" },
  coach:    { name: "Coach Ignite",    accent: "#FF9800" },
  meeting:  { name: "Meeting Ignite",  accent: "#F44336" },
};

const NAVY = "#0F2A4A";
const INK = "#0F172A";
const MUTED = "#64748B";
const LINE = "#E2E8F0";
const SOFT = "#F8FAFC";

const FONT = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";
const FONT_ITALIC = "Times-Italic";
const FONT_BODY = "Times-Roman";

const PAGE = { size: "A4", margin: 56 };
const CONTENT_LEFT = 56;
const CONTENT_RIGHT = 539; // A4 width 595 - 56
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_LEFT;

// ── Helper set (the house style) ─────────────────────────────────
function makeHelpers(doc, accent) {
  function ensureSpace(h) {
    if (doc.y + h > 770) doc.addPage();
  }
  function eyebrow(text) {
    ensureSpace(24);
    doc.font(FONT_BOLD).fontSize(8.5).fillColor(accent)
      .text(text.toUpperCase(), CONTENT_LEFT, doc.y, { characterSpacing: 1.2, width: CONTENT_WIDTH });
    doc.moveDown(0.2);
  }
  function h1(text) {
    ensureSpace(40);
    doc.font(FONT_BOLD).fontSize(22).fillColor(NAVY)
      .text(text, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
    const y = doc.y + 4;
    doc.moveTo(CONTENT_LEFT, y).lineTo(CONTENT_LEFT + 46, y).lineWidth(2.5).strokeColor(accent).stroke();
    doc.moveDown(0.6);
  }
  function h2(text) {
    ensureSpace(30);
    doc.font(FONT_BOLD).fontSize(13).fillColor(NAVY)
      .text(text, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.35);
  }
  function body(text, opts = {}) {
    if (!text) return;
    const size = opts.size || 10.5;
    const color = opts.color || INK;
    const font = opts.italic ? FONT_ITALIC : FONT_BODY;
    // paragraph by paragraph so page breaks land cleanly.
    // Within a paragraph, preserve single newlines as soft line breaks
    // (the AI puts sub-headings like "The task" on their own line).
    const paras = String(text).split(/\n\s*\n/);
    paras.forEach((para, idx) => {
      const clean = para.replace(/[ \t]+\n/g, "\n").trim();
      if (!clean) return;
      ensureSpace(20);
      doc.font(font).fontSize(size).fillColor(color)
        .text(clean, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH, align: "left", lineGap: 3 });
      if (idx < paras.length - 1) doc.moveDown(0.5);
    });
    doc.moveDown(0.6);
  }
  function label(text) {
    ensureSpace(18);
    doc.font(FONT_BOLD).fontSize(9).fillColor(MUTED)
      .text(text.toUpperCase(), CONTENT_LEFT, doc.y, { characterSpacing: 0.8, width: CONTENT_WIDTH });
    doc.moveDown(0.15);
  }
  // a soft-filled card with a coloured left rule
  function card(drawInner, pad = 14) {
    const startY = doc.y;
    // measure by drawing into a temporary y, but simplest: reserve, draw, then box behind isn't possible
    // so draw box after measuring height via a dry run is overkill; instead draw inner first capturing height
    const innerTop = startY + pad;
    doc.y = innerTop;
    doc.x = CONTENT_LEFT + pad;
    drawInner();
    const innerBottom = doc.y;
    const boxBottom = innerBottom + pad;
    // draw the card behind by re-rendering? PDFKit can't go back easily.
    // Instead draw the frame now around the measured region:
    doc.save();
    doc.roundedRect(CONTENT_LEFT, startY, CONTENT_WIDTH, boxBottom - startY, 6)
      .fillColor(SOFT).fill();
    doc.rect(CONTENT_LEFT, startY, 3, boxBottom - startY).fillColor(accent).fill();
    doc.restore();
    // the fill above covers the text; so we must redraw text on top.
    // (handled by caller pattern below — see note)
    doc.y = boxBottom + 8;
    doc.x = CONTENT_LEFT;
  }
  function rule() {
    ensureSpace(12);
    const y = doc.y + 2;
    doc.moveTo(CONTENT_LEFT, y).lineTo(CONTENT_RIGHT, y).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.moveDown(0.8);
  }
  function levelMeter(level, levelLabel, levelDesc) {
    ensureSpace(70);
    label("Delegation level");
    // number tile on the right
    const tileY = doc.y;
    doc.font(FONT_BOLD).fontSize(20).fillColor(NAVY)
      .text(`${level} — ${levelLabel}`, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH - 50 });
    // tile
    doc.roundedRect(CONTENT_RIGHT - 38, tileY - 2, 38, 38, 6).fillColor(accent).fill();
    doc.font(FONT_BOLD).fontSize(18).fillColor("#FFFFFF")
      .text(String(level), CONTENT_RIGHT - 38, tileY + 7, { width: 38, align: "center" });
    doc.moveDown(0.3);
    // meter bar
    const barY = doc.y + 2;
    const barW = CONTENT_WIDTH;
    doc.roundedRect(CONTENT_LEFT, barY, barW, 6, 3).fillColor(LINE).fill();
    const fillW = Math.max(6, barW * (Number(level) / 10));
    doc.roundedRect(CONTENT_LEFT, barY, fillW, 6, 3).fillColor(accent).fill();
    doc.y = barY + 14;
    if (levelDesc) {
      doc.font(FONT_ITALIC).fontSize(9.5).fillColor(MUTED)
        .text(levelDesc, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
    }
    doc.moveDown(0.9);
  }
  return { eyebrow, h1, h2, body, label, rule, levelMeter, ensureSpace };
}

// ── The cadence block (filled card look, drawn as background then text) ──
function drawCadenceCard(doc, accent, cadence) {
  if (!cadence) return;
  const pad = 14;
  const startY = doc.y;
  // pre-measure height with a hidden text height calc
  doc.font(FONT_BOLD).fontSize(13);
  let h = pad + 16; // freq line
  doc.font(FONT_BODY).fontSize(10.5);
  const formatText = `Format: ${cadence.format || ""}`;
  h += doc.heightOfString(formatText, { width: CONTENT_WIDTH - pad * 2, lineGap: 3 }) + 8;
  doc.font(FONT_ITALIC).fontSize(9.5);
  h += doc.heightOfString(cadence.rationale || "", { width: CONTENT_WIDTH - pad * 2, lineGap: 3 }) + pad + 14;

  if (startY + h > 780) { doc.addPage(); }
  const y0 = doc.y;
  // background card + accent rule
  doc.save();
  doc.roundedRect(CONTENT_LEFT, y0, CONTENT_WIDTH, h, 6).fillColor("#F0FDFA").fill();
  doc.rect(CONTENT_LEFT, y0, 3, h).fillColor(accent).fill();
  doc.restore();
  // text on top
  let ty = y0 + pad;
  doc.font(FONT_BOLD).fontSize(8.5).fillColor(accent)
    .text("RECOMMENDED CADENCE", CONTENT_LEFT + pad, ty, { characterSpacing: 1.1, width: CONTENT_WIDTH - pad * 2 });
  ty = doc.y + 1;
  doc.font(FONT_BOLD).fontSize(13).fillColor(NAVY)
    .text(cadence.frequency || "", CONTENT_LEFT + pad, ty, { width: CONTENT_WIDTH - pad * 2 });
  ty = doc.y + 4;
  doc.font(FONT_BOLD).fontSize(10.5).fillColor(INK).text("Format: ", CONTENT_LEFT + pad, ty, { continued: true });
  doc.font(FONT_BODY).fontSize(10.5).fillColor(INK).text(cadence.format || "", { width: CONTENT_WIDTH - pad * 2, lineGap: 3 });
  ty = doc.y + 4;
  doc.font(FONT_ITALIC).fontSize(9.5).fillColor(MUTED)
    .text(cadence.rationale || "", CONTENT_LEFT + pad, ty, { width: CONTENT_WIDTH - pad * 2, lineGap: 3 });
  doc.y = y0 + h + 8;
  doc.x = CONTENT_LEFT;
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

// ── Render the Feedback report ───────────────────────────────────
function renderFeedback(doc, data, accent) {
  const H = makeHelpers(doc, accent);
  const { inputText = "", tone = "", skill, confidence, output = "", guide = "", cadence = "" } = data;

  H.eyebrow("Feedback Ignite · Development feedback");
  H.h1("Development feedback");
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  doc.font(FONT_BODY).fontSize(9.5).fillColor(MUTED).text(today, CONTENT_LEFT, doc.y);
  doc.moveDown(1);
  H.rule();

  // Inputs
  H.h2("What you told us");
  if (inputText) {
    doc.font(FONT_BOLD).fontSize(9.5).fillColor(NAVY).text("Your notes:", CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.15);
    H.body(inputText);
  }
  const meta = [
    ["Feedback style", tone],
    ["Their skill", sliderLabel(skill)],
    ["Their confidence", sliderLabel(confidence)],
  ];
  meta.forEach(([k, v]) => {
    if (!v) return;
    H.ensureSpace(16);
    doc.font(FONT_BOLD).fontSize(9.5).fillColor(NAVY).text(`${k}:  `, CONTENT_LEFT, doc.y, { continued: true });
    doc.font(FONT_BODY).fontSize(10).fillColor(INK).text(String(v), { width: CONTENT_WIDTH, lineGap: 2 });
    doc.moveDown(0.25);
  });
  doc.moveDown(0.5);

  // Cadence card (prose + pills)
  const cad = parseCadence(cadence);
  if (cad.prose || cad.pills.length) {
    drawCadencePills(doc, accent, cad);
    doc.moveDown(0.4);
  }

  // The feedback message — own page (the thing to share)
  doc.addPage();
  H.eyebrow("Your feedback, reframed");
  H.h2("Feedback message");
  H.body(output);

  // The conversation guide — own page (manager only)
  const sections = parseGuide(guide);
  if (sections.length) {
    doc.addPage();
    H.eyebrow("Manager only");
    H.h2("How to have this conversation");
    sections.forEach(sec => {
      if (sec.heading) {
        H.ensureSpace(26);
        doc.font(FONT_BOLD).fontSize(11.5).fillColor(accent)
          .text(sec.heading, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
        doc.moveDown(0.2);
      }
      if (sec.body) H.body(sec.body);
    });
  }
}

// cadence card: soft fill, prose, then pill chips
function drawCadencePills(doc, accent, cad) {
  const pad = 14;
  // pre-measure
  doc.font(FONT_BODY).fontSize(10.5);
  let h = pad + 16; // eyebrow
  if (cad.prose) h += doc.heightOfString(cad.prose, { width: CONTENT_WIDTH - pad * 2, lineGap: 3 }) + 8;
  if (cad.pills.length) h += 26; // one row of pills (approx)
  h += pad;
  if (doc.y + h > 780) doc.addPage();
  const y0 = doc.y;
  doc.save();
  doc.roundedRect(CONTENT_LEFT, y0, CONTENT_WIDTH, h, 6).fillColor("#FAF5FF").fill();
  doc.rect(CONTENT_LEFT, y0, 3, h).fillColor(accent).fill();
  doc.restore();
  let ty = y0 + pad;
  doc.font(FONT_BOLD).fontSize(8.5).fillColor(accent)
    .text("SUGGESTED FEEDBACK CADENCE", CONTENT_LEFT + pad, ty, { characterSpacing: 1.1, width: CONTENT_WIDTH - pad * 2 });
  ty = doc.y + 4;
  if (cad.prose) {
    doc.font(FONT_BODY).fontSize(10.5).fillColor(INK)
      .text(cad.prose, CONTENT_LEFT + pad, ty, { width: CONTENT_WIDTH - pad * 2, lineGap: 3 });
    ty = doc.y + 6;
  }
  // pills as inline chips
  let cx = CONTENT_LEFT + pad;
  const chipH = 16;
  cad.pills.forEach(p => {
    doc.font(FONT_BOLD).fontSize(8.5);
    const w = doc.widthOfString(p) + 16;
    if (cx + w > CONTENT_RIGHT - pad) { cx = CONTENT_LEFT + pad; ty += chipH + 5; }
    doc.roundedRect(cx, ty, w, chipH, 8).fillColor("#FFFFFF").fill();
    doc.roundedRect(cx, ty, w, chipH, 8).lineWidth(0.6).strokeColor(accent).stroke();
    doc.fillColor(accent).text(p, cx + 8, ty + 4, { lineBreak: false });
    cx += w + 6;
  });
  doc.y = y0 + h + 8;
  doc.x = CONTENT_LEFT;
}

// ── Render the Meeting report (two-stage: prep always, close if present) ──
function renderMeeting(doc, data, accent) {
  const H = makeHelpers(doc, accent);
  const { prepForm = {}, prepResult = {}, closeResult = null } = data;
  const manager = prepResult.managerName || prepForm.managerName || "";

  H.eyebrow("Meeting Ignite · Meeting guide");
  H.h1(prepResult.meetingTitle || prepForm.meetingTitle || "Meeting guide");
  doc.font(FONT_BODY).fontSize(10.5).fillColor(MUTED)
    .text(`Prepared for ${titleCase(manager)}${prepResult.meetingType ? ` · ${prepResult.meetingType}` : ""}`, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  doc.font(FONT_BODY).fontSize(9.5).fillColor(MUTED).text(today, CONTENT_LEFT, doc.y);
  doc.moveDown(1);
  H.rule();

  // Inputs
  H.h2("What you told us");
  const inputs = [
    ["Meeting", prepForm.meetingTitle],
    ["Type", prepForm.meetingType],
    ["Desired outcome", prepForm.desiredOutcome],
    ["Attendees", prepForm.attendees],
    ["Duration", prepForm.duration],
    ["Group experience", prepForm.groupExperience],
    ["Frequency", prepForm.frequency],
  ];
  inputs.forEach(([k, v]) => {
    if (!v) return;
    H.ensureSpace(16);
    doc.font(FONT_BOLD).fontSize(9.5).fillColor(NAVY).text(`${k}:  `, CONTENT_LEFT, doc.y, { continued: true });
    doc.font(FONT_BODY).fontSize(10).fillColor(INK).text(String(v), { width: CONTENT_WIDTH, lineGap: 2 });
    doc.moveDown(0.25);
  });
  doc.moveDown(0.5);
  H.rule();

  // Facilitator note (the quote)
  if (prepResult.facilitatorNote) {
    drawInfoCard(doc, accent, "FACILITATOR NOTE", "Before you walk in", prepResult.facilitatorNote);
    doc.moveDown(0.3);
  }

  // Facilitation mode + cadence as a compact info card
  if (prepResult.facilitationMode) {
    drawInfoCard(doc, accent, "FACILITATION MODE", prepResult.facilitationMode.mode, [
      prepResult.facilitationMode.summary,
      prepResult.cadence ? `Cadence: ${prepResult.cadence.recommendation}` : "",
    ].filter(Boolean).join("\n\n"));
    doc.moveDown(0.4);
  }

  // The agenda — own page (share in advance)
  doc.addPage();
  H.eyebrow("Share in advance");
  H.h2("Meeting agenda");
  H.body(prepResult.agenda);

  // The facilitation guide — own page (manager only)
  doc.addPage();
  H.eyebrow("Manager only");
  H.h2("Facilitation guide");
  H.body(prepResult.guide);

  // ── Close section (only if the meeting has been closed) ──
  if (closeResult && (closeResult.actions || closeResult.followup || closeResult.review)) {
    doc.addPage();
    H.eyebrow("After the meeting · Share with everyone");
    H.h2("Actions summary");
    H.body(closeResult.actions);

    if (closeResult.followup) {
      doc.moveDown(0.2);
      H.eyebrow("Send to the group");
      H.h2("Follow-up note");
      H.body(closeResult.followup);
    }

    if (closeResult.review) {
      doc.addPage();
      H.eyebrow("Manager only");
      H.h2("Process review");
      H.body(closeResult.review);
    }
  }
}

// ── Render the Coach report ──────────────────────────────────────
function renderCoach(doc, data, accent) {
  const H = makeHelpers(doc, accent);
  const { form = {}, result = {} } = data;
  const manager = result.managerName || form.managerName || "";
  const person = result.personName || form.personName || "";

  H.eyebrow("Coach Ignite · Coaching guide");
  H.h1(result.coachingTopic || form.coachingTopic || "Coaching guide");
  doc.font(FONT_BODY).fontSize(10.5).fillColor(MUTED)
    .text(`Prepared for ${titleCase(manager)}${person ? ` · Coaching ${titleCase(person)}` : ""}`, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  doc.font(FONT_BODY).fontSize(9.5).fillColor(MUTED).text(today, CONTENT_LEFT, doc.y);
  doc.moveDown(1);
  H.rule();

  // Inputs
  H.h2("What you told us");
  const inputs = [
    ["Topic", form.coachingTopic],
    ["Their role", form.personRole],
    ["Context", form.context],
    ["Coaching goal", form.coachingGoal],
    ["Their skill", form.skillLevel],
    ["Their confidence", form.confidenceLevel],
  ];
  inputs.forEach(([k, v]) => {
    if (!v) return;
    H.ensureSpace(16);
    doc.font(FONT_BOLD).fontSize(9.5).fillColor(NAVY).text(`${k}:  `, CONTENT_LEFT, doc.y, { continued: true });
    doc.font(FONT_BODY).fontSize(10).fillColor(INK).text(String(v), { width: CONTENT_WIDTH, lineGap: 2 });
    doc.moveDown(0.25);
  });
  doc.moveDown(0.5);
  H.rule();

  // Challenge zone card
  if (result.challengeZone) {
    drawInfoCard(doc, accent, "COACHING SITUATION", result.challengeZone.zone, [
      result.challengeZone.summary,
      result.challengeZone.managerGuidance,
    ].filter(Boolean).join("\n\n"));
    doc.moveDown(0.3);
  }

  // Cadence card
  drawCadenceCard(doc, accent, result.cadence);
  doc.moveDown(0.4);

  // Coaching approach (if present)
  if (result.approach) {
    H.eyebrow("Manager only");
    H.h2("Coaching approach");
    H.body(result.approach);
  }

  // The GROW conversation guide — own page
  doc.addPage();
  H.eyebrow("Manager only · Your conversation guide");
  H.h2("GROW conversation guide");
  H.body(result.guide);

  // The development summary (with intentional blanks) — own page
  doc.addPage();
  H.eyebrow(person ? `To share with ${person} after the session` : "To share after the session");
  H.h2(person ? `Development summary for ${person}` : "Development summary");
  doc.font(FONT_ITALIC).fontSize(9.5).fillColor(MUTED)
    .text("Complete the bracketed fields after your conversation.", CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.6);
  H.body(result.summary);
}

// ── Render the Goal report ───────────────────────────────────────
function renderGoal(doc, data, accent) {
  const H = makeHelpers(doc, accent);
  const { form = {}, result = {} } = data;
  const manager = result.managerName || form.managerName || "";
  const person = result.personName || form.personName || "";

  H.eyebrow("Goal Ignite · Goal-setting guide");
  H.h1(result.goalTitle || form.goalTitle || "Goal-setting guide");
  doc.font(FONT_BODY).fontSize(10.5).fillColor(MUTED)
    .text(`Prepared for ${titleCase(manager)}${person ? ` · For ${titleCase(person)}` : ""}`, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  doc.font(FONT_BODY).fontSize(9.5).fillColor(MUTED).text(today, CONTENT_LEFT, doc.y);
  doc.moveDown(1);
  H.rule();

  // Inputs
  H.h2("What you told us");
  const inputs = [
    ["Goal", form.goalTitle],
    ["Description", form.goalDescription],
    ["Success criteria", form.successCriteria],
    ["Deadline", form.deadline],
    ["Timeframe", form.goalTimeframe],
    ["Stretch level", form.stretchLevel],
    ["Their skill", form.skillLevel],
    ["Their confidence", form.confidenceLevel],
  ];
  inputs.forEach(([k, v]) => {
    if (!v) return;
    H.ensureSpace(16);
    doc.font(FONT_BOLD).fontSize(9.5).fillColor(NAVY).text(`${k}:  `, CONTENT_LEFT, doc.y, { continued: true });
    doc.font(FONT_BODY).fontSize(10).fillColor(INK).text(String(v), { width: CONTENT_WIDTH, lineGap: 2 });
    doc.moveDown(0.25);
  });
  doc.moveDown(0.5);
  H.rule();

  // Goal type + coaching mode
  H.label("Recommended approach");
  doc.font(FONT_BOLD).fontSize(15).fillColor(NAVY)
    .text(`${goalTypeLabel(result.goalType)}`, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.2);
  doc.font(FONT_BODY).fontSize(10).fillColor(MUTED)
    .text(`Coaching mode: ${result.coachingMode || ""}`, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.7);

  // Challenge zone card
  if (result.challengeZone) {
    drawInfoCard(doc, accent, "CHALLENGE ZONE", result.challengeZone.zone, [
      result.challengeZone.summary,
      result.challengeZone.managerGuidance,
    ].filter(Boolean).join("\n\n"));
    doc.moveDown(0.3);
  }

  // Cadence card
  drawCadenceCard(doc, accent, result.cadence);
  doc.moveDown(0.4);

  // Output one: advice
  H.eyebrow("Manager only");
  H.h2("Goal-setting advice");
  H.body(result.advice);

  // Output two: the brief — own page
  doc.addPage();
  H.eyebrow(person ? `Share with ${person}` : "Share with the person");
  H.h2(person ? `Goal brief for ${person}` : "Goal brief");
  H.body(result.brief);

  // Output three: the working template — own page
  if (result.goalTemplate) {
    doc.addPage();
    H.eyebrow("Working document");
    H.h2("Goal template");
    H.body(result.goalTemplate);
  }
}
function goalTypeLabel(t) {
  const map = { SMART: "SMART Goal", Descriptive: "Descriptive Goal", NLP: "NLP Outcome" };
  return map[t] || t || "Goal";
}
function titleCase(s) {
  return String(s || "").replace(/\b\w/g, c => c.toUpperCase());
}

// a soft info card (used for challenge zone) — bg drawn first, then text
function drawInfoCard(doc, accent, eyebrowText, headingText, bodyText) {
  const pad = 14;
  doc.font(FONT_BODY).fontSize(10);
  let h = pad + 14 + 16; // eyebrow + heading
  const paras = String(bodyText).split(/\n\s*\n/);
  paras.forEach(p => { h += doc.heightOfString(p.trim(), { width: CONTENT_WIDTH - pad * 2, lineGap: 3 }) + 6; });
  h += pad;
  if (doc.y + h > 780) doc.addPage();
  const y0 = doc.y;
  doc.save();
  doc.roundedRect(CONTENT_LEFT, y0, CONTENT_WIDTH, h, 6).fillColor(SOFT).fill();
  doc.rect(CONTENT_LEFT, y0, 3, h).fillColor(accent).fill();
  doc.restore();
  let ty = y0 + pad;
  doc.font(FONT_BOLD).fontSize(8.5).fillColor(accent)
    .text(eyebrowText, CONTENT_LEFT + pad, ty, { characterSpacing: 1.1, width: CONTENT_WIDTH - pad * 2 });
  ty = doc.y + 1;
  doc.font(FONT_BOLD).fontSize(13).fillColor(NAVY)
    .text(headingText, CONTENT_LEFT + pad, ty, { width: CONTENT_WIDTH - pad * 2 });
  ty = doc.y + 4;
  paras.forEach((p, i) => {
    doc.font(FONT_BODY).fontSize(10).fillColor(INK)
      .text(p.trim(), CONTENT_LEFT + pad, ty, { width: CONTENT_WIDTH - pad * 2, lineGap: 3 });
    ty = doc.y + 6;
  });
  doc.y = y0 + h + 8;
  doc.x = CONTENT_LEFT;
}

// ── Render the Delegate report ───────────────────────────────────
function renderDelegate(doc, data, accent) {
  const H = makeHelpers(doc, accent);
  const { form = {}, result = {} } = data;
  const manager = result.managerName || form.managerName || "";
  const delegatee = result.delegateeName || form.delegateeName || "";

  // Cover block
  H.eyebrow("Delegate Ignite · Delegation guide");
  H.h1(result.taskTitle || form.taskTitle || "Delegation guide");
  doc.font(FONT_BODY).fontSize(10.5).fillColor(MUTED)
    .text(`Prepared for ${manager}${delegatee ? ` · Delegating to ${delegatee}` : ""}`, CONTENT_LEFT, doc.y, { width: CONTENT_WIDTH });
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  doc.font(FONT_BODY).fontSize(9.5).fillColor(MUTED).text(today, CONTENT_LEFT, doc.y);
  doc.moveDown(1);
  H.rule();

  // The inputs
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
  inputs.forEach(([k, v]) => {
    if (!v) return;
    H.ensureSpace(16);
    doc.font(FONT_BOLD).fontSize(9.5).fillColor(NAVY).text(`${k}:  `, CONTENT_LEFT, doc.y, { continued: true });
    doc.font(FONT_BODY).fontSize(10).fillColor(INK).text(String(v), { width: CONTENT_WIDTH, lineGap: 2 });
    doc.moveDown(0.25);
  });
  doc.moveDown(0.5);
  H.rule();

  // Level meter
  const lvl = result.delegationLevel || "5";
  H.levelMeter(lvl, result.levelLabel || levelLabelFor(lvl), result.levelDesc || levelDescFor(lvl));

  // Cadence card
  drawCadenceCard(doc, accent, result.cadence);
  doc.moveDown(0.4);

  // Output one: manager advice
  H.eyebrow("Manager only");
  H.h2("Advice for the delegator");
  H.body(result.delegationAdvice);

  // Output two: briefing note — start on its own page for a clean shareable doc
  doc.addPage();
  H.eyebrow(delegatee ? `Share with ${delegatee}` : "Share with delegatee");
  H.h2(delegatee ? `Briefing note for ${delegatee}` : "Briefing note");
  H.body(result.briefingNote);
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

// ── Stamp header + footer + page numbers on every page (one pass) ─
function stamp(doc, toolName, accent) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    // header rule + label
    doc.font(FONT).fontSize(8).fillColor(MUTED)
      .text(`${toolName} · The Message Business`, 56, 30, { width: CONTENT_WIDTH, align: "right" });
    doc.moveTo(56, 44).lineTo(539, 44).lineWidth(0.5).strokeColor(LINE).stroke();
    // footer
    doc.font(FONT).fontSize(8).fillColor(MUTED)
      .text(`Page ${i - range.start + 1} of ${range.count}`, 56, 808, { width: CONTENT_WIDTH, align: "center" });
    doc.page.margins.bottom = oldBottom;
  }
}

// ── Handler ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const toolKey = (body && body.tool) || "delegate";
  const tool = TOOLS[toolKey] || TOOLS.delegate;

  const docTitle =
    (body.result && (body.result.taskTitle || body.result.goalTitle || body.result.coachingTopic)) ||
    (body.prepResult && body.prepResult.meetingTitle) ||
    (body.form && (body.form.taskTitle || body.form.goalTitle || body.form.coachingTopic)) ||
    (body.prepForm && body.prepForm.meetingTitle) ||
    (toolKey === "feedback" ? "Development feedback" : "report");
  const doc = new PDFDocument({
    size: PAGE.size,
    margins: { top: 56, bottom: 56, left: 56, right: 56 },
    bufferPages: true,
    info: { Title: `${tool.name} — ${docTitle}`, Author: "Jim Harvey | The Message Business" },
  });

  const safeTitle = String(docTitle).replace(/[^\w \-]/g, "").slice(0, 60).trim() || tool.name;
  const filename = `${tool.name} - ${safeTitle}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  doc.pipe(res);

  try {
    // start body below the header furniture
    doc.y = 64;
    if (toolKey === "delegate") renderDelegate(doc, body, tool.accent);
    else if (toolKey === "goal") renderGoal(doc, body, tool.accent);
    else if (toolKey === "coach") renderCoach(doc, body, tool.accent);
    else if (toolKey === "meeting") renderMeeting(doc, body, tool.accent);
    else if (toolKey === "feedback") renderFeedback(doc, body, tool.accent);
    else renderDelegate(doc, body, tool.accent);
  } catch (e) {
    // never block the download on a soft failure
    doc.font(FONT_BODY).fontSize(11).fillColor(INK)
      .text("This document could not be fully generated. Please copy your results from the tool.", 56, 120, { width: CONTENT_WIDTH });
  }

  stamp(doc, tool.name, tool.accent);
  doc.end();
};

