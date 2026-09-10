-- AlterTable
ALTER TABLE "User" ADD COLUMN     "favoriteSubjectIds" TEXT[];

-- Migrate the previous single favorite subject as a one-element ranking
UPDATE "User"
SET "favoriteSubjectIds" = ARRAY["favoriteSubjectId"]
WHERE "favoriteSubjectId" IS NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "favoriteSubjectId";
