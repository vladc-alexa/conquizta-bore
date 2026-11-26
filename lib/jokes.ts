export const JOKES_RO = [
  "De ce nu se ceartă becurile? Pentru că stau aprinse la discuții.",
  "— Doc, fac exerciții fizice în fiecare dimineață! — Bravo! Cât timp? — Cât stă ceasul cu sonerie.",
  "Ce spune un număr la altul? „Ai cifre frumoase!”",
  "— Chelner, cât costă cafeaua? — 5 lei. — Și fără zahăr? — 5 lei. — Atunci dați-mi fără zahăr, e mai dietetică.",
  "De ce matematicienii confundă Halloween-ul cu Crăciunul? Pentru că 31 oct = 25 dec.",
  "Un programator moare și ajunge la poarta Raiului. Sfântul Petru îi zice: „Mai ai o viață, dar ca animal.” Programatorul: „Perfect, am experiență cu bug-uri.”",
  "Internetul e ca un frigider: dacă nu găsești ce cauți, închizi ușa și te uiți iar.",
  "— Domnule profesor, pot să ies? — Doar dacă răspunzi la o întrebare: cât face 7 ori 8? — 56. — Atunci stai jos, ți-ai răspuns singur!",
];

export const JOKES_EN = [
  "Why don't medieval knights ever get tired of trivia? Because they always bring their bright armor!",
  "Why do programmers confuse Halloween and Christmas? Because Oct 31 == Dec 25.",
  "What did the castle say to the trivia champion? 'You really stormed my gates!'",
  "Why did the knight refuse to fight in the dark? He didn't want a knight-mare.",
  "A knight walks into a tavern and orders a quiz. The barkeep says: 'Careful, the answers are on the house!'",
  "Why do dragons sleep during the day? So they can fight knights!",
  "Why did the sword win the debate? It always had the sharpest point.",
  "What is a trivia master's favorite kind of duel? A battle of wits!",
];

export const JOKES = JOKES_RO;

export function jokeOfTheDay(lang: "en" | "ro" = "en", d: Date = new Date()): string {
  const start = new Date(d.getFullYear(), 0, 0);
  const day = Math.floor((d.getTime() - start.getTime()) / 86400000);
  const pool = lang === "ro" ? JOKES_RO : JOKES_EN;
  return pool[day % pool.length];
}
