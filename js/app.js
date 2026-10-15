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

// Porträts aller Komponisten mit einer einzigen Anfrage laden (und eine Woche merken).
let portraits = (() => {
  const cached = store.get("portraits");
  return cached && Date.now() - cached.time < 7 * 864e5 ? cached.data : null;
})();
let portraitsPromise = null;
function loadPortraits() {
  if (portraits) return Promise.resolve(portraits);
  if (portraitsPromise) return portraitsPromise;
  const params = new URLSearchParams({
    action: "query", format: "json", origin: "*", redirects: "1",
    prop: "pageimages", pithumbsize: "500", pilimit: "50",
    titles: COMPOSERS.map(c => c.wiki).join("|"),
  });
  portraitsPromise = fetch(`${WIKI_API}?${params}`)
    .then(r => r.json())
    .then(json => {
      const data = {};
      for (const page of Object.values(json.query.pages)) {
        if (page.thumbnail) data[page.title] = page.thumbnail.source;
      }
      portraits = data;
      store.set("portraits", { time: Date.now(), data });
      return data;
    })
    .catch(() => ({}));
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
        <p>Hör einen Ausschnitt und rate, welches Stück es ist. Wähle Epoche und Komponist.</p>
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
          Foto: <a href="${esc(c.image.page)}" target="_blank" rel="noopener">${esc(c.image.credit)}</a></figcaption>` : ""}
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
let quizSettings = store.get("quizSettings") || { period: "alle", composer: "alle", difficulty: "leicht", rounds: 10 };

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
    <p class="muted" style="max-width:640px">Du hörst einen kurzen Ausschnitt und wählst aus vier Möglichkeiten das richtige Stück.</p>
    <div class="card quiz-setup">
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
      <div class="answers" id="answers">
        ${q.options.map(p => `
          <button class="answer" data-id="${p.id}">
            <span>${esc(p.title)}</span><small>${esc(byId[p.composer].name)}</small>
          </button>`).join("")}
      </div>
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

  document.getElementById("answers").addEventListener("click", e => {
    const b = e.target.closest(".answer");
    if (!b || q.answer) return;
    q.answer = b.dataset.id;
    const right = q.answer === q.piece.id;
    if (right) game.score++;
    document.querySelectorAll(".answer").forEach(x => {
      x.disabled = true;
      if (x.dataset.id === q.piece.id) x.classList.add("correct");
      else if (x === b) x.classList.add("wrong");
    });
    const c = byId[q.piece.composer];
    const last = game.index === total - 1;
    document.querySelector(".quiz-head strong").textContent = game.score;
    document.getElementById("after").innerHTML = `
      <div class="card reveal">
        ${portraitHtml(c)}
        <div>
          <div class="verdict ${right ? "ok" : "bad"}">${right ? "Richtig!" : "Leider falsch."}</div>
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
  });
}

function renderResult(game) {
  stopAudio();
  const total = game.questions.length;
  const ratio = game.score / total;
  const praise = ratio === 1 ? "Perfekt – ein echtes Kennerohr! 🎼"
    : ratio >= .7 ? "Sehr gut gehört!"
    : ratio >= .4 ? "Nicht schlecht – da geht noch mehr."
    : "Übung macht den Meister. Stöber doch mal im Lexikon!";
  app.innerHTML = `
    <div class="quiz">
      <div class="card result">
        <p class="eyebrow">Ergebnis</p>
        <div class="score">${game.score} / ${total}</div>
        <p>${praise}</p>
        <div class="card result-list">
          ${game.questions.map(q => `
            <div class="track">
              <span class="mark" style="color:var(${q.answer === q.piece.id ? "--ok" : "--bad"})">${q.answer === q.piece.id ? "✓" : "✗"}</span>
              <div class="title">${esc(q.piece.title)}<br><small class="muted">${esc(byId[q.piece.composer].name)}</small></div>
            </div>`).join("")}
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
  else renderHome();
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);
loadPortraits();
route();
