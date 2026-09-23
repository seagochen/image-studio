import { isEditableTarget } from "../../../shared/browser";
import { trapDialogFocus } from "../studio/dialogFocus";

describe("Image Studio accessibility", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("recognizes form and content-editable targets so global shortcuts do not capture typing", () => {
    document.body.innerHTML = '<input id="input"><textarea id="area"></textarea><select id="select"></select><div id="editor" contenteditable="true"></div><button id="button"></button>';
    for (const id of ["input", "area", "select", "editor"]) expect(isEditableTarget(document.getElementById(id))).toBe(true);
    expect(isEditableTarget(document.getElementById("button"))).toBe(false);
  });

  it("wraps keyboard focus within a modal dialog", () => {
    document.body.innerHTML = '<section id="dialog"><button id="first">First</button><button id="last">Last</button></section>';
    const dialog = document.getElementById("dialog")!;
    const first = document.getElementById("first") as HTMLButtonElement;
    const last = document.getElementById("last") as HTMLButtonElement;
    last.focus();
    const forward = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    trapDialogFocus(forward, dialog);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    const backward = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true });
    trapDialogFocus(backward, dialog);
    expect(document.activeElement).toBe(last);
  });
});
