/**
 * MerVare incentive constants. Tuned for competitive parity with
 * Mooringo (3% platform fee for early adopters) and to give marinas
 * and visiting sailors enough upside to refer the next customer.
 */
export const INCENTIVES = {
  // Founding marina: first 10 per country, 50% off subscription for life.
  FOUNDING_MARINA_SLOTS_PER_COUNTRY: 10,
  FOUNDING_MARINA_DISCOUNT_PCT: 50,

  // Marina referral: referrer gets N months free as subscription credit.
  MARINA_REFERRAL_REWARD_MONTHS: 2,

  // Booking platform fees (deducted from each booking via Stripe Connect).
  PLATFORM_FEE_STANDARD_PCT: 5,
  PLATFORM_FEE_FOUNDING_PCT: 3, // matches Mooringo for first season
  FIRST_LISTING_FEE_PCT: 0,     // 0% on first booking through a new berth

  // Cruising passport: stamp every confirmed booking, reward each milestone.
  PASSPORT_MILESTONE_INTERVAL: 5,
  PASSPORT_MILESTONE_CREDIT_CENTS: 3800, // €38 = average night across EE/FI marinas

  // Power token bundle: buy 10, get 11th free.
  POWER_BUNDLE_BUY: 10,
  POWER_BUNDLE_FREE: 1,

  // Affiliate creators / associations / brokers.
  AFFILIATE_SUBSCRIPTION_PCT: 10,
  AFFILIATE_SUBSCRIPTION_MONTHS: 12,

  // Don't issue Stripe transfers below this amount.
  PAYOUT_MINIMUM_CENTS: 100, // €1.00
};
