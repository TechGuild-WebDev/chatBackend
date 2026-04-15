// src/utils/auth.util.js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

export const genOTP = (len = 4) => {
    const min = 10 ** (len - 1);
    const max = 10 ** len - 1;
    return String(Math.floor(Math.random() * (max - min + 1)) + min);
};

export const hash = (s) => bcrypt.hash(s, 10);
export const compare = (s, h) => bcrypt.compare(s, h);

export const signResetToken = (email) =>
    jwt.sign({ email, typ: "pwd_reset" }, process.env.RESET_TOKEN_SECRET, { expiresIn: "10m" });

export const verifyResetToken = (token) =>
    jwt.verify(token, process.env.RESET_TOKEN_SECRET);
