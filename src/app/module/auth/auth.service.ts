import status from 'http-status';
import AppError from '../../errors/AppError';
import { User } from '../user/user.model';
import { TLoginUser } from './auth.interface';
import { TUser } from '../user/user.interface';
import { createAccessToken, createRefreshToken } from './auth.utils';
import config from '../../config';
import jwt, { JwtPayload } from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { sendEmail } from '../../utils/sendEmail';
import mongoose from 'mongoose';

// create a new user
const registerUser = async (payload: TUser) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    //check if the user exists
    const user = await User.isUserExistByEmail(payload?.email);

    if (user) throw new AppError(status.CONFLICT, 'User already exists !');

    // Create the user
    const userData = new User(payload);
    const createdUser = await userData.save({ session });

    await session.commitTransaction();

    return await loginUser({
      email: createdUser.email,
      password: payload.password,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    session.endSession();
  }
};

// login user
const loginUser = async (payload: TLoginUser) => {
  //check if the user exists
  const user = await User.isUserExistByEmail(payload?.email);

  if (!user) throw new AppError(status.NOT_FOUND, 'This user is not found !');

  // check is the user is active or not
  const isActive = user?.status;
  if (isActive === 'inactive')
    throw new AppError(status.UNAUTHORIZED, 'This user is not active !');

  // checking if the user is already blocked
  const isBan = user?.isBan;
  if (isBan) throw new AppError(status.FORBIDDEN, 'This user is blocked !');

  // checking if the password is correct
  if (!(await User.isPasswordMatched(payload?.password, user?.password))) {
    throw new AppError(status.FORBIDDEN, 'Creadentials does not match !');
  }

  const jwtPayload = {
    email: user?.email,
    role: user?.role,
  };

  // create token and send to the client
  const accessToken = createAccessToken(
    jwtPayload,
    config.jwt_access_secret as string,
  );

  // refresh token
  const refreshToken = createRefreshToken(
    jwtPayload,
    config.jwt_refresh_secret as string,
  );

  return {
    accessToken,
    refreshToken,
  };
};

// logout user
const logoutUser = async (refreshToken: string) => {
  const result = await User.findOneAndUpdate(
    { refreshToken },
    { refreshToken: null },
    { new: true },
  );
  return result;
};

// change password
const changePassword = async (
  userData: JwtPayload,
  payload: { oldPassword: string; newPassword: string },
) => {
  // check if the user exists
  const user = await User.isUserExistByEmail(userData?.email);
  if (!user) {
    throw new AppError(status.NOT_FOUND, 'This user is not found !');
  }

  // checking if  the  user is already blocked
  const isBan = user?.isBan;
  if (isBan) {
    throw new AppError(status.FORBIDDEN, 'This user is already blocked !');
  }

  // checking if the user is blocked
  const userStatus = user?.status;
  if (userStatus === 'inactive') {
    throw new AppError(status.FORBIDDEN, 'This user is not active !');
  }

  // checking if the password is correct
  if (!(await User.isPasswordMatched(payload?.oldPassword, user?.password))) {
    throw new AppError(status.FORBIDDEN, 'Password does not match !');
  }

  // hash new password
  const newhashedPassword = await bcrypt.hash(
    payload?.newPassword,
    Number(config.bcrypt_salt_rounds),
  );

  await User.findOneAndUpdate(
    {
      email: userData?.email,
      role: userData?.role,
    },
    {
      password: newhashedPassword,
      passwordChangedAt: new Date(),
    },
    { new: true },
  );

  return null;
};

// refresh token
const refreshToken = async (token: string) => {
  // checking if token is valid
  const decoded = jwt.verify(
    token,
    config.jwt_refresh_secret as string,
  ) as JwtPayload;

  const { email, iat } = decoded;

  // check if the user exists
  const user = await User.isUserExistByEmail(email);
  if (!user) {
    throw new AppError(status.NOT_FOUND, 'This user is not found !');
  }

  // checking if  the  user is already blocked
  const isBan = user?.isBan;
  if (isBan) {
    throw new AppError(status.FORBIDDEN, 'This user is already deleted !');
  }

  // checking if the user is blocked
  const userStatus = user?.status;
  if (userStatus === 'inactive') {
    throw new AppError(status.FORBIDDEN, 'This user is not active !');
  }

  // check if jwt issued timestamp less then password change timestamp

  if (
    user.passwordChangedAt &&
    User.isJwtIssuedBeforePasswordChange(user.passwordChangedAt, iat as number)
  ) {
    throw new AppError(
      status.UNAUTHORIZED,
      "You're unauthrized to perform this action!",
    );
  }

  const jwtPayload = {
    email: user?.email,
    role: user?.role,
  };

  // Access Granted : Send Access Token and Refresh Token

  // create token and send to the client
  const accessToken = createAccessToken(
    jwtPayload,
    config.jwt_access_secret as string,
  );

  return {
    accessToken,
  };
};

// forget password
const forgetPassword = async (email: string) => {
  // check if the user exists
  const user = await User.isUserExistByEmail(email);
  if (!user) {
    throw new AppError(status.NOT_FOUND, 'This user is not found !');
  }

  // checking if  the  user is already deleted
  const isBan = user?.isBan;
  if (isBan) {
    throw new AppError(status.FORBIDDEN, 'This user is already blocked !');
  }

  // checking if the user is active or not
  const userStatus = user?.status;
  if (userStatus === 'inactive') {
    throw new AppError(status.FORBIDDEN, 'This user is blocked !');
  }

  const jwtPayload = {
    email: user?.email,
    role: user?.role,
  };

  // Access Granted : Send Access Token and Refresh Token

  // create token and send to the client
  const resetToken = createAccessToken(
    jwtPayload,
    config.jwt_access_secret as string,
  );

  const resetUILink = `${config.reset_password_ui_link}?email=${user.email}&token=${resetToken}`;

  sendEmail(user?.email, resetUILink);
};

// reset password
const resetPassword = async (
  payload: { email: string; newPassword: string },
  token: string,
) => {
  // check if the user exists
  const user = await User.isUserExistByEmail(payload?.email);
  if (!user) {
    throw new AppError(status.NOT_FOUND, 'This user is not found !');
  }

  // checking if  the  user is already blocked
  const isBan = user?.isBan;
  if (isBan) {
    throw new AppError(status.FORBIDDEN, 'This user is already deleted !');
  }

  // checking if the user is active or not
  const userStatus = user?.status;
  if (userStatus === 'inactive') {
    throw new AppError(status.FORBIDDEN, 'This user is not active !');
  }

  // checking if token is valid
  const decoded = jwt.verify(
    token,
    config.jwt_access_secret as string,
  ) as JwtPayload;

  if (decoded?.email !== payload?.email) {
    throw new AppError(
      status.FORBIDDEN,
      'You are forbidden to perform this action!',
    );
  }

  // hash new password
  const newhashedPassword = await bcrypt.hash(
    payload?.newPassword,
    Number(config.bcrypt_salt_rounds),
  );

  await User.findOneAndUpdate(
    {
      id: decoded?.userId,
      role: decoded?.role,
    },
    {
      password: newhashedPassword,
      passwordChangedAt: new Date(),
    },
    { new: true },
  );
};

export const AuthService = {
  registerUser,
  loginUser,
  logoutUser,
  changePassword,
  refreshToken,
  forgetPassword,
  resetPassword,
};
