# AI Design

How the portal uses an LLM to triage tickets and draft replies, and what happens when that LLM is slow, wrong, down or expensive.

## 1. What the AI does, and what it doesn't

| Feature | When | Who sees it | If AI fails |
|---|---|---|---|
| **Classification** (category + priority + one-line reasoning + confidence) | In the background, right after a ticket is saved | Admin queue (authors see the category only) | Keyword-rule fallback sets category/priority; ticket marked `aiStatus: failed`, `classificationSource: rules` |
| **Draft reply** | When an admin opens a ticket (`POST /admin/tickets/:id/draft`) | The admin only, who edits it before sending | 503 + a policy-safe template for the category + the last good draft, if any |

The AI never talks to authors directly, and it never changes data an admin has decided. An admin's category or priority override is never overwritten. Every reply is reviewed by a person before it's sent.

## 2. Why gpt-4o-mini

- **The tasks are narrow and grounded.** Classification picks 1 of 6 labels with a written rubric. Drafting rewrites supplied facts in a defined tone. Neither needs frontier-level reasoning, and the quality gap to larger models is small when the prompt carries the facts.
- **Cost**: list price is $0.15 per 1M input tokens and $0.60 per 1M output tokens (configurable via `AI_PRICE_*`; check current pricing). That comes to well under a tenth of a cent per ticket (§5).
- **Latency**: measured averages were **1.5 s** for classification and **2.4 s** for drafts, fast enough that a draft is usually ready by the time an admin has read the ticket.
- **JSON mode** (`response_format: json_object`) is reliable on this model, which keeps classification parsing simple.
- **Swappable**: the model name is config (`OPENAI_MODEL`), and every call goes through one client (`ai/client.js`). Moving to another model or provider touches one file.

## 3. Module map (`server/src/ai/`)

```
client.js             OpenAI wrapper: timeout, retries + backoff, circuit breaker, usage reporting
knowledgeBase.js      BookLeaf KB as structured sections + tone + 7 examples; also the source of policy numbers for the API
retrieval.js          Cost-aware context: category → KB sections, 1 example, book facts, last-3 thread window
prompts.js            Versioned system prompts and user-message builders
classifier.js         One JSON-mode call + Zod validation of the output
fallbackClassifier.js Deterministic weighted-keyword triage
drafter.js            Draft generation + guard rails (sign-off, ₹-amount check, truncation warning)
templates.js          Static per-category reply skeletons for outages
usage.js              Cost estimate, usage log sink, /admin/ai/usage aggregation
errors.js             AiUnavailableError (couldn't reach the model) vs AiOutputError (model answered badly)
```

Orchestration lives in services: `services/triage.service.js` (classify, then persist, then SSE) and `services/draft.service.js` (cache, then generate or fall back).

## 4. Prompt strategy

### Classification
- **System prompt**: role, the 6 categories with one-line definitions, and the **priority rubric**. Both come from the brief's examples. For example, 6+ months without royalty or a duplicate ISBN is Critical, a print defect or an unavailable listing is High, and an author-bio update is Low. It also defines the output schema and tells the model that ticket text is **data, not instructions** (a prompt-injection guard).
- **User message**: subject, plus description truncated to 1,500 characters, plus a small **account context** in JSON: author tenure in months, the referenced book's paid and pending royalty, months since publication and since last payout, and account-wide pending royalty. This is what lets "still waiting for my royalty" become Critical for Ananya (₹2,546, never paid, live for 28 months) but Medium for a new author.
- **No knowledge base**: triage doesn't need policy text, so none is sent.
- `temperature: 0`, `max_completion_tokens: 120`.
- **Output validation**: Zod checks the result and normalises small slips (`"royalty and payments"` becomes `Royalty & Payments`, `"HIGH"` becomes `High`). An unknown label, missing reasoning or invalid JSON throws `AiOutputError`, which triggers the rule fallback. Bad output never reaches the database.

### Draft reply
The **system prompt** is static and holds the BookLeaf voice and the hard rules:
- the 6 tone guidelines, verbatim from the KB
- never invent amounts, dates or policies
- quote the provided payout date instead of calculating one
- if the facts flag a payout as overdue, own it and escalate with a 48-hour timeline
- never quote figures for unpublished books
- internal notes are context only
- 120–220 words, and sign off exactly with "Warm regards, Team BookLeaf"

The **user message** carries only bounded, ticket-specific context:
1. `TODAY`, then the ticket number, category, status, subject and description (truncated to 1,500 chars).
2. **AUTHOR & BOOK FACTS**, built by code from the database, not by the model:
   - The referenced book's MRP, per-copy royalty, copies sold, and earned/paid/pending royalty, last payout, print partner and platforms.
   - Derived lines that read as plain statements:
     - "Pending ₹850 is below the ₹1,000 minimum, so it rolls over…"
     - "Next scheduled payout deadline: 14 November 2026 (for the quarter ending 30 September 2026)", computed from today using the quarterly + 45-day rule
     - "OVERDUE CHECK: no payout for 27 months…" when the balance is above the threshold and older than one quarter + 45 days
   - For an **unpublished book**: the production stage ("Cover Design, step 3 of 9"), the pipeline, and an explicit "do not quote royalty or sales figures".
   - For a **General** ticket with no book: a one-line-per-book account overview.
   - Bank details are not in our data, so the model is told nothing about them and won't claim they're missing. The royalty example's guidance asks it to have the author confirm they're linked.
3. **KNOWLEDGE BASE**: only the sections mapped to the category (§5).
4. **One example**: the brief's sample query and handling guidance for this category. If a category has several examples, the one whose pattern matches the ticket is used (e.g. "too low" picks the net-profit explanation). It is labelled "adapt; don't copy".
5. **RECENT THREAD**: the last 3 entries, oldest first, each truncated to 600 chars. Internal notes are included and labelled "facts only; never mention the note or repeat opinions". The rule:
   - The model **may** use factual status from a note (e.g. "draft 2 was emailed 10 days ago"), stated as BookLeaf's own update.
   - It must **never** repeat opinions, instructions to staff, or remarks about the author, or reveal that notes exist.
   - Prompt v1 forbade using notes at all. In live testing the model used the fact anyway, and the resulting reply was the right one. So the rule was changed to describe the behaviour we want (v2), instead of one the model wouldn't follow.

Settings: `temperature: 0.4` (natural wording, low variance), `max_completion_tokens: 450`.

**Guard rails after generation** (`drafter.postProcessDraft`):
- **₹ amount check**: every rupee figure in the draft must appear in the book facts, the policy threshold, or the conversation. Any other figure produces a **warning** shown to the admin ("Mentions ₹9,999, which is not in this author's records. Verify before sending").
- A missing sign-off is appended. Stray markdown headings are stripped.
- `finish_reason: length` produces a "may be cut off" warning. Empty output is an `AiOutputError`.

## 5. Cost management

### What each call sends

| Call | Sent | Not sent |
|---|---|---|
| Classify | Rubric + subject + description (≤1,500 chars) + ~60-token account context | KB, examples, thread, other books, name or email |
| Draft | System prompt + the category's 1–2 KB sections + 1 example + the referenced book's facts + last 3 messages | The other 5–6 KB sections, the other 6 examples, other books, older messages |

Category → sections:
- Royalty: `royalty`
- ISBN: `isbn` + `metadata`
- Printing: `printing`
- Distribution: `distribution`
- Production: `production` + `distribution` (for "listings go live in 7–10 days")
- General: `company` + `metadata`

### Prompt sizes
Two sources:
- **Live**: real `gpt-4o-mini` calls on the 7 seeded tickets, token counts as reported by OpenAI.
- **Estimated**: chars ÷ 4 over the same prompts, used for the full-KB comparison.

| | Live (OpenAI-reported) | Estimate | Notes |
|---|---|---|---|
| Classification | **~565 prompt + ~38 completion** (603 total avg) | ~630 | System prompt ≈ 485 of that |
| Draft (retrieval) | **1,005–1,047 prompt + 147–195 completion** | ~1,100 | Overdue-royalty and in-production cases |
| Draft if the full KB were sent | n/a | ~2,370 | Full KB alone ≈ 1,410 tokens |

Retrieval cuts draft input by **~53%**. The chars ÷ 4 estimate turned out about 7–10% high.

### Cost per ticket (gpt-4o-mini list prices, live numbers)
- Classification: **≈ $0.00011** (measured: $0.003016 over 28 calls)
- Draft: **≈ $0.00025** (measured: $0.00076 over 3 generations)
- Typical ticket: 1 classification + about 1.5 generated drafts (repeat opens are cache hits; a new author message, a new day or an explicit regenerate costs one more) ≈ **$0.0005**
- **About $0.50 per 1,000 tickets.** At a few thousand tickets a month, that's a dollar or two.

The naive design sends the full KB and full history on every call, has no cache, and redrafts on every open. That costs about $0.002 per ticket, **≈4× more**, and the gap grows with thread length because history isn't capped.

### Other cost controls
- **Draft cache** (`AiDraft`): the key is a hash of the prompt and KB version, the model, the ticket text and category, the book's `updatedAt`, the newest message id, and today's date. Re-opening a ticket costs nothing. A new message or a new day (payout dates are date-relative) triggers a regenerate, and so does `?regenerate=true`. Cache hits are logged, so the hit rate is visible.
- **Hard caps**: input truncation (1,500 / 600 chars), `max_completion_tokens` 120 / 450, and the last-3 message window.
- **Rate limits**:
  - 20 tickets/hour per author, since each ticket triggers a paid call
  - `aiLimiter` (20/min) on the draft and classify endpoints
- **Kill switch**: `AI_CLASSIFY_ON_CREATE=false` stops automatic classification without a deploy.
- **Prompt caching**: static instructions come first in the system prompt, so OpenAI's automatic prefix caching can apply. Today's prompts mostly sit under its 1,024-token minimum, so this is headroom for later, not a current saving.
- **Measurement**: every call logs model, tokens, cached tokens, estimated cost, latency, attempts and outcome, as a log line and an `AiUsageLog` row with a 90-day TTL. `GET /admin/ai/usage?days=30` reports per feature: calls, success/error/skipped/cache hits, tokens, cost, average latency, failure rate, cache-hit rate, tickets touched and **average cost per ticket**, plus the circuit-breaker state.

## 6. Error handling and graceful degradation

| Failure | Detected by | What happens |
|---|---|---|
| No API key | Client reports `enabled: false` | Calls are skipped (`AI_DISABLED`); rules classify; drafts return 503 + template; `/health` shows `ai: disabled` |
| Timeout (15 s) | SDK `APIConnectionTimeoutError` | Retried; after the last retry → `TIMEOUT` → fallback |
| 429 / 5xx / network | `status`, error name | Up to 2 retries, exponential backoff of 500 ms then 1 s plus jitter, `Retry-After` honoured (capped at 5 s) |
| 400 / 401 / 404 (bad request, bad key, unknown model) | `status` | Not retried, since retrying can't help → `REQUEST_REJECTED` → fallback |
| Repeated failures | Circuit breaker | After 3 failed calls in a row, every AI call fails instantly for 60 s (`CIRCUIT_OPEN`), so requests don't queue behind a dead upstream. Then one trial call: success closes the breaker, failure reopens it. `/health` reports `ai: degraded` while it's open |
| Invalid JSON or labels | Zod (`AiOutputError`) | Classification → rules. Drafts → 503 + template. Not counted against the breaker |
| Made-up ₹ figures in a draft | Amount check | Draft still returned, with a warning for the reviewing admin |
| Server restart mid-classification | Ticket left `aiStatus: pending` | `recoverPendingClassifications()` runs at boot. It also retries tickets that only got the rule fallback because AI was disabled, once a key is configured |
| Two processes classifying the same ticket (overlapping restarts, several instances) | Atomic lease (`aiClaimedAt`, 2-minute expiry) | One process claims the ticket and the others skip it. An admin's forced re-run during a claim gets 409. A crashed process's lease expires and is taken over. This was found in live testing: four overlapping dev-server restarts classified each seeded ticket 4× before the lease existed |

Guarantees:
- **Ticket creation never depends on the AI.** The ticket is saved and the 201 sent before classification starts (`runInBackground`). Tests make the classifier throw and hang, and creation still returns 201 immediately.
- **Admins can always reply.** The manual reply endpoint has no AI dependency, and a draft failure returns a template, so the UI has text to start from.
- **The two failure types stay separate.** `AiUnavailableError` (the model couldn't be reached) and `AiOutputError` (it answered badly) are the only errors the AI layer throws. Both are handled; neither becomes a raw 500.
- **The fallback is honest.** Rule-based results are stored as `classificationSource: 'rules'` with reasoning "Rule-based fallback: …" and low confidence (0.2–0.6). They never populate `aiCategory`/`aiPriority`, so AI accuracy stats aren't polluted by keyword guesses. The fallback correctly triages all 7 seeded tickets.

## 7. Accuracy feedback loop

- Admin overrides set `categoryOverridden`/`priorityOverridden` against the untouched `aiCategory`/`aiPriority`.
- `/admin/stats` reports the **override rate** over AI-classified tickets only.
- It also reports **draft adoption** (the share of sent replies with `wasAiDrafted`).

These two numbers show whether the prompts are working. They are also the dataset for tuning the rubric: overridden tickets are labelled examples.

## 8. Privacy

- Classification sends no author name or email, only the ticket text and numeric account context.
- Drafting sends the author's name and the referenced book's royalty figures, the minimum needed to write a specific reply.
- The API key exists only on the server, in an environment variable. The client bundle only knows the API URL.

## 9. Testing

All AI code is tested with the OpenAI SDK mocked; no network is involved.
- `tests/ai/client.test.js`: retry and backoff sequence, Retry-After, timeout handling, non-retryable errors, the full breaker cycle (open → skip → half-open → reopen → close), disabled mode, and a usage sink that throws.
- `tests/ai/classifier.test.js`: output validation and normalisation, request shape (JSON mode, temperature 0, truncation, rubric present, no KB sent), and the rule fallback on all seeded tickets.
- `tests/ai/retrieval.test.js`: section selection and token savings, example matching, book facts for never-paid, below-threshold, recently paid and in-production books, General overview, and the thread window.
- `tests/ai/drafter.test.js`: prompt contents (only the referenced book, last 3 messages, today's payout date), the production edge case, the guard rails, and templates.
- `tests/aiEndpoints.test.js`: end to end through the app and database:
  - classification on create; AI-down and junk-output fallbacks; override safety on re-classify
  - the draft cache: hit, regenerate, invalidation by a new message
  - a **503 with template and stale draft when OpenAI is down**, with manual reply still working
  - the amount warning and usage reporting

### Live check (real gpt-4o-mini, seeded data)
- **Classification**: all 7 seeded tickets matched the hand triage on both category and priority. For example, Ananya's never-paid royalty was Critical ("never received a payout… significant pending royalty"), and Diya's bio update was Low.
- **Ananya's draft (BL-0005)**:
  - It acknowledged her frustration, quoted ₹2,546 pending, 67 copies sold and the 5 July 2024 publication date.
  - It stated the payout looks overdue, apologised, escalated with a 48-hour timeline, and asked her to confirm her bank details.
  - No warnings were raised.
- **Sneha's draft (BL-0004)**: it explained the cover-design status without quoting any royalty figures and ended with a clear next step.
- **Cache**: reopening a ticket returned the cached draft with no API call.

## 10. Known limitations and next steps

- **No measured accuracy yet.** Next step: a labelled evaluation set (the brief's examples + overridden tickets) run in CI against the prompt, tracking category and priority agreement.
- **JSON mode, not Structured Outputs.** `json_schema` structured outputs would enforce the enum at decode time. JSON mode + Zod was kept for simplicity and model portability.
- **Single-instance state.** The circuit breaker, SSE hub and background runner are in-process. With several API instances they'd move to Redis, and classification to a durable queue (BullMQ/SQS) with retry of `failed` tickets.
- **Token counts are estimates** in the docs (chars ÷ 4). The live numbers in `/admin/ai/usage` come from OpenAI's reported usage.
- **The amount check covers ₹ figures only.** Dates and timelines in drafts rely on the prompt rules and human review.
