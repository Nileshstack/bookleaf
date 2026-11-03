import mongoose from 'mongoose';

/**
 * Money fields are whole Indian rupees, matching the source data.
 * Books still in production legitimately have null mrp / royaltyPerCopy /
 * publicationDate / printPartner, so those are nullable rather than required.
 */
const bookSchema = new mongoose.Schema(
  {
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    bookId: { type: String, required: true, unique: true, trim: true }, // e.g. BK001
    title: { type: String, required: true, trim: true },
    isbn: { type: String, required: true, unique: true, trim: true },
    genre: { type: String, trim: true, default: null },
    publicationDate: { type: Date, default: null },
    status: { type: String, required: true, trim: true }, // e.g. "Published & Live", "In Production - Cover Design"

    mrp: { type: Number, min: 0, default: null },
    royaltyPerCopy: { type: Number, min: 0, default: null },
    totalCopiesSold: { type: Number, min: 0, default: 0 },
    totalRoyaltyEarned: { type: Number, min: 0, default: 0 },
    royaltyPaid: { type: Number, min: 0, default: 0 },
    royaltyPending: { type: Number, min: 0, default: 0 },
    lastRoyaltyPayoutDate: { type: Date, default: null },

    printPartner: { type: String, trim: true, default: null },
    availableOn: { type: [String], default: [] },
  },
  { timestamps: true, id: false, toJSON: { virtuals: true, versionKey: false } },
);

bookSchema.virtual('isPublished').get(function isPublished() {
  return this.status === 'Published & Live';
});

bookSchema.index({ authorId: 1, publicationDate: -1 });

export const Book = mongoose.model('Book', bookSchema);
