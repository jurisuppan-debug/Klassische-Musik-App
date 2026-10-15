"use strict";

const app = document.getElementById("app");
const byId = Object.fromEntries(COMPOSERS.map(c => [c.id, c]));
const periodById = Object.fromEntries(PERIODS.map(p => [p.id, p]));
const piecesOf = id => PIECES.filter(p => p.composer === id);
const periodOfPiece = p => byId[p.composer].period;

const esc = s => String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const initials = name => name.split(" ").filter(w => /^[A-ZÄÖÜ]/.test(w)).map(w => w[0]).slice(0, 2).join("");

// Kleiner Speicher, der auch im privaten Modus nicht abstürzt.
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } },
};

/* ---------- Wikipedia ---------- */

const WIKI_API = "https://de.wikipedia.org/w/api.php";
const wikiUrl = title => "https://de.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));

// Porträts aller Komponisten laden (höchstens 50 pro Anfrage) und eine Woche merken.
// Kommen neue Komponisten dazu, wird der Zwischenspeicher neu aufgebaut.
let portraits = (() => {
  const cached = store.get("portraits");
  const fresh = cached && Date.now() - cached.time < 7 * 864e5 && cached.count === COMPOSERS.length;
  return fresh ? cached.data : null;
})();
let portraitsPromise = null;
function loadPortraits() {
  if (portraits) return Promise.resolve(portraits);
  if (portraitsPromise) return portraitsPromise;
  const titles = COMPOSERS.map(c => c.wiki);
  const chunks = [];
  for (let i = 0; i < titles.length; i += 50) chunks.push(titles.slice(i, i + 50));
  const data = {};
  portraitsPromise = Promise.all(chunks.map(chunk => {
    const params = new URLSearchParams({
      action: "query", format: "json", origin: "*", redirects: "1",
      prop: "pageimages", pithumbsize: "500", pilimit: "50", titles: chunk.join("|"),
    });
    return fetch(`${WIKI_API}?${params}`).then(r => r.json()).then(json => {
      for (const page of Object.values(json.query.pages)) {
        if (page.thumbnail) data[page.title] = page.thumbnail.source;
      }
    });
  }))
    .then(() => {
      portraits = data;
      store.set("portraits", { time: Date.now(), count: COMPOSERS.length, data });
      return data;
    })
    .catch(() => data);
  return portraitsPromise;
}

// Eigenes Bild (c.image) hat Vorrang vor dem Wikipedia-Porträt.
function portraitHtml(c) {
  const src = c.image ? c.image.src : portraits && portraits[c.wiki];
  const alt = c.image ? c.image.alt : `Porträt von ${c.name}`;
  return `<div class="portrait" data-portrait="${c.id}">${
    src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">`
        : `<span class="initials">${esc(initials(c.name))}</span>`}</div>`;
}

// Nach dem Laden der Porträts die Platzhalter auf der Seite ersetzen.
function fillPortraits() {
  loadPortraits().then(() => {
    document.querySelectorAll("[data-portrait]").forEach(el => {
      const c = byId[el.dataset.portrait];
      if (c && !el.querySelector("img")) el.outerHTML = portraitHtml(c);
    });
  });
}

const bioCache = {};
function loadBio(c) {
  if (bioCache[c.id]) return Promise.resolve(bioCache[c.id]);
  const params = new URLSearchParams({
    action: "query", format: "json", origin: "*", redirects: "1",
    prop: "extracts", exintro: "1", explaintext: "1", titles: c.wiki,
  });
  return fetch(`${WIKI_API}?${params}`)
    .then(r => r.json())
    .then(json => {
      const page = Object.values(json.query.pages)[0];
      const text = (page.extract || "")
        .replace(/\s*\[[^\]]*\]\s*/g, " ")   // Lautschrift wie [ˈbax] entfernen
        .replace(/(\S)(jul|greg)\./g, "$1")   // Kalender-Hinweise wie „Märzjul.“ entfernen
        .replace(/ {2,}/g, " ");
      bioCache[c.id] = text.split("\n").map(s => s.trim()).filter(Boolean);
      return bioCache[c.id];
    });
}

/* ---------- Audio ---------- */

const audio = new Audio();
audio.preload = "auto";
let audioStopTimer = null;
let currentTrackBtn = null;

function stopAudio() {
  audio.pause();
  clearTimeout(audioStopTimer);
  if (currentTrackBtn) { currentTrackBtn.textContent = "▶"; currentTrackBtn = null; }
}

// Ganze Aufnahme im Lexikon abspielen bzw. pausieren.
function toggleTrack(btn, piece) {
  if (currentTrackBtn === btn) { stopAudio(); return; }
  stopAudio();
  audio.src = piece.src;
  audio.currentTime = 0;
  audio.play().catch(() => {});
  btn.textContent = "❚❚";
  currentTrackBtn = btn;
}
audio.addEventListener("ended", () => { if (currentTrackBtn) stopAudio(); });

function creditHtml(p) {
  const who = p.artist ? esc(p.artist) + " · " : "";
  return `<span class="credit">Aufnahme: ${who}<a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.license || "Lizenz")}</a></span>`;
}

/* ---------- Eingabe mit Vorschlägen ---------- */

// Für Vergleiche: Kleinbuchstaben, ohne Akzente und Satzzeichen; „ä“ und „ae“ gelten als gleich.
const norm = s => String(s).toLowerCase()
  .replace(/ß/g, "ss").replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u")
  .replace(/[^a-z0-9]+/g, " ").trim();

// Passende Vorschläge: jedes getippte Wort muss den Anfang eines Wortes im Vorschlag bilden.
// Treffer ganz am Anfang kommen zuerst („vier“ findet „Die vier Jahreszeiten“, aber nicht „Klavierkonzert“).
function suggest(options, query, max = 8, extra = {}) {
  const q = norm(query);
  if (!q) return [];
  const qWords = q.split(" ");
  const ranked = [];
  for (const o of options) {
    const n = norm(o + " " + (extra[o] || ""));
    const words = n.split(" ");
    if (qWords.every(qw => words.some(w => w.startsWith(qw)))) ranked.push([n.startsWith(q) ? 0 : 1, o]);
  }
  return ranked.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1], "de")).slice(0, max).map(r => r[1]);
}

// Hängt eine Vorschlagsliste an ein Textfeld (Pfeiltasten, Enter und Tippen werden unterstützt).
// „extra“ ordnet einem Vorschlag weitere Suchbegriffe zu (z. B. andere Schreibweisen).
function attachAutocomplete(input, options, extra = {}) {
  const list = document.createElement("ul");
  list.className = "ac-list";
  list.hidden = true;
  input.parentElement.appendChild(list);
  input.setAttribute("autocomplete", "off");
  let items = [];
  let active = -1;

  const draw = () => {
    items = suggest(options, input.value, 8, extra);
    active = -1;
    list.innerHTML = items.map((o, i) => `<li data-i="${i}">${esc(o)}</li>`).join("");
    list.hidden = !items.length || (items.length === 1 && norm(items[0]) === norm(input.value));
  };
  const highlight = () => list.querySelectorAll("li").forEach((li, i) => li.classList.toggle("active", i === active));
  const choose = i => { input.value = items[i]; list.hidden = true; };

  input.addEventListener("input", draw);
  input.addEventListener("keydown", e => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { active = (active + 1) % items.length; highlight(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = (active - 1 + items.length) % items.length; highlight(); e.preventDefault(); }
    else if (e.key === "Enter" && active >= 0) { choose(active); e.preventDefault(); }
    else if (e.key === "Escape") list.hidden = true;
  });
  list.addEventListener("pointerdown", e => {
    const li = e.target.closest("li");
    if (li) { e.preventDefault(); choose(Number(li.dataset.i)); }
  });
  input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 120));
}

// Erkennt einen Komponisten am vollen Namen, am Nachnamen oder an gängigen anderen Schreibweisen.
const COMPOSER_ALIASES = {
  haendel: ["Handel"], tschaikowsky: ["Tschaikowsky", "Tchaikovsky"], rachmaninow: ["Rachmaninoff", "Rachmaninov"],
  mussorgsky: ["Mussorgsky"], mendelssohn: ["Mendelssohn"],
  skrjabin: ["Scriabin", "Skriabin"], prokofjew: ["Prokofiev", "Prokofieff"], strawinsky: ["Stravinsky"],
  rimski: ["Rimsky-Korsakov", "Rimski"], falla: ["de Falla"], saintsaens: ["Saint-Saens"],
  strauss: ["Johann Strauss", "Strauss Sohn"],
};
const surname = c => c.name.replace(/\s*\(.*\)/, "").split(" ").pop();
// Nachnamen, die mehrere Komponisten tragen (z. B. Strauss), reichen allein nicht als Antwort.
const SHARED_SURNAMES = new Set(COMPOSERS.map(surname).filter((s, i, all) => all.indexOf(s) !== i));
const composerAnswers = c => [c.name, c.wiki, ...(SHARED_SURNAMES.has(surname(c)) ? [] : [surname(c)]),
  ...(COMPOSER_ALIASES[c.id] || [])].map(norm);
function findComposer(text) {
  const n = norm(text);
  return n ? COMPOSERS.find(c => composerAnswers(c).includes(n)) || null : null;
}
const COMPOSER_NAMES = COMPOSERS.map(c => c.name);
const COMPOSER_EXTRA = Object.fromEntries(COMPOSERS.map(c => [c.name, (COMPOSER_ALIASES[c.id] || []).join(" ")]));
const PIECE_TITLES = [...new Set(PIECES.map(p => p.title))];
const PERIOD_NAMES = PERIODS.map(p => p.name);

// Ein Titel gilt auch ohne den Zusatz in Klammern, z. B. „Halleluja“ für „Halleluja (Messias)“.
function titleMatches(text, title) {
  const n = norm(text);
  return !!n && (n === norm(title) || n === norm(title.replace(/\s*\([^)]*\)/g, "")));
}

/* ---------- Seiten ---------- */

function renderHome() {
  app.innerHTML = `
    <section class="hero">
      <p class="eyebrow">Von Bach bis Gershwin</p>
      <h1>Klassische Musik entdecken</h1>
      <p>Lerne ${COMPOSERS.length} große Komponisten kennen und teste dein Gehör mit ${PIECES.length} berühmten Werken.</p>
    </section>
    <div class="feature-grid">
      <a class="card feature" href="#/komponisten">
        <div class="icon">📜</div>
        <h2>Komponisten</h2>
        <p>Leben, Werke und Porträts – sortiert nach Epochen.</p>
      </a>
      <a class="card feature" href="#/quiz">
        <div class="icon">🎧</div>
        <h2>Hör-Quiz</h2>
        <p>Hör einen Ausschnitt und rate, welches Stück es ist. Mit Hardcore-Modus zum freien Eintippen.</p>
      </a>
      <a class="card feature" href="#/wer-bin-ich">
        <div class="icon">🕵️</div>
        <h2>Wer bin ich?</h2>
        <p>Errate Komponisten anhand von Hinweisen – je weniger du brauchst, desto mehr Punkte.</p>
      </a>
    </div>
    <div class="periods">
      ${PERIODS.map(p => `
        <a class="card period" style="--c: var(--p-${p.id}); text-decoration:none; color:inherit" href="#/komponisten?epoche=${p.id}">
          <h3>${p.name}</h3>
          <div class="muted" style="font-size:.85rem">${p.years}</div>
          <p>${p.text}</p>
        </a>`).join("")}
    </div>`;
}

function renderComposers(query) {
  const state = { period: query.get("epoche") || "alle", search: "" };
  app.innerHTML = `
    <h1>Komponisten</h1>
    <div class="toolbar">
      <input type="search" id="search" placeholder="Name suchen …" aria-label="Komponisten suchen">
      <div class="chips" id="period-chips">
        ${[{ id: "alle", name: "Alle" }, ...PERIODS].map(p =>
          `<button class="chip" data-period="${p.id}" aria-pressed="${p.id === state.period}">${p.name}</button>`).join("")}
      </div>
    </div>
    <div id="period-text" class="muted" style="margin:-8px 0 18px"></div>
    <div class="grid" id="grid"></div>`;

  const grid = document.getElementById("grid");
  const draw = () => {
    const s = state.search.toLowerCase();
    const list = COMPOSERS
      .filter(c => state.period === "alle" || c.period === state.period)
      .filter(c => !s || c.name.toLowerCase().includes(s))
      .sort((a, b) => a.born - b.born);
    const p = periodById[state.period];
    document.getElementById("period-text").textContent = p ? `${p.years} – ${p.text}` : "";
    grid.innerHTML = list.length ? list.map(c => `
      <a class="card composer-card" href="#/komponist/${c.id}">
        ${portraitHtml(c)}
        <div class="body">
          <h3>${esc(c.name)}</h3>
          <div class="years">${c.born}–${c.died} · <span class="badge ${c.period}">${periodById[c.period].name}</span></div>
        </div>
      </a>`).join("") : `<div class="empty">Kein Komponist gefunden.</div>`;
    fillPortraits();
  };

  document.getElementById("search").addEventListener("input", e => { state.search = e.target.value; draw(); });
  document.getElementById("period-chips").addEventListener("click", e => {
    const b = e.target.closest("[data-period]");
    if (!b) return;
    state.period = b.dataset.period;
    document.querySelectorAll("#period-chips .chip").forEach(x => x.setAttribute("aria-pressed", x === b));
    draw();
  });
  draw();
}

function renderComposer(id) {
  const c = byId[id];
  if (!c) { app.innerHTML = `<p>Komponist nicht gefunden. <a href="#/komponisten">Zur Übersicht</a></p>`; return; }
  const tracks = piecesOf(c.id);
  app.innerHTML = `
    <a class="back" href="#/komponisten">← Alle Komponisten</a>
    <article class="detail">
      <figure class="detail-figure">
        ${portraitHtml(c)}
        ${c.image ? `<figcaption class="credit">${esc(c.image.note)}<br>
          Bild: <a href="${esc(c.image.page)}" target="_blank" rel="noopener">${esc(c.image.credit)}</a></figcaption>` : ""}
      </figure>
      <div>
        <h1>${esc(c.name)}</h1>
        <div class="facts">
          <span>${c.born}–${c.died}</span><span>${esc(c.country)}</span>
          <span class="badge ${c.period}">${periodById[c.period].name}</span>
        </div>
        <p class="lead">${esc(c.short)}</p>
        <div class="bio loading" id="bio">Biografie wird geladen …</div>
        <p><a href="${wikiUrl(c.wiki)}" target="_blank" rel="noopener">Weiterlesen auf Wikipedia →</a></p>

        <div class="section">
          <h2>Wichtige Werke</h2>
          <ul class="works">${c.works.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
        </div>

        ${tracks.length ? `
        <div class="section">
          <h2>Reinhören</h2>
          <div class="card">
            ${tracks.map(p => `
              <div class="track">
                <button class="play-sm" data-play="${p.id}" aria-label="${esc(p.title)} abspielen">▶</button>
                <div class="title">${esc(p.title)}<br>${creditHtml(p)}</div>
              </div>`).join("")}
          </div>
          <p style="margin-top:14px"><a class="btn" href="#/quiz?komponist=${c.id}">🎧 Quiz mit ${esc(c.name.split(" ").pop())}</a></p>
        </div>` : ""}
      </div>
    </article>`;

  fillPortraits();
  app.querySelectorAll("[data-play]").forEach(btn =>
    btn.addEventListener("click", () => toggleTrack(btn, PIECES.find(p => p.id === btn.dataset.play))));

  loadBio(c).then(paras => {
    const el = document.getElementById("bio");
    if (!el) return;
    el.classList.remove("loading");
    el.innerHTML = paras.length ? paras.map(p => `<p>${esc(p)}</p>`).join("") : "";
  }).catch(() => {
    const el = document.getElementById("bio");
    if (el) el.textContent = "Die Biografie konnte nicht geladen werden (keine Internetverbindung?).";
  });
}

/* ---------- Quiz ---------- */

const SNIPPET_SECONDS = 20;
let quizSettings = { period: "alle", composer: "alle", difficulty: "leicht", rounds: 10, mode: "auswahl", ...store.get("quizSettings") };
const HARDCORE_POINTS = { period: 1, composer: 2, piece: 3 };   // max. 6 Punkte pro Frage
const pointsPerQuestion = s => s.mode === "hardcore" ? HARDCORE_POINTS.period + HARDCORE_POINTS.composer + HARDCORE_POINTS.piece : 1;

function quizPool(s) {
  return PIECES.filter(p =>
    (s.composer !== "alle" ? p.composer === s.composer : (s.period === "alle" || periodOfPiece(p) === s.period)));
}

function renderQuizSetup(query) {
  if (query.get("komponist") && byId[query.get("komponist")]) {
    const c = byId[query.get("komponist")];
    quizSettings = { ...quizSettings, composer: c.id, period: c.period };
  }
  const s = quizSettings;
  app.innerHTML = `
    <h1>Hör-Quiz</h1>
    <p class="muted" style="max-width:640px">Du hörst einen kurzen Ausschnitt und errätst, welches Stück es ist.</p>
    <div class="card quiz-setup">
      <div class="field">
        <span class="label">Modus</span>
        <div class="chips" id="q-mode">
          <button class="chip" data-v="auswahl" aria-pressed="${s.mode === "auswahl"}">Auswahl – 4 Antworten</button>
          <button class="chip" data-v="hardcore" aria-pressed="${s.mode === "hardcore"}">Hardcore – selbst eintippen</button>
        </div>
        <p class="pool-info" id="q-mode-info" style="margin:8px 0 0"></p>
      </div>
      <div class="field">
        <span class="label">Epoche</span>
        <div class="chips" id="q-period">
          ${[{ id: "alle", name: "Alle" }, ...PERIODS].map(p =>
            `<button class="chip" data-v="${p.id}" aria-pressed="${p.id === s.period}">${p.name}</button>`).join("")}
        </div>
      </div>
      <div class="field">
        <label for="q-composer">Komponist</label>
        <select id="q-composer"></select>
      </div>
      <div class="field">
        <span class="label">Schwierigkeit</span>
        <div class="chips" id="q-diff">
          <button class="chip" data-v="leicht" aria-pressed="${s.difficulty === "leicht"}">Leicht – vom Anfang</button>
          <button class="chip" data-v="schwer" aria-pressed="${s.difficulty === "schwer"}">Schwer – zufällige Stelle</button>
        </div>
      </div>
      <div class="field">
        <span class="label">Runden</span>
        <div class="chips" id="q-rounds">
          ${[5, 10, 15].map(n => `<button class="chip" data-v="${n}" aria-pressed="${n === s.rounds}">${n}</button>`).join("")}
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap">
        <button class="btn primary" id="q-start">Quiz starten</button>
        <span class="pool-info" id="q-info"></span>
      </div>
    </div>`;

  const select = document.getElementById("q-composer");
  const update = () => {
    const options = COMPOSERS
      .filter(c => piecesOf(c.id).length && (s.period === "alle" || c.period === s.period))
      .sort((a, b) => a.born - b.born);
    if (s.composer !== "alle" && !options.some(c => c.id === s.composer)) s.composer = "alle";
    select.innerHTML = `<option value="alle">Alle Komponisten</option>` +
      options.map(c => `<option value="${c.id}" ${c.id === s.composer ? "selected" : ""}>${esc(c.name)} (${piecesOf(c.id).length})</option>`).join("");
    const n = quizPool(s).length;
    document.getElementById("q-info").textContent =
      `${n} Stück${n === 1 ? "" : "e"} in der Auswahl` + (n < s.rounds ? ` – das Quiz hat daher ${n} Runden` : "");
    document.getElementById("q-start").disabled = n === 0;
    document.getElementById("q-mode-info").textContent = s.mode === "hardcore"
      ? `Du tippst Epoche (${HARDCORE_POINTS.period} Punkt), Komponist (${HARDCORE_POINTS.composer} Punkte) und Stück (${HARDCORE_POINTS.piece} Punkte) ein – beim Tippen erscheinen Vorschläge.`
      : "Ein Punkt pro richtiger Antwort.";
  };
  const chipGroup = (elId, key, cast = v => v) => {
    document.getElementById(elId).addEventListener("click", e => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      s[key] = cast(b.dataset.v);
      b.parentElement.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", x === b));
      if (key === "period") s.composer = "alle";
      update();
    });
  };
  chipGroup("q-mode", "mode");
  chipGroup("q-period", "period");
  chipGroup("q-diff", "difficulty");
  chipGroup("q-rounds", "rounds", Number);
  select.addEventListener("change", () => { s.composer = select.value; update(); });
  document.getElementById("q-start").addEventListener("click", () => {
    store.set("quizSettings", s);
    startQuiz(s);
  });
  update();
}

// Drei falsche Antworten wählen: bevorzugt aus der Auswahl, dann aus derselben Epoche, dann beliebig.
function distractors(correct, pool) {
  const used = new Set([correct.id]);
  const pick = [];
  const period = periodOfPiece(correct);
  for (const group of [pool, PIECES.filter(p => periodOfPiece(p) === period), PIECES]) {
    for (const p of shuffle(group)) {
      if (pick.length === 3) return pick;
      if (!used.has(p.id)) { used.add(p.id); pick.push(p); }
    }
  }
  return pick;
}

function startQuiz(settings) {
  const pool = quizPool(settings);
  const questions = shuffle(pool).slice(0, settings.rounds).map(piece => ({
    piece,
    options: shuffle([piece, ...distractors(piece, pool)]),
    answer: null,
    points: 0,
  }));
  const game = { settings, questions, index: 0, score: 0 };
  renderQuestion(game);
}

function renderQuestion(game) {
  stopAudio();
  const q = game.questions[game.index];
  const total = game.questions.length;
  app.innerHTML = `
    <div class="quiz">
      <div class="quiz-head">
        <span>Frage ${game.index + 1} von ${total}</span>
        <span>Punkte: <strong>${game.score}</strong></span>
      </div>
      <div class="progress"><div style="width:${(game.index / total) * 100}%"></div></div>
      <div class="card stage">
        <button class="big-play" id="play" aria-label="Ausschnitt abspielen">▶</button>
        <div class="snippet-bar"><div id="snip"></div></div>
        <div class="status" id="status">Tippe auf ▶, um den Ausschnitt zu hören.</div>
      </div>
      ${game.settings.mode === "hardcore" ? `
      <form class="card hardcore" id="hc-form">
        <div class="hc-field" data-field="period"><label for="hc-period">Epoche</label>
          <div class="ac"><input id="hc-period" placeholder="z. B. Barock"></div><div class="hc-result"></div></div>
        <div class="hc-field" data-field="composer"><label for="hc-composer">Komponist</label>
          <div class="ac"><input id="hc-composer" placeholder="z. B. Mozart"></div><div class="hc-result"></div></div>
        <div class="hc-field" data-field="piece"><label for="hc-piece">Stück</label>
          <div class="ac"><input id="hc-piece" placeholder="Titel eingeben …"></div><div class="hc-result"></div></div>
        <button class="btn primary" type="submit">Antworten</button>
      </form>` : `
      <div class="answers" id="answers">
        ${q.options.map(p => `
          <button class="answer" data-id="${p.id}">
            <span>${esc(p.title)}</span><small>${esc(byId[p.composer].name)}</small>
          </button>`).join("")}
      </div>`}
      <div id="after"></div>
      <p style="margin-top:22px"><button class="btn" id="quit">Quiz beenden</button></p>
    </div>`;

  document.getElementById("quit").addEventListener("click", () => { stopAudio(); renderQuizSetup(new URLSearchParams()); });
  const playBtn = document.getElementById("play");
  const statusEl = document.getElementById("status");
  const snip = document.getElementById("snip");
  let start = null;      // Startpunkt des Ausschnitts in Sekunden
  let raf = null;
  let playing = false;

  const tick = () => {
    const pct = Math.min(1, (audio.currentTime - start) / SNIPPET_SECONDS);
    snip.style.width = (pct * 100) + "%";
    if (pct >= 1) { pause(); statusEl.textContent = "Nochmal hören? Tippe auf ▶."; return; }
    raf = requestAnimationFrame(tick);
  };
  const pause = () => {
    audio.pause(); playing = false; cancelAnimationFrame(raf); playBtn.textContent = "▶";
  };
  const playFrom = () => {
    audio.currentTime = start;
    audio.play().then(() => {
      playing = true; playBtn.textContent = "❚❚"; statusEl.textContent = "Hör genau hin …";
      cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
    }).catch(() => { statusEl.textContent = "Die Aufnahme konnte nicht abgespielt werden."; });
  };

  playBtn.addEventListener("click", () => {
    if (playing) { pause(); return; }
    if (start !== null) { playFrom(); return; }
    statusEl.textContent = "Lädt …";
    audio.src = q.piece.src;
    audio.addEventListener("loadedmetadata", function onMeta() {
      audio.removeEventListener("loadedmetadata", onMeta);
      const d = audio.duration || 0;
      start = 0;
      if (game.settings.difficulty === "schwer" && d > SNIPPET_SECONDS * 2) {
        start = Math.floor(d * 0.15 + Math.random() * (d * 0.7 - SNIPPET_SECONDS));
      }
      playFrom();
    });
    audio.load();
  });

  // Nach der Antwort: Punkte verbuchen und Auflösung zeigen.
  const reveal = verdictHtml => {
    game.score += q.points;
    const c = byId[q.piece.composer];
    const last = game.index === total - 1;
    document.querySelector(".quiz-head strong").textContent = game.score;
    document.getElementById("after").innerHTML = `
      <div class="card reveal">
        ${portraitHtml(c)}
        <div>
          ${verdictHtml}
          <div><strong>${esc(q.piece.title)}</strong> – <a href="#/komponist/${c.id}">${esc(c.name)}</a>
            (${c.born}–${c.died}, ${periodById[c.period].name})</div>
          ${creditHtml(q.piece)}
        </div>
      </div>
      <div class="next-row"><button class="btn primary" id="next">${last ? "Ergebnis ansehen" : "Nächste Frage →"}</button></div>`;
    fillPortraits();
    document.getElementById("next").addEventListener("click", () => {
      pause();
      if (last) renderResult(game);
      else { game.index++; renderQuestion(game); }
    });
    document.getElementById("next").focus();
  };

  if (game.settings.mode !== "hardcore") {
    document.getElementById("answers").addEventListener("click", e => {
      const b = e.target.closest(".answer");
      if (!b || q.answer) return;
      q.answer = b.dataset.id;
      const right = q.answer === q.piece.id;
      q.points = right ? 1 : 0;
      document.querySelectorAll(".answer").forEach(x => {
        x.disabled = true;
        if (x.dataset.id === q.piece.id) x.classList.add("correct");
        else if (x === b) x.classList.add("wrong");
      });
      reveal(`<div class="verdict ${right ? "ok" : "bad"}">${right ? "Richtig!" : "Leider falsch."}</div>`);
    });
    return;
  }

  // Hardcore: drei Eingaben, jede mit Vorschlägen; Punkte gibt es für jeden richtigen Teil.
  const form = document.getElementById("hc-form");
  const fields = {
    period: document.getElementById("hc-period"),
    composer: document.getElementById("hc-composer"),
    piece: document.getElementById("hc-piece"),
  };
  attachAutocomplete(fields.period, PERIOD_NAMES);
  attachAutocomplete(fields.composer, COMPOSER_NAMES, COMPOSER_EXTRA);
  attachAutocomplete(fields.piece, PIECE_TITLES);

  form.addEventListener("submit", e => {
    e.preventDefault();
    if (q.answer) return;
    const c = byId[q.piece.composer];
    const period = periodById[c.period];
    const ok = {
      period: [period.name, period.id].some(v => norm(v) === norm(fields.period.value)),
      composer: findComposer(fields.composer.value) === c,
      piece: titleMatches(fields.piece.value, q.piece.title),
    };
    const solution = { period: period.name, composer: c.name, piece: q.piece.title };
    q.answer = { period: fields.period.value, composer: fields.composer.value, piece: fields.piece.value };
    q.points = Object.keys(ok).reduce((sum, k) => sum + (ok[k] ? HARDCORE_POINTS[k] : 0), 0);

    for (const k of Object.keys(fields)) {
      fields[k].disabled = true;
      const box = form.querySelector(`[data-field="${k}"]`);
      box.classList.add(ok[k] ? "correct" : "wrong");
      box.querySelector(".hc-result").innerHTML = ok[k]
        ? `✓ +${HARDCORE_POINTS[k]}`
        : `✗ richtig: <strong>${esc(solution[k])}</strong>`;
    }
    form.querySelector("button").remove();
    const max = pointsPerQuestion(game.settings);
    const cls = q.points === max ? "ok" : q.points ? "partly" : "bad";
    const text = q.points === max ? "Alles richtig!" : q.points ? "Teilweise richtig." : "Leider falsch.";
    reveal(`<div class="verdict ${cls}">${text} +${q.points} von ${max} Punkten</div>`);
  });
}

function renderResult(game) {
  stopAudio();
  const max = game.questions.length * pointsPerQuestion(game.settings);
  const ratio = game.score / max;
  const praise = ratio === 1 ? "Perfekt – ein echtes Kennerohr! 🎼"
    : ratio >= .7 ? "Sehr gut gehört!"
    : ratio >= .4 ? "Nicht schlecht – da geht noch mehr."
    : "Übung macht den Meister. Stöber doch mal im Lexikon!";
  app.innerHTML = `
    <div class="quiz">
      <div class="card result">
        <p class="eyebrow">Ergebnis</p>
        <div class="score">${game.score} / ${max}</div>
        <p>${praise}</p>
        <div class="card result-list">
          ${game.questions.map(q => {
            const full = q.points === pointsPerQuestion(game.settings);
            const [mark, color] = full ? ["✓", "--ok"] : q.points ? ["◐", "--gold"] : ["✗", "--bad"];
            const pts = game.settings.mode === "hardcore" ? ` · ${q.points} Punkte` : "";
            return `
            <div class="track">
              <span class="mark" style="color:var(${color})">${mark}</span>
              <div class="title">${esc(q.piece.title)}<br><small class="muted">${esc(byId[q.piece.composer].name)}${pts}</small></div>
            </div>`;
          }).join("")}
        </div>
        <div class="row">
          <button class="btn primary" id="again">Nochmal spielen</button>
          <button class="btn" id="settings">Einstellungen ändern</button>
        </div>
      </div>
    </div>`;
  document.getElementById("again").addEventListener("click", () => startQuiz(game.settings));
  document.getElementById("settings").addEventListener("click", () => renderQuizSetup(new URLSearchParams()));
}

/* ---------- Komponisten-Quiz „Wer bin ich?“ ---------- */

const CLUE_POINTS = [10, 8, 6, 4, 2];   // Punkte, je nachdem wie viele Hinweise gebraucht wurden
let whoSettings = store.get("whoSettings") || { period: "alle", rounds: 10 };

const whoPool = s => COMPOSERS.filter(c => CLUES[c.id] && (s.period === "alle" || c.period === s.period));

function renderWhoSetup() {
  const s = whoSettings;
  app.innerHTML = `
    <h1>Wer bin ich?</h1>
    <p class="muted" style="max-width:640px">Du bekommst Hinweise zu einem Komponisten – zuerst vage, dann immer deutlicher.
      Je früher du ihn errätst, desto mehr Punkte gibt es: ${CLUE_POINTS.join(" · ")}.
      Jeder falsche Tipp deckt den nächsten Hinweis auf.</p>
    <div class="card quiz-setup">
      <div class="field">
        <span class="label">Epoche</span>
        <div class="chips" id="w-period">
          ${[{ id: "alle", name: "Alle" }, ...PERIODS].map(p =>
            `<button class="chip" data-v="${p.id}" aria-pressed="${p.id === s.period}">${p.name}</button>`).join("")}
        </div>
      </div>
      <div class="field">
        <span class="label">Runden</span>
        <div class="chips" id="w-rounds">
          ${[5, 10, 15].map(n => `<button class="chip" data-v="${n}" aria-pressed="${n === s.rounds}">${n}</button>`).join("")}
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap">
        <button class="btn primary" id="w-start">Quiz starten</button>
        <span class="pool-info" id="w-info"></span>
      </div>
    </div>`;

  const update = () => {
    const n = whoPool(s).length;
    document.getElementById("w-info").textContent =
      `${n} Komponist${n === 1 ? "" : "en"} in der Auswahl` + (n < s.rounds ? ` – das Quiz hat daher ${n} Runden` : "");
  };
  const chips = (elId, key, cast = v => v) => document.getElementById(elId).addEventListener("click", e => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    s[key] = cast(b.dataset.v);
    b.parentElement.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", x === b));
    update();
  });
  chips("w-period", "period");
  chips("w-rounds", "rounds", Number);
  document.getElementById("w-start").addEventListener("click", () => { store.set("whoSettings", s); startWho(s); });
  update();
}

function startWho(settings) {
  const questions = shuffle(whoPool(settings)).slice(0, settings.rounds)
    .map(composer => ({ composer, shown: 1, wrong: [], points: 0, done: false }));
  renderWhoQuestion({ settings, questions, index: 0, score: 0 });
}

function renderWhoQuestion(game) {
  const q = game.questions[game.index];
  const clues = CLUES[q.composer.id];
  const total = game.questions.length;
  app.innerHTML = `
    <div class="quiz">
      <div class="quiz-head">
        <span>Komponist ${game.index + 1} von ${total}</span>
        <span>Punkte: <strong id="w-score">${game.score}</strong></span>
      </div>
      <div class="progress"><div style="width:${(game.index / total) * 100}%"></div></div>
      <div class="card clue-card">
        <div class="clue-head" id="w-clue-head"></div>
        <ol class="clues" id="w-clues"></ol>
      </div>
      <form class="guess-row" id="w-form">
        <div class="ac"><input id="w-input" placeholder="Name eingeben …" aria-label="Komponist"></div>
        <button class="btn primary" type="submit">Raten</button>
      </form>
      <div class="guess-actions"><button class="btn" id="w-more" type="button"></button></div>
      <div class="status" id="w-feedback"></div>
      <div id="after"></div>
      <p style="margin-top:22px"><button class="btn" id="quit">Quiz beenden</button></p>
    </div>`;

  const input = document.getElementById("w-input");
  const feedback = document.getElementById("w-feedback");
  const moreBtn = document.getElementById("w-more");
  attachAutocomplete(input, COMPOSER_NAMES, COMPOSER_EXTRA);

  const draw = () => {
    document.getElementById("w-clue-head").innerHTML =
      `Hinweis ${q.shown} von ${clues.length} · <strong>${CLUE_POINTS[q.shown - 1]} Punkte</strong> möglich`;
    document.getElementById("w-clues").innerHTML = clues.slice(0, q.shown)
      .map((t, i) => `<li class="${i === q.shown - 1 ? "new" : ""}">${esc(t)}</li>`).join("");
    moreBtn.textContent = q.shown < clues.length ? "Nächster Hinweis" : "Aufgeben";
  };

  const finish = right => {
    q.done = true;
    q.points = right ? CLUE_POINTS[q.shown - 1] : 0;
    game.score += q.points;
    document.getElementById("w-score").textContent = game.score;
    document.getElementById("w-form").remove();
    moreBtn.parentElement.remove();
    feedback.textContent = "";
    const c = q.composer;
    const last = game.index === total - 1;
    document.getElementById("after").innerHTML = `
      <div class="card reveal">
        ${portraitHtml(c)}
        <div>
          <div class="verdict ${right ? "ok" : "bad"}">${right ? `Richtig! +${q.points} Punkte` : "Leider nicht erraten."}</div>
          <div>Gesucht war <a href="#/komponist/${c.id}"><strong>${esc(c.name)}</strong></a>
            (${c.born}–${c.died}, ${periodById[c.period].name}).</div>
          <div class="muted" style="font-size:.9rem">${esc(c.short)}</div>
        </div>
      </div>
      <div class="next-row"><button class="btn primary" id="next">${last ? "Ergebnis ansehen" : "Nächster Komponist →"}</button></div>`;
    fillPortraits();
    document.getElementById("next").addEventListener("click", () => {
      if (last) renderWhoResult(game);
      else { game.index++; renderWhoQuestion(game); }
    });
    document.getElementById("next").focus();
  };

  const nextClue = () => {
    if (q.shown < clues.length) { q.shown++; draw(); } else finish(false);
  };

  document.getElementById("w-form").addEventListener("submit", e => {
    e.preventDefault();
    const guess = findComposer(input.value);
    if (!guess) { feedback.textContent = "Bitte einen Komponisten aus den Vorschlägen wählen."; return; }
    if (guess === q.composer) { finish(true); return; }
    q.wrong.push(guess.name);
    feedback.textContent = `Nein, nicht ${guess.name}.`;
    input.value = "";
    nextClue();
  });
  moreBtn.addEventListener("click", () => { feedback.textContent = ""; nextClue(); });
  document.getElementById("quit").addEventListener("click", renderWhoSetup);
  draw();
}

function renderWhoResult(game) {
  const max = game.questions.length * CLUE_POINTS[0];
  const ratio = game.score / max;
  const praise = ratio >= .85 ? "Großartig – du kennst dich wirklich aus! 🎼"
    : ratio >= .6 ? "Sehr gut!"
    : ratio >= .3 ? "Nicht schlecht – da geht noch mehr."
    : "Übung macht den Meister. Stöber doch mal im Lexikon!";
  app.innerHTML = `
    <div class="quiz">
      <div class="card result">
        <p class="eyebrow">Ergebnis</p>
        <div class="score">${game.score} / ${max}</div>
        <p>${praise}</p>
        <div class="card result-list">
          ${game.questions.map(q => `
            <div class="track">
              <span class="mark" style="color:var(${q.points ? "--ok" : "--bad"})">${q.points ? "✓" : "✗"}</span>
              <div class="title">${esc(q.composer.name)}<br><small class="muted">${q.points
                ? `nach ${q.shown} Hinweis${q.shown === 1 ? "" : "en"} · ${q.points} Punkte` : "nicht erraten"}</small></div>
            </div>`).join("")}
        </div>
        <div class="row">
          <button class="btn primary" id="again">Nochmal spielen</button>
          <button class="btn" id="settings">Einstellungen ändern</button>
        </div>
      </div>
    </div>`;
  document.getElementById("again").addEventListener("click", () => startWho(game.settings));
  document.getElementById("settings").addEventListener("click", renderWhoSetup);
}

/* ---------- Navigation ---------- */

function route() {
  stopAudio();
  const [path, qs] = location.hash.replace(/^#/, "").split("?");
  const query = new URLSearchParams(qs || "");
  const parts = (path || "/").split("/").filter(Boolean);
  document.querySelectorAll("[data-nav]").forEach(a =>
    a.classList.toggle("active", a.dataset.nav === parts[0] || (a.dataset.nav === "komponisten" && parts[0] === "komponist")));

  if (parts[0] === "komponisten") renderComposers(query);
  else if (parts[0] === "komponist") renderComposer(parts[1]);
  else if (parts[0] === "quiz") renderQuizSetup(query);
  else if (parts[0] === "wer-bin-ich") renderWhoSetup();
  else renderHome();
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);

// Service Worker registrieren, damit sich die App auf dem Handy installieren lässt.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
loadPortraits();
route();
