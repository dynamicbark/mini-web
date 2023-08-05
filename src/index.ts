import 'dotenv/config';
import express, { Request } from 'express';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'fs';
import path from 'path';

const expressApp = express();
expressApp.disable('x-powered-by');
expressApp.set('trust proxy', true);

let availableSites = readdirSync('sites', { withFileTypes: true })
  .filter((dirent) => dirent.isDirectory())
  .map((dirent) => dirent.name);

// Reload the list of sites every 15 seconds
setInterval(() => {
  availableSites = readdirSync('sites', { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
}, 15 * 1000);

// Send request information to Plausible
function sendRequestToPlausible(req: Request) {
  setImmediate(async () => {
    try {
      // @ts-ignore
      fetch(`${process.env.PLAUSIBLE_URL}/api/event`, {
        method: 'post',
        headers: {
          'User-Agent': req.headers['user-agent'],
          'X-Forwarded-For': req.ip,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'pageview',
          url: `https://${req.hostname}${req.path}`,
          domain: req.hostname,
          referrer: req.headers.referer,
        }),
      });
    } catch (e) {
      console.error(e);
    }
  });
}

// Check if the site is found locally
expressApp.use((req, res, next) => {
  if (!availableSites.includes(req.hostname)) {
    res.status(404).setHeader('content-type', 'text/plain').send(`404: Not Found - unknown site: ${req.hostname}`);
    return;
  }
  next();
});

// Serve the site based on hostname
expressApp.use((req, res, next) => {
  express.static(path.join('sites', req.hostname), {
    extensions: ['html', 'txt'],
    index: ['index.html', 'index.txt'],
    setHeaders: (_res, filePath, stat) => {
      if (!stat || !stat.isFile()) {
        return;
      }
      if (['.html', '.txt'].includes(path.extname(filePath))) {
        sendRequestToPlausible(req);
      }
    },
  })(req, res, next);
});

// Check for redirects if no static pages found
expressApp.use((req, res, next) => {
  const redirectFilePath = path.join('sites', req.hostname, '_redirects', req.path);
  if (existsSync(redirectFilePath) && !lstatSync(redirectFilePath).isDirectory()) {
    sendRequestToPlausible(req);
    return res.redirect(readFileSync(redirectFilePath).toString().trim());
  }
  next();
});

// Finally, send back 404
expressApp.use((_req, res) => {
  res.status(404).setHeader('content-type', 'text/plain').send('404: Not Found');
});

try {
  expressApp.listen(parseInt(process.env.WEB_PORT!, 10), `${process.env.WEB_HOST}`, () => {
    console.log('Web server is listening.');
  });
} catch (e) {
  console.error(e);
}
