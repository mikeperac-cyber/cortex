// SM-2 spaced repetition (SuperMemo 2) for Recall: grade a card, get its next interval, ease and due date.
(function () {
  const QUALITY = { again: 1, hard: 3, good: 4, easy: 5 }; // SM-2 quality 0-5; below 3 is a lapse

  // card: { repetitions, interval, ease } (missing fields start fresh). Returns those three plus nextReview (ISO), due `interval`
  // local calendar days after `now`.
  function schedule(card, grade, now = new Date()) {
    const q = QUALITY[grade];
    if (q === undefined) throw new Error('Unknown grade: ' + grade);
    const ease0 = Number.isFinite(card.ease) && card.ease >= 1.3 ? card.ease : 2.5;
    const reps0 = Number.isInteger(card.repetitions) && card.repetitions > 0 ? card.repetitions : 0;
    const interval0 = Number.isFinite(card.interval) && card.interval > 0 ? card.interval : 1;
    const ease = Math.max(1.3, Math.round((ease0 + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)) * 100) / 100);
    let repetitions, interval;
    if (q < 3) { repetitions = 0; interval = 1; }
    else {
      repetitions = reps0 + 1;
      interval = repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(interval0 * ease0);
    }
    const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + interval, 9, 0); // a local morning: never the UTC edge
    return { repetitions, interval, ease, nextReview: due.toISOString() };
  }

  const api = { schedule };
  if (typeof module !== 'undefined') module.exports = api;
  else window.CortexLib = Object.assign(window.CortexLib || {}, api);
})();
