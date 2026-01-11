/*
  M5 Tutorial World (separate page)
  Goals (per latest UX spec):
  - No focus-cue overlays here (Options handles the only required focus cues).
  - Clear step order:
      1) show the whole world
      2) what you can do / how to use
      3) highlight (Spotlight) explanation + experience (both buttons just dismiss)
      4) leveling / XP explanation
      5) choose: end now or continue freeplay
  - Character is the narrator: speech-bubble + standing avatar (PetEngine canvas).
*/

const $ = (id) => document.getElementById(id);

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function setText(el, text){ if (el) el.textContent = String(text ?? ""); }

function normalizeCharId(id){
  if (id === "likoris") return "likoris";
  // legacy
  if (id === "forone") return "follone";
  return "follone";
}

function charName(charId){
  return charId === "likoris" ? "りこりす" : "ふぉろね";
}

async function sendSW(msg){
  try { return await chrome.runtime.sendMessage(msg); }
  catch (e) { return { ok:false, error:String(e) }; }
}



async function startAiPrepare({ poll=true } = {}) {
  // Best-effort: start AI setup to trigger model download / session creation.
  const chip = $("hudAI");
  const set = (v) => { if (chip) chip.textContent = String(v); };
  set("PREP");
  let started = null;
  try { started = await sendSW({ type: "FOLLONE_AI_SETUP_START" }); } catch (_e) { started = null; }
  if (started && started.ok && started.status === "ready") {
    set("READY");
    return { ok:true, status:"ready" };
  }
  if (!poll) return { ok:false, status:"starting" };

  // Poll status for up to ~90s (non-blocking for tutorial; we don't hard-fail).
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    await sleep(1200);
    const st = await sendSW({ type: "FOLLONE_AI_SETUP_STATUS" });
    if (st && st.ok) {
      if (st.status === "ready") { set("READY"); return { ok:true, status:"ready" }; }
      if (st.status === "unavailable") { set("OFF"); return { ok:false, status:"unavailable" }; }
      // progress
      const p = Number(st.progress || 0);
      if (Number.isFinite(p) && p > 0) set(`...${Math.round(p)}%`);
      else set("...");
    } else {
      set("...");
    }
  }
  set("...");
  return { ok:false, status:"timeout" };
}

async function getProgress(){
  const r = await sendSW({ type: "FOLLONE_GET_PROGRESS" });
  if (r && r.ok) return r;
  // fallback (tutorial should still run)
  return { ok:false, xp:0, level:1, equippedHead:"" };
}

async function addXp(amount){
  const r = await sendSW({ type: "FOLLONE_ADD_XP", amount: Number(amount)||0 });
  return (r && r.ok) ? r : null;
}

async function markOnboardingDone(){
  try { await chrome.storage.local.set({ follone_onboarding_done: true, follone_onboarding_phase: "done", follone_onboarding_state: "completed" }); }
  catch(_e) {}
}

async function loadGuideAvatar(charId){
  const canvas = $("guidePet");
  if (!canvas) return;

  canvas.style.imageRendering = "pixelated";
  canvas.width = 64;
  canvas.height = 64;

  try {
    if (!window.PetEngine) return;
    const eng = new window.PetEngine({ canvas });

    const base = "pet/data";
    const charURL = chrome.runtime.getURL(`${base}/characters/${charId}.json`);
    const accURL = chrome.runtime.getURL(`${base}/accessories/accessories.json`);

    const [resChar, resAcc] = await Promise.all([
      fetch(charURL, { cache: "no-store" }),
      fetch(accURL, { cache: "no-store" })
    ]);
    if (!resChar.ok) return;

    const char = await resChar.json();
    const accessories = resAcc.ok ? await resAcc.json() : null;

    const prog = await getProgress();
    const head = prog?.equippedHead ? String(prog.equippedHead) : null;

    eng.renderPet({
      char,
      accessories,
      eyesVariant: "normal",
      mouthVariant: "idle",
      equip: { head, fx: null }
    });
  } catch (_e) {
    // non-blocking
  }
}

async function say(lines, { clear=true, lineDelay=230 } = {}){
  const box = $("guideText");
  if (!box) return;
  if (clear) box.innerHTML = "";

  for (const line of lines) {
    const div = document.createElement("div");
    div.className = "tLine";
    div.textContent = line;
    box.appendChild(div);
    await sleep(lineDelay);
  }
}

function setActions(buttons){
  const wrap = $("guideActions");
  if (!wrap) return;
  wrap.innerHTML = "";
  buttons.forEach(b => wrap.appendChild(b));
}

function mkBtn(label, { kind="normal" } = {}){
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (kind === "ghost") b.classList.add("tGhost");
  return b;
}

async function showSpotlightOnce({ allowXp=true } = {}){
  const veil = $("spotVeil");
  const btnBack = $("spotBack");
  const btnSearch = $("spotSearch");
  if (!veil || !btnBack || !btnSearch) return { choice:"none", gained:0 };

  // show
  veil.classList.add("on");
  await sleep(60);
  btnBack.classList.add("tPulse");
  btnSearch.classList.add("tPulse");

  const choice = await new Promise((resolve) => {
    btnBack.addEventListener("click", () => resolve("back"), { once:true });
    btnSearch.addEventListener("click", () => resolve("search"), { once:true });
  });

  btnBack.classList.remove("tPulse");
  btnSearch.classList.remove("tPulse");

  // hide
  veil.classList.add("out");
  await sleep(220);
  veil.classList.remove("on");
  veil.classList.remove("out");

  let gained = 0;
  if (allowXp) {
    gained = 10;
    const r = await addXp(gained);
    if (r && r.ok) {
      setText($("hudLv"), r.level);
      setText($("hudXp"), r.xp);
      setText($("hudGain"), gained);
      const chip = $("hudGain");
      if (chip) {
        chip.classList.add("xp-pop");
        setTimeout(() => chip.classList.remove("xp-pop"), 450);
      }
    } else {
      // fallback display only
      const p = await getProgress();
      setText($("hudLv"), p.level || 1);
      setText($("hudXp"), p.xp || 0);
      setText($("hudGain"), gained);
    }
  }

  return { choice, gained };
}

async function enterFreeplay(){
  const postHot = $("postHot");
  const post0 = document.querySelector('[data-post="0"]');
  const post2 = document.querySelector('[data-post="2"]');

  const clickHint = async () => {
    await say([
      "OK。ここからは自由に試せるよ。",
      "投稿をクリックするとSpotlightを出せる（練習用）。",
      "どちらのボタンでもSpotlightは閉じるよ。",
    ]);
    setActions([mkBtn("Xへ戻る")]);
    $("guideActions")?.firstChild?.addEventListener("click", async () => {
      await markOnboardingDone();
      try { window.close(); } catch(_e) {}
    }, { once:true });
  };

  await clickHint();

  const handler = async () => {
    await showSpotlightOnce({ allowXp:true });
    // after each, keep the hint minimal (don’t overwrite too aggressively)
  };

  // make posts clickable
  [post0, postHot, post2].forEach((p) => {
    if (!p) return;
    p.classList.add("isTarget");
    p.style.cursor = "pointer";
    p.addEventListener("click", handler);
  });
}

async function main(){
  // Tutorial spec (Phase11): navigator style, no character branching.
  // - Chapter 1: Overlay panel explanation
  // - Chapter 2: danger post demo (Spotlight)
  // - Chapter 3: recovery / troubleshooting

  // Keep avatar optional, but narration is always "ナビ"
  setText($("guideChar"), "ナビ");

  // Initial HUD
  const p = await getProgress();
  setText($("hudLv"), p.level || 1);
  setText($("hudXp"), p.xp || 0);
  setText($("hudGain"), 0);

  // Start AI setup (model download / warm session) in background
  startAiPrepare({ poll:true }).catch(() => {});

  // Render guide avatar (best-effort: selected character)
  let charId = "follone";
  try {
    const cur = await chrome.storage.local.get(["follone_characterId"]);
    charId = normalizeCharId(cur.follone_characterId);
  } catch (_e) {}
  loadGuideAvatar(charId);

  const chapters = [
    { id:1, title:"Overlayの見方", hint:"状態とゲージの読み方" },
    { id:2, title:"危険投稿のデモ", hint:"Spotlightを体験" },
    { id:3, title:"困った時の復旧", hint:"止まった時の手順" },
  ];

  const visited = new Set();
  let current = 1;

  const setProgress = (ch) => {
    const idx = chapters.findIndex(c => c.id === ch);
    const label = $("progLabel");
    const hint = $("progHint");
    const fill = $("progFill");
    const bar = document.querySelector(".tProgBar");
    if (label) label.textContent = `CHAPTER ${idx+1}/${chapters.length}`;
    if (hint) hint.textContent = chapters[idx]?.hint || "";
    const pct = ((idx+1) / chapters.length) * 100;
    if (fill) fill.style.width = `${pct}%`;
    if (bar) bar.setAttribute("aria-valuenow", String(idx+1));

    // Nav buttons
    chapters.forEach(c => {
      const n = $("nav" + c.id);
      if (!n) return;
      n.classList.toggle("isActive", c.id === ch);
      n.classList.toggle("isDone", visited.has(c.id) && c.id !== ch);
    });
  };

  const goto = async (ch) => {
    current = ch;
    setProgress(ch);
    visited.add(ch);

    // Clear target highlights
    $("postHot")?.classList.remove("isTarget");

    if (ch === 1) {
      document.getElementById("overlayDemo")?.scrollIntoView({ behavior:"smooth", block:"start" });
      setActions([mkBtn("次へ")]);
      await say([
        "まずはOverlayの見方だよ。",
        "上の“状態”は、今のタイムラインがどんな雰囲気かを表す。",
        "下の3本ゲージは Focus / Variety / Explore。",
        "Varietyが低いと、同じ話題が続いてるサイン。",
        "ここで“気づける”だけでも十分なんだ。",
      ]);
      await new Promise(r => $("guideActions")?.firstChild?.addEventListener("click", r, { once:true }));
      return await goto(2);
    }

    if (ch === 2) {
      const btn = mkBtn("Spotlightを体験する");
      setActions([btn, mkBtn("戻る", { kind:"ghost" })]);
      const ghost = $("guideActions")?.lastChild;
      ghost?.addEventListener("click", () => goto(1), { once:true });

      $("postHot")?.classList.add("isTarget");
      $("postHot")?.scrollIntoView({ behavior:"smooth", block:"center" });
      await sleep(180);
      await say([
        "次は“危険投稿”のデモ。",
        "感情が強くなりそうな投稿ではSpotlightを出して、選択肢を作る。",
        "“戻る”=距離を取る / “検索する”=別の視点を見る。",
        "どっちでもOK。ここでは練習だから、押したら閉じるだけ。",
      ]);

      await new Promise(r => btn.addEventListener("click", r, { once:true }));
      const { choice } = await showSpotlightOnce({ allowXp:true });
      await say([
        choice === "search" ? "視点を増やす選択、すごく良い。" : "距離を取る選択、すごく良い。",
        "この“落ち着いた選択”がXPになる。",
      ]);

      setActions([mkBtn("次へ")]);
      await new Promise(r => $("guideActions")?.firstChild?.addEventListener("click", r, { once:true }));
      return await goto(3);
    }

    // Chapter 3: recovery
    setActions([mkBtn("Optionsを開く", { kind:"ghost" }), mkBtn("終了（Xへ戻る)" )]);
    const bOpen = $("guideActions")?.firstChild;
    const bEnd = $("guideActions")?.lastChild;

    bOpen?.addEventListener("click", async () => {
      try { await chrome.runtime.openOptionsPage(); } catch (_e) {}
    });
    bEnd?.addEventListener("click", async () => {
      await markOnboardingDone();
      try { window.close(); } catch(_e) {}
    }, { once:true });

    await say([
      "最後に、困った時の復旧手順。",
      "① まずはAIチップを見る（PREP/READY/OFF）。",
      "② READYなのに動かない時は、Settingsで“Reset backend”を実行。",
      "③ それでもダメならページをリロード。",
      "（ログはLogsページからコピーして報告できるよ）",
    ]);

    // Optional freeplay after reading
    const btnMore = mkBtn("練習を続ける");
    setActions([btnMore, mkBtn("終了（Xへ戻る)")]);
    const btnEnd2 = $("guideActions")?.lastChild;
    btnEnd2?.addEventListener("click", async () => {
      await markOnboardingDone();
      try { window.close(); } catch(_e) {}
    }, { once:true });

    await new Promise(r => btnMore.addEventListener("click", r, { once:true }));
    await enterFreeplay();
  };

  // Wire nav
  chapters.forEach(c => {
    const n = $("nav" + c.id);
    n?.addEventListener("click", () => goto(c.id));
  });

  setProgress(1);
  await goto(1);
}

main().catch((e) => {
  console.error(e);
  try { setText($("guideText"), "チュートリアルでエラーが起きました。Optionsから再実行してください。" ); } catch(_e) {}
});
