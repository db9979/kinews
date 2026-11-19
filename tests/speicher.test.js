import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Speicher } from "../src/speicher.js";

async function tempSpeicher() {
  const verzeichnis = await mkdtemp(path.join(os.tmpdir(), "kinews-test-"));
  const speicher = new Speicher(verzeichnis, { maxArtikel: 10 });
  await speicher.lade();
  return { speicher, verzeichnis };
}

test("hinzufuege speichert neue Artikel und überspringt Duplikate", async () => {
  const { speicher, verzeichnis } = await tempSpeicher();
  const neue = await speicher.hinzufuege([
    { id: "a1", url: "https://a.com/1", titel: "Erster Artikel", quelle: "x", zeit: "2025-06-09T10:00:00.000Z", beschreibung: "", bild: null },
    { id: "a2", url: "https://a.com/2", titel: "Zweiter Artikel", quelle: "x", zeit: "2025-06-09T11:00:00.000Z", beschreibung: "", bild: null }
  ]);
  assert.equal(neue.length, 2);

  // Gleiche URL erneut -> Duplikat
  const wieder = await speicher.hinzufuege([
    { id: "a1", url: "https://a.com/1", titel: "Erster Artikel", quelle: "x", zeit: "2025-06-09T10:00:00.000Z", beschreibung: "", bild: null }
  ]);
  assert.equal(wieder.length, 0);

  // Nahezu gleicher Titel (nur Großschreibung/Interpunktion anders) -> Duplikat
  const titelDuplikat = await speicher.hinzufuege([
    { id: "b1", url: "https://b.com/1", titel: "Erster Artikel!", quelle: "x", zeit: "2025-06-09T12:00:00.000Z", beschreibung: "", bild: null }
  ]);
  assert.equal(titelDuplikat.length, 0);

  assert.equal(speicher.liste().length, 2);
  await rm(verzeichnis, { recursive: true, force: true });
});

test("liste ist chronologisch absteigend sortiert", async () => {
  const { speicher, verzeichnis } = await tempSpeicher();
  await speicher.hinzufuege([
    { id: "alt", url: "https://a.com/alt", titel: "Alter Artikel", quelle: "x", zeit: "2025-06-01T00:00:00.000Z", beschreibung: "", bild: null },
    { id: "neu", url: "https://a.com/neu", titel: "Neuer Artikel", quelle: "x", zeit: "2025-06-09T00:00:00.000Z", beschreibung: "", bild: null },
    { id: "mittel", url: "https://a.com/mittel", titel: "Mittlerer Artikel", quelle: "x", zeit: "2025-06-05T00:00:00.000Z", beschreibung: "", bild: null }
  ]);
  const liste = speicher.liste();
  assert.deepEqual(
    liste.map((a) => a.id),
    ["neu", "mittel", "alt"]
  );
  await rm(verzeichnis, { recursive: true, force: true });
});

test("Daten werden persistent gespeichert und neu geladen", async () => {
  const { speicher, verzeichnis } = await tempSpeicher();
  await speicher.hinzufuege([
    { id: "p1", url: "https://a.com/p", titel: "Persistenter Artikel", quelle: "x", zeit: "2025-06-09T00:00:00.000Z", beschreibung: "d", bild: null }
  ]);

  const neu = new Speicher(verzeichnis, { maxArtikel: 10 });
  await neu.lade();
  assert.equal(neu.liste().length, 1);
  assert.equal(neu.liste()[0].titel, "Persistenter Artikel");

  // Duplikat überlebt Neustart
  const dup = await neu.hinzufuege([
    { id: "p1", url: "https://a.com/p", titel: "Persistenter Artikel", quelle: "x", zeit: "2025-06-09T00:00:00.000Z", beschreibung: "d", bild: null }
  ]);
  assert.equal(dup.length, 0);
  await rm(verzeichnis, { recursive: true, force: true });
});

test("maxArtikel begrenzt die Ablage (älteste werden entfernt)", async () => {
  const verzeichnis = await mkdtemp(path.join(os.tmpdir(), "kinews-max-"));
  const speicher = new Speicher(verzeichnis, { maxArtikel: 3 });
  await speicher.lade();
  const artikel = Array.from({ length: 5 }, (_, i) => ({
    id: `a${i}`,
    url: `https://a.com/${i}`,
    titel: `Artikel Nummer ${i}`,
    quelle: "x",
    zeit: `2025-06-0${i + 1}T00:00:00.000Z`,
    beschreibung: "",
    bild: null
  }));
  await speicher.hinzufuege(artikel);
  assert.equal(speicher.liste().length, 3);
  const ids = speicher.liste().map((a) => a.id);
  assert.ok(!ids.includes("a0") && !ids.includes("a1"));
  await rm(verzeichnis, { recursive: true, force: true });
});

test("statusListe enthält Einträge pro Quelle", async () => {
  const { speicher, verzeichnis } = await tempSpeicher();
  speicher.setzeStatus("theverge", { ok: true, artikelGefunden: 5, fehler: null });
  speicher.setzeStatus("mittr", { ok: false, artikelGefunden: 0, fehler: "Zeitüberschreitung" });
  const liste = speicher.statusListe();
  assert.equal(liste.length, 2);
  const theVerge = liste.find((s) => s.id === "theverge");
  assert.equal(theVerge.ok, true);
  assert.equal(theVerge.artikelGefunden, 5);
  const mittr = liste.find((s) => s.id === "mittr");
  assert.equal(mittr.ok, false);
  assert.match(mittr.fehler, /Zeitüberschreitung/);
  await rm(verzeichnis, { recursive: true, force: true });
});
