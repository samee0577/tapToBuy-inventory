import type { SessionUserDto } from '@inventory/shared';

declare global {
  namespace Express {
    interface Request {
      /**
       * Set by requireAuth and cleared otherwise. Authorisation reads this
       * rather than the JWT claims, so it always reflects live database state.
       */
      auth?: SessionUserDto;
    }
  }
}

export {};
