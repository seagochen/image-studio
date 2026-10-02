const NodeEnvironment = require("jest-environment-node").TestEnvironment;
const { JSDOM } = require("jsdom");

class DomEnvironment extends NodeEnvironment {
  async setup() {
    await super.setup();
    if (!this.global.crypto) this.global.crypto = require("crypto").webcrypto;

    this.dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://localhost/",
    });
    const browser = this.dom.window;
    this.global.window = this.global;
    this.global.document = browser.document;
    this.global.navigator = browser.navigator;
    this.global.location = browser.location;
    this.global.localStorage = browser.localStorage;
    for (const name of [
      "HTMLElement",
      "HTMLInputElement",
      "HTMLSelectElement",
      "HTMLButtonElement",
      "HTMLTableRowElement",
      "HTMLMediaElement",
      "HTMLAudioElement",
      "HTMLImageElement",
      "Event",
      "MouseEvent",
      "KeyboardEvent",
      "File",
      "Blob",
    ]) this.global[name] = browser[name];
  }

  async teardown() {
    this.dom?.window.close();
    await super.teardown();
  }
}

module.exports = DomEnvironment;
