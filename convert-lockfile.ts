import fs from 'fs/promises';
import { nameVerFromPkgSnapshot, pkgSnapshotToResolution } from '@pnpm/lockfile-utils';
import { readWantedLockfile } from '@pnpm/lockfile-file';

const LATEST_SUPPORTED_PNPM_LOCK_VERSION = 9.0;

export async function parseLockfile(pkgPath: string) {
  const lock = await readWantedLockfile(pkgPath, { ignoreIncompatible: true });
  if (lock == null) throw new Error('pnpm lockfile not found');

  if (parseFloat(lock.lockfileVersion) > LATEST_SUPPORTED_PNPM_LOCK_VERSION)
    console.warn(
      `Your lockfile version (${lock.lockfileVersion}) is higher than the supported version of pnpm-lock-export (${LATEST_SUPPORTED_PNPM_LOCK_VERSION}).`
    );

  return lock;
}

async function convertPnpmLockToNpmLock() {
  try {
    // Read the pnpm-lock.yaml file
    // const pnpmLockContent = await fs.readFile(pnpmLockPath, 'utf8');
    // const pnpmLock = yaml.parse(pnpmLockContent);

    const pnpmLock = await parseLockfile('.');

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

      // Parse package name and version
      // let [name3, version2] = pkgPath.slice(0).split('@');
      // let name2 = name3
      // console.log(pkgPath, name3, version2)

      let { name, version } = nameVerFromPkgSnapshot(pkgPath, pnpmLock.packages[pkgPath]);

      console.log(pkgPath, name, version)
      const resolution = pkgSnapshotToResolution(pkgPath, pnpmLock.packages[pkgPath], { default: 'https://registry.npmjs.org/' });
      console.log(resolution, '\n')
      // if (pkgPath.startsWith('@')) {
      //   const parts = pkgPath.slice(1).split('@');
      //   name = '@' + parts[0];
      //   name2 = name.split('/')[1]
      //   version = parts[1];
      //   // console.log(pkgPath, name, version)
      // }

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
