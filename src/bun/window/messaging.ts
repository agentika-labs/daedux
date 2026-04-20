import {
  getIsMainViewReady,
  getMainWindow,
  getPendingWebviewMessages,
} from "../app/state";
import { log } from "../utils/log";

// ─── Webview Messaging ──────────────────────────────────────────────────────

/**
 * Dispatch a message to the webview, queuing it if the view isn't ready yet.
 */
export const dispatchToWebview = (send: () => void) => {
  const isMainViewReady = getIsMainViewReady();
  const mainWindow = getMainWindow();
  const pendingWebviewMessages = getPendingWebviewMessages();

  if (!isMainViewReady || !mainWindow) {
    pendingWebviewMessages.push(send);
    return;
  }

  try {
    send();
  } catch (error) {
    log.warn("rpc", "Failed to send message to webview", error);
  }
};

/**
 * Flush all pending webview messages after the view becomes ready.
 */
export const flushPendingWebviewMessages = () => {
  const isMainViewReady = getIsMainViewReady();
  const mainWindow = getMainWindow();
  const pendingWebviewMessages = getPendingWebviewMessages();

  if (!isMainViewReady || !mainWindow) {
    return;
  }

  const queued = pendingWebviewMessages.splice(0);
  for (const send of queued) {
    try {
      send();
    } catch (error) {
      log.warn("rpc", "Failed to send queued message to webview", error);
    }
  }
};
