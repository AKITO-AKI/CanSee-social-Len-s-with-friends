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
  // Phase12: 5-step tutorial (fast + satisfying)
  const STEPS = [
    { id:1, title:'WELCOME', hint:'準備と全体像' },
    { id:2, title:'Overlay', hint:'見方とチップ' },
    { id:3, title:'Spotlight', hint:'介入UI体験' },
    { id:4, title:'LEVEL', hint:'XPと解放' },
    { id:5, title:'FINISH', hint:'始めよう' },
  ];

  // Decide narrator character (best-effort: selected character)
  let charId = 'follone';
  try {
    const cur = await chrome.storage.local.get(["cansee_selected_character_id","follone_characterId","characterId","selectedCharacterId"]);
    const pick = cur.cansee_selected_character_id || cur.follone_characterId || cur.characterId || cur.selectedCharacterId;
    charId = normalizeCharId(String(pick || 'follone'));
  } catch (_e) {}
  window.__tutorialCharId = charId;
  setText($('guideChar'), charName(charId));
  loadGuideAvatar(charId);

  // Initial HUD
  const p0 = await getProgress();
  setText($('hudLv'), p0.level || 1);
  setText($('hudXp'), p0.xp || 0);
  setText($('hudGain'), 0);

  // Start AI setup in background (do not block steps)
  startAiPrepare({ poll:true }).catch(() => {});

  const visited = new Set();
  let current = 1;

  const setProgress = (step) => {
    const idx = STEPS.findIndex(s => s.id === step);
    const label = $('progLabel');
    const hint = $('progHint');
    const fill = $('progFill');
    const bar = document.querySelector('.tProgBar');

    if (label) label.textContent = `STEP ${idx+1}/${STEPS.length}`;
    if (hint) hint.textContent = STEPS[idx]?.hint || '';
    const pct = ((idx+1) / STEPS.length) * 100;
    if (fill) fill.style.width = `${pct}%`;
    if (bar) bar.setAttribute('aria-valuenow', String(idx+1));

    // Nav buttons
    STEPS.forEach(s => {
      const n = $('nav' + s.id);
      if (!n) return;
      n.classList.toggle('isActive', s.id === step);
      n.classList.toggle('isDone', visited.has(s.id) && s.id !== step);
    });
  };

  const flash = () => {
    const card = $('guideCard');
    if (!card) return;
    card.classList.remove('isFlash');
    void card.offsetWidth;
    card.classList.add('isFlash');
  };

  const goto = async (step) => {
    current = step;
    visited.add(step);
    setProgress(step);
    flash();

    // Clear targets
    $('postHot')?.classList.remove('isTarget');

    // STEP 1: Welcome
    if (step === 1) {
      document.getElementById('overlayDemo')?.scrollIntoView({ behavior:'smooth', block:'start' });
      await say([
        `やあ。${charName(charId)}だよ。`,
        'ここは練習用のTUTORIAL。',
        'まずはAIの準備を始めて、全体像をつかもう。',
        '右の数字(1〜5)で、いつでも戻れるよ。',
      ]);
      const b = mkBtn('次へ');
      setActions([b]);
      await new Promise(r => b.addEventListener('click', r, { once:true }));
      return goto(2);
    }

    // STEP 2: Overlay basics
    if (step === 2) {
      document.getElementById('overlayDemo')?.classList.add('isPop');
      await sleep(120);
      await say([
        'Overlayは「今のタイムラインの偏り」を見るための窓。',
        'Focus: 同じ話題に偏りすぎてない？',
        'Variety: 話題の幅はある？',
        'Explore: 新しい視点を取りに行けてる？',
        '投稿にはチップが出て、queued→processing→done で動くよ。',
      ]);
      const bPrev = mkBtn('戻る', { kind:'ghost' });
      const bNext = mkBtn('次へ');
      setActions([bPrev, bNext]);
      bPrev.addEventListener('click', () => goto(1), { once:true });
      await new Promise(r => bNext.addEventListener('click', r, { once:true }));
      return goto(3);
    }

    // STEP 3: Spotlight demo
    if (step === 3) {
      $('postHot')?.classList.add('isTarget');
      $('postHot')?.scrollIntoView({ behavior:'smooth', block:'center' });
      await sleep(160);
      await say([
        '次はSpotlight。',
        '感情が強くなりそうな投稿で、いったん選択肢を増やす。',
        'どちらを押してもOK。ここでは練習！',
      ]);
      const bDo = mkBtn('Spotlightを体験');
      const bPrev = mkBtn('戻る', { kind:'ghost' });
      setActions([bPrev, bDo]);
      bPrev.addEventListener('click', () => goto(2), { once:true });
      await new Promise(r => bDo.addEventListener('click', r, { once:true }));
      const { choice } = await showSpotlightOnce({ allowXp:true });
      await say([
        choice === 'search' ? '視点を増やす選択、ナイス。' : '距離を取る選択、ナイス。',
        'この「落ち着いた選択」がXPになる。',
      ]);
      const bNext = mkBtn('次へ');
      setActions([bNext]);
      await new Promise(r => bNext.addEventListener('click', r, { once:true }));
      return goto(4);
    }

    // STEP 4: Level / XP
    if (step === 4) {
      const prog = await getProgress();
      setText($('hudLv'), prog.level || 1);
      setText($('hudXp'), prog.xp || 0);
      await say([
        'LV/XPは「良い使い方ができた回数」の目安。',
        'Focusが高すぎると、XPが少し減衰することもあるよ。',
        'GAMEタブで、解放（ティア）を眺められる。',
      ]);
      const bPrev = mkBtn('戻る', { kind:'ghost' });
      const bNext = mkBtn('次へ');
      setActions([bPrev, bNext]);
      bPrev.addEventListener('click', () => goto(3), { once:true });
      await new Promise(r => bNext.addEventListener('click', r, { once:true }));
      return goto(5);
    }

    // STEP 5: Finish
    await say([
      '準備OK。最後に「戻り方」と「困った時」。',
      '① HOME BASE(Options) → PREPARE / WARMUP',
      '② 動かない時 → RESET BACKEND',
      '③ それでもダメならページをリロード',
      'じゃあ、行こう。',
    ]);

    await markOnboardingDone();

    const bHome = mkBtn('HOME BASEへ戻る');
    const bX = mkBtn('Xを開く', { kind:'ghost' });
    setActions([bHome, bX]);

    bHome.addEventListener('click', async () => {
      try { await chrome.runtime.openOptionsPage(); } catch (_e) {}
    }, { once:true });

    bX.addEventListener('click', async () => {
      try {
        const url = 'https://x.com/home';
        await chrome.tabs.create({ url });
      } catch (_e) {}
    }, { once:true });
  };

  // Nav wiring
  STEPS.forEach(s => {
    const n = $('nav' + s.id);
    n?.addEventListener('click', () => goto(s.id));
  });

  setProgress(1);
  await goto(1);
}


main().catch((e) => {
  console.error(e);
  try { setText($("guideText"), "チュートリアルでエラーが起きました。Optionsから再実行してください。" ); } catch(_e) {}
});
