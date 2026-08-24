# GrindPilot FC26

Eine einheitliche, lokal laufende Chrome-/Edge-Extension für SBC-Grinds in der
EA SPORTS FC 26 Web App. AutoPilot-SBC bleibt die kanonische Basis und der
vorhandene Browser-Solver bleibt Standard. GrindPilot ergänzt eine persistente
Workflow-State-Machine, Reward-/Inventar-Domänen, Schutzrichtlinien, Profile,
Aktivitätslogs und eine einzige gemeinsame Oberfläche.

## MVP-Workflow

Über den einklappbaren `GP`-Button läuft ein begrenzter, überprüfter Ablauf:

1. aktuelles SBC lösen;
2. Squad vor dem Submit erneut gegen Challenge, Lösung und Schutzkarten prüfen;
3. Reward claimen und genau einem neuen, bereits besessenen Pack zuordnen;
4. nur dieses erlaubte Reward-Pack öffnen;
5. Player Picks erkennen und bei fehlender sicherer Entscheidung pausieren;
6. normale Karten zum Club und geeignete untradeable Duplikate in den SBC
   Storage verschieben;
7. bei Rest-Duplikaten pausieren;
8. höchstens die bestätigte Anzahl Wiederholungen ausführen.

REVIEW erstellt nur die Vorschau. ASSISTED fragt vor destruktiven Schritten.
AUTO zeigt vor dem Start eine Zusammenfassung und bindet die einmalige
Bestätigung an exakt diese Workflow-Version und ihren Hash.

## Was bewusst kombiniert wurde

Aus AutoPilot-SBC stammen das Manifest-V3-Grundgerüst, die EA-Web-App-Adapter,
Single-/Multi-/Set-/Sequence-Flows, lokale Einstellungen, Inventar-Caches,
Concept-Fallbacks und der browserlokale JavaScript-Solver.

Aus Auto-SBC wurden die nützlichen Policy-Ideen neu und ohne Python-Backend
umgesetzt:

- bevorzugte Spieler können als Ersatzwert `0` behandelt werden;
- Duplikate, Storage-Karten und Untradeables erhalten konfigurierbare
  Wertabschläge;
- vorhandene Squad-Slots bleiben als Solver-Startpunkt erhalten;
- harte Requirements werden vor dem Anwenden erneut validiert.

Nicht übernommen wurden das offene FastAPI-Backend, Remote-CDN-Skripte,
CSV-Exports des Clubinventars, Markt-/Trading-Automation und die fehlerhafte
CP-SAT-Chemistry-Implementierung. GrindPilot kauft keine Packs und speichert
keine EA-Anmeldedaten.

## Sicherheits- und Korrektheitsverbesserungen

- unbekannte oder noch nicht implementierte SBC-Anforderungen schlagen jetzt
  sicher fehl, statt eine ungeprüfte Lösung als gültig zu markieren;
- eine 11er-Anforderung kann nicht mehr mit nur 10 verfügbaren Spielern als
  gelöst gelten;
- `max 0` und `exact 0` werden als echte Constraints behandelt;
- bevorzugte Positionen bleiben gültig, auch wenn EA sie nicht zusätzlich im
  Alternative-Positionen-Array liefert;
- echte Background-Readiness-Prüfung statt eines simulierten `INIT`;
- getrennte Solver-Request/Response-Typen, Operations-Allowlist, Payload- und
  Tiefenlimits sowie abgestimmte Timeouts bis 120 Sekunden;
- FUT.GG-Requests besitzen Eingabe-Allowlisting, ein 25-Sekunden-Gesamtbudget
  und kurze Backoffs für Transportfehler statt falschem 10-Minuten-Negativcache;
- Content Script nur im Top Frame; Web-Ressourcen nur für die EA-Web-App;
- unbenutzte GLPK/WASM-Artefakte werden nicht ausgeliefert.

## Installation (unpacked)

1. Repository herunterladen oder klonen.
2. In Chrome/Edge `chrome://extensions` öffnen.
3. Entwicklermodus aktivieren.
4. **Entpackte Erweiterung laden** wählen und diesen Ordner auswählen.
5. Die FC-26-Web-App neu laden.

Es ist kein lokaler Python-Dienst erforderlich.

## Entwicklung

Voraussetzung: Node.js 20 oder neuer.

```bash
npm test
npm run check
```

`npm test` enthält Regressionstests für Solver, FC26-Rating, Identitäten,
Inventory, Storage, Duplikate, Schutzrichtlinien, Target Projects, Packs,
Player Picks, Profile, Workflow-Zustände/Recovery und Developer Mode.
`npm run check` validiert JavaScript-Syntax, Manifest-Assets und
Least-Privilege-Invarianten.

## Architektur

```text
EA Web App (MAIN world)
  page/ea-data-bridge.js     erhaltener AutoPilot-Controller-Adapter
  src/grindpilot-main.js     Domain-Orchestrierung und einheitliche UI
  src/workflow/              persistente explizite State Machine
  src/inventory|packs|...    kleine testbare Domänen
          ⇅ korrelierte, begrenzte Messages
Content Script (ISOLATED)
  content-script.js          Protokollprüfung und Extension-Grenze
          ⇅ Runtime Port
Background Service Worker
  background.js              Solver-Router, Storage, FUT.GG-Proxy
          ↓
solver/                      Compiler, Heuristik, Chemistry, Policies
```

Die detaillierten Entscheidungen stehen in
[`docs/upstream-analysis.md`](docs/upstream-analysis.md). Die verbleibende
Architektur ist in [`docs/architecture.md`](docs/architecture.md), die
State-Machine in [`docs/workflow-engine.md`](docs/workflow-engine.md)
dokumentiert.

## Datenschutz

Die Lösung läuft lokal im Browser. Einstellungen liegen in
`chrome.storage.local`. Preis- und Concept-Abfragen können Spieler-Definition-IDs
an FUT.GG übertragen; Requests werden ohne Cookies oder Zugangsdaten gesendet.
Details: [`PRIVACY.md`](PRIVACY.md).

## Grenzen

- Die Extension verwendet undokumentierte EA-Web-App-Controller; EA-Updates
  können Adapter und UI-Hooks brechen.
- Der aktuelle Squad-Selektor ist eine validierte Heuristik, kein mathematischer
  Optimalitätsbeweis. Ein sauber neu modellierter CP-SAT-Kern bleibt eine
  geplante zweite Engine.
- Die verifizierte EA-Controller-Oberfläche liefert derzeit keine vollständigen
  Player-Pick-Angebote. GrindPilot erkennt den Zustand und pausiert deshalb,
  statt eine Auswahl zu erraten.
- Sonderkarten mit eigenen Chemistry-Boost-Regeln benötigen reale FC-26-
  Golden-Fixtures, bevor sie sicher modelliert werden können.
- Das Tool ist inoffiziell, nicht mit EA verbunden und wird auf eigenes Risiko
  verwendet.

## Lizenz und Herkunft

GPL-3.0-only. Der GPL-Code stammt primär aus AutoPilot-SBC; ausgewählte Ideen
aus Auto-SBC (MIT) wurden adaptiert. Siehe [`LICENSE`](LICENSE) und
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
