CREATE TYPE "QuizSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "displayName" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Question" (
    "id" UUID NOT NULL,
    "categoryId" UUID,
    "prompt" TEXT NOT NULL,
    "explanation" TEXT,
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestionOption" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "QuestionOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuizSession" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "status" "QuizSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "questionCount" INTEGER NOT NULL,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SessionAnswer" (
    "id" UUID NOT NULL,
    "quizSessionId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "selectedOptionId" UUID,
    "submittedAnswer" TEXT,
    "isCorrect" BOOLEAN NOT NULL,
    "elapsedMilliseconds" INTEGER NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionAnswer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserQuestionStat" (
    "userId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "correctAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastAnsweredAt" TIMESTAMP(3),

    CONSTRAINT "UserQuestionStat_pkey" PRIMARY KEY ("userId","questionId")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_displayName_key" ON "User"("displayName");
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");
CREATE INDEX "Question_categoryId_isPublished_idx" ON "Question"("categoryId", "isPublished");
CREATE UNIQUE INDEX "QuestionOption_questionId_position_key" ON "QuestionOption"("questionId", "position");
CREATE INDEX "QuizSession_userId_completedAt_idx" ON "QuizSession"("userId", "completedAt");
CREATE UNIQUE INDEX "SessionAnswer_quizSessionId_questionId_key" ON "SessionAnswer"("quizSessionId", "questionId");
CREATE INDEX "SessionAnswer_questionId_idx" ON "SessionAnswer"("questionId");
CREATE INDEX "UserQuestionStat_questionId_idx" ON "UserQuestionStat"("questionId");

ALTER TABLE "Question" ADD CONSTRAINT "Question_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuizSession" ADD CONSTRAINT "QuizSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SessionAnswer" ADD CONSTRAINT "SessionAnswer_quizSessionId_fkey" FOREIGN KEY ("quizSessionId") REFERENCES "QuizSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionAnswer" ADD CONSTRAINT "SessionAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionAnswer" ADD CONSTRAINT "SessionAnswer_selectedOptionId_fkey" FOREIGN KEY ("selectedOptionId") REFERENCES "QuestionOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserQuestionStat" ADD CONSTRAINT "UserQuestionStat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserQuestionStat" ADD CONSTRAINT "UserQuestionStat_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
