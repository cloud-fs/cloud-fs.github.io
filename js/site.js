/* CloudDrive2 site behaviour: mobile nav, theme toggle, latest-release links.
   Every part is an enhancement — the pages work without any of it. */
(function () {
  'use strict';

  document.documentElement.classList.add('js');

  /* ── mobile navigation ──────────────────────────────────────────────── */
  var toggle = document.querySelector('.nav-toggle');
  var menu = document.getElementById('nav-menu');

  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      var open = menu.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) {
        menu.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
  }

  /* ── theme toggle (the pre-paint value is applied by an inline snippet) ─ */
  var themeBtn = document.querySelector('.theme-toggle');

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var root = document.documentElement;
      var current = root.getAttribute('data-theme');
      if (!current) {
        current = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      var next = current === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('cd2-theme', next); } catch (e) {}
    });
  }

  /* ── copy buttons on code blocks ────────────────────────────────────── */
  /* Injected rather than authored into the markup, so a page without
     scripting never shows a button that cannot do anything. */
  var blocks = document.querySelectorAll('.code-block > pre');

  if (blocks.length && navigator.clipboard) {
    var zh = (document.documentElement.lang || '').toLowerCase().indexOf('zh') === 0;
    var LABEL = zh ? '复制' : 'Copy';
    var DONE = zh ? '已复制' : 'Copied';
    var ARIA = zh ? '复制这段代码' : 'Copy this code';

    Array.prototype.forEach.call(blocks, function (pre) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-btn';
      btn.textContent = LABEL;
      btn.setAttribute('aria-label', ARIA);

      btn.addEventListener('click', function () {
        navigator.clipboard.writeText(pre.textContent).then(function () {
          btn.textContent = DONE;
          btn.setAttribute('data-copied', '');
          setTimeout(function () {
            btn.textContent = LABEL;
            btn.removeAttribute('data-copied');
          }, 1800);
        });
      });

      pre.parentNode.appendChild(btn);
    });
  }

  /* ── latest release ─────────────────────────────────────────────────── */
  /* Upgrades the hard-coded download links to whatever the newest GitHub
     release ships. If anything fails, the static links stay as authored. */
  if (!document.querySelector('[data-release]')) return;

  var PATTERNS = {
    'win-x64':       /^CloudDrive2Setup-X64-.*\.exe$/,
    'win-arm64':     /^CloudDrive2Setup-Arm64-.*\.exe$/,
    'linux-x64':     /^clouddrive-2-linux-x86_64-.*\.tgz$/,
    'linux-arm64':   /^clouddrive-2-linux-aarch64-.*\.tgz$/,
    'linux-armv7':   /^clouddrive-2-linux-armv7-.*\.tgz$/,
    'macos-x64':     /^clouddrive-2-macos-x86_64-.*\.tgz$/,
    'macos-arm64':   /^clouddrive-2-macos-aarch64-.*\.tgz$/,
    'android-apk':   /^clouddrive-2-android-universal-.*\.apk$/,
    'android-x64':   /^clouddrive-2-android-x86_64-.*\.tgz$/,
    'android-arm64': /^clouddrive-2-android-aarch64-.*\.tgz$/,
    'android-armv7': /^clouddrive-2-android-armv7-.*\.tgz$/,
    'fnos-x86':      /^clouddrive2_.*_x86\.fpk$/,
    'fnos-arm':      /^clouddrive2_.*_arm\.fpk$/
  };

  if (!window.fetch) return;

  fetch('https://api.github.com/repos/cloud-fs/cloud-fs.github.io/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' }
  })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function (release) {
      var assets = release.assets || [];
      if (!assets.length) return;

      Array.prototype.forEach.call(document.querySelectorAll('[data-asset]'), function (link) {
        var pattern = PATTERNS[link.getAttribute('data-asset')];
        if (!pattern) return;

        var match = null;
        for (var i = 0; i < assets.length; i++) {
          if (pattern.test(assets[i].name)) { match = assets[i]; break; }
        }
        if (!match) return;

        link.href = match.browser_download_url;
        var name = link.querySelector('[data-asset-name]');
        if (name) name.textContent = match.name;
      });

      Array.prototype.forEach.call(document.querySelectorAll('[data-release-version]'), function (el) {
        el.textContent = release.tag_name;
      });
      Array.prototype.forEach.call(document.querySelectorAll('[data-release-link]'), function (el) {
        el.href = release.html_url;
      });
    })
    .catch(function () { /* static links remain in place */ });
})();
