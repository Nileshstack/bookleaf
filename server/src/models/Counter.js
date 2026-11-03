import mongoose from 'mongoose';

/**
 * Named monotonic sequences (e.g. ticket numbers). A single atomic $inc
 * avoids the race that "count documents + 1" has under concurrent inserts.
 */
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);

counterSchema.statics.next = async function next(name) {
  const counter = await this.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return counter.seq;
};

/** Never moves a sequence backwards; used by the seed after inserting fixed numbers. */
counterSchema.statics.ensureAtLeast = function ensureAtLeast(name, value) {
  return this.updateOne({ _id: name }, { $max: { seq: value } }, { upsert: true });
};

export const Counter = mongoose.model('Counter', counterSchema);
