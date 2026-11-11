// Fussenn download page. Without this script the page still works: both downloads look the same
// and the hero has no line. It sends nothing anywhere.
(() => {
  "use strict";
  const root = document.documentElement;
  root.classList.add("js");

  // Put the download for this computer first. iPadOS reports a Mac, so a touch screen counts as mobile.
  const hints = navigator.userAgentData;
  const platform = (hints && hints.platform) || navigator.platform || "";
  const mobile = hints ? hints.mobile : /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Mac/i.test(platform) && navigator.maxTouchPoints > 1);
  const os = mobile ? "mobile" : /Win/i.test(platform) ? "win" : /Mac/i.test(platform) ? "mac" : "";
  for (const group of document.querySelectorAll("[data-choices]")) {
    const match = os && group.querySelector(`:scope > [data-os="${os}"]`);
    if (!match) continue;
    group.prepend(match);
    match.classList.add("is-suggested");
  }
  for (const notice of document.querySelectorAll("[data-mobile]")) notice.hidden = os !== "mobile";

  // The line from the marked word to the note, as the app draws it between a word and its note.
  const hero = document.querySelector(".hero");
  const mark = document.getElementById("anchor");
  const note = document.querySelector(".sticky");
  const svg = document.querySelector(".leader");
  const path = svg && svg.querySelector("path");
  if (!hero || !mark || !note || !path) return;

  function draw() {
    const base = hero.getBoundingClientRect();
    const word = mark.getBoundingClientRect();
    const box = note.getBoundingClientRect();
    // When the note sits under the text (narrow screens), a line would cross the text: leave it out.
    if (box.left < word.right) { path.removeAttribute("d"); return; }
    // From under the marked word, the line runs below the rest of the headline, then rises to the
    // note's header: like the app's line, it does not cross the text.
    const phrase = mark.parentElement.getBoundingClientRect();
    const x1 = word.left + word.width / 2 - base.left, y1 = word.bottom - base.top + 2;
    const xm = phrase.right - base.left + 14, ym = y1 + 16;
    const x2 = box.left - base.left + 2, y2 = box.top - base.top + 34;
    const pull = Math.max(30, (x2 - xm) * 0.45);
    const f = (n) => n.toFixed(1);
    path.setAttribute("d", `M ${f(x1)} ${f(y1)} C ${f(x1)} ${f(ym)}, ${f(xm - 30)} ${f(ym)}, ${f(xm)} ${f(ym)} C ${f(xm + pull)} ${f(ym)}, ${f(x2 - pull)} ${f(y2)}, ${f(x2)} ${f(y2)}`);
    svg.setAttribute("viewBox", `0 0 ${base.width.toFixed(1)} ${base.height.toFixed(1)}`);
    path.style.setProperty("--length", path.getTotalLength().toFixed(1));
  }

  let frame = 0;
  const redraw = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
  draw();
  svg.classList.add("is-ready");
  addEventListener("resize", redraw);
  if (document.fonts) document.fonts.ready.then(redraw);
})();
