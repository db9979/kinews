/**
 * KiNews-Server: Express-HTTP-Server mit
 *  - REST-API: /api/nachrichten, /api/quellen, /api/status
 *  - Echtzeitkanal: /api/events (Server-Sent Events)
 *  - statisches Frontend aus ./frontend
 *  - Hintergrund-Scheduler (alle 5 Minuten, konfiguriert über Umgebungsvariablen)
 */
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QUELLEN } from "./src/quellen.js";
import { konfigurierung } from "./src/config.js";
import { Speicher } from "./src/speicher.js";
import { EventBus, erstelleSseKanal } from "./src/evente.js";
import { erstelleScheduler } from "./src/scheduler.js";
import { abrufeFeedHttp } from "./src/rss.js";
import { erstelleOfflineAbruf } from "./src/offline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const konfig = konfigurierung();
const log = (nachricht) => console.log(new Date().toISOString(), nachricht);

const speicher = new Speicher(konfig.dataDir, { maxArtikel: konfig.maxArtikel });
const ereignisse = new EventBus();

// Quellen filtern, falls QUELLEN_IDS gesetzt ist (Default: alle fünf).
let aktiveQuellen = QUELLEN;
const quelleIds = process.env.QUELLEN_IDS;
if (quelleIds) {
  const ids = quelleIds.split(",").map((s) => s.trim()).filter(Boolean);
  aktiveQuellen = QUELLEN.filter((q) => ids.includes(q.id));
  if (aktiveQuellen.length === 0) {
    log("[Warnung] QUELLEN_IDS nennt keine bekannte Quelle – nutze alle fünf.");
    aktiveQuellen = QUELLEN;
  }
}

// KINEWS_OFFLINE=1: Offline-Modus mit Beispieldaten (Demo/CI ohne Internet).
const offline = process.env.KINEWS_OFFLINE === "1";
const abrufeFeed = offline
  ? erstelleOfflineAbruf()
  : (url, optionen) => abrufeFeedHttp(url, optionen);

const scheduler = erstelleScheduler({
  quellens: aktiveQuellen,
  speicher,
  ereignisse,
  abrufeFeed,
  intervallMs: konfig.intervalMin * 60 * 1000,
  timeoutMs: konfig.feedTimeoutMs,
  log
});

const app = express();
app.disable("x-powered-by");
app.use(express.json());

/* ---------- REST-API ---------- */

/** Alle gespeicherten Artikel, optional gefiltert nach Quelle und Suchtext. */
app.get("/api/nachrichten", (req, res) => {
  const { quelle, suche } = req.query;
  let liste = speicher.liste();
  if (quelle) {
    liste = liste.filter((a) => a.quelle === quelle);
  }
  if (suche && String(suche).trim()) {
    const begriff = String(suche).trim().toLowerCase();
    liste = liste.filter(
      (a) =>
        a.titel.toLowerCase().includes(begriff) ||
        (a.beschreibung ?? "").toLowerCase().includes(begriff)
    );
  }
  res.json({ artikel: liste, anzahl: liste.length });
});

/** Die acht konfigurierten Quellen. */
app.get("/api/quellen", (req, res) => {
  res.json({
    quellens: aktiveQuellen.map(({ id, name, farbe, intervall }) => ({
      id,
      name,
      farbe,
      intervall
    }))
  });
});

/** Quellenverfügbarkeit für die Statusanzeige. */
app.get("/api/status", (req, res) => {
  res.json({ status: speicher.statusListe(), intervallMin: konfig.intervalMin });
});

/* ---------- Echtzeitkanal (Server-Sent Events) ---------- */

app.get("/api/events", (req, res) => {
  const kanal = erstelleSseKanal(res);

  // Initialzustand: vorhandene Artikel + Status, damit neue Clients
  // sofort eine vollständige Ansicht ohne zusätzlichen REST-Call erhalten.
  kanal.send("init", {
    artikel: speicher.liste(),
    status: speicher.statusListe(),
    intervallMin: konfig.intervalMin
  });

  const abmelden = ereignisse.abonniere(kanal);
  req.on("close", () => {
    abmelden();
    kanal.schliesse();
  });
});

/* ---------- Statisches Frontend ---------- */

app.use(express.static(path.join(__dirname, "frontend")));

/* ---------- Start ---------- */

let server = null;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await speicher.lade();
  server = app.listen(konfig.port, () => {
    log(`[Server] KiNews laeuft auf http://localhost:${konfig.port}`);
    log(`[Server] Intervall: ${konfig.intervalMin} min, Feed-Timeout: ${konfig.feedTimeoutMs} ms, Daten: ${konfig.dataDir}`);
    scheduler.starte();
  });

  const beende = () => {
    log("[Server] Beende…");
    scheduler.stoppe();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", beende);
  process.on("SIGTERM", beende);
}

export { app, speicher, ereignisse, scheduler, aktiveQuellen, konfig };
