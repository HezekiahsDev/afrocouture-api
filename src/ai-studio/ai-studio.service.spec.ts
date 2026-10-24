import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { AiStudioService, startOfUtcDay } from './ai-studio.service.js';
import { buildImagenPrompt } from './prompt.js';

describe('buildImagenPrompt', () => {
  it('wraps the description with art direction and the chosen details', () => {
    const prompt = buildImagenPrompt({
      prompt: '  A flowing   agbada with gold\nembroidery ',
      garmentType: 'Agbada',
      occasion: 'Wedding',
      colour: 'Ivory and gold',
    });
    expect(prompt).toContain('Design: A flowing agbada with gold embroidery');
    expect(prompt).toContain('Garment: Agbada.');
    expect(prompt).toContain('Occasion: Wedding.');
    expect(prompt).toContain('Colour palette: Ivory and gold.');
    expect(prompt).not.toContain('Fabric:');
    expect(prompt).toMatch(/No text, no logos/);
  });
});

describe('AiStudioService', () => {
  const user = { id: 'user-1' } as any;
  const config = { get: (key: string, fallback?: unknown) => (key === 'AI_DAILY_LIMIT' ? 3 : fallback) } as any;

  function setup({ usedToday = 0, imagenConfigured = true, cloudinaryConfigured = true } = {}) {
    const designs = {
      count: vi.fn(async () => usedToday),
      create: vi.fn((d: object) => d),
      save: vi.fn(async (d: object) => ({ id: 'design-1', ...d })),
    };
    const imagen = {
      isConfigured: imagenConfigured,
      modelName: 'imagen-test',
      generate: vi.fn(async (_p: string, count: number) =>
        Array.from({ length: count }, () => ({ bytes: Buffer.from('png'), mimeType: 'image/png' })),
      ),
    };
    let n = 0;
    const cloudinary = {
      isConfigured: cloudinaryConfigured,
      uploadBuffer: vi.fn(async () => ({ url: `https://res.cloudinary.com/x/${++n}.png` })),
    };
    const service = new AiStudioService(designs as any, imagen as any, cloudinary as any, config);
    return { service, designs, imagen, cloudinary };
  }

  it('reports quota with the next UTC midnight as the reset time', async () => {
    const { service } = setup({ usedToday: 2 });
    const quota = await service.quota(user);
    expect(quota.used).toBe(2);
    expect(quota.limit).toBe(3);
    expect(new Date(quota.resetsAt).getTime()).toBe(startOfUtcDay().getTime() + 86_400_000);
  });

  it('refuses once the daily limit is used, without calling Imagen', async () => {
    const { service, imagen } = setup({ usedToday: 3 });
    const err = await service.generate(user, { prompt: 'A modern kaftan for work' }).catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(imagen.generate).not.toHaveBeenCalled();
  });

  it('returns 503 when Imagen or Cloudinary is not configured', async () => {
    await expect(setup({ imagenConfigured: false }).service.generate(user, { prompt: 'A modern kaftan for work' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(setup({ cloudinaryConfigured: false }).service.generate(user, { prompt: 'A modern kaftan for work' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('stores each generated image and saves the design', async () => {
    const { service, imagen, cloudinary } = setup();
    const design = await service.generate(user, { prompt: 'A modern kaftan for work', count: 2, aspectRatio: '1:1' });
    expect(imagen.generate).toHaveBeenCalledWith(expect.stringContaining('A modern kaftan for work'), 2, '1:1');
    expect(cloudinary.uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'ai-designs/user-1');
    expect(design).toMatchObject({
      userId: 'user-1',
      imageUrls: ['https://res.cloudinary.com/x/1.png', 'https://res.cloudinary.com/x/2.png'],
      model: 'imagen-test',
      aspectRatio: '1:1',
    });
  });
});
