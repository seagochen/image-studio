import { DEFAULT_SHORTCUTS, bindConfiguredShortcuts, configuredShortcutAction, loadShortcuts, saveShortcuts, validateBindings, validShortcut } from "../domain/shortcutSettings";
const event = (key: string, options: KeyboardEventInit = {}) => new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true,...options});
describe("Configurable Image Studio shortcuts", () => {
  it("validates conflicts, reserved browser keys and the legacy redo alias", () => {
    expect(validateBindings(DEFAULT_SHORTCUTS)).toBe(true);
    expect(validateBindings({...DEFAULT_SHORTCUTS,brush:"e"})).toBe(false);
    expect(validateBindings({...DEFAULT_SHORTCUTS,brush:"Mod+y"})).toBe(false);
    for(const value of ["Mod+w","Mod+Shift+t","Alt+b","Tab","Escape","Mod+v"]) expect(validShortcut(value)).toBe(false);
    expect(configuredShortcutAction(event("y",{ctrlKey:true}),DEFAULT_SHORTCUTS)).toBe("redo");
    expect(configuredShortcutAction(event("y",{ctrlKey:true}),{...DEFAULT_SHORTCUTS,redo:"Mod+b"})).toBeNull();
  });
  it("persists custom and cleared bindings and falls back on malformed storage", () => {
    let json = "";const storage = {getItem:()=>json,setItem:(_key:string,value:string)=>{json=value;}};
    const changed = {...DEFAULT_SHORTCUTS,brush:"Shift+b",eraser:""};saveShortcuts(changed,storage);expect(loadShortcuts(storage)).toEqual(changed);
    json='{"version":1,"bindings":{}}';expect(loadShortcuts(storage)).toEqual(DEFAULT_SHORTCUTS);
    expect(loadShortcuts({getItem:()=>{throw Error("denied");}})).toEqual(DEFAULT_SHORTCUTS);
  });
  it("customizes actual canvas actions without capturing text, IME, AltGr or browser keys", () => {
    document.body.innerHTML='<div tabindex="0" id="canvas"></div><input id="name">';
    const surface=document.getElementById("canvas")!, input=document.getElementById("name")!, execute=jest.fn();
    const dispose=bindConfiguredShortcuts(surface,{...DEFAULT_SHORTCUTS,brush:"Shift+b"},execute);
    surface.focus();surface.dispatchEvent(event("B",{shiftKey:true}));expect(execute).toHaveBeenLastCalledWith("brush");execute.mockClear();
    for(const e of [event("b"),event("b",{shiftKey:true,isComposing:true}),event("b",{shiftKey:true,altKey:true,ctrlKey:true}),event("r",{ctrlKey:true}),event("B",{shiftKey:true,repeat:true})]) {surface.dispatchEvent(e);expect(e.defaultPrevented).toBe(false);}
    input.focus();input.dispatchEvent(event("B",{shiftKey:true}));expect(execute).not.toHaveBeenCalled();
    dispose();surface.focus();surface.dispatchEvent(event("B",{shiftKey:true}));expect(execute).not.toHaveBeenCalled();
  });
});
