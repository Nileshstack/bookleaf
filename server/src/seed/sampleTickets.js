/**
 * Demo tickets so the admin queue isn't empty on first load. Each one is
 * grounded in the seeded author's real book data and together they cover
 * all six categories, every status and a spread of priorities.
 *
 * Ticket numbers come from array order (BL-0001 = first). `daysAgo` keeps the
 * queue looking fresh relative to whenever the seed runs. Thread messages use
 * `hoursAfter` the ticket was opened.
 *
 * These tickets were "triaged by hand": category and priority are set, while
 * aiStatus stays 'pending' because no model has looked at them yet.
 */
export const sampleTickets = [
  {
    authorCode: 'AUTH010',
    bookCode: null,
    subject: 'Can I update my author bio on Amazon?',
    description:
      "Hi team, I'd like to refresh the author bio that appears on my Amazon pages. It still mentions my old job. Is that something I can change myself, or do I need to send it to you?",
    status: 'Closed',
    category: 'General Inquiry',
    priority: 'Low',
    daysAgo: 12,
    assigned: true,
    messages: [
      {
        from: 'admin',
        hoursAfter: 5,
        body: "Hi Diya, thanks for reaching out, and good news: yes, you can. Send us the updated bio (up to 250 words) by replying here or through your dashboard's metadata update form, and we'll push it to every platform your books are listed on. Changes usually show up within 3–5 business days. Once it's live we'll close this ticket, and you can reopen it any time if something looks off.",
      },
      { from: 'author', hoursAfter: 20, body: 'Sent it through the dashboard just now. Thank you!' },
    ],
  },
  {
    authorCode: 'AUTH005',
    bookCode: 'BK009',
    subject: 'When will my pending royalty for Letters from Lakshadweep be paid?',
    description:
      'My dashboard shows ₹3,055 pending for Letters from Lakshadweep. My last payout was on 15 October. Could you tell me when the next payment is due and whether I need to do anything?',
    status: 'Resolved',
    category: 'Royalty & Payments',
    priority: 'Medium',
    daysAgo: 9,
    assigned: true,
    messages: [
      {
        from: 'admin',
        hoursAfter: 6,
        body: "Hi Meera, thanks for checking in. The ₹3,055 pending for Letters from Lakshadweep covers sales since your last payout on 15 October. Royalties are calculated at the end of each quarter and paid within 45 days of the quarter closing. Because your balance is above the ₹1,000 minimum threshold, the full amount will go out in the next payout cycle by bank transfer to the account linked in your dashboard. There's nothing you need to do. If your bank details have changed recently, just update them in the dashboard before the quarter ends.",
      },
      { from: 'author', hoursAfter: 30, body: 'That makes sense, thanks for the clear explanation.' },
    ],
  },
  {
    authorCode: 'AUTH004',
    bookCode: 'BK006',
    subject: 'Several author copies of Debugging Life have binding defects',
    description:
      "I received my 20 author copies of Debugging Life yesterday. At least 6 of them have pages 45–60 bound upside down, and on two the cover is coming away from the spine. I was planning to hand these out at a workshop next week, so I'd really appreciate a quick fix.",
    status: 'In Progress',
    category: 'Printing & Quality',
    priority: 'High',
    daysAgo: 5,
    assigned: true,
    messages: [
      {
        from: 'admin',
        hoursAfter: 3,
        body: "Hi Vikram, I'm really sorry. Upside-down signatures and a lifting cover are not the quality we hold ourselves to, especially with your workshop coming up. Could you reply with photos of the affected pages and the spine on the damaged copies? Once we've verified them we'll arrange a free reprint of every defective copy. The reprint takes 5–7 business days from confirmation, and we'll prioritise it given your workshop date.",
      },
      {
        from: 'admin',
        hoursAfter: 4,
        internal: true,
        body: 'Printed in-house (Delhi). Asked the print floor to check the rest of this batch for the same signature fault before we ship the reprint.',
      },
      {
        from: 'author',
        hoursAfter: 26,
        body: "I've emailed photos of all 6 defective copies to the support inbox this morning, including the two with the cover lifting.",
      },
    ],
    attachments: [{ fileName: 'debugging-life-binding-defect.jpg', mimeType: 'image/jpeg', sizeBytes: 482113 }],
  },
  {
    authorCode: 'AUTH007',
    bookCode: 'BK013',
    subject: 'Midnight in Mysore has been stuck in cover design for weeks',
    description:
      "My thriller Midnight in Mysore has shown 'In Production - Cover Design' for almost a month now. I approved the concept brief early on. When can I expect to see the first cover drafts, and is there anything holding it up?",
    status: 'In Progress',
    category: 'Book Status & Production Updates',
    priority: 'Medium',
    daysAgo: 4,
    assigned: true,
    messages: [
      {
        from: 'admin',
        hoursAfter: 2,
        internal: true,
        body: 'Checked with the design team: draft 2 was emailed to Sneha 10 days ago and they are waiting on her feedback. Frame this collaboratively, not as her delay.',
      },
    ],
  },
  {
    authorCode: 'AUTH003',
    bookCode: 'BK005',
    subject: 'Never received any royalty for Between Two Temples',
    description:
      'Between Two Temples has been live since July 2024 and has sold 67 copies, but I have not received a single royalty payment. The dashboard says ₹2,546 is pending and the last payout date is blank. Other BookLeaf authors I know are paid every quarter. Is something wrong with my account? Please look into this urgently.',
    status: 'Open',
    category: 'Royalty & Payments',
    priority: 'Critical',
    daysAgo: 3,
    assigned: false,
    messages: [],
  },
  {
    authorCode: 'AUTH002',
    bookCode: 'BK003',
    subject: 'Different ISBN on Amazon US than on my printed copies of Code & Karma',
    description:
      "A reader in the US told me the Amazon US listing for Code & Karma shows a different ISBN from the one printed on the back cover (978-93-5XXXX-03-5). I checked and they're right. People are asking whether it's even the same book. Can you fix the listing?",
    status: 'Open',
    category: 'ISBN & Metadata Issues',
    priority: 'High',
    daysAgo: 2,
    assigned: false,
    messages: [],
  },
  {
    authorCode: 'AUTH008',
    bookCode: 'BK014',
    subject: "Ghazal of the Forgotten shows 'Currently Unavailable' on Amazon India",
    description:
      "For about a week, Ghazal of the Forgotten has shown 'Currently Unavailable' on Amazon India. I did a reading in Lucknow last weekend and several people told me they couldn't order it. It's still available on the BookLeaf Store. Can you get the Amazon listing back up?",
    status: 'Open',
    category: 'Distribution & Availability',
    priority: 'High',
    daysAgo: 1,
    assigned: false,
    messages: [],
  },
];
