-- AlterTable
ALTER TABLE "User" ADD COLUMN "username" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- Usernames are normalized by the API, like emails.
ALTER TABLE "User" ADD CONSTRAINT "User_username_normalized" CHECK ("username" = lower(btrim("username")));
