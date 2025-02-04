import fs from 'fs/promises';
import { nameVerFromPkgSnapshot, pkgSnapshotToResolution } from '@pnpm/lockfile-utils';
import { dedicatedLockfile } from './lib';


function sortObjectByKeys<T>(obj: { [key: string]: T }): { [key: string]: T } {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))
  );
}

async function convertPnpmLockToNpmLock() {
  try {
    // TODO: Make this CLI args
    const pnpmLock = await dedicatedLockfile('/opt/gitbutler/gitbutler', '/opt/gitbutler/gitbutler');
    const sortedPackages = sortObjectByKeys(pnpmLock.packages || {});
    // console.log('PNPM LOCK', sortedPackages);
    console.log('PNPM LOCK.dayjs', sortedPackages['dayjs@1.11.13']);
    console.log('PNPM LOCK.^dayjs', sortedPackages['dayjs@^1.11.13']);

    // TODO: use `createDedicatedManifest`
    // Initialize package-lock.json structure
    const packageLock = {
      name: 'gitbutler',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {},
      dependencies: {}
    };

    // Process each package in the lockfile
    for (const [pkgPath, pkgInfo] of Object.entries(pnpmLock.packages || {})) {
      // Skip the root package
      if (!pnpmLock.packages || pkgPath === '') continue;

      const { name, version } = nameVerFromPkgSnapshot(pkgPath, pnpmLock.packages[pkgPath]);
      if (name.includes('webdriver')) console.log('UNDICI', name, version)
      const resolution = pkgSnapshotToResolution(pkgPath, pnpmLock.packages[pkgPath], { default: 'https://registry.npmjs.org/' });

      // Create package entry
      const packageEntry = {
        version: version,
        resolved: resolution?.tarball,
        integrity: resolution?.integrity,
        requires: pkgInfo.dependencies || {},
        dependencies: {}
      };

      // Add to packages and dependencies
      packageLock.packages[`node_modules/${name}`] = packageEntry;
      packageLock.dependencies[name] = {
        version: version,
        resolved: packageEntry.resolved,
        integrity: packageEntry.integrity
      };

      // Process dependencies
      if (pkgInfo.dependencies) {
        for (const [depName, depVersion] of Object.entries(pkgInfo.dependencies)) {
          packageEntry.dependencies[depName] = {
            version: depVersion,
            requires: {}
          };
        }
      }
    }

    // Write the package-lock.json file
    await fs.writeFile('package-lock.json', JSON.stringify(packageLock, null, 2));
    console.log('Successfully converted pnpm-lock.yaml to package-lock.json');

  } catch (error) {
    console.error('Error converting lock file:', error);
    throw error;
  }
}

// Run the conversion
convertPnpmLockToNpmLock().catch(console.error);
