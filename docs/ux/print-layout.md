# Print layout, phase 1: A4 character sheet and cards

> **Note:** File names and headings are in English. The body text is in German, because the first target audience and the project owner read German. An English version may follow.

> Gilt für: PDF-Erzeugung auf dem Server (AND-8), Paketformat (AND-4, Abschnitt "Druck").
> Anhänge auf dieser Aufgabe: `render/character-sheet-a4.svg/.png`, `render/cards-a4.svg/.png`, `render/print-example.pdf` (2 Seiten), `render/gen.cjs` (Skript, das die Skizzen erzeugt).
> Alle Inhalte in den Skizzen sind erfunden (Nebelland). Stand: Revision 1. Autor: Gestalter.

## 0. What the printout must achieve

Der Ausdruck ist das Ende der Reise. Er liegt am Spieltisch neben Würfeln und Chips. Er wird mit Bleistift beschrieben, radiert, geknickt. Daraus folgt: *(Peak-End Rule, Druck-Linse)*

1. **Bei 100 % lesbar.** Nichts unter 7 pt. Fliesstext 8,5–9 pt. Wichtige Zahlen 20–22 pt.
2. **Schwarzweiss genügt.** Keine Information nur über Farbe. Keine Farbflächen, ausser hellem Grau (≤ 10 %) hinter Abschnitts-Titeln. Spart Tinte, druckt auf jedem Drucker.
3. **Zum Ausfüllen gemacht.** Werte, die sich im Spiel ändern, bekommen ein leeres Feld mit dem Wort "Bleistift" oder Kästchen zum Ankreuzen.
4. **Kein Bildschirm-Layout auf Papier.** Keine Knöpfe, keine Links, kein "Mehr erfahren". Was wichtig ist, steht da.
5. **Eine Sprache, eine Einheit.** Alles in der Sprache und den Einheiten der Konto-Einstellung (Plan 5.6). Die Fusszeile nennt die Einheit ("Längen in Meter"), damit der Spielleiter es sieht.
6. **Der Bogen erklärt sich selbst.** Jeder Abschnitt, der eine Handlung verlangt, sagt in einem Satz, was man tut ("□ = einmal benutzt: ankreuzen. Nach einer Rast wegradieren.").

## 1. Common print rules

| Was | Wert |
| --- | --- |
| Papier | A4 hochkant, 210 × 297 mm |
| Druckränder | Bogen 12 mm rundum. Karten siehe Abschnitt 3. Kein Inhalt näher als 5 mm am Blattrand (nicht druckbarer Bereich vieler Drucker). |
| Schrift | Atkinson Hyperlegible Next (wie Web, siehe Design-System 4.1), eingebettet ins PDF. Keine System-Schrift des Servers. |
| Linien | Rahmen 0,6–0,8 pt schwarz. Schreiblinien 0,4 pt grau (#999). Trennlinien 0,3 pt hellgrau (#BBB). |
| Graustufen | Text schwarz oder #333/#444 (Nebentext). Nie heller als #555 für Text. |
| PDF | PDF/A-2b wenn möglich (Schrift eingebettet, keine externen Verweise). Titel-Metadaten = Charaktername. Keine Links, keine Formularfelder, kein JavaScript. |
| Druck-Hinweis | Im PDF steht keine Druckerskalierung. Der Bildschirm "Drucken" sagt: "In Originalgrösse (100 %) drucken." Auf der Karten-Seite steht es nochmal oben. |
| Seitenzahl | Fusszeile: "Name · Stufe · Längen in Meter · Seite x von y" |

### Type sizes on paper

| Rolle | Grösse | Gewicht |
| --- | --- | --- |
| Charaktername | 22 pt | Bold |
| Unterzeile (Zusammenfassung) | 11 pt | Regular |
| Grosse Werte in Kästen | 20–22 pt | Bold |
| Abschnitts-Titel | 8 pt, Grossbuchstaben, Sperrung 0,06 em | Bold |
| Feld-Namen | 9 pt | Bold |
| Fliesstext, Listen | 8,5–9 pt | Regular |
| Hinweise unter Kästen | 7–7,5 pt | Regular, #333 |
| Fusszeile, Karten-Typzeile | 7 pt | Regular |
| **Minimum überall** | **7 pt** | — |

## 2. Character sheet

### 2.1 The sheet is defined by the package

Der Builder kennt keine Werte wie "Ausdauer" oder "Schutz". Das Paket beschreibt den Bogen als Liste von **Abschnitten**. Der Builder kennt nur die **Abschnitts-Arten** und ein festes Raster. *(Plan, Grundsatz 6)*

Raster: 12 Spalten über 186 mm Breite, Abstand zwischen Spalten 4 mm. Jeder Abschnitt sagt, wie viele Spalten er breit ist (`span`: 3, 4, 6, 8, 12). Der Builder füllt Zeile für Zeile von oben nach unten.

| Abschnitts-Art | Zeigt | Beispiel im Bild | Wichtig |
| --- | --- | --- | --- |
| `header` | Name (gross), Zusammenfassung (`summary.line`), "Gespielt von ___", Name des Regelwerks | Kopf | immer zuerst, immer volle Breite |
| `statBoxes` | 3–6 Kästen gleicher Breite: Titel, grosse Zahl, Hinweis-Zeile. Varianten: Zahl, Bleistift-Feld, Kreise zum Ankreuzen | Ausdauer, Schutz, Tempo, Glücksmarken, Mut-Bonus | Werte mit Einheit werden umgerechnet ("9 m") |
| `scoreColumn` | senkrechte Kästen: Name, Wert gross, abgeleitete Zahl im Kreis | Grundwerte | Hinweis-Satz darunter aus dem Paket |
| `checkList` | Liste mit Markierung (● / ○), Zuordnung, leeres Kästchen für die Zahl | Fertigkeiten | Legende im Titel ("● = geübt: …") |
| `featureTable` | Tabelle: Name, ein Satz, Nutzungs-Kästchen oder "immer" | Kniffe | Kurz-Text = `short` aus dem Paket, gekürzt nie |
| `list` | Liste mit Schreiblinien darunter (für Ergänzungen) | Ausrüstung | mindestens 4 leere Linien |
| `helpBox` | gerahmter Kasten mit kurzen Schritten in Klartext | So bist du dran | Text aus dem Paket, ≤ 5 Punkte |
| `notes` | nur Schreiblinien, Abstand 6 mm | Notizen | — |

Passt der Inhalt nicht auf eine Seite, bricht der Builder **zwischen** Abschnitten um, nie mitten in einem Kasten. Seite 2 beginnt mit einer kleinen Kopfzeile (Name, Stufe).

### 2.2 Hierarchy (see `render/character-sheet-a4.png`)

1. **Name** — das Erste, was man sieht. Wem gehört der Bogen?
2. **Grosse Kästen** — die Zahlen, die am Tisch am häufigsten gebraucht werden. Das Paket wählt sie (`sheet.primary`). Höchstens 6.
3. **Grundwerte links, Listen rechts** — linke Spalte zum schnellen Nachschauen, rechte zum Lesen.
4. **Unten: Ausrüstung, Hilfe, Notizen** — braucht man seltener.

Die Reihenfolge folgt der Frage: "Was schaut ein neuer Spieler im Spiel am häufigsten nach?" *(Cognitive Load, Proximity, Common Region: jeder Abschnitt hat eine eigene Fläche mit Titel)*

### 2.3 Units

- Jeder Wert mit Einheit steht im Paket einmal in der Quell-Einheit (Plan 5.6).
- Der Builder rechnet nach der Tabelle aus dem Paket um: 30 Fuss → "9 m", 50 Fuss → "15 m".
- Die Einheit steht direkt an der Zahl, mit schmalem Leerzeichen ("9 m"). Im Englischen: "30 ft" auf dem Bogen (Platz), "30 feet" in Fliesstexten. Welche Form wo, steht in der Übersetzungsdatei des Pakets.
- Die Fusszeile nennt die Einheit.

### 2.4 What never goes on the sheet

QR-Codes, Links, Mailadresse, Konto-Angaben, Werbung, Logos fremder Firmen. Der Name des Regelwerks und die Quellenangabe (Lizenz, z. B. CC-BY) kommen klein in die Fusszeile der letzten Seite, Text aus dem Paket.

## 3. Cards

### 3.1 Format and imposition

| Was | Wert |
| --- | --- |
| Kartengrösse | 63 × 88 mm (übliches Spielkarten-Format, passt in Standard-Kartenhüllen) |
| Anordnung | 3 × 3 = 9 Karten pro A4-Seite, ohne Abstand dazwischen (gemeinsame Schnittlinien) |
| Raster-Ursprung | links 10,5 mm, oben 16,5 mm (Raster 189 × 264 mm, mittig) |
| Innenabstand der Karte | 4 mm rundum |
| Schnittlinien | dünne graue Linie (0,3 pt, #999) um jede Karte. Für Leute mit Schere. |
| Schnittmarken | ausserhalb des Rasters, an jeder Schnittlinie: 4 mm lang, 1,5 mm Abstand zum Raster, 0,5 pt schwarz. Für Leute mit Schneidemaschine. Nur so weit, wie Karten auf der Seite sind. |
| Seitenkopf | im oberen Rand: "Kniff-Karten · Name · Seite x von y" links, "In Originalgrösse (100 %) drucken. An den Linien ausschneiden." rechts. 7,5 pt. |
| Rückseite | keine. Einseitiger Druck. |

Warum keine Abstände zwischen den Karten? Ein Schnitt trennt zwei Karten. Halb so viele Schnitte, kein Abfall-Streifen. Mit Schere ist das einfacher. *(Constraints: weniger Möglichkeiten, falsch zu schneiden)*

### 3.2 Card anatomy (top to bottom)

| Teil | Inhalt | Schrift |
| --- | --- | --- |
| Typzeile | Art und Stufe, aus dem Paket (z. B. "Kniff · Stufe 1") | 7 pt, Grossbuchstaben, #333 |
| Name | Name der Option | 11 pt Bold |
| Linie | 0,6 pt | — |
| Werte-Raster | 2 × 2 Felder: Titel (7 pt, Grossbuchstaben) über Wert (9 pt Bold). Welche 4 Felder, sagt das Paket (`card.fields`). Einheiten umgerechnet. | — |
| "Am Tisch" | Unsere Klartext-Erklärung (`explain.table` oder `short`). Der wichtigste Text auf der Karte. | 8,5 pt |
| "Regeltext" | Offizieller Text aus dem Paket, unverändert | 7,5 pt, darf bis 7 pt schrumpfen |
| Fuss | Charaktername · Stufe links, Nutzungs-Kästchen rechts (Anzahl aus dem Regelkern) | 7 pt |

Die Klartext-Erklärung steht **über** dem Regeltext. Wer neu ist, liest oben und hört auf, wenn er genug weiss. *(Progressive Disclosure auf Papier)*

### 3.3 When the text does not fit

1. Regeltext von 7,5 pt bis 7 pt verkleinern.
2. Passt es dann nicht: **Fortsetzungs-Karte** direkt hinter der ersten. Gleiche Typzeile "Fortsetzung", Name mit "(2/2)", nur Regeltext. Die erste Karte bekommt am Ende "→ weiter auf der nächsten Karte".
3. "Am Tisch" wird **nie** gekürzt und nie auf eine zweite Karte verschoben. Wenn er nicht passt, ist er zu lang (Stilregeln: ≤ 400 Zeichen; auf der Karte praktisch ≤ 200).

### 3.4 Which cards

- Eine Karte pro Option, die das Paket als Karte markiert (`card: true`). Im Demo-Paket: Kniffe und Spezialisierungen. In anderen Paketen: was der Paket-Autor markiert.
- Reihenfolge: wie in der Schrittliste, dann nach Stufe, dann alphabetisch.
- Karten beginnen immer auf einer neuen Seite nach dem Bogen.

## 4. What the builder needs from the package for print

| Feld (Vorschlag) | Wofür |
| --- | --- |
| `sheet.sections[]` mit `kind`, `span`, Inhalt (Verweise auf berechnete Werte) | Abschnitte des Bogens (2.1) |
| `sheet.primary[]` | Die grossen Kästen, höchstens 6 |
| `sheet.help` | Text für `helpBox` |
| `sheet.attribution` | Lizenz- und Quellen-Zeile in der Fusszeile |
| `card: true` an Optionen | Welche Dinge Karten werden |
| `card.fields[]` (genau 4) | Werte-Raster auf der Karte |
| `card.typeLine` | Typzeile (Übersetzungs-Schlüssel mit Platzhaltern) |
| Einheiten-Formen pro Sprache: kurz ("ft", "m") und lang ("feet", "Meter") | 2.3 |

## 5. Verification for the PDF renderer

- PDF bei 100 % auf A4 drucken. Lineal: Karte 63 × 88 mm ± 0,5 mm.
- Alle Texte ≥ 7 pt (im PDF prüfen, z. B. Schriftgrössen auslesen).
- Schwarzweiss-Druck: jede Information noch lesbar.
- Umschalten auf Englisch: kein deutsches Wort im PDF. Umschalten auf Fuss: keine Meter-Angabe im PDF.
- Demo-Paket mit einem absichtlich sehr langen Regeltext: Fortsetzungs-Karte entsteht, nichts wird abgeschnitten.
- PDF enthält keine externen Verweise und keine Links.

## 6. About the sketches

- `render/gen.cjs` erzeugt die SVGs in Millimetern (viewBox 210 × 297) und daraus `render/print-example.pdf` mit pdfkit + svg-to-pdfkit. Das ist eine **Skizze**, nicht der Code für AND-8.
- Im Beispiel-PDF steht noch Helvetica, nicht Atkinson Hyperlegible, weil die Schrift-Datei hier nicht vorlag. Grössen und Abstände stimmen. Die PNG-Vorschauen sind mit DejaVu Sans gerendert, deshalb laufen die Zeilen dort etwas breiter.
- Alle Inhalte (Nebelland, Mira, Kniffe) sind erfunden. Sie dürfen ins Builder-Repo, zum Beispiel als Vorlage für Tests von AND-8.
