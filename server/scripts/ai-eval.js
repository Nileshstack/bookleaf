/**
 * QA phase 2: real-model evaluation (uses OPENAI_API_KEY from server/.env).
 *
 *   npm run eval:ai
 *
 * - Classifies 17 realistic tickets covering all 6 categories and 4
 *   priorities, through the real triage path (account context included),
 *   and scores them against the expected labels.
 * - Generates 10 drafts (royalty, ISBN, printing, distribution,
 *   production, below-threshold, General / no book) and checks each against
 *   knowledge-base policy, the author's real numbers, tone and sign-off.
 * - Records the exact prompts sent and the token usage per call.
 *
 * Runs on an in-memory MongoDB seeded with the provided dataset, so it never
 * touches your real database. Cost: well under $0.01 per run.
 * Writes qa/ai-eval-results.json, qa/ai-drafts.md and qa/prompt-samples.md.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = mongod.getUri('bookleaf_ai_eval');
process.env.JWT_SECRET = 'eval-only-secret-that-is-long-enough-32';
process.env.AI_CLASSIFY_ON_CREATE = 'false';

const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { aiClient } = await import('../src/ai/index.js');
const { AiUsageLog, Book, Ticket, TicketMessage, User } = await import('../src/models/index.js');
const { seedDatabase } = await import('../src/seed/seed.js');
const { classifyTicket } = await import('../src/services/triage.service.js');
const { getDraft } = await import('../src/services/draft.service.js');
const { estimateCostUsd } = await import('../src/ai/usage.js');
const { classifyWithRules } = await import('../src/ai/fallbackClassifier.js');

if (!aiClient.enabled) {
  console.error('OPENAI_API_KEY is not set in server/.env; nothing to evaluate.');
  process.exit(1);
}

const OUT = new URL('../../qa/', import.meta.url);
await mkdir(OUT, { recursive: true });
await connectDB();
await seedDatabase();

// A client that records exactly what is sent, so the report can show the prompts.
const sent = [];
const recordingClient = {
  model: aiClient.model,
  enabled: true,
  complete: async (args) => {
    sent.push({ feature: args.feature, messages: args.messages, temperature: args.temperature, maxTokens: args.maxTokens });
    return aiClient.complete(args);
  },
};

const author = async (code) => User.findOne({ authorCode: code }).lean();
const bookOf = async (code) => (code ? Book.findOne({ bookId: code }).lean() : null);
const newTicket = async ({ authorCode, bookCode, subject, description }) => {
  const a = await author(authorCode);
  const b = await bookOf(bookCode);
  return Ticket.create({ authorId: a._id, bookId: b?._id ?? null, subject, description });
};

// ---------------------------------------------------------------------------
// 1. Classification
// ---------------------------------------------------------------------------
const CASES = [
  ['AUTH003', 'BK005', "Haven't received royalty", "I haven't received any royalty for 6 months. My book is selling but nothing has been paid to me.", 'Royalty & Payments', 'Critical'],
  ['AUTH002', 'BK003', 'ISBN mismatch', 'My ISBN on Amazon differs from the printed copy. Readers are confused whether it is the same book.', 'ISBN & Metadata Issues', 'High'],
  ['AUTH004', 'BK006', 'Terrible print quality', 'Print quality is terrible, blurry images and the pages are misaligned in my author copies.', 'Printing & Quality', 'High'],
  ['AUTH008', 'BK014', 'Currently unavailable', 'My book shows Currently Unavailable on Amazon India. People cannot buy it.', 'Distribution & Availability', 'High'],
  ['AUTH009', 'BK015', 'Still in typesetting', 'It has been 3 weeks and my book is in typesetting. When will it move to the next stage?', 'Book Status & Production Updates', 'Medium'],
  ['AUTH010', null, 'Author bio', 'Can I update my author bio? It still mentions my old job.', 'General Inquiry', 'Low'],
  ['AUTH002', 'BK004', 'Royalty too low', 'My royalty seems too low, I sold 200 copies and got Rs 3000. That does not match what I expected.', 'Royalty & Payments', 'High'],
  ['AUTH005', 'BK008', 'Duplicate ISBN', 'Two different books are showing the same ISBN on Amazon, mine and someone else\'s. The wrong book is linked to my ISBN.', 'ISBN & Metadata Issues', 'Critical'],
  ['AUTH001', 'BK001', 'Next payout date', 'When is the next royalty payout date for Whispers of the Ganges?', 'Royalty & Payments', 'Medium'],
  ['AUTH009', 'BK015', 'Launch next Friday', 'My launch event is next Friday and the book is still in production. I urgently need to know if it will be printed in time.', 'Book Status & Production Updates', 'High'],
  ['AUTH004', 'BK007', 'Binding coming apart', 'The binding is coming apart on 10 of my author copies of The Last Monsoon and some pages are missing. I have a book signing in 3 days.', 'Printing & Quality', 'High'],
  ['AUTH001', null, 'Change bank account', 'How do I change the bank account my royalties are paid into? I switched banks last month.', 'Royalty & Payments', 'Medium'],
  ['AUTH007', 'BK011', 'Thank you', 'Just wanted to share some feedback: the team was lovely to work with and the cover looks great. Thank you!', 'General Inquiry', 'Low'],
  ['AUTH006', 'BK010', 'Pirated copy', 'Someone has uploaded a pirated PDF of my book Turban Tales on a website and is selling it. This is copyright infringement.', 'General Inquiry', 'Critical'],
  ['AUTH001', null, 'Account compromised', "I can't log into my dashboard and someone changed my account email without my permission.", 'General Inquiry', 'Critical'],
  ['AUTH010', null, 'Packages question', 'What is the difference between the Standard Free and Bestseller Breakthrough packages?', 'General Inquiry', 'Low'],
  ['AUTH005', 'BK008', 'Out of stock on Flipkart', 'My book has shown out of stock on Flipkart since last week, but it is available on the BookLeaf Store.', 'Distribution & Availability', 'High'],
];

const classification = [];
for (const [authorCode, bookCode, subject, description, expCat, expPri] of CASES) {
  const t = await newTicket({ authorCode, bookCode, subject, description });
  const result = await classifyTicket(t._id, { client: recordingClient });
  classification.push({
    input: description,
    author: authorCode,
    book: bookCode ?? 'General',
    expected: { category: expCat, priority: expPri },
    actual: { category: result.aiCategory ?? result.category, priority: result.aiPriority ?? result.priority, source: result.classificationSource, confidence: result.aiConfidence, reasoning: result.aiReasoning },
    categoryPass: (result.aiCategory ?? result.category) === expCat,
    priorityPass: (result.aiPriority ?? result.priority) === expPri,
    // What the keyword fallback would have said if the AI were down.
    rules: (({ category, priority }) => ({ category, priority, pass: category === expCat && priority === expPri }))(classifyWithRules({ subject, description })),
  });
}
const pct = (n) => Math.round((n / classification.length) * 1000) / 10;
const accuracy = {
  category: pct(classification.filter((c) => c.categoryPass).length),
  priority: pct(classification.filter((c) => c.priorityPass).length),
  both: pct(classification.filter((c) => c.categoryPass && c.priorityPass).length),
  rulesFallbackBoth: pct(classification.filter((c) => c.rules.pass).length),
  rulesFallbackCategory: pct(classification.filter((c) => c.rules.category === c.expected.category).length),
};

// ---------------------------------------------------------------------------
// 2. Drafts
// ---------------------------------------------------------------------------
const draftCases = [
  { name: 'Priya: pending royalty on Whispers of the Ganges', create: ['AUTH001', 'BK001', 'Pending royalty', 'My dashboard shows royalty pending for Whispers of the Ganges. How much is pending and when will it be paid?'], must: [/342/, /11,970/, /8,400/, /3,570/], avoid: [] },
  { name: 'Ananya: never paid (seeded BL-0005)', ref: 'BL-0005', must: [/2,546/, /48 hours/i, /(apolog|sorry)/i], avoid: [] },
  { name: 'Rohit: ISBN mismatch (seeded BL-0006)', ref: 'BL-0006', must: [/production team/i, /48 hours/i], avoid: [/overdue|payout/i] },
  { name: 'Vikram: print defects (seeded BL-0003)', ref: 'BL-0003', must: [/photo/i, /(free|no cost|no charge).*reprint|reprint.*(free|no cost)/i, /5.7 business days/i], avoid: [/overdue|payout/i] },
  { name: 'Farhan: unavailable on Amazon (seeded BL-0007)', ref: 'BL-0007', must: [/re-?sync/i, /24\D{1,4}48 hours/i], avoid: [/overdue|payout/i] },
  { name: 'Sneha: book in production (seeded BL-0004)', ref: 'BL-0004', must: [/cover design/i], avoid: [/₹/] },
  { name: 'Rohit: royalty seems too low (80/20, net profit)', create: ['AUTH002', 'BK004', 'Royalty seems too low', 'My royalty seems too low, I sold 200 copies and got Rs 3000. How is it calculated?'], must: [/80/, /net profit|MRP minus|printing cost/i, /breakdown/i], avoid: [] },
  { name: 'Kavita: Rs 850 below the Rs 1,000 minimum', create: ['AUTH009', 'BK016', 'Why no payout yet?', 'The Nagpur Notebooks has royalty pending but I have never been paid. Why?'], must: [/850/, /1,000/, /roll/i, /quarter/i], avoid: [] },
  { name: 'Diya: General query, author bio (no book)', create: ['AUTH010', null, 'Update my author bio', 'Can I update my author bio on Amazon after my book is live?'], must: [/3.5 business days/i, /dashboard|email/i], avoid: [] },
  { name: 'Arjun: payout question with no book selected', create: ['AUTH006', null, 'When will I get paid?', 'I have not received any royalty yet. When will I get my first payment?'], must: [/45 days|quarter/i], avoid: [] },
];

const drafts = [];
for (const c of draftCases) {
  let ref = c.ref;
  if (!ref) {
    // Production classifies on create; do the same before drafting.
    const t = await newTicket({ authorCode: c.create[0], bookCode: c.create[1], subject: c.create[2], description: c.create[3] });
    await classifyTicket(t._id, { client: recordingClient });
    ref = t.ticketNumber;
  }
  const ticket = await Ticket.findOne({ ticketNumber: ref }).lean();
  const a = await User.findById(ticket.authorId).lean();
  const firstName = a.name.split(' ')[0];
  const draft = await getDraft(null, ref, { regenerate: true, client: recordingClient });
  const text = draft.draftText;
  const body = text.replace(/\s*Warm regards,?\s*\n\s*Team BookLeaf\s*$/i, '');
  const firstSentence = body.split('\n').filter(Boolean)[1] ?? '';
  const closing = body.trim().split(/\n\s*\n/).slice(-2).join('\n');
  const checks = {
    greeting: new RegExp(`^Hi ${firstName},`).test(text),
    signedTeamBookLeaf: /Warm regards,?\s*\n\s*Team BookLeaf\s*$/.test(text),
    acknowledgesFirst: /(thank|understand|sorry|apolog|appreciate|frustrat|concern)/i.test(firstSentence),
    nextStep: /(will|please|let us know|reply|reach out|next step|within|expect|share|send|feedback)/i.test(closing),
    noUnverifiedFacts: draft.warnings.length === 0, // amount and date guards
    policyFacts: c.must.every((re) => re.test(text)),
    avoids: c.avoid.every((re) => !re.test(text)),
  };
  drafts.push({ name: c.name, ticket: ref, sections: draft.context.sections, example: draft.context.exampleId, checks, pass: Object.values(checks).every(Boolean), missing: c.must.filter((re) => !re.test(text)).map(String), warnings: draft.warnings, text });
}

// ---------------------------------------------------------------------------
// 3. Usage and prompts
// ---------------------------------------------------------------------------
await new Promise((r) => setTimeout(r, 500)); // usage rows are written fire-and-forget
const rows = await AiUsageLog.find({ outcome: 'success' }).lean();
const usage = (feature) => {
  const r = rows.filter((x) => x.feature === feature);
  const avg = (k) => Math.round(r.reduce((s, x) => s + x[k], 0) / (r.length || 1));
  return {
    calls: r.length,
    avgPromptTokens: avg('promptTokens'),
    avgCompletionTokens: avg('completionTokens'),
    avgLatencyMs: avg('latencyMs'),
    avgCostUsd: Number((r.reduce((s, x) => s + estimateCostUsd(x), 0) / (r.length || 1)).toFixed(6)),
    perCall: r.map((x) => ({ prompt: x.promptTokens, completion: x.completionTokens, latencyMs: x.latencyMs })),
  };
};
const cost = { classify: usage('classify'), draft: usage('draft') };
cost.perTicketUsd = Number((cost.classify.avgCostUsd + 1.5 * cost.draft.avgCostUsd).toFixed(6));
cost.per1000TicketsUsd = Number((cost.perTicketUsd * 1000).toFixed(2));

const redact = (s) => s.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***REDACTED***');
const sampleClassify = sent.find((s) => s.feature === 'classify');
const threadEntries = (user) => (user.split('RECENT THREAD')[1].match(/^\[/gm) ?? []).length;
const draftUsers = sent.filter((s) => s.feature === 'draft').map((s) => s.messages[1].content);
// The richest sample: the draft prompt with the longest thread.
const sampleDraft = sent.filter((s) => s.feature === 'draft').sort((a, b) => threadEntries(b.messages[1].content) - threadEntries(a.messages[1].content))[0];
const kbAll = ['Company overview', 'Royalty policy', 'ISBN policy', 'Metadata and listing updates', 'Printing and quality', 'Distribution and availability', 'Production stages'];
const draftUser = sampleDraft.messages[1].content;
const scope = {
  classifyIncludesKb: kbAll.some((t) => sampleClassify.messages.map((m) => m.content).join('\n').includes(`## ${t}`)),
  sampleDraftSectionsIncluded: kbAll.filter((t) => draftUser.includes(`## ${t}`)),
  sampleDraftSectionsExcluded: kbAll.filter((t) => !draftUser.includes(`## ${t}`)),
  sampleDraftThreadEntries: threadEntries(draftUser),
  maxSectionsInAnyDraft: Math.max(...draftUsers.map((u) => kbAll.filter((t) => u.includes(`## ${t}`)).length)),
  maxThreadEntriesInAnyDraft: Math.max(...draftUsers.map(threadEntries)),
};

await writeFile(new URL('ai-eval-results.json', OUT), `${JSON.stringify({ model: aiClient.model, accuracy, classification, drafts: drafts.map(({ text, ...d }) => d), cost, scope }, null, 2)}\n`);
await writeFile(
  new URL('ai-drafts.md', OUT),
  `# AI drafts generated during QA (${aiClient.model})\n\n${drafts
    .map((d) => `## ${d.name} (${d.ticket}) ${d.pass ? '✅' : '❌'}\n\nSections: ${d.sections.join(', ')} · example: ${d.example}${d.missing.length ? ` · **missing:** ${d.missing.join(', ')}` : ''}${d.warnings.length ? ` · warnings: ${d.warnings.join('; ')}` : ''}\n\n\`\`\`text\n${d.text}\n\`\`\`\n`)
    .join('\n')}`,
);
await writeFile(
  new URL('prompt-samples.md', OUT),
  `# Exact prompts sent (API key never appears in prompts; redaction applied anyway)\n\n## Classification (${sampleClassify.messages.reduce((n, m) => n + m.content.length, 0)} chars, temperature ${sampleClassify.temperature}, max ${sampleClassify.maxTokens} tokens, JSON mode)\n\n${sampleClassify.messages.map((m) => `### ${m.role}\n\n\`\`\`text\n${redact(m.content)}\n\`\`\``).join('\n\n')}\n\n## Draft (${sampleDraft.messages.reduce((n, m) => n + m.content.length, 0)} chars, temperature ${sampleDraft.temperature}, max ${sampleDraft.maxTokens} tokens)\n\n${sampleDraft.messages.map((m) => `### ${m.role}\n\n\`\`\`text\n${redact(m.content)}\n\`\`\``).join('\n\n')}\n`,
);

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------
console.log('\nCLASSIFICATION');
console.table(classification.map((c) => ({ input: c.input.slice(0, 48), expected: `${c.expected.category} / ${c.expected.priority}`, actual: `${c.actual.category} / ${c.actual.priority}`, result: c.categoryPass && c.priorityPass ? 'PASS' : `FAIL${c.categoryPass ? '' : ' cat'}${c.priorityPass ? '' : ' pri'}` })));
console.log('accuracy %', accuracy);
console.log('\nDRAFTS');
console.table(drafts.map((d) => ({ draft: d.name.slice(0, 46), ...Object.fromEntries(Object.entries(d.checks).map(([k, v]) => [k, v ? 'ok' : 'FAIL'])) })));
console.log('drafts passing all checks:', `${drafts.filter((d) => d.pass).length}/${drafts.length}`);
console.log('\nCOST', JSON.stringify({ classify: { ...cost.classify, perCall: undefined }, draft: { ...cost.draft, perCall: undefined }, perTicketUsd: cost.perTicketUsd, per1000TicketsUsd: cost.per1000TicketsUsd }));
console.log('SCOPE', JSON.stringify(scope));

await disconnectDB();
await mongod.stop();
