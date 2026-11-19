import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseFeed,
  normalisiereItem,
  enthaeltKeyword,
  titelNormalform,
  titelAehnlichkeit,
  neueArtikelAuffinden,
  artikelId
} from "../src/parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const quelle = { id: "testquelle", name: "Testquelle" };

/* ---------- parseFeed: RSS ---------- */

test("parseFeed parst einen RSS-Feed und normalisiert die Felder", async () => {
  const xml = await readFile(path.join(__dirname, "mocks/feed-vg.xml"), "utf8");
  const artikle = parseFeed(xml, quelle);

  assert.equal(artikle.length, 3);
  const ergebnis = artikle[0];
  assert.equal(ergebnis.url, "https://www.theverge.com/2025/06/09/openai-record");
  assert.equal(ergebnis.titel, "New AI model from Openai sets record");
  assert.equal(ergebnis.quelle, "testquelle");
  assert.equal(ergebnis.zeit, "2025-06-09T12:00:00.000Z");
  assert.match(ergebnis.beschreibung, /large language model/);
  assert.equal(ergebnis.bild, "https://cdn.theverge.com/img/openai.jpg");
  assert.ok(ergebnis.id);
});

test("parseFeed parst einen Atom-Feed (link rel=alternate, published)", async () => {
  const xml = await readFile(path.join(__dirname, "mocks/feed-atom.xml"), "utf8");
  const artikle = parseFeed(xml, quelle);

  assert.equal(artikle.length, 2);
  assert.equal(artikle[0].url, "https://venturebeat.com/2025/06/09/enterprise-ai");
  assert.equal(artikle[0].titel, "Enterprise AI adoption accelerates in 2025");
  assert.equal(artikle[0].zeit, "2025-06-09T08:00:00.000Z");
  assert.equal(artikle[1].bild, "https://venturebeat.com/img/search.jpg");
});

test("parseFeed wirft bei leerem Inhalt eine Fehlermeldung", () => {
  assert.throws(() => parseFeed("", quelle), /Leerer Feed/);
  assert.throws(() => parseFeed("   ", quelle), /Leerer Feed/);
});

test("parseFeed wirft bei Inhalt ohne Items eine Fehlermeldung", () => {
  assert.throws(() => parseFeed("<rss><channel><title>x</title></channel></rss>", quelle), /Keine Items/);
});

test("normalisiereItem entfernt HTML-Markup aus der Beschreibung", () => {
  const block = `<item>
    <title>Titel &amp; mehr</title>
    <link>https://example.com/a</link>
    <pubDate>Mon, 09 Jun 2025 10:00:00 +0000</pubDate>
    <description><p>Erster <b>fetter</b> Satz.</p><p>Zweiter Satz.</p></description>
  </item>`;
  const artikel = normalisiereItem(block, quelle);
  assert.equal(artikel.titel, "Titel & mehr");
  assert.equal(artikel.beschreibung, "Erster fetter Satz. Zweiter Satz.");
});

/* ---------- Keyword-Filter ---------- */

test("enhaeltKeyword erkennt KI-Bezug über Titel", () => {
  assert.equal(enthaeltKeyword({ titel: "New AI model released", beschreibung: "" }, ["ai", "openai"]), true);
});

test("enhaeltKeyword erkennt KI-Bezug über Beschreibung", () => {
  assert.equal(
    enthaeltKeyword({ titel: "Big announcement", beschreibung: "It is about artificial intelligence." }, ["ai", "artificial intelligence"]),
    true
  );
});

test("enhaeltKeyword verfehlt Artikel ohne KI-Bezug", () => {
  assert.equal(
    enthaeltKeyword({ titel: "Baking sourdough bread", beschreibung: "A guide to bread." }, ["ai", "openai", "llm"]),
    false
  );
});

test("enhaeltKeyword prüft 'ai' wortgenau (kein Treffer in 'email' o. ä.)", () => {
  assert.equal(enthaeltKeyword({ titel: "Email marketing tips", beschreibung: "Mail software" }, ["ai"]), false);
  assert.equal(enthaeltKeyword({ titel: "The AI of the future", beschreibung: "" }, ["ai"]), true);
});

/* ---------- Duplikaterkennung ---------- */

test("artikelId ist deterministisch pro URL", () => {
  assert.equal(artikelId("https://a.com/x"), artikelId("https://a.com/x"));
  assert.notEqual(artikelId("https://a.com/x"), artikelId("https://a.com/y"));
});

test("titelNormalform normalisiert Groß-/Kleinschreibung, Satzzeichen und Umlaute", () => {
  assert.equal(titelNormalform("Neue KI-Modelle!"), "neue ki modelle");
  assert.equal(titelNormalform("  Neue    KI Modelle  "), "neue ki modelle");
  assert.equal(titelNormalform("Grüße aus München"), "grusse aus munchen");
});

test("titelAehnlichkeit misst Jaccard-Ähnlichkeit", () => {
  assert.equal(titelAehnlichkeit("New AI model sets record", "New AI model sets record"), 1);
  assert.ok(titelAehnlichkeit("New AI model sets record", "New AI model sets new record") >= 0.8);
  assert.ok(titelAehnlichkeit("Baking sourdough bread", "New AI model sets record") < 0.3);
});

test("neueArtikelAuffinden entfernt Artikel mit gleicher URL", () => {
  const bekannt = [{ url: "https://a.com/1", titel: "Erster Artikel" }];
  const neu = [
    { url: "https://a.com/1", titel: "Erster Artikel (Nachtrag)" },
    { url: "https://a.com/2", titel: "Zweiter Artikel" }
  ];
  const ergebnis = neueArtikelAuffinden(neu, bekannt);
  assert.equal(ergebnis.length, 1);
  assert.equal(ergebnis[0].url, "https://a.com/2");
});

test("neueArtikelAuffinden entfernt Artikel mit nahezu gleichem Titel", () => {
  const bekannt = [{ url: "https://a.com/1", titel: "New AI Model Sets Record" }];
  const neu = [{ url: "https://b.com/anderer-link", titel: "New AI model sets record" }];
  assert.equal(neueArtikelAuffinden(neu, bekannt).length, 0);
});

test("neueArtikelAuffinden erkennt Duplikate auch innerhalb der neuen Charge", () => {
  const neu = [
    { url: "https://a.com/1", titel: "Anthropic releases Claude 4" },
    { url: "https://b.com/2", titel: "Anthropic releases Claude 4" },
    { url: "https://c.com/3", titel: "Completely different story here" }
  ];
  const ergebnis = neueArtikelAuffinden(neu, []);
  assert.equal(ergebnis.length, 2);
  assert.ok(ergebnis.every((a) => a.url !== "https://b.com/2"));
});

test("neueArtikelAuffinden lässt genuinely neue Artikel durch", () => {
  const bekannt = [{ url: "https://a.com/1", titel: "Altes Thema" }];
  const neu = [
    { url: "https://a.com/2", titel: "Völlig neues Thema über Robotik" },
    { url: "https://a.com/3", titel: "Noch ein anderes Thema" }
  ];
  assert.equal(neueArtikelAuffinden(neu, bekannt).length, 2);
});
