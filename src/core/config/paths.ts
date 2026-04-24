import os from 'node:os'
import path from 'node:path'

export function globalConfigDir(): string {
  return path.join(os.homedir(), '.nuka')
}

export function globalConfigPath(): string {
  return path.join(globalConfigDir(), 'config.yaml')
}

export function projectConfigPath(cwd: string): string {
  return path.join(cwd, '.nuka', 'config.yaml')
}

export function marketplacesPath(home: string): string {
  return path.join(home, '.nuka', 'marketplaces.json')
}
