/**
 * Fabric checkout delivery pricing.
 *
 * The platform handles fabric logistics through its partner, so this fee is charged to
 * the buyer and retained by IPILE. It is not a merchant or artisan payout.
 *
 * Each merchant is a separate shipment: fabrics from the same merchant ship together,
 * while fabrics from different merchants are priced and shipped separately.
 */

export const FABRIC_DELIVERY_RULES = {
  currency: 'NGN',
  intraStateFee: 2_000,
  interStateBaseFee: 5_000,
  /** A rough state-centroid distance band, used until route-level quotes are available. */
  farDistanceKm: 500,
  farDistanceSurcharge: 2_000,
  valueTiers: [
    { above: 300_000, surcharge: 5_000 },
    { above: 100_000, surcharge: 2_000 },
  ],
} as const;

type Coordinates = readonly [latitude: number, longitude: number];

/** Approximate state centres. Used only to choose the near/far interstate band. */
const STATE_CENTRES: Record<string, Coordinates> = {
  Abia: [5.45, 7.35],
  Adamawa: [9.33, 12.5],
  'Akwa Ibom': [5.06, 7.93],
  Anambra: [6.2, 7.07],
  Bauchi: [10.3, 9.8],
  Bayelsa: [4.92, 6.26],
  Benue: [7.73, 8.78],
  Borno: [11.83, 13.15],
  'Cross River': [6.3, 8.5],
  Delta: [5.51, 6.1],
  Ebonyi: [6.27, 8.11],
  Edo: [6.34, 6.02],
  Ekiti: [7.67, 5.23],
  Enugu: [6.44, 7.55],
  FCT: [9.08, 7.4],
  Gombe: [10.28, 11.15],
  Imo: [5.49, 7.03],
  Jigawa: [12.05, 9.55],
  Kaduna: [10.52, 7.73],
  Kano: [12.0, 8.52],
  Katsina: [12.99, 7.6],
  Kebbi: [11.5, 4.65],
  Kogi: [7.8, 7.03],
  Kwara: [8.5, 4.55],
  Lagos: [6.52, 3.38],
  Nasarawa: [8.5, 7.5],
  Niger: [9.63, 6.47],
  Ogun: [7.15, 3.35],
  Ondo: [7.25, 5.15],
  Osun: [7.56, 4.28],
  Oyo: [7.38, 3.93],
  Plateau: [9.22, 8.92],
  Rivers: [4.98, 7.0],
  Sokoto: [12.31, 5.2],
  Taraba: [8.0, 10.77],
  Yobe: [11.75, 11.25],
  Zamfara: [12.23, 6.0],
};

const STATE_ALIASES: Record<string, string> = {
  abuja: 'FCT',
  fct: 'FCT',
  'federal capital territory': 'FCT',
  'river state': 'Rivers',
  'lagos state': 'Lagos',
  'kano state': 'Kano',
};

/** City fallback for profiles saved before state was part of KYC. */
export const CITY_TO_STATE: Record<string, string> = {
  abakaliki: 'Ebonyi',
  aba: 'Abia',
  abeokuta: 'Ogun',
  adoekiti: 'Ekiti',
  'ado ekiti': 'Ekiti',
  agbor: 'Delta',
  akure: 'Ondo',
  asaba: 'Delta',
  awka: 'Anambra',
  bauchi: 'Bauchi',
  benincity: 'Edo',
  'benin city': 'Edo',
  birninkebbi: 'Kebbi',
  'birnin kebbi': 'Kebbi',
  calabar: 'Cross River',
  damaturu: 'Yobe',
  enugu: 'Enugu',
  gombe: 'Gombe',
  ibadan: 'Oyo',
  ife: 'Osun',
  ikeja: 'Lagos',
  ijebuode: 'Ogun',
  'ijebu ode': 'Ogun',
  ilorin: 'Kwara',
  ikoyi: 'Lagos',
  iseyin: 'Oyo',
  jalingo: 'Taraba',
  jos: 'Plateau',
  kaduna: 'Kaduna',
  kano: 'Kano',
  katsina: 'Katsina',
  kebbi: 'Kebbi',
  lagos: 'Lagos',
  lafia: 'Nasarawa',
  lokoja: 'Kogi',
  maiduguri: 'Borno',
  makurdi: 'Benue',
  minna: 'Niger',
  owerri: 'Imo',
  oyogun: 'Ogun',
  'port harcourt': 'Rivers',
  portharcourt: 'Rivers',
  sapele: 'Delta',
  sokoto: 'Sokoto',
  surulere: 'Lagos',
  ughelli: 'Delta',
  uyo: 'Akwa Ibom',
  warri: 'Delta',
  yaba: 'Lagos',
  yola: 'Adamawa',
  yenagoa: 'Bayelsa',
  zamfara: 'Zamfara',
};

function normalize(value: string | null | undefined): string | null {
  const clean = value
    ?.trim()
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+state$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;
  if (STATE_ALIASES[clean]) return STATE_ALIASES[clean];
  const matches = Object.keys(STATE_CENTRES).filter((state) => state.toLowerCase() === clean);
  return matches[0] ?? null;
}

/** State from KYC, falling back to a known city for profiles that predate the state field. */
export function resolveNigerianState(state: string | null | undefined, city: string | null | undefined): string | null {
  return normalize(state) ?? CITY_TO_STATE[(city ?? '').trim().toLowerCase()] ?? normalize(city);
}

function distanceKm(from: Coordinates, to: Coordinates): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const [lat1, lon1] = from;
  const [lat2, lon2] = to;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface FabricShipmentInput {
  merchantId: string;
  /** Line totals for this merchant's fabrics in the order. */
  subtotal: number;
  originState?: string | null;
  originCity?: string | null;
}

export interface PricedFabricShipment extends FabricShipmentInput {
  band: 'intra_state' | 'inter_state';
  amount: number;
  distanceKm: number | null;
  far: boolean;
  valueSurcharge: number;
}

export interface FabricDeliveryQuoteInput {
  destinationState?: string | null;
  destinationCity?: string | null;
  shipments: FabricShipmentInput[];
}

export interface FabricDeliveryQuote {
  deliveryFee: number;
  currency: 'NGN';
  shipments: PricedFabricShipment[];
}

export function priceFabricShipment(
  shipment: FabricShipmentInput,
  destinationState: string | null,
): PricedFabricShipment {
  const origin = resolveNigerianState(shipment.originState, shipment.originCity);
  const valueSurcharge = FABRIC_DELIVERY_RULES.valueTiers
    .filter((tier) => shipment.subtotal > tier.above)
    .reduce((sum, tier) => sum + tier.surcharge, 0);

  if (origin && destinationState && origin === destinationState) {
    return {
      ...shipment,
      band: 'intra_state',
      amount: FABRIC_DELIVERY_RULES.intraStateFee,
      distanceKm: 0,
      far: false,
      valueSurcharge: 0,
    };
  }

  const from = origin ? STATE_CENTRES[origin] : undefined;
  const to = destinationState ? STATE_CENTRES[destinationState] : undefined;
  const km = from && to ? Math.round(distanceKm(from, to)) : null;
  const far = km !== null && km > FABRIC_DELIVERY_RULES.farDistanceKm;

  return {
    ...shipment,
    band: 'inter_state',
    amount:
      FABRIC_DELIVERY_RULES.interStateBaseFee +
      (far ? FABRIC_DELIVERY_RULES.farDistanceSurcharge : 0) +
      valueSurcharge,
    distanceKm: km,
    far,
    valueSurcharge,
  };
}

/** Sums one fee per merchant shipment. IPILE keeps the result as logistics revenue. */
export function quoteFabricDelivery(input: FabricDeliveryQuoteInput): FabricDeliveryQuote {
  const destination = resolveNigerianState(input.destinationState, input.destinationCity);
  const shipments = input.shipments.map((shipment) => priceFabricShipment(shipment, destination));
  return {
    deliveryFee: shipments.reduce((sum, shipment) => sum + shipment.amount, 0),
    currency: FABRIC_DELIVERY_RULES.currency,
    shipments,
  };
}
