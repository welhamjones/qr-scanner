QR SCANNER - DEPLOYMENT NOTES

Files
  index.html, style.css, app.js   The app
  jsQR.js, jsQR-LICENSE.txt       QR decoder (jsQR v1.4.0, Apache 2.0), self-hosted
  manifest.json, icon.svg         Allows "Add to Home screen" / install in Edge
  logo.jpg (you supply)           Company logo shown top left (945 x 296, displayed 48px high)
  .htaccess                       Forces HTTPS, security headers, no caching

QR code format (one value per line)
  Name of deceased
  Date of birth
  Date of death
  https://efd.seker.co.uk/...

Deployment (cPanel)
  1. Create a subdomain or folder, e.g. scanner.yourdomain.co.uk
  2. Make sure SSL is active (cPanel > SSL/TLS Status > Run AutoSSL)
  3. Upload all files, including the hidden .htaccess file
  4. Browse to the site in Edge on the tablet, tap Scan QR code and allow camera access
  5. Optional: Edge menu > Add to phone / Install app for a full-screen icon

Configuration (top of app.js)
  allowedHosts      Hostnames the Open button is allowed to open. Default: efd.seker.co.uk
  autoClearSeconds  Result screen clears and returns to the start screen (camera off). Default: 120
  scanTimeoutSeconds  Camera turns off if no QR code is found in this time. Default: 45
  scanIntervalMs    How often frames are checked. Default: 200

Optional access restriction
  Uncomment the RequireAny block at the bottom of .htaccess and add the
  client's public IP, or use cPanel > Directory Privacy for a password.

Privacy
  QR content is decoded on the tablet only. No data is sent to the server
  and nothing is stored in the browser.
