// middlewares/passport.middleware.js
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import prisma from "../prismaClient.js";
import dotenv from "dotenv";
import { sendEmail } from "../utils/mail.service.js";
import { logoUrl, websiteUrl } from "../constants.js";
dotenv.config();

// Configure Passport strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.BACKEND_URL}/auth/google/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) {
          return done(null, false);
        }

        // Find or create the user
        let user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          user = await prisma.user.create({
            data: {
              email,
              name: profile.displayName,
              profileImage: profile.photos?.[0]?.value,
              gender: profile.gender || null,
              // isVerified: true,
              password: "", // optional: placeholder to prevent login via password
            },
          });

          await sendEmail({
            to: user.email,
            subject: `Welcome, Twycer`,
            template: "welcome",
            data: {
              name: user.fullName,
              dashboardUrl: websiteUrl,
              logoUrl: logoUrl,
            },
          });
        }

        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

// Session handling
passport.serializeUser((user, done) => {
  done(null, user.id);
});
passport.deserializeUser(async (id, done) => {
  const user = await prisma.user.findUnique({ where: { id } });
  done(null, user);
});

export default passport;
