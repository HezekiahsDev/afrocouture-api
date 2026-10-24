import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import type { AspectRatio } from './dto/ai-studio.dto.js';

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
}

interface PredictResponse {
  predictions?: { bytesBase64Encoded?: string; mimeType?: string; raiFilteredReason?: string }[];
}

/** Calls Vertex AI Imagen's REST `:predict` endpoint. */
@Injectable()
export class ImagenClient {
  private readonly logger = new Logger(ImagenClient.name);
  private readonly projectId?: string;
  private readonly location: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly staticToken?: string;
  private readonly auth?: GoogleAuth;

  constructor(config: ConfigService) {
    this.projectId = config.get<string>('VERTEX_AI_PROJECT_ID') || undefined;
    this.location = config.get<string>('VERTEX_AI_LOCATION') || 'us-central1';
    this.model = config.get<string>('VERTEX_IMAGEN_MODEL') || 'imagen-3.0-generate-002';
    this.baseUrl = (config.get<string>('VERTEX_API_BASE_URL') || `https://${this.location}-aiplatform.googleapis.com`).replace(
      /\/$/,
      '',
    );
    // Test-only: a fixed bearer token, so a local mock can stand in for Google's token endpoint.
    this.staticToken = config.get<string>('VERTEX_ACCESS_TOKEN') || undefined;

    const json = config.get<string>('GOOGLE_APPLICATION_CREDENTIALS_JSON');
    const keyFile = config.get<string>('GOOGLE_APPLICATION_CREDENTIALS');
    const scopes = ['https://www.googleapis.com/auth/cloud-platform'];
    try {
      if (json) this.auth = new GoogleAuth({ credentials: JSON.parse(json), scopes });
      else if (keyFile) this.auth = new GoogleAuth({ keyFile, scopes });
    } catch (err) {
      this.logger.error('GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON; AI Studio is disabled.', err as Error);
    }
  }

  get modelName(): string {
    return this.model;
  }

  get isConfigured(): boolean {
    return Boolean(this.projectId && (this.staticToken || this.auth));
  }

  async generate(prompt: string, count: number, aspectRatio: AspectRatio): Promise<GeneratedImage[]> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException("AI Studio isn't available right now.");
    }

    const url =
      `${this.baseUrl}/v1/projects/${this.projectId}/locations/${this.location}` +
      `/publishers/google/models/${this.model}:predict`;

    let response: Response;
    try {
      const token = this.staticToken ?? (await this.accessToken());
      response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: count,
            aspectRatio,
            personGeneration: 'allow_adult',
            safetySetting: 'block_medium_and_above',
            addWatermark: true,
          },
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      this.logger.error('Imagen request failed', err as Error);
      throw new BadGatewayException("We couldn't reach the image service. Please try again in a moment.");
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.error(`Imagen returned ${response.status}: ${body.slice(0, 500)}`);
      if (response.status === 429) {
        throw new BadGatewayException('The image service is busy right now. Please try again in a minute.');
      }
      throw new BadGatewayException('The image service had a problem generating your design. Please try again.');
    }

    const data = (await response.json()) as PredictResponse;
    const images = (data.predictions ?? [])
      .filter((p) => p.bytesBase64Encoded)
      .map((p) => ({ bytes: Buffer.from(p.bytesBase64Encoded!, 'base64'), mimeType: p.mimeType ?? 'image/png' }));

    if (!images.length) {
      throw new UnprocessableEntityException('That prompt was blocked by the image safety filter. Try rewording it.');
    }
    return images;
  }

  private async accessToken(): Promise<string> {
    const client = await this.auth!.getClient();
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('No access token returned for the service account');
    return token;
  }
}
