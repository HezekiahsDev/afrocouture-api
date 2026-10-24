/**
 * Loads illustrative catalogue data (sample artisans, merchants, fabrics, styles)
 * so the marketplace isn't empty before real sellers are verified.
 *
 *   pnpm seed            add sample data (skips anything already seeded)
 *   pnpm seed --remove   delete all sample data
 *
 * Every row is flagged isSample = true and is never shown as "verified".
 * Image paths point at files served by the web app (afrocouture-web/public/images).
 */
import dataSource from '../database/data-source.js';
import { TailorProfile } from '../tailors/entities/tailor-profile.entity.js';
import { MerchantProfile, SourcingType } from '../merchants/entities/merchant-profile.entity.js';
import { Fabric, FabricUnit } from '../fabrics/entities/fabric.entity.js';
import { Style } from '../styles/entities/style.entity.js';
import { KycStatus } from '../types/index.js';

const styles: Partial<Style>[] = [
  { name: 'Modern kaftan', category: 'Everyday elegance', imageUrl: '/images/style-kaftan.jpg', startingPrice: 15000 },
  { name: 'Aso Ebi', category: 'Celebrations', imageUrl: '/images/style-aso-ebi.jpg', startingPrice: 65000 },
  { name: 'Imperial agbada', category: 'Ceremony', imageUrl: '/images/style-agbada.jpg', startingPrice: 25000 },
  { name: 'Contemporary native', category: 'New classics', imageUrl: '/images/style-native.jpg', startingPrice: 38000 },
  { name: 'Couples couture', category: 'Made together', imageUrl: '/images/style-couple.jpg', startingPrice: 42000 },
  { name: 'Everyday pieces', category: 'Easy dressing', imageUrl: '/images/style-casual.jpg', startingPrice: 8000 },
];

const tailors: Partial<TailorProfile>[] = [
  {
    displayName: 'Alhaji Musa',
    atelierName: 'Musa Atelier',
    city: 'Kano',
    craft: 'Heritage embroidery & agbada',
    bio: 'Hand-finished kaftans and agbada with traditional Kano embroidery, cut to your measurements.',
    yearsExperience: 22,
    specialtyTags: ['Kaftan', 'Embroidery'],
    startingPrice: 40000,
    portraitUrl: '/images/artisan-musa-v2.webp',
    coverImageUrl: '/images/artisan-musa-v2.webp',
    rating: '4.6',
    reviewCount: 38,
  },
  {
    displayName: 'Aisha Bello',
    atelierName: 'Aisha Styles',
    city: 'Lagos',
    craft: 'Bridal and occasion couture',
    bio: 'Aso Ebi, bridal and occasion gowns with structured bodices and hand-placed beadwork.',
    yearsExperience: 12,
    specialtyTags: ['Aso Ebi', 'Bridal'],
    startingPrice: 55000,
    portraitUrl: '/images/artisan-aisha-v2.webp',
    coverImageUrl: '/images/artisan-aisha-v2.webp',
    rating: '4.7',
    reviewCount: 54,
  },
  {
    displayName: 'Chukwudi Bello',
    atelierName: 'Bello Fashion',
    city: 'Abuja',
    craft: 'Modern Nigerian menswear',
    bio: 'Senator wear and tailored suits with clean lines for work, weddings and everyday wear.',
    yearsExperience: 9,
    specialtyTags: ['Senator wear', 'Suits'],
    startingPrice: 35000,
    portraitUrl: '/images/artisan-bello-v2.webp',
    coverImageUrl: '/images/artisan-bello-v2.webp',
    rating: '4.6',
    reviewCount: 27,
  },
];

const merchants: (Partial<MerchantProfile> & { fabrics: Partial<Fabric>[] })[] = [
  {
    businessName: 'Hausa Fabrics Ltd',
    city: 'Kano',
    marketHub: 'Kantin Kwari Market, Kano',
    sourcingType: SourcingType.DIRECT_MILL,
    specialtyFabrics: ['Ankara'],
    fabrics: [
      {
        name: 'Royal Gold Ankara',
        category: 'Ankara',
        origin: 'Kano, Nigeria',
        imageUrl: '/images/fabric-ankara-v2.webp',
        price: 8500,
        unit: FabricUnit.YARD,
        description:
          'A richly patterned cotton wax print with royal blue and gold motifs. A striking choice for statement kaftans and occasion pieces.',
        tags: ['Cotton', 'Wax print', 'Patterned'],
      },
    ],
  },
  {
    businessName: 'Kano Textile Hub',
    city: 'Kano',
    marketHub: 'Kantin Kwari Market, Kano',
    sourcingType: SourcingType.IMPORTER,
    specialtyFabrics: ['Voile'],
    fabrics: [
      {
        name: 'Emerald Swiss Voile',
        category: 'Voile',
        origin: 'Kano, Nigeria',
        imageUrl: '/images/fabric-voile-v2.webp',
        price: 16000,
        unit: FabricUnit.YARD,
        description:
          'Lightweight voile with a luminous emerald finish and delicate embroidered texture, suited to airy formal silhouettes.',
        tags: ['Lightweight', 'Embroidered', 'Formal'],
      },
    ],
  },
  {
    businessName: 'Oshiobo Weavers',
    city: 'Iseyin',
    marketHub: 'Iseyin weaving cluster, Oyo',
    sourcingType: SourcingType.DIRECT_MILL,
    specialtyFabrics: ['Aso Oke'],
    fabrics: [
      {
        name: 'Wine Imperial Aso Oke',
        category: 'Aso Oke',
        origin: 'Nigeria',
        imageUrl: '/images/fabric-aso-oke-v2.webp',
        price: 22500,
        unit: FabricUnit.BUNDLE,
        description:
          'Handwoven ceremonial cloth in deep wine with subtle metallic threads. Traditional texture with a modern, considered finish.',
        tags: ['Handwoven', 'Ceremonial', 'Textured'],
      },
    ],
  },
  {
    businessName: 'Dalogun Silks',
    city: 'Lagos',
    marketHub: 'Balogun Market, Lagos',
    sourcingType: SourcingType.IMPORTER,
    specialtyFabrics: ['Brocade'],
    fabrics: [
      {
        name: 'Obsidian Damask Brocade',
        category: 'Brocade',
        origin: 'Lagos, Nigeria',
        imageUrl: '/images/fabric-brocade-v2.webp',
        price: 12000,
        unit: FabricUnit.YARD,
        description:
          'A dark jacquard brocade with quiet floral relief and a softly reflective finish for tailored eveningwear.',
        tags: ['Jacquard', 'Eveningwear', 'Textured'],
      },
    ],
  },
];

async function remove() {
  await dataSource.transaction(async (em) => {
    // Fabrics cascade from their sample merchants.
    const m = await em.delete(MerchantProfile, { isSample: true });
    const t = await em.delete(TailorProfile, { isSample: true });
    const s = await em.delete(Style, { isSample: true });
    console.log(`Removed ${m.affected} sample merchants (and their fabrics), ${t.affected} artisans, ${s.affected} styles.`);
  });
}

async function seed() {
  await dataSource.transaction(async (em) => {
    if (await em.exists(Style, { where: { isSample: true } })) {
      console.log('Styles already seeded — skipping.');
    } else {
      await em.save(Style, styles.map((s, i) => em.create(Style, { ...s, sortOrder: i, isSample: true })));
      console.log(`Seeded ${styles.length} styles.`);
    }

    if (await em.exists(TailorProfile, { where: { isSample: true } })) {
      console.log('Artisans already seeded — skipping.');
    } else {
      await em.save(
        TailorProfile,
        tailors.map((t) => em.create(TailorProfile, { ...t, kycStatus: KycStatus.APPROVED, isSample: true })),
      );
      console.log(`Seeded ${tailors.length} artisans.`);
    }

    if (await em.exists(MerchantProfile, { where: { isSample: true } })) {
      console.log('Merchants and fabrics already seeded — skipping.');
    } else {
      for (const { fabrics, ...merchant } of merchants) {
        const saved = await em.save(
          MerchantProfile,
          em.create(MerchantProfile, { ...merchant, verificationStatus: KycStatus.APPROVED, isSample: true }),
        );
        await em.save(
          Fabric,
          fabrics.map((f) => em.create(Fabric, { ...f, merchantId: saved.id, isSample: true })),
        );
      }
      console.log(`Seeded ${merchants.length} merchants with their fabrics.`);
    }
  });
}

await dataSource.initialize();
try {
  if (process.argv.includes('--remove')) await remove();
  else await seed();
} finally {
  await dataSource.destroy();
}
