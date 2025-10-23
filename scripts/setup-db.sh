#!/bin/bash
# Database setup script for production deployment

echo "Setting up database for production..."

# Generate Prisma client
echo "Generating Prisma client..."
npx prisma generate

# Push schema to database (creates tables if they don't exist)
echo "Pushing schema to database..."
npx prisma db push

echo "Database setup complete!"
