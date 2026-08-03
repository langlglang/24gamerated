export const PORT = Number(process.env.PORT ?? 3000);

/** Where the built client lives, relative to server/dist at runtime. */
export const CLIENT_DIST_RELATIVE = '../../client/dist';

/** Allowed origins in dev, when Vite serves the client on its own port. */
export const DEV_CLIENT_ORIGIN = process.env.DEV_CLIENT_ORIGIN ?? 'http://localhost:5173';

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';
