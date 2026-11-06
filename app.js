/*
 * Care Scanner
 * Scans a QR code containing (one value per line):
 *   1. Name of deceased
 *   2. Date of birth
 *   3. Date of death
 *   4. Funeral details URL
 *
 * All decoding happens on the device. Nothing is sent to the server.
 */
(function () {
  'use strict';

  // ---------------- Configuration ----------------
  var CONFIG = {
    // Only links on these exact hostnames will be opened.
    allowedHosts: ['efd.seker.co.uk'],
    // Clear the result screen and return to the start screen after this many seconds (0 = never).
    autoClearSeconds: 120,
    // Stop scanning and turn the camera off if no QR code is found within this many seconds (0 = never).
    scanTimeoutSeconds: 15,
    // How often to try decoding a frame (ms). Lower = faster but more battery.
    scanIntervalMs: 200
  };
  // ------------------------------------------------

  var $ = function (id) { return document.getElementById(id); };
  var video = $('video');
  var canvas = $('canvas');
  var ctx = canvas.getContext('2d', { willReadFrequently: true });

  var stream = null;
  var scanTimer = null;
  var clearTimer = null;
  var timeoutTimer = null;
  var detector = null;
  var currentUrl = null;
  var busy = false;

  // ---------- UI helpers ----------
  function setStatus(text) { $('status').textContent = text; }

  function showError(el, text) {
    el.textContent = text;
    el.hidden = !text;
  }

  function showView(name) {
    $('startView').hidden = name !== 'start';
    $('scanView').hidden = name !== 'scan';
    $('resultView').hidden = name !== 'result';
  }

  // ---------- Parsing ----------
  function parsePayload(text) {
    var lines = String(text)
      .split(/\r\n|\r|\n/)
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l.length > 0; });

    // Find the URL line wherever it is, then treat the remaining lines as name, DOB, DOD in order.
    var urlIndex = -1;
    for (var i = 0; i < lines.length; i++) {
      if (/^https?:\/\//i.test(lines[i])) { urlIndex = i; break; }
    }
    var url = urlIndex >= 0 ? lines[urlIndex] : null;
    var rest = lines.filter(function (_, idx) { return idx !== urlIndex; });

    return {
      name: rest[0] || '',
      dob: rest[1] || '',
      dod: rest[2] || '',
      url: url
    };
  }

  function validateUrl(raw) {
    if (!raw) return { ok: false, reason: 'No funeral details link was found in this QR code.' };
    var u;
    try { u = new URL(raw); } catch (e) {
      return { ok: false, reason: 'The link in this QR code is not valid.' };
    }
    if (u.protocol !== 'https:') {
      return { ok: false, reason: 'The link in this QR code is not secure (https) and has been blocked.' };
    }
    var host = u.hostname.toLowerCase();
    if (CONFIG.allowedHosts.indexOf(host) === -1) {
      return { ok: false, reason: 'This QR code links to an unapproved website (' + host + ') and has been blocked.' };
    }
    return { ok: true, url: u.href };
  }

  // ---------- Result handling ----------
  function handleResult(text) {
    stopCamera();
    if (navigator.vibrate) { try { navigator.vibrate(100); } catch (e) { /* ignore */ } }

    var data = parsePayload(text);
    $('fName').textContent = data.name || '-';
    $('fDob').textContent = data.dob || '-';
    $('fDod').textContent = data.dod || '-';

    var check = validateUrl(data.url);
    currentUrl = check.ok ? check.url : null;
    $('openBtn').disabled = !check.ok;
    showError($('urlWarning'), check.ok ? '' : check.reason);

    showView('result');
    setStatus('Code scanned');
    $('openBtn').focus();

    if (CONFIG.autoClearSeconds > 0) {
      clearTimeout(clearTimer);
      clearTimer = setTimeout(goToStart, CONFIG.autoClearSeconds * 1000);
    }
  }

  function clearResult() {
    clearTimeout(clearTimer);
    currentUrl = null;
    $('fName').textContent = '-';
    $('fDob').textContent = '-';
    $('fDod').textContent = '-';
    showError($('urlWarning'), '');
  }

  // Clear everything and return to the start screen (camera off).
  function goToStart() {
    stopCamera();
    clearResult();
    showView('start');
    setStatus('Ready');
  }

  // Clear any previous result and open the scanner.
  function openScanner() {
    clearResult();
    showError($('scanError'), '');
    showView('scan');
    startCamera();
  }

  // ---------- Decoding ----------
  function initDetector() {
    if (!('BarcodeDetector' in window)) return Promise.resolve(null);
    return window.BarcodeDetector.getSupportedFormats()
      .then(function (formats) {
        return formats.indexOf('qr_code') !== -1
          ? new window.BarcodeDetector({ formats: ['qr_code'] })
          : null;
      })
      .catch(function () { return null; });
  }

  function decodeWithJsQR() {
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    // Downscale large frames for speed.
    var scale = Math.min(1, 800 / Math.max(vw, vh));
    var w = Math.round(vw * scale), h = Math.round(vh * scale);
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    var img = ctx.getImageData(0, 0, w, h);
    var code = window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
    return code && code.data ? code.data : null;
  }

  function scanFrame() {
    if (busy || !stream || video.readyState < 2) return;
    busy = true;

    var done = function (text) {
      busy = false;
      if (text && stream) handleResult(text);
    };

    if (detector) {
      detector.detect(video)
        .then(function (codes) {
          done(codes && codes.length ? codes[0].rawValue : null);
        })
        .catch(function () {
          // Native detector failed; fall back to jsQR permanently.
          detector = null;
          done(null);
        });
    } else {
      var text = null;
      try { text = decodeWithJsQR(); } catch (e) { text = null; }
      done(text);
    }
  }

  // ---------- Camera ----------
  function startCamera() {
    if (stream) return;

    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showView('start');
      setStatus('Camera unavailable');
      showError($('scanError'), 'The camera can only be used when this page is opened over https.');
      return;
    }

    setStatus('Starting camera...');
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    })
      .then(function (s) {
        stream = s;
        video.srcObject = s;
        return video.play();
      })
      .then(function () {
        setStatus('Scanning...');
        clearInterval(scanTimer);
        scanTimer = setInterval(scanFrame, CONFIG.scanIntervalMs);
        if (CONFIG.scanTimeoutSeconds > 0) {
          clearTimeout(timeoutTimer);
          timeoutTimer = setTimeout(scanTimedOut, CONFIG.scanTimeoutSeconds * 1000);
        }
      })
      .catch(function (err) {
        stopCamera();
        setStatus('Camera unavailable');
        var msg = 'Could not start the camera.';
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
          msg = 'Camera access was blocked. Allow camera access for this site in Edge settings, then try again.';
        } else if (err && err.name === 'NotFoundError') {
          msg = 'No camera was found on this device.';
        } else if (err && err.name === 'NotReadableError') {
          msg = 'The camera is in use by another app. Close it and try again.';
        }
        showView('start');
        showError($('scanError'), msg);
      });
  }

  // No QR code found in time: turn the camera off and return to the start screen.
  function scanTimedOut() {
    goToStart();
    showError($('scanError'), 'No QR code was detected. Tap Scan QR code to try again.');
  }

  function stopCamera() {
    clearTimeout(timeoutTimer);
    timeoutTimer = null;
    clearInterval(scanTimer);
    scanTimer = null;
    busy = false;
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    video.srcObject = null;
  }

  // ---------- Events ----------
  $('openBtn').addEventListener('click', function () {
    if (!currentUrl) return;
    window.open(currentUrl, '_blank', 'noopener,noreferrer');
  });

  $('scanBtn').addEventListener('click', openScanner);
  $('againBtn').addEventListener('click', openScanner);
  $('cancelBtn').addEventListener('click', goToStart);

  // Release the camera when the tab is in the background, resume when it returns.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopCamera();
    } else if (!$('scanView').hidden) {
      startCamera();
    }
  });

  // Hide the logo if logo.jpg has not been uploaded.
  var logo = $('logo');
  var hideLogo = function () { logo.hidden = true; };
  logo.addEventListener('error', hideLogo);
  if (logo.complete && logo.naturalWidth === 0) hideLogo();

  // ---------- Start ----------
  if (typeof window.jsQR !== 'function') {
    setStatus('Error');
    $('scanBtn').disabled = true;
    showError($('scanError'), 'The QR decoder (jsQR.js) failed to load. Check it has been uploaded alongside index.html.');
    return;
  }

  // Camera only starts when the Scan QR code button is pressed.
  initDetector().then(function (d) { detector = d; });

  // Exposed for testing only.
  window.__careScanner = { parsePayload: parsePayload, validateUrl: validateUrl };
})();
