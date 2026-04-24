chrome.action.onClicked.addListener((tab) => {
  chrome.scripting
    .insertCSS({ target: { tabId: tab.id }, files: ["styles.css"] })
    .catch(() => {});
  chrome.scripting
    .executeScript({ target: { tabId: tab.id }, files: ["content-utils.js", "content.js"] })
    .catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (msg.type === "inject") {
    chrome.scripting
      .insertCSS({ target: { tabId: msg.tabId }, files: ["styles.css"] })
      .catch(() => {});
    chrome.scripting
      .executeScript({
        target: { tabId: msg.tabId },
        files: ["content-utils.js", "content.js"],
      })
      .catch(() => {});
  }
});
