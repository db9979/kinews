/**
 * Integrationstest mit Mock-Feeds: kompletter Rundlauf
 * Feed-Text -> Abruf (Mock) -> Parser -> Duplikat -> Speicher -> API.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { QUELLEN } from "../src/quellen.js";
import { Speicher } from "../src/speicher.js";
import { EventBus } from "../src/evente.js";
import { erstelleScheduler } from "../src/scheduler.js";
import { erstelleMockAbruf } from "../src/rss.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mocks = (name) => path.join(__dirname, "mocks", name);

async function ladeMock(name) {
  return readFile(mocks(name), "utf8");
}

/**
 * Baut die Mock-Feeds so auf, dass jede der fünf klassischen Quellen gültige
 * Inhalte liefert – die Ars-Technica-URL zeigt auf einen ungültigen Feed
 * (Fehlerpfad). Die drei politischen Quellen (Zeit, Tagesschau) werden mit
 * eigenen Mock-Feeds versorgt, damit sie gültig abgerufen werden.
 */
async function bauMockMapping({ arsGueltig = false } = {}) {
  const mapping = new Map();
  const feeds = [
    [QUELLEN[0].rssUrl, await ladeMock("feed-vg.xml")],
    [QUELLEN[1].rssUrl, await ladeMock("feed-tc.xml")],
    [
      QUELLEN[2].rssUrl,
      arsGueltig
        ? await ladeMock("feed-ars.xml")
        : "<rss version='2.0'><channel><title>kaputt</title></channel></rss>"
    ],
    [QUELLEN[3].rssUrl, await ladeMock("feed-atom.xml")],
    [QUELLEN[4].rssUrl, await ladeMock("feed-mit.xml")],
    [
      QUELLEN[5].rssUrl,
      await ladeMock("feed-zeit-welt.xml")
    ],
    [
      QUELLEN[6].rssUrl,
      await ladeMock("feed-tagesschau-wirtschaft.xml")
    ],
    [
      QUELLEN[7].rssUrl,
      await ladeMock("feed-tagesschau-politik.xml")
    ]
  ];
  for (const [url, inhalt] of feeds) mapping.set(url, inhalt);
  return mapping;
}

async function umgebung({ arsGueltig = false } = {}) {
  const verzeichnis = await mkdtemp(path.join(os.tmpdir(), "kinews-int-"));
  const speicher = new Speicher(verzeichnis, { maxArtikel: 100 });
  await speicher.lade();
  const ereignisse = new EventBus();
  const abrufeFeed = erstelleMockAbruf(await bauMockMapping({ arsGueltig }));
  const ereignisseListe = [];
  ereignisse.abonniere({
    send(typ, daten) {
      ereignisseListe.push({ typ, daten: JSON.parse(daten) });
    }
  });
  const scheduler = erstelleScheduler({
    quellens: QUELLEN,
    speicher,
    ereignisse,
    abrufeFeed,
    intervallMs: 3600000,
    timeoutMs: 2000,
    log: () => {}
  });
  return { speicher, ereignisse, ereignisseListe, scheduler, verzeichnis };
}

test("Rundlauf: alle acht Quellen abgerufen, neue Artikel gespeichert und gemeldet", async () => {
  const { speicher, ereignisseListe, scheduler, verzeichnis } = await umgebung();
  await scheduler.durchlauf();

  // Status: 7 Quellen ok, Ars Technica fehlerhaft (kaputter Mock-Feed)
  const status = speicher.statusListe();
  assert.equal(status.length, 8);
  assert.equal(status.filter((s) => s.ok).length, 7);
  assert.equal(status.find((s) => s.id === "arstechnica").ok, false);

  // 2 (Verge) + 2 (TechCrunch) + 2 (VentureBeat, Atom) + 2 (MIT)
  // + 2 (Zeit Welt) + 2 (Tagesschau Wirtschaft) + 2 (Tagesschau Politik) = 14 Artikel
  assert.equal(speicher.liste().length, 14);

  // Jeder Artikel hat die vereinbarten Felder
  for (const artikel of speicher.liste()) {
    assert.ok(artikel.id);
    assert.match(artikel.url, /^https?:\/\//);
    assert.ok(artikel.titel.length > 0);
    assert.ok(QUELLEN.some((q) => q.id === artikel.quelle));
    assert.ok(artikel.zeit === null || !Number.isNaN(Date.parse(artikel.zeit)));
    assert.ok("beschreibung" in artikel);
    assert.ok("bild" in artikel);
  }

  // Neue Artikel wurden pro Quelle gemeldet (7 ok-Quellen à 2 Artikel)
  const neueMeldungen = ereignisseListe.filter((e) => e.typ === "neue_artikel");
  assert.equal(neueMeldungen.length, 7);

  // Chronologisch absteigend
  const liste = speicher.liste();
  for (let i = 1; i < liste.length; i++) {
    assert.ok(liste[i - 1].zeit >= liste[i].zeit, "Liste absteigend sortiert");
  }
  await rm(verzeichnis, { recursive: true, force: true });
});

test("Rundlauf mit gültiger Ars-Technica-Quelle: alle acht Quellen ok, Duplikate werden unterdrückt", async () => {
  const { speicher, ereignisseListe, scheduler, verzeichnis } = await umgebung({ arsGueltig: true });
  await scheduler.durchlauf();

  const status = speicher.statusListe();
  assert.equal(status.filter((s) => s.ok).length, 8);
  assert.equal(status.find((s) => s.id === "arstechnica").ok, true);

  // Verge(2) + TechCrunch(2) + Ars(2) + VentureBeat(2) + MIT(2)
  // + Zeit(2) + Tagesschau-Wirtschaft(2) + Tagesschau-Politik(2) = 16 eindeutige Artikel
  assert.equal(speicher.liste().length, 16);

  // Zweiter Durchlauf: keine neuen Artikel, keine Duplikate
  ereignisseListe.length = 0;
  await scheduler.durchlauf();
  assert.equal(speicher.liste().length, 16);
  assert.equal(ereignisseListe.filter((e) => e.typ === "neue_artikel").length, 0);
  await rm(verzeichnis, { recursive: true, force: true });
});

test("ein Ausfall einer Quelle beeinträchtigt die anderen nicht", async () => {
  const { speicher, scheduler, verzeichnis } = await umgebung();
  await scheduler.durchlauf();
  // TechCrunch-Artikel existieren trotz Ars-Ausfalls
  assert.ok(speicher.liste().some((a) => a.quelle === "techcrunch"));
  assert.ok(speicher.liste().some((a) => a.quelle === "theverge"));
  await rm(verzeichnis, { recursive: true, force: true });
});
