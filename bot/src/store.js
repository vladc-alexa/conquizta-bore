'use strict';
// Persistence: writes a game into the SAME tables the site uses, so Discord play
// feeds the existing PRC leaderboard (computeAllPrc reads SessionAnswer rows of
// COMPLETED QuizSessions).
//
// mode:
//   dry      - build the exact payload, write nothing (default; used by the harness)
//   rollback - write inside a transaction, then roll back -> proves the write path
//              (FKs, unique constraints) against the real DB without polluting it
//   commit   - real write
class Store {
  constructor({ prisma, mode = 'dry', log = console.log } = {}) {
    if (!['dry', 'rollback', 'commit'].includes(mode)) throw new Error(`bad store mode: ${mode}`);
    this.prisma = prisma;
    this.mode = mode;
    this.log = log;
    this.written = [];
  }

  buildSession({ playerId, mode, startedAt, completedAt, answers }) {
    const correctCount = answers.filter((a) => a.isCorrect).length;
    return {
      session: {
        userId: playerId ?? null,
        status: 'COMPLETED',
        questionCount: answers.length,
        correctCount,
        startedAt: new Date(startedAt),
        completedAt: new Date(completedAt ?? startedAt),
        gameMode: mode, // informational only; not a DB column
      },
      answers,
    };
  }

  /** Persist one player's completed game. Returns { id, players, answers }. */
  async finalizeGame({ playerId, mode, startedAt, completedAt, answers }) {
    const payload = this.buildSession({ playerId, mode, startedAt, completedAt, answers });
    if (this.mode === 'dry') {
      this.written.push({ ...payload, id: '(dry-run)' });
      return { id: '(dry-run)', answerCount: answers.length };
    }

    const write = async (tx) => {
      const created = await tx.quizSession.create({
        data: {
          userId: payload.session.userId,
          status: 'COMPLETED',
          questionCount: payload.session.questionCount,
          correctCount: payload.session.correctCount,
          startedAt: payload.session.startedAt,
          completedAt: payload.session.completedAt,
        },
        select: { id: true },
      });
      for (const a of answers) {
        await tx.sessionAnswer.create({
          data: {
            quizSessionId: created.id,
            questionId: a.questionId,
            selectedOptionId: a.selectedOptionId ?? null,
            submittedAnswer: a.submittedAnswer != null ? String(a.submittedAnswer).slice(0, 50) : null,
            isCorrect: !!a.isCorrect,
            elapsedMilliseconds: Math.max(0, Math.min(Math.round(a.elapsedMilliseconds), 60_000)),
            answeredAt: new Date(a.answeredAt),
          },
        });
      }
      return created.id;
    };

    if (this.mode === 'rollback') {
      let seenId = null;
      try {
        await this.prisma.$transaction(async (tx) => {
          seenId = await write(tx);
          throw new Error('__ROLLBACK__');
        });
      } catch (e) {
        if (e.message !== '__ROLLBACK__') throw e;
        this.log(`   [store] rollback-mode: wrote session ${seenId} + ${answers.length} answers, rolled back`);
        return { id: seenId, answerCount: answers.length, rolledBack: true };
      }
    }

    const id = await write(this.prisma);
    this.written.push({ ...payload, id });
    return { id, answerCount: answers.length };
  }

  /** dry-run report: exactly what would have been written. */
  report() {
    return this.written.map((w) => ({
      mode: w.session.gameMode,
      userId: w.session.userId,
      questionCount: w.session.questionCount,
      correctCount: w.session.correctCount,
      answers: w.answers.map((a) => ({
        q: a.questionId.slice(0, 8),
        option: a.selectedOptionId ? a.selectedOptionId.slice(0, 8) : null,
        value: a.submittedAnswer ?? null,
        correct: a.isCorrect,
        ms: a.elapsedMilliseconds,
      })),
    }));
  }
}

module.exports = { Store };
