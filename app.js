/* Schulplaner – Handy-App. Liest Wochenpakete (JSON aus der Datenbank), speichert alle Eintragungen
   nur auf diesem Gerät (localStorage) und gibt sie als Rückmeldung-Datei zurück. Kein Server. */
"use strict";
const APP_VERSION = "0.6.0";
const SCHLUESSEL = "schulplaner";
const TAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const ZEITEN = { B: "Bahnfahrt", F: "Vormittag", N: "Nachmittag", A: "Abend", W: "Wochenende" };
const STAND = ["–", "¼", "½", "¾", "✓"];
const UEBEN_IDEEN = ["Aufgaben im Buch", "Online-Übung", "Karteikarten", "Selbsttest (abdecken)", "aus dem Kopf aufschreiben oder zeichnen", "mit Lösung vergleichen"];
const URSACHEN = ["Methode", "Menge", "Zeitpunkt", "Ort", "Fokus", "Sonstiges"];
const TAG_LANG = { Mo: "Montag", Di: "Dienstag", Mi: "Mittwoch", Do: "Donnerstag", Fr: "Freitag", Sa: "Samstag", So: "Sonntag" };
// Wie sitzt es? Leer = noch nicht eingeschätzt (Sanduhr). Die Werte gehen so in die Datenbank (tblWegMaterial.Einschaetzung).
const SITZT = [["", "noch nicht eingeschätzt"], ["sitzt", "sitzt"], ["unsicher", "unsicher"], ["nicht verstanden", "nicht verstanden"]];
// Beispiele zum Üben, klein unter der Übungszeit: in der Bahn nur Leichtes
const UEBEN_BAHN = "zum Beispiel Karteikarten, Vokabeln, ein Video ansehen, etwas Kurzes lesen";
const UEBEN_TISCH = "zum Beispiel Aufgaben im Buch, Online-Übung, Karteikarten, Selbsttest, aus dem Kopf aufschreiben";

// ---------------------------------------------------------------- Zustand
let Z = laden();
let ansicht = { seite: "heute", fach: null };   // dazu kurz offen: leiste (Auswahl unter dem Titel), notiz, tipp

function laden() {
  let z = null;
  try { z = JSON.parse(localStorage.getItem(SCHLUESSEL)); } catch (e) { /* leer oder gesperrt */ }
  return Object.assign({ pakete: {}, woche: null, e: {}, theme: null }, z || {});
}
function speichern() {
  try { localStorage.setItem(SCHLUESSEL, JSON.stringify(Z)); } catch (e) { /* privater Modus */ }
}
const paket = () => Z.pakete[Z.woche] || null;
function eintraege() {                                  // Eintragungen der aktuellen Woche
  const w = Z.woche;
  if (!Z.e[w]) Z.e[w] = { mat: {}, fach: {}, retro: {}, termine: {} };
  if (!Z.e[w].vt) Z.e[w].vt = {};                      // Änderungen an der Stoffverteilung (je VerteilungID)
  return Z.e[w];
}
function eFach(name) {
  const e = eintraege();
  if (!e.fach[name]) e.fach[name] = { ueben: [], frei: {} };
  return e.fach[name];
}
function eMat(id) {
  const e = eintraege();
  if (!e.mat[id]) e.mat[id] = { stand: 0 };
  return e.mat[id];
}

// ---------------------------------------------------------------- Helfer
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const datum = (iso) => new Date(iso + "T12:00:00");
const kurzDatum = (iso) => { const d = datum(iso); return TAGE[(d.getDay() + 6) % 7] + " " + d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }); };
const heuteTag = () => TAGE[(new Date().getDay() + 6) % 7];
const heuteIso = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const pflicht = (f) => f.Aufgaben.filter((a) => a.KernVertiefung === "Kern");
const freiwillig = (f) => f.Aufgaben.filter((a) => a.KernVertiefung !== "Kern");
const vorschlaege = (f, art) => f.Vorschlaege.filter((v) => v.Art === art);
// ---- Stoffverteilung aus der Datenbank (Wochenpaket.Verteilung): je Zeile Tag, Zeitfenster, Fach, Art, Aufgabe, Minuten.
// Emil kann Tag und Zeitfenster ändern; die Änderung liegt in eintraege().vt und geht mit der Rückmeldung zurück.
const verteilung = () => (paket() && paket().Verteilung) || [];
function eVt(id) { const e = eintraege(); if (!e.vt[id]) e.vt[id] = {}; return e.vt[id]; }
const vtTag = (v) => eVt(v.VerteilungID).tag || v.Wochentag;
const vtFenster = (v) => eVt(v.VerteilungID).fenster || v.Zeitfenster;
const istVorschlag = (v) => !!v.VorschlagTag && vtTag(v) === v.VorschlagTag && vtFenster(v) === v.VorschlagFenster;
const sortVt = (a, b) => TAGE.indexOf(vtTag(a)) - TAGE.indexOf(vtTag(b)) || String(vtFenster(a)).localeCompare(String(vtFenster(b)));
const zeitKurz = (fenster) => (/Bahn/.test(fenster || "") ? fenster.replace(/^\d\d:\d\d /, "") : String(fenster || "").slice(0, 5));
// Alle Zeitfenster zur Auswahl beim Verschieben: Bahn, Schulstunden, Zeiten zu Hause und was schon in der Verteilung steht
function zeitfenster() {
  const p = paket(), l = new Set(["08:00 Bahn hin", "14:00 Bahn heim"]);
  for (const s of p.Stundenplan || []) if (s.Reihenfolge >= 2 && s.ZeitBis && !/^Pause/i.test(s.Inhalt)) l.add(s.ZeitVon + "-" + s.ZeitBis);
  for (const v of verteilung()) l.add(v.Zeitfenster);
  for (const v of Object.values(eintraege().vt)) if (v.fenster) l.add(v.fenster);
  return [...l].filter(Boolean).sort();
}
// Was in diesem Zeitfenster ist: Schulstunde, Bahn oder Termin zu Hause
function fensterText(tag, fenster) {
  const p = paket();
  if (/Bahn/.test(fenster)) return fenster.replace(/^\d\d:\d\d /, "") + " (" + fenster.slice(0, 5) + ")";
  const s = (p.Stundenplan || []).find((x) => x.Wochentag === tag && x.ZeitVon + "-" + x.ZeitBis === fenster);
  if (s) return fenster.replace(/-/, "–") + ` · ${s.Inhalt}`;
  // sonst ein Termin (Nachmittag, Wochenende): Name enthält Uhrzeit und Ort, dazu Fach und Person
  const t = (p.Termine || []).find((x) => x.Datum && x.FachID && TAGE[(datum(x.Datum).getDay() + 6) % 7] === tag && fenster.startsWith(x.Uhrzeit || "~"));
  return fenster.replace(/-/, "–") + (t ? ` · ${t.FachID}${t.PersonName ? " mit " + t.PersonName : ""}` : "");
}
// Wochentag mit Datum in der geladenen Woche, zum Beispiel "Di 20.10."
const tagDatum = (tag) => { const p = paket(); if (!p) return tag; const d = datum(p.Woche.StartDatum); d.setDate(d.getDate() + TAGE.indexOf(tag)); return tag + " " + d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }); };
const wannText = (v) => `${vtTag(v)} ${zeitKurz(vtFenster(v))}`;
const marke = (v) => (istVorschlag(v) ? `<span class="vorschlag">Vorschlag</span>` : `<span class="geaendert">${v.VorschlagTag ? "verschoben" : "eigen"}</span>`);
// Auswahl zum Verschieben, eingeklappt
const verschieben = (v) => `<details class="verschieben"><summary>verschieben</summary><div class="zwei">${auswahl("vt-tag", TAGE.map((t) => [t, t]), vtTag(v), "Tag", `data-id="${v.VerteilungID}"`)}${auswahl("vt-fenster", zeitfenster().map((z) => [z, z]), vtFenster(v), "Zeit", `data-id="${v.VerteilungID}"`)}</div>${v.VorschlagTag && !istVorschlag(v) ? `<button class="link" data-a="vt-zurueck" data-id="${v.VerteilungID}">zurück zum Vorschlag (${esc(v.VorschlagTag)} ${esc(zeitKurz(v.VorschlagFenster))})</button>` : ""}</details>`;
// Art einer Aufgabe: Symbol und Text für den Knopf (aus Kategorie, Fundstelle, Link)
function medium(a) {
  const t = [a.Kategorie, a.Fundstelle, a.Titel, a.URL].join(" ");
  if (!a.URL) return { symbol: "📖", art: "Buch", knopf: "" };
  if (/video|film|youtube|ted\.com|elllo|abc\.net/i.test(t)) return { symbol: "🎬", art: "Video", knopf: "Video ansehen" };
  if (/listening|hören|audio|podcast/i.test(t)) return { symbol: "🎧", art: "Hören", knopf: "Anhören" };
  if (/pdf/i.test(t)) return { symbol: "📄", art: "PDF", knopf: "PDF öffnen" };
  if (/übung|interaktiv|geogebra|applet|quiz|exercise|training/i.test(t)) return { symbol: "✏️", art: "Online-Übung", knopf: "Online üben" };
  return { symbol: "🌐", art: "Online-Text", knopf: "Online lesen" };
}
const artZeichen = (a) => `<span class="art" title="${medium(a).art}"><span aria-hidden="true">${medium(a).symbol}</span> ${medium(a).art}</span>`;
// Symbol vor dem Zeitfenster: Bahn, Schule, Termin
const ortZeichen = (fenster) => (/Bahn/.test(fenster) ? "🚆" : /^\d\d:\d\d-\d\d:\d\d$/.test(fenster) ? "🏫" : "📍");
const kurzQuelle = (s) => { s = (s || "").split(" (")[0]; return s.length > 38 ? s.slice(0, 37) + "…" : s; };

function fortschritt(f) {                               // Anteil der Pflichtaufgaben, gestrichene zählen nicht
  const liste = pflicht(f).filter((a) => !eMat(a.MaterialID).weg);
  if (!liste.length) return { fertig: 0, anzahl: 0, anteil: 0 };
  const summe = liste.reduce((s, a) => s + (eMat(a.MaterialID).stand || 0) / 4, 0);
  return { fertig: liste.filter((a) => eMat(a.MaterialID).stand === 4).length, anzahl: liste.length, anteil: summe / liste.length };
}

// ---------------------------------------------------------------- Symbole (SVG, wie im Mock-up)
const svg = (inhalt, gross = 24) => `<svg viewBox="0 0 24 24" width="${gross}" height="${gross}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inhalt}</svg>`;
const IKON = {
  welt: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.2 3.6 3.2 14.4 0 18M12 3c-3.2 3.6-3.2 14.4 0 18"/>',
  film: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M6 6l2 4M11 6l2 4M16 6l2 4"/>',
  hoeren: '<path d="M4 16v-4a8 8 0 0 1 16 0v4"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>',
  pdf: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h4"/>',
  uebung: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  notiz: '<path d="M15 9V4H5v16h6"/><path d="M8 8h4M8 12h3"/><path d="M13 21l.8-3 5.4-5.4 2.2 2.2-5.4 5.4z"/>',
  birne: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.8 10.6c.6.6.8 1.4.8 2.4h6c0-1 .2-1.8.8-2.4A6 6 0 0 0 12 3z"/>',
  mond: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  sonne: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M5 19l1.4-1.4M17.6 6.4L19 5"/>',
  sanduhr: '<path d="M6 3h12M6 21h12M7.5 3c0 5 4.5 6 4.5 9s-4.5 4-4.5 9M16.5 3c0 5-4.5 6-4.5 9s4.5 4 4.5 9"/>',
};
const ikon = (name, gross) => svg(IKON[name], gross);
// Fortschritt als grüner Kreis: leer, ¼, ½, ¾ oder voll
function torte(stand, gross = 30) {
  const r = 9.5, c = 12, w = (stand || 0) / 4 * 2 * Math.PI;
  const x = (c + r * Math.sin(w)).toFixed(2), y = (c - r * Math.cos(w)).toFixed(2);
  const fuell = stand >= 4 ? `<circle cx="12" cy="12" r="${r}" fill="var(--gut)"/>` : stand > 0 ? `<path d="M12 12V${c - r}A${r} ${r} 0 ${stand > 2 ? 1 : 0} 1 ${x} ${y}z" fill="var(--gut)"/>` : "";
  return `<svg viewBox="0 0 24 24" width="${gross}" height="${gross}" aria-hidden="true"><circle cx="12" cy="12" r="${r}" fill="none" stroke="var(--gut)" stroke-width="2"/>${fuell}</svg>`;
}
// Wie sitzt es? graue Sanduhr, grüner Haken, gelbes Dreieck mit !, rotes Dreieck mit ?
function sitztZeichen(wert, gross = 30) {
  if (wert === "sitzt") return `<span class="gruen">${svg('<path d="M4.5 12.5l5 5L19.5 7" stroke-width="3"/>', gross)}</span>`;
  const dreieck = (fuell, rand, zeichen, farbe) => `<svg viewBox="0 0 24 24" width="${gross}" height="${gross}" aria-hidden="true"><path d="M12 2.8L22 20.5H2z" fill="${fuell}" stroke="${rand}" stroke-width="1.4" stroke-linejoin="round"/><text x="12" y="18.2" text-anchor="middle" font-size="11" font-weight="700" font-family="system-ui,sans-serif" fill="${farbe}">${zeichen}</text></svg>`;
  if (wert === "unsicher") return dreieck("#f2c230", "#8a6d00", "!", "#1b1f24");
  if (wert === "nicht verstanden") return dreieck("#d64535", "#8f1f14", "?", "#ffffff");
  return `<span class="grau">${ikon("sanduhr", gross)}</span>`;
}
const STAND_TEXT = ["noch nicht angefangen", "ein Viertel geschafft", "die Hälfte geschafft", "drei Viertel geschafft", "fertig"];
const standWerte = STAND_TEXT.map((t, i) => [i, t]);
// Status rechts neben dem Titel. Ein Tipp öffnet darunter die Leiste mit allen Werten, ein Tipp auf einen Wert wählt ihn und schließt sie.
const statusKnopf = (schluessel, inhalt, text) => `<button class="status" data-a="auf" data-w="${schluessel}" aria-expanded="${ansicht.leiste === schluessel}" aria-label="${esc(text)} (ändern)">${inhalt}</button>`;
function leiste(schluessel, aktion, werte, aktiv, zeichen, id) {
  if (ansicht.leiste !== schluessel) return "";
  return `<div class="leiste" role="group">` + werte.map(([w, t]) => `<button data-a="${aktion}" data-w="${esc(w)}" ${id} aria-pressed="${String(aktiv ?? "") === String(w)}" aria-label="${esc(t)}">${zeichen(w)}</button>`).join("") + `</div>`;
}
// Kopf einer Karte: Titel links, Fortschritt und (nur bei Aufgaben) Wie sitzt es? rechts, darunter die offene Leiste
function kartenKopf(titel, standAktion, stand, id, sitzt) {
  const k = id.replace(/\D/g, ""), sS = `${standAktion}:${k}`, sZ = `sitzt:${k}`;
  return `<div class="kartenkopf"><div class="kopftext">${titel}</div><div class="statusse">
      ${statusKnopf(sS, torte(stand), "Wie weit: " + STAND_TEXT[stand || 0])}
      ${sitzt !== undefined ? statusKnopf(sZ, sitztZeichen(sitzt), "Wie sitzt es: " + (sitzt || "noch nicht eingeschätzt")) : ""}</div></div>
    ${leiste(sS, standAktion, standWerte, stand || 0, (w) => torte(Number(w), 34), id)}
    ${sitzt !== undefined ? leiste(sZ, "sitzt", SITZT, sitzt || "", (w) => sitztZeichen(w, 30), id) : ""}`;
}
// Wann eine Zeile der Stoffverteilung ist, in Worten: "Mittwoch Bahnfahrt", "Dienstag Freiarbeit / Vormittag, 09:50"
function eingeplantText(v) {
  const tag = vtTag(v), fenster = vtFenster(v) || "", lang = TAG_LANG[tag] || tag;
  if (/Bahn/.test(fenster)) return lang + " Bahnfahrt";
  const h = Number(fenster.slice(0, 2));
  const teil = tag === "Sa" || tag === "So" ? "Wochenende" : h < 13 ? "Freiarbeit / Vormittag" : h < 18 ? "Nachmittag" : "Abend";
  return `${lang} ${teil}${/^\d\d:\d\d/.test(fenster) ? ", " + fenster.slice(0, 5) : ""}`;
}
// Eingeplant: aus der Stoffverteilung (lila = Vorschlag), sonst selbst gewählt; fehlt beides, rote Auswahlfelder Tag und Zeitraum
function planZeile(a, m, id) {
  const vs = verteilung().filter((v) => v.MaterialID === a.MaterialID).sort(sortVt);
  if (vs.length) return `<p class="eingeplant">Eingeplant: ` + vs.map((v) => `<span class="${istVorschlag(v) ? "lila" : ""}">${esc(eingeplantText(v))}</span>`).join(", ") + `</p>`;
  const felder = `<div class="zwei">${auswahl("tag", tagOptionen, m.tag, "Tag", id + (m.tag ? "" : ' class="rot"'))}${auswahl("zeit", zeitOptionen, m.zeit, "Zeitraum", id + (m.zeit ? "" : ' class="rot"'))}</div>`;
  if (m.tag && m.zeit) return `<p class="eingeplant">Eingeplant: ${esc(TAG_LANG[m.tag] + " " + ZEITEN[m.zeit])}</p><details class="verschieben"><summary>ändern</summary>${felder}</details>`;
  return `<div class="planen">${felder}</div>`;
}
// Symbol-Leiste unten: Link öffnen (Symbol je nach Art), Notiz (mit Punkt, wenn eine da ist), Glühbirne (Lerntechnik)
const LINK_IKON = { Video: "film", "Hören": "hoeren", PDF: "pdf", "Online-Übung": "uebung", "Online-Text": "welt" };
function ikonLeiste(a, m, id, mitWeg) {
  const md = medium(a), tech = a.Techniken || [];
  let h = `<div class="ikonleiste">`;
  if (a.URL) h += `<a class="ikon" href="${esc(a.URL)}" target="_blank" rel="noopener" aria-label="${esc(md.knopf)}" title="${esc(md.knopf)}">${ikon(LINK_IKON[md.art] || "welt")}</a>`;
  h += `<button class="ikon ${m.notiz ? "hat" : ""}" data-a="notiz-auf" data-w="${a.MaterialID}" aria-expanded="${ansicht.notiz === a.MaterialID}" aria-label="Notiz${m.notiz ? " (vorhanden)" : ""}" title="Notiz">${ikon("notiz")}</button>`;
  if (tech.length) h += `<button class="ikon" data-a="tipp-auf" data-w="${a.MaterialID}" aria-expanded="${ansicht.tipp === a.MaterialID}" aria-label="Lerntechnik" title="Lerntechnik">${ikon("birne")}</button>`;
  if (mitWeg) h += `<button class="chip klein rechts" data-a="weg" ${id} aria-pressed="${!!m.weg}">lasse ich weg</button>`;
  h += `</div>`;
  if (ansicht.notiz === a.MaterialID) h += `<div class="aufklapp">${text("m-notiz", m.notiz || "", "Notiz zu dieser Aufgabe: Fragen, Schwieriges, Ideen", id)}</div>`;
  if (ansicht.tipp === a.MaterialID) h += `<div class="aufklapp">` + tech.map((t) => `<p><strong>${esc(t.Technik)}</strong><br>${esc(t.KurzErklaert || "")}</p>${t.SoGehts ? `<details><summary>So geht's</summary><p class="sogehts">${esc(t.SoGehts)}</p></details>` : ""}`).join("") + `</div>`;
  return h;
}

// ---------------------------------------------------------------- Bausteine
const chips = (aktion, werte, aktiv, extra = "") => `<div class="chips" role="group">` + werte.map((w, i) => {
  const [wert, text] = Array.isArray(w) ? w : [i, w];
  return `<button class="chip" data-a="${aktion}" data-w="${esc(wert)}" ${extra} aria-pressed="${String(aktiv) === String(wert)}">${esc(text)}</button>`;
}).join("") + `</div>`;
const auswahl = (aktion, optionen, aktiv, leer, extra = "") => `<select data-a="${aktion}" ${extra} aria-label="${esc(leer)}"><option value="">${esc(leer)}</option>` +
  optionen.map(([w, t]) => `<option value="${esc(w)}" ${String(aktiv) === String(w) ? "selected" : ""}>${esc(t)}</option>`).join("") + `</select>`;
const feld = (aktion, wert, platz, extra = "", typ = "text") => `<input type="${typ}" data-a="${aktion}" ${extra} value="${esc(wert)}" placeholder="${esc(platz)}" aria-label="${esc(platz)}">`;
const text = (aktion, wert, platz, extra = "") => `<textarea data-a="${aktion}" ${extra} placeholder="${esc(platz)}" aria-label="${esc(platz)}">${esc(wert)}</textarea>`;
const tagOptionen = TAGE.map((t) => [t, t]);
const zeitOptionen = Object.entries(ZEITEN);

function aufgabeKarte(f, a, mitFach) {
  const m = eMat(a.MaterialID), id = `data-id="${a.MaterialID}"`;
  const meta = [kurzQuelle(a.Quelle), a.Fundstelle, a.Minuten ? a.Minuten + " Min." : "bei Bedarf"].filter(Boolean).join(" · ");
  return `<div class="karte ${m.stand === 4 ? "fertig" : ""} ${m.weg ? "weg" : ""}" style="--farbe:${esc(f.Farbe)}">
    ${mitFach ? `<span class="fachname"><i class="punkt"></i>${esc(f.Fach)}</span>` : ""}
    ${kartenKopf(`<div class="titel">${esc(a.Titel)}</div><div class="meta">${artZeichen(a)} · ${esc(meta)}</div>`, "stand", m.stand || 0, id, m.sitzt || "")}
    <p>${esc(a.Anweisung)}</p>
    ${m.weg ? `<p class="leise">Lasse ich weg.</p>` : planZeile(a, m, id)}
    ${ikonLeiste(a, m, id, true)}
  </div>`;
}

// ---------------------------------------------------------------- Seiten
// Eine Karte für eine Zeile der Stoffverteilung: Aufnehmen zeigt die Aufgabe, Üben und Zeigen eine eigene Karte
function vtKarte(v) {
  const p = paket(), f = p.Faecher.find((x) => x.Fach === v.FachID);
  if (!f) return "";
  const a = v.MaterialID && f.Aufgaben.find((x) => x.MaterialID === v.MaterialID);
  const kopf = `<div class="zeile kopfzeile"><span class="fachname">${esc(f.Fach)} · ${esc(v.Art)}</span>${marke(v)}<span class="leise">${v.Minuten ? v.Minuten + " Min." : ""}</span></div>`;
  if (a) {
    const m = eMat(a.MaterialID), id = `data-id="${a.MaterialID}"`;
    const meta = [kurzQuelle(a.Quelle), a.Fundstelle, a.Minuten ? "insgesamt " + a.Minuten + " Min." : ""].filter(Boolean).join(" · ");
    return `<div class="karte fach ${m.stand === 4 ? "fertig" : ""} ${m.weg ? "weg" : ""}" style="--farbe:${esc(f.Farbe)}">${kopf}
      ${kartenKopf(`<div class="titel">${esc(a.Titel)}</div><div class="meta">${artZeichen(a)} · ${esc(meta)}</div>`, "stand", m.stand || 0, id, m.sitzt || "")}
      <p>${esc(a.Anweisung)}</p>${m.weg ? `<p class="leise">Lasse ich weg.</p>` : ""}
      ${ikonLeiste(a, m, id, false)}${verschieben(v)}</div>`;
  }
  const o = eVt(v.VerteilungID), x = `data-id="${v.VerteilungID}"`;
  return `<div class="karte fach ${o.stand === 4 ? "fertig" : ""}" style="--farbe:${esc(f.Farbe)}">${kopf}
    ${kartenKopf(v.Art === "Üben" ? `<p class="beispiel">${/Bahn/.test(vtFenster(v)) ? UEBEN_BAHN : UEBEN_TISCH}</p>` : `<div class="titel">${v.Art === "Zeigen" ? '<span aria-hidden="true">🎤</span> ' : ""}${esc(v.Beschreibung || v.Art)}</div>`, "vt-stand", o.stand || 0, x)}
    ${v.Art === "Üben" ? feld("vt-was", o.was || "", "Was übe ich? (Seite, Aufgaben)", x) : ""}${verschieben(v)}</div>`;
}
// Ein Tag: Termine, dann die Stoffverteilung nach Zeitfenstern
function seiteTag(tag, istHeute) {
  const p = paket(), vs = verteilung().filter((v) => vtTag(v) === tag).sort(sortVt);
  const wt = (iso) => TAGE[(datum(iso).getDay() + 6) % 7];
  let h = "";
  const termine = (p.Termine || []).filter((t) => t.Datum && wt(t.Datum) === tag && t.Datum >= p.Woche.StartDatum && t.Datum <= p.Woche.EndDatum);
  if (termine.length) h += `<h2><span aria-hidden="true">📅</span> Termine</h2>` + termine.map((t) => `<div class="karte"><div class="titel">${t.Uhrzeit ? esc(t.Uhrzeit) + " Uhr · " : ""}${esc(t.FachID)}${t.PersonName ? " mit " + esc(t.PersonName) : ""}</div><div class="meta">${t.Ort ? esc(t.Ort) + " · " : ""}${esc(t.Art || "")}${t.Status ? " · " + esc(t.Status) : ""}</div></div>`).join("");
  // Der ganze Tag in zeitlicher Reihenfolge: jede Schulstunde laut Stundenplan, dazu Bahn und Termine.
  // Stunden ohne Stoff stehen klein da (teilnehmen, Pause, Weg, frei), damit Emil sieht, was dazwischen ist.
  const plaetze = new Map();
  const platz = (fenster) => { if (!plaetze.has(fenster)) plaetze.set(fenster, { fenster, start: fenster.slice(0, 5), stunde: null, eintraege: [] }); return plaetze.get(fenster); };
  if (vs.length) for (const s of (p.Stundenplan || []).filter((x) => x.Wochentag === tag && x.Reihenfolge >= 2 && x.ZeitBis)) platz(s.ZeitVon + "-" + s.ZeitBis).stunde = s;
  for (const v of vs) platz(vtFenster(v)).eintraege.push(v);
  for (const pl of [...plaetze.values()].sort((a, b) => a.start.localeCompare(b.start))) {
    if (pl.eintraege.length) { h += `<h2><span aria-hidden="true">${ortZeichen(pl.fenster)}</span> ${esc(fensterText(tag, pl.fenster))}</h2>` + pl.eintraege.map(vtKarte).join(""); continue; }
    const s = pl.stunde, bem = (s && s.Bemerkung) || "";
    const was = /^Pause/i.test(s.Inhalt) ? "Pause" : /^Weg /i.test(bem) ? "Weg zwischen Schule und Bahnhof" : s.Teilnahme === "P" ? "Pflicht, teilnehmen" : /wichtig/i.test(bem) ? "dir wichtig, teilnehmen" : s.FachID ? "Selbstlernen, nichts eingeplant" : "frei";
    h += `<div class="stunde ${was === "frei" ? "" : "dabei"}"><span class="zeit">${esc(pl.fenster.replace("-", "–"))}</span><span><strong>${esc(s.Inhalt)}</strong> · ${esc(was)}</span></div>`;
  }
  if (!vs.length) h += `<p class="leise">${istHeute ? "Für heute" : "Für diesen Tag"} ist nichts eingeplant.</p>`;
  // eigene Übungen, die Emil selbst auf diesen Tag gelegt hat
  let eigene = "";
  for (const f of p.Faecher) eFach(f.Fach).ueben.forEach((u, i) => { if (u.tag === tag) eigene += uebenKarte(f, u, i, true); });
  if (eigene) h += `<h2>Meine Übungen</h2>` + eigene;
  return h;
}
function seiteHeute() {
  const p = paket();
  if (!p) return ohnePaket();
  const tag = heuteTag(), heute = heuteIso();
  let h = "";
  const inWoche = heute >= p.Woche.StartDatum && heute <= p.Woche.EndDatum;
  if (!inWoche) h += `<div class="hinweis">Geladen ist ${esc(p.Woche.WocheID)} (${kurzDatum(p.Woche.StartDatum)} bis ${kurzDatum(p.Woche.EndDatum)}). Heute liegt nicht in dieser Woche.</div>`;
  if (p.Plan.PruefungAb) {
    const tage = Math.ceil((datum(p.Plan.PruefungAb) - new Date()) / 86400000);
    if (tage >= 0) h += `<p class="leise">Noch ${tage} Tage bis zur ersten Prüfung.</p>`;
  }
  if (verteilung().length) {
    h += seiteTag(tag, true);
    const ohne = p.Faecher.reduce((n, f) => n + pflicht(f).filter((a) => a.Phase !== 1 && a.Phase !== 4 && !eMat(a.MaterialID).weg && eMat(a.MaterialID).stand !== 4 && !verteilung().some((v) => v.MaterialID === a.MaterialID)).length, 0);
    if (ohne) h += `<div class="hinweis">${ohne} Pflichtaufgaben haben keine Zeit in der Stoffverteilung. <button class="link" data-a="seite" data-w="woche">Zur Woche</button></div>`;
    return h;
  }
  const termine = p.Termine.filter((t) => t.Datum === heute);
  if (termine.length) h += `<h2>Termine heute</h2>` + termine.map((t) => `<div class="karte"><div class="titel">${esc(t.Art)}: ${esc(t.FachID)}${t.PersonName ? " mit " + esc(t.PersonName) : ""}</div><div class="meta">${esc(t.Zeitraum)}${t.Status ? " · " + esc(t.Status) : ""}</div></div>`).join("");

  let geplant = "", offen = 0;
  for (const f of p.Faecher) {
    for (const a of pflicht(f)) {
      const m = eMat(a.MaterialID);
      if (m.weg) continue;
      if (m.tag === tag) geplant += aufgabeKarte(f, a, true);
      else if (!m.tag && m.stand !== 4) offen++;
    }
    eFach(f.Fach).ueben.forEach((u, i) => { if (u.tag === tag) geplant += uebenKarte(f, u, i, true); });
  }
  h += `<h2>Heute (${tag})</h2>` + (geplant || `<p class="leise">Für heute ist nichts eingeplant.</p>`);
  if (offen) h += `<div class="hinweis">${offen} Pflichtaufgaben haben noch keinen Tag. <button class="link" data-a="seite" data-w="woche">Zur Woche</button></div>`;
  return h;
}

function seiteWoche() {
  const p = paket();
  if (!p) return ohnePaket();
  const wochen = Object.keys(Z.pakete).sort((a, b) => Z.pakete[a].Woche.Reihenfolge - Z.pakete[b].Woche.Reihenfolge);
  let h = `<div class="weiter">${wochen.length > 1 ? auswahl("woche", wochen.map((w) => [w, w + " · ab " + kurzDatum(Z.pakete[w].Woche.StartDatum)]), Z.woche, "Woche wählen") : `<p class="leise">${esc(p.Woche.Art)}</p>`}</div>`;
  if (verteilung().length) {
    h += `<h2>Nach Tagen</h2><div class="karte"><ul class="liste">` + TAGE.map((t) => {
      const vs = verteilung().filter((v) => vtTag(v) === t), min = vs.reduce((s, v) => s + (v.Minuten || 0), 0);
      const fae = [...new Set(vs.map((v) => v.FachID))].join(", ");
      return vs.length ? `<li><button class="link tagzeile" data-a="tagansicht" data-w="${t}"><strong>${t}</strong> · ${vs.length} Einträge · ${Math.round(min / 6) / 10} Std.<br><span class="leise">${esc(fae)}</span></button></li>` : "";
    }).join("") + `</ul></div><h2>Nach Fächern</h2>`;
  }
  const freiwillig = p.Faecher.filter((f) => f.Optional);
  for (const f of p.Faecher.filter((x) => !x.Optional)) {
    const fs = fortschritt(f), e = eFach(f.Fach), t = f.Termin;
    h += `<div class="karte fach" style="--farbe:${esc(f.Farbe)}">
      <span class="fachname">${esc(f.Fach)}</span>
      <div class="titel">${esc(f.Thema)}</div>
      <div class="meta">Paket: ${esc(f.Paket || "–")}${f.PaketSpaetestensBis ? " · bis " + kurzDatum(f.PaketSpaetestensBis) : ""}</div>
      <div class="balken"><span style="width:${Math.round(fs.anteil * 100)}%"></span></div>
      <p class="leise">Aufnehmen ${fs.fertig} von ${fs.anzahl} fertig · Üben ${e.ueben.length} geplant · Start-Check ${e.einstufung ? esc(e.einstufung) : "offen"}</p>
      <p class="leise">Zeig-Termin: ${zeigTermin(f)}</p>
      <button class="knopf haupt voll" data-a="fach" data-w="${esc(f.Fach)}">Öffnen</button>
    </div>`;
  }
  // Freiwillige Fächer (Physik, Chemie): Thema der Woche sehen, alles darf, nichts muss
  if (freiwillig.length) h += `<h2>Freiwillige Fächer</h2><p class="leise">Du entscheidest, ob und wie viel du machst. Vorschlag: die NaWi-Stunden am Montag.</p>` + freiwillig.map((f) => {
    const fs = fortschritt(f);
    return `<div class="karte fach" style="--farbe:${esc(f.Farbe)}"><span class="fachname">${esc(f.Fach)} · freiwillig</span>
      <div class="titel">${esc(f.Thema)}</div>
      <div class="balken"><span style="width:${Math.round(fs.anteil * 100)}%"></span></div>
      <p class="leise">${fs.fertig} von ${fs.anzahl} Aufgaben fertig</p>
      <button class="knopf voll" data-a="fach" data-w="${esc(f.Fach)}">Ansehen</button></div>`;
  }).join("");
  return h;
}

function uebenKarte(f, u, i, mitFach) {
  const x = `data-fach="${esc(f.Fach)}" data-i="${i}"`;
  return `<div class="karte ${u.stand === 4 ? "fertig" : ""}" style="--farbe:${esc(f.Farbe)}">
    ${mitFach ? `<span class="fachname">${esc(f.Fach)} · Üben</span>` : ""}
    ${feld("u-was", u.was || "", "Was übe ich? (Seite, Aufgaben)", x)}
    <div class="zwei" style="margin-top:8px">${auswahl("u-wie", UEBEN_IDEEN.map((w) => [w, w]), u.wie, "Wie?", x)}${auswahl("u-tag", tagOptionen, u.tag, "Tag", x)}</div>
    <div class="zeile"><span class="leise">Wie weit?</span>${chips("u-stand", STAND, u.stand || 0, x)}<button class="chip" data-a="u-weg" ${x}>entfernen</button></div>
  </div>`;
}

// Zeig-Termin: eingetragener Termin, sonst der Vorschlag aus der Stoffverteilung (lila), sonst offen
function zeigTermin(f) {
  const t = f.Termin;
  if (t) return `${kurzDatum(t.Datum)} ${t.Uhrzeit ? esc(t.Uhrzeit) + " Uhr" : esc(t.Zeitraum || "")}${t.PersonName ? " mit " + esc(t.PersonName) : ""}${t.Ort ? ", " + esc(t.Ort) : ""}`;
  const z = verteilung().filter((v) => v.FachID === f.Fach && v.Art === "Zeigen").sort(sortVt)[0];
  if (z) return `<span class="${istVorschlag(z) ? "lila" : ""}">${esc(vtTag(z))} ${esc(fensterText(vtTag(z), vtFenster(z)))} · ${esc(z.Beschreibung || "")}</span>`;
  return "noch offen, am Sonntag festlegen";
}
function seiteFach() {
  const p = paket(), f = p && p.Faecher.find((x) => x.Fach === ansicht.fach);
  if (!f) { ansicht.seite = "woche"; return seiteWoche(); }
  const e = eFach(f.Fach), x = `data-fach="${esc(f.Fach)}"`, t = f.Termin;
  let h = `<button class="link" data-a="seite" data-w="woche">‹ Zur Woche</button>
    <div class="karte fach" style="--farbe:${esc(f.Farbe)}">
      <span class="fachname">${esc(f.Fach)}${f.Optional ? " · freiwillig" : ""}</span><div class="titel">${esc(f.Thema)}</div>
      ${f.Optional ? `<p class="leise">Ein freiwilliges Fach: Du entscheidest, ob und wie viel du machst.</p>` : ""}
      <p><strong>Ziel:</strong> ${esc(f.Lernziel)}</p>
      <p class="leise">Paket: ${esc(f.Paket || "–")}${f.PaketErsteWoche ? ` (${esc(f.PaketErsteWoche)}${f.PaketLetzteWoche !== f.PaketErsteWoche ? " bis " + esc(f.PaketLetzteWoche) : ""})` : ""}${f.PaketSpaetestensBis ? " · spätestens bis " + kurzDatum(f.PaketSpaetestensBis) : ""}</p>
      <p><strong>Zeig-Termin:</strong> ${zeigTermin(f)}</p>
    </div>`;

  h += `<h3>1 · Stand prüfen</h3>` + vorschlaege(f, "Start-Check").map((v) => `<p>${esc(v.Vorschlagstext)}</p>`).join("") +
    `<div class="karte"><p class="leise">Erst schätzen, dann testen.</p>
      <div class="drei"><label>Vorhersage${feld("vorhersage", e.vorhersage ?? "", "", x, "number")}</label><label>Ergebnis${feld("ergebnis", e.ergebnis ?? "", "", x, "number")}</label><label>von (höchstens)${feld("max", e.max ?? "", "", x, "number")}</label></div>
      <div class="zeile">${chips("einstufung", [["neu", "neu"], ["teilweise", "teilweise"], ["sicher", "sicher"]], e.einstufung, x)}</div>
      ${e.einstufung === "sicher" ? `<p class="leise">Sicher heißt: Der Test hat es gezeigt, nicht das Gefühl. Dann darfst du unten Aufgaben weglassen.</p>` : ""}</div>`;

  h += `<h3>2 · Aufnehmen – das musst du diese Woche lernen</h3>` + (pflicht(f).map((a) => aufgabeKarte(f, a, false)).join("") || `<p class="leise">Im Plan steht hier nichts.</p>`);

  h += `<h3>3 · Üben – das legst du am Wochenanfang selbst fest</h3>
    <p class="leise">Geh die Seiten von oben durch: Was willst du üben, mit welchen Aufgaben auf welcher Seite, wie und wann?${f.UebungsMin ? ` Du hast dafür ${f.UebungsMin} Min. freie Übungszeit.` : ""}</p>` +
    verteilung().filter((v) => v.FachID === f.Fach && v.Art === "Üben").sort(sortVt).map(vtKarte).join("") +
    e.ueben.map((u, i) => uebenKarte(f, u, i, false)).join("") + `<button class="knopf voll" data-a="u-neu" ${x}>+ Übung festlegen</button>`;

  const ideen = vorschlaege(f, "Zeigen");
  h += `<h3>4 · Zeigen</h3><div class="karte">` + ideen.map((v, i) => `<label class="radio"><input type="radio" name="zeig" data-a="zeig" data-w="${i}" ${x} ${String(e.zeig) === String(i) ? "checked" : ""}><span>${esc(v.Vorschlagstext)}${v.Zeigform ? ` <span class="leise">(${esc(v.Zeigform)})</span>` : ""}</span></label>`).join("") +
    `<label class="radio"><input type="radio" name="zeig" data-a="zeig" data-w="eigen" ${x} ${e.zeig === "eigen" ? "checked" : ""}><span>Eigene Idee</span></label>
     ${e.zeig === "eigen" ? feld("zeigEigen", e.zeigEigen || "", "Meine Idee", x) : ""}
     <div class="zeile"><span class="leise">Größe</span>${chips("groesse", [["klein", "klein"], ["mittel", "mittel"], ["groß", "groß"]], e.groesse, x)}</div>
     <label>Dafür lasse ich weg${feld("lasseWeg", e.lasseWeg || "", "zum Beispiel eine Übung", x)}</label>
     <label>Dafür nehme ich dazu${feld("nehmeDazu", e.nehmeDazu || "", "zum Beispiel ein Video", x)}</label></div>`;

  const frei = freiwillig(f), songs = f.Songs.filter((s) => s.Empfohlen);
  if (frei.length || songs.length) {
    h += `<h3>Freiwillig</h3><div class="karte"><ul class="liste">` +
      frei.map((a) => `<li><input type="checkbox" data-a="frei" data-id="${a.MaterialID}" ${x} ${e.frei[a.MaterialID] ? "checked" : ""} aria-label="erledigt"><span>${a.URL ? `<a href="${esc(a.URL)}" target="_blank" rel="noopener">${esc(a.Titel)}</a>` : esc(a.Titel)}<br><span class="meta">${esc([kurzQuelle(a.Quelle), a.Fundstelle, a.Minuten ? a.Minuten + " Min." : ""].filter(Boolean).join(" · "))}</span></span></li>`).join("") +
      songs.map((s) => `<li><span aria-hidden="true">♪</span><span><a href="https://www.youtube.com/results?search_query=${encodeURIComponent(s.Titel + " " + s.Interpret)}" target="_blank" rel="noopener">${esc(s.Titel)}</a> – ${esc(s.Interpret)}</span></li>`).join("") + `</ul></div>`;
  }
  h += `<h3>Notiz zum Fach</h3>${text("notiz", e.notiz || "", "Fragen, Schwieriges, Ideen", x)}`;
  return h;
}

// gewählte Ursachen als Liste (frühere Version speicherte nur eine)
const ursachen = (r) => (Array.isArray(r.ursache) ? r.ursache : r.ursache ? [r.ursache] : []);
function seiteSonntag() {
  const p = paket();
  if (!p) return ohnePaket();
  const r = eintraege().retro;
  return `<p class="leise">${p.Plan.Zielsatz ? "Mein Zielsatz: " + esc(p.Plan.Zielsatz) : "Dein Zielsatz steht noch nicht in der Datenbank."}</p>
    <h3>Vor der Woche</h3>
    <label>Mein größtes Hindernis diese Woche${feld("r-hindernis", r.hindernis || "", "", "")}</label>
    <label>Wenn …${feld("r-wenn", r.wenn || "", "wenn ich zum Handy greife", "")}</label>
    <label>dann …${feld("r-dann", r.dann || "", "dann lege ich es in den Flur", "")}</label>
    <h3>Nach der Woche: Retro</h3>
    <label>Was lief gut?${text("r-gut", r.gut || "", "", "")}</label>
    <label>Was lief nicht gut, und woran lag es?${text("r-nichtgut", r.nichtgut || "", "", "")}</label>
    <div class="zeile"><span class="leise">Ursache (mehrere möglich)</span><div class="chips" role="group">${URSACHEN.map((u) => `<button class="chip" data-a="r-ursache" data-w="${u}" aria-pressed="${ursachen(r).includes(u)}">${u}</button>`).join("")}</div></div>
    ${ursachen(r).includes("Sonstiges") ? `<label>Sonstiges, und zwar${feld("r-ursacheText", r.ursacheText || "", "", "")}</label>` : ""}
    <label>Das probiere ich nächste Woche aus (nur eine Sache)${feld("r-experiment", r.experiment || "", "", "")}</label>
    <label>Rückmeldung an meine Begleiter (beibehalten, ändern)${text("r-feedback", r.feedback || "", "", "")}</label>
    <h3>Abschicken</h3>
    <p class="leise">Die Rückmeldung enthält alles, was du in dieser Woche eingetragen hast. Sie wird am PC in die Datenbank eingelesen.</p>
    <button class="knopf haupt voll" data-a="rueckmeldung">Rückmeldung für ${esc(p.Woche.WocheID)} speichern oder teilen</button>`;
}

function seiteMehr() {
  const wochen = Object.keys(Z.pakete).sort();
  const thema = Z.theme || "system";
  return `<h3>Wochenpakete</h3>
    <p class="leise">Ein Wochenpaket ist die Datei aus der Datenbank (Schulplaner_Wochenpaket_….json).</p>
    <button class="knopf haupt voll" data-a="laden">Wochenpaket laden</button>
    ${wochen.length ? `<ul class="liste">` + wochen.map((w) => `<li><span style="flex:1">${esc(w)} · ${esc(Z.pakete[w].Plan.Lernende)} · ab ${kurzDatum(Z.pakete[w].Woche.StartDatum)}</span><button class="chip" data-a="paket-weg" data-w="${esc(w)}">entfernen</button></li>`).join("") + `</ul>` : `<p class="leise">Noch keines geladen.</p>`}
    <h3>Darstellung</h3>${chips("theme", [["system", "wie das Gerät"], ["light", "hell"], ["dark", "dunkel"]], thema)}
    <h3>So liest du den Plan</h3>
    <p class="leise">Fest sind nur Ziel und Zeig-Termin. Den Weg dahin wählst du. Grün wird ein Thema erst nach einem Test, nicht nach Gefühl.</p>
    <p class="leise">Zeiträume: ${Object.values(ZEITEN).join(", ")}.</p>
    <h3>Die Symbole</h3>
    <ul class="liste symbole">
      <li>${torte(0, 26)}${torte(2, 26)}${torte(4, 26)}<span><strong>Wie weit?</strong> Leer, ¼, ½, ¾ oder voll. Voll heißt fertig. Antippen zum Ändern.</span></li>
      <li>${sitztZeichen("", 26)}${sitztZeichen("sitzt", 26)}<span><strong>Wie sitzt es?</strong> Sanduhr: noch nicht eingeschätzt. Haken: sitzt.</span></li>
      <li>${sitztZeichen("unsicher", 26)}${sitztZeichen("nicht verstanden", 26)}<span>Gelb: unsicher. Rot: nicht verstanden. Dann frag nach.</span></li>
      <li>${ikon("welt", 26)}${ikon("film", 26)}<span><strong>Öffnen:</strong> Webseite, Video, Hören, PDF oder Online-Übung.</span></li>
      <li>${ikon("notiz", 26)}<span><strong>Notiz</strong> zu dieser Aufgabe. Ein Punkt zeigt, dass schon eine da ist.</span></li>
      <li>${ikon("birne", 26)}<span><strong>Lerntechnik:</strong> wie du diese Aufgabe gut lernen kannst.</span></li>
      <li>${ikon("mond", 26)}<span>Oben rechts: hell oder dunkel.</span></li>
    </ul>
    <h3>Daten</h3>
    <p class="leise">Alles liegt nur auf diesem Gerät. Sichere es, bevor du den Browser leerst.</p>
    <div class="zeile"><button class="knopf" data-a="sichern">Alles sichern</button><button class="knopf" data-a="laden">Sicherung einlesen</button></div>
    <p class="leise">Schulplaner App ${APP_VERSION}</p>`;
}

const ohnePaket = () => `<div class="karte"><div class="titel">Noch kein Wochenpaket</div><p>Lade die Datei für deine Woche. Du bekommst sie am Sonntag aus der Datenbank.</p><button class="knopf haupt voll" data-a="laden">Wochenpaket laden</button></div>`;

// ---------------------------------------------------------------- Zeichnen
const istDunkel = () => Z.theme === "dark" || (Z.theme !== "light" && !!window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
const seiteTagAnsicht = () => (paket() ? `<button class="link" data-a="seite" data-w="woche">‹ Zur Woche</button>` + seiteTag(ansicht.tag, ansicht.tag === heuteTag()) : ohnePaket());
const SEITEN = { heute: ["Heute", seiteHeute], woche: ["Woche", seiteWoche], sonntag: ["Sonntag", seiteSonntag], mehr: ["Mehr", seiteMehr], fach: ["Fach", seiteFach], tag: ["Tag", seiteTagAnsicht] };
function zeichnen(obenBleiben) {
  const y = window.scrollY, p = paket();
  document.documentElement.dataset.theme = Z.theme && Z.theme !== "system" ? Z.theme : "";
  if (!document.documentElement.dataset.theme) delete document.documentElement.dataset.theme;
  document.getElementById("kopf").innerHTML = `<button class="thema" data-a="theme-wechsel" aria-label="${istDunkel() ? "Hell" : "Dunkel"} darstellen">${ikon(istDunkel() ? "sonne" : "mond", 22)}</button><h1>${ansicht.seite === "fach" ? esc(ansicht.fach) : ansicht.seite === "tag" ? esc(tagDatum(ansicht.tag)) : SEITEN[ansicht.seite][0]}</h1><p>${p ? `${esc(p.Plan.Lernende)} · ${esc(p.Woche.WocheID)} · ${kurzDatum(p.Woche.StartDatum)} bis ${kurzDatum(p.Woche.EndDatum)}${p.Umgebung !== "Produktion" ? " · " + esc(p.Umgebung.toUpperCase()) : ""}` : "Schulplaner"}</p>`;
  document.getElementById("inhalt").innerHTML = SEITEN[ansicht.seite][1]();
  document.getElementById("nav").innerHTML = ["heute", "woche", "sonntag", "mehr"].map((s) => `<button data-a="seite" data-w="${s}" ${ansicht.seite === s || (s === "woche" && (ansicht.seite === "fach" || ansicht.seite === "tag")) ? 'aria-current="page"' : ""}>${SEITEN[s][0]}</button>`).join("");
  window.scrollTo(0, obenBleiben ? y : 0);
}

// ---------------------------------------------------------------- Eingaben
function handle(el, wert) {
  const a = el.dataset.a, d = el.dataset;
  const zahl = (v) => (v === "" ? null : Number(v));
  let neu = true;                                       // neu zeichnen?
  switch (a) {
    case "seite": ansicht = { seite: wert, fach: null }; zeichnen(false); return;
    case "fach": ansicht = { seite: "fach", fach: wert }; zeichnen(false); return;
    case "tagansicht": ansicht = { seite: "tag", fach: null, tag: wert }; zeichnen(false); return;
    case "vt-tag": eVt(d.id).tag = wert || null; break;
    case "vt-fenster": eVt(d.id).fenster = wert || null; break;
    case "vt-zurueck": delete eVt(d.id).tag; delete eVt(d.id).fenster; break;
    case "vt-stand": eVt(d.id).stand = Number(wert); ansicht.leiste = null; break;
    case "auf": ansicht.leiste = ansicht.leiste === wert ? null : wert; zeichnen(true); return;
    case "notiz-auf": ansicht.notiz = ansicht.notiz === Number(wert) ? null : Number(wert); zeichnen(true); return;
    case "tipp-auf": ansicht.tipp = ansicht.tipp === Number(wert) ? null : Number(wert); zeichnen(true); return;
    case "sitzt": eMat(d.id).sitzt = wert || null; ansicht.leiste = null; break;
    case "m-notiz": eMat(d.id).notiz = wert; neu = false; break;
    case "theme-wechsel": Z.theme = istDunkel() ? "light" : "dark"; break;
    case "vt-was": eVt(d.id).was = wert; neu = false; break;
    case "woche": if (wert) Z.woche = wert; break;
    case "stand": eMat(d.id).stand = Number(wert); ansicht.leiste = null; break;
    case "tag": eMat(d.id).tag = wert || null; break;
    case "zeit": eMat(d.id).zeit = wert || null; break;
    case "weg": eMat(d.id).weg = !eMat(d.id).weg; break;
    case "frei": eFach(d.fach).frei[d.id] = el.checked; neu = false; break;
    case "vorhersage": case "ergebnis": case "max": eFach(d.fach)[a] = zahl(wert); neu = false; break;
    case "einstufung": case "groesse": eFach(d.fach)[a] = eFach(d.fach)[a] === wert ? null : wert; break;
    case "zeig": eFach(d.fach).zeig = wert; break;
    case "zeigEigen": case "lasseWeg": case "nehmeDazu": case "notiz": eFach(d.fach)[a] = wert; neu = false; break;
    case "u-neu": eFach(d.fach).ueben.push({ was: "", wie: "", tag: "", stand: 0 }); break;
    case "u-weg": eFach(d.fach).ueben.splice(Number(d.i), 1); break;
    case "u-was": eFach(d.fach).ueben[d.i].was = wert; neu = false; break;
    case "u-wie": eFach(d.fach).ueben[d.i].wie = wert; neu = false; break;
    case "u-tag": eFach(d.fach).ueben[d.i].tag = wert; break;
    case "u-stand": eFach(d.fach).ueben[d.i].stand = Number(wert); break;
    case "r-ursache": { const r = eintraege().retro, l = ursachen(r); r.ursache = l.includes(wert) ? l.filter((u) => u !== wert) : [...l, wert]; break; }
    case "theme": Z.theme = wert; break;
    case "laden": document.getElementById("datei").click(); return;
    case "paket-weg": if (confirm(`Wochenpaket ${wert} und deine Eintragungen dazu von diesem Gerät entfernen?`)) { delete Z.pakete[wert]; delete Z.e[wert]; if (Z.woche === wert) Z.woche = Object.keys(Z.pakete).sort()[0] || null; } break;
    case "rueckmeldung": abgeben(`Schulplaner_Rueckmeldung_${Z.woche}.json`, rueckmeldung()); return;
    case "sichern": abgeben(`Schulplaner_Sicherung_${heuteIso()}.json`, { Art: "Sicherung", Stand: Z }); return;
    default:
      if (a && a.startsWith("r-")) { eintraege().retro[a.slice(2)] = wert; neu = false; } else return;
  }
  speichern();
  if (neu) zeichnen(true);
}
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("button[data-a]");
  if (el) handle(el, el.dataset.w);
});
document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.id === "datei") { dateienLesen(el.files); el.value = ""; return; }
  if (el.dataset && el.dataset.a && el.tagName !== "BUTTON") handle(el, el.type === "radio" ? el.dataset.w : el.value);
});

// ---------------------------------------------------------------- Dateien
function paketAufnehmen(obj) {
  if (obj && obj.Art === "Sicherung" && obj.Stand) { Z = Object.assign(laden(), obj.Stand); return "Sicherung eingelesen."; }
  if (!obj || !obj.Woche || !obj.Faecher || !obj.Plan) throw new Error("Das ist kein Wochenpaket.");
  const w = obj.Woche.WocheID;
  Z.pakete[w] = obj; Z.woche = w;
  return `Wochenpaket ${w} geladen.`;
}
async function dateienLesen(dateien) {
  const meldungen = [];
  for (const d of dateien) {
    try { meldungen.push(paketAufnehmen(JSON.parse((await d.text()).replace(/^﻿/, "")))); } catch (e) { meldungen.push(`${d.name}: ${e.message}`); }
  }
  speichern(); ansicht = { seite: "woche", fach: null }; zeichnen(false);
  if (meldungen.length) alert(meldungen.join("\n"));
}
function rueckmeldung() {
  const p = paket(), e = eintraege();
  return {
    Art: "Rueckmeldung", AppVersion: APP_VERSION, Erstellt: new Date().toISOString(), PlanID: p.Plan.PlanID, Lernende: p.Plan.Lernende, Woche: p.Woche.WocheID,
    Material: p.Faecher.flatMap((f) => f.Aufgaben.map((a) => ({ a, m: e.mat[a.MaterialID], frei: (e.fach[f.Fach] || {}).frei })).filter((x) => (x.m && (x.m.stand || x.m.tag || x.m.weg || x.m.sitzt || x.m.notiz)) || (x.frei && x.frei[x.a.MaterialID])).map((x) => ({
      MaterialID: x.a.MaterialID, FortschrittProzent: x.frei && x.frei[x.a.MaterialID] ? 100 : ((x.m && x.m.stand) || 0) * 25, Tag: (x.m && x.m.tag) || null, Zeitraum: (x.m && ZEITEN[x.m.zeit]) || null, Entscheidung: x.m && x.m.weg ? "gestrichen" : "bleibt",
      Einschaetzung: (x.m && x.m.sitzt) || null, Notiz: (x.m && x.m.notiz) || null }))),
    Faecher: p.Faecher.map((f) => {
      const x = e.fach[f.Fach] || { ueben: [] }, ideen = vorschlaege(f, "Zeigen");
      return { Fach: f.Fach, Paket: f.Paket, Vorhersage: x.vorhersage ?? null, Ergebnis: x.ergebnis ?? null, Maximal: x.max ?? null, StartCheck: x.einstufung || null,
        ZeigIdee: x.zeig === "eigen" ? x.zeigEigen || "eigene Idee" : (ideen[x.zeig] ? ideen[x.zeig].Vorschlagstext : null), Zeigform: x.zeig !== "eigen" && ideen[x.zeig] ? ideen[x.zeig].Zeigform : null,
        Groesse: x.groesse || null, LasseWeg: x.lasseWeg || null, NehmeDazu: x.nehmeDazu || null, Notiz: x.notiz || null,
        Ueben: (x.ueben || []).map((u) => ({ Was: u.was, Wie: u.wie, Tag: u.tag, FortschrittProzent: (u.stand || 0) * 25 })) };
    }),
    // Ursachen als Text, zum Beispiel "Methode, Fokus, Sonstiges: zu müde"
    Retro: { ...e.retro, ursache: ursachen(e.retro).map((u) => (u === "Sonstiges" && e.retro.ursacheText ? "Sonstiges: " + e.retro.ursacheText : u)).join(", ") || null },
    // Stoffverteilung: verschobene Zeilen und Fortschritt bei Üben und Zeigen
    Verteilung: verteilung().filter((v) => { const o = e.vt[v.VerteilungID]; return o && (o.tag || o.fenster || o.stand || o.was); }).map((v) => {
      const o = e.vt[v.VerteilungID];
      return { VerteilungID: v.VerteilungID, Wochentag: vtTag(v), Zeitfenster: vtFenster(v), Verschoben: !istVorschlag(v) && !!(o.tag || o.fenster), FortschrittProzent: (o.stand || 0) * 25, Was: o.was || null };
    }),
  };
}
async function abgeben(name, obj) {
  const inhalt = JSON.stringify(obj, null, 1), datei = new File([inhalt], name, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [datei] })) {
    try { await navigator.share({ files: [datei], title: name }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(datei); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

// ---------------------------------------------------------------- Start
window.schulplaner = { paketAufnehmen, rueckmeldung, zustand: () => Z, neuZeichnen: () => { speichern(); zeichnen(false); } };
if (!paket() && Object.keys(Z.pakete).length) Z.woche = Object.keys(Z.pakete).sort()[0];
if (!paket()) ansicht.seite = "mehr";
zeichnen(false);
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
