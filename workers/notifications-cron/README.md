# EduSearch notifications cron

Worker isolado que chama o dispatcher interno da API a cada minuto. Configure `NOTIFICATIONS_DISPATCH_SECRET`
como secret do Worker com o mesmo valor de `API_NOTIFICATIONS_DISPATCH_SECRET` na Vercel. Não publique antes
da homologação de Resend e da mudança explícita de `API_NOTIFICATIONS_STAGE`.

Deploy autorizado: `npx wrangler deploy --config workers/notifications-cron/wrangler.jsonc`.
