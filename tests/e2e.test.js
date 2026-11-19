/**
 * End-to-End-Test: startet den Server (Offline-Modus mit Beispieldaten)
 * auf einem Testport und prüft Start, API, SSE-Auto-Update und Frontend.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 4599;
const BASIS = `http://127.0.0.1:${PORT}`;

async function warteBis(praedikat, zeitLimitMs = 15000, schrittMs = 100) {
  const ende = Date.now() + zeitLimitMs;
  while (Date.now() < ende) {
    try {
      const ergebnis = await praedikat();
      if (ergebnis) return ergebnis;
    } catch {
      /* weiter versuchen */
    }
    await new Promise((r) => setTimeout(r, schrittMs));
  }
  return null;
}

async function leseSse(port, { wartungMs = 800, beende } = {}) {
  const ereignisse = [];
  const antwort = await fetch(`http://127.0.0.1:${port}/api/events`);
  const leser = antwort.body.getReader();
  const dekodierer = new TextDecoder();
  let puffer = "";

  const leere = setTimeout(async () => {
    await beende?.();
    try {
      await leser.cancel();
    } catch {
      /* Verbindung ist bereits weg */
    }
  }, wartungMs);

  try {
    while (true) {
      const { done, value } = await leser.read();
      if (done) break;
      puffer += dekodierer.decode(value, { stream: true });
      let grenze;
      while ((grenze = puffer.indexOf("\n\n")) !== -1) {
        const roh = puffer.slice(0, grenze);
        puffer = puffer.slice(grenze + 2);
        let typ = "message";
        let daten = [];
        for (const zeile of roh.split("\n")) {
          if (zeile.startsWith("event: ")) typ = zeile.slice(7).trim();
          else if (zeile.startsWith("data: ")) daten.push(zeile.slice(6));
        }
        if (daten.length > 0) {
          ereignisse.push({ typ, daten: JSON.parse(daten.join("\n")) });
        }
      }
    }
  } finally {
    clearTimeout(leere);
  }
  return ereignisse;
}

test("E2E: Start, API, Auto-Update ohne Reload, Frontend", async (t) => {
  const verzeichnis = await mkdtemp(path.join(os.tmpdir(), "kinews-e2e-"));
  process.env.KINEWS_OFFLINE = "1";
  process.env.PORT = String(PORT);
  process.env.DATA_DIR = verzeichnis;
  process.env.INTERVAL_MIN = "5";
  process.env.FEED_TIMEOUT_MS = "2000";

  const modul = await import("../server.js");
  const { speicher, scheduler } = modul;
  await speicher.lade();

  let server;
  t.after(async () => {
    scheduler.stoppe();
    if (server) await new Promise((r) => server.close(r));
    await rm(verzeichnis, { recursive: true, force: true });
    delete process.env.KINEWS_OFFLINE;
  });

  server = modul.app.listen(PORT);
  await new Promise((r) => server.on("listening", r));
  scheduler.starte(); // entspricht dem automatischen Start bei server.js

  // 1) Frontend ist erreichbar
  const html = await fetch(`${BASIS}/`).then((r) => r.text());
  assert.match(html, /KiNews/);
  assert.match(html, /newsgrid/);
  assert.match(html, /EventSource|app\.js/);
  const css = await fetch(`${BASIS}/styles.css`).then((r) => r.text());
  assert.match(css, /repeat\(3, minmax\(0, 1fr\)\)/);

  // 2) Quellen-API listet genau die acht konfigurierten Quellen
  const quellens = await fetch(`${BASIS}/api/quellen`).then((r) => r.json());
  assert.equal(quellens.quellens.length, 8);
  const namen = quellens.quellens.map((q) => q.name);
  for (const erwartet of [
    "The Verge AI",
    "TechCrunch AI",
    "Ars Technica AI",
    "VentureBeat AI",
    "MIT Technology Review",
    "Zeit Welt",
    "Tagesschau Wirtschaft",
    "Tagesschau Politik"
  ]) {
    assert.ok(namen.includes(erwartet), `Quelle fehlt: ${erwartet}`);
  }
  for (const q of quellens.quellens) {
    assert.ok(q.farbe, "Quelle hat eine Farbe");
    assert.equal(q.intervall, 5);
  }

  // 3) Erster Abruf lief automatisch: mindestens eine gültige Nachricht
  const gefunden = await warteBis(async () => {
    const daten = await fetch(`${BASIS}/api/nachrichten`).then((r) => r.json());
    return daten.anzahl >= 1 ? daten : null;
  });
  assert.ok(gefunden, "Nach dem Start ist mindestens ein Artikel gelistet");
  const artikel0 = gefunden.artikel[0];
  for (const feld of ["id", "url", "titel", "quelle", "zeit", "beschreibung", "bild"]) {
    assert.ok(feld in artikel0, `Artikel-Feld fehlt: ${feld}`);
  }
  assert.match(artikel0.url, /^https?:\/\//);

  // 4) Alle acht Quellen wurden geprüft (Status)
  const statusOk = await warteBis(async () => {
    const daten = await fetch(`${BASIS}/api/status`).then((r) => r.json());
    return daten.status.length === 8 && daten.status.every((s) => s.ok) ? daten : null;
  });
  assert.ok(statusOk, "Status zeigt alle acht Quellen als erreichbar");
  assert.equal(statusOk.intervallMin, 5);

  // 5) Auto-Update ohne Reload: zweiter Durchlauf liefert neue Artikel via SSE
  const startAnzahl =
    (await fetch(`${BASIS}/api/nachrichten`).then((r) => r.json())).anzahl;
  assert.ok(startAnzahl >= 5);

  // SSE-Verbindung aufbauen, dann einen weiteren Durchlauf triggern
  const ssePuffer = [];
  const sseLesen = leseSse(PORT, {
    wartungMs: 4000,
    beende: async () => {
      await scheduler.durchlauf();
    }
  });
  const ereignisse = await sseLesen;
  const initEreignis = ereignisse.find((e) => e.typ === "init");
  assert.ok(initEreignis, "SSE sendet initiales init-Event");
  assert.ok(Array.isArray(initEreignis.daten.artikel));

  const neueMeldung = ereignisse.find((e) => e.typ === "neue_artikel");
  assert.ok(neueMeldung, "SSE sendet neue_artikel ohne Reload");
  assert.ok(neueMeldung.daten.artikel.length >= 1);
  const neueUrl = neueMeldung.daten.artikel[0].url;
  assert.ok(neueUrl);

  const nachDurchlauf = await fetch(`${BASIS}/api/nachrichten`).then((r) => r.json());
  assert.ok(nachDurchlauf.anzahl > startAnzahl, "Anzahl Artikel wächst ohne Reload");
  assert.ok(
    nachDurchlauf.artikel.some((a) => a.url === neueUrl),
    "Neuer Artikel ist in der Liste"
  );

  // 6) Filter nach Quelle funktioniert
  const verge = await fetch(`${BASIS}/api/nachrichten?quelle=theverge`).then((r) => r.json());
  assert.ok(verge.anzahl >= 1);
  assert.ok(verge.artikel.every((a) => a.quelle === "theverge"));

  // 7) Suche funktioniert
  const suche = await fetch(`${BASIS}/api/nachrichten?suche=${encodeURIComponent("live")}`).then((r) => r.json());
  assert.ok(suche.anzahl >= 1);
  assert.ok(
    suche.artikel.every(
      (a) =>
        a.titel.toLowerCase().includes("live") ||
        a.beschreibung.toLowerCase().includes("live")
    )
  );

  // 8) Chronologisch absteigend
  const liste = nachDurchlauf.artikel;
  for (let i = 1; i < liste.length; i++) {
    assert.ok(liste[i - 1].zeit >= liste[i].zeit);
  }

  // 9) Daten wurden persistent gespeichert
  const dateien = await readdir(verzeichnis);
  assert.ok(dateien.includes("kinews-daten.json"));
});

test("E2E: Server-Start über Kindprozess mit Offline-Modus", async (t) => {
  const { spawn } = await import("node:child_process");
  const verzeichnis = await mkdtemp(path.join(os.tmpdir(), "kinews-e2e2-"));
  const port2 = 4601;
  const prozess = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      KINEWS_OFFLINE: "1",
      PORT: String(port2),
      DATA_DIR: verzeichnis,
      INTERVAL_MIN: "5"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let ausgabe = "";
  prozess.stdout.on("data", (d) => (ausgabe += d));
  prozess.stderr.on("data", (d) => (ausgabe += d));
  t.after(async () => {
    prozess.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    if (!prozess.killed) prozess.kill("SIGKILL");
    await rm(verzeichnis, { recursive: true, force: true });
  });

  const basis2 = `http://127.0.0.1:${port2}`;
  const bereit = await warteBis(async () => {
    const r = await fetch(`${basis2}/api/quellen`);
    return r.ok;
  });
  assert.ok(bereit, "Server-Kindprozess ist erreichbar");
  assert.match(ausgabe, /KiNews laeuft/);

  const gefunden2 = await warteBis(async () => {
    const daten = await fetch(`${basis2}/api/nachrichten`).then((r) => r.json());
    return daten.anzahl >= 1 ? daten : null;
  });
  assert.ok(gefunden2, "Kindprozess liefert automatisch abgerufene Artikel");
  prozess.kill("SIGTERM");
});
