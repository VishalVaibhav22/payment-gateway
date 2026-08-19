-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PAYER', 'MERCHANT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'PAYER';
