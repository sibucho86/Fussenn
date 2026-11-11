// Fussenn download page. Without this script the page still works: both downloads look the same,
// and the notes sit at the top of their margin without lines. It sends nothing anywhere.
(() => {
  "use strict";

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

  // After a download starts from the first note, show how to install it. The download itself
  // goes on: the page only scrolls, it does not navigate.
  for (const link of document.querySelectorAll(".choice[data-os]")) {
    link.addEventListener("click", () => {
      const steps = document.querySelector(`.platform[data-os="${link.dataset.os}"]`);
      if (!steps) return;
      const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      setTimeout(() => steps.scrollIntoView({ behavior, block: "start" }), 400);
    });
  }

  // Each note moves level with the line of its marked word, below the note before it, and a dashed
  // line joins the end of that line to the note's header. The line stays in the gap between the text
  // and the margin, so it never runs over the text.
  const blocks = [...document.querySelectorAll(".block")].map((block) => {
    const text = block.querySelector(".text"), svg = block.querySelector(".leader");
    const items = [...block.querySelectorAll(".anchor[data-note]")]
      .map((mark) => ({ mark, note: document.getElementById(mark.dataset.note) }))
      .filter(({ note }) => note);
    return text && svg && items.length ? { block, text, svg, items } : null;
  }).filter(Boolean);

  const NS = "http://www.w3.org/2000/svg";
  const f = (n) => n.toFixed(1);
  const measure = ({ block, text, items }) => ({
    base: block.getBoundingClientRect(),
    text: text.getBoundingClientRect(),
    items: items.map(({ mark, note }) => {
      const rects = mark.getClientRects();
      return { line: rects[rects.length - 1], note: note.getBoundingClientRect(), head: note.querySelector(".note-head").getBoundingClientRect() };
    }),
  });

  // Reads and writes are batched: reset, measure, place the notes, measure again, draw.
  function draw() {
    for (const { items } of blocks) for (const { note } of items) note.style.marginTop = "";
    const before = blocks.map(measure);
    const beside = before.map(({ text, items }) => items.every(({ line, note }) => line && note.left >= text.right));
    blocks.forEach(({ items }, b) => {
      if (!beside[b]) return;
      const { base } = before[b];
      const gap = parseFloat(getComputedStyle(items[0].note.parentElement).rowGap) || 0;
      let previousBottom = null;
      items.forEach(({ note }, i) => {
        const { line, note: box, head } = before[b].items[i];
        const wanted = line.top + line.height / 2 - head.height / 2 - base.top;
        const natural = previousBottom === null ? 0 : previousBottom + gap;
        const top = Math.max(wanted, natural);
        note.style.marginTop = `${f(top - natural)}px`;
        previousBottom = top + box.height;
      });
    });
    const after = blocks.map(measure);
    blocks.forEach(({ svg }, b) => {
      svg.replaceChildren();
      if (!beside[b]) return;
      const { base, text, items } = after[b];
      for (const { line, note, head } of items) {
        const x1 = text.right - base.left + 8, y1 = line.top + line.height / 2 - base.top;
        const x2 = note.left - base.left, y2 = note.top + head.height / 2 - base.top;
        const pull = (x2 - x1) / 2;
        const path = document.createElementNS(NS, "path");
        path.setAttribute("d", `M ${f(x1)} ${f(y1)} C ${f(x1 + pull)} ${f(y1)} ${f(x2 - pull)} ${f(y2)} ${f(x2)} ${f(y2)}`);
        const dot = document.createElementNS(NS, "circle");
        dot.setAttribute("cx", f(x1)); dot.setAttribute("cy", f(y1)); dot.setAttribute("r", "2.5");
        svg.append(path, dot);
      }
    });
  }

  let frame = 0;
  const redraw = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
  draw();
  addEventListener("resize", redraw);
  addEventListener("load", redraw);
  if (document.fonts) document.fonts.ready.then(redraw);
})();
