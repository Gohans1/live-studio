import "./index.css";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root")!;
// The film's own code loads with the app: a film that throws while loading stops it before React starts. Say so, and come
// back once the film is fixed
const showFailure = (error: unknown) => {
  const box = document.createElement("pre");
  box.className = "m-3 overflow-auto rounded-lg bg-alarm-bg p-3 font-mono text-sm whitespace-pre-wrap text-foreground";
  box.textContent = `Phim lỗi khi tải, sửa xong là trang tự tải lại.\n\n${error instanceof Error ? error.stack ?? error.message : String(error)}`;
  root.replaceChildren(box);
  for (const event of ["live:code", "live:edit"]) import.meta.hot?.on(event, () => location.reload());
};

try {
  const { App } = await import("./App");
  createRoot(root).render(<App />);
} catch (e) {
  showFailure(e);
}
