# Character creation flow, phase 1

> **Note:** File names and headings are in English. The body text is in German, because the first target audience and the project owner read German. An English version may follow.

> Gilt für: Oberfläche (AND-7), Builder-Kern (AND-6), Paketformat (AND-4), Inhalt (AND-5).
> Stand: Revision 1. Autor: Gestalter.

## 0. Purpose

Eine Person, die nie ein Rollenspiel gespielt hat, baut allein einen Charakter der Stufe 3. Sie braucht unter 20 Minuten. Sie fragt niemanden. Am Ende hält sie einen Ausdruck in der Hand.

Daraus folgen fünf Regeln für den ganzen Ablauf:

1. **Eine Frage pro Bildschirm.** Wer eine Frage sieht, muss nur diese beantworten. *(Linsen: Cognitive Load, Hick's Law, Formulare)*
2. **Man sieht immer, wo man ist und was noch fehlt.** *(Goal-Gradient, Nielsen 1: Sichtbarkeit des Systemzustands)*
3. **Nichts geht verloren.** Jede Wahl wird sofort auf dem Server gespeichert. Zurück geht immer. *(Forgiveness, Nielsen 3: Kontrolle und Freiheit)*
4. **Jede Wahl wird dort erklärt, wo sie fällt.** Kein Nachschlagen. *(Recognition over Recall, Plain Language)*
5. **Es gibt immer eine gute Vorgabe.** Wer nicht weiss, was er nehmen soll, nimmt die Empfehlung und kommt trotzdem gut an. *(Defaults, Choice Overload)*

Der Builder kennt kein Regelwerk. **Alle Schritte, Wahlen, Erklärungen und Empfehlungen kommen aus dem Paket.** Der Builder kennt nur feste Bausteine (Abschnitt 3). Die Beispiele in diesem Dokument stammen aus einer erfundenen Welt ("Nebelland", siehe Abschnitt 6). Die echten Namen im Demo-Paket legt Archivar in AND-4 fest.

---

## 1. Screen overview

```
Anmelden ──► Meine Charaktere ──► Neuer Charakter
                 │                    │
                 │                    ▼
                 │              [Regelwerk wählen]  ← nur wenn mehr als ein Paket
                 │                    ▼
                 │              Stufe wählen
                 │                    ▼
                 │              Schritte aus dem Paket (1…n)
                 │                    ▼
                 │              Überblick ("Ist alles fertig?")
                 │                    ▼
                 └──────────────► Drucken
Einstellungen (jederzeit über das Menü erreichbar)
```

| Bildschirm | Zweck | Kommt aus |
| --- | --- | --- |
| Anmelden (3 Zustände) | Mailadresse → Passwort aus der Mail → drin | Builder |
| Meine Charaktere | Liste, weiterbauen, drucken, neu | Builder |
| Regelwerk wählen | Nur bei mehreren Paketen. Sonst übersprungen. | Builder + Paket-Metadaten |
| Stufe wählen | Stufe 1 bis Höchststufe des Pakets (Phase 1: 3) | Builder + Paket |
| Paket-Schritte | Die eigentliche Erstellung | Paket |
| Überblick | Alles auf einen Blick, offene Punkte, Fehler | Builder + Regelkern |
| Drucken | PDF holen, Ende mit gutem Gefühl | Builder |
| Einstellungen | Sprache, Einheiten, Passwort, Abmelden, Konto löschen | Builder |

---

## 2. Frame of every creation step

Jeder Schritt der Erstellung hat denselben Rahmen. Wer einen Schritt kennt, kennt alle. *(Similarity, Mental Model, Nielsen 4: Konsistenz)*

### 2.1 Layout (phone, top to bottom)

```
┌──────────────────────────────────────┐
│ ☰  Mira · Stufe 3          Gespeichert ✓│  ← Kopfzeile: Menü, Name, Speicherstatus
│ ▓▓▓▓▓▓▓▓░░░░░░░░  Schritt 3 von 7     │  ← Fortschritt
│ Beruf                                  │  ← Name des Schritts (klein)
├──────────────────────────────────────┤
│ Womit verdient Mira ihr Brot?          │  ← DIE Frage (gross)
│ Dein Beruf bestimmt, was du am Tisch   │  ← Einleitung, 1–2 Sätze
│ am besten kannst.                      │
│                                        │
│ ┌──────────────────────────────────┐   │
│ │ ◉ Laternenträgerin   [Empfohlen] │   │  ← Wahl-Karte
│ │ Du bringst Licht ins Dunkel und  │   │     Kurz-Erklärung (1 Satz)
│ │ hältst die Gruppe zusammen.      │   │
│ │ Gut, wenn: du anderen helfen     │   │     "Gut, wenn" (1 Satz)
│ │ willst.                          │   │
│ │ Mehr erfahren ▾                  │   │     aufklappbar
│ └──────────────────────────────────┘   │
│ ┌──────────────────────────────────┐   │
│ │ ○ Flussläufer                    │   │
│ │ …                                │   │
│ └──────────────────────────────────┘   │
├──────────────────────────────────────┤
│ [ Zurück ]              [ Weiter → ]  │  ← feste Leiste unten
└──────────────────────────────────────┘
```

Ab 1024 px Breite: links die Schrittliste (immer sichtbar), Mitte die Frage, rechts die ausführliche Erklärung zur gerade fokussierten Wahl. Auf dem Handy liegt die Schrittliste hinter dem Menü, die ausführliche Erklärung hinter "Mehr erfahren".

### 2.2 Progress

- Balken plus Text: "Schritt 3 von 7". Der Text ist nötig, der Balken allein sagt zu wenig. *(Goal-Gradient)*
- Die Gesamtzahl kann sich ändern, wenn eine Wahl neue Schritte bringt (Beispiel: Stufe 3 bringt einen Zusatz-Schritt). Dann zeigt der Builder kurz einen Hinweis: "Durch deine Wahl kommt ein Schritt dazu: Spezialisierung." Die Zahl springt nie ohne Erklärung. *(Nielsen 1, Feedback)*
- **Schrittliste** (Menü auf dem Handy, Seitenleiste am Desktop): alle Schritte mit Zustand.

| Zeichen | Zustand | Text für Screenreader |
| --- | --- | --- |
| ✓ (grün) | fertig | "fertig" |
| ● (blau) | hier bist du | "aktueller Schritt" |
| ○ | noch offen | "noch offen" |
| ! (orange) | muss neu gewählt werden, weil sich vorher etwas geändert hat | "muss neu gewählt werden" |

Jeder Schritt in der Liste ist anklickbar. Man darf springen, auch nach vorn. *(Kontrolle und Freiheit)* Wer nach vorn springt, sieht dort die Optionen, die ohne die fehlende Wahl schon gehen, plus einen Hinweis: "Dafür musst du zuerst Beruf wählen. [Zu Beruf]".

### 2.3 Next and back

- **Weiter** ist nie ausgegraut. Wer "Weiter" drückt, ohne fertig zu sein, bekommt den Grund direkt über dem Knopf: "Wähle noch 1 Kniff. Du hast 2 von 3." Fokus springt zur ersten offenen Stelle. *(Inline-Validierung; ausgegraute Knöpfe erklären nichts)*
- Gibt das Paket eine Empfehlung, steht neben dem Grund ein zweiter Knopf: "Für mich wählen". Er setzt die Empfehlung ein. Der Spieler sieht danach, was gewählt wurde, und kann es ändern.
- **Später entscheiden** (kleiner Textlink unter der Frage): Der Schritt bleibt offen (○), man geht weiter. Offene Schritte erscheinen im Überblick. Drucken geht erst, wenn nichts Pflichtiges mehr offen ist.
- **Zurück** geht immer einen Schritt zurück. Die Wahl im aktuellen Schritt bleibt gespeichert, auch wenn sie unvollständig ist.
- Die Browser-Zurück-Taste tut dasselbe wie "Zurück". Jeder Schritt hat eine eigene Adresse (`/c/{id}/step/{stepId}`). Neu laden landet im selben Schritt.

### 2.4 Saving

- Jede Änderung geht sofort an den Server (Entwurfs-Dokument, AND-6). Kein "Speichern"-Knopf. *(Forgiveness)*
- Kopfzeile zeigt den Zustand. Nur Text plus Zeichen, keine Farbe allein:

| Zustand | Anzeige DE | Anzeige EN |
| --- | --- | --- |
| gespeichert | Gespeichert ✓ | Saved ✓ |
| unterwegs (> 400 ms) | Speichert … | Saving … |
| Fehler | Nicht gespeichert. Wir versuchen es gleich nochmal. | Not saved. We'll try again in a moment. |
| offline | Keine Verbindung. Deine letzte Wahl ist noch nicht gespeichert. | No connection. Your last choice is not saved yet. |

- Bei Fehler: automatisch nochmal nach 2, 5, 10, 30 s. Die Wahl bleibt auf dem Bildschirm stehen. Beim Schliessen des Tabs mit ungespeicherter Wahl: Browser-Warnung.
- Wer den Tab schliesst und morgen wiederkommt, landet in "Meine Charaktere". Der angefangene Charakter steht oben, mit "Weiterbauen — Schritt 4 von 7".

### 2.5 Changing an earlier choice

Ändert man eine Wahl, von der spätere Wahlen abhängen, passiert Folgendes:

1. Der Builder fragt **vorher**, in einem Dialog:
   > **Beruf ändern?**
   > Wenn du Flussläufer statt Laternenträgerin nimmst, passen diese Wahlen nicht mehr:
   > - Kniffe (3 gewählt)
   > - Ausrüstung (Laternenstab)
   >
   > Du musst sie neu wählen. Wenn du später zu Laternenträgerin zurückgehst, sind sie wieder da.
   >
   > [Nein, behalten]  [Ja, ändern]
   *(Forgiveness, Nielsen 5: Fehler vermeiden)*
2. Der Standard-Fokus liegt auf "Nein, behalten". Escape = Nein.
3. Nach "Ja": betroffene Schritte bekommen "!" in der Schrittliste. Der Fortschritt zählt sie wieder als offen.
4. **Die alten Wahlen werden nicht gelöscht.** Der Entwurf merkt sie sich pro Option ("Ablage"). Wer zurück zur alten Option geht, bekommt die alten Wahlen zurück, soweit sie noch gültig sind. Das ist die Umsetzung von "nie verloren".
5. Wahlen ohne Abhängigkeit (Name, Aussehen) bleiben immer unberührt. Es gibt dann auch keinen Dialog.

Woher der Builder weiss, was abhängt: aus dem Paket (Abschnitt 5, `requires` und `grants`). Der Regelkern berechnet nach jeder Änderung, welche gespeicherten Wahlen nicht mehr gültig sind. Die Oberfläche zeigt nur das Ergebnis an.

---

## 3. Building blocks (choice types)

Der Builder kennt genau diese sechs Arten von Fragen. Jeder Schritt im Paket nutzt eine davon. Mehr braucht Phase 1 nicht.

| Art | Wofür | Bedienung | Beispiel (Nebelland) |
| --- | --- | --- | --- |
| `pickOne` | genau eine Option aus einer Liste | Karten als Radio-Gruppe. Pfeiltasten wechseln. | Herkunft, Beruf |
| `pickMany` | n Optionen aus einer Liste (genau n, oder bis zu n) | Karten als Checkbox-Gruppe. Zähler "2 von 3 gewählt" bleibt oben sichtbar (sticky). Ist n erreicht, sind weitere Karten nicht wählbar, mit Hinweis "Du hast schon 3. Nimm erst eine weg." | Kniffe, Fertigkeiten |
| `distribute` | Punkte oder eine feste Zahlenreihe auf mehrere Werte verteilen | Pro Wert eine Zeile mit − / + und Zahl. Oben: "Noch 4 Punkte übrig". Alternativ (wenn das Paket eine feste Reihe vorgibt): jeder Zahl der Reihe einen Wert zuordnen, als Auswahlliste pro Wert. | Grundwerte |
| `number` | eine Zahl in festen Grenzen | Segment-Knöpfe, wenn ≤ 5 Möglichkeiten; sonst − / + | Stufe |
| `text` | freier Text | Textfeld mit sichtbarem Label über dem Feld. Optional: "Vorschlag würfeln" (Liste aus dem Paket). | Name, Aussehen |
| `info` | keine Wahl, nur Erklärung, was man automatisch bekommt | Liste "Das bekommst du dazu", ein Knopf "Verstanden, weiter" | "Was dir dein Beruf schenkt" |

Zu jeder Option gehören aus dem Paket:

| Feld | Pflicht | Wo sichtbar | Länge |
| --- | --- | --- | --- |
| Name | ja | Karte, Überblick, Druck | ≤ 30 Zeichen |
| Kurz-Erklärung | ja | Karte | 1 Satz, ≤ 120 Zeichen |
| "Gut, wenn …" | empfohlen | Karte | 1 Satz, ≤ 80 Zeichen |
| Lange Erklärung (Klartext) | ja | "Mehr erfahren" | ≤ 400 Zeichen, Aufbau siehe Stilregeln |
| Regeltext | nein | "Mehr erfahren" → "Regeltext anzeigen" | beliebig |
| Was man bekommt | automatisch | "Mehr erfahren" | Liste aus `grants`, vom Regelkern |
| Empfohlen | nein | Abzeichen "Empfohlen" | höchstens 1 pro `pickOne`, Satz für `pickMany` |

**Höchstens 7 Karten sind auf einmal voll sichtbar.** Hat eine Liste mehr Optionen, gruppiert das Paket sie (z. B. "Für den Kampf", "Für Gespräche") und der Builder zeigt Gruppen als Abschnitte mit Überschrift. Ab 12 Optionen erscheint ein Suchfeld oben. *(Hick's Law, Chunking, Common Region)*

**Fachwörter in Texten** sind im Paket als Glossar-Verweis markiert. Der Builder unterstreicht sie gepunktet. Antippen öffnet ein Blatt von unten (Handy) bzw. einen Hinweis neben dem Wort (Desktop) mit der Glossar-Erklärung. Das Blatt schliesst mit Escape, Tippen daneben oder "Schliessen". *(Progressive Disclosure)*

---

## 4. Screens in detail

Spalte "Zurück" heisst: was der Knopf "Zurück" auf diesem Bildschirm tut.

### 4.1 Sign in

Drei Zustände auf einer Seite. Kein Registrieren, kein "Konto anlegen". Wer eine neue Mailadresse eingibt, bekommt ein Konto. Wer eine bekannte eingibt, bekommt ein neues Passwort. Für den Spieler ist beides derselbe Weg.

**Zustand A — Mailadresse**

| Teil | DE | EN |
| --- | --- | --- |
| Überschrift | Willkommen! | Welcome! |
| Text | Gib deine Mailadresse ein. Wir schicken dir ein Passwort. | Enter your email address. We will send you a password. |
| Feld-Label | Deine Mailadresse | Your email address |
| Knopf | Passwort schicken | Send password |
| Kleiner Text | Wir speichern nur deine Mailadresse und deine Charaktere. Sonst nichts. [Was wir speichern] | We only store your email address and your characters. Nothing else. [What we store] |
| Link unter dem Knopf | Ich habe schon ein Passwort | I already have a password |

- Validierung erst beim Absenden oder beim Verlassen des Felds, nicht beim Tippen. Fehler: "Da fehlt noch etwas. Eine Mailadresse sieht so aus: name@beispiel.de".
- `type="email"`, `autocomplete="email"`, `inputmode="email"`.

**Zustand B — Mail ist unterwegs**

| Teil | DE |
| --- | --- |
| Überschrift | Schau in dein Postfach |
| Text | Wir haben ein Passwort an **mira@beispiel.de** geschickt. Es besteht aus vier Wörtern und einer Zahl. Tippe es hier ein. |
| Feld-Label | Passwort aus der Mail |
| Knopf | Anmelden |
| Hilfe (aufklappbar) | Keine Mail da? Schau im Spam-Ordner nach. Es kann eine Minute dauern. [Neue Mail schicken] (erst nach 60 s aktiv, mit sichtbarem Countdown) · [Andere Mailadresse] |

- Das Passwort-Feld ist **sichtbar** (kein Punkte-Feld), mit Knopf "Verbergen". Grund: Das Passwort wird vom Handy abgetippt, Tippfehler müssen sichtbar sein.
- Eingabe ist tolerant: Gross/klein egal, Leerzeichen statt Bindestrich erlaubt, Leerzeichen vorn/hinten werden entfernt. (Anforderung an AND-6: Normalisierung vor dem Hash-Vergleich.)
- `autocomplete="current-password"`, damit Passwort-Manager es speichern.
- Fehler falsches Passwort: "Das Passwort passt nicht. Prüfe die vier Wörter und die Zahl." Kein Hinweis, ob die Mailadresse existiert.
- Zu viele Versuche: "Zu viele Versuche. Warte bitte 5 Minuten. Oder lass dir ein neues Passwort schicken." Die Wartezeit kommt vom Server.

**Zustand C — Angemeldet.** Weiter zu "Meine Charaktere". Die Sitzung bleibt lange gültig (AND-6). Keine Erfolgsmeldung nötig, der Bildschirmwechsel ist die Rückmeldung.

**Zurück:** B → A ("Andere Mailadresse"). A hat kein Zurück.

**Sprache vor dem Anmelden:** aus der Browser-Sprache (`Accept-Language`), sonst Deutsch. Oben rechts ein Sprachwechsel (siehe 4.9). Nach dem Anmelden gilt die Konto-Einstellung. Beim ersten Anmelden wird die Sprache, die gerade sichtbar war, ins Konto übernommen.

### 4.2 My characters

| Zustand | Inhalt |
| --- | --- |
| leer | Bild/Symbol, "Hier wohnen bald deine Charaktere." Knopf: "Ersten Charakter bauen". Nichts anderes. |
| mit Charakteren | Karte pro Charakter: Name (oder "Ohne Namen"), Zusammenfassung aus dem Paket (z. B. "Laternenträgerin · Stufe 3"), Zustand ("Fertig" oder "Schritt 4 von 7"). Knöpfe: "Weiterbauen" bzw. "Ansehen", "Drucken" (nur wenn fertig). Menü ⋯: "Löschen". |
| laden | 3 graue Platzhalter-Karten (Skelett), kein Drehkreis |
| Fehler | "Wir können deine Charaktere gerade nicht laden. [Nochmal versuchen]" |

Oben ein Knopf "Neuen Charakter bauen". Unfertige Charaktere stehen zuerst.

Löschen: Dialog "Mira löschen? Das kann man nicht rückgängig machen." [Abbrechen] [Löschen]. Danach 10 Sekunden lang eine Meldung "Mira gelöscht. [Rückgängig]". Erst danach löscht der Server endgültig. *(Forgiveness)*

### 4.3 Choose a rule set

Nur sichtbar, wenn mehr als ein Paket geladen ist. Sonst überspringt der Builder diesen Schritt ohne Hinweis. *(Hick's Law)*

| Teil | DE |
| --- | --- |
| Frage | Mit welchem Spiel spielt deine Gruppe? |
| Einleitung | Frag deinen Spielleiter, wenn du es nicht weisst. Das ist die Person, die das Spiel leitet. |
| Optionen | Name und Kurz-Erklärung aus den Paket-Metadaten |

**Zurück:** zu "Meine Charaktere". Der Entwurf existiert ab hier schon und erscheint dort.

Das Regelwerk lässt sich später nicht ändern (alle Wahlen hängen daran). Das steht klein unter den Optionen: "Das kannst du später nicht mehr ändern."

### 4.4 Choose a level

| Teil | DE (Builder-Text) |
| --- | --- |
| Frage | Wie erfahren ist dein Charakter? |
| Einleitung | Kommt aus dem Paket (Schlüssel `level.intro`). Beispiel Nebelland: "Die Stufe sagt, wie viel dein Charakter schon erlebt hat. Höhere Stufe heisst: mehr Kniffe, mehr Ausdauer." |
| Hinweis | Kommt aus dem Paket. Beispiel: "Weisst du es nicht? Frag deinen Spielleiter. Sonst nimm Stufe 1." |
| Bedienung | Segment-Knöpfe 1 · 2 · 3 (bis Höchststufe des Pakets, Phase 1: 3) |
| Vorgabe | Stufe 1 ist vorgewählt. |

Das Wort für "Stufe" kommt aus dem Paket, nicht aus dem Builder.

**Später ändern:** Stufe ist über die Schrittliste jederzeit änderbar. Höher → neue Schritte erscheinen mit Hinweis (2.2). Niedriger → Dialog wie in 2.5: "Bei Stufe 1 fallen diese Wahlen weg: Spezialisierung, 1 Kniff. Sie bleiben gemerkt, falls du wieder Stufe 3 nimmst."

**Zurück:** zu "Regelwerk wählen" bzw. "Meine Charaktere".

### 4.5 Steps from the package

Der Builder baut die Schrittliste so:

1. Nimm die Schritte aus `flow.steps` des Pakets, in dieser Reihenfolge.
2. Lass jeden Schritt weg, dessen Bedingung (`when`) nicht erfüllt ist. Beispiel: `when: level >= 3`.
3. Füge für jede gewählte Option deren gewährte Wahlen (`grants` mit `choice`) als eigene Schritte ein, direkt hinter dem Schritt, in dem die Option gewählt wurde. Nur bis zur gewählten Stufe.
4. Fasse Wahlen zusammen, die das Paket als `group` markiert, damit nicht zehn Mini-Schritte entstehen.

Für jeden Schritt zeigt der Rahmen aus Abschnitt 2 die Frage, die Einleitung, die Optionen und die Erklärungen aus dem Paket.

Das Beispiel in Abschnitt 6 zeigt eine vollständige Schrittfolge.

### 4.6 Summary ("Is everything done?")

Letzter Schritt vor dem Druck. Immer da, aus jedem Paket.

| Teil | Inhalt |
| --- | --- |
| Frage | Ist alles so, wie du es willst? |
| Abschnitte | Ein Abschnitt pro Schritt, mit Überschrift = Schrittname, darunter die Wahl(en) in einem Satz. Rechts "Ändern" → springt in diesen Schritt und kommt danach mit "Zurück zum Überblick" hierher zurück. |
| Werte | Die berechneten Hauptwerte (aus dem Paket: `summary.fields`), gross, mit Glossar-Verweis |
| Offen | Gibt es offene Pflicht-Schritte: oranger Kasten oben: "Noch 2 Dinge offen: Kniffe, Name. [Zu Kniffe]". Drucken ist dann gesperrt, mit diesem Grund daneben. |
| Fehler vom Regelkern | Wenn der Regelkern einen Widerspruch meldet: roter Kasten mit dem Paket-Text und Link zum Schritt. Darf in Phase 1 nicht vorkommen, muss aber gestaltet sein. |
| Knopf | Charakter fertigstellen und drucken |

### 4.7 Print (the end)

Das Ende prägt die Erinnerung an alles davor. *(Peak-End Rule)*

| Teil | DE |
| --- | --- |
| Überschrift | Mira ist fertig! |
| Text | Druck dir den Bogen und die Karten aus. Nimm sie zum Spielabend mit. |
| Vorschau | Kleines Bild der ersten Seite (vom Server gerendert) |
| Knopf (gross) | PDF herunterladen |
| Inhalt-Info | "3 Seiten: Charakterbogen (1 Seite), Kniff-Karten (2 Seiten)." |
| Druck-Tipp | "Drucke auf A4, in Originalgrösse (100 %). Schneide die Karten an den Linien aus." |
| Danach | [Zu meinen Charakteren] [Noch einen bauen] |

Ladezustand des PDF: Knopf zeigt "PDF wird erstellt …" mit Fortschritt, wenn > 1 s. Fehler: "Das PDF konnte nicht erstellt werden. [Nochmal versuchen]". Kein Konfetti, keine Animation, die nicht abschaltbar ist. Bei `prefers-reduced-motion` keine Bewegung.

Der Charakter bleibt danach bearbeitbar ("Ansehen" → Überblick → "Ändern"). Fertig ist kein Schloss.

### 4.8 Settings

Erreichbar über das Menü ☰ von überall. Eine einzige Seite, kurze Abschnitte.

| Abschnitt | Inhalt | Verhalten |
| --- | --- | --- |
| Sprache | Auswahl der Sprachen, die das Paket und der Builder haben | Gilt sofort. Alle Texte wechseln. Der Charakter bleibt gleich. |
| Längen | Meter / Fuss (Segment-Knopf) | Gilt sofort, überall: Builder, Bogen, Karten. Darunter ein Beispiel aus der Umrechnungstabelle des Pakets: "Beispiel: 9 m" bzw. "Beispiel: 30 Fuss". |
| Gewichte | Kilogramm / Pfund | wie Längen |
| Passwort | "Neues Passwort schicken". Text: "Wir schicken dir ein neues Passwort. Das alte gilt dann nicht mehr." | Bestätigungsdialog, dann Meldung "Neues Passwort ist unterwegs." |
| Abmelden | Knopf | Sofort, zurück zu Anmelden |
| Was wir speichern | Kurzer Text, Link zur Datenschutzseite | — |
| Konto löschen | Knopf in Rot, ganz unten | Dialog (siehe unten) |

**Vorgaben beim ersten Anmelden:** Deutsch → Meter und Kilogramm. Englisch → Fuss und Pfund. Wer die Sprache später wechselt, behält seine Einheiten. Die Einheiten springen **nicht** mit. *(Plan 5.6, Abnahme 10)*

**Konto löschen** — Dialog:
> **Konto wirklich löschen?**
> Wir löschen deine Mailadresse, deine Einstellungen und alle 3 Charaktere. Das kann man nicht rückgängig machen.
> Tippe zum Bestätigen LÖSCHEN ein. [Feld]
> [Abbrechen] [Konto löschen]

Das Bestätigungswort kommt aus der Übersetzung (EN: DELETE). Danach: Seite "Dein Konto ist gelöscht." mit Link zur Startseite.

### 4.9 Language choice

- Die Sprachen heissen in der Auswahl **in ihrer eigenen Sprache**: "Deutsch", "English". Das ist die einzige Stelle, an der ein Wort einer anderen Sprache erscheint. Grund: Wer aus Versehen auf Englisch gestellt hat, muss "Deutsch" wiederfinden, ohne Englisch zu können. *(Recognition over Recall; übliche Praxis, z. B. bei Betriebssystemen)* Jede Option trägt `lang="de"` bzw. `lang="en"`, damit Screenreader richtig vorlesen.
- Kein Flaggen-Symbol. Flaggen sind Länder, nicht Sprachen.
- Erreichbar: Einstellungen, und vor dem Anmelden oben rechts.

---

## 5. What the package must provide for the flow

Anforderungen an das Paketformat (AND-4). Die Namen der Felder sind Vorschläge. Archivar entscheidet die endgültige Form, die Bedeutung muss erhalten bleiben.

| Bedarf | Vorschlag im Paket | Wofür im Ablauf |
| --- | --- | --- |
| Reihenfolge der Schritte | `flow.steps[]` mit `id`, `kind` (eine der 6 Arten), `source` (Liste der Dinge oder feste Optionen), `count` (bei `pickMany`/`distribute`) | 4.5 |
| Bedingung für einen Schritt | `when` (Ausdruck des Regelkerns, z. B. `level >= 3`) | 4.5, 4.4 |
| Abhängigkeiten zwischen Wahlen | `requires` an einer Option (z. B. nur mit Beruf X) | Filter der Optionen, 2.5 |
| Was eine Option mitbringt | `grants[]`: feste Dinge und neue Wahlen, jeweils mit `atLevel` | 4.5, "Was man bekommt" |
| Empfehlung | `recommended: true` an Optionen; `recommendedSet` bei `pickMany` | Abzeichen, "Für mich wählen" |
| Gruppen in langen Listen | `group` an Optionen + Gruppen-Texte | 3 (≤ 7 sichtbar) |
| Texte pro Option | Schlüssel `name`, `short`, `goodIf`, `explain`, `rules` | 3 |
| Texte pro Schritt | Schlüssel `title` (kurzer Name), `question`, `intro`, `missing` (Grund, wenn unvollständig) | 2 |
| Glossar-Verweise | Markierung im Text, z. B. `[[glossary:stamina|Ausdauer]]` | 3 |
| Mengen mit Einheit | Platzhalter mit Quellwert, z. B. `{{length:30}}`, `{{weight:5}}`; Umrechnungstabelle im Paket | Alle Texte, Druck |
| Überblick | `summary.fields`: welche berechneten Werte im Überblick gross erscheinen | 4.6 |
| Zusammenfassung für die Liste | `summary.line`: z. B. "{profession} · Stufe {level}" | 4.2 |
| Namensvorschläge | Liste pro Sprache | `text` mit "Vorschlag würfeln" |
| Druck | siehe Dokument `print-layout.md` | — |

Ohne `recommended` funktioniert alles, es fehlen dann nur "Empfohlen" und "Für mich wählen". Ohne `explain` lehnt die Paket-Prüfung das Paket ab: Jede Option braucht eine Klartext-Erklärung (Plan, Grundsatz 1).

---

## 6. Worked example: Nebelland, level 3

Erfundene Welt, nur zur Anschauung. Sieben Schritte nach der Stufe.

| # | Schritt (Name) | Art | Frage | Was fällt | Erklärung (Kurz) | Zurück |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Herkunft | `pickOne` (4 Optionen) | Woher kommt dein Charakter? | Moorvolk, Bergvolk, Küstenvolk, Waldvolk | Moorvolk: "Du kennst jeden Weg durch Nebel und Schlamm." | zur Stufe |
| 2 | Beruf | `pickOne` (3) | Womit verdient dein Charakter sein Brot? | Laternenträgerin, Flussläufer, Kräuterkundige | Laternenträgerin: "Du bringst Licht ins Dunkel und hältst die Gruppe zusammen." Gut, wenn: du anderen helfen willst. | zu Herkunft |
| 3 | Was dir dein Beruf schenkt | `info` | Das kannst du jetzt | — (Liste aus `grants`, z. B. "Laternenstab", "Ausdauer: 8") | "Ausdauer" ist Glossar-Wort: antippen erklärt es | zu Beruf |
| 4 | Spezialisierung | `pickOne` (2), nur bei Stufe ≥ 3, gewährt von "Laternenträgerin" | Worauf hat sich Mira spezialisiert? | Wächterin des Lichts, Wegfinderin | Wegfinderin: "Ihr verlauft euch nie. Du findest immer einen Weg." | zu Schritt 3 |
| 5 | Grundwerte | `distribute` (27 Punkte auf 4 Werte: Kraft, Geschick, Klugheit, Herz) | Worin ist Mira stark? | Punkte | Herz: "Wie gut du andere überzeugst und tröstest." Rechts: "Für mich wählen" verteilt nach Empfehlung des Berufs | zu 4 |
| 6 | Kniffe | `pickMany` (3 aus 9, in 2 Gruppen) | Welche Kniffe kann Mira? | z. B. Funkenregen, Nebelschritt, Stilles Wort | Nebelschritt: "Du verschwindest in einer Nebelwolke und tauchst {{length:30}} weiter wieder auf." → DE (Meter): "… 9 m weiter …", EN (Fuss): "… 30 feet away …" | zu 5 |
| 7 | Name und Aussehen | `text` ×2 | Wie heisst dein Charakter? | Freitext, "Vorschlag würfeln" | — | zu 6 |
| — | Überblick | Builder | Ist alles so, wie du es willst? | — | — | zu 7 |

**Zurück-Fall durchgespielt:** Spieler ist bei Schritt 6, geht in der Schrittliste auf "Beruf" und wählt "Flussläufer". Dialog 2.5 nennt: "Spezialisierung, Kniffe (3 gewählt)". Spieler bestätigt. Schritt 3 zeigt jetzt Flussläufer-Geschenke. Schritt 4 wird "Spezialisierung" mit Flussläufer-Optionen, markiert "!". Schritt 6 ist "!" mit 0 von 3. Grundwerte und Name bleiben. Geht der Spieler zurück auf "Laternenträgerin", sind Wegfinderin und die drei Kniffe wieder da.

**Zeitbudget** (Ziel < 20 min, geschätzt für einen Neuling mit Empfehlungen):
Anmelden 2 min · Stufe 0,5 · Herkunft 2 · Beruf 3 · Geschenke 1 · Spezialisierung 1,5 · Grundwerte 3 (mit "Für mich wählen" 0,5) · Kniffe 4 · Name 1 · Überblick 1 · Drucken 0,5 = **ca. 19 min**. Knapp. Deshalb sind Empfehlungen und "Für mich wählen" Pflicht-Teile der Oberfläche, nicht Extras. Prüfung im Test mit echten Menschen (AND-9).

---

## 7. Keyboard and screen reader (all screens)

- Reihenfolge des Fokus = Lesereihenfolge. Erster Tab-Stopp: "Zum Inhalt springen".
- Jede Frage ist eine `<fieldset>` mit `<legend>` = Frage. Karten sind echte Radio-/Checkbox-Elemente, nur gestaltet.
- Bei Schrittwechsel: Fokus auf die Überschrift der neuen Frage. Seitentitel = "Frage — Schritt 3 von 7 — Name des Produkts".
- Speicherstatus und Validierungsmeldungen über `aria-live="polite"`. Fehler über `role="alert"`.
- Dialoge: Fokus gefangen, Escape schliesst (= sicherer Weg), Fokus kehrt zum Auslöser zurück.
- Kein Bedienelement nur per Wisch-Geste oder Hover erreichbar.

## 8. Out of scope for phase 1

Aufstufen bestehender Charaktere, Kampagnen, Live-Hilfe, "Originalbegriffe einblenden", Bilder hochladen. Der Rahmen oben ist so gebaut, dass Aufstufen später nur "Stufe ändern + neue Schritte" ist.
