-- Chat: editable messages + WhatsApp-style replies.
ALTER TABLE "ChatMessage" ADD COLUMN "editedAt" TIMESTAMP(3);
ALTER TABLE "ChatMessage" ADD COLUMN "replyToId" UUID;

CREATE INDEX "ChatMessage_replyToId_idx" ON "ChatMessage"("replyToId");

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_replyToId_fkey"
  FOREIGN KEY ("replyToId") REFERENCES "ChatMessage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
