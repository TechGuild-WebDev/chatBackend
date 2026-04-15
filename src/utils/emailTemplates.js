export const emailTemplates = {
  resetPassword: (data) => `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
            <h2 style="color: #333; text-align: center;">Password Reset Request</h2>
            <p style="color: #555;">Hello,</p>
            <p style="color: #555;">
              Use this OTP to reset your password:
            </p>
            <div style="text-align: center; margin: 20px 0;">
              <span style="font-size: 24px; font-weight: bold; color: #007BFF; padding: 10px 20px; border: 2px dashed #007BFF; display: inline-block; border-radius: 5px;">
                ${data.otp}
              </span>
            </div>
            <p style="color: #555;">
              Valid for 5 minutes. If you didn't request this, please ignore.
            </p>
          </div>
        `,
  verification: (data) => `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
            <h2 style="color: #333; text-align: center;">Verify Your Email</h2>
            <p style="color: #555;">Welcome to our platform!</p>
            <div style="text-align: center; margin: 20px 0;">
              <a href="${data.verificationLink}" style="background-color: #007BFF; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Verify Email
              </a>
            </div>
            <p style="color: #555;">
              This link expires in 24 hours.
            </p>
          </div>
        `,
  notification: (data) => `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
            <h2 style="color: #333; text-align: center;">${data.title || "Notification"
    }</h2>
            <p style="color: #555;">${data.message}</p>
            ${data.actionLink
      ? `
              <div style="text-align: center; margin: 20px 0;">
                <a href="${data.actionLink
      }" style="background-color: #007BFF; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                  ${data.actionText || "Take Action"}
                </a>
              </div>
            `
      : ""
    }
          </div>
        `,

  emailVerification: (data) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #ffffff;">
    
    <!-- Logo -->
    <div style="text-align: center; margin-bottom: 20px;">
      <img src="${data.logoUrl || "https://via.placeholder.com/150x50?text=Twyce"
    }" alt="Twyce Logo" style="max-height: 50px;">
    </div>

    <!-- Heading -->
    <h2 style="color: #2c3e50; text-align: center; margin-bottom: 10px;">Verify Your Email</h2>

    <!-- Greeting -->
    <p style="color: #555; text-align: center;">Hello${data.name ? ` ${data.name}` : ""
    },</p>

    <!-- Message -->
    <p style="color: #555; text-align: center;">
      Thank you for signing up to <strong>Twyce</strong>! Use the OTP below to verify your email address:
    </p>

    <!-- OTP Box -->
    <div style="text-align: center; margin: 25px 0;">
      <span style="font-size: 28px; font-weight: bold; color: #e67e22; padding: 12px 24px; border: 2px dashed #e67e22; display: inline-block; border-radius: 6px;">
        ${data.otp}
      </span>
    </div>

    <!-- Footer Info -->
    <p style="color: #888; font-size: 14px; text-align: center;">
      This code is valid for <strong>5 minutes</strong>. If you did not request this, you can safely ignore this message.
    </p>

    <div style="border-top: 1px solid #eee; margin-top: 30px; padding-top: 15px; text-align: center;">
      <p style="color: #aaa; font-size: 12px;">© ${new Date().getFullYear()} Twyce. All rights reserved.</p>
    </div>

  </div>
`,

  welcome: (data) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 24px; background-color: #ffffff; border-radius: 8px; border: 1px solid #eee;">
    
    <!-- Logo -->
    <div style="text-align: center; margin-bottom: 24px;">
      <img src="${data.logoUrl || "https://via.placeholder.com/150x50?text=Twyce"
    }" alt="Twyce Logo" style="max-height: 50px;">
    </div>

    <!-- Header -->
    <h1 style="text-align: center; font-size: 22px; color: #2c3e50; margin-bottom: 10px;">
      Give your aesthetic a second chance — and the Planet Too 🌍
    </h1>

    <!-- Greeting -->
    <p style="color: #444; font-size: 16px; line-height: 1.6;">Hi ${data.name || "Twycer"
    },</p>

    <!-- Intro -->
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      You’ve just joined a community of <strong>Twycers</strong> — a collective that believes your aesthetic deserves more than a single chapter.
    </p>

    <!-- Mission -->
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Here, secondhand means second chances. For your wardrobe. For the planet. For the people behind every stitch.
    </p>

    <!-- Vision Points -->
    <ul style="color: #333; font-size: 15px; line-height: 1.6; padding-left: 20px;">
      <li>👗 Keep clothes out of landfills</li>
      <li>🧵 Create jobs through conscious consumption</li>
      <li>🧵 A rebellion against boring wardrobes and waste</li>
      <li>🌍 A contribution to the UN's goals on sustainability and unemployment</li>
    </ul>

    <!-- Mission Statement -->
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      <strong>Your mission, should you choose to accept it</strong> (and you already did by signing up):
    </p>

    <ul style="color: #333; font-size: 15px; line-height: 1.6; padding-left: 20px;">
      <li>👘 Buy and sell secondhand gems</li>
      <li>Keep clothes in closets, not landfills</li>
      <li>💚 Be kind to your wallet and the world</li>
    </ul>

    <!-- Final Note -->
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Whether you're giving your pieces a new home or discovering someone else’s pre-loved treasure, you’re making a real impact.
    </p>

    <!-- CTA -->
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Need help getting started? Check out our 
      <a href="${data.dashboardUrl || "#"
    }" style="color: #e67e22; text-decoration: none;">Getting Started Guide</a> 
      or just dive in — your new favorite outfit might already be waiting.
    </p>

    <!-- Outro -->
    <p style="color: #2c3e50; font-size: 16px; line-height: 1.6; font-weight: bold;">
      Welcome to the future of fashion. It’s slower, conscious, and infinitely more "you".
    </p>

    <p style="color: #888; font-size: 16px; line-height: 1.6;">
      Explore. Reimagine. Repeat.
    </p>

    <!-- Signoff -->
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Once loved,<br/>
      <strong>Twyce a charm</strong>
    </p>

    <!-- Footer -->
    <div style="border-top: 1px solid #eee; margin-top: 30px; padding-top: 15px; text-align: center;">
      <p style="color: #aaa; font-size: 12px;">© ${new Date().getFullYear()} Twyce. All rights reserved.</p>
    </div>

  </div>
`,
  
  approvedRequest: (data) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 24px; background-color: #ffffff; border-radius: 8px; border: 1px solid #eee;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h2 style="color: #2c3e50;">Probey Services</h2>
    </div>
    <h1 style="text-align: center; font-size: 22px; color: #2c3e50; margin-bottom: 10px;">
      Your Account is Ready
    </h1>
    <p style="color: #444; font-size: 16px; line-height: 1.6;">Hi ${data.name},</p>
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Your signup request for Probey Services has been <strong>approved</strong> by our team!
    </p>
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Here are your temporary login credentials. We strongly recommend changing your password after you log in.
    </p>
    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
      <p style="margin: 0 0 10px 0; color: #333;"><strong>Email:</strong> ${data.email}</p>
      <p style="margin: 0; color: #333;"><strong>Password:</strong> <span style="font-family: monospace; font-size: 16px; background: #eee; padding: 2px 6px; border-radius: 3px;">${data.password}</span></p>
    </div>
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      You can now log in to the mobile app. Welcome aboard!
    </p>
    <div style="border-top: 1px solid #eee; margin-top: 30px; padding-top: 15px; text-align: center;">
      <p style="color: #aaa; font-size: 12px;">© ${new Date().getFullYear()} Probey Services.</p>
    </div>
  </div>
`,
};
