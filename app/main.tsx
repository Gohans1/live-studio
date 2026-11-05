import "./index.css";
import { createRoot } from "react-dom/client";
import { stored } from "./engine/env";
import { onEvent, onHello } from "./events";

const root = document.getElementById("root")!;
// Chrome, Firefox and Safari each word a module that could not be downloaded differently, but all as a TypeError about importing
const notDownloaded = (e: unknown) => e instanceof TypeError && /import/i.test(e.message);
// The film's own code loads with the app: a film that throws while loading stops it before React starts. Say so, and come
// back once the film is fixed. A page that lost the line halfway tries again by itself a few times first
const showFailure = (error: unknown) => {
  const tries = Number(stored.get("pageTries", sessionStorage)) || 0;
  if (notDownloaded(error) && tries < 3 && stored.set("pageTries", String(tries + 1), sessionStorage)) return location.reload();
  const box = document.createElement("pre");
  box.className = "m-3 overflow-auto rounded-lg bg-alarm-bg p-3 font-mono text-sm whitespace-pre-wrap text-foreground";
  const why = notDownloaded(error) ? "Không tải được trang. Kiểm tra mạng rồi tải lại." : "Phim lỗi khi tải, sửa xong là trang tự tải lại.";
  box.textContent = `${why}\n\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
  root.replaceChildren(box);
  for (const event of ["code", "edit"]) onEvent(event, () => location.reload());
  onHello((current) => { if (!current) location.reload(); }); // the studio restarted with other code while this page was down
};

try {
  const { App } = await import("./App");
  stored.remove("pageTries", sessionStorage);
  // A component that throws takes React's whole tree down with it: show why instead of an empty page
  createRoot(root, { onUncaughtError: showFailure }).render(<App />);
} catch (e) {
  showFailure(e);
}
