// background.js
// Capture network requests for likely media manifests/files and store them per tab.

const MEDIA_URL_RE = /\.(m3u8|mpd|mp4)(\?|$)/i;
const MANIFEST_HINT_RE = /manifest|playlist|fragmented/i; // extra hint

function storeUrlForTab(tabId, url) {
  if (!tabId || tabId < 0 || !url) return;
  chrome.storage.local.get({ capturedByTab: {} }, (data) => {
    const map = data.capturedByTab || {};
    const list = new Set(map[tabId] || []);
    list.add(url);
    map[tabId] = Array.from(list);
    chrome.storage.local.set({ capturedByTab: map });
  });
}

// onBeforeRequest: catch URLs as they're requested
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    try {
      const { url, tabId } = details;
      if (!url) return;
      if (MEDIA_URL_RE.test(url) || MANIFEST_HINT_RE.test(url)) {
        storeUrlForTab(tabId, url);
      }
    } catch (e) {
      console.warn('bg onBeforeRequest error', e);
    }
  },
  {
    urls: [
      "*://*.panopto.com/*",
      "*://*.panopto.eu/*",
      "*://*.cloud.panopto.eu/*",
      "*://*.cloudfront.net/*",
      "*://*.divicast.com/*"
    ]
  },
  []
);

// onCompleted: capture via response headers too (content-type)
chrome.webRequest.onCompleted.addListener(
  (details) => {
    try {
      const { url, tabId, responseHeaders } = details;
      let ct = '';
      if (responseHeaders && responseHeaders.length) {
        for (const h of responseHeaders) {
          const name = (h.name || h.header || '').toLowerCase();
          if (name === 'content-type') { ct = h.value || ''; break; }
        }
      }
      if (MEDIA_URL_RE.test(url) || /mpegurl|dash|mp4|video|audio|mpeg/.test(ct)) {
        storeUrlForTab(tabId, url);
      }
    } catch (e) {
      console.warn('bg onCompleted error', e);
    }
  },
  {
    urls: [
      "*://*.panopto.com/*",
      "*://*.panopto.eu/*",
      "*://*.cloud.panopto.eu/*",
      "*://*.cloudfront.net/*",
      "*://*.divicast.com/*"
    ]
  },
  ["responseHeaders"]
);

// messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'getCapturedForTab') {
    const tabId = msg.tabId;
    chrome.storage.local.get({ capturedByTab: {}, fallbackUrls: [] }, (data) => {
      const map = data.capturedByTab || {};
      const fallback = data.fallbackUrls || [];
      const list = (tabId && map[tabId]) ? map[tabId] : [];
      sendResponse({ ok: true, list, fallback });
    });
    return true; // async
  }

  if (msg && msg.type === 'clearCapturedForTab') {
    const tabId = msg.tabId;
    chrome.storage.local.get({ capturedByTab: {} }, (data) => {
      const map = data.capturedByTab || {};
      delete map[tabId];
      chrome.storage.local.set({ capturedByTab: map }, () => sendResponse({ ok: true }));
    });
    return true;
  }

  if (msg && msg.type === 'getAllCaptured') {
    chrome.storage.local.get({ capturedByTab: {} }, (data) => sendResponse({ ok: true, capturedByTab: data.capturedByTab || {} }));
    return true;
  }
});
