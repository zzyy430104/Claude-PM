-- CreateTable
CREATE TABLE "auth_attempts" (
    "id" BIGSERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_attempts_key_at_idx" ON "auth_attempts"("key", "at");

