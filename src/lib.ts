import {
  DEPENDENCIES_FIELDS,
  type ProjectId,
  type ProjectManifest,
} from "@pnpm/types";
import { PnpmError } from "@pnpm/error";
import {
  getLockfileImporterId,
  type Lockfile,
  type ProjectSnapshot,
  readWantedLockfile,
} from "@pnpm/lockfile-file";
import { pruneSharedLockfile } from "@pnpm/prune-lockfile";
import { tryReadProjectManifest } from "@pnpm/read-project-manifest";
import type { Catalogs } from "@pnpm/catalogs.types";

export interface MakePublishManifestOptions {
  catalogs: Catalogs;
  modulesDir?: string;
  readmeFile?: string;
}

const LATEST_SUPPORTED_PNPM_LOCK_VERSION = 9.0;

export async function parseLockfile(pkgPath: string) {
  const lock = await readWantedLockfile(pkgPath, { ignoreIncompatible: true });
  if (lock == null) throw new Error("pnpm lockfile not found");

  if (
    Number.parseFloat(lock.lockfileVersion) > LATEST_SUPPORTED_PNPM_LOCK_VERSION
  )
    console.warn(
      `Your lockfile version (${lock.lockfileVersion}) is higher than the supported version of pnpm-lock-export (${LATEST_SUPPORTED_PNPM_LOCK_VERSION}).`,
    );

  return lock;
}

// From https://github.com/pnpm/pnpm/blob/main/packages/make-dedicated-lockfile/src/index.ts
export async function dedicatedLockfile(
  lockfileDir: string,
  projectDir: string,
): Promise<Lockfile> {
  const lockfile = await parseLockfile(lockfileDir);

  const allImporters = lockfile.importers;
  lockfile.importers = {};
  const baseImporterId = getLockfileImporterId(lockfileDir, projectDir);
  for (const [importerId, importer] of Object.entries(allImporters)) {
    const newImporterId = importerId.slice(
      baseImporterId.length + 1,
    ) as ProjectId;
    lockfile.importers[newImporterId] =
      projectSnapshotWithoutLinkedDeps(importer);

    if (importerId === baseImporterId) {
      lockfile.importers["." as ProjectId] =
        projectSnapshotWithoutLinkedDeps(importer);
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
      Object.entries(projectSnapshot[depField] ?? {}).filter(
        (entry) => !entry[1].startsWith("link:"),
      ),
    );
  }
  return newProjectSnapshot;
}

// From https://github.com/pnpm/pnpm/blob/main/pkg-manifest/exportable-manifest/src/index.ts
export async function readAndCheckManifest(
  dependencyDir: string,
): Promise<ProjectManifest> {
  const { manifest } = await tryReadProjectManifest(dependencyDir);

  if (!manifest?.name) {
    throw new PnpmError(
      "CANNOT_RESOLVE_WORKSPACE_PROTOCOL",
      'Cannot resolve workspace protocol of dependency' +
      'because this dependency is not installed. Try running "pnpm install".',
    );
  }
  return manifest;
}
