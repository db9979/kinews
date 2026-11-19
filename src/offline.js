/**
 * Offline-Modus (KINEWS_OFFLINE=1): liefert deterministische Beispieldaten
 * statt echter Feed-Abfragen – nützlich für Demo, CI und Tests ohne
 * Internetzugang.
 *
 * Pro Quelle werden zwei feste Artikel plus ein dynamischer Live-Artikel
 * pro Aufruf erzeugt, sodass jeder Abruf neue Nachrichten liefert und die
 * Echtzeit-Aktualisierung sichtbar wird.
 */
import { QUELLEN } from "./quellen.js";

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rssItem({ titel, url, datum, beschreibung, bild }) {
  return `    <item>
      <title>${escapeXml(titel)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${datum}</pubDate>
      <description>${escapeXml(beschreibung)}</description>${
    bild ? `\n      <media:content url="${escapeXml(bild)}" type="image/jpeg" medium="image"/>` : ""
  }
    </item>`;
}

function feedXml(quelle, items) {
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${escapeXml(quelle.name)}</title>
    <link>https://offline.kinews.example/${quelle.id}</link>
${items.join("\n")}
  </channel>
</rss>`;
}

/**
 * Erzeugt eine Feed-Funktion mit Offline-Beispieldaten.
 * Signatur wie `abrufeFeedHttp`: async (url, optionen) => xmlText.
 */
export function erstelleOfflineAbruf() {
  const aufrufe = new Map();
  return async (url) => {
    const quelle = QUELLEN.find((q) => q.rssUrl === url);
    if (!quelle) {
      const fehler = new Error(`Feed nicht erreichbar (offline): ${url}`);
      fehler.status = 0;
      throw fehler;
    }
    const n = (aufrufe.get(url) ?? 0) + 1;
    aufrufe.set(url, n);

    const items = [
      {
        titel: `Forscher von ${quelle.name} präsentieren durchbruchsreiche AI-Technologie`,
        url: `https://offline.kinews.example/${quelle.id}/artikel-1`,
        datum: "Mon, 09 Jun 2025 10:00:00 +0000",
        beschreibung: `Ein Report über die neuesten Entwicklungen in artificial intelligence und machine learning.`,
        bild: `https://picsum.photos/seed/kinews-${quelle.id}/640/360`
      },
      {
        titel: `Die fünf wichtigsten AI-Tools laut ${quelle.name}`,
        url: `https://offline.kinews.example/${quelle.id}/artikel-2`,
        datum: "Sun, 08 Jun 2025 18:30:00 +0000",
        beschreibung: `Vom LLM-Codeassistenten bis zum Bildgenerator: die Tools der Woche im Überblick.`,
        bild: null
      },
      {
        titel: `Live-Update ${n}: Neue AI-Entwicklungen im Minutentakt`,
        url: `https://offline.kinews.example/${quelle.id}/live-${n}`,
        datum: new Date().toUTCString(),
        beschreibung: `Automatisch erzeugter Live-Beitrag (Aufruf ${n}) zu AI und artificial intelligence.`,
        bild: null
      }
    ];
    return feedXml(quelle, items.map((i) => rssItem(i)));
  };
}
