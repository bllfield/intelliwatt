// lib/ercot/upload.ts

import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const endpoint = process.env.S3_ENDPOINT || process.env.DO_SPACES_ENDPOINT; // e.g. https://nyc3.digitaloceanspaces.com
const region = process.env.S3_REGION || "us-east-1";
const bucket = process.env.S3_BUCKET as string;

const s3 = new S3Client({
  region,
  endpoint,
  forcePathStyle: !!process.env.S3_FORCE_PATH_STYLE, // optional
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string,
  }
});

export async function objectExists(key: string) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function putObject(key: string, body: Uint8Array | Buffer, contentType = "application/zip") {
  const acl = (process.env.S3_ACL || "private") as "private" | "public-read" | "public-read-write" | "authenticated-read" | "aws-exec-read" | "bucket-owner-read" | "bucket-owner-full-control" | undefined;
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ACL: acl
  }));
  return { bucket, key };
}

