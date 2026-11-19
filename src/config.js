import path from "node:path";

/**
 * Zentrale Konfiguration, anpassbar über Umgebungsvariablen:
 *
 *  PORT            HTTP-Port (Default 3000)
 *  INTERVAL_MIN    Abrufintervall für den Hintergrund-Scheduler in Minuten (Default 5)
 *  FEED_TIMEOUT_MS HTTP-Timeout für Feed-Abfragen in ms (Default 8000)
 *  DATA_DIR        Ordner für die persistente Ablage (Default ./daten)
 *  MAX_ARTIKEL     Obergrenze gespeichert Artikel (Default 500)
 *  QUELLEN_IDS     Komma-separierte Liste aktiver Quellen-ids (Default: alle fünf)
 */
export function konfigurierung() {
  const env = process.env;
  return {
    port: Number(env.PORT ?? 3000),
    intervalMin: Number(env.INTERVAL_MIN ?? 5),
    feedTimeoutMs: Number(env.FEED_TIMEOUT_MS ?? 8000),
    dataDir: env.DATA_DIR
      ? path.resolve(env.DATA_DIR)
      : path.join(process.cwd(), "daten"),
    maxArtikel: Number(env.MAX_ARTIKEL ?? 500)
  };
}
