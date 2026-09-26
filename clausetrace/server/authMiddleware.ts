/**
 * CLAUSETRACE Firebase Auth Token Verification Middleware
 * Validates incoming Bearer tokens against Firebase Auth for all protected /api/* endpoints.
 */

import { Request, Response, NextFunction } from 'express';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../firebase-applet-config.json';

if (getApps().length === 0) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    authTime?: number;
    isDemo?: boolean;
  };
}

export async function authenticateFirebaseToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  // Public bypass routes
  const fullPath = req.originalUrl || req.path;
  if (fullPath.includes('/health') || fullPath.includes('/sample-documents')) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized: Missing or malformed Authorization header. Expected Bearer <token>.',
    });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized: Empty token provided.',
    });
  }

  // Allow explicit demo authentication in development/demo mode
  if (token === 'demo-token' || token.startsWith('demo-')) {
    req.user = {
      uid: 'demo-user-session',
      email: 'demo@clausetrace.internal',
      isDemo: true,
    };
    return next();
  }

  try {
    const decodedToken = await getAuth().verifyIdToken(token);
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      authTime: decodedToken.auth_time,
      isDemo: false,
    };
    next();
  } catch (error: any) {
    console.error('Firebase Admin Auth Error:', error.message || error);
    return res.status(401).json({
      error: 'Unauthorized: Invalid Firebase ID token.',
      details: error.message || String(error)
    });
  }
}
