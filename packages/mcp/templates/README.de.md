# Charakterbuilder mit einem Sprachmodell

Mit diesem Paket hilft dir ein Sprachmodell auf deinem Rechner beim
Charakterbuilder. Du schreibst ihm zum Beispiel „Bau mit mir einen neuen
Charakter auf Stufe 3“ oder „Warum hat mein Charakter hier eine 8?“. Das
Sprachmodell liest dann deine Charaktere, erklärt Werte und trägt deine
Antworten ein.

{{#KEY}}
Das Paket gehört zu deinem Konto auf **{{BASE_URL}}**. Der Zugangsschlüssel
darin heisst in deinen Einstellungen **„{{KEY_NAME}}“**.
{{/KEY}}
{{^KEY}}
Das Paket gehört zum Charakterbuilder auf **{{BASE_URL}}**. Es enthält noch
keinen Zugangsschlüssel. So trägst du einen ein:

1. Melde dich auf {{BASE_URL}} an und öffne **Einstellungen →
   Zugangsschlüssel**.
2. Erzeuge einen neuen Schlüssel und kopiere ihn. Er beginnt mit `cbk_`.
3. Öffne die Datei `config.json` aus diesem Paket mit einem Texteditor.
   Setze den Schlüssel zwischen die Anführungszeichen hinter `"key"`, so:
   `"key": "cbk_..."`. Speichern.
{{/KEY}}

> **Datenschutz**
>
> - Das Programm in diesem Paket (`server.mjs`) spricht nur mit dem
>   Charakterbuilder auf {{BASE_URL}}. Mit niemandem sonst.
> - Das Sprachmodell wählst du selbst, in deinem Programm (zum Beispiel
>   Claude Desktop oder Cursor). **Dorthin gehen deine Charakterdaten**,
>   sobald das Sprachmodell sie liest. Was der Anbieter damit macht, steht
>   in seinen Bedingungen, nicht in unseren.
> - Die Datei `config.json` enthält deinen Zugangsschlüssel. **Der Schlüssel
>   ist ein Passwort.** Gib ihn niemandem und lade ihn nirgends hoch.

## 1. Node installieren

Das Programm braucht Node, Version 20 oder neuer. Lade es hier herunter und
installiere es: <https://nodejs.org/>

Prüfen: Öffne ein Terminal (Windows: „Eingabeaufforderung“) und tippe
`node --version`. Es soll eine Zahl ab `v20` erscheinen.

## 2. Zip entpacken

Entpacke das Zip in einen Ordner, der bleibt, zum Beispiel
`Dokumente/charakterbuilder`. Nicht im Ordner „Downloads“ lassen, den räumt
man gern auf.

Im Ordner liegen `server.mjs`, `config.json`,
`claude_desktop_config.json` und diese Anleitung. Merke dir
den vollen Pfad zu `server.mjs`, zum Beispiel
`C:\Users\du\Documents\charakterbuilder\server.mjs` oder
`/Users/du/Documents/charakterbuilder/server.mjs`. Unten steht dafür
`PFAD/server.mjs`.

## 3. In deinem Programm anmelden

Wähle dein Programm. Danach das Programm einmal neu starten.

### Claude Desktop

1. Öffne in Claude Desktop **Einstellungen → Entwickler → Konfiguration
   bearbeiten**. Es öffnet sich die Datei `claude_desktop_config.json`.
2. Kopiere das hier hinein (steht schon etwas unter `mcpServers`, füge nur
   den Eintrag `charakterbuilder` dazu):

   ```json
   {
     "mcpServers": {
       "charakterbuilder": {
         "command": "node",
         "args": ["PFAD/server.mjs"]
       }
     }
   }
   ```

3. Ersetze `PFAD/server.mjs` durch deinen Pfad (unter Windows jeden `\`
   doppelt: `C:\\Users\\...`), speichere und starte Claude Desktop neu.

### Claude Code

1. Öffne ein Terminal.
2. Tippe:

   ```sh
   claude mcp add charakterbuilder -- node "PFAD/server.mjs"
   ```

3. Starte Claude Code neu. Mit `/mcp` siehst du, ob `charakterbuilder`
   verbunden ist.

### Cursor

1. Öffne **Einstellungen → MCP → Neuen MCP-Server hinzufügen**. Es öffnet
   sich die Datei `mcp.json`.
2. Füge ein:

   ```json
   {
     "mcpServers": {
       "charakterbuilder": {
         "command": "node",
         "args": ["PFAD/server.mjs"]
       }
     }
   }
   ```

3. Ersetze den Pfad, speichere und starte Cursor neu.

### Andere Programme

Jedes Programm, das MCP über „stdio“ kann, startet den Server mit:

```sh
node PFAD/server.mjs
```

Die Adresse und der Schlüssel kommen aus `config.json` im selben Ordner.
Statt der Datei gehen auch die Umgebungsvariablen `BUILDER_BASE_URL` und
`BUILDER_KEY`.

## Was das Sprachmodell kann

- deine Charaktere auflisten und lesen: Stufe, Werte, was er hat, was noch
  offen ist
- erklären, woher eine Zahl kommt
- die offenen Wahlen zeigen, mit allen Optionen und Erklärungen aus dem
  Builder
- deine Antworten eintragen; der Builder prüft jede Antwort nach den Regeln
  und sagt, wenn eine nicht passt
- einen neuen Charakter anfangen, die Stufe ändern, einen fertigen
  Charakter aufstufen, fertigstellen
- den Charakterbogen holen, als Daten oder als PDF

## Was es nicht kann

- Charaktere löschen, dein Konto löschen, Schlüssel verwalten
- Kampagnen
- an anderen Konten etwas sehen oder ändern: nur deine eigenen Charaktere
- Regeln umgehen: was der Builder ablehnt, wird nicht gespeichert

Das Sprachmodell kann sich irren, wenn es erklärt. Die Zahlen auf dem Bogen
rechnet immer der Builder, nicht das Sprachmodell.

## Schlüssel zurückziehen

Wenn du das Paket nicht mehr brauchst oder der Schlüssel in fremde Hände
geraten ist:

1. Melde dich auf {{BASE_URL}} an.
2. Öffne **Einstellungen → Zugangsschlüssel**.
3. Ziehe den Schlüssel {{#KEY}}**„{{KEY_NAME}}“**{{/KEY}}{{^KEY}}aus `config.json`{{/KEY}} zurück.

Ab dann lehnt der Builder den Schlüssel sofort ab. Das Sprachmodell meldet
dann, dass der Schlüssel nicht mehr gilt. Lösche danach den Ordner mit
`server.mjs` und `config.json`.
