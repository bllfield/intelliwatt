ALTER TABLE "Entry"
ADD COLUMN "houseId" TEXT REFERENCES "HouseAddress"("id") ON DELETE SET NULL;

CREATE INDEX "Entry_houseId_idx" ON "Entry"("houseId");

