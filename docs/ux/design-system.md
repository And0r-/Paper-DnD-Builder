# Design system foundation, phase 1

> **Note:** File names and headings are in English. The body text is in German, because the first target audience and the project owner read German. An English version may follow.

> Gilt für: Oberfläche (AND-7), Druck (AND-8, Schrift und Graustufen).
> Mobil zuerst. Keine externen Fonts, keine CDNs, keine fremden Domains.
> Stand: Revision 1. Autor: Gestalter.

## 1. Principles

1. **Ruhig.** Viel Weissraum, wenig Farbe. Farbe heisst immer etwas (Handeln, Erfolg, Warnung, Fehler). *(Aesthetic-Usability, Signifiers)*
2. **Gross genug.** Fliesstext 18 px auf allen Geräten. Ziele mindestens 44 × 44 px. *(Barrierefreiheit, Fitts)*
3. **Eine Skala.** Jeder Abstand, jede Schriftgrösse kommt aus den Tabellen unten. Kein Wert dazwischen. *(Konsistenz)*
4. **Nie nur Farbe.** Jeder Zustand hat auch Text oder ein Zeichen. *(WCAG 1.4.1)*

Umsetzung: alle Werte als CSS-Variablen (Custom Properties) in einer Datei `tokens.css`. Komponenten benutzen nur Variablen, nie feste Werte. Kein UI-Framework mit eigenem Design (kein Bootstrap, kein Material). Vorschlag: CSS Modules oder einfache CSS-Dateien pro Komponente. Für zugängliche Grundbausteine (Dialog, Disclosure, Radio-Gruppe) ist eine ungestylte Bibliothek erlaubt, wenn sie lokal gebündelt wird (z. B. Radix Primitives oder React Aria). Entscheidung bei AND-7.

## 2. Spacing

Basis 4 px. Benannt nach Verwendung, nicht nach Grösse in Pixeln.

| Token | Wert | Wofür |
| --- | --- | --- |
| `--space-0` | 0 | — |
| `--space-1` | 4 px | Zeichen ↔ Text, sehr eng |
| `--space-2` | 8 px | innerhalb einer Zeile, Abzeichen-Innenabstand |
| `--space-3` | 12 px | Label ↔ Feld, Zeilen in einer Karte |
| `--space-4` | 16 px | Innenabstand Karte (Handy), Seitenrand (Handy), Abstand zwischen Karten |
| `--space-5` | 24 px | Innenabstand Karte (Desktop), Abstand Frage ↔ Optionen |
| `--space-6` | 32 px | Abschnitt ↔ Abschnitt |
| `--space-7` | 48 px | grosse Blöcke, Seitenrand (Desktop) |
| `--space-8` | 64 px | Kopf der Seite ↔ Inhalt (Desktop) |

Regel der Nähe: Was zusammengehört, steht näher als das, was nicht zusammengehört. Innerhalb einer Karte ≤ `--space-3`, zwischen Karten `--space-4`, zwischen Abschnitten `--space-6`. *(Proximity)*

## 3. Grid and widths

| Breite | Name | Aufbau |
| --- | --- | --- |
| 0–599 px | Handy | eine Spalte, Rand `--space-4`, feste Leiste unten (Zurück/Weiter), Höhe 72 px |
| 600–1023 px | Tablet | eine Spalte, max. 640 px Inhalt, mittig |
| ≥ 1024 px | Desktop | 3 Spalten: Schrittliste 240 px · Inhalt max. 640 px · Erklärung 320 px. Leiste Zurück/Weiter unter dem Inhalt, nicht fest. |

Lesebreite für Fliesstext: höchstens 65 Zeichen pro Zeile (`max-width: 65ch`).

Die feste Leiste unten beachtet `env(safe-area-inset-bottom)` (Handys mit Gestenleiste).

## 4. Typography

### 4.1 Typeface

**Atkinson Hyperlegible Next** (SIL Open Font License 1.1). Gebaut für Lesbarkeit, auch bei schwacher Sehkraft. Unterscheidet I, l, 1 und O, 0 deutlich. Wichtig für das Passwort ("vier Wörter plus Zahl") und für Werte auf dem Bogen.

- Die Schriftdateien (`.woff2` für das Web, `.ttf` für das PDF) liegen **im Repo** `builder`, unter `apps/web/public/fonts/` bzw. einem gemeinsamen Ordner. Mit Lizenzdatei. Kein Laden von Google Fonts oder einem CDN.
- Schnitte: Regular (400), SemiBold (600), Bold (700). Kursiv nur Regular-Italic. Mehr nicht.
- Dieselbe Schrift im Web **und** im PDF. Der Ausdruck sieht aus wie der Bildschirm. *(Konsistenz, Mental Model)*
- Zeichensatz: Lateinisch erweitert (deckt Deutsch, Englisch, Französisch, Italienisch, Spanisch). Für spätere Sprachen mit anderen Schriften braucht es eine zweite Schrift; nicht Phase 1.
- `font-display: swap`. Ersatz-Stapel, bis die Schrift geladen ist:
  `"Atkinson Hyperlegible Next", system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif`
- Ziffern für Werte und Tabellen: `font-variant-numeric: tabular-nums`, damit Zahlen untereinander stehen.

Falls die Lizenzprüfung bei AND-2 ein Problem findet: Ersatz ist **Noto Sans** (ebenfalls OFL). Alles andere bleibt gleich.

### 4.2 Type scale

Basis: `1rem = 16 px`. Fliesstext ist bewusst grösser als die Basis.

| Token | Grösse / Zeilenhöhe | Gewicht | Wofür |
| --- | --- | --- | --- |
| `--text-xs` | 14 / 20 px | 400 | Fussnoten, "Das kannst du später nicht mehr ändern". Nie für Erklärungen. |
| `--text-sm` | 16 / 24 px | 400 | Labels, Schrittname über der Frage, Abzeichen, Speicherstatus |
| `--text-md` | 18 / 28 px | 400 | **Fliesstext**, Erklärungen, Kurz-Erklärung auf Karten |
| `--text-lg` | 20 / 28 px | 600 | Name einer Option auf der Karte, Knöpfe |
| `--text-xl` | 24 / 32 px | 700 | **Die Frage** (Handy) |
| `--text-2xl` | 30 / 38 px | 700 | Die Frage (Desktop), Seitentitel |
| `--text-3xl` | 36 / 44 px | 700 | Grosse Werte im Überblick, "Mira ist fertig!" |

Regeln:
- Pro Bildschirm höchstens drei Grössen sichtbar. Hierarchie entsteht durch Grösse **und** Gewicht, nicht durch Farbe allein.
- Keine Grossbuchstaben-Wörter im Fliesstext. Ausnahme: kleine Labels auf dem Druck (siehe Druck-Layout).
- Text ist auf 200 % zoombar, ohne dass etwas abgeschnitten wird (WCAG 1.4.4). Alle Grössen in `rem`.

## 5. Colour

Hell, warm, ruhig. Phase 1 hat nur ein helles Schema. Ein dunkles Schema kommt später über dieselben Token-Namen.

### 5.1 Palette with contrast ratios

Kontrast nach WCAG 2.2, gerechnet gegen den Seitenhintergrund `--color-bg` (#FBFAF7) und gegen Weiss (#FFFFFF, Kartenfläche). AA verlangt 4,5:1 für Text, 3:1 für grossen Text und Bedienelemente. Gerechnet mit der WCAG-Formel (relative Luminanz).

| Token | Hex | Kontrast auf bg | auf Weiss | Wofür | Erfüllt |
| --- | --- | --- | --- | --- | --- |
| `--color-bg` | #FBFAF7 | — | — | Seitenhintergrund (warmes Off-White) | — |
| `--color-surface` | #FFFFFF | — | — | Karten, Dialoge, Leisten | — |
| `--color-surface-sunk` | #F1EFEA | — | — | eingelassene Flächen (Erklärungs-Spalte, Code) | — |
| `--color-ink` | #1D1C1A | 16,3:1 | 17,0:1 | Haupttext, Überschriften | AAA |
| `--color-ink-muted` | #55524D | 7,5:1 | 7,8:1 | Nebentext, Labels, Hinweise | AAA |
| `--color-border` | #8A857D | 3,5:1 | 3,7:1 | Rahmen von Bedienelementen (Felder, Karten, Checkboxen) | AA (1.4.11, ≥ 3:1) |
| `--color-line` | #D9D5CD | 1,4:1 | 1,5:1 | nur Trennlinien, rein schmückend | — (keine Information) |
| `--color-primary` | #1E5A8A | 7,0:1 | 7,3:1 | Hauptknopf, Links, gewählte Karte, Fortschritt, Fokusring | AAA |
| `--color-primary-hover` | #174A73 | 8,9:1 | 9,3:1 | Hover/gedrückt | AAA |
| `--color-primary-soft` | #E3EEF7 | — | — | Hintergrund gewählte Karte | Text darauf: ink 14,5:1, primary 6,2:1 |
| `--color-success` | #1D6B3A | 6,3:1 | 6,5:1 | "fertig" ✓, Gespeichert | AA |
| `--color-success-soft` | #E2F1E6 | — | — | Hintergrund Erfolgs-Hinweis | success darauf 5,6:1 |
| `--color-warning` | #7A4F00 | 6,8:1 | 7,1:1 | "!" muss neu gewählt werden, offene Punkte | AA |
| `--color-warning-soft` | #FBF0D9 | — | — | Hintergrund Warn-Kasten | warning darauf 6,3:1 |
| `--color-danger` | #A8241C | 6,9:1 | 7,2:1 | Fehler, Löschen | AA |
| `--color-danger-soft` | #FBE6E4 | — | — | Hintergrund Fehler-Kasten | danger darauf 6,0:1 |

Weisser Text auf Knöpfen: auf `--color-primary` 7,3:1, auf `--color-primary-hover` 9,3:1, auf `--color-danger` 7,2:1. Alle AAA bzw. AA.

Gerechnet am 2026-10-04 mit einem Skript nach WCAG-2-Formel. AND-7 prüft im Browser nochmal mit einem lokalen Werkzeug (z. B. axe-core in den Tests, ohne Netz).

### 5.2 Rules

- Text nie heller als `--color-ink-muted`. Kein Grau-auf-Grau.
- Gewählt = Rahmen 2 px `--color-primary` **plus** Fläche `--color-primary-soft` **plus** gefülltes Radio-/Häkchen-Zeichen. Drei Signale, nicht eins.
- Fehler = roter Rahmen **plus** Zeichen ⚠ **plus** Text unter dem Feld.
- Fokus = Ring 3 px `--color-primary`, 2 px Abstand nach aussen (`outline-offset: 2px`). Immer sichtbar bei Tastatur (`:focus-visible`). Nie `outline: none` ohne Ersatz.
- `forced-colors: active` (Windows-Kontrastmodus): Rahmen bleiben sichtbar, Zustände über Systemfarben.

## 6. Shape, depth, motion

| Token | Wert | Wofür |
| --- | --- | --- |
| `--radius-sm` | 6 px | Felder, Abzeichen |
| `--radius-md` | 12 px | Karten, Knöpfe |
| `--radius-lg` | 20 px | Dialoge, Blatt von unten |
| `--shadow-1` | `0 1px 2px rgb(29 28 26 / .08)` | Karten |
| `--shadow-2` | `0 8px 24px rgb(29 28 26 / .16)` | Dialoge, Blatt von unten |
| `--motion-fast` | 120 ms ease-out | Hover, Auswahl |
| `--motion-base` | 200 ms ease-out | Aufklappen, Blatt erscheint |

Bei `prefers-reduced-motion: reduce`: alle Übergänge 0 ms, kein Scrollen mit Animation. Nichts blinkt, nichts bewegt sich von selbst.

## 7. Components, phase 1

Jede Komponente hat die Zustände aus Abschnitt 8, wo sie zutreffen. "Grösse" = minimale Trefferfläche.

### 7.1 Layout shell

| Komponente | Zweck | Wichtig |
| --- | --- | --- |
| `AppShell` | Kopfzeile, Inhalt, Menü | "Zum Inhalt springen" als erster Link |
| `TopBar` | Menü ☰, Charaktername + Stufe, Speicherstatus | Höhe 56 px |
| `MenuDrawer` | Schrittliste (in der Erstellung), Meine Charaktere, Einstellungen, Abmelden | Fokus gefangen, Escape schliesst |
| `ProgressHeader` | Balken + "Schritt 3 von 7" + Schrittname | `role="progressbar"` mit `aria-valuetext="Schritt 3 von 7"` |
| `StepList` | Alle Schritte mit Zustand ✓ ● ○ ! | Liste von Links, Zustand als Text für Screenreader |
| `StepFooter` | Zurück / Weiter, Grund-Meldung, "Für mich wählen" | Weiter nie `disabled` |
| `SaveStatus` | Gespeichert / Speichert … / Nicht gespeichert / Keine Verbindung | `aria-live="polite"` |

### 7.2 Questions and choices

| Komponente | Zweck | Wichtig |
| --- | --- | --- |
| `QuestionHeader` | Frage (h1) + Einleitung | Fokus landet hier beim Schrittwechsel |
| `OptionCard` | Eine Option: Name, Abzeichen, Kurz, Gut-wenn, "Mehr erfahren" | Ganze Karte klickbar; echtes `<input type=radio/checkbox>` drin. Grösse ≥ 44 px hoch, volle Breite |
| `OptionGroup` | `<fieldset>` mit Karten, optional Gruppen-Überschriften und Suche | Pfeiltasten bei Radio, Leertaste bei Checkbox |
| `PickCounter` | "2 von 3 gewählt" | sticky oben in `pickMany`, `aria-live` |
| `PointDistributor` | Zeile pro Wert: Name, − Zahl +, Erklärung | Knöpfe 44 × 44, Zahl als `<output>`; "Noch 4 Punkte übrig" |
| `ArrayAssigner` | feste Zahlenreihe Werten zuordnen | pro Wert ein `<select>` mit den freien Zahlen |
| `Segmented` | 2–5 Möglichkeiten nebeneinander (Stufe, Meter/Fuss) | Radio-Gruppe, gleiche Breite |
| `TextField` | Label oben, Feld, Hilfe, Fehler | Label nie nur Platzhalter; Fehler mit `aria-describedby` |
| `GrantList` | "Das bekommst du dazu" (Art `info`) | Liste mit Glossar-Verweisen |
| `Badge` | "Empfohlen", "Neu gewählt nötig" | Text, nicht nur Farbe |

### 7.3 Explanations

| Komponente | Zweck | Wichtig |
| --- | --- | --- |
| `Disclosure` | "Mehr erfahren ▾" / "Weniger ▴" | `<button aria-expanded>` |
| `GlossaryTerm` | gepunktet unterstrichenes Wort im Text | Ist ein `<button>`, nicht nur `<span>`. Trefferfläche durch Innenabstand ≥ 24 px (WCAG 2.5.8) |
| `GlossarySheet` | Blatt von unten (Handy) / Hinweis-Fläche (Desktop) mit Erklärung | Aufbau wie Stilregeln Abschnitt 3; Escape schliesst |
| `ExplainPanel` | rechte Spalte am Desktop: lange Erklärung zur fokussierten Option | `aria-live="off"`, nicht vorlesen bei jedem Fokus |
| `RulesText` | Offizieller Regeltext, aufklappbar unter der Erklärung | Optisch abgesetzt (`--color-surface-sunk`), Überschrift "Regeltext" |
| `Callout` | Hinweis-Kasten: info, Erfolg, Warnung, Fehler | Zeichen + Überschrift + Text |

### 7.4 Feedback and dialogs

| Komponente | Zweck | Wichtig |
| --- | --- | --- |
| `Button` | primary (gefüllt), secondary (Rahmen), ghost (Text), danger | Höhe 48 px, Text ≥ 18 px; Ladezustand mit Text ("Wird geschickt …") |
| `ConfirmDialog` | Bestätigung mit Folgen-Liste (z. B. "Beruf ändern?") | Fokus auf sicherer Wahl, Escape = sicher |
| `TypedConfirmDialog` | "Tippe LÖSCHEN ein" | nur Konto löschen |
| `Toast` | kurze Meldung mit optionaler Aktion ("Rückgängig") | ≥ 10 s sichtbar, wenn Aktion; pausiert bei Fokus/Hover |
| `EmptyState` | leerer Zustand mit einem Knopf | Symbol + Satz + Knopf |
| `Skeleton` | Platzhalter beim Laden | statisch bei reduced-motion |
| `ErrorState` | Fehler beim Laden einer Seite | Satz + "Nochmal versuchen" |

### 7.5 Account

| Komponente | Zweck |
| --- | --- |
| `EmailForm` | Anmelden Zustand A |
| `PasswordEntry` | Anmelden Zustand B: sichtbares Feld, "Verbergen", "Neue Mail schicken" mit Countdown |
| `LanguageSelect` | Sprachen in ihrer eigenen Sprache, `lang`-Attribut pro Option |
| `UnitToggle` | Segmented + Beispiel aus der Umrechnungstabelle |
| `CharacterCard` | Eintrag in "Meine Charaktere" |
| `PdfDownload` | Vorschau + Knopf + Druck-Tipp |

## 8. States

Jeder Bildschirm, der Daten lädt, hat alle vier Zustände gestaltet. Ein Bildschirm ohne gestalteten Leer-, Lade- und Fehlerzustand ist nicht fertig.

| Zustand | Wie er aussieht | Text-Muster |
| --- | --- | --- |
| **leer** | `EmptyState`: Symbol (einfarbig, `--color-ink-muted`), ein Satz, ein Knopf | Was hier hinkommt + der nächste Schritt |
| **laden < 400 ms** | nichts ändern (kein Flackern) | — |
| **laden ≥ 400 ms** | `Skeleton` in der Form des Inhalts; bei Knöpfen: Text wechselt ("Wird geschickt …") | — |
| **laden > 5 s** | zusätzlich Satz: "Das dauert länger als sonst." | — |
| **Fehler beim Laden** | `ErrorState` an der Stelle des Inhalts, Rest der Seite bleibt bedienbar | "Das hat nicht geklappt." + "Nochmal versuchen" |
| **Fehler bei Eingabe** | Feld rot umrandet + ⚠ + Text unter dem Feld, Fokus ins Feld | Was fehlt + wie es richtig aussieht |
| **Fehler beim Speichern** | `SaveStatus` (siehe Ablauf 2.4), keine Blockade | "Nicht gespeichert. Wir versuchen es gleich nochmal." |
| **offline** | Leiste oben, `--color-warning-soft` | "Keine Verbindung. Deine letzte Wahl ist noch nicht gespeichert." |
| **Erfolg** | meist kein eigener Zustand: der Wechsel ist die Rückmeldung. Sonst `Toast`. | — |

## 9. Verification

- Tastatur: der ganze Ablauf von Anmelden bis PDF ohne Maus. Reihenfolge stimmt, Fokus immer sichtbar.
- Screenreader: einmal mit NVDA oder VoiceOver durch einen Schritt; Frage, Optionen, Zustand werden vorgelesen.
- Kontrast: axe-core in den Komponententests (lokal, ohne Netz).
- Zoom 200 % und Breite 320 px: nichts abgeschnitten, kein waagrechtes Scrollen.
- `prefers-reduced-motion`: keine Bewegung.
- Netzwerk-Tab: keine Anfrage an eine fremde Domain, auch nicht für Schriften oder Symbole. Symbole als lokale SVGs.
