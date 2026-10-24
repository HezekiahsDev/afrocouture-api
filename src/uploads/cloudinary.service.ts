import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';

export interface UploadedAsset {
  url: string;
  publicId: string;
  format: string;
  bytes: number;
  width?: number;
  height?: number;
  resourceType: string;
}

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly configured: boolean;
  private readonly rootFolder: string;

  constructor(config: ConfigService) {
    const cloudName = config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = config.get<string>('CLOUDINARY_API_SECRET');
    this.rootFolder = config.get<string>('CLOUDINARY_FOLDER') || 'afrocouture';
    this.configured = Boolean(cloudName && apiKey && apiSecret);

    if (this.configured) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
        // Test-only: point uploads at a local mock instead of api.cloudinary.com.
        ...(config.get<string>('CLOUDINARY_UPLOAD_PREFIX')
          ? { upload_prefix: config.get<string>('CLOUDINARY_UPLOAD_PREFIX') }
          : {}),
      });
    } else {
      this.logger.warn('Cloudinary is not configured (CLOUDINARY_* env vars missing); uploads are disabled.');
    }
  }

  get isConfigured(): boolean {
    return this.configured;
  }

  async upload(file: Express.Multer.File, folder: string): Promise<UploadedAsset> {
    return this.uploadBuffer(file.buffer, folder);
  }

  /** Stores raw bytes (an uploaded file or a generated image) under the given folder. */
  async uploadBuffer(buffer: Buffer, folder: string): Promise<UploadedAsset> {
    if (!this.configured) {
      throw new ServiceUnavailableException('File uploads are not available right now. Please try again later.');
    }

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `${this.rootFolder}/${folder}`,
          // PDFs (CAC certificates, IDs) are stored as images so Cloudinary can render previews.
          resource_type: 'auto',
        },
        (error, response) => {
          if (error || !response) reject(error ?? new Error('Empty Cloudinary response'));
          else resolve(response);
        },
      );
      stream.end(buffer);
    }).catch((err: unknown) => {
      this.logger.error('Cloudinary upload failed', err as Error);
      throw new ServiceUnavailableException('Upload failed. Please try again.');
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      resourceType: result.resource_type,
    };
  }
}
