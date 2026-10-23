// Local-only fixture: enough grilă questions (4 options, one correct) for a
// full Carciuma sitting. Run with a throwaway DATABASE_URL.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const stamp = Date.now();

const TOPICS = [
  ["Care este capitala Australiei?", ["Sydney", "Canberra", "Melbourne", "Perth"]],
  ["Cine a pictat Capela Sixtină?", ["Rafael", "Michelangelo", "Leonardo", "Donatello"]],
  ["Câți ani are un deceniu?", ["5", "10", "20", "100"]],
  ["Care e cel mai mare ocean?", ["Atlantic", "Indian", "Pacific", "Arctic"]],
  ["Din ce țară vine sushi-ul?", ["China", "Japonia", "Coreea", "Thailanda"]],
  ["Care planetă e cunoscută ca Planeta Roșie?", ["Venus", "Marte", "Jupiter", "Mercur"]],
  ["Câte corzi are o chitară clasică?", ["4", "5", "6", "7"]],
  ["Cine a scris „Luceafărul”?", ["Eminescu", "Caragiale", "Rebreanu", "Blaga"]],
  ["Care e simbolul chimic al aurului?", ["Ag", "Au", "Fe", "Cu"]],
  ["În ce an a căzut Zidul Berlinului?", ["1979", "1985", "1989", "1991"]],
  ["Câți metri are un kilometru?", ["100", "500", "1000", "10000"]],
  ["Care e cel mai lung fluviu din Europa?", ["Dunărea", "Volga", "Rin", "Loara"]],
  ["Ce animal e emblema Australiei?", ["Cangur", "Koala", "Emu", "Dingo"]],
  ["Câte luni are un an bisect?", ["11", "12", "13", "10"]],
  ["Cine a compus „Oda bucuriei”?", ["Mozart", "Beethoven", "Bach", "Chopin"]],
  ["Care e moneda Japoniei?", ["Won", "Yen", "Yuan", "Baht"]],
  ["Ce gaz respiră plantele?", ["Oxigen", "Azot", "Dioxid de carbon", "Heliu"]],
  ["Care e cel mai înalt vârf din România?", ["Omu", "Moldoveanu", "Negoiu", "Vânătoarea lui Buteanu"]],
  ["Câți jucători are o echipă de handbal pe teren?", ["5", "6", "7", "11"]],
  ["Din ce e făcut humusul?", ["Nisip", "Argilă", "Materie organică", "Calcar"]],
  ["Care e capitala Canadei?", ["Toronto", "Ottawa", "Montreal", "Vancouver"]],
  ["Câte inimi are o caracatiță?", ["1", "2", "3", "4"]],
  ["Cine a inventat telefonul?", ["Edison", "Bell", "Tesla", "Marconi"]],
  ["Care e cel mai dur mineral?", ["Diamant", "Corindon", "Cuarț", "Topaz"]],
  ["Ce înseamnă „MCM” în cifre romane?", ["1900", "1800", "2100", "1100"]],
  ["Câți ani are un veac?", ["10", "50", "100", "1000"]],
  ["Care e cea mai mică țară din lume?", ["Monaco", "Vatican", "Malta", "San Marino"]],
  ["Ce culoare are clorofila?", ["Roșu", "Verde", "Albastru", "Galben"]],
  ["Cine a scris „Dune”?", ["Asimov", "Herbert", "Clarke", "Dick"]],
  ["Câte grade are un unghi drept?", ["45", "60", "90", "180"]],
];

async function main() {
  const admin = await prisma.user.upsert({
    where: { email: "admin@conquizta.ro" },
    update: {},
    create: { email: "admin@conquizta.ro", displayName: "AdminTest", isAdmin: true, canEditQuestions: true },
  });

  let made = 0;
  for (const [prompt, opts] of TOPICS) {
    const q = await prisma.question.create({
      data: {
        prompt: `${prompt} #${stamp}`,
        isPublished: true,
        options: {
          create: opts.map((text, i) => ({ text, position: i, isCorrect: i === 1 })),
        },
      },
    });
    if (q) made++;
  }
  // rapide rounds: one numeric option, spaced so a nearby guess still scores
  const NUMERIC = [
    ["Câte picioare are un păianjen?", 8],
    ["În ce an a căzut Constantinopolul?", 1453],
    ["Câți dinți are un adult?", 32],
    ["Câte state are SUA?", 50],
    ["Câte corzi are o chitară clasică?", 6],
    ["Câte minute are o zi?", 1440],
    ["Câte oase are corpul uman?", 206],
    ["Câte planete are sistemul solar?", 8],
  ];
  for (const [prompt, answer] of NUMERIC) {
    await prisma.question.create({
      data: {
        prompt: `${prompt} #${stamp}`,
        isPublished: true,
        options: {
          create: [
            { text: String(answer - 2), position: 0, isCorrect: false },
            { text: String(answer), position: 1, isCorrect: true },
            { text: String(answer + 7), position: 2, isCorrect: false },
            { text: String(answer + 19), position: 3, isCorrect: false },
          ],
        },
      },
    });
    made++;
  }
  console.log(JSON.stringify({ admin: admin.id, questions: made }));
}

main().finally(() => prisma.$disconnect());
