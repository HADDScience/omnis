-- 완료를 AI가 추론해 확정하지 않고 담당자에게 묻는 단계가 생겼다(인수인계 §4-3).
-- 그 "확인 대기" 상태를 TASK_DONE(완료)과 구분해 표시하기 위한 값.
ALTER TYPE "MessageKind" ADD VALUE 'TASK_DONE_PENDING';
