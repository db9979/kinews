/**
 * Einfacher Event-Bus für Server-Events.
 * Unterstützt mehrere abonnierende Kanäle (z. B. je SSE-Verbindung einer).
 */
export class EventBus {
  constructor() {
    this.abonnenten = new Set();
  }

  abonniere(abonnent) {
    this.abonnenten.add(abonnent);
    return () => this.abonnenten.delete(abonnent);
  }

  /** Sendet ein Event an alle abonnierten Kanäle. */
  sende(typ, zahlung = null) {
    const daten = zahlung === null ? "" : JSON.stringify(zahlung);
    for (const kanal of this.abonnenten) {
      try {
        kanal.send(typ, daten);
      } catch {
        this.abonnenten.delete(kanal);
      }
    }
  }
}

/** Ein SSE-Kanal: kapselt einen HTTP-Response und schreibt korrekt formatierte Events. */
export function erstelleSseKanal(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  res.write(": verbunden\n\n");

  const halter = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      // Verbindung ist weg, wird über close aufgeräumt
    }
  }, 20000);

  return {
    send(typ, daten) {
      try {
        // `daten` ist je nach Aufrufer entweder bereits eine JSON-Zeichenkette
        // (EventBus.sende) oder ein rohes Objekt (z. B. das initiale init-Event).
        // Robust stringifizieren, damit nie "[object Object]" ins Stream landet.
        const payload =
          daten === null || daten === undefined
            ? ""
            : typeof daten === "string"
              ? daten
              : JSON.stringify(daten);
        res.write(`event: ${typ}\ndata: ${payload}\n\n`);
      } catch {
        // Kanal defekt; Aufräumlogik läuft über res close
      }
    },
    schliesse() {
      clearInterval(halter);
      try {
        res.end();
      } catch {
        /* ignoriert */
      }
    }
  };
}
