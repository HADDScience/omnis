-- 외부 데이터 이식용 멱등성 키.
-- 이게 없으면 "어디까지 넣었는지"를 알 방법이 없어 재실행이 곧 중복이다.
ALTER TABLE "ChatMessage" ADD COLUMN "sourceId" TEXT;
ALTER TABLE "Task"        ADD COLUMN "sourceId" TEXT;

CREATE UNIQUE INDEX "ChatMessage_sourceId_key" ON "ChatMessage"("sourceId");
CREATE UNIQUE INDEX "Task_sourceId_key"        ON "Task"("sourceId");
