/**
 * Persistente Ablage für Artikel und Quellenstatus.
 *
 * Datenformat (JSON-Datei):
 *   { artikel: [ ... ], status: { quelleId: { ok, letztePruefung, fehler, artikelGefunden } } }
 *
 * Alle Lese- und Schreibzugriffe werden über eine interne Warteschlange
 * serialisiert, damit parallele Quellen-Abrufe keine Race-Condition auf
 * derselben Datei verursachen.
 */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { neueArtikelAuffinden } from "./parser.js";

export class Speicher {
  constructor(dataDir, { maxArtikel = 500 } = {}) {
    this.pfad = path.join(dataDir, "kinews-daten.json");
    this.maxArtikel = maxArtikel;
    this.artikel = [];
    this.status = {};
    this._urlIndex = new Set();
    this._titelIndex = [];
    this._warteschlange = Promise.resolve();
  }

  /** Führt eine Aufgabe sequenziell nach allen bereits eingereihten Aufgaben aus. */
  _reihen(aufgabe) {
    const ergebnis = this._warteschlange.then(aufgabe, aufgabe);
    this._warteschlange = ergebnis.then(
      () => undefined,
      () => undefined
    );
    return ergebnis;
  }

  async _schreibe() {
    await mkdir(path.dirname(this.pfad), { recursive: true });
    const daten = JSON.stringify(
      { artikel: this.artikel, status: this.status },
      null,
      2
    );
    const vorueber = `${this.pfad}.tmp`;
    await writeFile(vorueber, daten, "utf8");
    await rename(vorueber, this.pfad);
  }

  async lade() {
    return this._reihen(async () => {
      try {
        const roh = await readFile(this.pfad, "utf8");
        const daten = JSON.parse(roh);
        this.artikel = Array.isArray(daten.artikel) ? daten.artikel : [];
        this.status = daten.status && typeof daten.status === "object" ? daten.status : {};
      } catch {
        this.artikel = [];
        this.status = {};
      }
      this._baueIndex();
    });
  }

  async speichere() {
    return this._reihen(() => this._schreibe());
  }

  /** Chronologisch absteigend nach Veröffentlichungszeit. */
  liste() {
    return [...this.artikel].sort((a, b) => (b.zeit ?? "").localeCompare(a.zeit ?? ""));
  }

  /**
   * Fügt neue Artikel hinzu, überspringt Duplikate (gleiche URL oder nahezu
   * gleicher Titel). Gibt die tatsächlich neuen Artikel zurück.
   */
  async hinzufuege(neue) {
    return this._reihen(async () => {
      const tatsaechlichNeue = neueArtikelAuffinden(neue, this.artikel);
      if (tatsaechlichNeue.length > 0) {
        this.artikel.push(...tatsaechlichNeue);
        this._baueIndex();
        if (this.artikel.length > this.maxArtikel) {
          // Älteste Artikel entfernen (nach zeit aufsteigend sortieren und kürzen)
          this.artikel.sort((a, b) => (a.zeit ?? "").localeCompare(b.zeit ?? ""));
          this.artikel = this.artikel.slice(this.artikel.length - this.maxArtikel);
          this._baueIndex();
        }
        await this._schreibe();
      }
      return tatsaechlichNeue;
    });
  }

  setzeStatus(quelleId, eintrag) {
    this.status[quelleId] = {
      ok: Boolean(eintrag.ok),
      letztePruefung: new Date().toISOString(),
      fehler: eintrag.fehler ?? null,
      artikelGefunden: eintrag.artikelGefunden ?? 0
    };
  }

  statusListe() {
    return Object.entries(this.status).map(([id, s]) => ({ id, ...s }));
  }

  _baueIndex() {
    this._urlIndex = new Set(this.artikel.map((a) => a.url).filter(Boolean));
    this._titelIndex = [];
  }
}
