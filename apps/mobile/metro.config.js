/* eslint-disable @typescript-eslint/no-require-imports */
// Метро-конфиг: @lithos/shared — TS-исходники с импортами вида './enums.js' (ESM для воркера).
// Metro не переписывает '.js' → '.ts', поэтому для файлов из packages/shared пробуем .ts первым.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
const sharedRoot = path.resolve(__dirname, '../../packages/shared');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js') && context.originModulePath.startsWith(sharedRoot)) {
    try {
      return context.resolveRequest(context, `${moduleName.slice(0, -3)}.ts`, platform);
    } catch {
      // нет .ts — обычный путь ниже
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
