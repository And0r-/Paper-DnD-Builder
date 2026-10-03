# Writing style guide (German and English)

> **Note:** File names and headings are in English. The body text is in German, because the first target audience and the project owner read German. An English version may follow.

> Gilt für: alle Oberflächentexte im Builder (AND-7), alle Klartext-Erklärungen und Glossar-Einträge in den Paketen (Demo-Paket und Regelwerk-Pakete).
> Gilt **nicht** für den offiziellen Regeltext eines Regelwerks. Der bleibt Wort für Wort, wie er ist (Plan, Abnahme 11). Unsere Erklärungen stehen daneben, nie stattdessen.
> Stand: Revision 1. Autor: Gestalter.

## 1. Who we write for

Für eine Person, die noch nie ein Rollenspiel gespielt hat. Sie liest auf dem Handy. Sie ist vielleicht müde, vielleicht zwölf, vielleicht spricht sie die Sprache als Zweitsprache. Sie will spielen, nicht lernen.

Prüffrage für jeden Satz: **Versteht sie das beim ersten Lesen, ohne etwas anderes zu kennen?**

## 2. The twelve rules

| # | Regel | Deutsch | Englisch |
| --- | --- | --- | --- |
| 1 | **Kurze Sätze.** | Im Schnitt ≤ 12 Wörter. Nie mehr als 20. | Im Schnitt ≤ 12 Wörter. Nie mehr als 20. |
| 2 | **Ein Gedanke pro Satz.** | Kein "und" zwischen zwei Gedanken. Lieber zwei Sätze. | Same. Split sentences at "and", "which", "so that". |
| 3 | **Lesestufe eines Zwölfjährigen.** | Flesch-Index (Amstad) ≥ 65 pro Eintrag. | Flesch-Kincaid Grade ≤ 6 pro Eintrag. |
| 4 | **Anrede: du.** | "du", klein geschrieben. Nie "Sie", nie "man", wenn "du" geht. | "you". Never "the player", never "one". |
| 5 | **Aktiv.** | "Du würfelst." Nicht: "Es wird gewürfelt." | "You roll." Not: "A roll is made." |
| 6 | **Verben statt Hauptwörter.** | "Du kannst dich verstecken." Nicht: "Die Möglichkeit des Versteckens." | "You can hide." Not: "Hiding capability." |
| 7 | **Kein Fachwort ohne Erklärung an derselben Stelle.** | Entweder Glossar-Verweis oder direkt in Klartext ersetzen. | Same. |
| 8 | **Was es am Tisch bedeutet.** | Jede Erklärung sagt, was der Spieler damit *tut* oder *erlebt*. Nicht nur, was die Regel sagt. | Same. |
| 9 | **Zahlen als Ziffern.** | "3 Kniffe", nicht "drei Kniffe". Ausnahme: "ein" / "eine" im Fliesstext. | "3 tricks". Exception: "a" / "one" in running text. |
| 10 | **Einheiten nie fest.** | Immer Platzhalter: `{{length:30}}`, `{{weight:5}}`. Nie "9 m" oder "30 Fuss" im Text. | Same. Never "30 feet" in the text. |
| 11 | **Eine Sprache.** | Keine englischen Wörter. Kein "Skill", "Build", "Feature", "Login". | No German or other-language words. |
| 12 | **Kein Druck, keine Herablassung.** | Nicht: "einfach", "natürlich", "offensichtlich", "nur noch", "Pflicht!". Keine Ausrufezeichen ausser bei echter Freude (Ende). | Not: "simply", "just", "obviously", "of course". |

**Wie prüfen?** Regel 1, 3 und 10 lassen sich maschinell prüfen. Vorschlag für AND-5: ein kleiner Prüfschritt im Konverter, der Satzlänge, Lesbarkeits-Index und feste Einheiten ("m", "Fuss", "ft", "feet", "kg", "lb", "Pfund") meldet. Er meldet, er blockiert nicht. Die übrigen Regeln prüft ein Mensch.

## 3. Structure of a plain-language explanation

Jede Option und jeder Glossar-Eintrag hat dieselben Teile. Immer in dieser Reihenfolge. *(Similarity, Mental Model: wer einen Eintrag gelesen hat, kann alle lesen)*

| Teil | Schlüssel | Länge | Inhalt | Wo sichtbar |
| --- | --- | --- | --- | --- |
| **Name** | `name` | ≤ 30 Zeichen | So heisst es. Bei Regelwerk-Paketen: der offizielle Begriff. | überall |
| **Kurz** | `short` | 1 Satz, ≤ 120 Zeichen | Was es dir bringt, in einem Satz. Beginnt mit "Du …" oder beschreibt das Erlebnis. | Wahl-Karte, Glossar-Hinweis, Karte |
| **Was es ist** | `explain.what` | 1–2 Sätze | Die Sache selbst, ohne Fachwort. | "Mehr erfahren", Glossar-Blatt |
| **Am Tisch** | `explain.table` | 1–2 Sätze | Was du am Spieltisch tust oder erlebst. Wann es wichtig wird. | "Mehr erfahren", Glossar-Blatt |
| **Beispiel** | `explain.example` | 1 Satz | Eine kleine Szene. Beginnt mit "Beispiel:" (EN: "Example:"). | "Mehr erfahren", Glossar-Blatt |
| **Gut, wenn …** | `goodIf` | 1 Satz, ≤ 80 Zeichen, optional | Für wen das passt. Nur bei Optionen, die man wählt. | Wahl-Karte |

Gesamtlänge von "Was es ist" + "Am Tisch" + "Beispiel": **≤ 400 Zeichen**. Wer mehr braucht, erklärt zu viel auf einmal. Dann gehört ein Teil in einen eigenen Glossar-Eintrag.

**Zum Vergleich: so nicht.**

> ✗ "Ausdauer stellt eine Ressource dar, deren Verringerung auf 0 den Zustand Erschöpft auslöst, sofern keine anderen Effekte greifen."

Fehler: Hauptwörter statt Verben, "Ressource" und "Zustand" ohne Erklärung, keine Bedeutung am Tisch, 20 Wörter in einem Satz.

> ✓ "Ausdauer zeigt, wie viel du noch aushältst. Jeder Treffer kostet Ausdauer. Bei 0 kannst du nicht mehr weiterkämpfen."

## 4. Words that never stand without explanation

Diese Wörter dürfen vorkommen, aber **nur** mit Glossar-Verweis oder mit der Erklärung im selben Satz. Die Liste gilt für alle Pakete. Jedes Paket ergänzt seine eigenen Regelwörter.

### 4.1 General role-playing words (any package)

| Wort (DE) | Wort (EN) | Ersatz oder Erklärung, Beispiel |
| --- | --- | --- |
| Kreatur | creature | "jedes Lebewesen — auch du und deine Mitspieler" |
| Spielleiter / Spielleiterin | game master | "die Person, die das Spiel leitet und die Welt beschreibt" |
| Charakter | character | "die Figur, die du spielst" (beim ersten Vorkommen pro Bildschirm) |
| Wurf, würfeln gegen | roll, roll against | "Du würfelst. Ist die Zahl hoch genug, klappt es." |
| W6, W8, W20 … | d6, d8, d20 … | "ein Würfel mit 6 Seiten" (Glossar-Eintrag "Würfel-Schreibweise") |
| Bonus, Malus, +2 | bonus, penalty, +2 | "Du zählst 2 zu deinem Wurf dazu." |
| Modifikator | modifier | ersetzen durch "Zahl, die du zum Wurf dazuzählst" |
| Runde, Zug | round, turn | "Im Kampf ist jeder der Reihe nach dran. Dein Zug ist, wenn du dran bist." |
| Reichweite | range | "wie weit es reicht: {{length:30}}" |
| Dauer | duration | "wie lange es wirkt" |
| Stufe | level | "wie erfahren dein Charakter ist" |
| Eigenschaft / Merkmal | trait / feature | ersetzen durch "Fähigkeit" oder konkret sagen, was es tut |
| Ressource | resource | ersetzen: sagen, was verbraucht wird |
| Rast | rest | "eine Pause im Spiel, in der dein Charakter sich erholt" |
| Probe | check | "ein Wurf, ob etwas klappt" |

### 4.2 Technical words in the UI (never use)

| Nicht | Sondern (DE) | Sondern (EN) |
| --- | --- | --- |
| Login, einloggen | Anmelden | Sign in |
| Logout | Abmelden | Sign out |
| Account, Konto erstellen | Konto (nur in Einstellungen) | account |
| Session, Token | — (nie zeigen) | — |
| Entwurf, Draft | "noch nicht fertig", "Schritt 4 von 7" | "not finished yet" |
| Validierung, ungültig | "Da fehlt noch etwas", "Das passt nicht" | "Something is missing", "That doesn't fit" |
| Error, Fehler 500 | "Das hat nicht geklappt." + was jetzt tun | "That didn't work." + what to do |
| Paket, Package | "Regelwerk" oder "Spiel" | "rule set" or "game" |
| Build, Char, Stats, Feature | Charakter, Werte, Fähigkeit | character, scores, ability |
| Upload, Download | herunterladen (nur beim PDF) | download |
| Optional | "kannst du weglassen" | "you can skip this" |

## 5. UI microcopy

| Element | Regel | DE Beispiel | EN Beispiel |
| --- | --- | --- | --- |
| Knopf | Verb zuerst, sagt das Ergebnis. ≤ 3 Wörter. | Passwort schicken | Send password |
| Feld-Label | Steht über dem Feld, nie nur als Platzhalter im Feld. | Deine Mailadresse | Your email address |
| Frage im Schritt | Eine Frage mit Fragezeichen. Nennt den Charakter beim Namen, sobald er einen hat, sonst "dein Charakter". | Womit verdient Mira ihr Brot? | How does Mira earn a living? |
| Fehlermeldung | Was ist passiert + was jetzt tun. Kein "Fehler:", keine Schuld. | Das Passwort passt nicht. Prüfe die vier Wörter und die Zahl. | The password doesn't match. Check the four words and the number. |
| Leerer Zustand | Sagt, was hier hinkommt, und gibt den einen nächsten Schritt. | Hier wohnen bald deine Charaktere. [Ersten Charakter bauen] | Your characters will live here. [Build your first character] |
| Bestätigung | Titel als Frage. Knöpfe sagen, was passiert (nie "OK" / "Ja"). | Beruf ändern? [Nein, behalten] [Ja, ändern] | Change job? [No, keep it] [Yes, change] |
| Fortschritt | Zahl und Gesamtzahl. | Schritt 3 von 7 | Step 3 of 7 |

**Geschlechtergerechte Sprache (DE).** Wir sprechen den Spieler mit "du" an. Damit fällt die Frage meist weg. Wo eine Person in der 3. Person vorkommt: Paarform ("Spielleiterin oder Spielleiter") beim ersten Vorkommen, danach neutral ("die Person, die das Spiel leitet"). Kein Sternchen, kein Doppelpunkt: Screenreader lesen sie schlecht vor, und sie erschweren Zweitsprachlern das Lesen. Der Charakter wird so angesprochen, wie der Spieler ihn eingestellt hat; ohne Angabe mit seinem Namen statt mit Pronomen.

## 6. English version: specifics

- Plain English, US- oder UK-Schreibung einheitlich pro Paket (Vorschlag: US).
- Kurze Wörter vor langen: "use" statt "utilize", "help" statt "assist".
- Kontraktionen sind erwünscht: "you'll", "don't". Sie klingen freundlich und sind leichter.
- Die englische Fassung ist **keine Übersetzung** der deutschen, sondern ein eigener Text nach denselben Regeln. Inhalt und Aufbau gleich, Sätze dürfen anders sein.

## 7. Five example entries (fictional, Nebelland)

Alle fünf folgen dem Aufbau aus Abschnitt 3. Archivar nutzt sie als Muster.

### 7.1 Ausdauer (glossary)

| Teil | DE | EN |
| --- | --- | --- |
| `name` | Ausdauer | Stamina |
| `short` | Wie viel du noch aushältst, bevor du aufgeben musst. | How much you can take before you have to give up. |
| `explain.what` | Ausdauer ist eine Zahl auf deinem Bogen. Jeder Treffer zieht etwas davon ab. | Stamina is a number on your sheet. Every hit takes some of it away. |
| `explain.table` | Schreib die Zahl mit Bleistift auf. Wirst du getroffen, radierst du und schreibst die neue Zahl hin. Bei 0 kannst du nicht weiterkämpfen. | Write the number in pencil. When you get hit, erase it and write the new number. At 0, you can't keep fighting. |
| `explain.example` | Beispiel: Du hast 8 Ausdauer. Ein Wolf beisst dich für 3. Jetzt hast du 5. | Example: You have 8 stamina. A wolf bites you for 3. Now you have 5. |

### 7.2 Nebelschritt (option in "Kniffe")

| Teil | DE | EN |
| --- | --- | --- |
| `name` | Nebelschritt | Mist Step |
| `short` | Du verschwindest im Nebel und tauchst ein Stück weiter wieder auf. | You vanish into mist and appear a short way off. |
| `goodIf` | Gut, wenn du schnell aus Gefahr kommen willst. | Good if you want to get out of danger fast. |
| `explain.what` | Ein Kniff, mit dem du dich ohne Laufen bewegst. Du landest an einem Ort, den du sehen kannst, bis {{length:30}} entfernt. | A trick that moves you without walking. You land in a spot you can see, up to {{length:30}} away. |
| `explain.table` | Sag in deinem Zug: "Ich nutze Nebelschritt." Zeig auf der Karte, wo du landest. Danach ist der Kniff verbraucht bis zur nächsten Rast. | On your turn, say: "I use Mist Step." Point to where you land. Then the trick is used up until your next rest. |
| `explain.example` | Beispiel: Zwei Wachen stellen dich in einer Gasse. Du trittst in den Nebel und stehst plötzlich auf dem Dach. | Example: Two guards trap you in an alley. You step into the mist and suddenly stand on the roof. |

Anzeige mit Einstellung Meter: "bis 9 m entfernt". Mit Fuss: "up to 30 feet away" bzw. DE "bis 30 Fuss entfernt".

### 7.3 Laternenträgerin (option in "Beruf")

| Teil | DE | EN |
| --- | --- | --- |
| `name` | Laternenträgerin | Lantern Bearer |
| `short` | Du bringst Licht ins Dunkel und hältst die Gruppe zusammen. | You bring light into the dark and keep the group together. |
| `goodIf` | Gut, wenn du anderen helfen willst. | Good if you like helping others. |
| `explain.what` | Ein Beruf für Leute, die vorangehen. Du trägst einen Laternenstab und kennst Kniffe, die heilen und schützen. | A job for people who lead the way. You carry a lantern staff and know tricks that heal and protect. |
| `explain.table` | Am Tisch bist du oft die Person, die andere wieder auf die Beine bringt. Du entscheidest selten allein, du hilfst mit. | At the table, you often get others back on their feet. You rarely act alone. You help. |
| `explain.example` | Beispiel: Dein Freund liegt am Boden. Du hebst die Laterne und gibst ihm 4 Ausdauer zurück. | Example: Your friend is down. You raise your lantern and give back 4 stamina. |

### 7.4 Glücksmarke (glossary)

| Teil | DE | EN |
| --- | --- | --- |
| `name` | Glücksmarke | Luck Token |
| `short` | Eine Marke, mit der du einen schlechten Wurf wiederholen darfst. | A token that lets you redo a bad roll. |
| `explain.what` | Du bekommst Glücksmarken für gute Ideen im Spiel. Du kannst höchstens 3 haben. | You get luck tokens for good ideas in play. You can hold up to 3. |
| `explain.table` | Hast du schlecht gewürfelt, gib eine Marke ab und würfle nochmal. Die Spielleitung gibt dir neue, wenn du etwas Mutiges oder Lustiges tust. | After a bad roll, hand in a token and roll again. The game master gives you new ones when you do something brave or funny. |
| `explain.example` | Beispiel: Du würfelst eine 2 beim Klettern. Du gibst eine Glücksmarke ab und würfelst eine 14. Du kommst hoch. | Example: You roll a 2 while climbing. You hand in a luck token and roll a 14. You make it up. |

### 7.5 Dice notation (glossary)

| Teil | DE | EN |
| --- | --- | --- |
| `name` | W6, W8, W20 | d6, d8, d20 |
| `short` | So schreiben wir, welchen Würfel du nimmst. | This is how we write which die to use. |
| `explain.what` | "W" heisst Würfel. Die Zahl dahinter sagt, wie viele Seiten er hat. Eine Zahl davor sagt, wie viele du wirfst. | "d" means die. The number after it says how many sides it has. A number in front says how many to roll. |
| `explain.table` | Steht auf deiner Karte "2W6", nimmst du zwei Würfel mit 6 Seiten und zählst zusammen. | If your card says "2d6", roll two six-sided dice and add them up. |
| `explain.example` | Beispiel: "1W8 + 2" heisst: Wirf einen Würfel mit 8 Seiten und zähl 2 dazu. | Example: "1d8 + 2" means: roll one eight-sided die and add 2. |

Hinweis: Das Zeichen "W" bzw. "d" kommt aus der Übersetzungsdatei des Pakets, nicht aus dem Builder.

## 8. Checklist for content authors (per entry)

- [ ] Alle Teile aus Abschnitt 3 vorhanden, in der Reihenfolge.
- [ ] Kurz ≤ 120 Zeichen, Gut-wenn ≤ 80, Erklärung zusammen ≤ 400.
- [ ] Kein Satz über 20 Wörter.
- [ ] Jedes Wort aus Liste 4.1 (und aus der Wortliste des Pakets) hat einen Glossar-Verweis.
- [ ] Keine Einheit fest im Text, nur Platzhalter.
- [ ] "Am Tisch" sagt, was der Spieler tut, nicht nur, was die Regel ist.
- [ ] Beispiel ist eine kleine Szene mit konkreten Zahlen.
- [ ] Deutsch enthält kein englisches Wort. Englisch kein deutsches.
- [ ] Laut vorgelesen klingt es wie ein freundlicher Mensch am Tisch.
