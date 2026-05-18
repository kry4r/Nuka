import { writeFile, rename, unlink } from 'node:fs/promises'
import { stringify as stringifyYaml } from 'yaml'

/**
 * Atomic YAML write: stringify → write to `<path>.tmp` (mode 0o600) →
 * rename(tmp, path). If `writeFile` or `rename` throws, we attempt to
 * clean up the tmp file (best-effort) and re-raise the original error so
 * the on-disk target is left untouched.
 *
 * Caveat: this is "atomic on the same filesystem" — `rename` across
 * filesystems is not POSIX-atomic. For Nuka's `~/.nuka/` use case both
 * paths share the parent dir, so this is sound.
 */
export async function atomicWriteYaml(
  filePath: string,
  obj: unknown,
): Promise<void> {
  const tmpPath = filePath + '.tmp'
  const text = stringifyYaml(obj)
  try {
    await writeFile(tmpPath, text, { encoding: 'utf8', mode: 0o600 })
    await rename(tmpPath, filePath)
  } catch (err) {
    try { await unlink(tmpPath) } catch { /* swallow: tmp may not exist */ }
    throw err
  }
}
