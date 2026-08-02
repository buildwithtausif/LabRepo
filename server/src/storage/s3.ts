import type { StorageAdapter } from './adapter.js';

/**
 * S3Adapter — real AWS S3 implementation.
 * 
 * This is a stub for production use. To activate:
 * 1. Install @aws-sdk/client-s3: npm install @aws-sdk/client-s3
 * 2. Set real AWS environment variables
 * 3. Switch the storage adapter in src/index.ts
 * 
 * See PRODUCTION_SETUP.md for full instructions.
 */
export class S3Adapter implements StorageAdapter {
  // private client: S3Client;
  // private bucket: string;

  constructor() {
    // const { S3Client } = await import('@aws-sdk/client-s3');
    // this.client = new S3Client({
    //   region: process.env.AWS_REGION,
    //   endpoint: process.env.AWS_ENDPOINT,
    //   credentials: {
    //     accessKeyId: process.env.AWS_ACCESS_KEY!,
    //     secretAccessKey: process.env.AWS_SECRET_KEY!,
    //   },
    // });
    // this.bucket = process.env.AWS_BUCKET!;
    throw new Error(
      'S3Adapter is not yet configured. See PRODUCTION_SETUP.md for instructions.'
    );
  }

  async upload(_key: string, _data: Buffer, _contentType: string): Promise<void> {
    throw new Error('Not implemented — see PRODUCTION_SETUP.md');
  }

  async download(_key: string): Promise<{ data: Buffer; contentType: string }> {
    throw new Error('Not implemented — see PRODUCTION_SETUP.md');
  }

  async delete(_key: string): Promise<void> {
    throw new Error('Not implemented — see PRODUCTION_SETUP.md');
  }

  async exists(_key: string): Promise<boolean> {
    throw new Error('Not implemented — see PRODUCTION_SETUP.md');
  }

  async list(_prefix: string): Promise<string[]> {
    throw new Error('Not implemented — see PRODUCTION_SETUP.md');
  }
}
