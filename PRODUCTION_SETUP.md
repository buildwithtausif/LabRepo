# LabRepo — Production Setup Guide

This guide explains how to switch from the mock S3 storage (used during development) to a real AWS S3 bucket for production deployment.

## Architecture Overview

LabRepo uses a **Storage Adapter** abstraction (`server/src/storage/adapter.ts`). During development, the `MockS3Adapter` stores files on the local filesystem. For production, you swap it with the `S3Adapter` which connects to a real AWS S3 bucket.

## 1. Create an AWS S3 Bucket

1. Log in to the [AWS Console](https://console.aws.amazon.com)
2. Navigate to **S3** → **Create Bucket**
3. Settings:
   - **Bucket name**: `labrepo-storage` (or your preferred name)
   - **Region**: Choose a region close to your users
   - **Block all public access**: ✅ Enabled (files are accessed only through the API)
   - **Bucket Versioning**: Optional (recommended for data safety)
   - **Encryption**: Enable SSE-S3 (default encryption)
4. Click **Create Bucket**

## 2. Create an IAM User

1. Navigate to **IAM** → **Users** → **Create User**
2. User name: `labrepo-s3-user`
3. Select **Attach policies directly**
4. Create a custom policy with the following JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:HeadObject"
      ],
      "Resource": [
        "arn:aws:s3:::labrepo-storage",
        "arn:aws:s3:::labrepo-storage/*"
      ]
    }
  ]
}
```

5. Attach the policy to the user
6. Go to **Security Credentials** → **Create Access Key**
7. Choose **Application running outside AWS**
8. Save the **Access Key ID** and **Secret Access Key**

## 3. Environment Variables

Update your `.env` file with real credentials:

```env
# Replace fake values with real AWS credentials
AWS_ACCESS_KEY=your_real_access_key_id
AWS_SECRET_KEY=your_real_secret_access_key
AWS_BUCKET=labrepo-storage
AWS_REGION=us-east-1
AWS_ENDPOINT=https://s3.us-east-1.amazonaws.com

# Clerk (keep existing values)
PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...

# API
API_PORT=3001
```

> **For S3-compatible services** (MinIO, Cloudflare R2, Backblaze B2, DigitalOcean Spaces):
> Set `AWS_ENDPOINT` to the provider's endpoint URL and adjust `AWS_REGION` accordingly.

## 4. Implement the S3 Adapter

Open `server/src/storage/s3.ts` and replace the stub with:

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { StorageAdapter } from './adapter.js';

export class S3Adapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.client = new S3Client({
      region: process.env.AWS_REGION!,
      endpoint: process.env.AWS_ENDPOINT,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY!,
        secretAccessKey: process.env.AWS_SECRET_KEY!,
      },
      forcePathStyle: true, // Required for some S3-compatible services
    });
    this.bucket = process.env.AWS_BUCKET!;
  }

  async upload(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    }));
  }

  async download(key: string): Promise<{ data: Buffer; contentType: string }> {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));

    const body = await response.Body!.transformToByteArray();
    return {
      data: Buffer.from(body),
      contentType: response.ContentType || 'application/octet-stream',
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const response = await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
    }));

    return (response.Contents || []).map(obj => obj.Key!).filter(Boolean);
  }
}
```

Install the AWS SDK:

```bash
cd server
npm install @aws-sdk/client-s3
```

## 5. Switch the Storage Adapter

In `server/src/index.ts`, change:

```diff
- import { MockS3Adapter } from './storage/mock-s3.js';
+ import { S3Adapter } from './storage/s3.js';

  // In the start() function:
- const storage = new MockS3Adapter();
+ const storage = new S3Adapter();
```

## 6. Migration Notes

### Migrating existing files from MockS3 to S3

If you've been using the mock adapter and have files in `server/data/storage/`, you need to upload them to S3:

```bash
# Using AWS CLI
aws s3 sync server/data/storage/ s3://labrepo-storage/ --region us-east-1
```

### Database

The SQLite database (`server/data/labrepo.db`) contains all metadata. For production:

1. **Back up the database** before any migration
2. The storage keys in the `files` table match the S3 object keys, so no database changes are needed
3. Consider switching to PostgreSQL for production if you expect high concurrency

### CORS

Update the CORS origins in `server/src/index.ts` to match your production domain:

```typescript
await fastify.register(cors, {
  origin: ['https://your-domain.com'],
  credentials: true,
});
```

## 7. Deployment Checklist

- [ ] AWS S3 bucket created with proper permissions
- [ ] IAM user created with minimal required permissions
- [ ] Environment variables set with real credentials
- [ ] S3Adapter implemented and tested
- [ ] Storage adapter swapped in `index.ts`
- [ ] Existing files migrated (if applicable)
- [ ] CORS origins updated for production domain
- [ ] Clerk production keys configured
- [ ] Database backed up
- [ ] Health check endpoint verified (`GET /health`)
