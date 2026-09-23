module.exports = class WorkerMock {
  static instances = [];
  constructor() { this.listeners = new Map(); WorkerMock.instances.push(this); }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  postMessage(message) { this.lastMessage = message; }
  emit(message) { this.listeners.get("message")?.({ data: message }); }
  terminate() {}
};
