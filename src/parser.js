/**
 * RSS/Atom-Parser mit Normalisierung auf eine einheitliche Artikelstruktur:
 *   { id, url, titel, quelle, zeit, beschreibung, bild }
 */
import crypto from "node:crypto";

/* ---------- XML-Basis-Helfer (ohne externe Abhängigkeiten) ---------- */

function entmaskiereXml(text) {
  // CDATA-Blöcke (häufig in Atom-Feeds, z. B. The Verge):
  // <![CDATA[ … ]]> → rohen Inhalt, ohne die Marker zu behalten.
  return String(text ?? "")
    .replace(/<!\[CDATA\[\s*/g, "")
    .replace(/\s*\]\]>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, kodiert) => String.fromCharCode(Number(kodiert)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, "&");
}

function entmaskiereHtml(text) {
  return entmaskiereXml(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“");
}

/** Entnimmt den Inhalt eines (ersten) Tags; der Inhalt wird nicht weiter geparst. */
function tagInhalt(xml, tag, startVon = 0) {
  const start = xml.indexOf(`<${tag}`, startVon);
  if (start === -1) return "";
  const nachName = start + tag.length + 1;
  const groesser = xml.indexOf(">", nachName);
  if (groesser === -1) return "";
  const schliessende = `</${tag}>`;
  const ende = xml.indexOf(schliessende, groesser);
  if (ende === -1) return "";
  return xml.slice(groesser + 1, ende);
}

/** Liest einen Attributwert des ersten Tags mit dem Namen. */
function tagAttribut(xml, tag, attribut) {
  const start = xml.indexOf(`<${tag}`, 0);
  if (start === -1) return "";
  const groesser = xml.indexOf(">", start);
  if (groesser === -1) return "";
  const kopf = xml.slice(start, groesser);
  const muster = new RegExp(`${attribut}\\s*=\\s*["']([^"']+)["']`);
  const treffer = kopf.match(muster);
  return treffer ? treffer[1] : "";
}

/**
 * Ermittelt die Artikel-URL aus einem Item-Block.
 * RSS: <link>http://…</link> | Atom: <link rel="alternate" href="http://…"/> | Fallback: <guid>
 */
function linkAusBlock(block) {
  const text = tagInhalt(block, "link").trim();
  if (text && /^https?:\/\//i.test(text)) return text;
  let position = 0;
  while (true) {
    const start = block.indexOf("<link", position);
    if (start === -1) break;
    const groesser = block.indexOf(">", start);
    if (groesser === -1) break;
    const kopf = block.slice(start, groesser);
    const href = kopf.match(/href\s*=\s*["']([^"']+)["']/);
    const rel = kopf.match(/rel\s*=\s*["']([^"']+)["']/);
    if (href && (!rel || rel[1] === "alternate") && /^https?:\/\//i.test(href[1])) return href[1];
    position = groesser + 1;
  }
  const guid = tagInhalt(block, "guid").trim();
  if (guid && /^https?:\/\//i.test(guid)) return guid;
  return "";
}

/* ---------- Normalisierung ---------- */

export function artikelId(url) {
  return crypto.createHash("sha1").update(String(url ?? "")).digest("hex").slice(0, 20);
}

/** Normalisiert einen einzelnen Item-/Entry-Block zu einem Artikel-Objekt. */
export function normalisiereItem(block, quelle, index = 0) {
  const url = entmaskiereXml(linkAusBlock(block)).trim();

  const titel = entmaskiereHtml(tagInhalt(block, "title").trim()).trim();

  const zeitRoh =
    tagInhalt(block, "pubDate") ||
    tagInhalt(block, "published") ||
    tagInhalt(block, "updated") ||
    tagInhalt(block, "dc:date");
  const zeit = zeitRoh ? new Date(zeitRoh.trim()) : new Date(NaN);

  let beschreibung = entmaskiereHtml(
    tagInhalt(block, "description") ||
      tagInhalt(block, "summary") ||
      tagInhalt(block, "content") ||
      tagInhalt(block, "content:encoded")
  ).trim();
  beschreibung = beschreibung.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  let bild = "";
  const enclosureTyp = tagAttribut(block, "enclosure", "type");
  if (/image\//.test(enclosureTyp)) {
    bild = entmaskiereXml(tagAttribut(block, "enclosure", "url"));
  } else {
    bild = entmaskiereXml(
      tagAttribut(block, "media:content", "url") || tagAttribut(block, "media:thumbnail", "url")
    );
  }

  return {
    id: url ? artikelId(url) : `tmp-${index}-${Date.now()}`,
    url,
    titel,
    quelle: quelle.id,
    zeit: Number.isNaN(zeit.getTime()) ? null : zeit.toISOString(),
    beschreibung: beschreibung.slice(0, 500),
    bild: bild || null
  };
}

/** Zerlegt ein Feed in Item-/Entry-Blöcke (RSS <item>, Atom <entry>). */
export function extrahiereItems(xml) {
  const starts = [];
  for (const tag of ["item", "entry"]) {
    let position = 0;
    while (true) {
      const mitLeer = xml.indexOf(`<${tag} `, position);
      const ohneLeer = xml.indexOf(`<${tag}>`, position);
      let tatsaechlich = -1;
      if (mitLeer === -1) tatsaechlich = ohneLeer;
      else if (ohneLeer === -1) tatsaechlich = mitLeer;
      else tatsaechlich = Math.min(mitLeer, ohneLeer);
      if (tatsaechlich === -1) break;
      starts.push({ start: tatsaechlich, tag });
      position = tatsaechlich + 1;
    }
  }
  starts.sort((a, b) => a.start - b.start);
  const bloecke = [];
  for (const { start, tag } of starts) {
    const ende = xml.indexOf(`</${tag}>`, start);
    if (ende === -1) continue;
    bloecke.push(xml.slice(start, ende + tag.length + 3));
  }
  return bloecke;
}

/**
 * Parst einen kompletten RSS/Atom-Feed und liefert normalisierte Artikel.
 * `quelle` ist der Quell-Definitionseintrag (mind. { id }).
 */
export function parseFeed(xml, quelle) {
  if (typeof xml !== "string" || xml.trim().length === 0) {
    throw new Error("Leerer Feed-Inhalt");
  }
  const bloecke = extrahiereItems(xml);
  if (bloecke.length === 0) {
    throw new Error("Keine Items/Entries im Feed gefunden");
  }
  return bloecke
    .map((block, i) => normalisiereItem(block, quelle, i))
    .filter((a) => a.url && a.titel);
}

/* ---------- Keyword-Filter (KI-Bezug) ---------- */

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Ein Artikel gilt als KI-bezogen, wenn Titel oder Beschreibung mindestens
 * ein Keyword der Quelle enthalten. Kurze Keywords (z. B. "ai") werden
 * wortgenau geprüft, längere Ausdrücke als Teilzeichenfolge.
 */
export function enthaeltKeyword(artikel, keywords) {
  const text = `${artikel.titel} ${artikel.beschreibung}`.toLowerCase();
  for (const keyword of keywords ?? []) {
    const kw = String(keyword).toLowerCase();
    if (kw.length <= 3) {
      const muster = new RegExp(`(^|[^a-z0-9])${escapeRegex(kw)}($|[^a-z0-9])`);
      if (muster.test(text)) return true;
    } else if (text.includes(kw)) {
      return true;
    }
  }
  return false;
}

/* ---------- Duplikaterkennung ---------- */

/**
 * Normalform eines Titels: kleingeschrieben, ohne Umlaut-Diakritika und
 * Satzzeichen, zusammengefasste Leerzeichen – für den Vergleich nahezu
 * gleicher Titel.
 */
export function titelNormalform(titel) {
  return String(titel ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Jaccard-Ähnlichkeit zweier Wort-Mengen (0..1). */
export function titelAehnlichkeit(titelA, titelB) {
  const a = new Set(titelNormalform(titelA).split(" ").filter(Boolean));
  const b = new Set(titelNormalform(titelB).split(" ").filter(Boolean));
  if (a.size === 0 && b.size === 0) return 1;
  let gemeinsam = 0;
  for (const wort of a) if (b.has(wort)) gemeinsam += 1;
  const vereinigt = a.size + b.size - gemeinsam;
  return vereinigt === 0 ? 1 : gemeinsam / vereinigt;
}

/**
 * Liefert aus der Liste `neu` nur Artikel, die weder per URL noch per
 * nahezu gleichem Titel (Jaccard >= titelSchwelle) mit einem bereits
 * bekannten Artikel (oder einem vorher akzeptierten neuen Artikel)
 * übereinstimmen.
 */
export function neueArtikelAuffinden(neu, bekannt, { titelSchwelle = 0.85 } = {}) {
  const bekannteUrls = new Set(bekannt.map((a) => a.url).filter(Boolean));
  const bekanntenTiteln = bekannt
    .map((a) => titelNormalform(a.titel))
    .filter(Boolean);

  const akzeptiert = [];
  const akzeptierteUrls = new Set();
  const akzeptierteTitel = [];

  for (const artikel of neu) {
    if (!artikel.url || !artikel.titel) continue;
    if (bekannteUrls.has(artikel.url)) continue;
    if (akzeptierteUrls.has(artikel.url)) continue;

    const form = titelNormalform(artikel.titel);
    let duplikat = false;

    for (const altForm of bekanntenTiteln) {
      if (form === altForm || titelAehnlichkeit(form, altForm) >= titelSchwelle) {
        duplikat = true;
        break;
      }
    }
    if (!duplikat) {
      for (const neuForm of akzeptierteTitel) {
        if (form === neuForm || titelAehnlichkeit(form, neuForm) >= titelSchwelle) {
          duplikat = true;
          break;
        }
      }
    }
    if (duplikat) continue;

    akzeptiert.push(artikel);
    akzeptierteUrls.add(artikel.url);
    akzeptierteTitel.push(form);
  }
  return akzeptiert;
}
