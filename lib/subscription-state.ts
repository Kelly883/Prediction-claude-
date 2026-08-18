import { SubscriptionStatus } from '@prisma/client';

export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  active: ['cancelled', 'expired'],
  cancelled: ['expired'],
  expired: [],
};

export function isValidSubscriptionTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return SUBSCRIPTION_TRANSITIONS[from]?.includes(to) ?? false;
}
