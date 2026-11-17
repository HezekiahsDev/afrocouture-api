import { describe, expect, it } from 'vitest';
import { priceFabricShipment, quoteFabricDelivery, resolveNigerianState } from './fabric-delivery-fee.js';

const shipment = (subtotal: number, originState: string, originCity: string | null = null) => ({
  merchantId: 'merchant-1',
  subtotal,
  originState,
  originCity,
});

describe('fabric delivery pricing', () => {
  it('resolves KYC state and falls back to a known city', () => {
    expect(resolveNigerianState('Lagos State', null)).toBe('Lagos');
    expect(resolveNigerianState(null, 'Kano')).toBe('Kano');
    expect(resolveNigerianState(null, 'Abuja')).toBe('FCT');
    expect(resolveNigerianState(null, 'Unknown town')).toBeNull();
  });

  it('charges ₦2,000 within a state', () => {
    const priced = priceFabricShipment(shipment(50_000, 'Lagos'), 'Lagos');
    expect(priced).toMatchObject({ band: 'intra_state', amount: 2_000, far: false, valueSurcharge: 0 });
  });

  it('charges ₦5,000 for a nearby interstate shipment', () => {
    const priced = priceFabricShipment(shipment(50_000, 'Ogun'), 'Lagos');
    expect(priced.band).toBe('inter_state');
    expect(priced.far).toBe(false);
    expect(priced.amount).toBe(5_000);
  });

  it('adds ₦2,000 for a far interstate band', () => {
    const priced = priceFabricShipment(shipment(50_000, 'Kano'), 'Lagos');
    expect(priced.far).toBe(true);
    expect(priced.amount).toBe(7_000);
  });

  it('adds value tiers cumulatively', () => {
    expect(priceFabricShipment(shipment(120_000, 'Kano'), 'Lagos').amount).toBe(9_000);
    expect(priceFabricShipment(shipment(310_000, 'Kano'), 'Lagos').amount).toBe(14_000);
  });

  it('does not apply value tiers to intra-state shipments', () => {
    expect(priceFabricShipment(shipment(310_000, 'Lagos'), 'Lagos').amount).toBe(2_000);
  });

  it('sums one fee per merchant shipment', () => {
    const quote = quoteFabricDelivery({
      destinationState: 'Lagos',
      shipments: [
        shipment(50_000, 'Lagos'),
        { ...shipment(50_000, 'Kano'), merchantId: 'merchant-2' },
      ],
    });
    expect(quote.deliveryFee).toBe(9_000);
    expect(quote.shipments).toHaveLength(2);
  });
});
