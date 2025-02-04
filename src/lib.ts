import { getLockfileImporterId, Lockfile, ProjectSnapshot, readWantedLockfile } from '@pnpm/lockfile-file';
import { overridePublishConfig } from './overridePublishConfig'
import { PnpmError } from '@pnpm/error'
import { CatalogResolver, resolveFromCatalog } from '@pnpm/catalogs.resolver'
import { tryReadProjectManifest } from '@pnpm/read-project-manifest'
import { Dependencies, DEPENDENCIES_FIELDS, type ProjectId, type ProjectManifest } from '@pnpm/types';
import { pruneSharedLockfile } from '@pnpm/prune-lockfile';
import { omit, pMapValues } from './lodash'
import { type Catalogs } from '@pnpm/catalogs.types'
import { replaceWorkspaceProtocol, replaceWorkspaceProtocolPeerDependency } from './replaceWorkspaceProtocol';

const PREPUBLISH_SCRIPTS = [
  'prepublishOnly',
  'prepack',
  'prepare',
  'postpack',
  'publish',
  'postpublish',
]

export interface MakePublishManifestOptions {
  catalogs: Catalogs
  modulesDir?: string
  readmeFile?: string
}

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

// From https://github.com/pnpm/pnpm/blob/main/packages/make-dedicated-lockfile/src/index.ts
export async function dedicatedLockfile(lockfileDir: string, projectDir: string): Promise<Lockfile> {
  const lockfile = await parseLockfile(lockfileDir);

  const allImporters = lockfile.importers
  lockfile.importers = {}
  const baseImporterId = getLockfileImporterId(lockfileDir, projectDir)
  console.log('allImporters', allImporters)
  console.log('baseImportedId', baseImporterId)
  for (const [importerId, importer] of Object.entries(allImporters)) {
    // if (importerId.startsWith(`${baseImporterId}/`)) {
    const newImporterId = importerId.slice(baseImporterId.length + 1) as ProjectId
    lockfile.importers[newImporterId] = projectSnapshotWithoutLinkedDeps(importer)
    // continue
    // }
    if (importerId === baseImporterId) {
      lockfile.importers['.' as ProjectId] = projectSnapshotWithoutLinkedDeps(importer)
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

// From https://github.com/pnpm/pnpm/blob/main/pkg-manifest/exportable-manifest/src/index.ts
export async function readAndCheckManifest(dependencyDir: string): Promise<ProjectManifest> {
  const { manifest } = await tryReadProjectManifest(dependencyDir)
  // console.log('readAndCheckManifest', manifest)
  if (!manifest?.name) {
    throw new PnpmError(
      'CANNOT_RESOLVE_WORKSPACE_PROTOCOL',
      `Cannot resolve workspace protocol of dependency` +
      'because this dependency is not installed. Try running "pnpm install".'
    )
  }
  return manifest
}

// From https://github.com/pnpm/pnpm/blob/main/pkg-manifest/exportable-manifest/src/index.ts
export async function createExportableManifest(
  dir: string,
  originalManifest: ProjectManifest,
  opts: MakePublishManifestOptions
): Promise<ProjectManifest> {
  const publishManifest: ProjectManifest = omit(['pnpm', 'scripts', 'packageManager'], originalManifest)
  if (originalManifest.scripts != null) {
    publishManifest.scripts = omit(PREPUBLISH_SCRIPTS, originalManifest.scripts)
  }

  const catalogResolver = resolveFromCatalog.bind(null, opts.catalogs)
  const replaceCatalogProtocol = resolveCatalogProtocol.bind(null, catalogResolver)

  const convertDependencyForPublish = combineConverters(replaceWorkspaceProtocol, replaceCatalogProtocol)
  await Promise.all((['dependencies', 'devDependencies', 'optionalDependencies'] as const).map(async (depsField) => {
    const deps = await makePublishDependencies(dir, originalManifest[depsField], {
      modulesDir: opts?.modulesDir,
      convertDependencyForPublish,
    })
    if (deps != null) {
      publishManifest[depsField] = deps
    }
  }))

  const peerDependencies = originalManifest.peerDependencies
  if (peerDependencies) {
    const convertPeersForPublish = combineConverters(replaceWorkspaceProtocolPeerDependency, replaceCatalogProtocol)
    publishManifest.peerDependencies = await makePublishDependencies(dir, peerDependencies, {
      modulesDir: opts?.modulesDir,
      convertDependencyForPublish: convertPeersForPublish,
    })
  }

  overridePublishConfig(publishManifest)

  if (opts?.readmeFile) {
    publishManifest.readme ??= opts.readmeFile
  }

  return publishManifest
}

function resolveCatalogProtocol(catalogResolver: CatalogResolver, alias: string, pref: string): string {
  const result = catalogResolver({ alias, pref })

  switch (result.type) {
    case 'found': return result.resolution.specifier
    case 'unused': return pref
    case 'misconfiguration': throw result.error
  }
}

export type PublishDependencyConverter = (
  depName: string,
  depSpec: string,
  dir: string,
  modulesDir?: string
) => Promise<string> | string

function combineConverters(...converters: readonly PublishDependencyConverter[]): PublishDependencyConverter {
  return async (depName, depSpec, dir, modulesDir) => {
    let pref = depSpec
    for (const converter of converters) {
      // eslint-disable-next-line no-await-in-loop
      pref = await converter(depName, pref, dir, modulesDir)
    }
    return pref
  }
}

export interface MakePublishDependenciesOpts {
  readonly modulesDir?: string
  readonly convertDependencyForPublish: PublishDependencyConverter
}

async function makePublishDependencies(
  dir: string,
  dependencies: Dependencies | undefined,
  { modulesDir, convertDependencyForPublish }: MakePublishDependenciesOpts
): Promise<Dependencies | undefined> {
  if (dependencies == null) return dependencies
  const publishDependencies = await pMapValues(
    async (depSpec, depName) => convertDependencyForPublish(depName, depSpec, dir, modulesDir),
    dependencies
  )
  return publishDependencies
}

