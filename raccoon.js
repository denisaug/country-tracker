"use strict";
/* ============================================================
   raccoon.js — a detailed pixel-art raccoon traveller (walking staff +
   leather backpack with bedroll) that strolls across the bottom of the
   screen now and then. Self-contained: builds its own layer, no deps,
   no images. Include with <script src="raccoon.js"></script>.
   ============================================================ */
(function(){
  if (window.__raccoon) return; window.__raccoon = true;

  const LW = 46, LH = 48, S = 3;            // logical sprite size + pixel scale
  const C = {
    ol:"#15151c",                            // outline / deepest shadow
    fd:"#5c626c", fm:"#838a94", fl:"#a8aeb8", fh:"#c6cbd3",   // fur dark→highlight
    cr:"#f1ede2", crd:"#d6d0c0",             // cream + shade
    mk:"#15151c", no:"#2c2228", noh:"#574247", ew:"#ffffff",  // mask / nose / eye
    Ll:"#b97c41", Lm:"#9c6231", Ld:"#653f1c", Lx:"#41280f",   // leather tones
    mt:"#cda64f", mtd:"#8a6c2c",             // buckle metal
    wl:"#c08a33", wm:"#946322", wd:"#6c4719", wr:"#39291a"    // wood + wrap
  };

  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;left:0;bottom:0;width:100%;height:"+(LH*S)+
    "px;pointer-events:none;z-index:55;overflow:hidden";
  const cv = document.createElement("canvas");
  cv.width = LW*S; cv.height = LH*S;
  cv.style.cssText = "position:absolute;bottom:0;left:0;image-rendering:pixelated;will-change:transform";
  wrap.appendChild(cv);
  const ctx = cv.getContext("2d");

  function px(x,y,w,h,c){ ctx.fillStyle = c; ctx.fillRect(x,y,w,h); }
  function rfill(x,y,w,h,c){ px(x+1,y,w-2,h,c); px(x,y+1,w,h-2,c); }        // rounded fill
  function rO(x,y,w,h,fill){ rfill(x,y,w,h,C.ol); rfill(x+1,y+1,w-2,h-2,fill); } // outlined rounded block

  /* draw one walk frame (0|1), optionally mirrored to face left */
  function draw(frame, faceLeft){
    ctx.setTransform(S,0,0,S,0,0);
    ctx.clearRect(0,0,LW,LH);
    if (faceLeft){ ctx.translate(LW,0); ctx.scale(-1,1); }

    /* tail — ringed, behind the pack (striped strip on the far left) */
    rO(8,34,9,9,C.fm); rO(2,33,9,9,C.fl); rO(0,27,8,9,C.fm); rO(0,21,8,9,C.fl); rO(1,16,7,8,C.fm); rO(2,13,6,6,C.cr);
    px(3,35,5,2,C.fd); px(1,29,5,2,C.fd); px(1,23,5,2,C.fd); px(2,17,4,2,C.fd);

    /* leather backpack on the back (over the tail root) */
    rO(8,18,12,18,C.Lm); px(9,19,2,16,C.Lx);
    rO(7,16,14,7,C.Ll); px(8,21,12,1,C.Ld);
    rO(9,25,9,9,C.Ld); rO(9,24,9,3,C.Lm);                       // lower pocket + lid
    rO(10,19,3,3,C.mt); rO(15,19,3,3,C.mt); rO(12,27,3,3,C.mt); // buckles
    rO(7,12,15,5,C.cr); px(10,13,1,3,C.Lm); px(15,13,1,3,C.Lm); px(7,13,1,3,C.crd); px(20,13,1,3,C.crd); // bedroll

    /* torso */
    rO(13,18,22,22,C.fm); px(15,20,3,17,C.fd); px(31,20,2,15,C.fl);
    rO(21,22,12,15,C.cr); px(21,35,12,2,C.crd);                 // chest / belly

    /* shoulder strap + buckle */
    rO(23,18,4,5,C.Ld); rO(24,22,4,5,C.Ld); rO(25,26,4,5,C.Ld); rO(25,29,4,4,C.mt);

    /* legs (one planted, one lifted per frame), with claw dabs */
    if (!frame){
      rO(16,37,8,10,C.fd); rO(14,44,11,4,C.fd); px(23,45,2,2,C.ol);   // back planted
      rO(26,37,8, 8,C.fm); rO(24,42,11,4,C.fm); px(33,43,2,2,C.ol);   // front lifted
    } else {
      rO(16,37,8, 8,C.fd); rO(14,42,11,4,C.fd); px(23,43,2,2,C.ol);   // back lifted
      rO(26,37,8,10,C.fm); rO(24,44,11,4,C.fm); px(33,45,2,2,C.ol);   // front planted
    }

    /* head + ears */
    rO(15,0,8,7,C.fm); px(17,2,3,3,C.crd); rO(28,0,8,7,C.fm); px(30,2,3,3,C.crd);
    rO(15,4,21,15,C.fm); px(18,7,13,2,C.fl);
    /* bandit mask */
    px(17,10,18,6,C.mk); px(24,8,4,3,C.mk); px(18,9,7,8,C.mk); px(28,9,7,8,C.mk);
    px(25,11,2,4,C.cr); px(17,9,18,1,C.fh);
    /* eyes */
    rO(19,11,6,6,C.ew); px(20,13,3,3,C.ol); px(22,13,1,1,C.ew);
    rO(28,11,6,6,C.ew); px(30,13,3,3,C.ol); px(29,13,1,1,C.ew);
    /* muzzle + nose + mouth */
    rO(29,14,11,9,C.cr); px(30,21,10,1,C.crd);
    rO(37,15,4,4,C.no); px(37,15,1,1,C.noh);
    px(32,20,6,1,C.crd); px(34,21,1,2,C.crd);
    px(16,15,5,4,C.cr);                                         // cheek tuft

    /* walking staff (clear of the face), with knob + leather grip */
    px(42,2,4,45,C.wm); px(42,2,1,45,C.wl); px(45,2,1,45,C.wd); rO(41,1,6,4,C.wd); px(42,27,4,6,C.wr);

    /* front arm + paw gripping the staff (over everything) */
    rO(31,20,8,6,C.fm); rO(37,23,7,6,C.fl); rO(40,26,6,6,C.fh);
    px(41,27,1,4,C.fd); px(43,27,1,4,C.fd);
  }

  let stepTimer = null;
  function cross(){
    const faceLeft = Math.random() < 0.5;
    const spriteW = LW*S, vw = window.innerWidth;
    const fromX = faceLeft ? vw+10 : -spriteW-10;
    const toX   = faceLeft ? -spriteW-10 : vw+10;
    const dur = Math.abs(toX-fromX) / 100 * 1000;   // ~100 px/sec stroll

    let frame = 0; draw(frame, faceLeft);
    stepTimer = setInterval(() => { frame ^= 1; draw(frame, faceLeft); }, 150);

    const anim = cv.animate(
      [{ transform:"translateX("+fromX+"px)" }, { transform:"translateX("+toX+"px)" }],
      { duration: dur, easing:"linear", fill:"forwards" }
    );
    anim.onfinish = () => {
      clearInterval(stepTimer); stepTimer = null;
      ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,cv.width,cv.height);
      schedule(25000 + Math.random()*50000);        // next stroll in 25–75s
    };
  }
  function schedule(delay){ setTimeout(cross, delay); }

  function start(){
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.body.appendChild(wrap);
    schedule(2500 + Math.random()*2500);             // first appearance after a few seconds
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
