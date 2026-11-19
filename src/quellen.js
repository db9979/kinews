/**
 * Definitionen der acht fest konfigurierten News-Quellen.
 *
 * Jede Quelle hat:
 *  - id: interne Bezeichnung (stable, wird in URLs/Daten genutzt)
 *  - name: Anzeigename in der UI
 *  - farbe: Farbwert für Logo-Badge und Filter
 *  - rssUrl: Adresse des RSS/Atom-Feeds
 *  - kategorie: Rubrik, für den Kategorie-Filter im Frontend
 *    ("ai" für die KI-Feeds, "weltpolitik" / "finanzen" / "lokalpolitik" für
 *    die politischen Feeds)
 *  - keywords: Wortstamm-Filter; ein Item wird nur behalten, wenn
 *    Titel oder Beschreibung mindestens ein (kleingeschriebenes) Keyword enthält
 *  - intervall: Abrufintervall in Minuten (Default: 5)
 */
export const QUELLEN = [
  {
    id: "theverge",
    name: "The Verge AI",
    farbe: "#e5127d",
    rssUrl: "https://www.theverge.com/rss/index.xml",
    kategorie: "ai",
    keywords: ["ai", "artificial intelligence", "openai", "anthropic", "google deepmind", "llm", "chatgpt", "gemini", "claude", "machine learning", "deepmind"],
    intervall: 5
  },
  {
    id: "techcrunch",
    name: "TechCrunch AI",
    farbe: "#0a9e01",
    rssUrl: "https://techcrunch.com/category/artificial-intelligence/feed/",
    kategorie: "ai",
    keywords: ["ai", "artificial intelligence", "openai", "anthropic", "google deepmind", "llm", "chatgpt", "gemini", "claude", "machine learning", "deepmind"],
    intervall: 5
  },
  {
    id: "arstechnica",
    name: "Ars Technica AI",
    farbe: "#ff4c00",
    rssUrl: "https://feeds.arstechnica.com/arstechnica/technology-lab",
    kategorie: "ai",
    keywords: ["ai", "artificial intelligence", "openai", "anthropic", "google deepmind", "llm", "chatgpt", "gemini", "claude", "machine learning", "deepmind"],
    intervall: 5
  },
  {
    id: "venturebeat",
    name: "VentureBeat AI",
    farbe: "#6633cc",
    rssUrl: "https://venturebeat.com/category/ai/feed/",
    kategorie: "ai",
    keywords: ["ai", "artificial intelligence", "openai", "anthropic", "google deepmind", "llm", "chatgpt", "gemini", "claude", "machine learning", "deepmind"],
    intervall: 5
  },
  {
    id: "mittr",
    name: "MIT Technology Review",
    farbe: "#8b0000",
    rssUrl: "https://www.technologyreview.com/feed/",
    kategorie: "ai",
    keywords: ["ai", "artificial intelligence", "openai", "anthropic", "google deepmind", "llm", "chatgpt", "gemini", "claude", "machine learning", "deepmind"],
    intervall: 5
  },
  {
    id: "zeitwelt",
    name: "Zeit Welt",
    farbe: "#d5280f",
    rssUrl: "https://www.zeit.de/welt/rss",
    kategorie: "weltpolitik",
    // allgemeiner News-Feed: ohne Keyword-Filter, alle Artikel zählen
    keywords: [],
    intervall: 5
  },
  {
    id: "tagesschau-wirtschaft",
    name: "Tagesschau Wirtschaft",
    farbe: "#0053a1",
    rssUrl: "https://www.tagesschau.de/wirtschaft/rss",
    kategorie: "finanzen",
    // allgemeiner News-Feed: ohne Keyword-Filter, alle Artikel zählen
    keywords: [],
    intervall: 5
  },
  {
    id: "tagesschau-politik",
    name: "Tagesschau Politik",
    farbe: "#3d74c4",
    rssUrl: "https://www.tagesschau.de/politik/rss",
    kategorie: "lokalpolitik",
    // allgemeiner News-Feed: ohne Keyword-Filter, alle Artikel zählen
    keywords: [],
    intervall: 5
  }
];

/** Quelle nach id auflösen, undefined wenn unbekannt. */
export function quelleNachId(id) {
  return QUELLEN.find((q) => q.id === id);
}
