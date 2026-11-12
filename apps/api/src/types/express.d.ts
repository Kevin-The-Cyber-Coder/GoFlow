declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware after a successful token check. */
      auth?: {
        userId: string;
      };
    }
  }
}

export {};
