/**
 * Vercel Function entry point.
 *
 * Vercel only auto-detects a server entry point at the project root, but the API
 * lives in apps/api. This shim is the bridge: `vercel.json` rewrites every
 * /api/* request to this one function, and the Express app built into
 * apps/api/dist does the routing.
 *
 * It imports the compiled output rather than src so that the bundle needs no
 * root tsconfig.json and no TS path mapping: Vercel transpiles this file with
 * esbuild and resolves `../apps/api/dist/index.js` straight off disk. apps/api
 * must therefore be built before the function is bundled, which `pnpm build`
 * (the vercel.json build command) already guarantees.
 */
import app from '../apps/api/dist/index.js';

/**
 * A rewrite may hand Express the destination path (/api/index/...) instead of
 * the original one, and the two forms must both route correctly, because the
 * app mounts its router at /api. So the function's own path is stripped when it
 * is present, and any other URL is passed through untouched.
 */
const FUNCTION_PATH = '/api/index';

type RequestLike = { url?: string | undefined };
type ResponseLike = unknown;

function originalUrl(url: string): string {
  if (
    url !== FUNCTION_PATH &&
    !url.startsWith(`${FUNCTION_PATH}/`) &&
    !url.startsWith(`${FUNCTION_PATH}?`)
  ) {
    return url;
  }
  return url.slice(FUNCTION_PATH.length) || '/';
}

export default function handler(req: RequestLike, res: ResponseLike): void {
  req.url = originalUrl(req.url ?? '/');
  (app as unknown as (request: RequestLike, response: ResponseLike) => void)(req, res);
}
