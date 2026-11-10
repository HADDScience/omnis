-- 에이전트 실행이 찾은 사내 지식 조각(답의 각주 [n] 이 가리키는 것). 확인을 기다리며 실행이 나뉘어도 번호가 이어지게 실행에 둔다
ALTER TABLE "AgentRun" ADD COLUMN "sources" JSONB NOT NULL DEFAULT '[]';
