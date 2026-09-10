// Opens the side panel when the toolbar icon is clicked and hands out tab
// capture stream IDs to the panel (the panel asks here if it cannot get one itself).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'tab-stream-id') return false;
  chrome.tabCapture.getMediaStreamId({ targetTabId: msg.tabId })
    .then(id => sendResponse({ id }))
    .catch(e => sendResponse({ error: e && e.message ? e.message : String(e) }));
  return true;
});
