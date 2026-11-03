import { z } from 'zod';
import { AiOutputError } from './errors.js';
import {
  buildClassifyUserMessage,
  CLASSIFY_ALLOWED,
  CLASSIFY_MAX_INPUT_CHARS,
  CLASSIFY_SYSTEM_PROMPT,
} from './prompts.js';
import { truncate } from './retrieval.js';

/**
 * AI classification: one JSON-mode call at temperature 0. The input is only
 * subject + description (truncated) plus a few account numbers; no
 * knowledge base, since the rubric in the system prompt is all the model
 * needs to triage.
 */

// Accept small formatting slips ("royalty and payments", "HIGH") but nothing outside the allowed lists.
const canonical = (value, allowed) => {
  const key = String(value ?? '')
    .toLowerCase()
    .replace(/\band\b/g, '&')
    .replace(/[^a-z&]/g, '');
  return allowed.find((a) => a.toLowerCase().replace(/[^a-z&]/g, '') === key) ?? null;
};

const oneOf = (allowed, label) =>
  z.string().transform((value, ctx) => {
    const match = canonical(value, allowed);
    if (!match) {
      ctx.addIssue({ code: 'custom', message: `unknown ${label} "${value}"` });
      return z.NEVER;
    }
    return match;
  });

const outputSchema = z.object({
  category: oneOf(CLASSIFY_ALLOWED.categories, 'category'),
  priority: oneOf(CLASSIFY_ALLOWED.priorities, 'priority'),
  reasoning: z.string().trim().min(1).transform((s) => s.slice(0, 300)),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
});

export const parseClassification = (content) => {
  let json;
  try {
    json = JSON.parse(content);
  } catch {
    throw new AiOutputError('Classifier returned invalid JSON', { raw: content });
  }
  const result = outputSchema.safeParse(json);
  if (!result.success) {
    throw new AiOutputError(`Classifier output failed validation: ${result.error.issues.map((i) => i.message).join('; ')}`, {
      raw: content,
    });
  }
  return result.data;
};

/**
 * @param ticket { subject, description, _id? }
 * @param accountContext small object of numbers (see triage.service)
 * @returns { category, priority, reasoning, confidence, model, usage }
 * @throws AiUnavailableError (upstream) | AiOutputError (bad output)
 */
export const classifyWithAi = async (ticket, accountContext, { client }) => {
  const response = await client.complete({
    feature: 'classify',
    ticketId: ticket._id,
    json: true,
    temperature: 0,
    maxTokens: 120,
    messages: [
      { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildClassifyUserMessage({
          subject: truncate(ticket.subject, 200),
          description: truncate(ticket.description, CLASSIFY_MAX_INPUT_CHARS),
          accountContext,
        }),
      },
    ],
  });
  return { ...parseClassification(response.content), model: response.model, usage: response.usage };
};
