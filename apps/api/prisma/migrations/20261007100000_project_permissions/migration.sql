-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "perm_config" JSONB NOT NULL DEFAULT '{}';

