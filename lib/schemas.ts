import { z } from 'zod';

// Centralized so routes stay thin and validation rules aren't duplicated/
// drifted between similar endpoints.

export const RegisterSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  phone: z.string().min(5).max(32),
  password: z.string().min(8).max(200),
  country: z.string().min(2).max(56),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const CreatePlanSchema = z.object({
  name: z.string().min(1).max(120),
  durationDays: z.number().int().positive(),
  priceNGN: z.number().positive(),
  priceUSDOverride: z.number().positive().optional(),
  fxMarkupPercent: z.number().min(0).max(100).optional(),
  categoryIds: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

export const UpdatePlanSchema = CreatePlanSchema.partial();

export const CmsSectionUpdateSchema = z.object({
  key: z.string().min(1).max(120),
  content: z.object({ heading: z.string().max(200).optional(), body: z.string().max(10000).optional() }),
});

export const InitializePaymentSchema = z.object({
  planId: z.string().uuid(),
  provider: z.enum(['paystack', 'flutterwave']).optional(),
});

export const UpdatePredictionSchema = z.object({
  title: z.string().min(1).optional(),
  scheduledAt: z.string().datetime().optional(),
  categoryIds: z.array(z.string()).optional(),
  bookingCode: z.string().min(1).optional(),
  bodyNotes: z.string().optional(),
  visibility: z.enum(['plan_specific', 'subscribers', 'free_window']).optional(),
  freeUntil: z.string().datetime().nullable().optional(),
  planIds: z.array(z.string()).optional(),
  status: z.enum(['draft', 'scheduled', 'published', 'archived']).optional(),
});

export const CsvConfirmSchema = z.object({
  title: z.string().min(1),
  categoryIds: z.array(z.string()).default([]),
  visibility: z.enum(['plan_specific', 'subscribers', 'free_window']),
  planIds: z.array(z.string()).default([]),
  freeUntil: z.string().datetime().optional(),
  publishNow: z.boolean().default(false),
  bookingCode: z.string().min(1),
  rows: z.array(
    z.object({ line: z.number(), date: z.string(), time: z.string(), matches: z.string(), prediction: z.string(), bookingCode: z.string() }),
  ).min(1),
});

export const TwoFactorVerifySchema = z.object({ code: z.string().length(6) });

export const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().min(5).max(32).nullable().optional(),
});

export const FreeAccessRuleSchema = z.object({
  type: z.enum(['global_trial', 'promo_window']),
  trialDays: z.number().int().positive().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  isActive: z.boolean().optional(),
}).refine(
  (d) => (d.type === 'global_trial' ? !!d.trialDays : !!d.startAt && !!d.endAt),
  { message: 'global_trial requires trialDays; promo_window requires startAt and endAt' },
);

export const ComplimentaryAccessSchema = z.object({
  userId: z.string().uuid(),
  postId: z.string().uuid().nullable().optional(), // null/omitted = full access grant, not scoped to one post
  expiresAt: z.string().datetime().nullable().optional(),
});

/** Turns a ZodError into the same { error } shape every route already returns. */
export function formatZodError(err: z.ZodError): string {
  return err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
}
