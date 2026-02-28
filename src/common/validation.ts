import { z } from 'zod';

export const SiteIdSchema = z.object({
  siteId: z.string().min(1),
});

export const SearchInputSchema = z.object({
  site: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional().default(5),
  postType: z.string().optional(),
});

export const ReindexInputSchema = z.object({
  site: z.string().min(1),
});

export const OllamaPromptSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  system: z.string().optional(),
  site: z.string().optional(),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;
export type ReindexInput = z.infer<typeof ReindexInputSchema>;
export type OllamaPromptInput = z.infer<typeof OllamaPromptSchema>;
