-- CreateTable
CREATE TABLE "raw_smt_files" (
    "id" BIGSERIAL NOT NULL,
    "filename" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "source" TEXT DEFAULT 'adhocusage',
    "content_type" TEXT DEFAULT 'application/octet-stream',
    "storage_path" TEXT,
    "content" BYTEA,
    "received_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raw_smt_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "raw_smt_files_sha256_key" ON "raw_smt_files"("sha256");

-- CreateIndex
CREATE INDEX "raw_smt_files_sha256_idx" ON "raw_smt_files"("sha256");

-- CreateIndex
CREATE INDEX "raw_smt_files_created_at_idx" ON "raw_smt_files"("created_at");
