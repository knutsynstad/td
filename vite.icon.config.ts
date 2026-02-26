import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig } from 'vite';

const ASSETS_UI = 'src/client/assets/ui';

const saveIconPlugin = () => ({
  name: 'save-icon',
  configureServer(server: {
    middlewares: {
      use: (fn: (req: unknown, res: unknown, next: () => void) => void) => void;
    };
  }) {
    server.middlewares.use(
      async (
        req: {
          url?: string;
          method?: string;
          on: (e: string, fn: (chunk: Buffer) => void) => void;
        },
        res: {
          setHeader: (a: string, b: string) => void;
          statusCode: number;
          end: (s?: string) => void;
        },
        next: () => void
      ) => {
        if (req.url !== '/__save-icon' || req.method !== 'POST') return next();
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString()) as {
              filename: string;
              dataUrl: string;
            };
            const match = body.dataUrl.match(/^data:image\/png;base64,(.+)$/);
            if (!match || !body.filename?.endsWith('.png')) {
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Invalid request' }));
              return;
            }
            const dir = join(process.cwd(), ASSETS_UI);
            await mkdir(dir, { recursive: true });
            await writeFile(
              join(dir, body.filename),
              Buffer.from(match[1], 'base64')
            );
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(JSON.stringify({ path: `${ASSETS_UI}/${body.filename}` }));
          } catch (e) {
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
      }
    );
  },
});

export default defineConfig({
  root: '.',
  plugins: [saveIconPlugin()],
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      input: '/tools/icon-generator.html',
    },
  },
  server: {
    open: '/tools/icon-generator.html',
  },
});
