const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

class Store {
  constructor() {
    this.userDataPath = app.getPath('userData');
    this.configPath = path.join(this.userDataPath, 'config.json');
    this.securePath = path.join(this.userDataPath, 'secure.json');
    this.data = this._loadFile(this.configPath);
  }

  _loadFile(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return {};
    }
  }

  _saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2));
    } catch { /* disk full / permissions – non-fatal */ }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this._saveConfig();
  }

  delete(key) {
    delete this.data[key];
    this._saveConfig();
  }

  setSecure(key, value) {
    const secureData = this._loadFile(this.securePath);

    if (safeStorage.isEncryptionAvailable()) {
      secureData[key] = safeStorage.encryptString(value).toString('base64');
      secureData[`${key}__enc`] = true;
    } else {
      secureData[key] = value;
      secureData[`${key}__enc`] = false;
    }

    try {
      fs.writeFileSync(this.securePath, JSON.stringify(secureData, null, 2));
    } catch { /* non-fatal */ }
  }

  getSecure(key) {
    const secureData = this._loadFile(this.securePath);
    if (secureData[key] == null) return null;

    if (secureData[`${key}__enc`] && safeStorage.isEncryptionAvailable()) {
      const buffer = Buffer.from(secureData[key], 'base64');
      return safeStorage.decryptString(buffer);
    }

    return secureData[key];
  }

  deleteSecure(key) {
    const secureData = this._loadFile(this.securePath);
    delete secureData[key];
    delete secureData[`${key}__enc`];
    try {
      fs.writeFileSync(this.securePath, JSON.stringify(secureData, null, 2));
    } catch { /* non-fatal */ }
  }
}

module.exports = { Store };
