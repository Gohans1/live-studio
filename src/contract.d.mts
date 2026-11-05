// Types for the page, which imports the same checks the server runs (contract.mjs)
import type * as z from "zod";

export const DOC: string;
export const Sections: z.ZodType;
export const problems: (schema: z.ZodType, value: unknown, where: string) => string[];
export const checkFilm: (scene: unknown, draw: unknown) => string[];
