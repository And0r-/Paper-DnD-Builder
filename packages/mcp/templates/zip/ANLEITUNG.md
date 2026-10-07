# Charakterbuilder mit einem Sprachmodell

Mit diesem Paket hilft dir ein Sprachmodell beim Charakterbuilder auf
**{{BASE_URL}}**. Du schreibst ihm zum Beispiel „Bau mit mir einen neuen
Charakter auf Stufe 3“ oder „Warum hat mein Charakter hier eine 8?“. Das
Sprachmodell liest dann deine Charaktere, erklärt Werte und trägt deine
Antworten ein.

Das Paket enthält keinen Zugangsschlüssel und nichts Persönliches. Es ist
für alle gleich. (English: see `README.md`.)

> **Datenschutz**
>
> - Das Programm in diesem Paket (`server.mjs`) spricht nur mit dem
>   Charakterbuilder auf {{BASE_URL}}. Mit niemandem sonst.
> - Das Sprachmodell wählst du selbst, in deinem Programm (zum Beispiel
>   Claude Desktop oder Cursor). **Dorthin gehen deine Charakterdaten**,
>   sobald das Sprachmodell sie liest. Was der Anbieter damit macht, steht
>   in seinen Bedingungen, nicht in unseren.
> - **Ein Zugangsschlüssel ist ein Passwort.** Gib ihn niemandem und lade
>   ihn nirgends hoch. Wenn jemand anderes diesen Server für dich betreibt,
>   kann er den Schlüssel benutzen, den du ihm schickst. Bei Verdacht:
>   Schlüssel zurückziehen.

## Zwei Arten

Dasselbe `server.mjs` läuft auf eine von zwei Arten. Welche, hängt davon ab,
ob ein Schlüssel eingetragen ist.

|                   | privat                                            | öffentlich                                                             |
| ----------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| Wann              | Schlüssel in `config.json` oder in `BUILDER_KEY`  | kein Schlüssel gesetzt                                                 |
| Verbindung        | dein Programm startet `node server.mjs` („stdio“) | `node server.mjs` wartet auf Port 8787, Adresse `/mcp` (HTTP)          |
| Wessen Charaktere | immer die des eingetragenen Schlüssels            | die des Schlüssels, den jede Anfrage mitschickt; ohne Schlüssel nichts |
| Für wen           | eine Person auf ihrem Rechner                     | wer den Server für mehrere betreibt                                    |

Beim Start schreibt es eine Zeile: `private, stdio` (privat) oder
`public, HTTP on port 8787` (öffentlich).

Einen Server mit fest eingetragenem Schlüssel über HTTP gibt es absichtlich
nicht: Jeder, der ihn erreicht, käme sonst in dein Konto.

## Dein Zugangsschlüssel

1. Melde dich auf {{BASE_URL}} an und öffne **Einstellungen →
   Zugangsschlüssel**.
2. Erzeuge einen neuen Schlüssel und kopiere ihn. Er beginnt mit `cbk_`. Er
   wird nur einmal angezeigt.

## Node installieren

Das Programm braucht Node, Version 20 oder neuer. Lade es hier herunter und
installiere es: <https://nodejs.org/>

Prüfen: Öffne ein Terminal (Windows: „Eingabeaufforderung“) und tippe
`node --version`. Es soll eine Zahl ab `v20` erscheinen.

Entpacke das Zip in einen Ordner, der bleibt, zum Beispiel
`Dokumente/charakterbuilder`. Merke dir den vollen Pfad zu `server.mjs`,
zum Beispiel `C:\Users\du\Documents\charakterbuilder\server.mjs` oder
`/Users/du/Documents/charakterbuilder/server.mjs`. Unten steht dafür
`PATH/server.mjs`.

## Privat: auf deinem Rechner

### Claude Desktop

1. Öffne in Claude Desktop **Einstellungen → Entwickler → Konfiguration
   bearbeiten**. Die Datei `claude_desktop_config.json` geht auf.
2. Kopiere den Eintrag `character-builder` aus der Datei
   `claude_desktop_config.json` in diesem Paket hinein (unter
   `mcpServers`).
3. Ersetze `PATH/server.mjs` durch deinen Pfad (unter Windows jeden `\`
   verdoppeln: `C:\\Users\\...`) und `KEY` durch deinen Schlüssel.
   Speichern und Claude Desktop neu starten.

### Andere Programme (Claude Code, Cursor, …)

1. Öffne `config.json` aus diesem Paket mit einem Texteditor. Setze deinen
   Schlüssel zwischen die Anführungszeichen hinter `"key"`, so:
   `"key": "cbk_..."`. Speichern.
2. Trage den Server in deinem Programm ein. Claude Code, im Terminal:

   ```sh
   claude mcp add character-builder -- node "PATH/server.mjs"
   ```

   Jedes andere Programm, das MCP über „stdio“ spricht, startet ihn mit
   `node PATH/server.mjs`.

3. Das Programm neu starten.

Statt `config.json` gehen auch die Umgebungsvariablen `BUILDER_BASE_URL`
und `BUILDER_KEY`.

## Öffentlich: für mehrere

1. Lass `"key"` in `config.json` leer und setze kein `BUILDER_KEY`.
2. Starte `node server.mjs`. Er wartet auf Port 8787 (ein anderer mit
   `PORT=9000 node server.mjs`), unter der Adresse `/mcp`.
3. Jede Person richtet ihn in ihrem Programm als HTTP-MCP-Server ein, mit
   der Adresse `http://dein-server:8787/mcp` und der Kopfzeile
   `Authorization: Bearer cbk_...` mit dem eigenen Schlüssel. Claude Code:

   ```sh
   claude mcp add --transport http character-builder http://dein-server:8787/mcp \
     --header "Authorization: Bearer cbk_..."
   ```

Ohne gültigen Schlüssel antwortet der Server mit `401` und tut nichts. Jede
Anfrage wird für sich geprüft; es gibt keine Sitzungen, darum läuft er
hinter jedem Proxy. Stell HTTPS davor (einen Proxy), wenn er aus dem
Internet erreichbar ist.

Browser dürfen ihn nur von Adressen aus aufrufen, die du erlaubst:
`ALLOWED_ORIGINS=https://example.org,https://andere.example`. Programme und
`curl` schicken keine solche Adresse und werden immer durchgelassen.

## Was das Sprachmodell kann

- deine Charaktere auflisten und lesen: Stufe, Werte, was sie haben, was
  noch offen ist
- erklären, woher eine Zahl kommt
- die offenen Wahlen zeigen, mit allen Optionen und Erklärungen aus dem
  Builder
- deine Antworten eintragen; der Builder prüft jede Antwort nach den Regeln
  und sagt, wenn eine nicht passt
- einen neuen Charakter anfangen, die Stufe ändern, einen fertigen
  Charakter aufstufen, einen Charakter abschliessen
- den Charakterbogen holen, als Daten oder als PDF

## Was es nicht kann

- Charaktere löschen, dein Konto löschen, Schlüssel verwalten
- Kampagnen
- in anderen Konten etwas sehen oder ändern: nur die Charaktere des
  Schlüssels
- die Regeln umgehen: was der Builder ablehnt, wird nicht gespeichert

Das Sprachmodell kann sich beim Erklären irren. Die Zahlen auf dem Bogen
rechnet immer der Builder aus, nicht das Sprachmodell.

## Schlüssel zurückziehen

Wenn du einen Schlüssel nicht mehr brauchst oder er in falsche Hände geraten
ist: Melde dich auf {{BASE_URL}} an, öffne **Einstellungen →
Zugangsschlüssel** und ziehe ihn zurück. Ab dann lehnt der Builder ihn
sofort ab.
