// test/build/_constants.ts
//
// Single source of truth for the dist/cli.js bundle-size ceiling.
// Updated here first; ci.yml and tests import / reference this value.

/** Maximum allowed size of dist/cli.js in bytes.
 *
 * History:
 *   - Phase P2 #12 (2026-05-17): 440 → 720 KB
 *   - B5 (2026-05-18): 720 → 744 KB  (coordinate_agents tool added)
 */
export const CLI_BUNDLE_CEILING_BYTES = 744 * 1024 // bumped from 720 by B5 (2026-05-18)
