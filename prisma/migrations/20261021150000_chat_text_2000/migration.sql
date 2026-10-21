-- ASCII art in the game chat needs more than 500 chars
ALTER TABLE "ChatMessage" ALTER COLUMN "text" TYPE VARCHAR(2000);
