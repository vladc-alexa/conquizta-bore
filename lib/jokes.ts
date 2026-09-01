export const JOKES = [
  "De ce nu se ceartă becurile? Pentru că stau aprinse la discuții.",
  "— Doc, fac exerciții fizice în fiecare dimineață! — Bravo! Cât timp? — Cât stă ceasul cu sonerie.",
  "Ce spune un număr la altul? „Ai cifre frumoase!”",
  "— Chelner, cât costă cafeaua? — 5 lei. — Și fără zahăr? — 5 lei. — Atunci dați-mi fără zahăr, e mai dietetică.",
  "De ce matematicienii confundă Halloween-ul cu Crăciunul? Pentru că 31 oct = 25 dec.",
  "— Tata, de ce plouă? — Ca să crească iarba. — Dar de ce plouă pe stradă, nu pe gazon?",
  "Un programator moare și ajunge la poarta Raiului. Sfântul Petru îi zice: „Mai ai o viață, dar ca animal.” Programatorul: „Perfect, am experiență cu bug-uri.”",
  "— Îți place muzica clasică? — Da, mai ales când e gratis.",
  "De ce oglinda minte? Pentru că reflectă realitatea doar când o privim.",
  "— Ce faci dacă te mușcă un cal? — Mă duc la dentist!",
  "Internetul e ca un frigider: dacă nu găsești ce cauți, închizi ușa și te uiți iar.",
  "— Domnule profesor, pot să ies? — Doar dacă răspunzi la o întrebare: cât face 7 ori 8? — 56. — Atunci stai jos, ți-ai răspuns singur!",
];

export function jokeOfTheDay(d: Date = new Date()): string {
  const start = new Date(d.getFullYear(), 0, 0);
  const day = Math.floor((d.getTime() - start.getTime()) / 86400000);
  return JOKES[day % JOKES.length];
}
