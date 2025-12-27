// content.js
// Lightweight DOM fallback: look for m3u8/mpd/mp4 URLs embedded in the page HTML or elements and store them as fallbackUrls.

(function() {
    try {
      const html = document.documentElement && document.documentElement.innerHTML || '';
      const found = new Set();
  
      // Find obvious manifest/file urls in HTML text
      for (const m of html.matchAll(/https?:\/\/[^"'<> ]+\.(m3u8|mpd|mp4)(\?[^\s'"]*)?/gi)) {
        if (m && m[0]) found.add(m[0]);
      }
  
      // Look in common element attributes (src, data-src, href)
      const els = Array.from(document.querySelectorAll('[src],[data-src],[href]'));
      els.forEach(el => {
        const attrs = ['src','data-src','href'];
        for (const a of attrs) {
          try {
            const v = el.getAttribute && el.getAttribute(a);
            if (v && /\.(m3u8|mpd|mp4)(\?|$)/i.test(v)) {
              // make absolute if needed
              const absolute = new URL(v, location.href).href;
              found.add(absolute);
            }
          } catch (e) {}
        }
      });
  
      if (found.size) {
        chrome.storage.local.get({ fallbackUrls: [] }, (data) => {
          const arr = new Set(data.fallbackUrls || []);
          for (const u of found) arr.add(u);
          chrome.storage.local.set({ fallbackUrls: Array.from(arr) });
        });
      }
    } catch (e) {
      // ignore
    }
  })();
  