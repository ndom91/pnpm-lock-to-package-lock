import { CatalogResolver } from '@pnpm/catalogs.resolver'

async function readAndCheckManifest(depName: string, dependencyDir: string): Promise<ProjectManifest> {
  const { manifest } = await tryReadProjectManifest(dependencyDir)
  if (!manifest?.name || !manifest?.version) {
    throw new PnpmError(
      'CANNOT_RESOLVE_WORKSPACE_PROTOCOL',
      `Cannot resolve workspace protocol of dependency "${depName}" ` +
      'because this dependency is not installed. Try running "pnpm install".'
    )
  }
  return manifest
}

function resolveCatalogProtocol(catalogResolver: CatalogResolver, alias: string, pref: string): string {
  const result = catalogResolver({ alias, pref })

  switch (result.type) {
    case 'found': return result.resolution.specifier
    case 'unused': return pref
    case 'misconfiguration': throw result.error
  }
}

export async function replaceWorkspaceProtocol(depName: string, depSpec: string, dir: string, modulesDir?: string): Promise<string> {
  if (!depSpec.startsWith('workspace:')) {
    return depSpec
  }

  // Dependencies with bare "*", "^" and "~" versions
  const versionAliasSpecParts = /^workspace:(.*?)@?([\^~*])$/.exec(depSpec)
  if (versionAliasSpecParts != null) {
    modulesDir = modulesDir ?? path.join(dir, 'node_modules')
    const manifest = await readAndCheckManifest(depName, path.join(modulesDir, depName))

    const semverRangeToken = versionAliasSpecParts[2] !== '*' ? versionAliasSpecParts[2] : ''
    if (depName !== manifest.name) {
      return `npm:${manifest.name!}@${semverRangeToken}${manifest.version}`
    }
    return `${semverRangeToken}${manifest.version}`
  }
  if (depSpec.startsWith('workspace:./') || depSpec.startsWith('workspace:../')) {
    const manifest = await readAndCheckManifest(depName, path.join(dir, depSpec.slice(10)))

    if (manifest.name === depName) return `${manifest.version}`
    return `npm:${manifest.name}@${manifest.version}`
  }
  depSpec = depSpec.slice(10)
  if (depSpec.includes('@')) {
    return `npm:${depSpec}`
  }
  return depSpec
}

export async function replaceWorkspaceProtocolPeerDependency(depName: string, depSpec: string, dir: string, modulesDir?: string) {
  if (!depSpec.includes('workspace:')) {
    return depSpec
  }

  // Dependencies with bare "*", "^", "~",">=",">","<=", "<", version
  const workspaceSemverRegex = /workspace:([\^~*]|>=|>|<=|<)?((\d+|[xX]|\*)(\.(\d+|[xX]|\*)){0,2})?/
  const versionAliasSpecParts = workspaceSemverRegex.exec(depSpec)

  if (versionAliasSpecParts != null) {
    const [, semverRangGroup = '', version] = versionAliasSpecParts

    if (version) {
      return depSpec.replace('workspace:', '')
    }

    modulesDir = modulesDir ?? path.join(dir, 'node_modules')
    const manifest = await readAndCheckManifest(depName, path.join(modulesDir, depName))
    const semverRangeToken = semverRangGroup !== '*' ? semverRangGroup : ''

    return depSpec.replace(workspaceSemverRegex, `${semverRangeToken}${manifest.version}`)
  }

  return depSpec.replace('workspace:', '')
}
