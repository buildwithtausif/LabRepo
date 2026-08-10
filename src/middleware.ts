import { clerkMiddleware } from "@clerk/astro/server";

const isDevBypass = process.env.ENV === 'development';

export const onRequest = isDevBypass 
  ? async (context: any, next: any) => {
      // Mock the auth() object that Clerk usually injects
      context.locals.auth = () => ({
        userId: process.env.ADMIN_USER_ID || process.env.CLERK_ADMIN_USER_ID || 'mock_dev_admin',
        sessionId: 'mock_session',
        getToken: async () => 'mock_token',
      });
      return next();
    }
  : clerkMiddleware();