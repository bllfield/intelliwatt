-- CreateEnum
CREATE TYPE "TestimonialStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "TestimonialSubmission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "TestimonialStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "entryAwardedAt" TIMESTAMP(3),
    "source" TEXT,

    CONSTRAINT "TestimonialSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestimonialSubmission_status_idx" ON "TestimonialSubmission"("status");

-- CreateIndex
CREATE INDEX "TestimonialSubmission_userId_idx" ON "TestimonialSubmission"("userId");

-- AddForeignKey
ALTER TABLE "TestimonialSubmission" ADD CONSTRAINT "TestimonialSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

