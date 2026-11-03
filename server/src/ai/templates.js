/**
 * Static reply skeletons for when the AI is unavailable. They follow the
 * tone guidelines (acknowledge, be specific, timeline, next step) and
 * contain only policy facts. [Brackets] mark what the admin must fill in, so
 * nothing unverified goes out by accident.
 */

const BODIES = {
  'Royalty & Payments':
    "Thank you for raising this, and I'm sorry for any worry it has caused. Royalties are calculated every quarter and paid within 45 days of the quarter ending, by bank transfer to the account linked in your dashboard. Balances below ₹1,000 roll over to the next quarter.\n\nFor [book title], our records show [earned / paid / pending figures]. [Explain the status, or: this looks overdue, which is on us. I've escalated it to our finance team and we'll come back to you within 48 hours.]\n\nNext step: [what the author should do, e.g. confirm bank details are linked in the dashboard].",
  'ISBN & Metadata Issues':
    "Thank you for flagging this. An ISBN or listing data error is serious, and we treat it as a high priority. I've escalated it to our production team, who will investigate and come back to you within 48 hours.\n\n[Any specifics: which listing, which ISBN is correct.]\n\nNext step: [what the author should do, if anything, e.g. share a screenshot of the listing].",
  'Printing & Quality':
    "I'm really sorry the copies didn't arrive in the condition they should have. Could you reply with photos of the affected pages and covers? Once we've verified them, we'll arrange a free reprint, which takes 5–7 business days from confirmation.\n\n[Any specifics about the order or number of copies affected.]\n\nNext step: please share the photos and we'll take it from there.",
  'Distribution & Availability':
    "Thank you for letting us know. When a live book shows as unavailable, it's usually a stock sync issue between us and the platform. I'm triggering a re-sync with our distribution team now, and the listing should be back within 24–48 hours.\n\n[Platform(s) affected and anything specific to this book.]\n\nNext step: we'll confirm once it's live again. If it isn't back within 48 hours, just reply here.",
  'Book Status & Production Updates':
    "Thank you for checking in. I understand how important it is to see your book move forward. [Book title] is currently at the [stage] stage. [Honest reason for any delay, framed collaboratively.]\n\n[Specific updated timeline, or: I'm confirming the timeline with the production team and will update you within 48 hours.]\n\nNext step: [what happens next and who acts].",
  'General Inquiry':
    "Thank you for reaching out. [Answer the question using BookLeaf policy, e.g. metadata updates can be submitted through the dashboard or by email and usually reflect on platforms within 3–5 business days.]\n\nNext step: [clear next action for the author or the team].",
};

export const fallbackTemplate = ({ category, authorName, ticketNumber }) => {
  const firstName = authorName?.split(/\s+/)[0] ?? 'there';
  const body = BODIES[category] ?? BODIES['General Inquiry'];
  return `Hi ${firstName},\n\n${body}\n\n(Ref: ${ticketNumber})\n\nWarm regards,\nTeam BookLeaf`;
};
