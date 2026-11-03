import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES } from './enums.js';

const BCRYPT_ROUNDS = 10;

const userSchema = new mongoose.Schema(
  {
    role: { type: String, enum: Object.values(ROLES), required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email address'],
    },
    // Excluded from queries by default; auth code must opt in with .select('+passwordHash').
    passwordHash: { type: String, required: true, select: false },

    // Author profile fields (null for admins).
    authorCode: { type: String, trim: true, default: null }, // e.g. AUTH001 from the source data
    phone: { type: String, trim: true, default: null },
    city: { type: String, trim: true, default: null },
    joinedDate: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (_doc, ret) => {
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

// Unique only where present, so admins (authorCode: null) don't collide.
userSchema.index(
  { authorCode: 1 },
  { unique: true, partialFilterExpression: { authorCode: { $type: 'string' } } },
);
userSchema.index({ role: 1 });

userSchema.statics.hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

export const User = mongoose.model('User', userSchema);
