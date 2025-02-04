import { getLockfileImporterId, Lockfile, ProjectSnapshot, readWantedLockfile } from '@pnpm/lockfile-file';
import { DEPENDENCIES_FIELDS } from '@pnpm/types';
import { pruneSharedLockfile } from '@pnpm/prune-lockfile';


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

export async function dedicatedLockfile(lockfileDir: string, projectDir: string): Promise<Lockfile> {
  const lockfile = await parseLockfile(lockfileDir);

  const allImporters = lockfile.importers;
  lockfile.importers = {};
  const baseImporterId = getLockfileImporterId(lockfileDir, projectDir);
  // console.log('allImporters', allImporters)
  for (const [importerId, importer] of Object.entries(allImporters)) {
    if (importerId.startsWith(`${baseImporterId}/`)) {
      const newImporterId = importerId.slice(baseImporterId.length + 1);
      lockfile.importers[newImporterId] = projectSnapshotWithoutLinkedDeps(importer);
      continue;
    }
    if (importerId === baseImporterId) {
      lockfile.importers['.'] = projectSnapshotWithoutLinkedDeps(importer);
    }
  }

  return pruneSharedLockfile(lockfile);
}

// From https://github.com/pnpm/pnpm/blob/main/packages/make-dedicated-lockfile/src/index.ts
function projectSnapshotWithoutLinkedDeps(projectSnapshot: ProjectSnapshot) {
  const newProjectSnapshot: ProjectSnapshot = {
    specifiers: projectSnapshot.specifiers,
  };

  for (const depField of DEPENDENCIES_FIELDS) {
    if (projectSnapshot[depField] == null) continue;
    newProjectSnapshot[depField] = Object.fromEntries(
      Object.entries(projectSnapshot[depField] ?? {}).filter((entry) => !entry[1].startsWith('link:'))
    );
  }
  return newProjectSnapshot;
}
