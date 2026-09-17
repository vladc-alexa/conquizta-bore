# ConQuizta Discord arena (bot)

Arena pentru serverul tău Discord: **#antrenament** (antrenament + battle royale) și
**#1vs1** (duel). Regulile sunt deterministe și rulează **fără LLM** — întrebările vin
din aceleași tabele pe care le folosește site-ul, iar răspunsurile se scriu în
`QuizSession` / `SessionAnswer`, deci intră automat în clasamentul PRC existent.

## Moduri

| Mod | Canal | Reguli |
|---|---|---|
| `/antrenament` | #antrenament | 10 întrebări, grilă 20s / rapidă 10s, fără eliminare. Fiecare jucător are propria rundă, concurent. |
| `/royale` | #antrenament | 60s înscriere (buton), apoi runde pe aceeași întrebare: greșit **sau** prea lent = OUT. Timpul scade la 75% după runda 5 (min 6s). Ultimul rămas câștigă. |
| `/duel @x` | #1vs1 | Accept/Refuz, apoi max 7 runde alternate grilă/rapidă. Prima rundă câștigată = 1 victorie de rundă; primul la 4 câștigă duelul; la egalitate după 7 runde → runde rapide de departajare. |

Runda de grilă se câștigă de răspunsul corect cel mai rapid; runda rapidă de scorul PRC
cel mai mare (la scor egal, răspunsul mai rapid). Rapidă = „corect” dacă eroarea relativă
≤ 10%.

## Cum se apără jocul

- **Răspunsul corect nu pleacă niciodată spre Discord**: butoanele transportă doar indexul
  (0–3) sau un token de rundă; verificarea se face pe server, din DB.
- **Token de rundă** (`<gameId>:<round>`): un click venit după închiderea rundei (sau de la
  o întrebare veche) e refuzat — altfel un răspuns târziu s-ar putea nota la întrebarea
  următoare.
- Un singur răspuns per jucător per rundă; al doilea e refuzat.

## Rulare

```bash
cd bot && npm i                       # discord.js
node --env-file=../.env src/harness.js               # simulare 3 jocuri pe DB-ul real
node --env-file=../.env src/harness.js --store=rollback   # scrie sesiuni reale, apoi rollback
node --env-file=../.env src/index.js                 # botul (necesită DISCORD_TOKEN)
```

Variabile în `../.env`: `DISCORD_TOKEN`, `DATABASE_URL` (deja existent), opțional
`BOT_STORE_MODE=dry|rollback|commit`.

`npm start` pornește botul: înregistrează comenzile slash, creează `#antrenament` și
`#1vs1` dacă lipsesc (are nevoie de permisiunea Manage Channels) și salvează id-urile în
`bot/.discord-channels.json`.

## Harness (dovada că regulile funcționează)

`src/harness.js` joacă cele trei moduri cu jucători scriptați pe un **ceas virtual**
(`--seed=N` pentru reproductibilitate), pe întrebări reale din DB, și verifică:
eliminarea corectă, exact 3 eliminați din 4, sfârșitul duelului (4 runde câștigate sau 7
runde), durata antrenamentului (10 întrebări), respingerea răspunsului duplicat, respingerea
click-ului din rundă închisă, precum și că **niciun id intern nu se scurge** în payload-ul
public.

## Ce mai lipsește (cunoscut)

1. **`discordId` în schema `User`** — acum legătura se face pe `displayName` (unic, max 32
   caractere) și se creează rândul la prima jucare. O migrare `discordId String? @unique`
   face legătura exactă.
2. **Rezultatele de duel (W/L)** nu au tabelă — se afișează în canal, nu se stochează.
3. **Transportul Discord nu a fost încă rulat** cu token (a fost scris înainte de a exista
   token). Motorul e dovedit; primul run real e un smoke test.
