/**
 * Abstraktion für den Abruf von Feed-Inhalten.
 *
 * `abrufeFeed(url, { timeoutMs })` liefert den Feed als Text zurück.
 * Die Standard-Implementierung nutzt das eingebaute fetch mit Timeout;
 * in Tests kann eine Mock-Funktion injiziert werden, die URLs auf
 * vorbereitete Feed-Inhalte (z. B. aus tests/mocks/) abbildet.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function abrufeFeedHttp(url, { timeoutMs = 8000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const antwort = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "KiNews/1.0 (RSS-Aggregator)",
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        ...headers
      }
    });
    if (!antwort.ok) {
      const fehler = new Error(`Feed-Status ${antwort.status} ${antwort.statusText}`.trim());
      fehler.status = antwort.status;
      throw fehler;
    }
    return await antwort.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Erzeugt eine Mock-Feed-Funktion für Tests und Offline-Betrieb.
 * `mapping` ist eine Map/Objekt { url: feedInhalt }.
 * Bei unbekannter URL wird ein Fehler geworfen (simulierter Ausfall).
 */
export function erstelleMockAbruf(mapping) {
  return async function mockAbrufeFeed(url) {
    const inhalt = mapping.get?.(url) ?? mapping[url];
    if (typeof inhalt === "string") {
      return inhalt;
    }
    if (typeof inhalt === "object" && inhalt !== null && inhalt.pfad) {
      return await readFile(path.resolve(inhalt.pfad), "utf8");
    }
    const fehler = new Error(`Feed nicht erreichbar (Mock): ${url}`);
    fehler.status = 0;
    throw fehler;
  };
}
