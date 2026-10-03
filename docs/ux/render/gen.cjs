// Generates print-layout sketches (SVG, mm units) and a sample PDF.
// Fictional demo content only ("Nebelland"). Usage: node gen.cjs <outDir> [nodeModulesDir]
const fs = require('fs');
const path = require('path');
const out = process.argv[2] || '.';
const nm = process.argv[3];

const PT = 0.3528; // 1pt in mm
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Rough wrap: Helvetica average glyph width ~0.5em
function wrap(text, widthMm, sizePt, factor = 0.56) {
  const maxChars = Math.floor(widthMm / (sizePt * PT * factor));
  const lines = [];
  let line = '';
  for (const w of text.split(' ')) {
    if ((line + ' ' + w).trim().length > maxChars) { lines.push(line.trim()); line = w; }
    else line += ' ' + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

class Svg {
  constructor() { this.parts = []; }
  rect(x, y, w, h, o = {}) {
    this.parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${o.fill || 'none'}" stroke="${o.stroke || '#000'}" stroke-width="${(o.sw ?? 0.6) * PT}"${o.rx ? ` rx="${o.rx}"` : ''}/>`);
  }
  line(x1, y1, x2, y2, o = {}) {
    this.parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.stroke || '#000'}" stroke-width="${(o.sw ?? 0.5) * PT}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`);
  }
  circle(cx, cy, r, o = {}) {
    this.parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${o.fill || 'none'}" stroke="${o.stroke || '#000'}" stroke-width="${(o.sw ?? 0.6) * PT}"/>`);
  }
  text(x, y, s, sizePt, o = {}) {
    const weight = o.bold ? 'bold' : 'normal';
    const anchor = o.anchor || 'start';
    const ls = o.caps ? ` letter-spacing="${0.06 * sizePt * PT}"` : '';
    this.parts.push(`<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${sizePt * PT}" font-weight="${weight}" fill="${o.fill || '#000'}" text-anchor="${anchor}"${ls}>${esc(o.caps ? s.toUpperCase() : s)}</text>`);
  }
  para(x, y, s, widthMm, sizePt, lead = 1.3, o = {}) {
    const lines = wrap(s, widthMm, sizePt, o.bold ? 0.62 : 0.56);
    lines.forEach((l, i) => this.text(x, y + i * sizePt * PT * lead, l, sizePt, o));
    return y + lines.length * sizePt * PT * lead;
  }
  toString() {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">\n<rect x="0" y="0" width="210" height="297" fill="#fff"/>\n${this.parts.join('\n')}\n</svg>\n`;
  }
}

// ---------- Character sheet (A4 portrait) ----------
function sheet() {
  const s = new Svg();
  const M = 12, W = 186; // margins, content width
  const sectionTitle = (x, y, w, t) => {
    s.rect(x, y, w, 5, { fill: '#EDEDED', stroke: 'none' });
    s.text(x + 2, y + 3.6, t, 8, { bold: true, caps: true });
  };

  // Header
  s.text(M, M + 8, 'Mira Nebelfeld', 22, { bold: true });
  s.text(M, M + 14.5, 'Laternenträgerin · Wegfinderin · Moorvolk · Stufe 3', 11);
  s.text(M + W, M + 4, 'Nebelland (Demo-Regelwerk)', 7.5, { anchor: 'end', fill: '#444' });
  s.text(M + W - 60, M + 12, 'Gespielt von', 7.5, { fill: '#444' });
  s.line(M + W - 60, M + 15, M + W, M + 15, { stroke: '#777', sw: 0.4 });
  s.line(M, M + 18.5, M + W, M + 18.5, { sw: 1 });

  // Big stat boxes
  let y = M + 23;
  const boxes = [
    { label: 'Ausdauer', big: '', sub: 'höchstens 22', write: true },
    { label: 'Schutz', big: '14', sub: 'schwer zu treffen' },
    { label: 'Tempo', big: '9 m', sub: 'pro Zug laufen' },
    { label: 'Glücksmarken', big: null, sub: 'höchstens 3', ticks: 3 },
    { label: 'Mut-Bonus', big: '+2', sub: 'auf Würfe mit Übung' },
  ];
  const bw = (W - 4 * 4) / 5;
  boxes.forEach((b, i) => {
    const x = M + i * (bw + 4);
    s.rect(x, y, bw, 28, { sw: 0.8, rx: 1.5 });
    s.text(x + bw / 2, y + 5, b.label, 8, { bold: true, caps: true, anchor: 'middle' });
    if (b.write) {
      s.rect(x + 5, y + 8, bw - 10, 12, { stroke: '#777', sw: 0.4, rx: 1 });
      s.text(x + bw / 2, y + 15.5, 'Bleistift', 7, { anchor: 'middle', fill: '#999' });
    } else if (b.ticks) {
      for (let t = 0; t < b.ticks; t++) s.circle(x + bw / 2 + (t - 1) * 8, y + 14, 2.8, { sw: 0.7 });
    } else {
      s.text(x + bw / 2, y + 18, b.big, 22, { bold: true, anchor: 'middle' });
    }
    s.text(x + bw / 2, y + 25, b.sub, 7, { anchor: 'middle', fill: '#333' });
  });

  // Left column: base scores
  y += 33;
  const lw = 52;
  sectionTitle(M, y, lw, 'Grundwerte');
  const scores = [['Kraft', '10', '+0'], ['Geschick', '14', '+2'], ['Klugheit', '12', '+1'], ['Herz', '16', '+3']];
  scores.forEach(([n, v, m], i) => {
    const yy = y + 8 + i * 22;
    s.rect(M, yy, lw, 19, { sw: 0.7, rx: 1.5 });
    s.text(M + 3, yy + 5, n, 9, { bold: true });
    s.text(M + 3, yy + 15.5, v, 20, { bold: true });
    s.circle(M + lw - 11, yy + 11, 6.5, { sw: 0.7 });
    s.text(M + lw - 11, yy + 13.2, m, 12, { bold: true, anchor: 'middle' });
    s.text(M + lw - 11, yy + 3.6, 'zum Wurf', 6.5, { anchor: 'middle', fill: '#333' });
  });
  s.para(M, y + 8 + 4 * 22 + 2, 'Die Zahl im Kreis zählst du zu deinem Wurf dazu.', lw, 7.5, 1.3, { fill: '#333' });

  // Right column: skills
  const rx = M + lw + 6, rw = W - lw - 6;
  sectionTitle(rx, y, rw, 'Fertigkeiten');
  s.text(rx + rw, y + 3.6, '● = geübt: zähl +2 extra dazu', 7.5, { anchor: 'end' });
  const skills = [
    ['Klettern', 'Kraft', false], ['Schleichen', 'Geschick', true], ['Spuren lesen', 'Klugheit', true],
    ['Heilen', 'Herz', true], ['Überreden', 'Herz', false], ['Wissen über Nebel', 'Klugheit', false],
    ['Fingerfertigkeit', 'Geschick', false], ['Wache halten', 'Klugheit', true],
  ];
  const colW = rw / 2;
  skills.forEach(([n, base, prof], i) => {
    const cx = rx + (i % 2) * colW, cy = y + 11 + Math.floor(i / 2) * 7.5;
    s.circle(cx + 2.5, cy - 1.2, 1.6, { fill: prof ? '#000' : 'none', sw: 0.6 });
    s.text(cx + 6, cy, n, 9);
    s.text(cx + colW - 12, cy, base, 7.5, { fill: '#444', anchor: 'end' });
    s.rect(cx + colW - 10, cy - 4, 7, 5.5, { sw: 0.5, rx: 0.8 });
  });

  // Tricks overview (right, below skills)
  let ty = y + 11 + 4 * 7.5 + 3;
  sectionTitle(rx, ty, rw, 'Kniffe — Details auf den Karten');
  const tricks = [
    ['Nebelschritt', 'Du tauchst bis 9 m weiter wieder auf.', 1],
    ['Licht der Laterne', 'Heilt 1W8 + 3 Ausdauer bei jemandem neben dir.', 2],
    ['Funkenregen', 'Funken treffen alle in 3 m um einen Punkt.', 1],
    ['Stilles Wort', 'Ein Geräusch in 18 m Umkreis verstummt.', 0],
    ['Weg im Nebel', 'Deine Gruppe verläuft sich nicht.', 0],
  ];
  tricks.forEach(([n, d, uses], i) => {
    const yy = ty + 10 + i * 6.5;
    s.text(rx, yy, n, 9, { bold: true });
    s.text(rx + 34, yy, d, 8);
    if (uses) for (let u = 0; u < uses; u++) s.rect(rx + rw - 5 - u * 5.5, yy - 3.4, 4, 4, { sw: 0.6 });
    else s.text(rx + rw, yy, 'immer', 7.5, { anchor: 'end', fill: '#444' });
    s.line(rx, yy + 2, rx + rw, yy + 2, { stroke: '#BBB', sw: 0.3 });
  });
  s.text(rx + rw, ty + 10 + 5 * 6.5 + 1, '□ = einmal benutzt: ankreuzen. Nach einer Rast wegradieren.', 7, { anchor: 'end', fill: '#333' });

  // Bottom row: equipment, how to play, notes
  y = Math.max(y + 8 + 4 * 22 + 12, ty + 10 + 5 * 6.5 + 6);
  const thirds = (W - 8) / 3;
  sectionTitle(M, y, thirds, 'Ausrüstung');
  ['Laternenstab (1W6)', 'Reiseumhang', 'Seil, {{length:50}}'.replace('{{length:50}}', '15 m'), 'Kräuterbeutel (3)', 'Laternenöl (2)', '12 Silberlinge']
    .forEach((e, i) => { s.text(M + 1, y + 11 + i * 6, e, 9); s.line(M, y + 13 + i * 6, M + thirds, y + 13 + i * 6, { stroke: '#BBB', sw: 0.3 }); });
  for (let i = 6; i < 10; i++) s.line(M, y + 13 + i * 6, M + thirds, y + 13 + i * 6, { stroke: '#999', sw: 0.4 });

  const hx = M + thirds + 4;
  sectionTitle(hx, y, thirds, 'So bist du dran');
  s.rect(hx, y + 6, thirds, 60, { stroke: '#777', sw: 0.4, rx: 1.5 });
  let py = y + 12;
  ['1. Lauf bis zu 9 m.', '2. Tu eine Sache: angreifen, einen Kniff nutzen, helfen oder etwas anderes.', '3. Sag, was dein Charakter sagt. Das kostet nichts.', 'Du weisst nicht weiter? Frag die Spielleitung: "Was kann ich hier tun?"']
    .forEach((t) => { py = s.para(hx + 3, py, t, thirds - 6, 8.5, 1.3) + 1.8; });

  const nx = hx + thirds + 4;
  sectionTitle(nx, y, thirds, 'Notizen');
  for (let i = 0; i < 10; i++) s.line(nx, y + 13 + i * 6, nx + thirds, y + 13 + i * 6, { stroke: '#999', sw: 0.4 });

  // Footer
  s.line(M, 297 - M - 4, M + W, 297 - M - 4, { stroke: '#999', sw: 0.3 });
  s.text(M, 297 - M, 'Mira Nebelfeld · Stufe 3 · Längen in Meter · Seite 1 von 2', 7, { fill: '#444' });
  s.text(M + W, 297 - M, 'Erstellt am 04.10.2026', 7, { fill: '#444', anchor: 'end' });
  return s.toString();
}

// ---------- Cards (63 x 88 mm, 3 x 3 on A4) ----------
function cards() {
  const s = new Svg();
  const CW = 63, CH = 88, X0 = (210 - 3 * CW) / 2, Y0 = (297 - 3 * CH) / 2; // 10.5, 16.5
  const data = [
    { name: 'Nebelschritt', type: 'Kniff · Stufe 1', stats: [['Zeit', '1 Zug'], ['Reichweite', 'du selbst'], ['Dauer', 'sofort'], ['Einsatz', '1× pro Rast']], table: 'Du verschwindest im Nebel und tauchst an einem Ort auf, den du siehst, bis 9 m weiter.', rules: 'Regeltext aus dem Paket steht hier, unverändert, in kleinerer Schrift. Bei langen Texten wird die Schrift bis 7 pt kleiner, danach gibt es eine Fortsetzungs-Karte.', uses: 1 },
    { name: 'Licht der Laterne', type: 'Kniff · Stufe 1', stats: [['Zeit', '1 Zug'], ['Reichweite', 'berühren'], ['Dauer', 'sofort'], ['Einsatz', '2× pro Rast']], table: 'Du hältst die Laterne über jemanden. Er bekommt 1W8 + 3 Ausdauer zurück.', rules: 'Regeltext aus dem Paket. Würfel-Schreibweise und Zahlen kommen aus der Übersetzung.', uses: 2 },
    { name: 'Funkenregen', type: 'Kniff · Stufe 2', stats: [['Zeit', '1 Zug'], ['Reichweite', '18 m'], ['Dauer', 'sofort'], ['Einsatz', '1× pro Rast']], table: 'Funken regnen auf einen Punkt. Alle in 3 m darum herum werden getroffen. Auch Freunde!', rules: 'Regeltext aus dem Paket.', uses: 1 },
    { name: 'Stilles Wort', type: 'Kniff · immer', stats: [['Zeit', '1 Zug'], ['Reichweite', '18 m'], ['Dauer', '1 Minute'], ['Einsatz', 'immer']], table: 'Ein Geräusch verstummt. Eine Tür knarrt nicht, ein Hund bellt nicht.', rules: 'Regeltext aus dem Paket.', uses: 0 },
    { name: 'Weg im Nebel', type: 'Spezialisierung', stats: [['Zeit', '—'], ['Reichweite', 'Gruppe'], ['Dauer', 'immer'], ['Einsatz', 'immer']], table: 'Solange du dabei bist, verläuft sich deine Gruppe nie. Sag es der Spielleitung, wenn ihr reist.', rules: 'Regeltext aus dem Paket.', uses: 0 },
    { name: 'Nebelschritt (2/2)', type: 'Fortsetzung', stats: null, table: null, rules: 'Fortsetzungs-Karte: Wenn der Regeltext auch in 7 pt nicht auf eine Karte passt, geht er hier weiter. Kopf und Name bleiben gleich, damit beide Karten zusammen bleiben.', uses: 0 },
  ];

  // Page header (in top margin, above crop marks)
  s.text(X0, 7, 'Kniff-Karten · Mira Nebelfeld · Seite 2 von 2', 7.5, { fill: '#444' });
  s.text(210 - X0, 7, 'In Originalgrösse (100 %) drucken. An den Linien ausschneiden.', 7.5, { fill: '#444', anchor: 'end' });

  data.forEach((c, i) => {
    const x = X0 + (i % 3) * CW, y = Y0 + Math.floor(i / 3) * CH;
    const P = 4; // inner padding
    s.rect(x, y, CW, CH, { stroke: '#999', sw: 0.3 }); // cut guide for scissors
    s.text(x + P, y + P + 3.8, c.type, 7, { caps: true, fill: '#333' });
    s.text(x + P, y + P + 9.5, c.name, 11, { bold: true });
    s.line(x + P, y + P + 12, x + CW - P, y + P + 12, { sw: 0.6 });
    let yy = y + P + 12;
    if (c.stats) {
      const cw = (CW - 2 * P) / 2;
      c.stats.forEach(([k, v], j) => {
        const sx = x + P + (j % 2) * cw, sy = yy + 4 + Math.floor(j / 2) * 8.5;
        s.text(sx, sy, k, 7, { caps: true, fill: '#333' });
        s.text(sx, sy + 4.2, v, 9, { bold: true });
      });
      yy += 4 + 2 * 8.5;
      s.line(x + P, yy - 1, x + CW - P, yy - 1, { stroke: '#BBB', sw: 0.3 });
    }
    if (c.table) {
      s.text(x + P, yy + 3.5, 'Am Tisch', 7, { caps: true, bold: true });
      yy = s.para(x + P, yy + 7.5, c.table, CW - 2 * P, 8.5, 1.25) + 1;
    }
    s.text(x + P, yy + 3, 'Regeltext', 7, { caps: true, bold: true, fill: '#333' });
    s.para(x + P, yy + 6.5, c.rules, CW - 2 * P, 7.5, 1.25, { fill: '#222' });
    // Footer: uses tracker + owner
    s.line(x + P, y + CH - P - 5, x + CW - P, y + CH - P - 5, { stroke: '#BBB', sw: 0.3 });
    s.text(x + P, y + CH - P - 1, 'Mira · Stufe 3', 7, { fill: '#444' });
    for (let u = 0; u < c.uses; u++) s.rect(x + CW - P - 4 - u * 5.5, y + CH - P - 4, 3.6, 3.6, { sw: 0.6 });
  });

  // Crop marks: outside the grid, 4mm long, 1.5mm gap
  const gap = 1.5, len = 4, rows = Math.ceil(data.length / 3);
  for (let c = 0; c <= 3; c++) {
    const x = X0 + c * CW;
    s.line(x, Y0 - gap - len, x, Y0 - gap, { sw: 0.5 });
    s.line(x, Y0 + rows * CH + gap, x, Y0 + rows * CH + gap + len, { sw: 0.5 });
  }
  for (let r = 0; r <= rows; r++) {
    const y = Y0 + r * CH;
    s.line(X0 - gap - len, y, X0 - gap, y, { sw: 0.5 });
    s.line(X0 + 3 * CW + gap, y, X0 + 3 * CW + gap + len, y, { sw: 0.5 });
  }
  return s.toString();
}

const sheetSvg = sheet(), cardsSvg = cards();
fs.writeFileSync(path.join(out, 'character-sheet-a4.svg'), sheetSvg);
fs.writeFileSync(path.join(out, 'cards-a4.svg'), cardsSvg);

if (nm) {
  const req = require('module').createRequire(path.join(nm, 'x.js'));
  const PDFDocument = req('pdfkit');
  const SVGtoPDF = req('svg-to-pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: 'Print layout example (Nebelland, fictional)' } });
  doc.pipe(fs.createWriteStream(path.join(out, 'print-example.pdf')));
  const opts = { width: 595.28, height: 841.89, preserveAspectRatio: 'xMinYMin meet' };
  SVGtoPDF(doc, sheetSvg, 0, 0, opts);
  doc.addPage({ size: 'A4', margin: 0 });
  SVGtoPDF(doc, cardsSvg, 0, 0, opts);
  doc.end();
}
console.log('ok');
