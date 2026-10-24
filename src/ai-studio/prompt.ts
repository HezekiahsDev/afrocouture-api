import type { GenerateDesignDto } from './dto/ai-studio.dto.js';

/**
 * Wraps the customer's description in fixed art direction so every result is a
 * usable reference for a tailor: one garment, clearly visible, no text or branding.
 */
export function buildImagenPrompt(dto: Pick<GenerateDesignDto, 'prompt' | 'garmentType' | 'occasion' | 'fabric' | 'colour'>): string {
  const details = [
    dto.garmentType && `Garment: ${dto.garmentType.trim()}.`,
    dto.occasion && `Occasion: ${dto.occasion.trim()}.`,
    dto.fabric && `Fabric: ${dto.fabric.trim()}.`,
    dto.colour && `Colour palette: ${dto.colour.trim()}.`,
  ].filter(Boolean);

  return [
    'Photorealistic full-length fashion photograph of a single bespoke African garment, as a tailor would make it.',
    `Design: ${dto.prompt.trim().replace(/\s+/g, ' ')}`,
    ...details,
    'The whole garment is visible on one model against a plain studio backdrop, soft even lighting,',
    'accurate fabric texture, realistic construction and seams.',
    'No text, no logos, no watermarks, no collage.',
  ].join(' ');
}
