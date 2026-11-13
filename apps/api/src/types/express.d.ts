export interface AuthContext {
  readonly userId: string;
  readonly email: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
