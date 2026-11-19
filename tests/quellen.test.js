/**
 * Tests zur erweiterten Quellliste (8 Quellen) und zum
 * Kategorie-Passthrough durch den Parser.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QUELLEN, quelleNachId } from "../src/quellen.js";
import { parseFeed } from "../src/parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ladeMock = (name) => readFile(path.join(__dirname, "mocks", name), "utf8");

test("QUELLEN enthält exakt acht Quellen", () => {
  assert.equal(QUELLEN.length, 8);
});

test("jede Quelle hat id, name und kategorie", () => {
  for (const quelle of QUELLEN) {
    assert.ok(quelle.id && typeof quelle.id === "string", `id fehlt bei ${quelle.name ?? "?"}`);
    assert.ok(quelle.name && typeof quelle.name === "string", `name fehlt bei ${quelle.id}`);
    assert.ok(quelle.kategorie && typeof quelle.kategorie === "string", `kategorie fehlt bei ${quelle.id}`);
  }
  // Ids eindeutig
  assert.equal(new Set(QUELLEN.map((q) => q.id)).size, QUELLEN.length);
});

test("die drei politischen Quellen tragen die vereinbarten Kategorien", () => {
  assert.equal(quelleNachId("zeitwelt").kategorie, "weltpolitik");
  assert.equal(quelleNachId("tagesschau-wirtschaft").kategorie, "finanzen");
  assert.equal(quelleNachId("tagesschau-politik").kategorie, "lokalpolitik");
});

test("Parser reicht die kategorie der Quelle an die Artikel weiter", async () => {
  const faelle = [
    ["feed-zeit-welt.xml", "zeitwelt", "weltpolitik"],
    ["feed-tagesschau-wirtschaft.xml", "tagesschau-wirtschaft", "finanzen"],
    ["feed-tagesschau-politik.xml", "tagesschau-politik", "lokalpolitik"],
    ["feed-vg.xml", "theverge", "ai"]
  ];
  for (const [mock, quelleId, erwarteteKategorie] of faelle) {
    const xml = await ladeMock(mock);
    const quelle = quelleNachId(quelleId);
    const artikel = parseFeed(xml, quelle);
    assert.ok(artikel.length > 0, `Mock ${mock} lieferte keine Artikel`);
    for (const a of artikel) {
      assert.equal(a.kategorie, erwarteteKategorie, `kategorie für ${quelleId} erwartet ${erwarteteKategorie}`);
    }
  }
});
