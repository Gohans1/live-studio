// The right column (under the picture on an upright phone): the note being written, then either the lists or the settings
import { useStudio } from "../engine/store";
import { Compose } from "./Compose";
import { NoteList } from "./NoteList";
import { Settings } from "./Settings";

export function Side() {
  const settingsOpen = useStudio((s) => s.settingsOpen);
  return (
    <aside className="col-start-2 row-span-3 row-start-1 flex min-h-0 flex-col border-s upright:flex-1 upright:border-s-0">
      <Compose />
      {settingsOpen ? <Settings /> : <NoteList />}
    </aside>
  );
}
