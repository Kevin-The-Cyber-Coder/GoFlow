declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware after a successful token check. */
      auth?: {
        userId: string;
      };
      /** Set by the `requireWorkspace` middleware. */
      workspace?: {
        workspaceId: string;
        role: string;
      };
    }
  }
}

export {};
