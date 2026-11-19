/**
 * Hintergrund-Scheduler: ruft periodisch die konfigurierten Quellen ab,
 * parst und filtert die Artikel, erkennt Duplikate, speichert neue Funde
 * und meldet sie über den EventBus an die verbundenen Clients.
 */
import { parseFeed, enthaeltKeyword } from "./parser.js";

/**
 * Erzeugt den Scheduler.
 *
 * optionen:
 *  - quellens: Array von Quellen-Definitionen
 *  - speicher: Speicher-Instanz
 *  - ereignisse: EventBus
 *  - abrufeFeed: async (url) => feedText (Standard: HTTP)
 *  - intervallMs: Intervall in ms
 *  - timeoutMs: Feed-Timeout in ms
 *  - log: (nachricht) => void
 */
export function erstelleScheduler({
  quellens,
  speicher,
  ereignisse,
  abrufeFeed,
  intervallMs = 5 * 60 * 1000,
  timeoutMs = 8000,
  log = () => {}
}) {
  let laeuft = false;
  let gestoppt = true;
  let timer = null;

  /** Ruft eine einzelne Quelle ab und verarbeitet die Artikel. */
  async function verarbeiteQuelle(quelle) {
    const start = Date.now();
    try {
      const xml = await abrufeFeed(quelle.rssUrl, { timeoutMs });
      const artikle = parseFeed(xml, quelle);
      // Quellen mit leerer Keyword-Liste (z. B. allgemeine News-Feeds) filtern
      // nicht: alle Artikel werden übernommen.
      const kiArtikel =
        quelle.keywords && quelle.keywords.length > 0
          ? artikle.filter((a) => enthaeltKeyword(a, quelle.keywords))
          : artikle;
      const neue = await speicher.hinzufuege(kiArtikel);

      speicher.setzeStatus(quelle.id, {
        ok: true,
        artikelGefunden: kiArtikel.length,
        fehler: null
      });

      if (neue.length > 0) {
        log(`[Scheduler] ${quelle.name}: ${neue.length} neue Artikel`);
        ereignisse.sende("neue_artikel", { artikel: neue, quelle: quelle.id });
      } else {
        log(`[Scheduler] ${quelle.name}: nichts Neues (${kiArtikel.length} KI-Artikel geprüft)`);
      }
      return { ok: true, neue: neue.length, gefunden: kiArtikel.length, dauerMs: Date.now() - start };
    } catch (fehler) {
      const meldung = fehler?.name === "AbortError" ? "Zeitüberschreitung" : fehler.message;
      speicher.setzeStatus(quelle.id, {
        ok: false,
        artikelGefunden: 0,
        fehler: meldung
      });
      log(`[Scheduler] ${quelle.name} nicht erreichbar: ${meldung}`);
      return { ok: false, fehler: meldung, dauerMs: Date.now() - start };
    }
  }

  /** Ein kompletter Abruf aller Quellen (parallel, unabhängig). */
  async function durchlauf() {
    if (laeuft) return;
    laeuft = true;
    const start = Date.now();
    try {
      const ergebnisse = await Promise.allSettled(quellens.map((q) => verarbeiteQuelle(q)));
      const fehler = ergebnisse.filter((e) => e.status === "rejected").length;
      log(`[Scheduler] Durchlauf fertig in ${Date.now() - start} ms (${fehler} unerwartete Fehler)`);
      ereignisse.sende("status", {
        quelle: null,
        status: speicher.statusListe(),
        zeit: new Date().toISOString()
      });
      await speicher.speichere();
    } finally {
      laeuft = false;
    }
  }

  /** Startet den ersten Abruf sofort und wiederholt danach im Intervall. */
  function starte() {
    gestoppt = false;
    if (timer) clearInterval(timer);
    durchlauf().catch((f) => log(`[Scheduler] Fehler im Durchlauf: ${f.message}`));
    timer = setInterval(() => {
      if (!gestoppt) {
        durchlauf().catch((f) => log(`[Scheduler] Fehler im Durchlauf: ${f.message}`));
      }
    }, intervallMs);
  }

  function stoppe() {
    gestoppt = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    starte,
    stoppe,
    durchlauf,
    istLaeuft: () => laeuft,
    istGestoppt: () => gestoppt,
    intervallMs
  };
}
