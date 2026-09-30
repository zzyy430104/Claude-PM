ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "password_changed_at" TIMESTAMP(3);
