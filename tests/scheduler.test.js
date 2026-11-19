import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { erstelleScheduler } from "../src/scheduler.js";
import { Speicher } from "../src/speicher.js";
import { EventBus } from "../src/evente.js";
import { QUELLEN } from "../src/quellen.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const verzeichnisMocks = path.join(__dirname, "mocks");

function ladeMock(name) {
  return readFile(path.join(verzeichnisMocks, name), "utf8");
}

async function bauUmgebung() {
  const verzeichnis = await mkdtemp(path.join(os.tmpdir(), "kinews-sched-"));
  const speicher = new Speicher(verzeichnis, { maxArtikel: 100 });
  await speicher.lade();
  const ereignisse = new EventBus();
  return { speicher, ereignisse, verzeichnis };
}

test("Durchlauf ruft alle fünf Quellen ab und meldet neue Artikel über den EventBus", async () => {
  const { speicher, ereignisse, verzeichnis } = await bauUmgebung();
  const aufrufe = [];
  const abrufeFeed = async (url) => {
    aufrufe.push(url);
    if (url === QUELLEN[0].rssUrl) return await ladeMock("feed-vg.xml");
    if (url === QUELLEN[1].rssUrl) return await ladeMock("feed-tc.xml");
    if (url === QUELLEN[3].rssUrl) return await ladeMock("feed-atom.xml");
    const fehler = new Error("Offline");
    fehler.status = 0;
    throw fehler;
  };

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
    intervallMs: 60000,
    timeoutMs: 1000,
    log: () => {}
  });

  await scheduler.durchlauf();

  assert.equal(aufrufe.length, 5);
  // 2 Verge (Bread-Artikel gefiltert) + 2 TechCrunch + 2 VentureBeat (Atom) = 6
  assert.equal(speicher.liste().length, 6);
  const statusListe = speicher.statusListe();
  assert.equal(statusListe.length, 5);
  assert.equal(statusListe.filter((s) => s.ok).length, 3);
  assert.equal(statusListe.filter((s) => !s.ok).length, 2);

  const neueMeldungen = ereignisseListe.filter((e) => e.typ === "neue_artikel");
  assert.equal(neueMeldungen.length, 3);
  const statusMeldung = ereignisseListe.find((e) => e.typ === "status");
  assert.ok(statusMeldung);
  assert.equal(statusMeldung.daten.status.length, 5);

  await rm(verzeichnis, { recursive: true, force: true });
});

test("zweiter Durchlauf erkennt keine Duplikate mehr", async () => {
  const { speicher, ereignisse, verzeichnis } = await bauUmgebung();
  let aufgerufen = 0;
  const abrufeFeed = async (url) => {
    aufgerufen += 1;
    return await ladeMock("feed-vg.xml");
  };

  const ereignisseListe = [];
  ereignisse.abonniere({
    send(typ, daten) {
      ereignisseListe.push({ typ, daten: JSON.parse(daten) });
    }
  });

  const scheduler = erstelleScheduler({
    quellens: [QUELLEN[0]],
    speicher,
    ereignisse,
    abrufeFeed,
    intervallMs: 60000,
    timeoutMs: 1000,
    log: () => {}
  });

  await scheduler.durchlauf();
  assert.equal(speicher.liste().length, 2);
  ereignisseListe.length = 0;
  await scheduler.durchlauf();
  assert.equal(speicher.liste().length, 2);
  assert.equal(ereignisseListe.filter((e) => e.typ === "neue_artikel").length, 0);
  assert.equal(aufgerufen, 2);
  await rm(verzeichnis, { recursive: true, force: true });
});

test("Zeitüberschreitung wird als Fehlerstatus der Quelle gemeldet", async () => {
  const { speicher, verzeichnis } = await bauUmgebung();
  const ereignisse = new EventBus();
  const abrufeFeed = async () => {
    const fehler = new Error("aborted");
    fehler.name = "AbortError";
    throw fehler;
  };
  const scheduler = erstelleScheduler({
    quellens: [QUELLEN[2]],
    speicher,
    ereignisse,
    abrufeFeed,
    intervallMs: 60000,
    timeoutMs: 1000,
    log: () => {}
  });
  await scheduler.durchlauf();
  const status = speicher.statusListe().find((s) => s.id === QUELLEN[2].id);
  assert.equal(status.ok, false);
  assert.match(status.fehler, /Zeitüberschreitung/);
  await rm(verzeichnis, { recursive: true, force: true });
});

test("ungültiger Feed (keine Items) wird als Fehlerstatus gemeldet, andere Quellen bleiben verfügbar", async () => {
  const { speicher, verzeichnis } = await bauUmgebung();
  const ereignisse = new EventBus();
  const abrufeFeed = async (url) => {
    if (url === QUELLEN[0].rssUrl) return "<rss><channel><title>nur Titel</title></channel></rss>";
    return await ladeMock("feed-tc.xml");
  };
  const scheduler = erstelleScheduler({
    quellens: [QUELLEN[0], QUELLEN[1]],
    speicher,
    ereignisse,
    abrufeFeed,
    intervallMs: 60000,
    timeoutMs: 1000,
    log: () => {}
  });
  await scheduler.durchlauf();
  const statusVerge = speicher.statusListe().find((s) => s.id === QUELLEN[0].id);
  assert.equal(statusVerge.ok, false);
  assert.match(statusVerge.fehler, /Keine Items/);
  const statusTc = speicher.statusListe().find((s) => s.id === QUELLEN[1].id);
  assert.equal(statusTc.ok, true);
  assert.equal(speicher.liste().length, 2);
  await rm(verzeichnis, { recursive: true, force: true });
});

test("starte() führt sofort einen Durchlauf aus und wiederholt per Intervall", async (t) => {
  const { speicher, ereignisse, verzeichnis } = await bauUmgebung();
  let aufrufe = 0;
  const abrufeFeed = async () => {
    aufrufe += 1;
    return await ladeMock("feed-tc.xml");
  };
  const scheduler = erstelleScheduler({
    quellens: [QUELLEN[1]],
    speicher,
    ereignisse,
    abrufeFeed,
    intervallMs: 120,
    timeoutMs: 1000,
    log: () => {}
  });
  scheduler.starte();
  t.after(() => scheduler.stoppe());
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(aufrufe >= 3, `erwartete >= 3 Abrufe, hatte ${aufrufe}`);
  assert.equal(aufrufe < 10, true, "Intervall wird nicht unnötig schnell");
  await rm(verzeichnis, { recursive: true, force: true });
});
