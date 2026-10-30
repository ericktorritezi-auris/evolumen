'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const config = require('./config');
const log = require('./logger');
const db = require('./db');
const sec = require('./security');
const { build } = require('./routes');
const authViews = require('./views/auth');

const PUBLIC = path.join(__dirname, '..', 'public');

function createApp(cfg) {
  require('./files').configure(cfg);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(require('./health').track);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        frameSrc: ['https://www.youtube-nocookie.com'],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(cfg.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    hsts: cfg.isProd ? { maxAge: 15552000, includeSubDomains: false } : false,
    // 'no-referrer' faz o Chrome enviar Origin: null em formulários do próprio site.
    referrerPolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,
  }));

  app.use(require('./help').middleware);

  app.get('/health', async (req, res) => {
    try { await db.q('SELECT 1'); res.json({ status: 'ok', db: 'ok', version: cfg.version.version, env: cfg.appEnv }); }
    catch { res.status(503).json({ status: 'erro', db: 'falhou' }); }
  });
  app.get('/version', (req, res) => res.json({ version: cfg.version.version, display: cfg.version.display, phase: cfg.version.phase, env: cfg.appEnv }));
  app.get('/robots.txt', (req, res) => res.type('text/plain').send(cfg.isProd ? 'User-agent: *\nDisallow: /admin\nDisallow: /perfil\nDisallow: /meus-cursos\n' : 'User-agent: *\nDisallow: /\n'));

  app.get('/manifest.webmanifest', (req, res) => {
    res.type('application/manifest+json').json({
      name: 'EvoLumen Academy', short_name: 'EvoLumen',
      description: 'Cursos e produtos digitais de saúde emocional do professor Erick Torritezi.',
      lang: 'pt-BR', start_url: '/?source=pwa', scope: '/', display: 'standalone',
      background_color: '#0B0F26', theme_color: '#0B0F26',
      icons: [
        { src: '/static/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/static/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/static/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    });
  });
  const swSource = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
  app.get('/sw.js', (req, res) => {
    res.set('Cache-Control', 'no-cache').type('application/javascript').send(swSource.replace('__VERSION__', cfg.version.version));
  });
  app.get('/offline', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(PUBLIC, 'offline.html')));
  app.get('/favicon.ico', (req, res) => res.redirect(301, '/static/icons/favicon-32.png'));
  app.use('/static', express.static(PUBLIC, { maxAge: cfg.isProd ? '7d' : 0, index: false }));

  // Webhook do gateway: antes de sessão e CSRF (a autenticidade vem da assinatura).
  const hooks = express.Router();
  app.use('/webhooks', express.json({ limit: '100kb' }), hooks);
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(sec.sessionMiddleware(cfg));
  app.use(sec.csrfMiddleware(cfg));
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  const main = build(cfg, app);
  app.use(require('./routes_public').build(cfg, main.helpers));
  app.use(main);
  app.use(require('./routes_student').build(cfg, main.helpers));
  app.use(require('./routes_admin').build(cfg, main.helpers));
  app.use(require('./routes_manage').build(cfg, main.helpers));
  app.use(require('./routes_assess').build(cfg, main.helpers));
  app.use(require('./routes_assessadm').build(cfg, main.helpers));
  const pay = require('./routes_pay');
  pay.mountWebhook(cfg, main.helpers, hooks);
  app.use(pay.build(cfg, main.helpers));
  app.use(require('./routes_sales').build(cfg, main.helpers));
  app.use(require('./routes_community').build(cfg, main.helpers));
  app.use(require('./routes_lgpd').build(cfg, main.helpers));
  app.use(require('./routes_notify').build(cfg, main.helpers));
  app.use(require('./routes_launch').build(cfg, main.helpers));
  app.use(require('./routes_affiliates').build(cfg, main.helpers));
  app.use(require('./routes_afiliado').build(cfg, main.helpers));
  app.use(require('./routes_downloads').build(cfg, main.helpers));

  app.use((req, res) => {
    res.status(404).send(authViews.errorPage({ cfg, status: 404, message: 'O endereço não existe ou foi movido.', loggedIn: !!req.user }));
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) log.error('erro_nao_tratado', { error: err.message, path: req.path });
    const message = err.expose ? err.message : 'Tivemos um problema do nosso lado. Tente de novo em instantes.';
    res.status(status).send(authViews.errorPage({ cfg, status, message, loggedIn: !!req.user }));
  });
  return app;
}

async function start() {
  const cfg = config.load(process.env);
  log.setLevel(cfg.logLevel);
  const bad = config.problems(cfg);
  if (bad.length) { for (const p of bad) log.error('config_invalida', { problema: p }); process.exit(1); }
  const pool = db.connect(cfg);
  await require('./migrate').migrate(pool);
  const seeded = await require('./seed').seed(pool, cfg);
  log.info('seed_ok', seeded);
  const cleanup = () => db.q(`DELETE FROM sessions WHERE expires_at < now();
    DELETE FROM password_resets WHERE expires_at < now() - interval '7 days';
    DELETE FROM email_changes WHERE expires_at < now() - interval '7 days';
    DELETE FROM audit_log WHERE at < now() - interval '30 days' AND action !~ '^(order_|refund_|file_|download_|payment_|legal_|checkout_|data_|acceptance_|launch_|affiliate_)';
    DELETE FROM audit_log WHERE at < now() - interval '5 years'`).catch((e) => log.warn('limpeza_falhou', { error: e.message }));
  cleanup(); setInterval(cleanup, 6 * 3600 * 1000).unref();
  const sweep = () => require('./sales').sweepExpired(cfg, (pr) => Promise.resolve(pr).catch((e) => log.warn('email_falhou', { error: e.message }))).catch((e) => log.warn('varredura_pix_falhou', { error: e.message }));
  setInterval(sweep, 5 * 60 * 1000).unref();
  // Campainha: aniversários, prazos e lembretes. Uma vez por hora (cada aviso tem chave e não se repete).
  const daily = () => require('./reminders').run(cfg, (pr) => Promise.resolve(pr).catch((e) => log.warn('email_falhou', { error: e.message })));
  setTimeout(daily, 60 * 1000).unref(); setInterval(daily, 3600 * 1000).unref();
  const app = createApp(cfg);
  const server = app.listen(cfg.port, () => log.info('servidor_no_ar', { porta: cfg.port, ambiente: cfg.appEnv, versao: cfg.version.version, volume: require('./files').volumeOn() }));
  server.requestTimeout = 20 * 60 * 1000; // envio de arquivo grande em conexão lenta
  server.timeout = 0;
  const stop = () => server.close(async () => { await db.close(); process.exit(0); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}

if (require.main === module) start().catch((e) => { log.error('falha_na_partida', { error: e.message }); process.exit(1); });
module.exports = { createApp, start };
