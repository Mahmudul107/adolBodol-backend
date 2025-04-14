import { model, Schema } from 'mongoose';
import { TUser, UserModel } from './user.interface';
import { USER_ROLE, USER_STATUS } from './user.constant';
import bcrypt from 'bcrypt';
import config from '../../config';

const userSchema = new Schema<TUser, UserModel>(
  {
    name: {
      type: String,
      required: [true, 'User name is required'],
    },
    email: {
      type: String,
      required: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please provide a valid email address',
      ],
    },
    phoneNumber: {
      type: String,
      required: [true, 'User phone number is required'],
      trim: true,
      match: [/^01\d{9}$/, 'Phone number must be 11 digits and start with 01'],
      validate: {
        validator: function (v) {
          return /^01\d{9}$/.test(v);
        },
        message: (props) =>
          `${props.value} is not a valid phone number. It should be 11 digits and start with 01.`,
      },
    },

    password: {
      type: String,
      required: true,
      select: false,
    },
    photo: {
      type: String,
      default: '',
    },
    role: {
      type: String,
      enum: [USER_ROLE.user, USER_ROLE.admin, USER_ROLE.superAdmin],
      default: USER_ROLE.user,
    },
    status: {
      type: String,
      enum: USER_STATUS,
      default: 'active',
    },
    passwordChangedAt: {
      type: Date,
    },
    isBan: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// use hook to hash password before saving user
userSchema.pre('save', async function (next) {
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const user = this;
  // hashing password before saving
  user.password = await bcrypt.hash(
    user.password,
    Number(config.bcrypt_salt_rounds),
  );
  next();
});

// use hook to empty password before sending response
userSchema.post('save', function (doc, next) {
  doc.password = '';
  next();
});

// find user by using email
userSchema.statics.isUserExistByEmail = async function (email: string) {
  return await this.findOne({ email }).select('+password');
};

// Check if password is correct or not
userSchema.statics.isPasswordMatched = async function (
  plainTextPassword: string,
  hashedPassword: string,
) {
  return await bcrypt.compare(plainTextPassword, hashedPassword);
};

// check if jwt is issued before password change
userSchema.statics.isJwtIssuedBeforePasswordChange = function (
  passwordChangeTimestamp: Date,
  jwtIssuedTimestamp: number,
) {
  const passwordChangeTime = new Date(passwordChangeTimestamp).getTime() / 1000;
  return passwordChangeTime > jwtIssuedTimestamp;
};

export const User = model<TUser, UserModel>('User', userSchema);
