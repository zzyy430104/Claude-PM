-- 记录刷新令牌因正常轮换而作废的时间，用于多标签页并发刷新的宽限期
ALTER TABLE "refresh_tokens" ADD COLUMN "rotated_at" TIMESTAMP(3);
